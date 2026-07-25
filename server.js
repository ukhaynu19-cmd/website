require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { Notice, Teacher, Application, SiteAdmin, Administration } = require('./models');

const app = express();
const PORT = process.env.PORT || 4000;

// Link to your existing student/teacher/admin portal (separate project)
const PORTAL_LOGIN_URL = process.env.PORTAL_LOGIN_URL || 'https://hillacademiccare-q6um.onrender.com/';

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas!');
    app.listen(PORT, () => console.log(`🚀 Public site running on http://localhost:${PORT}`));
  })
  .catch(err => { console.error('❌ DB error:', err); process.exit(1); });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'hac-public-site', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ---------- TRANSLATION (free MyMemory API, no key required) ----------
async function translateBatch(texts, to) {
  const nonEmptyIndices = [];
  const nonEmptyTexts = [];
  texts.forEach((t, i) => {
    if (t && t.trim() !== '') {
      nonEmptyIndices.push(i);
      nonEmptyTexts.push(t);
    }
  });

  const results = new Array(texts.length).fill('');
  if (nonEmptyTexts.length === 0) return results;

  // MyMemory has no batch endpoint, so we call it once per text,
  // with a short delay between calls to stay well within its rate limits.
  for (let i = 0; i < nonEmptyTexts.length; i++) {
    const text = nonEmptyTexts[i];
    try {
      const params = new URLSearchParams({
        q: text,
        langpair: `en|${to}`,
        de: process.env.MYMEMORY_EMAIL || ''
      });
      const response = await fetch(`https://api.mymemory.translated.net/get?${params}`);
      const data = await response.json();
      results[nonEmptyIndices[i]] = data.responseData?.translatedText || text;
    } catch (err) {
      console.error('MyMemory translation failed for one text:', err.message);
      results[nonEmptyIndices[i]] = text; // fallback to original on failure
    }
    // Small delay to be polite to the free API and avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  return results;
}

async function autoTranslate(enText, bnText) {
  // If Bangla is missing but English was given, translate EN → BN
  if (enText && enText.trim() !== '' && (!bnText || bnText.trim() === '')) {
    try {
      const [translated] = await translateBatch([enText], 'bn');
      return { en: enText, bn: translated };
    } catch (err) {
      console.error('Translation failed:', err.message);
      return { en: enText, bn: bnText || '' };
    }
  }
  // If English is missing but Bangla was given, translate BN → EN
  if (bnText && bnText.trim() !== '' && (!enText || enText.trim() === '')) {
    try {
      const [translated] = await translateBatch([bnText], 'en');
      return { en: translated, bn: bnText };
    } catch (err) {
      console.error('Translation failed:', err.message);
      return { en: enText || '', bn: bnText };
    }
  }
  // Both provided, or both empty — leave as-is
  return { en: enText || '', bn: bnText || '' };
}

// ---------- EMAIL (Gmail REST API over HTTPS — bypasses Render's SMTP port block) ----------
const { google } = require('googleapis');

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

function buildRawEmail(to, from, subject, text) {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text
  ].join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendGmail(to, subject, text) {
  const raw = buildRawEmail(to, process.env.NOTIFY_EMAIL_USER, subject, text);
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });
}

async function notifyAdminOfApplication(app_) {
  try {
    await sendGmail(
      process.env.ADMIN_NOTIFY_EMAIL,
      'New Admission Application — Hill Academic Care',
      `New application from ${app_.studentName} (Class ${app_.className}). Guardian: ${app_.guardianName}, Phone: ${app_.phone}, Email: ${app_.email}\n\nMessage: ${app_.message || '—'}`
    );
  } catch (err) {
    console.error('Email notify failed:', err.message);
  }
}

async function notifyApplicant(application, subject, message) {
  if (!application.email) return;
  try {
    await sendGmail(
      application.email,
      subject,
      `Dear ${application.guardianName},\n\n${message}\n\nStudent: ${application.studentName} (Class ${application.className})\n\n— Hill Academic Care`
    );
  } catch (err) {
    console.error('Applicant email failed:', err.message);
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'hac-public-site-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4 }
}));

app.use((req, res, next) => {
  res.locals.portalLoginUrl = PORTAL_LOGIN_URL;
  next();
});

function requireSiteAdmin(req, res, next) {
  if (req.session.siteAdmin) return next();
  return res.redirect('/admin/login');
}

