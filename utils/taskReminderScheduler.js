/**
 * utils/taskReminderScheduler.js
 *
 * Sends FCM push notifications for pending farm tasks (done: false).
 *
 * TWO DAILY REMINDERS (both fire at 08:00 IST):
 *  1. Due-TODAY  — tasks whose dueDate equals today's date.
 *  2. Due-TOMORROW — tasks whose dueDate equals tomorrow's date (advance notice).
 *
 * HOW dueDate IS STORED:
 *  The Task model stores dueDate as a string in "DD/MM/YYYY" format,
 *  e.g. "01/06/2026" (matching the Android date-picker output).
 *  All date comparisons are done in IST (Asia/Kolkata, UTC+5:30).
 *
 * MULTILINGUAL:
 *  Notifications are sent in the user's preferred language
 *  (preferences.language: 'en' | 'hi' | 'bn', default 'en').
 *  Users sharing the same language get one FCM multicast call.
 *
 * DEEP-LINK:
 *  The FCM data payload includes `screen: 'TasksScreen'` and `tab: 'Tasks'`
 *  so the Android KhetiXFcmService can navigate directly to the task list.
 *
 * WIRING (server.js):
 *  import { startTaskReminderScheduler } from './utils/taskReminderScheduler.js';
 *  startTaskReminderScheduler();   // call once inside startServer()
 */

import cron   from 'node-cron';
import Task   from '../models/Task.js';
import User   from '../models/User.js';
import logger from '../config/logger.js';
import { sendFarmAlertToMany } from './pushNotification.js';

// ── IST helpers ───────────────────────────────────────────────────────────────
// node-cron runs the job in IST (timezone option), so new Date() inside the
// callback is UTC. We convert explicitly to avoid any DST-related drift.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/**
 * Returns today's and tomorrow's date strings in "DD/MM/YYYY" format (IST).
 */
