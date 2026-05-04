import express from 'express';
import Field   from '../models/Field.js';
import logger  from '../config/logger.js';
import { protect }   from '../middleware/auth1.js';
import { validate, schemas } from '../middleware/validate.js';

const router = express.Router();

// All field routes require a valid JWT ────────────────────────────────────────
router.use(protect);

// ── GET /api/fields ───────────────────────────────────────────────────────────
// Returns all fields belonging to the authenticated user, newest first.
router.get('/', async (req, res, next) => {
  try {
    const fields = await Field.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, count: fields.length, fields });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/fields/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    // FIX: Reject non-ObjectId strings before Mongoose throws a CastError
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid field ID format.', code: 'INVALID_ID_FORMAT' });
    }
    const field = await Field.findOne({
      _id:    req.params.id,
      userId: req.user._id,   // ownership guard — never expose another user's field
    }).lean();

    if (!field) {
      return res.status(404).json({ success: false, message: 'Field not found.' });
    }

    res.json({ success: true, field });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/fields ──────────────────────────────────────────────────────────
// Create a new field. Required: name, location, soilType, areaAcre, activeCrop.
router.post('/', validate(schemas.createField), async (req, res, next) => {
  try {
    const {
      name,
      areaAcre,
      soilType,
      location,
      activeCrop,
      sowingDate,
      expectedHarvestDate,
    } = req.body;

    const field = await Field.create({
      userId: req.user._id,
      name,
      areaAcre,
      soilType,
      location,      // { state, district, village?, coordinates? }
      activeCrop,
      sowingDate:          sowingDate          || '',
      expectedHarvestDate: expectedHarvestDate || '',
    });

    logger.info(`✅ Field created — user=${req.user._id} field=${field._id} name="${name}"`);
    res.status(201).json({ success: true, field });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/fields/:id ───────────────────────────────────────────────────────
// Full or partial update. All body fields are optional — only supplied keys
// are changed. Required fields cannot be set to empty/null.
router.put('/:id', validate(schemas.updateField), async (req, res, next) => {
  try {
    // FIX: Reject non-ObjectId strings before Mongoose throws a CastError
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid field ID format.', code: 'INVALID_ID_FORMAT' });
    }
    // Build a flat $set object from whatever the client sent.
    // We never allow userId to be changed.
    const allowed = [
      'name', 'areaAcre', 'soilType', 'activeCrop',
      'sowingDate', 'expectedHarvestDate',
      'location.state', 'location.district', 'location.village', 'location.coordinates',
    ];

    const updates = {};

    // Top-level scalar fields
    for (const key of ['name', 'areaAcre', 'soilType', 'activeCrop', 'sowingDate', 'expectedHarvestDate']) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // Nested location fields — use dot notation so Mongoose does a partial update
    // instead of replacing the whole location sub-document.
    if (req.body.location) {
      const loc = req.body.location;
      if (loc.state       !== undefined) updates['location.state']       = loc.state;
      if (loc.district    !== undefined) updates['location.district']    = loc.district;
      if (loc.village     !== undefined) updates['location.village']     = loc.village;
      if (loc.coordinates !== undefined) updates['location.coordinates'] = loc.coordinates;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updatable fields provided.' });
    }

    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!field) {
      return res.status(404).json({ success: false, message: 'Field not found.' });
    }

    logger.info(`✏️  Field updated — user=${req.user._id} field=${field._id}`);
    res.json({ success: true, field });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/fields/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    // FIX: Validate that :id is a MongoDB ObjectId before hitting the DB.
    // If the Android app sends a local UUID (e.g. "5bc4452f-a087-…") instead of
    // the server's _id, Mongoose throws a CastError which the global handler
    // converts to a 400. We short-circuit here with a clear message.
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid field ID format. Expected a MongoDB ObjectId (24 hex chars).',
        code:    'INVALID_ID_FORMAT',
        hint:    'The Android app sent a local UUID instead of the server _id. ' +
                 'Ensure the POST response _id is stored and used for subsequent DELETE calls.',
      });
    }

    const field = await Field.findOneAndDelete({
      _id:    req.params.id,
      userId: req.user._id,
    });

    if (!field) {
      return res.status(404).json({ success: false, message: 'Field not found.' });
    }

    logger.info(`🗑️  Field deleted — user=${req.user._id} field=${req.params.id}`);
    res.json({ success: true, message: 'Field deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;