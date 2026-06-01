
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import User from '../models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 1. Define both local and Render paths
const LOCAL_PATH = path.join(__dirname, '..', 'config', 'firebase-service-account.json');
const RENDER_PATH = '/etc/secrets/firebase-service-account.json';

// 2. Determine which path actually exists
let SERVICE_ACCOUNT_PATH = null;
if (existsSync(RENDER_PATH)) {
  SERVICE_ACCOUNT_PATH = RENDER_PATH; // Used when deployed on Render
} else if (existsSync(LOCAL_PATH)) {
  SERVICE_ACCOUNT_PATH = LOCAL_PATH; // Used during local development
}

// FCM multicast hard limit
const FCM_BATCH_SIZE = 500;

// ── Initialise Firebase Admin (lazy, singleton) ───────────────────────────────
let firebaseReady = false;

function initFirebase() {
  if (firebaseReady || admin.apps.length > 0) { firebaseReady = true; return; }

  if (!SERVICE_ACCOUNT_PATH) {
    console.warn(
      '[pushNotification] firebase-service-account.json not found. ' +
      'Push notifications disabled. Add the file to config/ to enable.'
    );
    return;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
    console.log('[pushNotification] Firebase Admin initialised ✅');
  } catch (err) {
    console.error('[pushNotification] Firebase init failed:', err.message);
  }
}

initFirebase();



// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Silently remove stale FCM tokens from DB in the background.
 * Never awaited — fire-and-forget so it never blocks the caller.
 */
function purgeInvalidTokens(tokens) {
  if (!tokens.length) return;
  User.updateMany(
    { fcmToken: { $in: tokens } },
    { $set: { fcmToken: '' } }
  ).catch((err) => {
    console.error(`[pushNotification] Token purge error: ${err.message}`);
  });
}

// ── Low-level: single token send ──────────────────────────────────────────────
/**
 * Send one FCM notification message (with visible notification key).
 * Used by sendPushToUser / sendPushToMany for general notifications.
 * Returns true on success, false on any failure (never throws).
 */
async function sendToToken(fcmToken, { title, body, data = {} }) {
  if (!firebaseReady || !fcmToken) return false;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
    });
    return true;
  } catch (err) {
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      purgeInvalidTokens([fcmToken]);
    }
    console.error(`[pushNotification] sendToToken failed (${err.code}): ${err.message}`);
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
    if (!user?.fcmToken)                                       return false;
    if (user.preferences?.notifications?.push === false)       return false;
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
    console.log(`[pushNotification] sendPushToMany — sent:${sent} failed:${failed}`);
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

    let batch = [];
    for await (const user of cursor) {
      batch.push(sendToToken(user.fcmToken, payload));
      if (batch.length >= FCM_BATCH_SIZE) {
        const results = await Promise.allSettled(batch);
        sent   += results.filter((r) => r.status === 'fulfilled' && r.value).length;
        failed += results.length - sent;
        batch = [];
      }
    }
    if (batch.length) {
      const results = await Promise.allSettled(batch);
      const bSent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
      sent   += bSent;
      failed += results.length - bSent;
    }

    console.log(`[pushNotification] Broadcast complete — sent:${sent} failed:${failed}`);
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
 * FCM messages with a "notification" key are shown automatically by Android
 * when the app is backgrounded — but the app's FirebaseMessagingService is
 * NOT invoked, so we cannot apply quiet-hours or category toggles.
 * DATA-ONLY always calls KhetiXFcmService.onMessageReceived() even when the
 * app is completely killed, giving the client full control.
 *
 * @param {string|ObjectId} userId
 * @param {{ title, body, alertType, _fcmToken? }} payload
 *   _fcmToken — pass the pre-fetched token to skip a DB round-trip
 */
export async function sendFarmAlertToUser(userId, { title, body, alertType = 'GENERAL', _fcmToken }) {
  if (!firebaseReady) {
    console.error(`[pushNotification] sendFarmAlertToUser: Firebase NOT ready for user ${userId}.`);
    return false;
  }

  try {
    let fcmToken = _fcmToken;

    if (!fcmToken) {
      const user = await User.findById(userId).select('fcmToken preferences');
      if (!user) {
        console.warn(`[pushNotification] sendFarmAlertToUser: User ${userId} not found.`);
        return false;
      }
      if (!user.fcmToken) {
        console.warn(`[pushNotification] sendFarmAlertToUser: User ${userId} has no FCM token.`);
        return false;
      }
      if (user.preferences?.notifications?.push === false) return false;
      fcmToken = user.fcmToken;
    }

    await admin.messaging().send({
      token: fcmToken,
      data:  { type: alertType, title: String(title), body: String(body) },
      android: { priority: 'high', ttl: 3600 * 1000 },
    });
    return true;

  } catch (err) {
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      console.warn(`[pushNotification] Token invalid for user ${userId} — clearing.`);
      User.updateOne({ _id: userId }, { $set: { fcmToken: '' } }).catch(() => {});
    } else {
      console.error(`[pushNotification] sendFarmAlertToUser error (${err.code}): ${err.message}`);
    }
    return false;
  }
}

// ── sendFarmAlertToMany (ENTERPRISE CONCURRENT VERSION) ────────────────────────
export async function sendFarmAlertToMany(tokens, { title, body, alertType = 'GENERAL', extraData = {} }) {
  if (!firebaseReady)   return { sent: 0, failed: tokens.length };
  if (!tokens.length)   return { sent: 0, failed: 0 };

  // 1. Safely coerce all extraData values to strings (FCM requirement)
  const safeExtra = Object.fromEntries(
    Object.entries(extraData).map(([k, v]) => [k, String(v)])
  );

  // 2. Define the core message payload once
  const baseMessage = {
    data: {
      type:  alertType,
      title: String(title),
      body:  String(body),
      ...safeExtra,
    },
    android: {
      priority: 'high',
      ttl:      3600 * 1000, // drop if undelivered within 1 hour
    },
  };

  // 3. Slice the tokens into chunks of 500 (Firebase Hard Limit)
  const chunks = [];
  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    chunks.push(tokens.slice(i, i + FCM_BATCH_SIZE));
  }

  let totalSent = 0;
  let totalFailed = 0;
  let allStaleTokens = [];

  // 4. BLAST OFF: Process ALL chunks simultaneously using Promise.all
  await Promise.all(chunks.map(async (tokenChunk, chunkIndex) => {
    const multicastMessage = {
      ...baseMessage,
      tokens: tokenChunk,
    };

    try {
      // sendEachForMulticast automatically routes through the modern API, bypassing the 404 error
      const response = await admin.messaging().sendEachForMulticast(multicastMessage);
      
      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Identify dead/uninstalled tokens
      if (response.failureCount > 0) {
        response.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code;
            if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
              allStaleTokens.push(tokenChunk[idx]);
            }
          }
        });
      }
    } catch (err) {
      console.error(`[pushNotification] Chunk ${chunkIndex} failed entirely (${err.code}): ${err.message}`);
      totalFailed += tokenChunk.length;
    }
  }));

  // 5. Clean up dead tokens in the background (Non-blocking)
  if (allStaleTokens.length > 0) {
    purgeInvalidTokens(allStaleTokens);
  }

  return { sent: totalSent, failed: totalFailed };
}