function getISTDateStrings() {
  const nowIST      = new Date(Date.now() + IST_OFFSET_MS);
  const tomorrowIST = new Date(nowIST.getTime() + 24 * 60 * 60 * 1000);

  const fmt = (d) => {
    const dd   = String(d.getUTCDate()).padStart(2, '0');
    const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  return { today: fmt(nowIST), tomorrow: fmt(tomorrowIST) };
}

// ── Multilingual task reminder messages ───────────────────────────────────────
const TASK_MESSAGES = {

  // ── Due TODAY ──────────────────────────────────────────────────────────────
  dueToday: {
    en: (title, fieldName) => ({
      title: '📋 Task Due Today',
      body:  fieldName
        ? `"${title}" is due today on field "${fieldName}". Don't forget to complete it!`
        : `"${title}" is due today. Don't forget to complete it!`,
    }),
    hi: (title, fieldName) => ({
      title: '📋 आज का कार्य',
      body:  fieldName
        ? `"${title}" आज "${fieldName}" खेत में करना है। इसे पूरा करना न भूलें!`
        : `"${title}" आज करना है। इसे पूरा करना न भूलें!`,
    }),
    bn: (title, fieldName) => ({
      title: '📋 আজকের কাজ',
      body:  fieldName
        ? `"${title}" আজ "${fieldName}" জমিতে করতে হবে। ভুলবেন না!`
        : `"${title}" আজ করতে হবে। ভুলবেন না!`,
    }),
  },

  // ── Due TOMORROW ───────────────────────────────────────────────────────────
  dueTomorrow: {
    en: (title, fieldName) => ({
      title: '⏰ Task Due Tomorrow',
      body:  fieldName
        ? `Reminder: "${title}" on field "${fieldName}" is due tomorrow. Plan ahead!`
        : `Reminder: "${title}" is due tomorrow. Plan ahead!`,
    }),
    hi: (title, fieldName) => ({
      title: '⏰ कल का कार्य',
      body:  fieldName
        ? `याद दिलाएं: "${title}" "${fieldName}" खेत में कल करना है। अभी से तैयारी करें!`
        : `याद दिलाएं: "${title}" कल करना है। अभी से तैयारी करें!`,
    }),
    bn: (title, fieldName) => ({
      title: '⏰ আগামীকালের কাজ',
      body:  fieldName
        ? `মনে রাখবেন: "${title}" "${fieldName}" জমিতে আগামীকাল করতে হবে। এখনই প্রস্তুত হন!`
        : `মনে রাখবেন: "${title}" আগামীকাল করতে হবে। এখনই প্রস্তুত হন!`,
    }),
  },

  // ── Multiple tasks (summary) — fires when a user has >1 pending task ───────
  dueTodayMany: {
    en: (count) => ({
      title: '📋 Tasks Due Today',
      body:  `You have ${count} farm tasks due today. Open the app to review them.`,
    }),
    hi: (count) => ({
      title: '📋 आज के कार्य',
      body:  `आज ${count} खेती के काम बाकी हैं। उन्हें देखने के लिए ऐप खोलें।`,
    }),
    bn: (count) => ({
      title: '📋 আজকের কাজসমূহ',
      body:  `আজ ${count}টি খামারের কাজ বাকি আছে। দেখতে অ্যাপ খুলুন।`,
    }),
  },

  dueTomorrowMany: {
    en: (count) => ({
      title: '⏰ Tasks Due Tomorrow',
      body:  `You have ${count} farm tasks due tomorrow. Plan your day early!`,
    }),
    hi: (count) => ({
      title: '⏰ कल के कार्य',
      body:  `कल ${count} खेती के काम करने हैं। समय पर तैयार रहें!`,
    }),
    bn: (count) => ({
      title: '⏰ আগামীকালের কাজসমূহ',
      body:  `আগামীকাল ${count}টি খামারের কাজ আছে। সময়মতো প্রস্তুত হন!`,
    }),
  },
};

// ── Deep-link nav data for task notifications ─────────────────────────────────
// KhetiXFcmService reads these fields and navigates to the Tasks screen.
const TASK_NAV = {
  screen: 'TasksScreen',   // root screen to open
  tab:    'Tasks',          // bottom-nav tab to activate
};

// ── Resolve localised message ─────────────────────────────────────────────────
const SUPPORTED_LANGS = new Set(['en', 'hi', 'bn']);

function taskLocalise(key, lang, ...args) {
  const l = SUPPORTED_LANGS.has(lang) ? lang : 'en';
  return TASK_MESSAGES[key][l](...args);
}

// ── Core: send reminders for a given due-date string ─────────────────────────
/**
 * @param {'dueToday'|'dueTomorrow'} reminderType
 * @param {string} dueDateStr  e.g. "01/06/2026"
 */
async function sendRemindersForDate(reminderType, dueDateStr) {
  const manyKey = reminderType === 'dueToday' ? 'dueTodayMany' : 'dueTomorrowMany';

  // ── 1. Find all pending tasks for this due-date ───────────────────────────
  const tasks = await Task.find({
    done:    false,
    dueDate: dueDateStr,
  }).select('userId fieldName title taskType').lean();

  if (tasks.length === 0) {
    logger.info(`[taskReminder] No pending tasks for dueDate=${dueDateStr} (${reminderType})`);
    return;
  }

  logger.info(
    `[taskReminder] ${tasks.length} pending task(s) found for dueDate=${dueDateStr} (${reminderType})`
  );

  // ── 2. Group tasks by userId ──────────────────────────────────────────────
  // One user may have multiple pending tasks on the same day.
  const byUser = new Map(); // userId (string) -> Task[]
  for (const task of tasks) {
    const uid = String(task.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(task);
  }

  // ── 3. Fetch FCM tokens + language preference for all affected users ───────
  const userIds = [...byUser.keys()];
  const users   = await User.find({
    _id:      { $in: userIds },
    isActive: true,
    fcmToken: { $exists: true, $type: 'string', $ne: '' },
    'preferences.notifications.push': { $ne: false },
  }).select('fcmToken preferences _id').lean();

  if (users.length === 0) {
    logger.info(`[taskReminder] No eligible users with FCM tokens for ${reminderType}`);
    return;
  }

  // ── 4. Build per-user notification payload, group by language ────────────
  // Structure: Map< lang, Map< payloadKey, { title, body, tokens[] } > >
  // payloadKey = `${lang}::${title}` so identical messages are multicast together.
  const langBuckets = new Map(); // lang -> Map< title, { title, body, tokens[] } >

  for (const user of users) {
    const lang      = user.preferences?.language ?? 'en';
    const uid       = String(user._id);
    const userTasks = byUser.get(uid) ?? [];
    if (userTasks.length === 0) continue;

    // Pick the right message variant
    let msg;
    if (userTasks.length === 1) {
      const t = userTasks[0];
      msg = taskLocalise(reminderType, lang, t.title || t.taskType, t.fieldName || '');
    } else {
      msg = taskLocalise(manyKey, lang, userTasks.length);
    }

    if (!langBuckets.has(lang)) langBuckets.set(lang, new Map());
    const titleMap = langBuckets.get(lang);

    if (!titleMap.has(msg.title)) {
      titleMap.set(msg.title, { title: msg.title, body: msg.body, tokens: [] });
    }
    titleMap.get(msg.title).tokens.push(user.fcmToken);
  }

  // ── 5. Send one multicast per language × title combination ───────────────
  let totalSent = 0, totalFailed = 0;

  for (const [lang, titleMap] of langBuckets) {
    for (const { title, body, tokens } of titleMap.values()) {
      const { sent, failed } = await sendFarmAlertToMany(tokens, {
        title,
        body,
        alertType: 'TASK_REMINDER',
        extraData: TASK_NAV,
      });
      totalSent   += sent;
      totalFailed += failed;
      logger.info(
        `[taskReminder] "${title}" [${lang}] → sent:${sent} failed:${failed} | ` +
        `${tokens.length} user(s) | ${reminderType} dueDate=${dueDateStr}`
      );
    }
  }

  logger.info(
    `[taskReminder] ${reminderType} complete — ` +
    `sent:${totalSent} failed:${totalFailed} | ` +
    `${tasks.length} task(s), ${users.length} user(s)`
  );
}

// ── Main job ──────────────────────────────────────────────────────────────────
async function runTaskReminders() {
  const t0 = Date.now();
  logger.info('[taskReminder] ⏰ Daily task reminder check starting...');

  try {
    const { today, tomorrow } = getISTDateStrings();
    logger.info(`[taskReminder] Checking tasks for today=${today} | tomorrow=${tomorrow}`);

    // Run both reminder types concurrently — they touch different task sets
    await Promise.all([
      sendRemindersForDate('dueToday',   today),
      sendRemindersForDate('dueTomorrow', tomorrow),
    ]);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    logger.info(`[taskReminder] ✅ Done in ${elapsed}s`);

  } catch (err) {
    logger.error(`[taskReminder] Daily task reminder cron failed: ${err.message}`);
  }
}

// ── Scheduler entry point ─────────────────────────────────────────────────────
/**
 * Call once inside startServer() in server.js:
 *
 *   import { startTaskReminderScheduler } from './utils/taskReminderScheduler.js';
 *   startTaskReminderScheduler();
 */
export function startTaskReminderScheduler() {
  logger.info('[taskReminder] Registering daily task reminder cron (08:00 IST)...');

  // Every day at 08:00 IST — covers both due-today and due-tomorrow checks.
  cron.schedule('0 7,19 * * *', runTaskReminders, { timezone: 'Asia/Kolkata' });

  logger.info('[taskReminder] ✅ Cron registered: daily task reminder at 08:00 IST');
}