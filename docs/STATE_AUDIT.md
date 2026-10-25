# Inventaris State tiap Layar & Hook (Expo SDK 57, RN 0.86)

## 1. Layar di src/app

### `src/app/index.tsx` (Home/Tabs)
- **State**: `loading` → `ready` dari `getSupabaseState()`
- **Error**: Ditangkap oleh `RouteErrorBoundary`
- **Empty**: Tidak ada (selalu ada item di tab)

### `src/app/privacy.tsx`
- **State**: Menampilkan teks retensi dan kontak dukungan
- **Error**: Jika config Supabase tidak terisi → banner "belum dikonfigurasi"
- **Empty**: Daftar penuh (teks statis)

### `src/app/account-delete.tsx`
- **State**: `confirmation` input, `busy` saat proses, `error`, `notice`
- **Error**: Dari `deleteMyAccount` — "Akun belum dihapus", atau "Periksa koneksi, lalu coba lagi"
- **Empty**: Tidak ada (butuh konfirmasi username)

### `src/app/ride-new.tsx`
- **State**: Form state (`title`, `clubId`, `date`, `time`), `loading`, `error`
- **Error**: Dari RPC — validasi klub, jadwal konflik, aturan privasi
- **Empty**: Form belum terisi

### `src/app/ride.tsx`
- **State**: `ride` data, `locations` array, `consent` boolean, `participants` count
- **Error**: Dari RPC/RLS — gagal publish lokasi, akses ditolak
- **Empty**: Belum ada ride aktif

### `src/app/garage.tsx`
- **State**: `motorcycles` array, `editingId`, `newPhotoURI`
- **Error**: Dari RPC/RLS — gagal unggah/foto, policy menolak, tidak milik
- **Empty**: Kosong (belum ada kendaraan)

### `src/app/club.tsx`
- **State**: `clubs` array, `editingClub`, `newLogoURI`
- **Error**: Dari RPC/RLS — gagal unggah/logo, policy menolak, bukan admin
- **Empty**: Kosong (belum ada klub)

### `src/app/community.tsx`
- **State**: `hazards` array, `newHazardForm`
- **Error**: Dari RPC — gagal buat laporan, rate limit, validasi
- **Empty**: Daftar hazard penuh

### `src/app/hazards.tsx`
- **State**: `filters` (category, severity), `myReports` array
- **Error**: Dari backend — gagal filter, timeout
- **Empty**: Belum ada hazard (atau tersembunyi dengan filter)

### `src/app/profile.tsx`
- **State**: `userProfile`, `isEditing`, `avatarURI`
- **Error**: Dari RPC — gagal baca/ubah profil, foto gagal unggah
- **Empty**: Menampilkan ringkasan profil

### `src/app/profile/edit.tsx`
- **State**: `form` (username, display name, bio, kota), `saving`
- **Error**: Dari RPC — gagal update, validasi format, duplicate username
- **Empty**: Form kosong (dari profil yang dimuat)

### `src/app/moderation.tsx`
- **State**: `reports` array, `filter`, `selectedReport`
- **Error**: Dari RPC — gagal load antrean, gagal proses
- **Empty**: Antrean kosong (hanya owner)

### `src/app/reset-password.tsx`
- **State**: `email`, `sending`, `sent`
- **Error**: Dari backend — email tidak terdaftar, jaringan gagal
- **Empty**: Form kirim email

### `src/app/forgot-password.tsx`
- **State**: `email`, `sending`, `sent`
- **Error**: Dari backend — email tidak terdaftar, jaringan gagal
- **Empty**: Form kirim email

### `src/app/sign-in.tsx`
- **State**: `email`, `password`, `loggingIn`, `error`
- **Error**: "Email/Kata sandi salah", "Belum ada konfigurasi Supabase"
- **Empty**: Form login

### `src/app/sign-up.tsx`
- **State**: `email`, `username`, `password`, `confirmPassword`, `signingUp`
- **Error**: "Username sudah terpakai", "Format username salah", "Password terlalu lemah"
- **Empty**: Form pendaftaran

### `src/app/callback.tsx`
- **State**: `loading` selama callback Supabase
- **Error**: Jika callback gagal → redirect ke sign-in
- **Empty**: Tidak ada (internal flow)

## 2. Hook di src/features

### `src/features/auth/session.ts` — `useAuthSession()`
- **State**: `userId`, `backend` ({available, reason}), `signOut`
- **Error**: Dari `getSupabaseState()` — `not_configured`, `invalid_url`, `privileged_key`
- **Empty**: Session belum terindeksi (state loading)

