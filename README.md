# Haovels

Haovels adalah aplikasi baca novel berbasis web dengan backend scraper. Frontend menampilkan daftar novel, detail novel, bookmark, riwayat baca, akun pengguna, dan reader chapter. Backend menyediakan API yang menggabungkan data dari source scraper dan menyimpan cache agar akses berikutnya lebih cepat.

## Fitur Utama

- Home dengan daftar novel terbaru dan riwayat lanjut baca.
- Explore untuk melihat dan mencari novel.
- Detail novel berisi cover, penulis, genre, sinopsis, bookmark, dan daftar chapter.
- Reader chapter dengan navigasi previous/next.
- Login Google OAuth menggunakan Supabase Auth.
- Profile user otomatis dari metadata akun Google.
- Bookmark dan riwayat baca tersimpan per akun di Supabase.
- Fallback `localStorage` saat Supabase belum dikonfigurasi.
- Backend API dengan cache memory + disk.
- Scheduler scraping berkala dari source yang terdaftar.
- Sistem scraper modular untuk menambah source baru.

## Teknologi

- Frontend: HTML, CSS, JavaScript vanilla.
- Auth dan user data: Supabase Auth, Supabase Database, RLS.
- Backend: Node.js native HTTP server.
- Scraping: `axios` dan `cheerio`.
- Cache backend: file JSON di `Backend/cache/`.

## Struktur Folder

```text
HaoVel/
├─ Frontend/
│  ├─ index.html
│  ├─ css/
│  │  └─ style.css
│  └─ js/
│     ├─ env.example.js
│     ├─ env.js
│     ├─ config.js
│     ├─ supabase-client.js
│     ├─ auth.js
│     ├─ storage.js
│     └─ app.js
├─ Backend/
│  ├─ package.json
│  └─ src/
│     ├─ server.js
│     ├─ scrapers/
│     │  ├─ base.js
│     │  ├─ registry.js
│     │  ├─ kaito.js
│     │  └─ _template.js
│     └─ utils/
│        ├─ dateExtractor.js
│        └─ htmlCleaner.js
├─ Supabase/
│  └─ schema.sql
├─ .gitignore
└─ README.md
```

## File Penting

- `Frontend/index.html`: struktur halaman aplikasi dan semua container UI.
- `Frontend/css/style.css`: styling mobile-first dark theme untuk halaman, card, detail, reader, bottom nav, dan akun.
- `Frontend/js/env.example.js`: template konfigurasi Supabase untuk dibuat menjadi `env.js`.
- `Frontend/js/env.js`: konfigurasi lokal Supabase. File ini di-ignore dan tidak boleh berisi service role key.
- `Frontend/js/config.js`: konfigurasi frontend untuk API backend dan Supabase.
- `Frontend/js/supabase-client.js`: inisialisasi Supabase client browser.
- `Frontend/js/auth.js`: login Google, logout, session listener, dan sinkronisasi profile.
- `Frontend/js/storage.js`: wrapper bookmark/history dengan fallback lokal dan sinkronisasi Supabase per user.
- `Frontend/js/app.js`: logic aplikasi frontend, termasuk fetch API, render UI, navigasi halaman, bookmark, history, dan event handler.
- `Backend/src/server.js`: entry point backend. Mengatur HTTP server, route API, cache, dan scheduler scraping.
- `Backend/src/scrapers/registry.js`: daftar scraper aktif dan resolver scraper berdasarkan URL atau ID novel.
- `Supabase/schema.sql`: SQL tabel, trigger profile, index, dan policy RLS.

## Alur Kerja Aplikasi

1. Frontend mengambil daftar novel dari `GET /api/novels`.
2. User dapat login dari tab Akun dengan tombol `Login dengan Google`.
3. Supabase Auth melakukan redirect OAuth dan mengembalikan session ke aplikasi.
4. Saat session aktif, aplikasi memastikan row `profiles` tersedia dari metadata Google.
5. Bookmark dan reading history dibaca dari Supabase berdasarkan `user_id`.
6. Saat user bookmark novel, data ditulis ke tabel `bookmarks`.
7. Saat user membuka chapter, aplikasi menyimpan progres ke tabel `reading_history`.
8. Jika Supabase belum dikonfigurasi, aplikasi tetap berjalan dengan fallback `localStorage`.

## Menjalankan Project

### Backend

```bash
cd Backend
npm install
npm start
```

Backend berjalan di:

```text
http://localhost:3000
```

Endpoint tersedia:

```text
GET /api/novels
GET /api/novels/:id
GET /api/chapter?url=...
GET /api/health
```

