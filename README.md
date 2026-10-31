# Hadir — Absensi Lokal

Aplikasi web absensi karyawan magang dengan selfie bersama QR kantor. Admin mengelola anggota, QR, jadwal, dan rekap; anggota mencatat absen masuk dan pulang.

## Persyaratan

- Node.js 24 atau lebih baru, beserta npm.
- Browser modern dengan izin kamera untuk mengambil selfie.
- Internet untuk memasang dependensi pertama kali. Server dan data berjalan di komputer lokal.

## Menjalankan di komputer sendiri

Buka folder project melalui VS Code, lalu jalankan di terminal:

```bash
npm ci
npm run dev
```

Buka [http://127.0.0.1:5197](http://127.0.0.1:5197). Buat akun admin pertama melalui halaman yang muncul. Tidak ada akun atau kata sandi bawaan. Folder data dan database dibuat otomatis saat server pertama kali berjalan.

Di PowerShell, gunakan `npm.cmd` jika perintah `npm` diblokir oleh pengaturan eksekusi skrip. Hentikan server dengan **Ctrl+C**. Jalankan satu server saja pada port 5197.

Untuk menjalankan hasil build:

```bash
npm run build
npm start
```

Mode pengembangan memperbarui tampilan otomatis dan memulai ulang server saat kode server berubah. Aplikasi hanya mendengarkan pada `127.0.0.1`; akses dari HP atau komputer lain belum diaktifkan. Repository ini menyimpan kode aplikasi, bukan layanan hosting.

## Penggunaan

1. Buat admin pertama, lalu tentukan hari kerja, jam masuk, jam pulang, dan zona waktu melalui **Pengaturan**.
2. Tambahkan akun melalui **Anggota magang**. Berikan email dan kata sandi awal kepada anggota.
3. Buat QR melalui **QR kantor**, cetak, lalu tempelkan di tempat yang terang.
4. Anggota masuk dan mengambil selfie dengan wajah serta QR terlihat dalam foto yang sama melalui **Absensi saya**.
5. Admin meninjau bukti foto, menyaring rekap berdasarkan nama/email atau tanggal, dan mengekspor hasilnya ke CSV.

Jadwal awal Senin–Sabtu, masuk paling lambat 09.00 dan pulang mulai 17.00. Admin dapat mengubah jadwal serta mengizinkan absensi terlambat. Admin tidak melakukan absensi sendiri.

Hanya admin dapat mengangkat admin lain. Minimal satu admin aktif harus tetap ada. Anggota dapat dihapus; akun dan sesi loginnya dihapus, sedangkan riwayat absensi dan foto tetap disimpan. Untuk menghapus akun admin, ubah perannya menjadi anggota terlebih dahulu setelah memastikan ada admin lain.

Penghapusan QR membuat cetakannya tidak berlaku lagi untuk absensi berikutnya, tanpa menghapus riwayat sebelumnya.

## Akun dan sesi

- **Akun saya** menyediakan perubahan nama, email login, dan kata sandi. Semua kolom kata sandi memiliki tombol tampilkan/sembunyikan.
- Perubahan profil memerlukan kata sandi saat ini. Email harus unik. Setelah email diubah, gunakan email baru untuk login; sesi pada browser lain dikeluarkan.
- Sesi berlaku 12 jam. Perubahan atau reset kata sandi mencabut sesi lama. Kata sandi disimpan dalam bentuk hash scrypt.
- Lupa kata sandi ditangani admin melalui daftar anggota; belum ada pemulihan melalui email.
- Tab dalam satu profil browser memakai sesi yang sama. Gunakan browser berbeda atau jendela samaran untuk membuka akun admin dan anggota bersamaan.

## Data dan cadangan

Data disimpan di `data/hadir.sqlite`, sedangkan foto berada di `data/selfies/`. File database menyimpan akun, hash kata sandi, sesi login, pengaturan, QR, dan catatan absensi.

Untuk membuat cadangan, hentikan server dengan **Ctrl+C**, lalu salin seluruh folder `data` ke lokasi pribadi. Untuk memulihkan, hentikan server lalu kembalikan folder tersebut dari cadangan.

Database, foto, cadangan, sertifikat, dan file rahasia tidak disertakan dalam Git. Jangan mengunggah folder data atau arsip cadangan ke repository publik.

Nama dan email pada catatan absensi lama tetap memakai identitas saat absensi dicatat. QR dibaca otomatis dari foto; wajah diperiksa admin. Belum ada pengenalan wajah otomatis, pemeriksaan keaktifan wajah, GPS, atau penghapusan otomatis berdasarkan masa simpan.

Rekap memuat maksimal 2.000 catatan terbaru untuk admin dan 1.000 untuk anggota. Filter dan ekspor CSV bekerja pada catatan yang dimuat tersebut.

## Struktur project

```text
src/
  main.tsx             Titik masuk React
  ui.tsx               Halaman dan interaksi aplikasi
  PasswordInput.tsx    Kolom kata sandi dengan tombol tampilkan/sembunyikan
  styles.css           Gaya tampilan dan cetak QR
server/
  api.ts               Aturan dan API absensi
  auth.mjs             Login, profil, kata sandi, dan sesi
  member-policy.mjs    Aturan pengelolaan anggota
  storage.mjs          Penyimpanan SQLite dan foto
  schema.sql           Struktur database
  index.mjs            Server HTTP lokal
scripts/
  build-server.mjs      Menghasilkan server/api.mjs dari api.ts
  dev.mjs              Menjalankan mode pengembangan
```

`dist/`, `node_modules/`, dan `server/api.mjs` dibuat secara lokal dan tidak disertakan dalam Git. `package-lock.json` disertakan agar pemasangan dependensi konsisten.

## Perintah pengembangan

```bash
npm run dev
npm run build
npm run format
npm run format:check
npx tsc --noEmit --noUncheckedSideEffectImports
```

Teknologi utama: React, TypeScript, Vite, CSS, Node.js HTTP, SQLite bawaan Node.js, serta `qrcode`, `jsqr`, dan `jpeg-js` untuk QR dan foto. Versi dependensi tercantum di `package.json` dan `package-lock.json`.
