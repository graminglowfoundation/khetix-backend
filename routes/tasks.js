import express from 'express';
import Task from '../models/Task.js';
import { protect } from '../middleware/auth1.js';

const router = express.Router();
router.use(protect);

// GET /api/tasks
router.get('/', async (req, res, next) => {
  try {
    const data = await Task.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/tasks
router.post('/', async (req, res, next) => {
  try {
    const { fieldId, fieldName, dueDate, taskType, title, done } = req.body;
    const newDoc = await Task.create({
      userId:    req.user._id,
      fieldId:   fieldId   ?? '',
      fieldName: fieldName ?? '',
      dueDate:   dueDate   ?? '',
      taskType:  taskType  ?? 'OTHER',
      title:     title     ?? '',
      done:      Boolean(done) || false,
    });
    res.status(201).json({ success: true, data: newDoc });
  } catch (err) { next(err); }
});

// PUT /api/tasks/:id  (full update OR toggle-done)
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    // FIX: Whitelist allowed fields — never pass req.body directly.
    const { fieldId, fieldName, dueDate, taskType, title, done } = req.body;
    const updates = {};
    if (fieldId   !== undefined) updates.fieldId   = fieldId;
    if (fieldName !== undefined) updates.fieldName = fieldName;
    if (dueDate   !== undefined) updates.dueDate   = dueDate;
    if (taskType  !== undefined) updates.taskType  = taskType;
    if (title     !== undefined) updates.title     = title;
    if (done      !== undefined) updates.done      = Boolean(done);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updatable fields provided.' });
    }

    const updated = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Task not found.' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.params.id.match(/^[a-fA-F0-9]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    const deleted = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Task not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;