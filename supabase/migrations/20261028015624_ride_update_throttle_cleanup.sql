-- Ikat jendela throttle ke siklus hidup profil agar penghapusan akun tidak
-- meninggalkan identitas pemilik sintetis/terhapus pada tabel internal.
alter table public.ride_update_throttle_windows
  add constraint ride_update_throttle_windows_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
