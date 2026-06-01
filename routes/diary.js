import express from 'express';
import Diary from '../models/Diary.js';
import { protect } from '../middleware/auth1.js';

const router = express.Router();
router.use(protect);

// GET /api/diary — returns all diary entries for the authenticated user
router.get('/', async (req, res, next) => {
  try {
    const data = await Diary.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/diary — create a new diary entry
router.post('/', async (req, res, next) => {
  try {
    const { fieldId, fieldName, date, type, title, quantity, unit, details } = req.body;
    const newDoc = await Diary.create({
      userId: req.user._id,
      fieldId:   fieldId   ?? '',
      fieldName: fieldName ?? '',
      date:      date      ?? '',
      type:      type      ?? 'OTHER',
      title:     title     ?? '',
      quantity:  quantity  ?? '',
      unit:      unit      ?? '',
      details:   details   ?? '',
    });
    res.status(201).json({ success: true, data: newDoc });
  } catch (err) { next(err); }
});

// PUT /api/diary/:id — update a diary entry (only owner can update)
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    // FIX: Explicitly whitelist fields — never pass req.body directly to prevent
    // a client from overwriting userId or injecting unexpected fields.
    const { fieldId, fieldName, date, type, title, quantity, unit, details } = req.body;
    const updates = {};
    if (fieldId   !== undefined) updates.fieldId   = fieldId;
    if (fieldName !== undefined) updates.fieldName = fieldName;
    if (date      !== undefined) updates.date      = date;
    if (type      !== undefined) updates.type      = type;
    if (title     !== undefined) updates.title     = title;
    if (quantity  !== undefined) updates.quantity  = quantity;
    if (unit      !== undefined) updates.unit      = unit;
    if (details   !== undefined) updates.details   = details;

    const updated = await Diary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Entry not found.' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/diary/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    const deleted = await Diary.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Entry not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;