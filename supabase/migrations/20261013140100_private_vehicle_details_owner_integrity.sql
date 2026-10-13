-- RodaKawan Milestone 1.6: integritas kepemilikan `motorcycle_private_details`.
--
-- Masalah yang diperbaiki
-- ---------------------------------------------------------------------------
-- Policy INSERT sudah benar sejak migration awal:
--
--   with check (owner_id = auth.uid()
--               and exists (select 1 from public.motorcycles m
--                           where m.id = motorcycle_id and m.owner_id = auth.uid()))
--
-- tetapi policy UPDATE-nya tidak memeriksa kendaraan sama sekali:
--
--   using (owner_id = auth.uid()) with check (owner_id = auth.uid())
--
-- Akibatnya pemilik baris dapat mengubah `motorcycle_id` ke kendaraan milik orang lain
-- selama `owner_id` tetap dirinya: baris detail privat (plat nomor, catatan privat) menjadi
-- menunjuk kendaraan orang lain, dan karena `motorcycle_id` adalah primary key, pemilik
-- kendaraan yang sebenarnya tidak bisa lagi membuat baris detail untuk kendaraannya sendiri
-- (pelanggaran primary key) — selain itu baris dengan `owner_id != pemilik kendaraan` juga
-- merusak asumsi seluruh query yang menggabungkan kedua tabel.
--
-- Perbaikan berlapis
-- ---------------------------------------------------------------------------
-- 1. Policy UPDATE memeriksa kepemilikan kendaraan pada baris **baru** (`with check`) dan
--    baris lama (`using`), sehingga `motorcycle_id` hanya bisa menunjuk kendaraan milik
--    pengguna yang sama sebelum maupun sesudah perubahan.
-- 2. Foreign key komposit `(motorcycle_id, owner_id) -> motorcycles(id, owner_id)` membuat
--    invarian "pemilik detail privat = pemilik kendaraan" tetap berlaku walaupun ada policy
--    yang keliru di kemudian hari.
--
-- Migration ini idempotent dan tidak menghapus data. Bila di suatu database sudah ada baris
-- yang melanggar invarian, penambahan foreign key akan GAGAL (perilaku yang diinginkan —
-- jangan diam-diam memperbaiki data). Query pemeriksaan sebelum menjalankan migration:
--
--   select d.motorcycle_id, d.owner_id, m.owner_id as pemilik_kendaraan
--   from public.motorcycle_private_details d
--   join public.motorcycles m on m.id = d.motorcycle_id
--   where m.owner_id <> d.owner_id;

-- 1. Invarian di level struktur (foreign key komposit) -------------------------
-- Target foreign key komposit memerlukan unique constraint pada (id, owner_id).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'motorcycles_id_owner_key'
      and conrelid = 'public.motorcycles'::regclass
  ) then
    alter table public.motorcycles
      add constraint motorcycles_id_owner_key unique (id, owner_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'motorcycle_private_details_bike_owner_fkey'
      and conrelid = 'public.motorcycle_private_details'::regclass
  ) then
    alter table public.motorcycle_private_details
      add constraint motorcycle_private_details_bike_owner_fkey
      foreign key (motorcycle_id, owner_id)
      references public.motorcycles (id, owner_id)
      on delete cascade;
  end if;
end;
$$;

-- 2. Policy INSERT/UPDATE memeriksa kepemilikan kendaraan ----------------------
drop policy if exists "motorcycle_private_insert_owner" on public.motorcycle_private_details;
create policy "motorcycle_private_insert_owner" on public.motorcycle_private_details
  for insert to authenticated with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.motorcycles m
      where m.id = motorcycle_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists "motorcycle_private_update_owner" on public.motorcycle_private_details;
create policy "motorcycle_private_update_owner" on public.motorcycle_private_details
  for update to authenticated
  using (
    -- Baris lama: hanya baris yang memang milik pengguna dan menunjuk kendaraannya sendiri.
    owner_id = auth.uid()
    and exists (
      select 1 from public.motorcycles m
      where m.id = motorcycle_id and m.owner_id = auth.uid()
    )
  )
  with check (
    -- Baris baru: `motorcycle_id` hanya boleh menunjuk kendaraan milik pengguna yang sama,
    -- termasuk ketika `motorcycle_id` diubah.
    owner_id = auth.uid()
    and exists (
      select 1 from public.motorcycles m
      where m.id = motorcycle_id and m.owner_id = auth.uid()
    )
  );

-- Policy SELECT dan DELETE tetap seperti migration awal: `owner_id = auth.uid()`.
-- `motorcycles_update_owner` juga tidak diubah: `with check (owner_id = auth.uid())` sudah
-- membuat `owner_id` kendaraan tidak bisa dipindahkan ke pengguna lain, sehingga invarian
-- foreign key di atas tidak mungkin dilanggar lewat jalur pemindahan kepemilikan.