### Frontend

Frontend adalah file statis. Jalankan dari folder `Frontend` menggunakan static server agar OAuth redirect memiliki origin yang jelas.

```bash
cd Frontend
npx serve .
```

Secara default frontend memakai API production:

```js
API_BASE_URL: 'https://haovels-production.up.railway.app/api'
```

Untuk memakai backend lokal, ubah `Frontend/js/config.js`:

```js
window.HAOVELS_CONFIG = {
  API_BASE_URL: 'http://localhost:3000/api',
  SUPABASE_URL: window.HAOVELS_ENV?.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: window.HAOVELS_ENV?.SUPABASE_ANON_KEY || '',
};
```

## Setup Supabase

1. Buat project di Supabase.
2. Buka SQL Editor.
3. Jalankan isi file `Supabase/schema.sql`.
4. Salin `Frontend/js/env.example.js` menjadi `Frontend/js/env.js`.
5. Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dari Project Settings -> API.

```js
window.HAOVELS_ENV = {
  SUPABASE_URL: 'https://your-project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
};
```

Jangan memakai service role key di frontend.

## Google OAuth

Di Google Cloud:

1. Buat OAuth Client ID tipe Web application.
2. Tambahkan Authorized JavaScript origins untuk URL frontend, misalnya `http://localhost:3000` atau domain production.
3. Tambahkan Authorized redirect URI dari halaman Google provider di Supabase.

Di Supabase Dashboard:

1. Buka Authentication -> Providers -> Google.
2. Aktifkan Google provider.
3. Isi Client ID dan Client Secret dari Google Cloud.
4. Buka Authentication -> URL Configuration.
5. Isi Site URL dengan origin frontend.
6. Tambahkan Redirect URLs untuk local dan production.

Supabase `signInWithOAuth` akan redirect ke Google lalu kembali ke URL aplikasi yang dikirim dari `auth.js`.

## Database Supabase

### `profiles`

```text
id uuid primary key references auth.users(id)
username text
avatar_url text
created_at timestamptz
```

Profile dibuat otomatis oleh trigger `on_auth_user_created` saat user pertama kali login. Aplikasi juga melakukan `upsert` profile setelah session aktif untuk memastikan nama/avatar Google terbaru tersimpan.

### `bookmarks`

```text
id uuid primary key
user_id uuid references auth.users(id)
manga_id text
title text
cover text
last_chapter text
created_at timestamptz
unique (user_id, manga_id)
```

### `reading_history`

```text
id uuid primary key
user_id uuid references auth.users(id)
manga_id text
chapter_id text
title text
updated_at timestamptz
unique (user_id, manga_id)
```

## Security

RLS diaktifkan untuk semua tabel user:

- `profiles`
- `bookmarks`
- `reading_history`

Policy menggunakan role `authenticated` dan filter `(select auth.uid()) = user_id` atau `(select auth.uid()) = id`, sehingga user hanya bisa membaca/mengubah data miliknya sendiri.

## Build dan Deploy

Frontend tidak memiliki proses build. Deploy folder `Frontend/` ke static hosting seperti Netlify, Vercel static, Cloudflare Pages, atau hosting file statis lain.

Backend dapat dideploy ke layanan Node.js seperti Railway, Render, Fly.io, atau VPS.

```bash
cd Backend
npm install --production
npm start
```

Pastikan platform deploy menjalankan command:

```bash
npm start
```

## Environment Variable

Backend mendukung konfigurasi berikut:

```text
PORT                  Port HTTP server. Default: 3000
SCRAPE_INTERVAL_MS    Interval scheduler scraping. Default: 900000
SCRAPE_CONCURRENCY    Jumlah scrape detail paralel. Default: 5
```

Frontend memakai file runtime:

```text
Frontend/js/env.js
```

Isi yang dibutuhkan:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

## Catatan Developer

- Tambah source baru dengan menyalin `Backend/src/scrapers/_template.js`, implementasikan contract, lalu daftarkan di `Backend/src/scrapers/registry.js`.
- ID novel wajib memakai format `<source>_<slug>` agar resolver scraper dapat bekerja.
- Jangan commit folder `Backend/cache/` atau `Frontend/js/env.js`.
- Jangan hardcode Supabase credential di `config.js`, `auth.js`, atau `app.js`.
- Jika response backend berubah, cek `extractChapterContent()` dan `sanitizeNovelDetail()` di `Frontend/js/app.js`.
- Untuk pengembangan berikutnya, pemecahan lanjutan yang aman adalah memisahkan layer render dan event handler ke modul ES dengan bundler atau script module.
