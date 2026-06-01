import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fieldId:   { type: String, default: '' },
  fieldName: { type: String, default: '' },
  date:      { type: String, default: '' },
  category:  { type: String, default: 'OTHER' },
  item:      { type: String, default: '' },
  amount:    { type: Number, default: 0 },
  notes:     { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('Expense', expenseSchema);