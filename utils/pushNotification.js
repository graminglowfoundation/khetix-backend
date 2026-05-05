/**
 * utils/pushNotification.js
 *
 * Mobile push notifications via Firebase Cloud Messaging (FCM).
 *
 * SETUP (one-time):
 *  1. Go to Firebase Console → Project Settings → Service Accounts
 *  2. Click "Generate new private key" → download the JSON file
 *  3. Save it as  config/firebase-service-account.json  (add to .gitignore!)
 *  4. npm install firebase-admin
 *
 * ANDROID APP:
 *  - Add Firebase to the Android project (google-services.json)
 *  - After login, call  PATCH /api/user/fcm-token  with { fcmToken: "..." }
 *  - The token is stored in User.fcmToken and used here automatically.
 *
 * USAGE:
 *   import { sendPushToUser, sendPushToMany } from '../utils/pushNotification.js';
 *
 *   // Send to one user
 *   await sendPushToUser(userId, {
 *     title: 'Disease Alert',
 *     body:  'Early blight detected on your tomato crop.',
 *     data:  { screen: 'ScanResult', cropId: '...' }   // optional deep-link
 *   });
 *
 *   // Send to many users (broadcast / bulk)
 *   await sendPushToMany([userId1, userId2], { title: '...', body: '...' });
 */

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import User from '../models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

// ── Initialise Firebase Admin (lazy, singleton) ───────────────────────────────
let firebaseReady = false;

function initFirebase() {
  if (firebaseReady || admin.apps.length > 0) { firebaseReady = true; return; }

  try {
    let serviceAccount;

    // PRODUCTION: Try environment variable first (for Render deployment)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('[pushNotification] Using Firebase credentials from environment variable');
      } catch (parseErr) {
        console.error('[pushNotification] Failed to parse FIREBASE_SERVICE_ACCOUNT env var:', parseErr.message);
        return;
      }
    }
    // DEVELOPMENT: Fall back to local file
    else if (existsSync(SERVICE_ACCOUNT_PATH)) {
      serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
      console.log('[pushNotification] Using Firebase credentials from local file');
    }
    // NO CREDENTIALS FOUND
    else {
      console.warn(
        '[pushNotification] Firebase credentials not found. Push notifications disabled.\n' +
        'For local development: Add firebase-service-account.json to config/\n' +
        'For production: Set FIREBASE_SERVICE_ACCOUNT environment variable'
      );
      return;
    }

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
    console.log('[pushNotification] Firebase Admin initialised ✅');
  } catch (err) {
    console.error('[pushNotification] Firebase init failed:', err.message);
  }
}

initFirebase();

// ── Core send helper ──────────────────────────────────────────────────────────
/**
 * Send a single FCM message to one device token.
 * Returns true on success, false on failure (never throws).
 *
 * @param {string} fcmToken  - Device token stored in User.fcmToken
 * @param {object} payload   - { title, body, data? }
 */
async function sendToToken(fcmToken, { title, body, data = {} }) {
  if (!firebaseReady) return false;
  if (!fcmToken)       return false;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(                 // FCM data must be string values
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          sound:       'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
    });
    return true;
  } catch (err) {
    // Token invalid/expired — clean it from DB so we stop sending to it
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      await User.updateOne({ fcmToken }, { $set: { fcmToken: '' } }).catch(() => {});
    }
    console.error(`[pushNotification] Send failed (${err.code}): ${err.message}`);
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a push notification to one user by their MongoDB _id.
 * Skips silently if the user has no FCM token or has disabled push.
 */
export async function sendPushToUser(userId, payload) {
  try {
    const user = await User.findById(userId).select('fcmToken preferences');
    if (!user?.fcmToken)                          return false;
    if (user.preferences?.notifications?.push === false) return false;
    return sendToToken(user.fcmToken, payload);
  } catch (err) {
    console.error('[pushNotification] sendPushToUser error:', err.message);
    return false;
  }
}

/**
 * Send a push notification to multiple users.
 * Fetches all tokens in one DB query and sends in parallel.
 * Returns { sent, failed } counts.
 */
export async function sendPushToMany(userIds, payload) {
  try {
    const users = await User.find({
      _id:      { $in: userIds },
      fcmToken: { $ne: '' },
      'preferences.notifications.push': { $ne: false },
    }).select('fcmToken');

    const results = await Promise.allSettled(
      users.map((u) => sendToToken(u.fcmToken, payload))
    );

    const sent   = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - sent;
    console.log(`[pushNotification] Sent ${sent}/${results.length}, failed: ${failed}`);
    return { sent, failed };
  } catch (err) {
    console.error('[pushNotification] sendPushToMany error:', err.message);
    return { sent: 0, failed: userIds.length };
  }
}

/**
 * Broadcast to ALL active users who have an FCM token.
 * Use with care — intended for admin alerts only.
 * Processes in batches of 500 to avoid memory issues.
 */
