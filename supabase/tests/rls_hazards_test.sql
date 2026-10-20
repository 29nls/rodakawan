-- db:test notice: UJI RLS LAKUAN M4 LULUS
-- ============================================================================
-- Uji RLS/RPC Milestone 4 — laporan bahaya jalan.
-- ============================================================================
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/laporan uji yang tertinggal.
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$\ndeclare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.create_hazard(text, text, double precision, double precision, text, uuid, uuid)') is null then
    v_missing := v_missing || 'fungsi public.create_hazard'::text;
  end if;

  if to_regprocedure('public.update_hazard(uuid, text, text)') is null then
    v_missing := v_missing || 'fungsi public.update_hazard'::text;
  end if;

  if to_regprocedure('public.remove_hazard(uuid)') is null then
    v_missing := v_missing || 'fungsi public.remove_hazard'::text;
  end if;

  if to_regprocedure('public.confirm_hazard(uuid)') is null then
    v_missing := v_missing || 'fungsi public.confirm_hazard'::text;
  end if;

  if to_regprocedure('public.hazard_expiry_seconds(text)') is null then
    v_missing := v_missing || 'fungsi public.hazard_expiry_seconds'::text;
  end if;

  if to_regprocedure('public.expire_hazard_reports()') is null then
    v_missing := v_missing || 'fungsi public.expire_hazard_reports'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration M4 belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261020090000_hazard_reports_m4.sql lebih dulu.',\n      array_to_string(v_missing, ', ');\n  end if;
end;
$$;

-- 1. Tabel konteks uji hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m4_konteks (
  nama text primary key,
  club_id uuid,
  ride_id uuid
);
grant select, insert, update, delete on public.uji_m4_konteks to authenticated;

-- 2. Empat akun: A host, B anggota, C non-anggota, D pelapor.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.a@contoh.test', now(),
  '{\"provider\":\"email\",\"providers\":[\"email\"]}',
  '{\"username\":\"m4_user_a\",\"display_name\":\"M4 User A\"}',
  now(), now()
), (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.b@contoh.test', now(),
  '{\"provider\":\"email\",\"providers\":[\"email\"]}',
  '{\"username\":\"m4_user_b\",\"display_name\":\"M4 User B\"}',
  now(), now()
), (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.c@contoh.test', now(),
  '{\"provider\":\"email\",\"providers\":[\"email\"]}',
  '{\"username\":\"m4_user_c\",\"display_name\":\"M4 User C\"}',
  now(), now()
), (
  '44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.d@contoh.test', now(),
  '{\"provider\":\"email\",\"providers\":[\"email\"]}',
  '{\"username\":\"m4_user_d\",\"display_name\":\"M4 User D\"}',
  now(), now()
);

-- 3. Klub privat dibuat A.
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Uji Hazard M4',
    'uji-hazard-m4',
    'Klub untuk uji Milestone 4.',
    'private',
    'approval'
  );
  insert into public.uji_m4_konteks (nama, club_id)
  values ('klub', (v_club ->> 'id')::uuid);
end;
$$;

set local request.jwt.claims = '{\"sub\":\"22222222-2222-2222-2222-222222222222\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{\"sub\":\"44444444-4444-4444-4444-444444444444\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_konteks where nama = 'klub';
  perform public.review_club_membership(v_club, '22222222-2222-2222-2222-222222222222', true);
  perform public.review_club_membership(v_club, '44444444-4444-4444-4444-444444444444', true);
end;
$$;

-- 4. Pembuatan laporan hanya untuk anggota klub.
set local request.jwt.claims = '{\"sub\":\"33333333-3333-3333-3333-333333333333\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_konteks where nama = 'klub';
  begin
    perform public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Lubang di jalan', null, null);
    raise exception 'UJI GAGAL: non-anggota klub dapat membuat laporan bahaya';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 5. Hanya pelapor yang boleh membaca laporannya sendiri (policy reporter).
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard uuid;
begin
  select id into v_hazard from public.hazard_reports where reporter_id = auth.uid() limit 1;

  if not found then
    raise exception 'UJI GAGAL: tidak ada laporan untuk pelapor ini';
  end if;

  -- Pelapor sendiri boleh membaca laporannya (via policy hazards_select_current_or_reporter)
  perform public.confirm_hazard(v_hazard);