// ---------- PUBLIC PAGES ----------
app.get('/', async (req, res) => {
  try {
    const notices = await Notice.find({}).sort({ _id: -1 }).limit(5);
    res.render('home', { notices, page: 'home' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/about', (req, res) => res.render('about', { page: 'about' }));

app.get('/notice', async (req, res) => {
  try {
    const notices = await Notice.find({}).sort({ _id: -1 });
    res.render('notice', { notices, page: 'notice' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/notice/:id', async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.redirect('/notice');
    res.render('notice-detail', { notice, page: 'notice' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/academics', async (req, res) => {
  try {
    const teachers = await Teacher.find({});
    res.render('academics', { teachers, page: 'academics' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/academics/teacher/:id', async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.redirect('/academics');
    res.render('teacher-detail', { teacher, page: 'academics' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/results', (req, res) => res.render('results', { page: 'results' }));

app.get('/administration', async (req, res) => {
  try {
    let content = await Administration.findOne({});
    if (!content) {
      content = await Administration.create({
        rules: [
          { en: 'Students must attend school regularly and arrive on time.', bn: 'শিক্ষার্থীদের নিয়মিত বিদ্যালয়ে উপস্থিত থাকতে হবে এবং সময়মতো আসতে হবে।' },
          { en: 'Proper school uniform is mandatory on all school days.', bn: 'সকল বিদ্যালয় দিবসে যথাযথ স্কুল ইউনিফর্ম পরিধান বাধ্যতামূলক।' },
          { en: 'Fees must be paid within the first week of every month.', bn: 'প্রতি মাসের প্রথম সপ্তাহের মধ্যে বেতন পরিশোধ করতে হবে।' },
          { en: 'Students must maintain discipline and respect toward teachers and peers.', bn: 'শিক্ষার্থীদের শিক্ষক ও সহপাঠীদের প্রতি শৃঙ্খলা ও সম্মান বজায় রাখতে হবে।' },
          { en: 'Any leave of absence must be informed to the class teacher in advance.', bn: 'ছুটির প্রয়োজন হলে তা আগে থেকেই শ্রেণি শিক্ষককে জানাতে হবে।' }
        ],
        classTimes: [
          { classEn: 'Six – Eight', classBn: 'ষষ্ঠ – অষ্টম', daysEn: 'Saturday – Thursday', daysBn: 'শনিবার – বৃহস্পতিবার', time: '5:30 PM – 8:00 PM' },
          { classEn: 'Nine – Ten', classBn: 'নবম – দশম', daysEn: 'Saturday – Thursday', daysBn: 'শনিবার – বৃহস্পতিবার', time: '5:00 PM – 9:30 PM' }
        ],
        noteEn: 'Note: Friday is a weekly holiday.',
        noteBn: 'দ্রষ্টব্য: শুক্রবার সাপ্তাহিক ছুটির দিন।'
      });
    }
    res.render('administration', { content, page: 'administration' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/admission', (req, res) => res.render('admission', { page: 'admission', submitted: false }));

app.post('/admission/apply', async (req, res) => {
  try {
    const { studentName, className, guardianName, phone, email, message } = req.body;
    const application = await Application.create({ studentName, className, guardianName, phone, email, message });
    notifyAdminOfApplication(application); // fire and forget, doesn't block the response
    res.render('admission', { page: 'admission', submitted: true });
  } catch (err) {
    console.error('Application submit error:', err);
    res.status(500).send('Database error');
  }
});

app.get('/contact', (req, res) => res.render('contact', { page: 'contact' }));

// ---------- LIVE JAPANESE TRANSLATION (called by lang-toggle.js) ----------
app.post('/api/translate-batch', async (req, res) => {
  try {
    const { texts, to } = req.body;
    if (!texts || texts.length === 0) return res.json({ translations: [] });
    const translations = await translateBatch(texts, to);
    res.json({ translations });
  } catch (err) {
    console.error('Translate-batch route failed:', err.message);
    res.status(500).json({ error: 'Translation failed', details: err.message });
  }
});

// ---------- SITE ADMIN (manages notices/teachers/applications for this public site) ----------
app.get('/admin/login', (req, res) => res.render('admin/login', { error: null }));

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await SiteAdmin.findOne({ username, password });
    if (admin) {
      req.session.siteAdmin = true;
      return res.redirect('/admin');
    }
    res.render('admin/login', { error: 'Invalid credentials' });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/admin/administration', requireSiteAdmin, async (req, res) => {
  try {
    let content = await Administration.findOne({});
    if (!content) content = await Administration.create({ rules: [], classTimes: [], noteEn: '', noteBn: '' });
    res.render('admin/administration', { content });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/administration/update', requireSiteAdmin, async (req, res) => {
  try {
    const { ruleEn, ruleBn, classEn, classBn, daysEn, daysBn, time, noteEn, noteBn } = req.body;

    const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    const rEn = toArray(ruleEn), rBn = toArray(ruleBn);
    const cEn = toArray(classEn), cBn = toArray(classBn), dEn = toArray(daysEn), dBn = toArray(daysBn), t = toArray(time);

    const rules = [];
    for (let i = 0; i < rEn.length; i++) {
      if (rEn[i].trim() === '' && (!rBn[i] || rBn[i].trim() === '')) continue;
      const translated = await autoTranslate(rEn[i], rBn[i]);
      rules.push(translated);
    }

    const classTimes = [];
    for (let i = 0; i < cEn.length; i++) {
      if (cEn[i].trim() === '') continue;
      const classT = await autoTranslate(cEn[i], cBn[i]);
      const daysT = await autoTranslate(dEn[i], dBn[i]);
      classTimes.push({
        classEn: classT.en, classBn: classT.bn,
        daysEn: daysT.en, daysBn: daysT.bn,
        time: t[i] || ''
      });
    }

    const note = await autoTranslate(noteEn, noteBn);

    let content = await Administration.findOne({});
    if (!content) content = new Administration({});
    content.rules = rules;
    content.classTimes = classTimes;
    content.noteEn = note.en;
    content.noteBn = note.bn;
    await content.save();

    res.redirect('/admin/administration');
  } catch (err) {
    console.error('Administration update error:', err);
    res.status(500).send('Database error');
  }
});

app.get('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

app.get('/admin', requireSiteAdmin, async (req, res) => {
  try {
    const [noticeCount, teacherCount, newApps] = await Promise.all([
      Notice.countDocuments(),
      Teacher.countDocuments(),
      Application.countDocuments({ status: 'New' })
    ]);
    res.render('admin/dashboard', { noticeCount, teacherCount, newApps });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/admin/notices', requireSiteAdmin, async (req, res) => {
  try {
    const notices = await Notice.find({}).sort({ _id: -1 });
    res.render('admin/notices', { notices });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/notices/add', requireSiteAdmin, async (req, res) => {
  try {
    let { titleEn, titleBn, bodyEn, bodyBn, date, fileUrl } = req.body;

    const title = await autoTranslate(titleEn, titleBn);
    const body = await autoTranslate(bodyEn, bodyBn);

    await Notice.create({
      titleEn: title.en, titleBn: title.bn,
      bodyEn: body.en, bodyBn: body.bn,
      date, fileUrl
    });
    res.redirect('/admin/notices');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/notices/delete/:id', requireSiteAdmin, async (req, res) => {
  try {
    await Notice.findByIdAndDelete(req.params.id);
    res.redirect('/admin/notices');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/admin/teachers', requireSiteAdmin, async (req, res) => {
  try {
    const teachers = await Teacher.find({});
    res.render('admin/teachers', { teachers });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/admin/teachers/edit/:id', requireSiteAdmin, async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.redirect('/admin/teachers');
    res.render('admin/teacher-edit', { teacher });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/teachers/edit/:id', requireSiteAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { name, designationEn, designationBn, subject, messageEn, messageBn } = req.body;
    const updateData = { name, designationEn, designationBn, subject, messageEn, messageBn };
    if (req.file) {
      updateData.photoUrl = req.file.path; // only overwrite photo if a new one was uploaded
    }
    await Teacher.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/admin/teachers');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/teachers/add', requireSiteAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { name, designationEn, designationBn, subject, messageEn, messageBn } = req.body;
    const photoUrl = req.file ? req.file.path : '';
    await Teacher.create({ name, designationEn, designationBn, subject, photoUrl, messageEn, messageBn });
    res.redirect('/admin/teachers');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/teachers/delete/:id', requireSiteAdmin, async (req, res) => {
  try {
    await Teacher.findByIdAndDelete(req.params.id);
    res.redirect('/admin/teachers');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.get('/admin/applications', requireSiteAdmin, async (req, res) => {
  try {
    const applications = await Application.find({}).sort({ createdAt: -1 });
    res.render('admin/applications', { applications });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/applications/mark-reviewed/:id', requireSiteAdmin, async (req, res) => {
  try {
    const application = await Application.findByIdAndUpdate(req.params.id, { status: 'Reviewed' }, { new: true });
    if (application) {
      notifyApplicant(application, 'Application Under Review — Hill Academic Care',
        'Your admission application has been received and is currently under review. We will contact you soon with a final decision.');
    }
    res.redirect('/admin/applications');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/applications/accept/:id', requireSiteAdmin, async (req, res) => {
  try {
    const application = await Application.findByIdAndUpdate(req.params.id, { status: 'Accepted' }, { new: true });
    if (application) {
      notifyApplicant(application, 'Admission Confirmed — Hill Academic Care',
        'Congratulations! Your admission application has been accepted. Please contact our coaching center office to complete the enrollment process. Office hours: Saturday to Friday, 8:00 AM – 10:00 PM.');
    }
    res.redirect('/admin/applications');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/applications/reject/:id', requireSiteAdmin, async (req, res) => {
  try {
    const application = await Application.findByIdAndUpdate(req.params.id, { status: 'Rejected' }, { new: true });
    if (application) {
      notifyApplicant(application, 'Admission Application Update — Hill Academic Care',
        'Thank you for your interest in Hill Academic Care. After careful review, we are unable to offer admission at this time.');
    }
    res.redirect('/admin/applications');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

app.post('/admin/applications/delete/:id', requireSiteAdmin, async (req, res) => {
  try {
    await Application.findByIdAndDelete(req.params.id);
    res.redirect('/admin/applications');
  } catch (err) {
    res.status(500).send('Database error');
  }
});

// Catches errors thrown by multer/Cloudinary uploads (wrong format, too large, etc.)
// Must be last — Express only routes errors to handlers registered after the failing route.
app.use((err, req, res, next) => {
  if (err) {
    console.error('Upload error:', err.message);
    return res.status(400).send(`Upload failed: ${err.message}. Please try a JPG or PNG under 5MB.`);
  }
  next();
});
