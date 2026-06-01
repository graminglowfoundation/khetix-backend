import cron   from 'node-cron';
import User   from '../models/User.js';
import logger from '../config/logger.js';
import { sendFarmAlertToMany } from './pushNotification.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const STORM_CODES      = new Set([95, 96, 99]);
const RETRY_DELAYS_MS  = [2000, 5000, 10000];
const CACHE_TTL_MS     = 45 * 60 * 1000;   // 45 min — safe within hourly cron
const WEATHER_CONCURRENCY = 20;             // parallel Open-Meteo fetches
const COORD_GRID        = 0.02;             // ~2.2 km grid for deduplication

// ── In-memory weather cache ───────────────────────────────────────────────────
// Key: "lat,lon" rounded to COORD_GRID.  Value: { data, fetchedAt }
const weatherCache = new Map();

function cacheKey(lat, lon) {
  const r = (v) => (Math.round(v / COORD_GRID) * COORD_GRID).toFixed(2);
  return `${r(lat)},${r(lon)}`;
}

// ── Extract exact GPS coords — NO state fallback ──────────────────────────────
// Users without saved GPS are skipped; they should enable location in the app.
function getUserCoords(user) {
  const c = user.farmLocation?.coordinates;
  if (Array.isArray(c) && c.length === 2 && (c[0] !== 0 || c[1] !== 0)) {
    return { lat: c[1], lon: c[0] };   // GeoJSON stores [lon, lat]
  }
  return null;
}

// ── Multilingual alert messages ───────────────────────────────────────────────
// Supported languages: 'en' (English), 'hi' (Hindi), 'bn' (Bengali).
// Falls back to English for any unknown/missing language code.
const ALERT_MESSAGES = {
  heavyRain: {
    en: (mm)  => ({ title: '🌧️ Heavy Rain Alert',     body: `${mm}mm of rain forecast today near your farm.` }),
    hi: (mm)  => ({ title: '🌧️ भारी बारिश की चेतावनी', body: `आज आपके खेत के पास ${mm}mm बारिश का अनुमान है।` }),
    bn: (mm)  => ({ title: '🌧️ ভারী বৃষ্টির সতর্কতা',   body: `আজ আপনার খামারের কাছে ${mm}mm বৃষ্টির পূর্বাভাস।` }),
  },
  lowTemp: {
    en: (t)   => ({ title: '🌡️ Low Temperature',       body: `Temperature will drop to ${t}°C today.` }),
    hi: (t)   => ({ title: '🌡️ कम तापमान की चेतावनी',  body: `आज तापमान ${t}°C तक गिरेगा।` }),
    bn: (t)   => ({ title: '🌡️ কম তাপমাত্রার সতর্কতা', body: `আজ তাপমাত্রা ${t}°C-এ নামবে।` }),
  },
  frost: {
    en: (t)   => ({ title: '🧊 Frost Warning',          body: `Near-freezing ${t}°C expected. Protect sensitive crops.` }),
    hi: (t)   => ({ title: '🧊 पाला पड़ने की चेतावनी',  body: `${t}°C तापमान की संभावना। संवेदनशील फसलों की रक्षा करें।` }),
    bn: (t)   => ({ title: '🧊 তুষারপাতের সতর্কতা',    body: `${t}°C তাপমাত্রা আশা করা হচ্ছে। সংবেদনশীল ফসল রক্ষা করুন।` }),
  },
  highTemp: {
    en: (t)   => ({ title: '🔆 Extreme Heat',           body: `Temperature may reach ${t}°C today. Watch for heat stress.` }),
    hi: (t)   => ({ title: '🔆 अत्यधिक गर्मी',           body: `आज तापमान ${t}°C तक पहुँच सकता है। फसलों पर नज़र रखें।` }),
    bn: (t)   => ({ title: '🔆 অতিরিক্ত গরম',           body: `আজ তাপমাত্রা ${t}°C পর্যন্ত পৌঁছাতে পারে। ফসলের প্রতি সতর্ক থাকুন।` }),
  },
  wind: {
    en: (kmh) => ({ title: '💨 Strong Wind',            body: `Wind gusts of ${kmh} km/h expected.` }),
    hi: (kmh) => ({ title: '💨 तेज़ हवा की चेतावनी',    body: `${kmh} km/h की तेज़ हवाएँ आने की संभावना है।` }),
    bn: (kmh) => ({ title: '💨 প্রবল বায়ু সতর্কতা',    body: `${kmh} km/h গতিবেগে ঝড়ো হাওয়ার পূর্বাভাস।` }),
  },
  storm: {
    en: ()    => ({ title: '⛈️ Thunderstorm Warning',   body: `Severe weather system detected near your farm.` }),
    hi: ()    => ({ title: '⛈️ तूफान की चेतावनी',       body: `आपके खेत के पास गंभीर मौसम प्रणाली का पता चला है।` }),
    bn: ()    => ({ title: '⛈️ ঝড়ের সতর্কতা',          body: `আপনার খামারের কাছে তীব্র আবহাওয়া সিস্টেম সনাক্ত হয়েছে।` }),
  },
  // ── Profile-completion reminder ────────────────────────────────────────────
  profileReminder: {
    en: ()    => ({ title: '📍 Add your farm location', body: 'Save your farm coordinates to get accurate weather alerts for your field.' }),
    hi: ()    => ({ title: '📍 अपना खेत स्थान जोड़ें',  body: 'सटीक मौसम अलर्ट पाने के लिए अपने खेत के GPS निर्देशांक सहेजें।' }),
    bn: ()    => ({ title: '📍 আপনার খামারের অবস্থান যোগ করুন', body: 'সঠিক আবহাওয়া সতর্কতার জন্য আপনার খামারের GPS স্থানাঙ্ক সংরক্ষণ করুন।' }),
  },
};

