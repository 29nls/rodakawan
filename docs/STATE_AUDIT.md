# Inventaris State Layar (Expo SDK 57, RN 0.86)

Status dokumen: **diperbarui 26 Oktober 2026** setelah audit ulang terhadap kode
`src/app` dan `src/features`. Versi sebelumnya menyebut layar yang tidak ada
(`community.tsx`, `hazards.tsx`, `profile.tsx`, `sign-in.tsx`, dan seterusnya),
menyatakan `StateView` tidak dipakai, dan menggambarkan kebijakan privasi punya
banner error — semuanya tidak cocok lagi dengan kode. Dokumen ini adalah
inventaris, bukan rencana; bila kode berubah, dokumen ini ikut berubah.

Kontrak produk tetap di [`docs/UX_SITEMAP.md`](UX_SITEMAP.md) bagian 3: setiap
layar harus punya loading awal/refresh, empty state yang menjelaskan langkah
berikutnya, error dengan tombol retry, dan penanganan offline/reconnecting.
Yang belum dipenuhi dicatat di §6, bukan dianggap selesai.

## 1. Primitif yang dipakai

| Primitif | Lokasi | Perilaku |
| --- | --- | --- |
| `LoadingState` | `src/components/ui/StateView.tsx` | Spinner + label; `accessibilityRole="progressbar"`. |
| `ErrorState` | sama | Judul, deskripsi yang menyebut tindakan pemulihan, tombol **Coba lagi** bila `onRetry` diberikan. |
| `EmptyState` | sama | `StateView` bernada netral; wajib menjelaskan langkah berikutnya dan biasanya diberi CTA. |
| `UnavailableState` | sama | Nada aksen untuk fitur/kondisi yang belum bisa dibuka (belum tersedia, bukan error server). |
| `Banner` | `src/components/ui/Banner.tsx` | Pesan sukses/peringatan/bahaya untuk aksi (bukan untuk state muat awal). |
| `BackendUnavailableBanner` | `src/features/auth/components/BackendUnavailableBanner.tsx` | Banner khusus backend belum dikonfigurasi; menyebut langkah `.env.local`. |
| `RouteErrorBoundary` | `src/components/feedback/RouteErrorBoundary.tsx` | Menangkap error render level route, memakai `ErrorState` + detail hanya saat `__DEV__`. |
| `screenPrecondition` | `src/features/state-helper.ts` | Mengubah backend/sesi yang belum siap menjadi `AppError` (`backend_not_configured` / `session_expired`). |
| `formatErrorMessage` | sama | Memetakan error tak dikenal ke pesan Bahasa Indonesia + tindakan pemulihan. |

Aturan yang dipakai seragam: **backend/sesi belum siap bukan keadaan loading.**
Layar tidak boleh menampilkan spinner tanpa akhir; ia menampilkan
`UnavailableState` (atau `BackendUnavailableBanner` + state yang bisa dipulihkan)
dan tidak menampilkan empty state palsu seolah-olah datanya memang kosong.

## 2. Sumber state

| Sumber | Lokasi | Bentuk state |
| --- | --- | --- |
| `useAuthSession()` | `src/features/auth/session.tsx` | `status: 'loading' \| 'ready'`, `session`, `userId`, `email`, `backend` (`available: true` + client, atau `available: false` + `reason`), `signOut()`. |
| `useProfile()` | `src/features/profile/useProfile.ts` | `{ status: 'loading' }`, `{ status: 'ready', profile: ProfileRow \| null }`, `{ status: 'error', error: AppError }`, plus `reload()`. Prasyarat backend/sesi sudah diturunkan menjadi `error`. |
| `useAppStatus()` | `src/hooks/useAppStatus.ts` | Info build dari `expo-constants` + `backend` untuk diagnosa; tanpa query jaringan. |
| `useFocusEffect` | layar tab (`rides`, `hazards`) | Memuat ulang saat tab difokuskan; token reload manual ditambahkan lewat `reloadToken`. |
| State data per layar | masing-masing `src/app/*.tsx` | Discriminated union eksplisit, mis. `loading \| ready \| error` dan `loading \| missing \| ready \| error`. |
| `ChatPanel` | `src/features/chat/ChatPanel.tsx` | `status: 'loading' \| 'ready' \| 'error'` untuk pesan, plus `connection: 'connecting' \| 'online' \| 'offline'` untuk realtime. |
| `PhotoCard` | `src/features/media/components/PhotoCard.tsx` | `busy` (tombol nonaktif + label “Memproses…”), `hasPhoto`, `emptyText`. |
| `MapStatusCard` / `resolveMapRenderState` | `src/features/map/` | `unconfigured` / `renderer_missing` / `ready`; adapter MapLibre terdaftar, tanpa tile palsu. |

