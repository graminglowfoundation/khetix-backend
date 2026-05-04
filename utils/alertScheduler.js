import cron   from 'node-cron';
import User   from '../models/User.js';
import logger from '../config/logger.js';
import { sendFarmAlertToUser } from './pushNotification.js';

const STATE_COORDS = {
  'Andhra Pradesh':     { lat: 15.9129, lon: 79.7400 },
  'Arunachal Pradesh':  { lat: 27.0844, lon: 93.6053 },
  'Assam':              { lat: 26.2006, lon: 92.9376 },
  'Bihar':              { lat: 25.0961, lon: 85.3131 },
  'Chhattisgarh':       { lat: 21.2787, lon: 81.8661 },
  'Goa':                { lat: 15.2993, lon: 74.1240 },
  'Gujarat':            { lat: 22.2587, lon: 71.1924 },
  'Haryana':            { lat: 29.0588, lon: 76.0856 },
  'Himachal Pradesh':   { lat: 31.1048, lon: 77.1734 },
  'Jharkhand':          { lat: 23.6102, lon: 85.2799 },
  'Karnataka':          { lat: 15.3173, lon: 75.7139 },
  'Kerala':             { lat: 10.8505, lon: 76.2711 },
  'Madhya Pradesh':     { lat: 22.9734, lon: 78.6569 },
  'Maharashtra':        { lat: 19.7515, lon: 75.7139 },
  'Manipur':            { lat: 24.6637, lon: 93.9063 },
  'Meghalaya':          { lat: 25.4670, lon: 91.3662 },
  'Mizoram':            { lat: 23.1645, lon: 92.9376 },
  'Nagaland':           { lat: 26.1584, lon: 94.5624 },
  'Odisha':             { lat: 20.9517, lon: 85.0985 },
  'Punjab':             { lat: 31.1471, lon: 75.3412 },
  'Rajasthan':          { lat: 27.0238, lon: 74.2179 },
  'Sikkim':             { lat: 27.5330, lon: 88.5122 },
  'Tamil Nadu':         { lat: 11.1271, lon: 78.6569 },
  'Telangana':          { lat: 17.1232, lon: 79.2088 },
  'Tripura':            { lat: 23.9408, lon: 91.9882 },
  'Uttar Pradesh':      { lat: 26.8467, lon: 80.9462 },
  'Uttarakhand':        { lat: 30.0668, lon: 79.0193 },
  'West Bengal':        { lat: 22.9868, lon: 87.8550 },
  'Delhi':              { lat: 28.6139, lon: 77.2090 },
};

function getUserCoords(user) {
  const coords = user.farmLocation?.coordinates;
  if (coords && Array.isArray(coords) && coords[0] !== 0 && coords[1] !== 0) {
    return { lat: coords[1], lon: coords[0] };
  }
  if (user.state && STATE_COORDS[user.state]) return STATE_COORDS[user.state];
  return null; // Don't default to center of India, skip if no data
}

const STORM_CODES = new Set([95, 96, 99]);

