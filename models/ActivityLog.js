import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ── Activity Type ─────────────────────────────────────────────────────────
    activityType: {
      type: String,
      enum: [
        'LOGIN',
        'LOGOUT',
        'PROFILE_UPDATE',
        'PHOTO_UPLOAD',
        'PASSWORD_CHANGE',
        'FARM_SETTINGS_UPDATE',
        'CROP_SELECTION',
        'LOCATION_UPDATE',
        'KYC_SUBMISSION',
        'BANK_DETAILS_UPDATE',
        'DEVICE_REGISTRATION',
        'NOTIFICATION_RECEIVED',
        'FORM_SUBMISSION',
        'DATA_SYNC',
        'ACCOUNT_DELETION',
      ],
      required: true,
      index: true,
    },

    // ── Activity Details ──────────────────────────────────────────────────────
    description: {
      type: String,
      default: '',
      trim: true,
    },

    // Data that was changed (for updates)
    changeDetails: {
      field: String, // Which field was changed
      oldValue: mongoose.Schema.Types.Mixed,
      newValue: mongoose.Schema.Types.Mixed,
    },

    // ── Device & Network Info ─────────────────────────────────────────────────
    deviceInfo: {
      deviceName: String,
      deviceModel: String,
      osVersion: String,
      appVersion: String,
      ipAddress: String,
    },

    // ── Status & Metadata ─────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PENDING'],
      default: 'SUCCESS',
    },

    errorMessage: {
      type: String,
      default: '',
    },

    // ── Location Data (for activities like location_update) ───────────────────
    location: {
      latitude: Number,
      longitude: Number,
      state: String,
      district: String,
      village: String,
    },

    // ── Additional Metadata ───────────────────────────────────────────────────
    metadata: mongoose.Schema.Types.Mixed,

    // ── Timestamps ────────────────────────────────────────────────────────────
    // `timestamp` keeps the original indexed field used by existing queries.
    // `timestamps: true` below adds createdAt/updatedAt managed by Mongoose.
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Compound index for efficient querying
activityLogSchema.index({ userId: 1, timestamp: -1 });
activityLogSchema.index({ userId: 1, activityType: 1, timestamp: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);