import mongoose from 'mongoose';

const harvestSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fieldId:     { type: String, default: '' },
  fieldName:   { type: String, default: '' },
  date:        { type: String, default: '' },
  crop:        { type: String, default: '' },
  yieldQtl:    { type: Number, default: 0 },
  sellPrice:   { type: Number, default: 0 },
  totalIncome: { type: Number, default: 0 },
  buyer:       { type: String, default: '' },
  notes:       { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('Harvest', harvestSchema);