// Retry delays for transient errors (502/503/429/timeout): 2s -> 5s -> 10s
const RETRY_DELAYS_MS = [2000, 5000, 10000];

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=precipitation,temperature_2m,wind_speed_10m,weather_code&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max&forecast_days=1&timezone=Asia%2FKolkata`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      // Transient server/gateway errors — worth retrying
      if (res.status === 502 || res.status === 503 || res.status === 429) {
        throw new Error(`HTTP ${res.status} (transient)`);
      }
      // Any other non-OK status is permanent — no point retrying
      if (!res.ok) {
        logger.error(`[alertScheduler] Weather fetch permanent error for (${lat},${lon}): HTTP ${res.status}`);
        return null;
      }

      if (attempt > 0) logger.info(`[alertScheduler] Weather fetch recovered for (${lat},${lon}) on attempt ${attempt + 1}`);
      return await res.json();

    } catch (err) {
      const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
      if (isLastAttempt) {
        logger.error(`[alertScheduler] Weather fetch failed for (${lat},${lon}) after ${attempt + 1} attempts: ${err.message}`);
        return null;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      logger.warn(`[alertScheduler] Weather fetch attempt ${attempt + 1} failed for (${lat},${lon}): ${err.message} — retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function checkWeatherForUser(user) {
  const a = user.preferences?.alertSettings || {};
  if (a.weatherEnabled === false) return;

  const coords = getUserCoords(user);
  if (!coords) {
    logger.debug(`[alertScheduler] Skipping user ${user._id} - No farm coordinates or state saved.`);
    return;
  }

  const data = await fetchWeather(coords.lat, coords.lon);
  if (!data) return;

  const cur = data.current || {};
  const daily = data.daily || {};

  const dailyRain = (daily.precipitation_sum || [])[0] || cur.precipitation || 0;
  const dailyTMax = (daily.temperature_2m_max || [])[0] || cur.temperature_2m || 25;
  const dailyTMin = (daily.temperature_2m_min || [])[0] || cur.temperature_2m || 25;
  const dailyWind = (daily.wind_speed_10m_max || [])[0] || cur.wind_speed_10m || 0;
  const weatherCode = cur.weather_code || 0;

  const alerts = [];

  // ── DEBUG: log actual vs threshold values so you can diagnose missed alerts ──
  logger.debug(`[alertScheduler] Weather for user ${user._id}: ` +
    `rain=${dailyRain.toFixed(1)}mm (threshold=${a.rainThresholdMm || 20}mm) | ` +
    `tempMin=${dailyTMin.toFixed(1)}°C (threshold=${a.tempThresholdLow || 10}°C) | ` +
    `tempMax=${dailyTMax.toFixed(1)}°C (threshold=${a.tempThresholdHigh || 42}°C) | ` +
    `wind=${dailyWind.toFixed(0)}km/h (threshold=${a.windThresholdKmh || 40}km/h) | ` +
    `weatherCode=${weatherCode}`
  );

  if (a.rainAlert !== false && dailyRain >= (a.rainThresholdMm || 20)) {
    alerts.push({ title: `🌧️ Heavy Rain Alert`, body: `${dailyRain.toFixed(1)}mm of rain forecast today near your farm.` });
  }
  if (a.tempAlertLow !== false && dailyTMin <= (a.tempThresholdLow || 10)) {
    alerts.push({ title: `🌡️ Low Temperature`, body: `Temperature will drop to ${dailyTMin.toFixed(1)}°C today.` });
  }
  if (a.frostAlert !== false && dailyTMin <= 2) {
    alerts.push({ title: `🧊 Frost Warning`, body: `Near-freezing ${dailyTMin.toFixed(1)}°C expected. Protect sensitive crops.` });
  }
  if (a.tempAlertHigh !== false && dailyTMax >= (a.tempThresholdHigh || 42)) {
    alerts.push({ title: `🔆 Extreme Heat`, body: `Temperature may reach ${dailyTMax.toFixed(1)}°C today. Watch for heat stress.` });
  }
  if (a.windAlert !== false && dailyWind >= (a.windThresholdKmh || 40)) {
    alerts.push({ title: `💨 Strong Wind`, body: `Wind gusts of ${dailyWind.toFixed(0)} km/h expected.` });
  }
  if (a.stormAlert !== false && STORM_CODES.has(weatherCode)) {
    alerts.push({ title: `⛈️ Thunderstorm Warning`, body: `Severe weather system detected near your farm.` });
  }

  for (const alert of alerts) {
    // Pass _fcmToken directly — we already have it from the scheduler's lean query,
    // so sendFarmAlertToUser can skip the redundant DB round-trip.
    const success = await sendFarmAlertToUser(user._id, {
      ...alert,
      alertType: 'WEATHER_ALERT',
      _fcmToken: user.fcmToken,
    });
    if (success) logger.info(`[alertScheduler] Sent to ${user._id}: ${alert.title}`);
    else logger.warn(`[alertScheduler] ❌ sendFarmAlertToUser returned false for user ${user._id}`);
  }

  if (alerts.length === 0) {
    logger.debug(`[alertScheduler] No alert conditions met for user ${user._id} — weather is within normal thresholds`);
  }
}

async function processBatched(items, fn, batchSize = 10, delayMs = 1000) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.allSettled(items.slice(i, i + batchSize).map(fn));
    if (i + batchSize < items.length) await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function startAlertScheduler() {
  logger.info('[alertScheduler] Starting farm alert scheduler...');

  cron.schedule('0 * * * *', async () => {
    logger.info('[alertScheduler] ⏰ Hourly weather check starting...');
    try {
      // Robust query: fcmToken must exist and not be empty. Preferences can be missing (we fallback to true).
      const users = await User.find({
        isActive: true,
        fcmToken: { $exists: true, $type: 'string', $ne: '' }
      }).select('farmLocation state preferences fcmToken _id').lean();

      // Filter out users who explicitly turned off notifications
      const eligibleUsers = users.filter(u => 
        u.preferences?.notifications?.push !== false && 
        u.preferences?.alertSettings?.weatherEnabled !== false
      );

      if (eligibleUsers.length === 0) {
        logger.warn(`[alertScheduler] Weather check found 0 eligible users. Total users with FCM tokens: ${users.length}. (Check if mobile app is sending FCM tokens on login!)`);
        return;
      }

      logger.info(`[alertScheduler] Checking weather for ${eligibleUsers.length} users...`);
      await processBatched(eligibleUsers, checkWeatherForUser);
      logger.info('[alertScheduler] ✅ Weather check complete');
    } catch (err) {
      logger.error(`[alertScheduler] Weather cron failed: ${err.message}`);
    }
  });
}