const mongoose = require('mongoose');

const noticeSchema = new mongoose.Schema({
  titleEn: String,
  titleBn: String,
  bodyEn: String,
  bodyBn: String,
  date: String,
  fileUrl: String // optional PDF/attachment link
});
const translationCacheSchema = new mongoose.Schema({
  text: { type: String, required: true },
  lang: { type: String, required: true },
  translated: { type: String, required: true }
});
translationCacheSchema.index({ text: 1, lang: 1 }, { unique: true });
const TranslationCache = mongoose.model('TranslationCache', translationCacheSchema);

module.exports = { Notice, Teacher, Application, SiteAdmin, Administration, TranslationCache };

const administrationSchema = new mongoose.Schema({
  rules: [{
    en: String,
    bn: String
  }],
  classTimes: [{
    classEn: String,
    classBn: String,
    daysEn: String,
    daysBn: String,
    time: String
  }],
  noteEn: String,
  noteBn: String
});

const teacherSchema = new mongoose.Schema({
  name: String,
  designationEn: String,
  designationBn: String,
  subject: String,
  photoUrl: String,
  messageEn: String,
  messageBn: String
});

const applicationSchema = new mongoose.Schema({
  studentName: String,
  className: String,
  guardianName: String,
  phone: String,
  email: String,
  message: String,
  createdAt: { type: Date, default: Date.now },
  status: { type: String, default: 'New' } // New | Reviewed
});

const siteAdminSchema = new mongoose.Schema({
  username: String,
  password: String
});

module.exports = {
  Notice: mongoose.model('Notice', noticeSchema),
  Administration: mongoose.model('Administration', administrationSchema),
  Teacher: mongoose.model('Teacher', teacherSchema),
  Application: mongoose.model('Application', applicationSchema),
  SiteAdmin: mongoose.model('SiteAdmin', siteAdminSchema)
};
