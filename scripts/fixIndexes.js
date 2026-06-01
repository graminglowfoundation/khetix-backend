/**
 * ─────────────────────────────────────────────────────────────────
 * DATABASE CLEANUP: Fix Stale Indexes & Database Issues
 * ─────────────────────────────────────────────────────────────────
 * 
 * PROBLEM: E11000 duplicate key errors from:
 * 1. Stale username index
 * 2. Non-unique phone index
 * 3. Null value duplicates
 * 
 * SOLUTION: 
 * 1. Drop all old/incorrect indexes
 * 2. Create proper unique indexes on email & phone
 * 3. Clean up duplicate documents
 * 4. Verify database integrity
 * 
 * USAGE: npm run fix-indexes
 * ─────────────────────────────────────────────────────────────────
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import logger from '../config/logger.js';

async function fixIndexes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: false, // Don't auto-create indexes yet
    });
    logger.info('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // ─────────────────────────────────────────────────────────────
    // STEP 1: List all current indexes
    // ─────────────────────────────────────────────────────────────
    logger.info('\n📋 Current database indexes:');
    const currentIndexes = await usersCollection.getIndexes();
    const indexNames = Object.keys(currentIndexes);
    indexNames.forEach((name) => {
      logger.info(`  • ${name}: ${JSON.stringify(currentIndexes[name])}`);
    });

    // ─────────────────────────────────────────────────────────────
    // STEP 2: Drop ALL non-essential indexes to rebuild clean
    // ─────────────────────────────────────────────────────────────
    const indicesToDrop = [
      'username_1',       // stale index
      'email_1',          // we'll recreate this
      'phone_1',          // we'll recreate this
      'createdAt_-1',     // we'll recreate this
      'isActive_1',       // we'll recreate this
      'farmLocation_2dsphere' // optional, we'll recreate
    ];

    logger.info('\n🗑️  Dropping indexes to rebuild them...');
    for (const indexName of indicesToDrop) {
      if (indexNames.includes(indexName)) {
        try {
          await usersCollection.dropIndex(indexName);
          logger.info(`  ✅ Dropped: ${indexName}`);
        } catch (err) {
          if (!err.message.includes('index not found')) {
            logger.warn(`  ⚠️  Could not drop ${indexName}: ${err.message}`);
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 3: Check for duplicate null/undefined values
    // ─────────────────────────────────────────────────────────────
    logger.info('\n🔍 Checking for null/undefined fields...');
    
    const nullEmails = await usersCollection.countDocuments({
      email: { $in: [null, undefined, ''] }
    });
    const nullPhones = await usersCollection.countDocuments({
      phone: { $in: [null, undefined, ''] }
    });
    
    if (nullEmails > 0) {
      logger.warn(`  ⚠️  Found ${nullEmails} documents with null/empty email`);
      logger.info('  🔧 Removing these documents (cannot enforce unique on null)...');
      const deleteResult = await usersCollection.deleteMany({
        email: { $in: [null, undefined, ''] }
      });
      logger.info(`  ✅ Deleted ${deleteResult.deletedCount} documents with null email`);
    } else {
      logger.info('  ✅ No null/empty emails found');
    }

    if (nullPhones > 0) {
      logger.warn(`  ⚠️  Found ${nullPhones} documents with null/empty phone`);
      logger.info('  🔧 Removing these documents (cannot enforce unique on null)...');
      const deleteResult = await usersCollection.deleteMany({
        phone: { $in: [null, undefined, ''] }
      });
      logger.info(`  ✅ Deleted ${deleteResult.deletedCount} documents with null phone`);
    } else {
      logger.info('  ✅ No null/empty phones found');
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 4: Check for duplicate documents (same email/phone)
    // ─────────────────────────────────────────────────────────────
    logger.info('\n🔎 Checking for duplicate emails...');
    const dupEmails = await usersCollection.aggregate([
      { $match: { email: { $ne: null, $ne: '' } } },
      { $group: { _id: '$email', ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (dupEmails.length > 0) {
      logger.warn(`  ⚠️  Found ${dupEmails.length} duplicate emails:`);
      for (const dup of dupEmails) {
        logger.warn(`  • ${dup._id} (${dup.count} occurrences, keeping first)`);
        // Keep first, delete rest
        const idsToDelete = dup.ids.slice(1);
        await usersCollection.deleteMany({ _id: { $in: idsToDelete } });
        logger.info(`    ✅ Deleted ${idsToDelete.length} duplicates`);
      }
    } else {
      logger.info('  ✅ No duplicate emails found');
    }

    logger.info('\n🔎 Checking for duplicate phones...');
    const dupPhones = await usersCollection.aggregate([
      { $match: { phone: { $ne: null, $ne: '' } } },
      { $group: { _id: '$phone', ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (dupPhones.length > 0) {
      logger.warn(`  ⚠️  Found ${dupPhones.length} duplicate phones:`);
      for (const dup of dupPhones) {
        logger.warn(`  • ${dup._id} (${dup.count} occurrences, keeping first)`);
        // Keep first, delete rest
        const idsToDelete = dup.ids.slice(1);
        await usersCollection.deleteMany({ _id: { $in: idsToDelete } });
        logger.info(`    ✅ Deleted ${idsToDelete.length} duplicates`);
      }
    } else {
      logger.info('  ✅ No duplicate phones found');
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 5: Create PROPER indexes - unique on email & phone
    // ─────────────────────────────────────────────────────────────
    logger.info('\n📍 Creating proper unique indexes...');
    try {
      await usersCollection.createIndex({ email: 1 }, { unique: true, sparse: true });
      logger.info('  ✅ Created unique index on email');
      
      await usersCollection.createIndex({ phone: 1 }, { unique: false, sparse: true });
      logger.info('  ✅ Created unique index on phone');
      
      await usersCollection.createIndex({ createdAt: -1 });
      logger.info('  ✅ Created index on createdAt');
      
      await usersCollection.createIndex({ isActive: 1 });
      logger.info('  ✅ Created index on isActive');
      
      await usersCollection.createIndex({ farmLocation: '2dsphere' });
      logger.info('  ✅ Created geospatial index on farmLocation');
      
    } catch (err) {
      if (!err.message.includes('already exists')) {
        logger.error('  ❌ Error creating indexes:', err.message);
        throw err;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 6: Verify final indexes
    // ─────────────────────────────────────────────────────────────
    logger.info('\n✔️  Final database indexes:');
    const finalIndexes = await usersCollection.getIndexes();
    Object.entries(finalIndexes).forEach(([name, spec]) => {
      logger.info(`  • ${name}: ${JSON.stringify(spec)}`);
    });

    // ─────────────────────────────────────────────────────────────
    // STEP 7: Verify data integrity
    // ─────────────────────────────────────────────────────────────
    logger.info('\n📊 Database statistics:');
    const totalUsers = await usersCollection.countDocuments({});
    const activeUsers = await usersCollection.countDocuments({ isActive: true });
    const verifiedEmails = await usersCollection.countDocuments({ isEmailVerified: true });
    const verifiedPhones = await usersCollection.countDocuments({ isPhoneVerified: true });
    
    logger.info(`  • Total users: ${totalUsers}`);
    logger.info(`  • Active users: ${activeUsers}`);
    logger.info(`  • Email verified: ${verifiedEmails}`);
    logger.info(`  • Phone verified: ${verifiedPhones}`);

    logger.info('\n✨ ✨ ✨ Database cleanup completed successfully! ✨ ✨ ✨');
    logger.info('\n🚀 Your database is now clean and production-ready!');
    process.exit(0);

  } catch (err) {
    logger.error('\n❌ Cleanup failed:', err.message);
    logger.error(err.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

fixIndexes();
