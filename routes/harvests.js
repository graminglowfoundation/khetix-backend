import express from 'express';
import Harvest from '../models/Harvest.js';
import { protect } from '../middleware/auth1.js';

const router = express.Router();
router.use(protect);

// GET /api/harvests
router.get('/', async (req, res, next) => {
  try {
    const data = await Harvest.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/harvests
router.post('/', async (req, res, next) => {
  try {
    const { fieldId, fieldName, date, crop, yieldQtl, sellPrice, buyer, notes } = req.body;
    const qtl   = Number(yieldQtl)  || 0;
    const price = Number(sellPrice) || 0;
    // FIX: Always compute totalIncome server-side — never trust the client value.
    const totalIncome = parseFloat((qtl * price).toFixed(2));

    const newDoc = await Harvest.create({
      userId:      req.user._id,
      fieldId:     fieldId   ?? '',
      fieldName:   fieldName ?? '',
      date:        date      ?? '',
      crop:        crop      ?? '',
      yieldQtl:    qtl,
      sellPrice:   price,
      totalIncome,
      buyer:       buyer ?? '',
      notes:       notes ?? '',
    });
    res.status(201).json({ success: true, data: newDoc });
  } catch (err) { next(err); }
});

// PUT /api/harvests/:id
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    // FIX: Whitelist allowed fields — never pass req.body directly.
    const { fieldId, fieldName, date, crop, yieldQtl, sellPrice, buyer, notes } = req.body;
    const updates = {};
    if (fieldId   !== undefined) updates.fieldId   = fieldId;
    if (fieldName !== undefined) updates.fieldName = fieldName;
    if (date      !== undefined) updates.date      = date;
    if (crop      !== undefined) updates.crop      = crop;
    if (buyer     !== undefined) updates.buyer     = buyer;
    if (notes     !== undefined) updates.notes     = notes;

    // FIX: Recompute totalIncome whenever yield or price changes.
    // Fetch existing values first so a partial update (only yield, not price) still gives the right total.
    if (yieldQtl !== undefined || sellPrice !== undefined) {
      const existing = await Harvest.findOne({ _id: req.params.id, userId: req.user._id }).lean();
      if (!existing) return res.status(404).json({ success: false, message: 'Harvest not found.' });

      updates.yieldQtl  = Number(yieldQtl  ?? existing.yieldQtl)  || 0;
      updates.sellPrice = Number(sellPrice ?? existing.sellPrice) || 0;
      updates.totalIncome = parseFloat((updates.yieldQtl * updates.sellPrice).toFixed(2));
    }

    const updated = await Harvest.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Harvest not found.' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/harvests/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    const deleted = await Harvest.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Harvest not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;