/**
 * routes/user.js
 *
 * All user-facing routes. Replaces both user.js AND userdata.js.
 * userdata.js → DELETED (its routes duplicated user.js with req.userId bug)
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';
import CropHistory from '../models/CropHistory.js';
import logger from '../config/logger.js';
import { protect } from '../middleware/auth1.js';
import { validate, schemas } from '../middleware/validate.js';
import { logActivity } from '../utils/activityLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router    = express.Router();
router.use(protect);

// ── Photo upload config ───────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'profiles');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, or WebP images are allowed.'));
  },
});

function stripJpegPrefix(buffer) {
  if (!buffer || buffer.length < 2) return buffer;
  const soiIdx = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
  if (soiIdx > 0) { logger.info(`Stripping ${soiIdx} prefix bytes before JPEG SOI`); return buffer.subarray(soiIdx); }
  return buffer;
}

// ── GET /api/user/profile ─────────────────────────────────────────────────────
router.get('/profile', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user, profileCompletion: user.profileCompletion });
  } catch (err) { next(err); }
});

// ── PUT /api/user/profile ─────────────────────────────────────────────────────
router.put('/profile', validate(schemas.updateProfile), async (req, res, next) => {
  try {
    const ALLOWED = ['name', 'email', 'phone', 'village', 'district', 'state', 'farmLocation', 'landAcres', 'farmType', 'crops', 'preferences'];
    const updates = {};
    ALLOWED.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    // Fetch current user to know their existing name/phone for combination checks
    const currentUser = await User.findById(req.user.id).select('name phone');

    const targetPhone = updates.phone ? User.normalizePhone(updates.phone) : currentUser.phone;
    const targetName  = updates.name ? updates.name.trim() : currentUser.name;

    if (updates.phone) updates.phone = targetPhone;

    // FIX: Allow up to 3 accounts per phone, but prevent identical name + phone combinations
    if (updates.phone !== undefined || updates.name !== undefined) {
      const samePhoneAccounts = await User.find({
        phone: targetPhone,
        _id: { $ne: req.user.id }
      }).select('name').lean();

      // Rule 1: Max 3 accounts per phone
      if (updates.phone && updates.phone !== currentUser.phone && samePhoneAccounts.length >= 3) {
        return res.status(409).json({ success: false, message: 'Maximum 3 accounts are allowed per phone number.', code: 'PHONE_ACCOUNT_LIMIT' });
      }

      // Rule 2: Prevent exact duplicate name+phone
      const exactDup = samePhoneAccounts.find(
        (u) => u.name.toLowerCase() === targetName.toLowerCase()
      );
      if (exactDup) {
        return res.status(409).json({ success: false, message: 'An account with this name and phone number already exists.', code: 'DUPLICATE_ACCOUNT' });
      }
    }

    
    // FIX: Allow up to 3 accounts to share the same email
    if (updates.email && updates.email.trim() !== '') {
      updates.email = updates.email.toLowerCase().trim();
      
      const emailCount = await User.countDocuments({ email: updates.email, _id: { $ne: req.user.id } });
      
      if (emailCount >= 3) {
        return res.status(409).json({ success: false, message: 'Maximum 3 accounts can share this email.' });
      }
      updates.isEmailVerified = false;
    } else if (updates.email === '' || updates.email === null) {
      updates.email = null; // Clears the email safely in the database
    }

    // FIX: coerce empty farmType to null so pre-save hook can clean it
    if (updates.farmType === '') updates.farmType = null;

    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    await logActivity(req.user.id, 'PROFILE_UPDATE', { changeDetails: { field: 'profile', newValue: Object.keys(updates) } });
    res.json({ success: true, message: 'Profile updated.', user, profileCompletion: user.profileCompletion });
  } catch (err) { next(err); }
});

// ── POST /api/user/photo ──────────────────────────────────────────────────────
router.post('/photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ success: false, message: 'No valid photo uploaded.' });
    }

    const filename = `${req.user.id}_${Date.now()}.webp`;
    const filepath = path.join(UPLOAD_DIR, filename);

    const imageBuffer = (req.file.mimetype === 'image/jpeg' || req.file.mimetype === 'image/jpg')
      ? stripJpegPrefix(req.file.buffer) : req.file.buffer;

    try {
      await sharp(imageBuffer, { failOn: 'none' })
        .rotate()
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toFile(filepath);
    } catch (sharpErr) {
      logger.error(`Image processing failed for user ${req.user.id}: ${sharpErr?.message}`);
      return res.status(422).json({ success: false, message: 'Image processing failed. Try a different image.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) { try { fs.unlinkSync(filepath); } catch (_) {} return res.status(404).json({ success: false, message: 'User not found.' }); }

    // Delete old photo
    if (user.photoUrl) {
      const oldPath = path.join(UPLOAD_DIR, path.basename(user.photoUrl));
      try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
    }

    const photoUrl = `/uploads/profiles/${filename}`;
    user.photoUrl = photoUrl;
    await user.save({ validateBeforeSave: false });

    await logActivity(req.user.id, 'PHOTO_UPLOAD');
    res.json({ success: true, message: 'Photo uploaded.', photoUrl });
  } catch (err) { next(err); }
});

// ── PATCH /api/user/fcm-token  (NEW) ─────────────────────────────────────────
router.patch('/fcm-token', async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (typeof fcmToken !== 'string') {
      return res.status(400).json({ success: false, message: 'fcmToken must be a string.' });
    }
    await User.findByIdAndUpdate(req.user.id, { fcmToken: fcmToken.trim() });
    res.json({ success: true, message: 'FCM token updated.' });
  } catch (err) { next(err); }
});

// ── POST /api/user/change-password ───────────────────────────────────────────
router.post('/change-password', validate(schemas.changePassword), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password +refreshTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    if (currentPassword === newPassword) return res.status(400).json({ success: false, message: 'New password must differ from current.' });

    user.password      = newPassword;
    user.refreshTokens = [];
    await user.save();

    await logActivity(req.user.id, 'PASSWORD_CHANGE');
    res.json({ success: true, message: 'Password changed. Please log in again.' });
  } catch (err) { next(err); }
});

// ── DELETE /api/user/account ──────────────────────────────────────────────────
router.delete('/account', validate(schemas.deleteAccount), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const isMatch = await user.comparePassword(req.body.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Password is incorrect.' });

    user.isActive = false;
    user.email    = `deleted_${user._id}@deleted.khetix`;
    user.phone    = `deleted_${user._id}`;
    user.fcmToken = '';
    await user.save({ validateBeforeSave: false });

    await logActivity(req.user.id, 'ACCOUNT_DELETION');
    res.json({ success: true, message: 'Account deleted.' });
  } catch (err) { next(err); }
});

// ── GET /api/user/stats ───────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      'name email phone village district state photoUrl landAcres kycVerified isEmailVerified isPhoneVerified lastLoginAt createdAt farmType crops'
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({
      success: true,
      stats: {
        profileCompletion: user.profileCompletion,
        kycVerified:       user.kycVerified,
        emailVerified:     user.isEmailVerified,
        phoneVerified:     user.isPhoneVerified,
        memberSince:       user.createdAt,
        lastLogin:         user.lastLoginAt,
        farmType:          user.farmType,
        landAcres:         user.landAcres,
        totalCrops:        user.crops?.length ?? 0,
      },
    });
  } catch (err) { next(err); }
});

// ── PUT /api/user/farm-settings ──────────────────────────────────────────────
router.put('/farm-settings', async (req, res, next) => {
  try {
    const VALID_UNITS = ['ACRE', 'HECTARE', 'BIGHA', 'GUNTA', 'DISMIL', 'MARLA'];
    const { farmState, farmDistrict, farmVillage, farmPin, totalLand, landUnit, preferredCrops } = req.body;

    if (landUnit && !VALID_UNITS.includes(landUnit)) {
      return res.status(400).json({ success: false, message: `Invalid land unit. Allowed: ${VALID_UNITS.join(', ')}` });
    }

    const updates = {};
    if (farmState     !== undefined) updates.state          = farmState;
    if (farmDistrict  !== undefined) updates.district       = farmDistrict;
    if (farmVillage   !== undefined) updates.village        = farmVillage;
    if (farmPin       !== undefined) updates.farmPin        = farmPin;
    if (totalLand     !== undefined) updates.totalLand      = totalLand;
    if (landUnit      !== undefined) updates.landUnit       = landUnit;
    if (preferredCrops!== undefined) updates.preferredCrops = Array.isArray(preferredCrops) ? preferredCrops : [];

    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    await logActivity(req.user.id, 'FARM_SETTINGS_UPDATE');
    res.json({
      success: true,
      message: 'Farm settings saved.',
      farmSettings: {
        state: user.state, district: user.district, village: user.village,
        farmPin: user.farmPin, totalLand: user.totalLand, landUnit: user.landUnit,
        preferredCrops: user.preferredCrops,
      },
    });
  } catch (err) { next(err); }
});
// ── GET /api/user/alert-settings ──────────────────────────────────────────────
// Called on app launch so the Android side loads the last-saved server settings
// instead of always falling back to SharedPreferences defaults.
router.get('/alert-settings', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('preferences');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({
      success: true,
      alertSettings: user.preferences?.alertSettings ?? {},
    });
  } catch (err) { next(err); }
});

// ── PUT /api/user/alert-settings ──────────────────────────────────────────────
// 🟢 ADD THIS ROUTE
router.put('/alert-settings', validate(schemas.updateAlertSettings), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Initialize if it doesn't exist
    if (!user.preferences) user.preferences = {};
    if (!user.preferences.alertSettings) user.preferences.alertSettings = {};

    // Merge incoming settings with existing settings
    Object.keys(req.body).forEach(key => {
      user.preferences.alertSettings[key] = req.body[key];
    });

    // CRITICAL: Mongoose does NOT detect nested object mutations automatically.
    // Without markModified the save() call is a no-op and settings are never
    // persisted — meaning push notifications always use stale defaults.
    user.markModified('preferences.alertSettings');

    await user.save({ validateBeforeSave: false });
    
    await logActivity(req.user.id, 'PROFILE_UPDATE', { description: 'Updated Farm Alert settings' });
    
    res.json({
      success: true,
      message: 'Alert settings updated successfully.',
      alertSettings: user.preferences.alertSettings
    });
  } catch (err) { next(err); }
});

// ── GET /api/user/activity ────────────────────────────────────────────────────
router.get('/activity', async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const filter = { userId: req.user.id };
    if (req.query.type) filter.activityType = req.query.type;

    const [activities, total] = await Promise.all([
      ActivityLog.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({ success: true, data: activities, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// ── GET /api/user/crop-history ────────────────────────────────────────────────
router.get('/crop-history', async (req, res, next) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const filter = { userId: req.user.id };
    if (req.query.year)   filter.year   = parseInt(req.query.year);
    if (req.query.season) filter.season = req.query.season.toUpperCase();

    const [cropHistory, total] = await Promise.all([
      CropHistory.find(filter).sort({ year: -1, sowingDate: -1 }).skip((page - 1) * limit).limit(limit),
      CropHistory.countDocuments(filter),
    ]);

    res.json({ success: true, data: cropHistory, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// ── POST /api/user/crop-history ───────────────────────────────────────────────
router.post('/crop-history', async (req, res, next) => {
  try {
    const cropHistory = await CropHistory.create({ userId: req.user.id, ...req.body });
    await logActivity(req.user.id, 'CROP_SELECTION', { description: `Added ${req.body.cropName} to crop history` });
    res.status(201).json({ success: true, message: 'Crop history entry created.', data: cropHistory });
  } catch (err) { next(err); }
});

// ── PUT /api/user/crop-history/:id ───────────────────────────────────────────
router.put('/crop-history/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid crop history ID.' });
    }
    const cropHistory = await CropHistory.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!cropHistory) return res.status(404).json({ success: false, message: 'Crop history entry not found.' });
    await logActivity(req.user.id, 'CROP_SELECTION', { description: 'Crop history updated' });
    res.json({ success: true, message: 'Crop history updated.', data: cropHistory });
  } catch (err) { next(err); }
});

export default router;