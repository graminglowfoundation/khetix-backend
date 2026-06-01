import mongoose from 'mongoose';

const diarySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fieldId:   { type: String, default: '' },
  fieldName: { type: String, default: '' },
  date:      { type: String, default: '' },
  type:      { type: String, default: 'OTHER' },
  title:     { type: String, default: '' },
  quantity:  { type: String, default: '' },
  unit:      { type: String, default: '' },
  details:   { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('Diary', diarySchema);