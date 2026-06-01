import mongoose from 'mongoose';

const farmDetailsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    // ── Location Details ──────────────────────────────────────────────────────
    location: {
      state: {
        type: String,
        default: '',
        trim: true,
      },
      district: {
        type: String,
        default: '',
        trim: true,
      },
      village: {
        type: String,
        default: '',
        trim: true,
      },
      farmPin: {
        type: String,
        default: '',
        trim: true,
        match: [/^\d{6}$/, 'PIN code must be 6 digits'],
      },
    },

    // ── Land Area Details ─────────────────────────────────────────────────────
    totalLand: {
      type: Number,
      default: 0,
      min: [0, 'Total land cannot be negative'],
    },

    landUnit: {
      type: String,
      enum: ['ACRE', 'HECTARE', 'BIGHA', 'GUNTA', 'DISMIL', 'MARLA'],
      default: 'ACRE',
    },

    // ── Crops Information ─────────────────────────────────────────────────────
    preferredCrops: [
      {
        type: String,
        trim: true,
      },
    ],

    // ── Crop Growing Seasons & History ────────────────────────────────────────
    seasons: [
      {
        seasonId: mongoose.Schema.Types.ObjectId,
        year: Number,
        season: {
          type: String,
          enum: ['KHARIF', 'RABI', 'ZAID'],
        },
        cropsGrown: [String],
        yield: Number,
        yieldUnit: String,
        startDate: Date,
        endDate: Date,
        status: {
          type: String,
          enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
          default: 'PLANNED',
        },
      },
    ],

    // ── Farm Status ───────────────────────────────────────────────────────────
    farmStatus: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
      default: 'ACTIVE',
    },

    soilType: {
      type: String,
      enum: ['CLAY', 'SANDY', 'LOAMY', 'SILT', 'ROCKY'],
      default: null,
    },

    // ── Timestamps ────────────────────────────────────────────────────────────
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('FarmDetails', farmDetailsSchema);