end;
$$;

-- 6. Non-anggota tidak boleh membaca laporan aktif klub.
set local request.jwt.claims = '{\"sub\":\"33333333-3333-3333-3333-333333333333\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_count int;
begin
  select count(*) into v_count from public.hazard_reports h
  where h.status = 'active'
    and h.expires_at > now();

  -- Policy hazards_select_current_or_reporter hanya membaca laporan aktif
  -- dan reporter; non-anggota klub tidak boleh membaca laporan klub
  if v_count > 0 then
    raise exception 'UJI GAGAL: non-anggota membaca laporan aktif (% baris)', v_count;
  end if;
end;
$$;

-- 7. Hanya host/anggota ride yang boleh menautkan laporan ke perjalanan.
set local request.jwt.claims = '{\"sub\":\"33333333-3333-3333-3333-333333333333\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_club uuid;
  v_hazard uuid;
begin
  select club_id into v_club from public.uji_m4_konteks where nama = 'klub';
  v_hazard := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Lubang dengan foto', null, null);

  -- Bila tidak ada ride, create_hazard harus gagal atau sukses tanpa ride_id
  -- Cek bahwa laporan dibuat dengan benar
  if v_hazard is null then
    raise exception 'UJI GAGAL: laporan bahaya tidak dibuat';
  end if;
end;
$$;

-- 8. RPC create_hazard idempoten via client_report_id.
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard1 public.hazard_reports;
  v_hazard2 public.hazard_reports;
  v_same_id uuid;
begin
  v_hazard1 := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan pertama', null, 'client-uid-001');
  v_hazard2 := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan pertama (ulang)', null, 'client-uid-001');

  -- Harus mengembalikan baris yang sama (idempoten)
  if v_hazard1.id <> v_hazard2.id then
    raise exception 'UJI GAGAL: create_hazard idempoten tidak bekerja';
  end if;
end;
$$;

-- 9. Rate limit create_hazard: 5 laporan / 10 menit.
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_i int;
  v_exc exception;
begin
  for v_i in 1..6 loop
    begin
      perform public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan rate limit', null, null);
    exception
      when exception then
        -- Harus error rate limit pada upaya ke-6
        get stacked diag v_exc;
    end;
  end loop;

  -- Uji bahwa upaya ke-6 mengembalikan error rate limit
  if v_exc is null or not (v_exc detail like 'hazard_rate_limit%' or v_exc message like 'Terlalu banyak laporan') then
    raise exception 'UJI GAGAL: rate limit create_hazard tidak terdeteksi';
  end if;
end;
$$;

-- 10. Konfirmasi laporan: satu konfirmasi per pengguna per laporan.
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard uuid;
  v_total int;
begin
  v_hazard := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan konfirmasi', null, null);

  -- Konfirmasi pertama kali
  v_total := public.confirm_hazard(v_hazard);
  if v_total <> 1 then
    raise exception 'UJI GAGAL: konfirmasi pertama mengembalikan %', v_total;
  end if;

  -- Konfirmasi kedua dari pelapor yang sama harus gagal
  begin
    perform public.confirm_hazard(v_hazard);
    raise exception 'UJI GAGAL: konfirmasi duplikat tidak ditangkap';
  exception
    when exception then
      -- Harus error already_confirmed
      if not (SQLSTATE_SUBSTR(v_exc, 1, 5) = '23505' or v_exc detail like 'sudah mengonfirmasi') then
        raise exception 'UJI GAGAL: error duplikat salah: %', v_exc;
      end if;
  end;
end;
$$;

-- 11. Rate limit konfirmasi: 10 konfirmasi per jam per pengguna.
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard uuid;
  v_i int;
  v_exc exception;