/**
 * Resolve a localised alert message.
 * @param {'heavyRain'|'lowTemp'|'frost'|'highTemp'|'wind'|'storm'|'profileReminder'} key
 * @param {'en'|'hi'|'bn'} lang
 * @param {number|undefined} value  - numeric parameter (mm, °C, km/h)
 * @returns {{ title: string, body: string }}
 */
function localise(key, lang, value) {
  const supported = ['en', 'hi', 'bn'];
  const l = supported.includes(lang) ? lang : 'en';
  return ALERT_MESSAGES[key][l](value);
}

// ── Weather fetch with retry + cache ─────────────────────────────────────────
async function fetchWeather(lat, lon) {
  const key    = cacheKey(lat, lon);
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=precipitation,temperature_2m,wind_speed_10m,weather_code` +
    `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max` +
    `&forecast_days=1&timezone=Asia%2FKolkata`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if ([429, 502, 503].includes(res.status)) throw new Error(`HTTP ${res.status} (transient)`);
      if (!res.ok) {
        logger.error(`[alertScheduler] Weather permanent error (${lat},${lon}): HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      weatherCache.set(key, { data, fetchedAt: Date.now() });
      if (attempt > 0) logger.info(`[alertScheduler] Weather recovered (${lat},${lon}) on attempt ${attempt + 1}`);
      return data;

    } catch (err) {
      if (attempt === RETRY_DELAYS_MS.length) {
        logger.error(`[alertScheduler] Weather fetch failed (${lat},${lon}) after ${attempt + 1} attempts: ${err.message}`);
        return null;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      logger.warn(`[alertScheduler] Weather attempt ${attempt + 1} failed (${lat},${lon}): ${err.message} — retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

// ── Evaluate a user's alert settings against weather data ────────────────────
// Returns alert objects with a `key` so the caller can localise them per user.
function buildAlertKeys(data, alertSettings) {
  const a     = alertSettings || {};
  const cur   = data.current  || {};
  const daily = data.daily    || {};

  const rain = (daily.precipitation_sum  || [])[0] ?? cur.precipitation  ?? 0;
  const tMax = (daily.temperature_2m_max || [])[0] ?? cur.temperature_2m ?? 25;
  const tMin = (daily.temperature_2m_min || [])[0] ?? cur.temperature_2m ?? 25;
  const wind = (daily.wind_speed_10m_max || [])[0] ?? cur.wind_speed_10m ?? 0;
  const code = cur.weather_code ?? 0;

  const alerts = [];

  if (a.rainAlert     !== false && rain >= (a.rainThresholdMm  ?? 20))
    alerts.push({ key: 'heavyRain', value: rain.toFixed(1) });
  if (a.tempAlertLow  !== false && tMin <= (a.tempThresholdLow  ?? 10))
    alerts.push({ key: 'lowTemp',   value: tMin.toFixed(1) });
  if (a.frostAlert    !== false && tMin <= 2)
    alerts.push({ key: 'frost',     value: tMin.toFixed(1) });
  if (a.tempAlertHigh !== false && tMax >= (a.tempThresholdHigh ?? 42))
    alerts.push({ key: 'highTemp',  value: tMax.toFixed(1) });
  if (a.windAlert     !== false && wind >= (a.windThresholdKmh  ?? 40))
    alerts.push({ key: 'wind',      value: wind.toFixed(0) });
  if (a.stormAlert    !== false && STORM_CODES.has(code))
    alerts.push({ key: 'storm',     value: null });

  return alerts;
}

// ── Bounded parallel executor ─────────────────────────────────────────────────
// Runs `tasks` (array of async functions) with at most `limit` in-flight at once.
async function parallelLimit(tasks, limit) {
  const results   = new Array(tasks.length);
  const executing = new Set();
  let idx = 0;

  for (const task of tasks) {
    const i = idx++;
    const p = task().then(
      (v) => { results[i] = { status: 'fulfilled', value: v };   executing.delete(p); },
      (e) => { results[i] = { status: 'rejected',  reason: e }; executing.delete(p); }
    );
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

// ── Process one coordinate cluster ───────────────────────────────────────────
async function processCluster({ lat, lon, users }) {
  const data = await fetchWeather(lat, lon);
  if (!data) return;

  logger.debug(
    `[alertScheduler] Cluster (${lat.toFixed(3)},${lon.toFixed(3)}) — ` +
    `${users.length} users — ` +
    `rain=${((data.daily?.precipitation_sum||[])[0]??0).toFixed(1)}mm ` +
    `tMax=${((data.daily?.temperature_2m_max||[])[0]??0).toFixed(1)}°C ` +
    `wind=${((data.daily?.wind_speed_10m_max||[])[0]??0).toFixed(0)}km/h`
  );

  // ── Group users by alert key + language so each unique combination gets
  //    one multicast call instead of one call per user.
  //    Structure: Map< alertKey, Map< lang, { title, body, tokens[] } > >
  const alertBuckets = new Map();

  for (const user of users) {
    const alertKeys = buildAlertKeys(data, user.preferences?.alertSettings);
    const lang      = user.preferences?.language ?? 'en';

    for (const { key, value } of alertKeys) {
      if (!alertBuckets.has(key)) alertBuckets.set(key, new Map());
      const langMap = alertBuckets.get(key);

      if (!langMap.has(lang)) {
        const { title, body } = localise(key, lang, value);
        langMap.set(lang, { title, body, tokens: [] });
      }
      langMap.get(lang).tokens.push(user.fcmToken);
    }
  }

  // Fire one multicast per alert-type × language combination
  for (const [alertKey, langMap] of alertBuckets) {
    for (const [lang, { title, body, tokens }] of langMap) {
      const { sent, failed } = await sendFarmAlertToMany(tokens, {
        title,
        body,
        alertType: 'WEATHER_ALERT',
      });
      logger.info(
        `[alertScheduler] "${title}" [${lang}] → sent:${sent} failed:${failed} | ` +
        `cluster(${lat.toFixed(3)},${lon.toFixed(3)}) ${tokens.length} users`
      );
    }
  }

  if (alertBuckets.size === 0) {
    logger.debug(`[alertScheduler] No alerts for cluster (${lat.toFixed(3)},${lon.toFixed(3)})`);
  }
}

// ── Deep-link routing for the profile-completion reminder ─────────────────────
// The Android KhetiXFcmService reads these data fields on PROFILE_REMINDER
// messages and navigates: BottomNav → Settings → Profile → FarmLocation section.
// Adjust the values here to match your actual screen/route names.
const REMINDER_NAV = {
  screen:  'ProfileScreen',        // root screen to open
  section: 'FarmLocation',         // scroll-to / highlight target within ProfileScreen
  action:  'DETECT_LOCATION',      // tell the app to open the GPS detect dialog
  tab:     'Settings',             // bottom-nav tab to activate first
};

// ── Profile-completion reminder scheduler ─────────────────────────────────────
// Runs every Sunday at 09:00 IST for users who have an FCM token
// but have not yet saved their farm GPS coordinates.
// Sends ONE gentle reminder per week — not every hour — so it never feels spammy.
async function sendProfileReminders() {
  const t0 = Date.now();
  logger.info('[alertScheduler] 📍 Weekly profile-completion reminder starting...');

  try {
    // Users who are active and have an FCM token but coordinates still at default [0, 0]
    const users = await User.find({
      isActive: true,
      fcmToken: { $exists: true, $type: 'string', $ne: '' },
      'farmLocation.coordinates.0': 0,
      'farmLocation.coordinates.1': 0,
    }).select('fcmToken preferences _id').lean();

    if (users.length === 0) {
      logger.info('[alertScheduler] 📍 No users missing GPS — all profiles complete 🎉');
      return;
    }

    logger.info(`[alertScheduler] 📍 Sending profile reminder to ${users.length} users...`);

    // ── Group by language so each language gets one multicast ────────────────
    const byLang = new Map(); // lang -> tokens[]
    for (const user of users) {
      const lang = user.preferences?.language ?? 'en';
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang).push(user.fcmToken);
    }

    let totalSent = 0, totalFailed = 0;
    for (const [lang, tokens] of byLang) {
      const { title, body } = localise('profileReminder', lang);
      const { sent, failed } = await sendFarmAlertToMany(tokens, {
        title,
        body,
        alertType: 'PROFILE_REMINDER',
        extraData: REMINDER_NAV,
      });
      totalSent   += sent;
      totalFailed += failed;
      logger.info(`[alertScheduler] 📍 Profile reminder [${lang}] → sent:${sent} failed:${failed}`);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    logger.info(
      `[alertScheduler] 📍 Profile reminder done in ${elapsed}s — ` +
      `sent:${totalSent} failed:${totalFailed} of ${users.length} users`
    );
  } catch (err) {
    logger.error(`[alertScheduler] Profile reminder cron failed: ${err.message}`);
  }
}

// ── Main scheduler ────────────────────────────────────────────────────────────
export function startAlertScheduler() {
  logger.info('[alertScheduler] Starting farm alert scheduler (exact-GPS, multicast, multilingual)...');

  // ── Hourly weather alert cron ────────────────────────────────────────────
  cron.schedule('0 */5 * * *', async () => {
    const t0 = Date.now();
    logger.info('[alertScheduler] ⏰ Hourly weather check starting...');

    try {
      // ── 1. Fetch eligible users in one DB query ──────────────────────────
      // Only users with a real FCM token AND exact GPS saved.
      // Also fetch `preferences.language` for multilingual support.
      const users = await User.find({
        isActive: true,
        fcmToken: { $exists: true, $type: 'string', $ne: '' },
        $or: [
          { 'farmLocation.coordinates.0': { $ne: 0 } },
          { 'farmLocation.coordinates.1': { $ne: 0 } },
        ],
      }).select('farmLocation preferences fcmToken _id').lean();

      // Client-side filter for push preference & weather toggle
      const eligible = users.filter(
        (u) =>
          u.preferences?.notifications?.push           !== false &&
          u.preferences?.alertSettings?.weatherEnabled !== false
      );

      if (eligible.length === 0) {
        logger.warn(
          `[alertScheduler] 0 eligible users with GPS coordinates. ` +
          `Total with FCM tokens: ${users.length}. ` +
          `(Ensure the Android app saves farmLocation on login/profile save.)`
        );
        return;
      }

      logger.info(`[alertScheduler] ${eligible.length} eligible users loaded from DB`);

      // ── 2. Group users into coordinate clusters (~2.2 km grid) ───────────
      const clusters = new Map();

      for (const user of eligible) {
        const coords = getUserCoords(user);
        if (!coords) continue;

        const key = cacheKey(coords.lat, coords.lon);
        if (!clusters.has(key)) {
          clusters.set(key, { lat: coords.lat, lon: coords.lon, users: [] });
        }
        clusters.get(key).users.push(user);
      }

      const clusterList = [...clusters.values()];
      logger.info(
        `[alertScheduler] ${clusterList.length} unique location clusters ` +
        `(~${COORD_GRID}° grid) for ${eligible.length} users`
      );

      // ── 3. Process all clusters in parallel (bounded concurrency) ────────
      await parallelLimit(
        clusterList.map((cluster) => () => processCluster(cluster)),
        WEATHER_CONCURRENCY
      );

      // ── 4. Prune expired cache entries to prevent memory growth ──────────
      const now = Date.now();
      for (const [k, v] of weatherCache) {
        if (now - v.fetchedAt > CACHE_TTL_MS) weatherCache.delete(k);
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      logger.info(
        `[alertScheduler] ✅ Done in ${elapsed}s — ` +
        `${eligible.length} users, ${clusterList.length} clusters, ` +
        `${weatherCache.size} entries cached`
      );

    } catch (err) {
      logger.error(`[alertScheduler] Cron job failed: ${err.message}`);
    }
  });

  // ── Weekly profile-completion reminder cron ──────────────────────────────
  cron.schedule('0 9 * * 0', sendProfileReminders, { timezone: 'Asia/Kolkata' });

  logger.info('[alertScheduler] ✅ Crons registered: hourly weather + Sunday 09:00 IST profile reminder');
}