import express from 'express';
import Expense from '../models/Expense.js';
import { protect } from '../middleware/auth1.js';

const router = express.Router();
router.use(protect);

// GET /api/expenses
router.get('/', async (req, res, next) => {
  try {
    const data = await Expense.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/expenses
router.post('/', async (req, res, next) => {
  try {
    const { fieldId, fieldName, date, category, item, amount, notes } = req.body;
    const newDoc = await Expense.create({
      userId:    req.user._id,
      fieldId:   fieldId   ?? '',
      fieldName: fieldName ?? '',
      date:      date      ?? '',
      category:  category  ?? 'OTHER',
      item:      item      ?? '',
      amount:    Number(amount) || 0,
      notes:     notes     ?? '',
    });
    res.status(201).json({ success: true, data: newDoc });
  } catch (err) { next(err); }
});

// PUT /api/expenses/:id
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    // FIX: Whitelist allowed fields — never pass req.body directly.
    const { fieldId, fieldName, date, category, item, amount, notes } = req.body;
    const updates = {};
    if (fieldId   !== undefined) updates.fieldId   = fieldId;
    if (fieldName !== undefined) updates.fieldName = fieldName;
    if (date      !== undefined) updates.date      = date;
    if (category  !== undefined) updates.category  = category;
    if (item      !== undefined) updates.item      = item;
    if (amount    !== undefined) updates.amount    = Number(amount) || 0;
    if (notes     !== undefined) updates.notes     = notes;

    const updated = await Expense.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Expense not found.' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    const deleted = await Expense.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Expense not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;