-- RodaKawan Milestone 2: invarian "satu kendaraan primary per pemilik".
--
-- Kenapa perlu di database, bukan hanya di aplikasi
-- ---------------------------------------------------------------------------
-- `src/features/garage/api.ts` sudah menurunkan primary lama sebelum menaikkan
-- primary baru, tetapi itu urutan dua perintah dari klien: dua perangkat yang
-- menyimpan primary secara bersamaan bisa menghasilkan dua baris `is_primary`
-- sekaligus. Invarian ini sekarang dijaga database:
--
--   * trigger BEFORE membuat baris lain milik pemilik yang sama kehilangan status
--     primary pada pernyataan yang sama, sehingga hasil akhirnya selalu konsisten;
--   * partial unique index menjadi jaring terakhir bila trigger dilewati
--     (mis. impor data langsung oleh operator) — pelanggarannya muncul sebagai
--     `unique_violation`, bukan data ganda yang diam-diam diterima.
--
-- Owner tidak dapat diubah lewat jalur ini: `motorcycles_update_owner` tetap
-- mensyaratkan `owner_id = auth.uid()` sebelum dan sesudah perubahan.

create or replace function public.enforce_single_primary_motorcycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_primary then
    update public.motorcycles
      set is_primary = false, updated_at = now()
      where owner_id = new.owner_id
        and id <> new.id
        and is_primary;
  end if;

  return new;
end;
$$;

drop trigger if exists motorcycles_single_primary on public.motorcycles;
create trigger motorcycles_single_primary
  before insert or update of is_primary on public.motorcycles
  for each row
  when (new.is_primary)
  execute function public.enforce_single_primary_motorcycle();

-- Index parsial hanya menyentuh baris primary, jadi tetap murah untuk garasi besar.
create unique index if not exists motorcycles_single_primary_idx
  on public.motorcycles(owner_id)
  where is_primary;

-- Fungsi trigger tidak pernah dipanggil klien; tetap dicabut agar permukaan
-- eksekusi untuk peran tanpa sesi nol (lihat ADR-030 dan 20261013140200).
revoke all on function public.enforce_single_primary_motorcycle() from public, anon;
