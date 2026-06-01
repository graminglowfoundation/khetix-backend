import express from 'express';
import PersonalDiary from '../models/PersonalDiary.js';
import { protect } from '../middleware/auth1.js';

const router = express.Router();
router.use(protect);

// GET /api/personal-diary
router.get('/', async (req, res, next) => {
  try {
    const data = await PersonalDiary.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/personal-diary
router.post('/', async (req, res, next) => {
  try {
    const { date, title, content, fieldName, tags } = req.body;
    const newDoc = await PersonalDiary.create({
      userId:    req.user._id,
      date:      date      ?? '',
      title:     title     ?? '',
      content:   content   ?? '',
      fieldName: fieldName ?? '',
      tags:      tags      ?? '',
    });
    res.status(201).json({ success: true, data: newDoc });
  } catch (err) { next(err); }
});

// PUT /api/personal-diary/:id
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    // FIX: Whitelist allowed fields — never pass req.body directly.
    const { date, title, content, fieldName, tags } = req.body;
    const updates = {};
    if (date      !== undefined) updates.date      = date;
    if (title     !== undefined) updates.title     = title;
    if (content   !== undefined) updates.content   = content;
    if (fieldName !== undefined) updates.fieldName = fieldName;
    if (tags      !== undefined) updates.tags      = tags;

    const updated = await PersonalDiary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Entry not found.' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/personal-diary/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    const deleted = await PersonalDiary.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Entry not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;