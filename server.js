import express from 'express';
import dotenv from 'dotenv';
import { startAlertScheduler } from './utils/alertScheduler.js';

// ⚠️ CRITICAL: Load .env BEFORE importing anything that uses process.env
dotenv.config();

import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import cluster from 'cluster';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, closeDB } from './config/db.js';
import User from './models/User.js';
import logger from './config/logger.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import fieldRoutes from './routes/fields.js';
import { sendFarmAlertToUser } from './utils/pushNotification.js';

const PORT    = process.env.PORT || 5000;
const NUM_CPUS = os.cpus().length;
const isDev   = process.env.NODE_ENV === 'development';

// ============================================
// CLUSTER: Use all CPU cores in production
// ============================================
if (!isDev && cluster.isPrimary) {
  logger.info(`Primary ${process.pid} is running — forking ${NUM_CPUS} workers`);
  for (let i = 0; i < NUM_CPUS; i++) cluster.fork();
  cluster.on('exit', (worker) => {
    logger.warn(`Worker ${worker.process.pid} died — restarting`);
    cluster.fork();
  });
} else {
  startServer();
}

// ============================================
// XSS SANITIZER
// ============================================
import xss from 'xss';

function sanitizeValue(value) {
  if (typeof value === 'string') return xss(value);
  if (Array.isArray(value))     return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeValue(v)])
    );
  }
  return value;
}

function xssSanitizer(req, _res, next) {
  if (req.body)   req.body   = sanitizeValue(req.body);
  if (req.query)  req.query  = sanitizeValue(req.query);
  if (req.params) req.params = sanitizeValue(req.params);
  next();
}

