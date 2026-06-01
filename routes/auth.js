import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import logger from '../config/logger.js';
import { protect } from '../middleware/auth1.js';
import { validate, schemas } from '../middleware/validate.js';
import { logActivity } from '../utils/activityLogger.js';

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
const signAccess  = (id) => jwt.sign({ id }, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_EXPIRES_IN         || '15m' });
const signRefresh = (id) => jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });

const sendTokens = async (res, user, statusCode = 200) => {
  const access  = signAccess(user._id);
  const refresh = signRefresh(user._id);

  user.refreshTokens.push(refresh);
  if (user.refreshTokens.length > 5) user.refreshTokens.shift();
  await user.save({ validateBeforeSave: false });

  res.status(statusCode).json({
    success:      true,
    accessToken:  access,
    refreshToken: refresh,
    expiresIn:    15 * 60,
    user:         user.toJSON(),
  });
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
// FIX: Email is optional. Same phone number can have up to 3 accounts.
//      Account is uniquely identified by name + phone combination.
router.post('/register', validate(schemas.register), async (req, res, next) => {
  try {
    let {name, email, phone, password, confirmPassword, deviceName, deviceModel, dateOfBirth, dob } = req.body;
    phone = User.normalizePhone(phone);

    // Check if email is already taken (only when email is provided)
    if (email && email !== '') {
      const dupEmail = await User.findOne({ email }).select('_id');
      if (dupEmail) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered.',
          code:    'EMAIL_EXISTS',
        });
      }
    }

    // FIX: Allow up to 3 accounts with the same phone number.
    // A duplicate is only blocked when name AND phone both match exactly.
    const samePhoneAccounts = await User.find({ phone }).select('name').lean();
    const finalDob = dateOfBirth || dob;

    if (samePhoneAccounts.length >= 3) {
      return res.status(409).json({
        success: false,
        message: 'Maximum 3 accounts are allowed per phone number.',
        code:    'PHONE_ACCOUNT_LIMIT',
      });
    }

    // Prevent exact duplicate: same name + same phone
    const exactDup = samePhoneAccounts.find(
      (u) => u.name.toLowerCase().trim() === name.toLowerCase().trim()
    );
    if (exactDup) {
      return res.status(409).json({
        success: false,
        message: 'An account with this name and phone number already exists.',
        code:    'DUPLICATE_ACCOUNT',
      });
    }

    // Validate confirmPassword before creating user
    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match.',
        code:    'PASSWORD_MISMATCH',
      });
    }

    // Normalise email: coerce empty string to null so sparse index works
    const finalEmail  = (email && email.trim() !== '') ? email.toLowerCase().trim() : null;
    // phone was already normalised above
    const targetPhone = phone;

    const user = await User.create({
      name,
      email: finalEmail,
      phone: targetPhone,
      password,
      plainPassword: password,
      dateOfBirth: finalDob, 
    });

    await logActivity(user._id, 'LOGIN', { description: 'Account created' });

    const userWithTokens = await User.findById(user._id).select('+refreshTokens');
    await sendTokens(res, userWithTokens, 201);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// FIX: Login now uses phone number + password (not email).