## 3. Inventaris per layar

Tabel ini menyebut apa yang **benar-benar dirender** oleh kode, bukan niat desain.

| Layar | Model state | Loading | Error | Empty / belum tersedia | Retry |
| --- | --- | --- | --- | --- | --- |
| `src/app/_layout.tsx` | — | — | `RouteErrorBoundary` (ekspor `ErrorBoundary`) | — | Tombol di `ErrorState` memanggil `retry()`. |
| `src/app/index.tsx` (gerbang sesi) | `status` dari `useAuthSession` | `LoadingState "Memeriksa sesi…"` + catatan sesi aman | Redirect ke `/sign-in` bila sesi tidak ada | — | — |
| `(auth)/_layout.tsx` | `Stack.Protected` berbasis sesi | — | — | — | — |
| `(auth)/sign-in.tsx` | form + `submitting` | Label tombol “Memproses…” | `Banner` dari `AppError` | `BackendUnavailableBanner`; tombol kirim nonaktif | Kirim ulang manual |
| `(auth)/sign-up.tsx` | form + `submitting` + `awaitingConfirmation` + `resending` | Label tombol | `Banner "Pendaftaran gagal"` | Banner konfirmasi email; banner status kirim ulang | Kirim ulang tautan konfirmasi |
| `(auth)/forgot-password.tsx` | form + `submitting` + `sent` | Label tombol | `Banner "Gagal mengirim"` | Kartu “tautan terkirim” | Kirim ulang manual |
| `auth/callback.tsx` | `CallbackState`: `working \| signed-in \| recovery \| incomplete \| failed` | `LoadingState "Memverifikasi tautan…"` | Banner + tombol ke halaman masuk | `incomplete` → banner tautan tidak lengkap | Minta tautan baru |
| `reset-password.tsx` | form + `attempted` + `submitting` + `updated` | Label tombol | `Banner "Gagal menyimpan"` | `BackendUnavailableBanner`; tombol nonaktif | Kirim ulang manual |
| `(tabs)/ringkasan.tsx` | statis (`useAppStatus`, `constants/roadmap`) | — | — | — | — |
| `(tabs)/rides.tsx` | `loading \| ready \| error` | `LoadingState "Memuat perjalanan…"` | `ErrorState` + retry | `EmptyState "Belum ada perjalanan"` + CTA; `UnavailableState` bila backend/sesi belum siap | `reload()` |
| `(tabs)/hazards.tsx` | `loading \| ready \| error` + state form/aksi | `LoadingState "Memuat laporan bahaya…"` | `ErrorState` + retry; `Banner` untuk aksi | `EmptyState "Tidak ada laporan aktif"` (ikut filter); `UnavailableState` bila backend/sesi belum siap | `reload()` |
| `(tabs)/community.tsx` | `loading \| ready \| error` + form buat klub | `LoadingState "Memuat klub…"` | `ErrorState` + retry; `Banner` untuk aksi | `EmptyState "Belum ada klub publik"`; catatan “tidak ada hasil pencarian”; `UnavailableState` bila backend/sesi belum siap | `reload()` |
| `(tabs)/profile.tsx` | `useProfile` + state avatar/keluar | `LoadingState "Memuat profil…"` di dalam kartu | Pesan + tombol **Coba lagi** (inline, bukan `ErrorState`) | “Profil belum ada” + CTA lengkapi; `BackendUnavailableBanner` | `reload()` |
| `profile/edit.tsx` | `useProfile` + `submitting` | `LoadingState "Memuat profil…"` | `Banner "Profil belum bisa dimuat"` + arahan muat ulang | Catatan “Profil belum terisi” saat `profile === null` | Muat ulang layar |
| `account-delete.tsx` | `useProfile` + konfirmasi + `busy` | `LoadingState "Memuat profil Anda…"` | `Banner "Profil belum bisa dimuat"` + tombol **Coba lagi** | “Profil belum termuat” + tombol hapus nonaktif | `reload()` |
| `garage.tsx` | `loading \| ready \| error` + form | `LoadingState "Memuat kendaraan…"` | `ErrorState` + retry (satu tempat, tidak dobel) | `EmptyState "Garasi masih kosong"`; `UnavailableState` bila backend/sesi belum siap | `reload()` |
| `vehicle.tsx` | `loading \| missing \| ready \| error` | `LoadingState "Memuat kendaraan…"` | `ErrorState` + retry; `Banner` untuk aksi | `missing` → “Kendaraan tidak ditemukan”; “Kendaraan tidak dikenali” bila tanpa ID; `UnavailableState` untuk prasyarat | `reload()` |
| `club.tsx` | `loading \| missing \| ready \| error` | `LoadingState "Memuat klub…"` | `ErrorState` + retry; `Banner` untuk aksi | `missing` → “Klub tidak bisa dibuka”; “Klub tidak dikenali” bila tanpa ID; `UnavailableState` untuk prasyarat; daftar anggota kosong diberi catatan | `reload()` |
| `club-admin.tsx` | `loading \| forbidden \| ready \| error` | `LoadingState "Memuat keanggotaan…"` | `ErrorState` + retry; `Banner` untuk aksi | `forbidden` → “Bukan admin klub”; direktori kosong → catatan filter; prasyarat/tanpa ID ditangani | `reload()` |
| `ride-new.tsx` | `clubs: null \| array` + `loadProblem` + `busy` | `LoadingState "Memuat klub Anda…"` | `UnavailableState` dari `loadProblem` (bukan error mentah) | “Belum ada klub aktif” + CTA cari klub; `UnavailableState` untuk prasyarat | Kembali / buka Komunitas |
| `ride.tsx` | `loading \| ready \| error` + state aksi & pelacakan | `LoadingState "Memuat perjalanan…"` (**sebelumnya layar kosong**) | `ErrorState "Perjalanan gagal dimuat"` + retry (**sebelumnya layar kosong**) | “Perjalanan tidak dikenali” bila tautan tanpa ID; `UnavailableState` untuk prasyarat; chat punya state sendiri | `reload()` |
| `moderation.tsx` | `loading \| ready \| error` + audit | `LoadingState` | `ErrorState "Antrean gagal dimuat"` + retry; audit gagal dimuat secara terpisah | `EmptyState "Tidak ada laporan menunggu"`; `UnavailableState` untuk prasyarat | `reload()` |
| `privacy.tsx` | **tanpa state** | — | — | Teks selalu tampil, termasuk offline/tanpa sesi | — |
| `system.tsx` | statis + `useAppStatus` + `useAuthSession` | — | — | Menampilkan “Belum terbaca/belum diset” untuk nilai yang tidak ada | — |
| `+not-found.tsx` | — | — | — | `EmptyState "Halaman tidak ditemukan"` + CTA | CTA ke ringkasan |

