# Hill Academic Care — Public Website

A public-facing school website with Home, About, Notice, Academics (teacher directory),
Results, Administration, Admission (apply online), and Contact pages — plus a small
"Login" link that goes straight to your existing student/teacher/admin portal
(a separate project).

Includes an EN/BN language toggle (client-side, remembers your choice), and a lightweight
site admin panel (separate login from your portal) for managing notices, teachers, and
reviewing admission applications.

## 1. Install dependencies

```bash
npm install
```

## 2. Set up environment variables

Copy `.env.example` to `.env` and fill in your real values:

```bash
cp .env.example .env
```

- `MONGO_URI` — use a **new database name** inside your existing MongoDB Atlas cluster,
  e.g. `mongodb+srv://user:pass@cluster.mongodb.net/hillacademiccare_public`
  (keeps this site's data separate from your portal's data, same cluster is fine).
- `PORTAL_LOGIN_URL` — the URL of your existing portal, already filled in with your
  current Render URL. Update if it ever changes.
- `CLOUDINARY_*` — reuse the same Cloudinary account/credentials from your portal project,
  or create a new Cloudinary account (both are free-tier friendly).
- `NOTIFY_EMAIL_USER` / `NOTIFY_EMAIL_PASS` — a Gmail address and an **App Password**
  (not your normal Gmail password — generate one at https://myaccount.google.com/apppasswords).
- `ADMIN_NOTIFY_EMAIL` — where you want new admission application alerts sent.

## 3. Create your site admin login

This project has no signup page (by design, to keep it simple and secure). Create your
first site admin account directly in MongoDB Atlas:

1. Go to your Atlas cluster → Browse Collections → your new database → `siteadmins` collection
2. Insert a document:
   ```json
   { "username": "admin", "password": "choose-a-strong-password" }
   ```
3. Log in at `/admin/login` using those credentials.

## 4. Run locally

```bash
npm start
```

Visit `http://localhost:4000` for the public site, and `http://localhost:4000/admin/login`
for the site admin panel.

## 5. Deploy (same pattern as your portal)

Push this project to its own GitHub repo, then create a **new** Web Service on Render
pointing at that repo. Add the same environment variables from your `.env` file in
Render's Environment tab. Render will give you a new URL for this public site —
that's the one you'd point your domain name at, if you have one.

## Adding content

- **Notices**: `/admin/notices` — add a title/body in both English and Bangla, a date,
  and optionally a link to a PDF or image (host it on Cloudinary, Google Drive, etc. and
  paste the direct link).
- **Teachers**: `/admin/teachers` — add name, subject, designation (both languages), and
  a photo (uploaded directly, stored on Cloudinary — same setup as your portal).
- **Applications**: `/admin/applications` — view submissions from the Admission page,
  mark them "Reviewed" once handled. You'll also get an email the moment someone applies.

## Notes on the Bangla/English toggle

Every bilingual piece of text uses `data-en="..."` and `data-bn="..."` attributes on the
same element. The toggle button in the header swaps between them instantly (no page
reload) and remembers the visitor's choice for next time. To add more bilingual text
anywhere, just follow the same pattern:

```html
<p data-en="English text here" data-bn="বাংলা লেখা এখানে"></p>
```