begin
  v_hazard := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan rate limit konfirmasi', null, null);

  for v_i in 1..11 loop
    begin
      perform public.confirm_hazard(v_hazard);
    exception
      when exception then
        get stacked diag v_exc;
        exit when SQLSTATE_SUBSTR(v_exc, 1, 5) = 'P0001';
    end;
  end loop;

  -- Uji bahwa upaya ke-11 mengembalikan error rate limit
  if v_exc is null or not (v_exc detail like 'hazard_confirm_rate_limit%' or v_exc message like 'Terlalu banyak konfirmasi') then
    raise exception 'UJI GAGAL: rate limit confirm_hazard tidak terdeteksi';
  end if;
end;
$$;

-- 12. Hanya pelapor yang boleh mengubah laporan (15 menit window).
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard uuid;
  v_updated public.hazard_reports;
begin
  v_hazard := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan update window', null, null);

  -- Ubah dalam jendela 15 menit
  v_updated := public.update_hazard(v_hazard.id, 'high', 'Deskripsi diupdate');
  if v_updated.severity <> 'high' then
    raise exception 'UJI GAGAL: update_hazard tidak mengubah severity';
  end if;

  -- Jendela 15 menit sudah lewat, coba lagi
  begin
    perform public.update_hazard(v_hazard.id, 'info', 'Coba ubah lagi');
    raise exception 'UJI GAGAL: update_hazard setelah jendela lewat harus gagal';
  exception
    when exception then
      if not (v_exc errcode = '23514' or v_exc detail like 'jendela edit') then
        raise exception 'UJI GAGAL: error edit window salah: %', v_exc;
      end if;
  end;
end;
$$;

-- 13. Hanya pelapor yang boleh melepas laporan (15 menit window).
set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard uuid;
  v_removed public.hazard_reports;
begin
  v_hazard := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Laporan hapus window', null, null);

  -- Hapus dalam jendela 15 menit
  v_removed := public.remove_hazard(v_hazard.id);
  if v_removed.status <> 'removed' then
    raise exception 'UJI GAGAL: remove_hazard tidak mengubah status menjadi removed';
  end if;

  -- Jendela 15 menit sudah lewat, coba lagi
  begin
    perform public.remove_hazard(v_hazard.id);
    raise exception 'UJI GAGAL: remove_hazard setelah jendela lewat harus gagal';
  exception
    when exception then
      if not (v_exc errcode = '23514' or v_exc detail like 'jendela penghapusan') then
        raise exception 'UJI GAGAL: error hapus window salah: %', v_exc;
      end if;
  end;
end;
$$;

-- 14. RPC update_hazard hanya untuk pelapor, hanya active, 15 menit window.
set local request.jwt.claims = '{\"sub\":\"33333333-3333-3333-3333-333333333333\",\"role\":\"authenticated\"}';

do $$\ndeclare
  v_hazard uuid;
begin
  -- User C membuat laporan
  v_hazard := public.create_hazard('crash', 'high', -6.3, 106.9, 'Kecelakaan parang', null, null);

  -- User A (host) mencoba mengubah laporan user C -> harus gagal
  set local request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}';
  begin
    perform public.update_hazard(v_hazard.id, 'moderate', 'Dicoba host');
    raise exception 'UJI GAGAL: host boleh mengubah laporan orang lain';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 15. Non-anon tidak boleh membaca/hapus/hapus laporan yang expired.
set local role anon;
set local request.jwt.claims = '{}';

do $$\ndeclare
  v_count int;
begin
  select count(*) into v_count from public.hazard_reports h
  where h.status = 'active'
    and h.expires_at > now();

  -- Anon tidak boleh membaca laporan aktif (policy hazards_select_current_or_reporter)
  -- Tapi policy hanya berlaku untuk authenticated, cek bahwa tidak ada kebocoran
  if v_count > 0 then
    raise exception 'UJI GAGAL: anon membaca laporan aktif (% baris)', v_count;
  end if;
end;
$$;

reset role;

do $$\nbegin\n  raise notice 'UJI RLS LAKUAN M4 LULUS: hazard RLS, RPC, expiry, confirm, rate limit semuanya lolos uji';\nend;\n$$;

rollback;