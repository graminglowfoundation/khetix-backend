import mongoose from 'mongoose';

const cropHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ── Batch Information ─────────────────────────────────────────────────────
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
      index: true,
    },

    cropName: {
      type: String,
      required: true,
      trim: true,
    },

    cropVariety: {
      type: String,
      default: '',
      trim: true,
    },

    // ── Season Information ────────────────────────────────────────────────────
    season: {
      type: String,
      enum: ['KHARIF', 'RABI', 'ZAID'],
      required: true,
    },

    year: {
      type: Number,
      required: true,
    },

    // ── Farming Dates ────────────────────────────────────────────────────────
    sowingDate: Date,
    harvestDate: Date,
    plantingArea: {
      value: Number,
      unit: {
        type: String,
        enum: ['ACRE', 'HECTARE', 'BIGHA', 'GUNTA', 'DISMIL', 'MARLA'],
        default: 'ACRE',
      },
    },

    // ── Crop Performance ────────────────────────────────────────────────────────
    yieldObtained: {
      value: Number,
      unit: String, // kg, quintal, ton, etc.
    },

    expectedYield: {
      value: Number,
      unit: String,
    },

    costOfCultivation: {
      type: Number,
      default: 0,
    },

    revenue: {
      type: Number,
      default: 0,
    },

    profit: {
      type: Number,
      default: 0,
    },

    // ── Crop Health & Environment ───────────────────────────────────────────
    diseaseOccurred: [
      {
        diseaseName: String,
        occurrenceDate: Date,
        severity: {
          type: String,
          enum: ['MILD', 'MODERATE', 'SEVERE'],
        },
        treatmentApplied: String,
      },
    ],

    pestControl: [
      {
        pestName: String,
        controlMethod: String,
        applicationDate: Date,
        pesticide: String,
      },
    ],

    // ── Environmental Conditions ────────────────────────────────────────────
    avgRainfall: {
      value: Number,
      unit: {
        type: String,
        enum: ['MM', 'INCH'],
        default: 'MM',
      },
    },

    avgTemperature: {
      minTemp: Number,
      maxTemp: Number,
      unit: {
        type: String,
        enum: ['CELSIUS', 'FAHRENHEIT'],
        default: 'CELSIUS',
      },
    },

    // ── Irrigation ────────────────────────────────────────────────────────────
    irrigationCount: {
      type: Number,
      default: 0,
    },

    waterUsage: {
      value: Number,
      unit: {
        type: String,
        enum: ['LITER', 'CUBIC_METER'],
        default: 'LITER',
      },
    },

    // ── Fertilizer & Inputs ───────────────────────────────────────────────────
    ferilizerUsed: [
      {
        fertilizerType: {
          type: String,
          enum: ['NPK', 'UREA', 'DAP', 'POTASH', 'ORGANIC'],
        },
        quantity: Number,
        unit: String, // kg
        applicationDate: Date,
      },
    ],

    seedsUsed: {
      variety: String,
      quantity: Number,
      unit: String, // kg
      cost: Number,
    },

    // ── Crop Status ───────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['PLANNED', 'SOWN', 'GROWING', 'HARVESTED', 'FAILED'],
      default: 'PLANNED',
    },

    notes: {
      type: String,
      default: '',
    },

    // ── Timestamps ────────────────────────────────────────────────────────────
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indices for efficient querying
cropHistorySchema.index({ userId: 1, year: 1, season: 1 });
cropHistorySchema.index({ userId: 1, cropName: 1 });
cropHistorySchema.index({ userId: 1, harvestDate: 1 });

export default mongoose.model('CropHistory', cropHistorySchema);