async function createApp() {
  const app = express();

  // ============================================
  // TRUST PROXY
  // ============================================
  app.set('trust proxy', 1);

  // ============================================
  // SECURITY MIDDLEWARE
  // ============================================
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        scriptSrc:  ["'self'"],
        imgSrc:     ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // ============================================
  // PERFORMANCE MIDDLEWARE
  // ============================================
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
    level: 6,
  }));

  // ============================================
  // CORS
  // ============================================
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.MOBILE_APP_URL,
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
  ].filter(Boolean);

  const isPrivateIP = (origin) => {
    if (!origin) return false;
    return /^https?:\/\/(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin);
  };

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (isDev && isPrivateIP(origin)) return cb(null, true);
      logger.warn(`CORS blocked: ${origin}`);
      cb(new Error(`CORS policy: ${origin} not allowed`));
    },
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge:         86400,
  }));

  // ============================================
  // RATE LIMITING
  // ============================================
  const globalLimiter = rateLimit({
    windowMs:       15 * 60 * 1000,
    max:            300,
    standardHeaders: true,
    legacyHeaders:  false,
    message:        { success: false, message: 'Too many requests, please try again later.' },
    skip:           (req) => req.path === '/api/health',
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max:      20,
    message:  { success: false, message: 'Too many authentication attempts. Try again in 15 minutes.' },
  });

  app.use(globalLimiter);
  app.use('/api/auth/login',    authLimiter);
  app.use('/api/auth/register', authLimiter);

  // ============================================
  // BODY PARSER & SANITIZERS
  // ============================================
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(mongoSanitize());
  app.use(xssSanitizer);
  app.use(hpp());

  // ============================================
  // STATIC FILES
  // ============================================
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // ============================================
  // REQUEST LOGGING
  // ============================================
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms    = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](`${req.method} ${req.path} ${res.statusCode} — ${ms}ms`, {
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
    });
    next();
  });

  // ============================================
  // ROUTES
  // ============================================
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/fields', fieldRoutes);

  app.get('/api/health', (req, res) => {
    res.status(200).json({
      success:   true,
      status:    'healthy',
      uptime:    `${Math.floor(process.uptime())}s`,
      pid:       process.pid,
      timestamp: new Date().toISOString(),
    });
  });

  // Root route - NOW USING ONLY .ENV
  app.get('/', (req, res) => {
    const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${PORT}`;

    res.status(200).json({
      success:      true,
      message:      '🌾 Welcome to KhetiX Agriculture App API',
      version:      '1.0.0',
      status:       'running',
      apiBaseUrl:   apiBaseUrl,
      documentation: 'See /api for all endpoints',
      health:       'Check /api/health for server status',
    });
  });

  app.get('/api', (req, res) => {
    res.status(200).json({
      success:  true,
      message:  'KhetiX Agriculture App API',
      version:  '2.0.0',
      endpoints: {
        auth: {
          register:       'POST /api/auth/register',
          login:          'POST /api/auth/login',
          logout:         'POST /api/auth/logout',
          logoutAll:      'POST /api/auth/logout-all',
          me:             'GET  /api/auth/me',
          refresh:        'POST /api/auth/refresh-token',
          forgotPassword: 'POST /api/auth/forgot-password',
          resetPassword:  'POST /api/auth/reset-password/:token',
        },
        user: {
          getProfile:     'GET    /api/user/profile',
          updateProfile:  'PUT    /api/user/profile',
          getStats:       'GET    /api/user/stats',
          farmSettings:   'PUT    /api/user/farm-settings',
          changePassword: 'POST   /api/user/change-password',
          uploadPhoto:    'POST   /api/user/photo',
          fcmToken:       'PATCH  /api/user/fcm-token',
          alertSettings:  'GET    /api/user/alert-settings',
          updateAlerts:   'PUT    /api/user/alert-settings',
          deleteAccount:  'DELETE /api/user/account',
          activityLog:    'GET    /api/user/activity',
          cropHistory:    'GET    /api/user/crop-history',
          addCrop:        'POST   /api/user/crop-history',
          updateCrop:     'PUT    /api/user/crop-history/:id',
        },
      },
    });
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found', path: req.path });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    logger.error('🔴 Unhandled error:', {
      message: err.message,
      code:    err.code,
      status:  err.status,
      path:    req.path,
    });

    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: 'Validation failed', errors: messages });
    }

    if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || 'unknown field';
      const value = err.keyValue?.[field];

      if (value === null || value === undefined) {
        logger.error(`❌ E11000 null duplicate on field: ${field}`);
        return res.status(500).json({
          success: false,
          message: 'Database integrity issue detected. Please contact support.',
          code:    'DATABASE_ERROR',
          ...(isDev && { details: `Null duplicate on ${field}` }),
        });
      }

      const fieldNames = { email: 'Email address', phone: 'Phone number', username: 'Username' };
      return res.status(409).json({
        success: false,
        message: `${fieldNames[field] || field} is already in use.`,
        code:    'DUPLICATE_ENTRY',
        field,
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid authentication token.', code: 'INVALID_TOKEN' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Authentication token has expired.', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'CastError') {
      // FIX: Give a descriptive error when a non-ObjectId string (e.g. an Android UUID)
      // is passed in a MongoDB ID field. The field routes now guard against this before
      // the DB call, but this global handler catches any stragglers.
      return res.status(400).json({
        success: false,
        message: `Invalid value for field '${err.path}': "${err.value}" is not a valid MongoDB ObjectId.`,
        code:    'INVALID_ID',
      });
    }

    const statusCode = err.status || 500;
    const message    = isDev
      ? err.message
      : statusCode === 500
        ? 'Internal server error. Please try again later.'
        : err.message;

    res.status(statusCode).json({
      success: false,
      message,
      ...(isDev && { stack: err.stack }),
    });
  });

  return app;
}

// ============================================
// SERVER STARTUP
// ============================================
async function startServer() {
  try {
    await connectDB();
    await User.syncIndexes();

    // ── Start weather alert cron (requires: npm install node-cron) ────────────
    // Runs every hour, calls Open-Meteo for each user's farm location, and
    // sends FCM push notifications when rain/temp/wind thresholds are exceeded.
    startAlertScheduler();

    const app = await createApp();

    const server = app.listen(PORT, '0.0.0.0', () => {
      // NOW USING ONLY .ENV 
      const mobileAppUrl = process.env.API_BASE_URL || `http://localhost:${PORT}`;

      logger.info(`
╔════════════════════════════════════════════╗
║  🌾  KhetiX Agriculture API  v2.0          ║
║  ✅  Status  : Running                     ║
║  🔌  Port    : ${String(PORT).padEnd(29)}║
║  ⚙️   Env     : ${(process.env.NODE_ENV || 'development').padEnd(29)}║
║  🧠  PID     : ${String(process.pid).padEnd(29)}║
║  📡  DB      : Connected                   ║
║                                            ║
║  📱 APP URL (From .env):                   ║
║     ${mobileAppUrl.padEnd(39)}║
║                                            ║
║  💻 WEB/LOCAL URL:                         ║
║     http://localhost:${String(PORT).padEnd(24)}║
╚════════════════════════════════════════════╝`);
    });

    server.keepAliveTimeout = 65_000;
    server.headersTimeout   = 66_000;

    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await closeDB();
        logger.info('HTTP server closed — process exiting');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 30_000);
    };

    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException',  (err) => { logger.error('Uncaught Exception:', err);  process.exit(1); });
    process.on('unhandledRejection', (err) => { logger.error('Unhandled Rejection:', err); });

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

export default createApp;