## 4. Pola yang dipakai

1. **Discriminated union, bukan boolean berserak.** Layar data memakai
   `{ status: 'loading' | 'ready' | 'error' }` (atau varian dengan `missing` /
   `forbidden`), sehingga tidak mungkin merender daftar dan error sekaligus.
2. **Prasyarat backend/sesi lewat `screenPrecondition`.** Dipakai di
   `rides`, `hazards`, `community`, `garage`, `vehicle`, `club`, `club-admin`,
   `ride`, `ride-new`, dan `moderation`. Hasilnya `AppError` yang langsung
   dirender sebagai `UnavailableState`, jadi tidak ada spinner abadi.
3. **Empty state bukan pengganti error.** Bila backend belum siap, layar TIDAK
   menampilkan “Belum ada data”; itu dulu terjadi di tab Perjalanan dan
   Peringatan karena state diisi daftar kosong saat prasyarat gagal.
4. **Retry selalu memuat ulang dari server.** `reload()` menaikkan
   `reloadToken` (atau memanggil ulang `useProfile.reload()`), bukan mengubah
   state lokal menjadi “seolah berhasil”.
5. **Aksi punya state sendiri.** `busy`/`submitting` menonaktifkan tombol dan
   mengganti label; hasilnya `Banner` sukses atau `Banner` bahaya. Pesan sukses
   tidak pernah menggantikan state data.
6. **Tidak ada data contoh.** Layar kosong menampilkan penjelasan dan CTA, bukan
   baris palsu (lihat juga `docs/UX_SITEMAP.md` bagian 3).

## 5. Offline dan realtime

Aplikasi **belum** memakai pustaka konektivitas (tidak ada NetInfo), jadi tidak
ada banner offline global. Yang benar-benar terjadi:

