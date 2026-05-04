import mongoose from 'mongoose';

const kycDocumentsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    // ── Aadhaar Details ───────────────────────────────────────────────────────
    aadhaar: {
      number: {
        type: String,
        trim: true,
        default: '',
        match: [/^\d{12}$/, 'Aadhaar must be 12 digits'],
      },
      frontPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      backPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      status: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
      },
      verificationDate: Date,
      verificationNotes: String,
    },

    // ── PAN Details ───────────────────────────────────────────────────────────
    pan: {
      number: {
        type: String,
        trim: true,
        default: '',
        uppercase: true,
        match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format'],
      },
      documentPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      status: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
      },
      verificationDate: Date,
      verificationNotes: String,
    },

    // ── Voter ID Details ──────────────────────────────────────────────────────
    voterId: {
      number: {
        type: String,
        trim: true,
        default: '',
      },
      frontPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      backPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      status: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
      },
      verificationDate: Date,
      verificationNotes: String,
    },

    // ── Address Proof ────────────────────────────────────────────────────────
    addressProof: {
      documentType: {
        type: String,
        enum: ['ELECTRICITY_BILL', 'WATER_BILL', 'GAS_BILL', 'PROPERTY_TAX', 'LAND_DEED'],
        default: null,
      },
      documentPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      status: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
      },
      verificationDate: Date,
      verificationNotes: String,
    },

    // ── Land Ownership Proof ──────────────────────────────────────────────────
    landOwnershipProof: {
      documentType: {
        type: String,
        enum: ['LAND_DEED', 'REGISTERED_DEED', 'LAND_CERTIFICATE', 'LEASE_AGREEMENT'],
        default: null,
      },
      documentPhoto: {
        url: String,
        uploadedAt: Date,
        verified: {
          type: Boolean,
          default: false,
        },
      },
      area: {
        value: Number,
        unit: String,
      },
      status: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
      },
      verificationDate: Date,
      verificationNotes: String,
    },

    // ── Overall KYC Status ────────────────────────────────────────────────────
    overallStatus: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED', 'RESUBMIT_REQUIRED'],
      default: 'PENDING',
      index: true,
    },

    kycCompletionDate: Date,

    totalDocumentsSubmitted: {
      type: Number,
      default: 0,
    },

    totalDocumentsVerified: {
      type: Number,
      default: 0,
    },

    rejectionReasons: [String],

    // ── Verification Officer ──────────────────────────────────────────────────
    verificationOfficer: {
      name: String,
      id: String,
      verificationDate: Date,
    },

    // ── Timestamps ────────────────────────────────────────────────────────────
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    submittedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('KYCDocuments', kycDocumentsSchema);
