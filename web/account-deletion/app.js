/*
 * Halaman hapus akun statis.
 *
 * Tidak memakai SDK/CDN: hanya Supabase Auth REST dan Edge Function yang sudah
 * ada. Access token disimpan di memori selama satu percobaan, tidak pernah di
 * localStorage. Kata sandi tidak pernah disimpan atau dikirim ke mana pun selain
 * endpoint Auth Supabase.
 */
(function () {
  'use strict';

  var config = window.RODAKAWAN_WEB || {};
  var supabaseUrl = String(config.supabaseUrl || '').replace(/\/+$/, '');
  var publishableKey = String(config.publishableKey || '');
  var configured =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) &&
    publishableKey.length > 20 &&
    publishableKey.indexOf('GANTI-') === -1;

  var form = document.getElementById('form-hapus');
  var button = document.getElementById('tombol-hapus');
  var status = document.getElementById('status');
  var error = document.getElementById('galat');
  var notConfigured = document.getElementById('belum-dikonfigurasi');

  if (config.supportUrl) {
    document.getElementById('tautan-dukungan').href = config.supportUrl;
  }
  if (config.privacyUrl) {
    document.getElementById('tautan-privasi').href = config.privacyUrl;
  }

  if (!configured) {
    notConfigured.hidden = false;
    form.hidden = true;
    return;
  }

  function setBusy(busy) {
    button.disabled = busy;
    button.textContent = busy ? 'Memproses…' : 'Hapus akun saya';
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    status.textContent = '';
  }

  function clearMessages() {
    error.hidden = true;
    error.textContent = '';
    status.textContent = '';
  }

  function api(path, options) {
    var headers = Object.assign({ apikey: publishableKey }, options.headers || {});
    return fetch(supabaseUrl + path, Object.assign({}, options, { headers: headers }));
  }

  function loginError() {
    // Pesan yang sama untuk email tidak terdaftar dan kata sandi salah:
    // jangan bocorkan apakah suatu alamat punya akun.
    return 'Email atau kata sandi tidak cocok. Periksa kembali lalu coba lagi.';
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearMessages();

    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('kata-sandi').value;
    var confirmation = document.getElementById('konfirmasi').value.trim().toUpperCase();

    if (!email || !password) {
      showError('Isi email dan kata sandi akun Anda.');
      return;
    }
    if (confirmation !== 'HAPUS AKUN') {
      showError('Ketik HAPUS AKUN (huruf besar) untuk mengonfirmasi.');
      return;
    }

    setBusy(true);

    var token = '';
    try {
      var login = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      });

      if (!login.ok) {
        showError(loginError());
        setBusy(false);
        return;
      }

      var session = await login.json();
      token = typeof session.access_token === 'string' ? session.access_token : '';

      if (!token) {
        showError(loginError());
        setBusy(false);
        return;
      }

      var deletion = await api('/functions/v1/delete-account', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      var body = await deletion.json().catch(function () {
        return {};
      });

      if (deletion.ok && body && body.status === 'completed') {
        // Best effort; kegagalan logout tidak mengubah fakta bahwa akun hilang.
        await api('/auth/v1/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
        }).catch(function () {});

        document.getElementById('kata-sandi').value = '';
        document.getElementById('konfirmasi').value = '';
        form.hidden = true;
        status.textContent =
          'Akun Anda dan identitas login sudah dihapus. Tidak ada yang perlu dilakukan lagi.';
        setBusy(false);
        return;
      }

      var code = body && typeof body.error === 'string' ? body.error : '';

      if (code === 'account_deletion_rate_limited') {
        showError('Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
      } else if (code === 'account_deletion_unauthenticated') {
        showError('Sesi tidak valid. Masuk kembali lalu ulangi.');
      } else if (code === 'account_deletion_unavailable') {
        showError('Layanan hapus akun belum tersedia. Coba lagi nanti.');
      } else {
        showError(
          'Penghapusan belum selesai sepenuhnya. Coba lagi. Bila akun sudah tidak bisa dipakai masuk, kemungkinan besar penghapusan justru sudah selesai; jangan ulangi berkali-kali.',
        );
      }
    } catch (networkError) {
      showError('Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      token = '';
      setBusy(false);
    }
  });
})();
