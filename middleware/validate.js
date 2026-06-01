import Joi from 'joi';

// ── Reusable field definitions ─────────────────────────────────────────────────
const name = Joi.string().min(2).max(60).trim().required().messages({
  'string.min': 'Name must be at least 2 characters.',
  'string.max': 'Name cannot exceed 60 characters.',
  'any.required': 'Name is required.',
});

const email = Joi.string().email({ tlds: { allow: false } }).lowercase().trim().messages({
  'string.email': 'Please provide a valid email address.',
});

const phone = Joi.string()
  .pattern(/^(\+91[\s-]?)?[6-9]\d{9}$/)
  .required()
  .messages({
    'string.pattern.base': 'Please provide a valid Indian mobile number (10 digits, starting with 6–9).',
    'any.required': 'Phone number is required.',
  });

const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
  .required()
  .messages({
    'string.min': 'Password must be at least 8 characters.',
    'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character (@$!%*?&).',
    'any.required': 'Password is required.',
  });

// ── Schemas ────────────────────────────────────────────────────────────────────
export const schemas = {
  // FIX: email is now fully optional — users can register with phone only.
  // Same phone number can have up to 3 accounts (enforced in route logic).
  register: Joi.object({
    name,
    email: email.optional().allow('', null),
    phone,
    password,
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
      'any.only': 'Passwords do not match.',
      'any.required': 'Please confirm your password.'
    }),
    dateOfBirth: Joi.string().optional(),
    dob: Joi.string().optional(),
  }).xor('dateOfBirth', 'dob').messages({
    'object.missing': 'Date of birth is required.'
  }),


  // FIX: Login now uses phone + password (not email).
  // deviceName and deviceModel retained for security tracking.
  login: Joi.object({
    phone: Joi.string().required().messages({ 'any.required': 'Phone number is required.' }),
    password: Joi.string().required(),
    deviceName: Joi.string().max(100).trim().allow('').optional(),
    deviceModel: Joi.string().max(100).trim().allow('').optional(),
  }),

  // FIX: Forgot password uses name + phone to retrieve account.
  // Returns the plaintext password only if both name and phone match.
  forgotPassword: Joi.object({
    name: Joi.string().min(2).max(60).trim().required().messages({ 'any.required': 'Name is required.' }),
    phone: Joi.string().required().messages({ 'any.required': 'Phone number is required.' }),
    dateOfBirth: Joi.string().required().messages({ 'any.required': 'Date of birth is required.' }),
  }),

  updateProfile: Joi.object({
    name: Joi.string().min(2).max(60).trim().optional().allow(''),
    email: Joi.string().email({ tlds: { allow: false } }).lowercase().trim().optional().allow('', '', null).messages({
      'string.email': 'Please provide a valid email address.',
    }),
    phone: Joi.string()
      .pattern(/^(\+91[\s-]?)?[6-9]\d{9}$/)
      .optional()
      .messages({ 'string.pattern.base': 'Please provide a valid Indian mobile number.' }),
    village: Joi.string().max(100).trim().allow('', null).optional(),
    district: Joi.string().max(100).trim().allow('', null).optional(),
    state: Joi.string().max(100).trim().allow('', null).optional(),
    latitude: Joi.number().min(-90).max(90).optional().allow(null),
    longitude: Joi.number().min(-180).max(180).optional().allow(null),
    landAcres: Joi.number().min(0).max(9999).allow(null).optional(),
    farmType: Joi.string()
      .valid('Cereal', 'Vegetable', 'Fruit', 'Dairy', 'Mixed', 'Organic', 'Horticulture')
      .allow('', null)
      .optional(),
    crops: Joi.array().items(Joi.string().max(50)).max(20).optional(),
    farmLocation: Joi.object({
      type: Joi.string().valid('Point').required(),
      coordinates: Joi.array().items(Joi.number()).length(2).required(),
    }).optional(),
    preferences: Joi.object({
      language: Joi.string().valid('en', 'hi', 'bn').optional(),
      darkMode: Joi.boolean().optional(),
      textSize: Joi.string().valid('small', 'medium', 'large').optional(),
      notifications: Joi.object({
        push: Joi.boolean().optional(),
        email: Joi.boolean().optional(),
        sms: Joi.boolean().optional(),
      }).optional(),
    }).optional().allow(null),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required().messages({ 'any.required': 'Current password is required.' }),
    newPassword: password,
    confirmPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({ 'any.only': 'Passwords do not match.' }),
  }),

  deleteAccount: Joi.object({
    password: Joi.string().required(),
  }),

  createField: Joi.object({
    name: Joi.string().min(2).max(80).trim().required().messages({
      'any.required': 'Field name is required.',
      'string.min': 'Field name must be at least 2 characters.',
    }),
    areaAcre: Joi.number().min(0.01).max(99999).required().messages({
      'any.required': 'Field area is required.',
      'number.min': 'Area must be greater than 0.',
    }),
    soilType: Joi.string().valid('Alluvial', 'Black', 'Red Laterite', 'Sandy Loam', 'Clay Loam', 'Loamy').required().messages({
      'any.required': 'Soil type is required.',
      'any.only': 'Invalid soil type. Choose from: Alluvial, Black, Red Laterite, Sandy Loam, Clay Loam, Loamy.',
    }),
    activeCrop: Joi.string().required(),
    location: Joi.object({
      state: Joi.string().min(2).max(60).trim().required().messages({
        'any.required': 'State is required.',
        'string.min': 'State name too short.',
      }),
      district: Joi.string().min(2).max(60).trim().required().messages({
        'any.required': 'District is required.',
        'string.min': 'District name too short.',
      }),
      village: Joi.string().max(80).trim().allow('').optional(),
      // FIX: Enforce mandatory coordinates in Joi[cite: 4]
      coordinates: Joi.array()
        .items(Joi.number())
        .length(2)
        .required()
        .messages({
          'array.base': 'coordinates must be an array',
          'array.length': 'coordinates must be [longitude, latitude] (exactly 2 numbers)',
          'any.required': 'GPS coordinates are required. Please enable location permission.',
        })
    }).required(),
    sowingDate: Joi.string().max(20).allow('').optional(),
    expectedHarvestDate: Joi.string().max(20).allow('').optional()
  }),
  // ── updateField — all fields optional, only supplied keys are changed ────────
  // Mirrors the PUT /api/fields/:id route logic in fields.js.
  updateField: Joi.object({
    name: Joi.string().min(2).max(80).trim().optional().messages({
      'string.min': 'Field name must be at least 2 characters.',
    }),
    // In schemas.updateProfile, add after the `name` field:
    phone: Joi.string().pattern(/^(\+91[\s-]?)?[6-9]\d{9}$/).optional()
      .messages({
        'string.pattern.base': 'Please provide a valid Indian mobile number.',
      }),
    areaAcre: Joi.number().min(0.01).max(99999).optional().messages({
      'number.min': 'Area must be greater than 0.',
    }),
    soilType: Joi.string()
      .valid('Alluvial', 'Black', 'Red Laterite', 'Sandy Loam', 'Clay Loam', 'Loamy')
      .optional()
      .messages({ 'any.only': 'Invalid soil type.' }),
    activeCrop: Joi.string().max(60).trim().allow('').optional(),
    location: Joi.object({
      state: Joi.string().min(2).max(60).trim().optional(),
      district: Joi.string().min(2).max(60).trim().optional(),
      village: Joi.string().max(80).trim().allow('').optional(),
      // Coordinates optional on update — only re-sent when location actually changed
      coordinates: Joi.array().items(Joi.number()).length(2).optional().messages({
        'array.length': 'coordinates must be [longitude, latitude]',
      }),
    }).optional(),
    sowingDate: Joi.string().max(20).allow('').optional(),
    expectedHarvestDate: Joi.string().max(20).allow('').optional(),
  }),

  // 🟢 ADD THIS inside the `schemas` object in validate.js
  updateAlertSettings: Joi.object({
    weatherEnabled: Joi.boolean(),
    rainAlert: Joi.boolean(),
    rainThresholdMm: Joi.number().min(0).max(500),
    tempAlertLow: Joi.boolean(),
    tempThresholdLow: Joi.number().min(-20).max(50),
    tempAlertHigh: Joi.boolean(),
    tempThresholdHigh: Joi.number().min(0).max(60),
    windAlert: Joi.boolean(),
    windThresholdKmh: Joi.number().min(0).max(250),
    frostAlert: Joi.boolean(),
    stormAlert: Joi.boolean(),
    uvAlert: Joi.boolean(),
    droughtAlert: Joi.boolean(),
    forecastDays: Joi.number().min(1).max(14),

    priceEnabled: Joi.boolean(),
    priceRiseAlert: Joi.boolean(),
    priceFallAlert: Joi.boolean(),
    priceChangeThreshold: Joi.number().min(1).max(100),
    watchedCrops: Joi.array().items(Joi.string()),
    preferredMandi: Joi.string(),
    mspAlert: Joi.boolean(),
    exportBanAlert: Joi.boolean(),

    schemeEnabled: Joi.boolean(),
    centralSchemes: Joi.boolean(),
    stateSchemes: Joi.boolean(),
    pmKisanAlert: Joi.boolean(),
    loanAlerts: Joi.boolean(),
    subsidyAlerts: Joi.boolean(),
    deadlineReminder: Joi.boolean(),
    deadlineDaysBefore: Joi.number().min(1).max(30),

    soundEnabled: Joi.boolean(),
    vibrationEnabled: Joi.boolean(),
    quietHoursOn: Joi.boolean(),
    quietFrom: Joi.number().min(0).max(23),
    quietTo: Joi.number().min(0).max(23),
    frequency: Joi.string().valid('Instant', 'Hourly', 'Daily Summary', 'Weekly')
  }),
};

// ── Middleware factory ─────────────────────────────────────────────────────────
export const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    // FIX: Combine detailed messages into the main string for Android
    const errorMessages = error.details.map((detail) => detail.message).join('\n');
    return res.status(400).json({
      success: false,
      message: errorMessages, // Now Android will show the actual reason!
      errors: error.details,
    });
  }

  req.body = value;
  next();
};