export async function broadcastPush(payload) {
  let sent = 0, failed = 0, cursor;
  try {
    cursor = User.find({
      isActive: true,
      fcmToken: { $ne: '' },
      'preferences.notifications.push': { $ne: false },
    }).select('fcmToken').cursor();

    const BATCH = 500;
    let batch = [];

    for await (const user of cursor) {
      batch.push(sendToToken(user.fcmToken, payload));
      if (batch.length >= BATCH) {
        const results = await Promise.allSettled(batch);
        sent   += results.filter((r) => r.status === 'fulfilled' && r.value).length;
        failed += results.length - (results.filter((r) => r.status === 'fulfilled' && r.value).length);
        batch = [];
      }
    }

    if (batch.length) {
      const results = await Promise.allSettled(batch);
      sent   += results.filter((r) => r.status === 'fulfilled' && r.value).length;
      failed += results.length - (results.filter((r) => r.status === 'fulfilled' && r.value).length);
    }

    console.log(`[pushNotification] Broadcast complete — sent: ${sent}, failed: ${failed}`);
    return { sent, failed };
  } catch (err) {
    console.error('[pushNotification] broadcastPush error:', err.message);
    return { sent, failed };
  }
}

// ── sendFarmAlertToUser ───────────────────────────────────────────────────────
/**
 * Send a DATA-ONLY FCM message to one user by MongoDB _id.
 *
 * WHY DATA-ONLY?
 * FCM messages that include a "notification" key are shown automatically by
 * the Android OS when the app is in the background — but the app's
 * FirebaseMessagingService is NOT called in that case, so we cannot apply
 * quiet-hours or category toggles.
 *
 * DATA-ONLY messages always invoke KhetiXFcmService.onMessageReceived(),
 * even when the app is completely killed, giving the client full control
 * over whether and how to show the notification.
 *
 * @param {string|ObjectId} userId
 * @param {{ title: string, body: string, alertType: string, _fcmToken?: string }} payload
 *   alertType  — "WEATHER_ALERT" | "PRICE_ALERT" | "SCHEME_ALERT" | "GENERAL"
 *   _fcmToken  — optional: pass the already-fetched token to skip the DB lookup
 *                (used by alertScheduler which already has the user document)
 */
export async function sendFarmAlertToUser(userId, { title, body, alertType = 'GENERAL', _fcmToken, _preferences }) {
  // ── Guard: Firebase must be ready ────────────────────────────────────────
  if (!firebaseReady) {
    console.error(
      `[pushNotification] sendFarmAlertToUser: Firebase NOT ready for user ${userId}. ` +
      'Ensure config/firebase-service-account.json exists and is valid.'
    );
    return false;
  }

  try {
    // ── Resolve FCM token + preferences ──────────────────────────────────
    // If the caller (e.g. alertScheduler) already has both from its lean query,
    // use them directly to avoid a redundant DB round-trip.
    let fcmToken    = _fcmToken;
    let preferences = _preferences;

    if (!fcmToken) {
      const user = await User.findById(userId).select('fcmToken preferences');

      if (!user) {
        console.warn(`[pushNotification] sendFarmAlertToUser: User ${userId} not found in DB.`);
        return false;
      }

      if (!user.fcmToken) {
        console.warn(
          `[pushNotification] sendFarmAlertToUser: User ${userId} has no FCM token in DB. ` +
          'Make sure the Android app calls PATCH /api/user/fcm-token after login.'
        );
        return false;
      }

      fcmToken    = user.fcmToken;
      preferences = user.preferences;
    }

    // ── FIX: Push preference check MUST run regardless of whether _fcmToken
    // was pre-supplied. Previously, when alertScheduler passed _fcmToken directly
    // the entire preference block was skipped, sending notifications to users
    // who had explicitly disabled push alerts.
    if (preferences?.notifications?.push === false) {
      console.info(`[pushNotification] sendFarmAlertToUser: User ${userId} has push notifications disabled.`);
      return false;
    }

    // ── Send DATA-ONLY message ────────────────────────────────────────────
    await admin.messaging().send({
      token: fcmToken,
      // DATA-ONLY — no "notification" key intentionally.
      // The Android KhetiXFcmService handles building and showing the notification
      // so it can apply quiet-hours logic even when the app is killed.
      data: {
        type:  alertType,
        title: String(title),
        body:  String(body),
      },
      android: {
        priority: 'high',           // ensures delivery even when device is idle
        ttl:      3600 * 1000,      // drop if not delivered within 1 hour
      },
    });
    return true;

  } catch (err) {
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      console.warn(
        `[pushNotification] sendFarmAlertToUser: FCM token for user ${userId} is invalid/expired — clearing from DB.`
      );
      await User.updateOne({ _id: userId }, { $set: { fcmToken: '' } }).catch(() => {});
    } else {
      console.error(`[pushNotification] sendFarmAlertToUser error (${err.code}): ${err.message}`);
    }
    return false;
  }
}