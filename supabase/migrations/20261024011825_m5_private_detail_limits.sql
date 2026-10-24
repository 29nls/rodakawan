-- ============================================================================
-- RodaKawan — batas panjang detail privat kendaraan (checklist keamanan M5).
--
-- Temuan inventaris input: `motorcycle_private_details.plate_number` dan
-- `private_notes` tidak punya CHECK panjang, padahal klien membatasi 16 dan 500
-- karakter (`src/features/garage/validation.ts`). Pemilik baris dapat menulis
-- langsung lewat Data API dengan JWT-nya, sehingga validasi klien bukan batas.
--
-- `not valid` dipakai supaya migration tetap aman bila sudah ada data lama yang
-- melebihi batas: baris baru dan setiap UPDATE tetap diperiksa, sedangkan baris
-- lama tidak menggagalkan penerapan. Setelah data lama diperiksa/dirapikan,
-- jalankan (di luar migration ini):
--
--   alter table public.motorcycle_private_details
--     validate constraint motorcycle_private_details_plate_length;
--   alter table public.motorcycle_private_details
--     validate constraint motorcycle_private_details_notes_length;
--
-- Migration ini tidak mengubah RLS, policy, atau data.
-- ============================================================================

alter table public.motorcycle_private_details
  add constraint motorcycle_private_details_plate_length
    check (plate_number is null or char_length(plate_number) <= 16) not valid,
  add constraint motorcycle_private_details_notes_length
    check (private_notes is null or char_length(private_notes) <= 500) not valid;
