import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

// ── Validate required environment variables ────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  logger.error('❌ MONGO_URI not found in .env file!');
  logger.error('📝 Please add this to your .env file:');
  logger.error('   MONGO_URI=mongodb+srv://username:password@cluster0.mongodb.net/dbname');
  process.exit(1);
}

mongoose.set('debug',          false);
mongoose.set('bufferCommands', false); // fail immediately on connection loss

// ── MongoDB connection options ─────────────────────────────────────────────
const mongooseOptions = {
  maxPoolSize:              20,
  minPoolSize:              5,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS:          60_000,
  connectTimeoutMS:         15_000,
  heartbeatFrequencyMS:     30_000,
  retryWrites:              true,
  w:                        'majority',
  journal:                  true,
  family:                   4,
  compressors:              ['snappy', 'zlib'],
  directConnection:         false,
};

// ── Connection event listeners — attached ONCE at module level ─────────────
// FIX: Previously these listeners were added inside connectDB(). Since
// connectDB() is called recursively on each retry, every failed attempt
// stacked another 'disconnected' listener — each one would independently
// spawn its own reconnect chain on the next disconnect, causing a cascade
// of parallel reconnection loops. Moving them here ensures they fire once.
let listenersAttached = false;

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('disconnected', () => {
    logger.warn('⚠️  MongoDB disconnected — attempting reconnect...');
    reconnect();
  });

  // FIX: Was `logger.error('❌ MongoDB connection error:', err.message)`.
  // Winston's printf formatter only reads `info.message` — the second argument
  // is treated as metadata and is NEVER printed by the current format.
  // This caused every MongoDB error to appear in the log as:
  //   "❌ MongoDB connection error:"   ← no actual error reason shown
  // making it impossible to diagnose connection failures.
  // Fix: use a template literal so the reason is part of the message string.
  mongoose.connection.on('error', (err) => {
    logger.error(`❌ MongoDB connection error: ${err?.message || String(err)}`);
  });
}

// ── Connect ────────────────────────────────────────────────────────────────
let retryCount = 0;
const MAX_RETRIES = 5;

export async function connectDB() {
  try {
    logger.info('📡 Connecting to MongoDB Atlas...');
    logger.debug(`   Cluster: ${MONGO_URI.split('@')[1]?.split('/')[0]}`);

    const conn = await mongoose.connect(MONGO_URI, mongooseOptions);

    retryCount = 0; // reset on success
    attachConnectionListeners();

    logger.info('✅ MongoDB Successfully Connected!');
    logger.info(`   Host:             ${conn.connection.host}`);
    logger.info(`   Database:         ${conn.connection.name}`);
    logger.info(`   Connection State: ${conn.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED'}`);

    return conn;

  } catch (err) {
    retryCount++;

    // Parse specific MongoDB errors for clearer messages
    let reason = err.message;
    if (err.message.includes('ENOTFOUND'))             reason = 'DNS resolution failed — cluster not found or no internet';
    else if (err.message.includes('ECONNREFUSED'))     reason = 'Connection refused — cluster may be paused or firewall blocking';
    else if (err.message.includes('authentication'))   reason = 'Authentication failed — check username and password';
    else if (err.message.includes('unauthorized'))     reason = 'Not authorized — check Database Access in MongoDB Atlas';
    else if (err.message.includes('IP'))               reason = 'IP not whitelisted — add your server IP in Atlas → Security → Network Access';

    logger.error(`❌ MongoDB connection failed (attempt ${retryCount}/${MAX_RETRIES}): ${reason}`);

    if (retryCount <= MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30_000);
      logger.info(`⏳ Retrying in ${(delay / 1000).toFixed(1)}s...`);
      await new Promise((r) => setTimeout(r, delay));
      return connectDB();
    }

    logger.error('❌ MongoDB connection failed after ' + MAX_RETRIES + ' retries. Troubleshooting:');
    logger.error('   1. Check MONGO_URI has /databasename (e.g., /khetix)');
    logger.error('   2. Whitelist your IP: Atlas → Security → Network Access');
    logger.error('   3. Verify database "khetix" exists in Atlas');
    logger.error('   4. Verify credentials are correct');
    logger.error('   5. Check internet connection');
    throw new Error('MongoDB connection failed permanently');
  }
}

async function reconnect() {
  try {
    await mongoose.connect(MONGO_URI, mongooseOptions);
    logger.info('✅ MongoDB reconnected successfully');
  } catch (err) {
    // FIX: Same Winston printf issue as above — was `logger.error('...:', err.message)`
    // which printed an empty line. Now uses template literal so you can see WHY it failed.
    logger.error(`❌ Reconnection failed: ${err?.message || String(err)}`);
    setTimeout(reconnect, 5_000);
  }
}

export async function closeDB() {
  try {
    await mongoose.connection.close();
    logger.info('✅ MongoDB connection closed');
  } catch (err) {
    logger.error(`❌ Error closing MongoDB connection: ${err?.message || String(err)}`);
  }
}

export function getDB() {
  return mongoose.connection;
}