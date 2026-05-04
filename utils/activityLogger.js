/**
 * utils/activityLogger.js
 *
 * Single canonical version. The repo had TWO copies of this file with
 * slightly different signatures — merged here into one.
 * The old utils/activityLogger.js (1776518957508) used a named export
 * object as default; this version uses named exports directly, matching
 * what all routes expect: import { logActivity } from '../utils/activityLogger.js'
 */

import ActivityLog from '../models/ActivityLog.js';
import logger from '../config/logger.js';

const DEFAULT_DESCRIPTIONS = {
  LOGIN:                 'User logged in',
  LOGOUT:                'User logged out',
  PROFILE_UPDATE:        'Profile information updated',
  PHOTO_UPLOAD:          'Profile photo uploaded',
  PASSWORD_CHANGE:       'Password changed',
  FARM_SETTINGS_UPDATE:  'Farm settings updated',
  CROP_SELECTION:        'Crop preference updated',
  LOCATION_UPDATE:       'Farm location updated',
  KYC_SUBMISSION:        'KYC documents submitted',
  BANK_DETAILS_UPDATE:   'Bank details updated',
  DEVICE_REGISTRATION:   'Device registered',
  NOTIFICATION_RECEIVED: 'Notification received',
  FORM_SUBMISSION:       'Form submitted',
  DATA_SYNC:             'Data synchronized',
  ACCOUNT_DELETION:      'Account deleted',
};

/**
 * Log a user activity. Never throws — a logging failure must never
 * fail the actual request.
 *
 * @param {string|ObjectId} userId
 * @param {string}          activityType  - Must match ActivityLog enum
 * @param {object}          details       - Optional extra fields
 */
export async function logActivity(userId, activityType, details = {}) {
  try {
    const now = new Date();
    const doc = {
      userId,
      activityType,
      description:  details.description  ?? DEFAULT_DESCRIPTIONS[activityType] ?? 'Activity recorded',
      status:       details.status       ?? 'SUCCESS',
      errorMessage: details.errorMessage ?? '',
      timestamp:    now,
      createdAt:    now,   // explicit — never rely on schema default alone
    };

    // Only set optional sub-documents when a value was actually provided,
    // so Mongoose doesn't attempt to validate an empty nested object.
    if (details.changeDetails) doc.changeDetails = details.changeDetails;
    if (details.deviceInfo)    doc.deviceInfo    = details.deviceInfo;
    if (details.location)      doc.location      = details.location;
    if (details.metadata)      doc.metadata      = details.metadata;

    await ActivityLog.create(doc);
  } catch (err) {
    // Use Winston so failures appear in log files — console.error only goes
    // to stderr and is invisible to the Winston transports.
    logger.error(
      `[activityLogger] Failed to save "${activityType}" for user ${userId}: ${err.message}`,
      { code: err.code, stack: err.stack }
    );
  }
}