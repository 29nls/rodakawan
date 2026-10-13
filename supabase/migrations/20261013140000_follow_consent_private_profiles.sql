-- RodaKawan Milestone 1.6: persetujuan follow untuk profil privat.
--
-- Masalah yang diperbaiki
-- ---------------------------------------------------------------------------
-- Policy `profiles_select_visible` dari migration awal memberi akses baca ke profil privat
-- kepada siapa pun yang punya baris di `public.follows`:
--
--   ... or exists (select 1 from public.follows f
--                  where f.follower_id = auth.uid() and f.followed_id = profiles.id)
--
-- Sementara `follows_insert_self` (`with check (follower_id = auth.uid())`) membiarkan setiap
-- pengguna membuat baris follow untuk dirinya sendiri ke akun mana pun. Gabungan keduanya
-- berarti: satu INSERT sudah cukup untuk membuka profil privat orang lain — pengguna dapat
-- memberi dirinya sendiri akses, tanpa sepengetahuan atau persetujuan pemilik profil. Ini
-- melanggar arti kolom `profiles.is_private` dan membuat "uji RLS lintas pengguna" yang lama
-- lulus secara palsu (uji itu tidak pernah mencoba membuat relasi follow).
--
-- Model yang diterapkan (perlu ratifikasi pemilik produk — ADR-039)
-- ---------------------------------------------------------------------------
-- * Follow ke profil **publik** langsung berlaku (`status = 'accepted'`), karena tidak ada
--   privasi yang dilindungi dan klien memang tidak bisa tahu isi profil privat.
-- * Follow ke profil **privat** adalah *permintaan* (`status = 'pending'`). Akses baca ke
--   baris profil baru ada setelah pemilik menyetujuinya lewat
--   `public.accept_follow_request(p_follower_id)`.
-- * Status ditentukan **server** oleh trigger `follows_set_status`, bukan oleh klien.
-- * Tidak ada policy UPDATE pada `public.follows`: satu-satunya jalur penerimaan adalah fungsi
--   RPC di atas, sehingga klien tidak dapat menaikkan status sendiri.
--
-- Migration ini idempotent dan tidak menghapus data.

-- 1. Kolom status permintaan/persetujuan ---------------------------------------
alter table public.follows
  add column if not exists status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'follows_status_valid'
      and conrelid = 'public.follows'::regclass
  ) then
    alter table public.follows
      add constraint follows_status_valid
      check (status in ('pending', 'accepted'));
  end if;
end;
$$;

-- Baris yang sudah ada sebelum kolom ini: profil publik tetap berlaku, sedangkan
-- follow ke profil privat dikembalikan menjadi permintaan sehingga tidak ada akses yang
-- diberikan tanpa persetujuan (jalur ini berjalan sebagai pemilik tabel, jadi tidak
-- terhalang RLS). Tidak ada baris yang dihapus.
update public.follows f
set status = case when p.is_private then 'pending' else 'accepted' end
from public.profiles p
where p.id = f.followed_id;

-- 2. Status ditentukan server, bukan payload klien ------------------------------
create or replace function public.set_follow_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_private boolean;
begin
  -- `security definer` diperlukan karena policy SELECT profil privat justru sedang
  -- diperbaiki di migration ini: pengguna yang mengirim permintaan follow tidak boleh
  -- menjadi penentu apakah targetnya privat.
  select p.is_private into v_is_private
  from public.profiles p
  where p.id = new.followed_id;

  -- Fail-closed: target tidak terbaca berarti diperlakukan sebagai privat.
  new.status := case when coalesce(v_is_private, true) then 'pending' else 'accepted' end;
  return new;
end;
$$;

comment on function public.set_follow_status() is
  'BEFORE INSERT public.follows: menetapkan status pending untuk target privat dan accepted untuk target publik.';

-- Trigger hanya boleh dijalankan oleh trigger, bukan dipanggil langsung klien.
revoke all on function public.set_follow_status() from public;

drop trigger if exists follows_set_status on public.follows;
create trigger follows_set_status
  before insert on public.follows
  for each row
  execute function public.set_follow_status();

-- 3. Pemilik profil menyetujui permintaan ---------------------------------------
-- Satu-satunya jalur perubahan status: klien tidak punya policy UPDATE pada `public.follows`.
create or replace function public.accept_follow_request(p_follower_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null or p_follower_id is null then
    return false;
  end if;

  -- Identitas pemilik profil berasal dari sesi (`auth.uid()`), bukan dari argumen,
  -- dan hanya permintaan berstatus `pending` yang dapat diterima.
  update public.follows
  set status = 'accepted'
  where follower_id = p_follower_id
    and followed_id = v_uid
    and status = 'pending';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.accept_follow_request(uuid) is
  'SECURITY DEFINER: pemilik profil (auth.uid()) menerima permintaan follow dari p_follower_id. Mengembalikan true bila ada permintaan pending yang diterima.';

revoke all on function public.accept_follow_request(uuid) from public;
grant execute on function public.accept_follow_request(uuid) to authenticated;

-- 4. Policy --------------------------------------------------------------------
-- 4a. Profil privat hanya terlihat oleh pemilik dan pengikut yang SUDAH disetujui.
drop policy if exists "profiles_select_visible" on public.profiles;
create policy "profiles_select_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or is_private = false
    or exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid()
        and f.followed_id = profiles.id
        and f.status = 'accepted'
    )
  );

-- 4b. Pengguna hanya dapat membuat baris follow untuk dirinya sendiri. Kolom `status`
--     diisi trigger `follows_set_status` (server), jadi nilai dari klien tidak berpengaruh.
drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self" on public.follows
  for insert to authenticated with check (follower_id = auth.uid());

-- 4c. Kedua pihak boleh menghapus relasi: pengikut berhenti mengikuti, pemilik profil
--     menolak permintaan atau menghapus pengikutnya. Tidak ada policy UPDATE.
drop policy if exists "follows_delete_self" on public.follows;
create policy "follows_delete_either_party" on public.follows
  for delete to authenticated using (follower_id = auth.uid() or followed_id = auth.uid());

-- 5. Catatan lanjutan (belum dikerjakan, jangan dianggap aman) ------------------
-- * Rate limit / pembatasan spam permintaan follow belum ada (SECURITY_PRIVACY bagian 6).
-- * Permintaan follow dari akun yang diblokir belum ditolak: policy `user_blocks` hanya
--   memperlihatkan blokir kepada pihak yang memblokir, sehingga pemeriksaan ini butuh
--   helper `security definer` tersendiri.
-- * Notifikasi `kind = 'follow'` untuk permintaan/persetujuan masih dikerjakan backend.
