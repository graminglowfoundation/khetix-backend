import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fieldId:   { type: String, default: '' },
  fieldName: { type: String, default: '' },
  dueDate:   { type: String, default: '' },
  taskType:  { type: String, default: 'OTHER' },
  title:     { type: String, default: '' },
  done:      { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model('Task', taskSchema);