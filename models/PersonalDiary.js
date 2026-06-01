import mongoose from 'mongoose';

const personalDiarySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date:      { type: String, default: '' },
  title:     { type: String, default: '' },
  content:   { type: String, default: '' },
  fieldName: { type: String, default: '' },
  tags:      { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('PersonalDiary', personalDiarySchema);