### `src/features/profile/useProfile.ts` — `useProfile()`
- **State**: `status` (`loading` | `ready` | `error`), `profile` ({username, displayName, ...})
- **Error**: Dari RPC `getProfile` — gagal baca, policy menolak
- **Empty**: Status `loading` hingga profil termuat

### `src/features/auth/components/BackendUnavailableBanner`
- **State**: `reason` dari `describeUnavailableReason()`
- **Error**: Menampilkan alasan mengapa backend tidak bisa dipakai
- **Empty**: Tidak render (backend available)

### `src/features/media/hooks.ts` (jika ada)
- **State**: Sementara unggah, progres kompresi
- **Error**: Dari `validatePhotoAsset`, `uploadObject` — format, ukuran, permission
- **Empty**: Siap unggah

## 3. Komponen UI (src/components/feedback)

### `src/components/feedback/RouteErrorBoundary`
- **State**: `error` prop, `retry` callback
- **Error**: Menampilkan pesan ramah pengguna + detail dev (hanya __DEV__)
- **Empty**: Tidak render (tidak ada error)

### `src/components/ui/StateView` (jika digunakan)
- **State**: `title`, `description`, `actionText`, `onAction`
- **Error**: Detail teknis jika __DEV__
- **Empty**: Komponen tidak digunakan

## 4. Pola State yang Ditemukan

### Loading State
- **Gaya umum**: Semua API memulai dari state `loading`
- **Penangguhan**: `getSupabaseState()` mengembalikan `{available: false, reason: 'not_configured'}`
- **Tampilan**: Biasanya berupa skeleton loading atau halaman login

### Error State
- **Gaya umum**: `AppError` code + message (Bahasa Indonesia)
- **Tindakan pemulihan**: "Coba lagi", "Hubungi dukungan", "Periksa koneksi"
- **Penampilan**: `Banner` komponen dengan `tone="danger"`
- **Contoh**: `deleteMyAccount` error → "Akun belum dihapus, periksa koneksi lalu coba lagi"

### Empty State
- **Gaya umum**: Menjelaskan langkah berikutnya
- **Teks**: "Belum ada data", "Buat [X] pertama", "Belum ada klub"
- **Aksi**: Tombol CTF (create CTA) untuk memulai
- **Contoh**: `ride-new.tsx` kosong → "Buat ride pertama", `garage.tsx` kosong → "Tambah kendaraan pertama"

### Success/Notice State
- **Gaya umum**: `Banner` dengan `tone="success"`
- **Tampilan**: "Berhasil", "Data tersimpan", "Akun dihapus"
- **Auto-dismiss**: Bisa setelah delay singkat

## 5. Kontrak Error Messages (per fitur)

### `src/features/auth/errors.ts`
- `mapSupabaseError`: Mengubah error code Supabase ke Bahasa Indonesia
- Policy: Selalu menyebut tindakan pemulihan, tidak ada detail internal

### `src/features/account/errors.ts`
- Error delete account: "Akun Anda dan identitas login sudah dihapus..."
- Error konfrimasi: "Ketik username Anda persis seperti yang tertera di profil"

### `src/features/media/photos.ts`
- `invalidData`: "Format foto harus JPG, PNG, atau WEBP..."
- `validatePhotoAsset`: "Ukuran foto maksimal X MB..."

### `src/features/auth/api.ts`
- Koneksi error: "Coba lagi", "Hubungi dukungan jika masalah berlanjut"

## 6. Hook yang Mengelola State

### `src/lib/supabase/client.ts` — `getSupabaseState()`
- Mengembalikan `available: true/false` dengan `reason`
- Cache hasil untuk performa
- Auto-refresh session sesuai AppState

### `src/features/auth/session.ts` — `useAuthSession()`
- Ekstrak `userId`, `backend` dari state Supabase
- Handle sign out
- Available check sebelum operasi

### `src/features/profile/useProfile.ts` — `useProfile()`
- Load profile dari database
- Status: loading → ready → error
- Refresh manual saat butuh

---

**Catatan**: Semua pesan error harus terjemah ke Bahasa Indonesia dan menyebutkan tindakan pemulihan ("Coba lagi"). Empty state harus menjelaskan langkah berikutnya ("Buat X pertama"). Data dasar tidak boleh tampil "olah-olah" seolah-olah fresh.