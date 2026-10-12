# Roadmap Implementasi

> Perkiraan sprint adalah cara mengurutkan pekerjaan, bukan janji durasi. Waktu aktual bergantung pada pengalaman developer, kondisi dependency, akses backend dan hasil uji perangkat.

## Prinsip eksekusi

- Satu vertical slice berfungsi sebelum berpindah ke fitur berikutnya.
- Kerjakan pada perangkat Android fisik sedini mungkin.
- Buat development build setelah dependency native diperkenalkan.
- P0 harus memenuhi test plan sebelum fitur P2 dimulai.
- Semua perubahan schema lewat migration versioned dan dites di project development.

## Milestone 0 — Fondasi proyek

**Hasil:** repo siap di-build dan dokumentasi menjadi source of truth.

- [ ] Inisialisasi Expo app dengan TypeScript dan Expo Router.
- [ ] Format/lint/typecheck scripts.
- [ ] Environment config dan `.env.example` tanpa secret.
- [ ] Setup Supabase development project.
- [ ] Setup EAS build dan APK development/preview.
- [ ] Error boundary/loading/empty-state primitives.
- [ ] README project berisi cara menjalankan dan aturan branch.

**Exit criteria:** aplikasi terbuka di perangkat; CI lokal typecheck bersih; preview build bisa dipasang.

## Milestone 1 — Auth, profil, privasi dasar

- [ ] Sign in/sign up/reset sesuai provider yang dipilih.
- [ ] Buat/edit profil dan username unik.
- [ ] Pengaturan sesi/logout.
- [ ] Profil privat tidak mengungkap data internal.
- [ ] RLS tests untuk profile.

**Exit criteria:** dua user dapat masuk di perangkat/sesi berbeda; user A tidak dapat mengedit profil user B.

## Milestone 2 — Garasi dan klub

- [ ] CRUD kendaraan; pisahkan detail sensitif.
- [ ] Buat/temukan klub.
- [ ] Join request, approval dan role.
- [ ] Storage foto dengan policy.
- [ ] UI anggota/owner/admin.

**Exit criteria:** non-member tidak bisa membaca detail klub privat atau mengubah anggota; plat privat hanya terlihat owner.

## Milestone 3 — Perjalanan dan live location

- [ ] Create/join/leave ride.
- [ ] State machine planned/active/completed/cancelled.
- [ ] Permission explainer dan location sharing control.
- [ ] Development build dengan background location.
- [ ] Private Realtime channel dan last-known location.
- [ ] Map markers + stale/offline indicators.
- [ ] Stop task saat keluar/ride berakhir.
- [ ] Test battery/network/vendor.

**Exit criteria:** anggota sah melihat update lokasi; non-member ditolak; izin ditolak/GPS mati/network drop dijelaskan; tracking tidak berjalan tanpa ride aktif dan opt-in.

## Milestone 4 — Hazard reports dan convoy chat

- [ ] CRUD report dan expiry rules.
- [ ] Marker/list/filter laporan.
- [ ] Report abuse/confirm report.
- [ ] Chat persisted + realtime events.
- [ ] System messages untuk start/end/member changes.
- [ ] Rate limits dan error states.

**Exit criteria:** report kedaluwarsa tidak aktif; chat tidak dapat dibaca non-member; retry tidak membuat duplicate message.

## Milestone 5 — Push, polish dan beta

- [ ] Push notification undangan/status perjalanan.
- [ ] Kategori dan preferensi notifikasi dasar.
- [ ] Loading/offline/error/empty states lengkap.
- [ ] Android device matrix dan accessibility pass.
- [ ] Crash/error monitoring tanpa lokasi presisi.
- [ ] Privacy policy, delete account flow, support contact.
- [ ] Security and release checklist.

**Exit criteria:** semua P0 acceptance test lulus dan tidak ada blocker severity tinggi.

## Milestone 6 — Feed dan komunitas sosial (P1)

- [ ] Post teks/foto.
- [ ] Like, komentar, follow/follow-back.
- [ ] Notification activity.
- [ ] Block/report/moderation queue.
- [ ] Pagination, media optimization, storage cleanup.

**Exit criteria:** idempotent reactions, RLS tests lulus, upload/access/delete media dites.

## Milestone 7 — Voice PTT proof-of-concept (P2)

- [ ] Pilih penyedia dan lakukan analisis biaya/privacy.
- [ ] EAS development build dengan native WebRTC dependency.
- [ ] Edge Function token endpoint dengan authorization.
- [ ] Join/leave/mute/PTT state machine.
- [ ] Uji dengan minimal beberapa Android dan headset/helmet intercom berbeda.
- [ ] Uji screen lock, app background, wifi-to-cellular, baterai, mic permissions, audio focus.
- [ ] Tidak menampilkan klaim hands-free universal jika belum tervalidasi.

**Exit criteria:** PTT stabil untuk perangkat yang didukung dan limitation dipublikasikan.

## Milestone 8 — Musik lokal dan penyempurnaan lanjutan (P2)

- [ ] Pilih file lokal menggunakan API media yang sesuai Android.
- [ ] Playback controls + audio focus.
- [ ] Background playback sesuai konfigurasi yang diizinkan.
- [ ] Uji transisi voice ↔ music, panggilan sistem dan lock screen.

## Kriteria siap rilis umum

- PRD acceptance terpenuhi.
- Automated tests dan manual smoke tests lulus.
- Security/RLS negative tests lulus.
- No secrets in repository/build.
- Versi Android minimum/perangkat yang didukung tertulis.
- Kebijakan privasi, terms, report/abuse path dan deletion flow tersedia.
- Biaya infra, maps/tiles, notification dan audio dievaluasi dengan pilot data.
- Build artifact dan source commit ditandai dengan release tag.