| Kondisi | Perilaku saat ini |
| --- | --- |
| Permintaan gagal karena jaringan | `mapAuthError`/`mapTableError`/`mapStorageError` mengembalikan `code: 'network'` dengan pesan “Periksa koneksi internet Anda, lalu coba lagi. Data yang sudah Anda isi tidak hilang.” Layar menampilkan `ErrorState`/`Banner` dengan tombol retry. |
| Realtime chat terputus | `ChatPanel` menampilkan badge `connecting`/`online`/`offline` dan `Banner` peringatan saat `offline`; pesan yang sudah dimuat tetap terlihat. |
| Belum pernah ada posisi peserta | `locationFreshness()` mengembalikan `offline`; label umur posisi menjelaskan kapan terakhir diperbarui. |
| Unggah foto gagal | `PhotoCard` kembali dari `busy`, error tampil sebagai `Banner`; objek yatim disapu di latar belakang saat garasi dimuat (`sweepOrphanVehiclePhotos`). |
| Aksi tulis saat offline | Tidak ada antrean/outbox. Aksi gagal dengan pesan yang bisa diulang; pengguna harus menekan ulang setelah koneksi kembali. Ini batasan yang diketahui, bukan perilaku “berhasil diam-diam”. |

Tidak ada klaim “offline-first”: aplikasi butuh backend untuk membaca dan
menulis data. Kebijakan privasi tetap bisa dibaca offline karena statis.

## 6. Celah yang masih terbuka

| Celah | Dampak | Catatan |
| --- | --- | --- |
| Tidak ada deteksi konektivitas global | Pengguna baru tahu offline setelah satu permintaan gagal; tidak ada banner “kembali online”. | Butuh dependency baru (`@react-native-community/netinfo`) → keputusan tersendiri, belum diambil. |
| Tidak ada antrean tulis offline | Aksi yang gagal saat offline harus diulang manual. | Sesuai ADR saat ini: tidak ada klaim sukses palsu. |
| Progres unggah tidak persentase | `PhotoCard` hanya `busy` + “Memproses…”. | Perlu event progres dari Storage API; belum ada. |
| Retry tanpa backoff otomatis | Retry hanya lewat tombol pengguna. | Tidak ada penjadwalan ulang otomatis. |
| `profile.tsx` memakai pesan + tombol, bukan `ErrorState` | Konsistensi visual berbeda dari layar lain. | Fungsional (ada retry); kandidat penyatuan berikutnya. |
| Belum ada uji perangkat untuk state ini | Semua bukti di §7 adalah uji lokal, bukan perangkat. | Lihat `docs/QA_TEST_PLAN.md` bagian 8d. |
| `moderation.tsx.backup*` di `src/app` | Tidak menjadi route (ekstensi bukan `.tsx`), tetapi mengotori folder rute. | Berkas tidak terlacak git; hapus saat pemilik setuju. |

## 7. Verifikasi

Perubahan state pada pass ini diverifikasi **Passed locally**, bukan **Tested on
physical device**:

- `npm run typecheck` — tanpa error.
- `npx jest --ci` — seluruh suite lulus, termasuk uji baru:
  - `rides-list.test.tsx`: backend belum siap menampilkan state belum tersedia,
    bukan “Belum ada perjalanan”.
  - `ride-detail.test.tsx`: kegagalan muat menampilkan `ErrorState` + tombol
    **Coba lagi** yang memicu permintaan kedua; state memuat tampil sebelum
    data tersedia.
- ESLint pada berkas yang diubah — tanpa error.
- `prettier --check` pada berkas yang diubah — lulus.

## 8. Checklist untuk layar baru

1. Tentukan model state eksplisit (`loading | ready | error`, tambahkan
   `missing`/`forbidden` bila relevan).
2. Panggil `screenPrecondition(backend, userId, '<tindakan pemulihan>')` dan
   render `UnavailableState` bila hasilnya bukan `null`.
3. Render `LoadingState` hanya ketika prasyarat terpenuhi dan data belum ada.
4. Render `ErrorState` dengan `onRetry` yang benar-benar memuat ulang.
5. Render `EmptyState` hanya untuk `ready` dengan daftar kosong, dan sebutkan
   langkah berikutnya (+ CTA).
6. Aksi memakai `busy`/`submitting` + `Banner`; jangan mencampur pesan aksi
   dengan state muat.
7. Jangan menambah data contoh untuk “mengisi” layar kosong.
