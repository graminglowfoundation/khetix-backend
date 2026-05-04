import mongoose from 'mongoose';

// ══════════════════════════════════════════════════════════════════════════════
//  Field.js  —  Individual farm field owned by a user.
//
//  Required  : name, location (state + district minimum), soilType,
//              areaAcre, activeCrop
//  Optional  : location.village, location.coordinates,
//              sowingDate, expectedHarvestDate
//
//  NOTE: location is stored as a structured sub-document (not a raw string)
//  so that GPS auto-detect and manual typing both produce the same shape,
//  eliminating the type-mismatch the frontend was hitting.
// ══════════════════════════════════════════════════════════════════════════════

const fieldSchema = new mongoose.Schema(
  {
    // ── Owner ─────────────────────────────────────────────────────────────────
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'userId is required'],
      index:    true,
    },

    // ── Required: Field Identity ──────────────────────────────────────────────
    name: {
      type:      String,
      required:  [true, 'Field name is required'],
      trim:      true,
      minlength: [2,  'Field name must be at least 2 characters'],
      maxlength: [80, 'Field name cannot exceed 80 characters'],
    },

    areaAcre: {
      type:     Number,
      required: [true, 'Field area is required'],
      min:      [0.01, 'Area must be greater than 0'],
      max:      [99999, 'Area seems unrealistically large'],
    },

    soilType: {
      type:     String,
      required: [true, 'Soil type is required'],
      enum: {
        values:  ['Alluvial', 'Black', 'Red Laterite', 'Sandy Loam', 'Clay Loam', 'Loamy'],
        message: 'Invalid soil type',
      },
      trim: true,
    },

    // ── Required: Location (structured) ──────────────────────────────────────
    // Stored as sub-document so GPS auto-detect and manual typing
    // both produce the same shape — no type mismatch on the frontend.
    location: {
      state: { type: String, required: [true, 'State is required'], trim: true },
      district: { type: String, required: [true, 'District is required'], trim: true },
      village: { type: String, default: '', trim: true },
      // FIX: coordinates are now MANDATORY[cite: 9]
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: [true, 'GPS coordinates are mandatory'],
        validate: [
          {
            // FIX: ensure exactly 2 numbers are present
            validator: (v) => Array.isArray(v) && v.length === 2,
            message: 'coordinates must be [longitude, latitude] (exactly 2 numbers)',
          },
          {
            // FIX: reject [0, 0] — that is "null island" / unset GPS on the device.
            // The app should not submit the form until a real GPS fix is obtained.
            // This prevents silent storage of meaningless location data.
            validator: (v) =>
              Array.isArray(v) && v.length === 2 && !(v[0] === 0 && v[1] === 0),
            message:
              'GPS coordinates appear unset ([0, 0]). ' +
              'Please wait for a valid location fix before saving.',
          },
        ],
      }
    },

    // ── Required: Active Crop ─────────────────────────────────────────────────
    activeCrop: {
      type:      String,
      required:  [true, 'Active crop is required'],
      trim:      true,
      maxlength: [60, 'Crop name too long'],
    },

    // ── Optional: Dates ───────────────────────────────────────────────────────
    // Stored as ISO date strings (dd/MM/yyyy from the app or ISO from web).
    sowingDate: {
      type:    String,
      default: '',
      trim:    true,
    },

    expectedHarvestDate: {
      type:    String,
      default: '',
      trim:    true,
    },
  },
  {
    timestamps: true,   // createdAt + updatedAt managed by Mongoose
    toJSON: {
      virtuals: true,
      transform: (_, obj) => { delete obj.__v; return obj; },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
fieldSchema.index({ userId: 1, createdAt: -1 });
fieldSchema.index({ userId: 1, name: 1 });

export default mongoose.model('Field', fieldSchema);