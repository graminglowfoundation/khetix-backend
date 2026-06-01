/**
 * MIGRATION GUIDE: MongoDB Database Restructuring
 * 
 * This script helps migrate from the old monolithic User model to the new
 * separated collection structure.
 * 
 * IMPORTANT: Back up your database before running this migration!
 */

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION STRATEGY
// ════════════════════════════════════════════════════════════════════════════
//
// OLD STRUCTURE:
//   User collection with all fields (name, email, phone, farmLocation, crops, etc.)
//
// NEW STRUCTURE:
//   1. User - Only auth and core fields
//   2. UserProfile - Personal info
//   3. FarmDetails - Farm location, crops, land
//   4. ActivityLog - User activities (initially populated with account creation)
//   5. CropHistory - Crop-by-crop data
//   6. KYCDocuments - KYC verification status
//
// ════════════════════════════════════════════════════════════════════════════

// OPTION 1: NEW USERS (RECOMMENDED)
// ────────────────────────────────────────────────────────────────────────────
// For new users registering after this migration:
// 1. User registers via /api/auth/register
// 2. User model is created in User collection
// 3. UserProfile document is created automatically (on first profile fetch/update)
// 4. FarmDetails document is created when user saves farm settings
// 5. ActivityLog entries are created automatically for all actions
// 6. KYCDocuments created when user submits KYC

// This is the cleanest approach - no migration code needed!

// ════════════════════════════════════════════════════════════════════════════
// OPTION 2: MIGRATE EXISTING USERS (if you have production data)
// ════════────────────────────────────────────────────────────────────────────

import mongoose from 'mongoose';
import User from '../models/User.js';
// UserProfile.js was deleted — User model is now the single source of truth.
// The migration no longer creates separate UserProfile documents.
import FarmDetails from '../models/FarmDetails.js';
import ActivityLog from '../models/ActivityLog.js';
import KYCDocuments from '../models/KYCDocuments.js';

export async function migrateUserData() {
  let migratedCount = 0;
  let errorCount = 0;
  const errors = [];

  try {
    const allUsers = await User.find({}).select('+password').lean();
    
    console.log(`🔄 Starting migration of ${allUsers.length} users...`);

    for (const oldUser of allUsers) {
      try {
        // UserProfile was merged into User — no separate document to create.
        // All personal info (name, email, phone, photoUrl, kycVerified, etc.)
        // now lives directly on the User document.

        // 2. Create FarmDetails
        if (!await FarmDetails.findOne({ userId: oldUser._id })) {
          const farmDetails = new FarmDetails({
            userId: oldUser._id,
            location: {
              state: oldUser.state || '',
              district: oldUser.district || '',
              village: oldUser.village || '',
              farmPin: oldUser.farmPin || '',
            },
            totalLand: oldUser.totalLand ? parseFloat(oldUser.totalLand) : 0,
            landUnit: oldUser.landUnit || 'ACRE',
            preferredCrops: oldUser.preferredCrops || oldUser.crops || [],
            farmStatus: oldUser.isActive ? 'ACTIVE' : 'INACTIVE',
            soilType: null,
          });

          await farmDetails.save();
          console.log(`✅ FarmDetails created for user ${oldUser._id}`);
        }

        // 3. Create KYCDocuments (status only, no docs)
        if (!await KYCDocuments.findOne({ userId: oldUser._id })) {
          const kycDocuments = new KYCDocuments({
            userId: oldUser._id,
            overallStatus: oldUser.kycVerified ? 'VERIFIED' : 'PENDING',
            submittedAt: oldUser.updatedAt,
          });

          await kycDocuments.save();
          console.log(`✅ KYCDocuments created for user ${oldUser._id}`);
        }

        // 4. Create initial ActivityLog entry (account created)
        if (!(await ActivityLog.findOne({ userId: oldUser._id, activityType: 'LOGIN' }))) {
          const activityLog = new ActivityLog({
            userId: oldUser._id,
            activityType: 'LOGIN',
            description: 'Account created and migrated',
            status: 'SUCCESS',
            timestamp: oldUser.createdAt,
          });

          await activityLog.save();
          console.log(`✅ ActivityLog entries created for user ${oldUser._id}`);
        }

        // 5. Update User model to set profile complete flags
        await User.findByIdAndUpdate(oldUser._id, {
          isProfileComplete: !!oldUser.name && !!oldUser.email && !!oldUser.phone,
          isFarmDetailsSet: !!(oldUser.state && oldUser.district && oldUser.village),
        });

        migratedCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          userId: oldUser._id,
          error: error.message,
        });
        console.error(`❌ Error migrating user ${oldUser._id}: ${error.message}`);
      }
    }

    console.log(`\n📊 Migration Complete!`);
    console.log(`✅ Successfully migrated: ${migratedCount} users`);
    console.log(`❌ Errors: ${errorCount} users`);

    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((err) => {
        console.log(`   User ${err.userId}: ${err.error}`);
      });
    }

    return {
      success: errorCount === 0,
      migratedCount,
      errorCount,
      errors,
    };
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RUN MIGRATION (Execute from backend directory)
// ════════════════════════════════════════════════════════════════════════════
//
// Add this to a seed script or run manually:
//
// import { migrateUserData } from './scripts/migration.js';
// import { connectDB, closeDB } from './config/db.js';
//
// await connectDB();
// await migrateUserData();
// await closeDB();
//
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// VERIFICATION QUERIES (run after migration)
// ════════════════════════════════════════════════════════════════════════════
//
// // Check UserProfile count
// db.userprofiles.countDocuments()
//
// // Check FarmDetails count
// db.farmdetails.countDocuments()
//
// // Check ActivityLog count
// db.activitylogs.countDocuments()
//
// // Find users without profiles
// db.users.find({ _id: { $nin: db.userprofiles.distinct('userId') } })
//
// // View a complete user record
// db.users.findOne({ _id: ObjectId('...') })
// db.userprofiles.findOne({ userId: ObjectId('...') })
// db.farmdetails.findOne({ userId: ObjectId('...') })
// db.activitylogs.find({ userId: ObjectId('...') })
//
// ════════════════════════════════════════════════════════════════════════════

export default migrateUserData;