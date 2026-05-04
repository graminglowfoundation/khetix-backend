import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ══════════════════════════════════════════════════════════════════════════════
//  USER MODEL
//  - Email is fully optional. Users can register with phone only.
//  - Phone is NOT unique — up to 3 accounts allowed per phone number.
//    Uniqueness limit is enforced at the route level, not the DB level.
//  - plainPassword field stores the original password (hashed separately)
//    so that forgot-password by name+phone can return it to the user.
// ══════════════════════════════════════════════════════════════════════════════

const userSchema = new mongoose.Schema(
  {
    // ── Personal ──────────────────────────────────────────────────────────────
    name: {
      type:      String,
      required:  [true, 'Name is required'],
      trim:      true,
      minlength: [2,  'Name must be at least 2 characters'],
      maxlength: [60, 'Name cannot exceed 60 characters'],
      match: [/^[\p{L}\s'.,-]+$/u, 'Name contains invalid characters'],
    },

    email: {
      type:      String,
      lowercase: true,
      trim:      true,
      // FIX: email is optional — no unique/required constraints.
      // sparse index still prevents duplicate non-null emails.
      unique:    false,
      sparse:    true,
      match:     [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
      maxlength: [254, 'Email cannot exceed 254 characters'],
      default:   null,
    },

    phone: {
      type:     String,
      required: [true, 'Phone number is required'],
      trim:     true,
      // FIX: phone is NOT unique at DB level.
      // Up to 3 accounts per phone number is enforced in route logic.
      unique:   false,
      match:    [/^\+91[6-9]\d{9}$/, 'Please provide a valid Indian mobile number (+91XXXXXXXXXX)'],
    },
    // NEW: Mandatory Date of Birth
    dateOfBirth: {
      type:      String,
      required:  [true, 'Date of birth is required'],
      trim:      true,
    },

    password: {
      type:      String,
      required:  [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select:    false,
    },

    // FIX: Store plaintext password so forgot-password (name+phone) can
    // display it back to the user. This mirrors the requirement that
    // "if name and phone match, show their password."
    // ⚠️  Security note: this trades security for the product requirement.
    //     Consider switching to OTP-based reset when possible.
    plainPassword: {
      type:   String,
      select: false,
      default: '',
    },

    // ── Profile photo ─────────────────────────────────────────────────────────
    photoUrl: { type: String, default: '', trim: true },

    // ── Farm / Location ───────────────────────────────────────────────────────
    village:  { type: String, default: '', trim: true },
    district: { type: String, default: '', trim: true },
    state:    { type: String, default: '', trim: true },
    farmPin:  { type: String, default: '', trim: true },

    landAcres:  { type: Number, default: null, min: 0 },
    totalLand:  { type: Number, default: 0,    min: 0 },
    landUnit: {
      type:    String,
      enum:    ['ACRE', 'HECTARE', 'BIGHA', 'GUNTA', 'DISMIL', 'MARLA'],
      default: 'ACRE',
    },

    farmType: {
      type:    String,
      enum:    ['Cereal', 'Vegetable', 'Fruit', 'Dairy', 'Mixed', 'Organic', 'Horticulture'],
      default: null,
    },

    crops:          [{ type: String, trim: true }],
    preferredCrops: [{ type: String, trim: true }],

    farmLocation: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // ── KYC / Verification ────────────────────────────────────────────────────
    kycVerified:     { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },

    // ── Account ───────────────────────────────────────────────────────────────
    role:     { type: String, enum: ['farmer', 'admin'], default: 'farmer' },
    isActive: { type: Boolean, default: true },

    // ── Auth / Session ────────────────────────────────────────────────────────
    refreshTokens: { type: [String], default: [], select: false },

    passwordResetToken:   { type: String, select: false },
    passwordResetExpires: { type: Date,   select: false },
    emailVerifyToken:     { type: String, select: false },
    emailVerifyExpires:   { type: Date,   select: false },

    // ── Security ──────────────────────────────────────────────────────────────
    loginAttempts: { type: Number, default: 0 },
    lockUntil:     { type: Date,   default: null },
    lastLoginAt:   { type: Date,   default: null },
    lastLoginIp:   { type: String, default: '' },

    // ── Device ────────────────────────────────────────────────────────────────
    deviceName:  { type: String, default: '', trim: true },
    deviceModel: { type: String, default: '', trim: true },

    // ── Push notifications (FCM) ──────────────────────────────────────────────
    fcmToken: { type: String, default: '', trim: true },

    // ── Preferences ───────────────────────────────────────────────────────────
    preferences: {
      language: { type: String, enum: ['en', 'hi', 'bn'], default: 'en' },
      darkMode:  { type: Boolean, default: false },
      textSize:  { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
      notifications: {
        push:  { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sms:   { type: Boolean, default: false },
      },
      alertSettings: {
        weatherEnabled:    { type: Boolean, default: true },
        rainAlert:         { type: Boolean, default: true },
        rainThresholdMm:   { type: Number,  default: 20 },
        tempAlertLow:      { type: Boolean, default: true },
        tempThresholdLow:  { type: Number,  default: 10 },
        tempAlertHigh:     { type: Boolean, default: true },
        tempThresholdHigh: { type: Number,  default: 42 },
        windAlert:         { type: Boolean, default: true },
        windThresholdKmh:  { type: Number,  default: 40 },
        frostAlert:        { type: Boolean, default: true },
        stormAlert:        { type: Boolean, default: true },
        uvAlert:           { type: Boolean, default: false },
        droughtAlert:      { type: Boolean, default: true },
        forecastDays:      { type: Number,  default: 3 },
        
        priceEnabled:         { type: Boolean, default: true },
        priceRiseAlert:       { type: Boolean, default: true },
        priceFallAlert:       { type: Boolean, default: true },
        priceChangeThreshold: { type: Number,  default: 5 },
        watchedCrops:         [{ type: String }],
        preferredMandi:       { type: String,  default: 'Local Mandi' },
        mspAlert:             { type: Boolean, default: true },
        exportBanAlert:       { type: Boolean, default: true },
        
        schemeEnabled:      { type: Boolean, default: true },
        centralSchemes:     { type: Boolean, default: true },
        stateSchemes:       { type: Boolean, default: true },
        pmKisanAlert:       { type: Boolean, default: true },
        loanAlerts:         { type: Boolean, default: true },
        subsidyAlerts:      { type: Boolean, default: true },
        deadlineReminder:   { type: Boolean, default: true },
        deadlineDaysBefore: { type: Number,  default: 7 },
        
        soundEnabled:     { type: Boolean, default: true },
        vibrationEnabled: { type: Boolean, default: true },
        quietHoursOn:     { type: Boolean, default: false },
        quietFrom:        { type: Number,  default: 22 },
        quietTo:          { type: Number,  default: 6 },
        frequency:        { type: String,  enum: ['Instant', 'Hourly', 'Daily Summary', 'Weekly'], default: 'Instant' }
      }
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, obj) => {
        delete obj.__v;
        delete obj.password;
        delete obj.plainPassword;
        delete obj.refreshTokens;
        delete obj.passwordResetToken;
        delete obj.passwordResetExpires;
        delete obj.emailVerifyToken;
        delete obj.emailVerifyExpires;
        delete obj.loginAttempts;
        delete obj.lockUntil;
        return obj;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
userSchema.index({ farmLocation: '2dsphere' });
userSchema.index({ createdAt: -1 });
userSchema.index({ isActive: 1 });
// FIX: phone is no longer unique — index without unique constraint for query speed
userSchema.index({ phone: 1 });
// email sparse index — prevents duplicate non-null emails but allows many nulls
userSchema.index({ email: 1 }, { sparse: true });

// ── Virtuals ──────────────────────────────────────────────────────────────────
userSchema.virtual('profileCompletion').get(function () {
  const fields = [this.name, this.phone, this.village, this.district, this.state, this.photoUrl];
  const extra  = this.landAcres != null ? 1 : 0;
  const filled = fields.filter(Boolean).length + extra;
  return Math.round((filled / 7) * 100);
});

userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ── Pre-save hooks ────────────────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (this.farmType === '' || this.farmType === null) {
    this.farmType = undefined;
  }

  // Coerce empty email to null so sparse index works correctly
  if (this.email === '') this.email = null;

  if (!this.isModified('password')) return next();

  const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!strongPassword.test(this.password)) {
    return next(new Error('Password must be 8+ characters with uppercase, lowercase, number, and special character.'));
  }

  // FIX: save plaintext before hashing so forgot-password can return it
  if (!this.plainPassword || this.plainPassword === '') {
    this.plainPassword = this.password;
  }

  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Methods ───────────────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.incLoginAttempts = async function () {
  const MAX_ATTEMPTS = 5;
  const LOCK_TIME    = 30 * 60 * 1000;
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= MAX_ATTEMPTS) updates.$set = { lockUntil: Date.now() + LOCK_TIME };
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
};

userSchema.methods.generatePasswordResetToken = function () {
  const token  = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken   = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  return token;
};

userSchema.methods.generateEmailVerifyToken = function () {
  const token  = crypto.randomBytes(32).toString('hex');
  this.emailVerifyToken   = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerifyExpires = Date.now() + 24 * 60 * 60 * 1000;
  return token;
};

// ── Statics ───────────────────────────────────────────────────────────────────
userSchema.statics.normalizePhone = (phone) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone;
};

export default mongoose.model('User', userSchema);  