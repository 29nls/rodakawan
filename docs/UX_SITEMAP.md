# UX Sitemap & Interaction Notes

## 1. Navigasi tingkat atas

```text
App
├── Auth
│   ├── Welcome
│   ├── Sign in / Sign up
│   └── Complete profile
├── Main tabs
│   ├── Beranda / Feed (P1; MVP dapat mengarah ke Ringkasan)
│   ├── Peta / Perjalanan
│   │   ├── Daftar perjalanan
│   │   ├── Detail perjalanan
│   │   ├── Buat perjalanan
│   │   └── Live convoy map
│   ├── Komunitas
│   │   ├── Jelajahi klub
│   │   ├── Detail klub
│   │   ├── Anggota dan peran
│   │   └── Post & agenda (P1)
│   ├── Peringatan jalan
│   │   ├── Peta/list laporan
│   │   ├── Buat laporan
│   │   └── Detail laporan
│   └── Profil
│       ├── Edit profil
│       ├── Garasi
│       ├── Pengaturan privasi
│       ├── Notifikasi
│       └── Akun & bantuan
└── Shared screens
    ├── Ride chat
    ├── Notifications
    ├── Report/block user
    └── Permission education sheets
```

Sitemap ini konseptual. Susunan tab final harus divalidasi dalam prototype usability; jangan menjejalkan semua fitur dalam tab bar sekaligus.

## 2. Layar inti MVP

### A. Home / ringkasan

- CTA utama: `Buat perjalanan` dan `Gabung perjalanan`.
- Daftar perjalanan berikutnya/aktif.
- Ringkasan klub dan peringatan jalan terdekat bila izin/lokasi tersedia.
- Empty state yang menjelaskan tindakan berikutnya, bukan sekadar layar kosong.

### B. Detail perjalanan

- Judul, waktu, titik kumpul, tujuan, pembuat dan aturan bergabung.
- Status: direncanakan, aktif, selesai, dibatalkan.
- Daftar peserta dan status bergabung.
- Tombol untuk host: `Mulai perjalanan`, `Akhiri perjalanan`.
- Peserta: `Gabung`, `Keluar`, `Buka peta`.

### C. Live convoy map

Hierarki visual yang disarankan:

1. Peta mengisi area terbesar.
2. Status perjalanan dan status berbagi lokasi terlihat konsisten.
3. Peserta/stale indicators dapat dibuka menjadi bottom sheet.
4. Tombol bahaya, chat, dan pengaturan posisi mudah ditemukan dengan target sentuh besar.
5. Jangan menampilkan banyak toast, feed, animasi, atau promosi di atas peta ketika ride aktif.
6. Saat pengguna membuka chat atau form bahaya, beri pengingat berhenti di tempat aman; hindari keyboard otomatis.

Status marker tidak boleh hanya dibedakan dengan warna. Gunakan icon/label dan timestamp seperti `Diperbarui 8 dtk lalu`.

### D. Permission education sheet

Sebelum dialog OS:

- Kenapa lokasi diperlukan;
- kapan sharing akan aktif;
- siapa yang dapat melihat (anggota perjalanan yang sah);
- apakah tetap berjalan di background;
- cara berhenti;
- konsekuensi bila permission ditolak.

Jangan meminta semua permission sekaligus saat onboarding jika fitur belum dipakai. Minta izin saat pengguna memulai fitur yang memerlukannya.

### E. Form road warning

- Pilih kategori besar dan jelas.
- Isi lokasi: titik saat ini atau pin peta.
- Deskripsi opsional, batas karakter, dan tingkat urgensi bila perlu.
- Tampilkan ringkasan sebelum mengirim.
- Tampilkan waktu dan masa berlaku laporan setelah berhasil.
- Sertakan `Laporkan informasi keliru`.

### F. Convoy chat

- Pesan memiliki waktu dan status terkirim/gagal.
- System events (ride dimulai/berakhir, hazard dikirim) dibedakan dari pesan user.
- Jangan autoplay suara notifikasi yang keras atau mengganggu; sediakan preferensi.
- Empty state memberi tahu bahwa chat hanya terlihat oleh peserta perjalanan.

## 3. Status UI yang harus dirancang

- Loading awal dan refresh.
- Empty state (belum ada klub, perjalanan, anggota, laporan).
- Error dan tombol retry.
- Offline / reconnecting.
- Permission denied / restricted.
- GPS off / location accuracy poor.
- Live / stale / location unavailable.
- Upload image progress / failed.
- Ride completed / cancelled.
- User blocked / content removed / moderation pending.

## 4. Prinsip desain visual

- Nuansa teknis, outdoor, dan komunitas boleh kuat, tetapi keterbacaan di luar ruangan tetap utama.
- Kontras tinggi, typography tidak tipis, minimum touch target sekitar 44–48 dp bila mungkin.
- Animasi hanya mendukung status, tidak mengalihkan perhatian.
- Kurangi interaksi selama ride aktif; detail admin, edit, like, komentar, dan pengaturan panjang dilakukan sebelum/ sesudah perjalanan.
- Berikan indikator mic menyala yang sangat jelas pada PTT.
- Sediakan dark mode bila mudah dipelihara, namun jangan mengorbankan kontras atau peta.

## 5. Konten dan microcopy keselamatan

Contoh microcopy:

- `Berbagi lokasi aktif untuk perjalanan ini.`
- `Lokasi terakhir diperbarui 32 detik lalu. Anggota mungkin kehilangan koneksi.`
- `Izinkan lokasi saat aplikasi digunakan terlebih dahulu. Untuk pembaruan di background, Anda akan diminta izin tambahan.`
- `Informasi ini dilaporkan pengguna dan dapat berubah. Tetap patuhi rambu serta kondisi aktual di jalan.`
- `Berhenti di tempat aman sebelum mengetik pesan.`
- `Akhiri perjalanan untuk menghentikan berbagi lokasi.`

## 6. Accessibility & localization checklist

- Semua tombol punya label aksesibilitas.
- Status tidak hanya menggunakan merah/hijau.
- Font dapat diperbesar tanpa menutupi tombol penting.
- Error menggunakan bahasa Indonesia sederhana dan menyebut tindakan pemulihan.
- Timestamp disesuaikan dengan lokal pengguna tetapi data server disimpan dalam UTC.
- Peta memiliki alternatif daftar peserta/laporan untuk pengguna yang memerlukan informasi non-peta.
