# Rencana implementasi FR-09 — Push notification tanpa perangkat fisik

| Metadata | Nilai |
|---|---|
| Tanggal | 7 November 2026 |
| Status | **Rencana** — belum ada kode, dependency, atau migration baru |
| Basis | `main` @ `ccd5b18` (PR #25–#27 sudah merge) |
| Rujukan | `docs/PRD.md` FR-09 dan §12 (kriteria rilis beta), `docs/MILESTONE_5_PLAN.md` §2, ADR-083 |
| Sifat dokumen | Urutan kerja + batas verifikasi, bukan klaim hasil |

Dokumen ini menjawab satu pertanyaan: **apa yang bisa dikerjakan dan dibuktikan benar tanpa perangkat
fisik, dan apa yang tetap butuh pemilik + HP.** Tidak ada satu pun status di sini yang boleh dibaca
sebagai "sudah jalan"; semua adalah target per fase.

## 1. Kondisi awal (fakta di repositori)

| Komponen | Keadaan sekarang | Bukti |
|---|---|---|
| Tabel `public.notifications` | **Ada** — `kind` dibatasi 10 nilai (`ride_invite`, `ride_started`, `ride_ended`, `club_join_request`, `club_join_approved`, `like`, `comment`, `follow`, `follow_back`, `system`), kolom `payload jsonb`, `read_at` | `supabase/migrations/20261013022938_initial_schema.sql:219` |
| Policy `notifications` | SELECT dan UPDATE hanya untuk penerima; **tidak ada policy INSERT** — komentar skema menyatakan insert khusus backend | idem, sekitar baris 521 |
| Tabel `public.push_tokens` | **Ada** — `token` unik, `platform` ∈ (`android`,`ios`,`other`), `last_seen_at` | idem, baris 232 |
| Policy `push_tokens` | SELECT/INSERT/UPDATE/DELETE milik sendiri (`user_id = auth.uid()`) | idem, baris 527–533 |
| Pembersihan saat akun dihapus | `push_tokens` dan `notifications` penerima sudah ikut dihapus di `purge_account_data` | `20261023004946_account_deletion_identity.sql:432` |
| Trigger/RPC pembuat notifikasi | **Tidak ada** — tidak ada satu pun `insert into public.notifications` di migration | `grep` seluruh `supabase/migrations/` |
| Dependency klien | **Tidak ada** `expo-notifications` maupun `expo-device` | `package.json` |
| Izin Android | `android.permission.POST_NOTIFICATIONS` sudah dideklarasikan | `app.json` |
| `projectId` EAS | Ada (`extra.eas.projectId`), syarat `getExpoPushTokenAsync` | `app.json` |
| Plugin `expo-notifications` | Belum terdaftar di `plugins` (ikon/warna kanal Android belum diatur) | `app.json` |
| Edge Function pengirim | **Tidak ada**; yang ada hanya `delete-account` (`index.ts` + `orchestrator.mjs` + `cors.mjs`) | `supabase/functions/` |
| Ekstensi penjadwal | Hanya `pgcrypto`; `pg_cron`/`pg_net` belum dipasang | `20261013022938_initial_schema.sql:5` |
| Penanda peristiwa domain | RPC sudah ada: `request_club_membership`, `review_club_membership`, `invite_ride_member`, `accept_ride_invite`, `transition_ride` | `grep "create or replace function public\."` |

Konsekuensinya: pekerjaan FR-09 **bukan** membangun skema dari nol. Yang hilang adalah empat sambungan:
preferensi pengguna, pembuatan baris notifikasi dari peristiwa domain, klien yang mendaftarkan token,
dan pengirim yang memanggil layanan push.

## 2. Batas verifikasi tanpa perangkat

Batas ini yang menentukan bentuk fase kerja. Jangan menyusun fase yang hanya bisa ditutup dengan HP.

| Hal | Bisa dibuktikan di mesin ini | Butuh perangkat / kredensial pemilik |
|---|---|---|
| Skema, constraint, RLS, dedupe, preferensi | Ya — `db:test` (butuh `.env.db`) | — |
| Pembuatan baris notifikasi dari RPC domain | Ya — uji SQL transaksional | — |
| Penyusunan payload, batching, retry, pemangkasan token mati | Ya — Node test dengan `fetch` di-mock (`scripts/__tests__/`) | — |
| Alur izin, registrasi token, layar preferensi di aplikasi | Ya — Jest dengan modul native di-mock | — |
| Bundle tidak membawa secret (`EXPO_ACCESS_TOKEN`, service role) | Ya — `deps:check` + pemindaian statis | — |
| **Mengambil `ExponentPushToken[...]` sungguhan** | **Tidak** — remote push tidak tersedia di Expo Go sejak SDK 53 | Development build di perangkat |
| **Izin OS Android 13 tampil/ ditolak/ diaktifkan lagi dari Settings** | **Tidak** | Perangkat |
| **Kiriman sampai ke notifikasi, tap membuka layar yang benar, perilaku foreground** | **Tidak** | Perangkat + kredensial FCM v1 |
| **Kredensial FCM v1 (Google/Firebase) dan `EXPO_ACCESS_TOKEN`** | **Tidak boleh dan tidak bisa** — milik pemilik | `eas credentials`, dashboard Expo/Supabase |

Karena itu status realistis yang bisa dicapai di lingkungan ini adalah **Implemented** dan **Passed
locally**; **Passed against dev backend** hanya untuk bagian SQL bila `.env.db` tersedia; **Tested on
physical device** tetap **Blocked** untuk semua butir pengiriman.

## 3. Arsitektur yang dipilih

```
peristiwa domain (RPC yang sudah ada)
        │  trigger AFTER INSERT/UPDATE (satu transaksi)
        ▼
public.notifications  ──(filter preferensi saat kirim)──┐
        │  pg_cron tiap 60 detik                        │
        ▼                                               │
pg_net → Edge Function send-push ──► Expo Push API ──► FCM ──► perangkat
        │                                    │
        │  tandai terkirim / attempts        └─ DeviceNotRegistered → hapus token
        ▼
public.notification_deliveries (baru, additive)
```

Keputusan yang menyertainya:

1. **Pembuatan baris di database, pengiriman di server.** Trigger hanya menulis `notifications`; tidak
   ada pemanggilan HTTP dari trigger (transaksi tetap murah dan bisa di-`ROLLBACK` di uji).
2. **Preferensi disaring saat kirim, bukan saat insert.** Baris tetap tercatat sebagai riwayat in-app;
   preferensi hanya menentukan apakah ia juga dikirim sebagai push. Ini menghindari kehilangan riwayat
   ketika pengguna menyalakan kembali kategori.
3. **Status kirim disimpan di tabel terpisah**, bukan kolom baru pada `notifications`, supaya riwayat
   pengguna tidak bisa mengubah status pengiriman (RLS `notifications` mengizinkan UPDATE oleh penerima).
4. **Penjadwalan dengan `pg_cron` + `pg_net`**, bukan GitHub Actions cron: jadwal Actions minimum 5
   menit dan sering tertunda, sedangkan notifikasi perjalanan butuh < 1 menit.
5. **Tanpa koordinat di payload.** Body hanya menyebut jenis peristiwa; `payload` menyimpan `entity_id`
   dan deep link, bukan `lat`/`lng` (PRD FR-09 dan `docs/SECURITY_PRIVACY.md`).

## 4. Fase kerja

Setiap fase: satu branch, satu PR, gate hijau sebelum lanjut. Urutannya dibuat supaya fase yang tidak
butuh database tetap bisa selesai lebih dulu.

### Fase A — Preferensi notifikasi (SQL + layar)

**Tujuan:** pengguna bisa mematikan kategori tanpa mematikan izin OS, dan server punya tempat membaca
pilihan itu.

1. Migration baru (nama lewat CLI, jangan mengarang timestamp):
   `npx supabase migration new notification_preferences`
   - `public.notification_preferences (user_id uuid references public.profiles(id) on delete cascade,
     kind text, enabled boolean not null default true, updated_at timestamptz, primary key (user_id, kind))`
   - `kind` dibatasi nilai yang sama dengan `notifications.kind`; tambahkan komentar bahwa daftar itu
     harus ikut berubah bila constraint `notifications` berubah.
   - RLS aktif, policy SELECT/INSERT/UPDATE/DELETE hanya `user_id = auth.uid()`.
   - Tidak ada baris default: tidak adanya baris berarti **aktif** (membuat 10 baris per pengguna saat
     onboarding tidak sepadan).
2. Uji SQL `supabase/tests/rls_notification_preferences_test.sql`:
   - pengguna A tidak bisa membaca/menulis baris pengguna B (0 baris, bukan galat);
   - `anon` ditolak;
   - `kind` di luar daftar ditolak constraint;
   - hapus data pengguna menghapus preferensinya.
   - Wajib: direktif `-- db:test notice: UJI PREFERENSI NOTIFIKASI LULUS`, terdaftar di
     `DEFAULT_TEST_FILES` (`scripts/db-test.mjs`), dan notice-nya ada di
     `.github/workflows/database-rls.yml`.
3. Layar `src/app/notification-settings.tsx` + `src/features/notifications/preferences.ts`:
   daftar kategori MVP saja (undangan perjalanan, mulai/selesai perjalanan, permintaan gabung klub,
   persetujuan klub), plus baris status izin OS yang bersifat **baca saja** dengan tombol
   `Linking.openSettings()`.
4. Uji Jest: memuat preferensi, toggle menulis satu baris, galat jaringan tidak mengubah tampilan
   optimistis tanpa penanda.

**Gate:** `npm run typecheck`, `npm test -- --ci`, `npm run db:test` (bila `.env.db` ada).
**Bisa selesai tanpa perangkat:** ya, kecuali butir `db:test` yang butuh DB dev.

### Fase B — Membuat baris notifikasi dari peristiwa domain

**Tujuan:** peristiwa yang sudah punya RPC menghasilkan baris `notifications` yang benar penerimanya.

1. Satu migration (`npx supabase migration new notification_events`) berisi trigger untuk MVP:
   - `club_members`/permintaan bergabung → `club_join_request` ke owner+admin klub (bukan ke pemohon);
   - `review_club_membership` disetujui → `club_join_approved` ke pemohon;
   - `transition_ride` ke `active` → `ride_started` ke peserta aktif selain pelaku;
   - `transition_ride` ke `completed`/`cancelled` → `ride_ended` ke peserta aktif selain pelaku;
   - `invite_ride_member` → `ride_invite` ke yang diundang.
   - Setiap trigger: `security definer`, `search_path = ''`, dan **tidak** membuat baris untuk pelaku
     sendiri.
2. Dedupe di database: partial unique index atau pemeriksaan `exists` dalam jendela waktu
   (mis. satu `ride_started` per `entity_id` per penerima). Ini yang membuat pengiriman ulang aman.
3. Uji SQL `rls_notification_dispatch_test.sql`: penerima benar, pelaku tidak menerima, dedupe bekerja,
   peristiwa yang tidak berhak tidak menghasilkan baris, dan hapus data membersihkan baris.
4. **Tidak** membuat notifikasi sosial (`like`, `comment`, `follow`) — FR-08 belum ada di aplikasi.

**Gate:** sama seperti Fase A, plus `npm run test:scripts` (harness `db-test.test.mjs` ikut memeriksa
pendaftaran berkas uji).

### Fase C — Klien: izin dan pendaftaran token

**Tujuan:** aplikasi memasang token perangkat ke `push_tokens` bila izin diberikan, dan tidak melakukan
apa pun bila tidak.

1. Dependency: `npx expo install expo-notifications expo-device` (SDK 57 → `expo-notifications@57.0.25`,
   `expo-device@57.0.2`). Jangan menulis versi manual; `npm run deps:check` memakai `expo install --check`
   sehingga versi harus datang dari CLI.
2. `app.json`: tambahkan plugin `expo-notifications` dengan warna ikon; biarkan
   `POST_NOTIFICATIONS` (sudah ada) — jangan menduplikasi izin.
3. `src/features/notifications/registration.ts`:
   - buat channel Android **sebelum** meminta izin (syarat prompt Android 13);
   - `Device.isDevice` guard; di emulator/simulator kembalikan status `unsupported` tanpa melempar;
   - `Notifications.getExpoPushTokenAsync({ projectId })` dengan `projectId` dari
     `Constants.expoConfig.extra.eas.projectId`;
   - hasil berupa union `granted | denied | unsupported | error`, tidak pernah `throw` ke layar.
4. `src/features/notifications/api.ts`: upsert ke `push_tokens` dengan `onConflict: 'token'`, mengisi
   `user_id`, `platform`, `last_seen_at`; hapus token saat pengguna mematikan notifikasi di aplikasi.
   Semua operasi tunduk pada RLS yang sudah ada — tidak ada policy baru.
5. Panggil registrasi sekali setelah sesi anonim siap (di `src/features/auth/session.tsx` atau
   `src/app/_layout.tsx`), bukan di setiap render.
6. Uji Jest (`src/features/notifications/__tests__/`): izin ditolak, `isDevice` false, `projectId`
   kosong, token berubah (listener), server 401/500, dan assert **tidak ada** panggilan jaringan saat
   izin ditolak.

**Gate:** `npm run typecheck`, `npm test -- --ci`, `npm run deps:check`, `npm run export:android`
(membuktikan bundel tetap terbangun, **bukan** membuktikan push).
**Status yang boleh diklaim:** Implemented, Passed locally. Pengambilan token nyata: **Blocked**.

### Fase D — Edge Function pengirim + uji tanpa jaringan

**Tujuan:** baris yang belum terkirim diubah menjadi panggilan Expo Push API yang benar, aman diulang.

1. `supabase/functions/send-push/` mengikuti pola `delete-account`:
   - `index.ts` tipis: verifikasi pemanggil (service role/JWT internal + `cors.mjs`), baca batch,
     panggil `orchestrator.mjs`, kembalikan ringkasan;
   - `orchestrator.mjs` murni (tanpa `Deno.*`): ambil notifikasi `push_attempted_at is null`,
     kelompokkan per penerima, saring `notification_preferences`, batasi 100 pesan per request
     (batas Expo), kirim, catat hasil, pangkas token pada `DeviceNotRegistered`, retry 429/5xx dengan
     backoff, dan berhenti setelah N percobaan.
   - Payload: `title`/`body` per `kind` dalam Bahasa Indonesia, `data: { kind, entity_id }` — tanpa
     koordinat, tanpa isi chat.
2. Migration additive (`npx supabase migration new notification_deliveries`) untuk
   `public.notification_deliveries (notification_id uuid primary key references public.notifications(id)
   on delete cascade, attempts int, last_attempt_at timestamptz, status text check (…'pending','sent',
   'failed','skipped'), last_error text)`, RLS aktif **tanpa policy** (hanya service role), plus
   kolom/indeks yang dibutuhkan pengambil batch.
3. Uji Node `scripts/__tests__/send-push.test.mjs` dengan `fetch` di-mock:
   - batching > 100 dipotong benar;
   - satu penerima dengan 3 token menerima 3 pesan, satu baris `notifications` tetap satu;
   - `DeviceNotRegistered` menghapus token itu saja;
   - 429 lalu sukses tidak menggandakan pesan;
   - preferensi `enabled = false` → status `skipped`, bukan `sent`;
   - payload tidak memuat `lat`/`lng` (assert pada JSON terkirim).
4. Secret: `EXPO_ACCESS_TOKEN` diset pemilik lewat `npx supabase secrets set` / dashboard. **Jangan**
   pernah menaruhnya di `.env`, `app.json`, atau kode klien.

**Gate:** `npm run test:scripts`, `npm run db:test` untuk uji RLS tabel baru, `npm run typecheck`.
**Status:** Implemented, Passed locally. Pengiriman nyata: **Blocked**.

### Fase E — Penjadwalan, observabilitas, dokumentasi

1. Migration `npx supabase migration new notification_scheduler`: `create extension if not exists
   pg_cron; create extension if not exists pg_net;` lalu job `cron.schedule('send-push', '* * * * *', …)`
   yang memanggil `net.http_post` ke URL function dengan secret dari Vault. Bila ekstensi tidak
   diizinkan di project, hentikan fase ini dan laporkan — jangan menggantinya dengan pemanggilan dari
   klien.
2. Indikator: hitung `pending`/`failed` per hari, log tanpa isi pesan dan tanpa token penuh (cetak 6
   karakter awal saja).
3. `docs/QA_TEST_PLAN.md` §8i baru: matriks uji perangkat (di bawah), plus bagian gejala notifikasi di
   runbook operasional tanpa akun (`docs/RUNBOOK_TANPA_AKUN.md`, setelah PR runbook merge).
4. `docs/PRD.md` §12: catat FR-09 sebagai belum diuji di perangkat, bukan sebagai syarat beta yang
   sudah lulus; bila revisi §12.2 (branch `docs/prd-status-jujur`) sudah merge, perbarui baris FR-09 di
   tabel butir tertunda agar menunjuk dokumen ini.

## 5. Matriks uji perangkat (untuk pemilik — semua Blocked di sini)

| # | Skenario | Kriteria lulus |
|---|---|---|
| 1 | Instal development build, buka aplikasi, izin notifikasi muncul **setelah** penjelasan | Prompt Android 13 tampil sekali; penolakan tidak memblokir aplikasi |
| 2 | Tolak izin, lalu aktifkan dari Settings | Setelah kembali, aplikasi mendaftarkan token tanpa restart |
| 3 | Undang identitas B ke perjalanan dari A | B menerima notifikasi < 60 detik; teks tanpa lokasi |
| 4 | Tap notifikasi saat aplikasi tertutup | Aplikasi membuka layar perjalanan yang benar, bukan layar awal |
| 5 | Aplikasi di foreground saat notifikasi datang | Tidak ada duplikat banner + daftar dalam aplikasi |
| 6 | Matikan kategori "perjalanan dimulai" di layar preferensi | Baris tetap ada di daftar in-app, tidak ada push |
| 7 | Copot pemasangan aplikasi (token mati), lalu kirim | Pengirim memangkas token; tidak ada galat berulang di log |
| 8 | Mode pesawat 1 menit lalu nyalakan | Tidak ada notifikasi ganda saat jaringan pulih |
| 9 | Penerima sudah keluar dari perjalanan | Tidak menerima notifikasi perjalanan itu |
| 10 | Dua perangkat, satu identitas (bila didukung) | Keduanya menerima; satu baris `notifications` per peristiwa |

## 6. Keputusan yang bukan milik implementasi

1. **Kredensial FCM v1** (`google-services.json` / kunci servis) harus diunggah pemilik lewat
   `eas credentials`. Tanpa itu, build bisa dibuat tetapi Android tidak menerima kiriman.
2. **`EXPO_ACCESS_TOKEN`** — opsional untuk Expo Push API, tetapi disarankan agar pengiriman tidak
   berbagi kuota anonim. Disimpan sebagai secret function.
3. **Jam tenang (quiet hours)** dan frekuensi maksimum per pengguna: belum ada di PRD; usul 22.00–06.00
   untuk kategori sosial (P1), **tidak** untuk keselamatan perjalanan.
4. **Isi notifikasi**: usul `ride_started` = "Perjalanan dimulai", tanpa nama lokasi/titik kumpul,
   karena lock screen bisa dibaca orang lain.
5. **Biaya**: Expo Push gratis; batas praktis ada di FCM. Tidak ada vendor baru selain Firebase.

## 7. Definisi selesai per status

| Klaim | Syarat artefak |
|---|---|
| Implemented | Kode/migration ada, `typecheck` + `lint` + `format:check` hijau |
| Passed locally | `npm test`, `npm run test:scripts` hijau; `db:test` hijau bila menyentuh SQL |
| Passed against dev backend | Migration diterapkan ke project dev **dan** `db:test` dijalankan terhadapnya; hasil tercatat di `QA_TEST_PLAN` §8i |
| Tested on physical device | Baris 1–10 §5 dijalankan pada development build dan dicatat per kasus |

Sampai baris terakhir itu terisi, FR-09 tetap **belum** boleh disebut berfungsi di PRD, CHANGELOG, atau
materi rilis.

## 8. Urutan branch dan PR

| # | Branch | Isi | Bergantung pada |
|---|---|---|---|
| 1 | `feat/notif-preferences` | Fase A | `main` |
| 2 | `feat/notif-events` | Fase B | #1 (butuh tabel preferensi untuk uji kirim) |
| 3 | `feat/notif-client` | Fase C | #1 (layar preferensi) |
| 4 | `feat/notif-sender` | Fase D | #2, #3 |
| 5 | `feat/notif-scheduler` | Fase E | #4 |

Fase C boleh dikerjakan paralel dengan B karena tidak menyentuh SQL. Fase D tidak boleh dimulai
sebelum B dan C merge: tanpa baris nyata dan token nyata, uji D hanya menguji mock.