//      If multiple accounts share the phone, tries each until password matches.
router.post('/login', validate(schemas.login), async (req, res, next) => {
  try {
    const { phone: rawPhone, password, deviceName, deviceModel } = req.body;
    const phone = User.normalizePhone(rawPhone);

    // Fetch all accounts with this phone number
    const users = await User.find({ phone })
      .select('+password +loginAttempts +lockUntil +refreshTokens');

    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid mobile number or password.',
      });
    }

    // Try to match password against each account sharing this phone
    let matchedUser = null;
    for (const candidate of users) {
      if (!candidate.isActive) continue;
      if (candidate.isLocked)  continue;
      const isMatch = await candidate.comparePassword(password);
      if (isMatch) { matchedUser = candidate; break; }
    }

    if (!matchedUser) {
      // Increment attempts on the first non-locked account with this phone
      const attemptTarget = users.find((u) => u.isActive && !u.isLocked);
      if (attemptTarget) {
        await attemptTarget.incLoginAttempts();
        const remaining = Math.max(0, 5 - (attemptTarget.loginAttempts + 1));
        return res.status(401).json({
          success: false,
          message: remaining > 0
            ? `Invalid credentials. ${remaining} attempt(s) remaining.`
            : 'Account locked. Try again in 30 minutes.',
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid mobile number or password.' });
    }

    if (!matchedUser.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }
    if (matchedUser.isLocked) {
      return res.status(423).json({ success: false, message: 'Account locked. Try again in 30 minutes.' });
    }

    await matchedUser.resetLoginAttempts();
    matchedUser.lastLoginAt = new Date();
    matchedUser.lastLoginIp = req.ip;
    if (deviceName)  matchedUser.deviceName  = deviceName;
    if (deviceModel) matchedUser.deviceModel = deviceModel;

    await logActivity(matchedUser._id, 'LOGIN', {
      description: 'User logged in',
      deviceInfo: { deviceName, deviceModel, ipAddress: req.ip },
    });

    await sendTokens(res, matchedUser);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
// FIX: Replaced email-based forgot-password with name + phone lookup.
//      If both name and phone match an account, the stored plaintext password
//      is returned so the user can copy it.
router.post('/forgot-password', validate(schemas.forgotPassword), async (req, res, next) => {
  try {
    const { name, phone: rawPhone, dateOfBirth } = req.body;
    const phone = User.normalizePhone(rawPhone);

    // 1. Look up accounts by phone, explicitly requesting plainPassword AND dateOfBirth
    const accounts = await User.find({ phone })
      .select('+plainPassword dateOfBirth name isActive')
      .lean();

    // 2. Match BOTH the Name AND the Date of Birth
    const matched = accounts.find(
      (u) => 
        u.name.toLowerCase().trim() === name.toLowerCase().trim() &&
        u.dateOfBirth === dateOfBirth.trim() // <-- CRITICAL: Added DOB validation here
    );

    if (!matched) {
      // Generic message to avoid leaking account existence
      return res.status(404).json({
        success: false,
        message: 'No account found matching that name, mobile number, and date of birth.',
      });
    }

    if (!matched.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated.',
      });
    }

    // Return the plain password so the user can see and copy it
    return res.status(200).json({
      success:       true,
      message:       'Account found. Here is your password.',
      accountName:   matched.name,
      password:      matched.plainPassword || '(Password not recoverable — please contact support)',
    });
  } catch (err) {
    next(err);
  }
});
// ── POST /api/auth/refresh-token ──────────────────────────────────────────────
router.post('/refresh-token', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token required.' });

    let payload;
    try { payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET); }
    catch { return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' }); }

    const user = await User.findById(payload.id).select('+refreshTokens');
    if (!user || !user.refreshTokens.includes(refreshToken)) {
      if (user) { user.refreshTokens = []; await user.save({ validateBeforeSave: false }); }
      return res.status(401).json({ success: false, message: 'Token reuse detected. Please log in again.' });
    }

    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    await sendTokens(res, user);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const user = await User.findById(req.user.id).select('+refreshTokens');
    if (user && refreshToken) {
      user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
      await user.save({ validateBeforeSave: false });
    }
    await logActivity(req.user.id, 'LOGOUT');
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout-all ─────────────────────────────────────────────────
router.post('/logout-all', protect, async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { refreshTokens: [] });
    await logActivity(req.user.id, 'LOGOUT', { description: 'Logged out from all devices' });
    res.json({ success: true, message: 'Logged out from all devices.' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/reset-password/:token ─────────────────────────────────────
// Kept for admin/email-based flows if needed in future
router.post('/reset-password/:token', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'New password is required.' });

    const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user   = await User.findOne({
      passwordResetToken:   hashed,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+password +refreshTokens');

    if (!user) return res.status(400).json({ success: false, message: 'Token is invalid or has expired.' });

    user.password             = password;
    user.plainPassword        = password; // keep in sync
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    user.refreshTokens        = [];
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. Please log in again.' });
  } catch (err) {
    next(err);
  }
});

export default router;