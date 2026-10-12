/**
 * public/js/app-retur-status.js
 * Modul Retur -- LAPORAN STATUS PENERIMA (meninggal / tidak aktif / dst.), REKAP, dan AKTIVASI KEMBALI.
 * Tiga halaman di dalam panel Retur (lihat app-retur.js): 'lapor' (semua peran, menurut hak akses),
 * 'rekap' (semua peran), 'aktivasi' (khusus Admin Utama; server juga menolak peran lain).
 * Server: supabase/functions/api/domains/statusPenerima.ts. Dokumen diunggah ke Google Drive lewat
 * unggahBerkasKeDriveGAS (app-transaksi.js), tautannya dikirim ke server yang memvalidasinya.
 */
(function () {
  'use strict';

  var MAKS_BERKAS = 15 * 1024 * 1024;
  var S = { statuses: null, penerima: null, bpjs: null, seq: 0, sedangSimpan: false, rekapKata: '' };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    if (typeof window.esc === 'function') return window.esc(v);
    return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function token() { return (typeof dataPengguna !== 'undefined' && dataPengguna && dataPengguna.token) || ''; }
  function galat(err) { return typeof pesanErrorRamah === 'function' ? pesanErrorRamah(err) : String((err && err.message) || err || 'Terjadi kesalahan.'); }
  function toast(p, j) { if (typeof tampilkanToast === 'function') tampilkanToast(p, j || 'info', { durasi: 5000 }); }
  function adalahUtama() { return typeof dataPengguna !== 'undefined' && !!dataPengguna && String(dataPengguna.role || '').toUpperCase() === 'UTAMA'; }
  function hariIniWib() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }
  function stempel() {
    var d = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
    return d.slice(0, 10).replace(/-/g, '') + '-' + d.slice(11, 19).replace(/:/g, '');
  }
  function linkDriveAman(u) { return /^https:\/\/drive\.google\.com\/(file\/d\/|open\?id=)[A-Za-z0-9_-]{10,}/.test(String(u || '')); }
  function tglIndo(iso) {
    if (!iso) return '-';
    var b = String(iso).slice(0, 10).split('-');
    return b.length === 3 ? b[2] + '-' + b[1] + '-' + b[0] : iso;
  }

  var INPUT = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm';
  var LABEL = 'block text-xs font-semibold text-slate-600 mb-1';

  function lencana(teks, jenis) {
    var kelas = jenis === 'AKTIVASI' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200';
    return '<span class="inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ' + kelas + '">' + esc(teks) + '</span>';
  }

  // -------------------------------------------------------------------------
  // Pilihan status (dari server; status khusus hanya muncul untuk Admin Utama)
  // -------------------------------------------------------------------------
  function muatStatuses(selesai) {
    if (S.statuses) { selesai(S.statuses); return; }
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.sukses) { toast((res && res.pesan) || 'Gagal memuat pilihan status.', 'gagal'); selesai([]); return; }
        S.statuses = res.statuses || [];
        selesai(S.statuses);
      })
      .withFailureHandler(function (err) { toast(galat(err), 'gagal'); selesai([]); })
      .statusPilihan(token());
  }

  // -------------------------------------------------------------------------
  // Blok "cari NIK" yang dipakai halaman lapor & aktivasi
  // -------------------------------------------------------------------------
  function htmlCariNik(judul, penjelasan) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-4 mb-5">' +
      '<h3 class="text-sm font-bold text-slate-800 mb-1">' + esc(judul) + '</h3>' +
      '<p class="text-xs text-slate-500 mb-3">' + penjelasan + '</p>' +
      '<form id="rs-form-nik" class="flex flex-col sm:flex-row gap-2">' +
        '<input id="rs-nik" inputmode="numeric" maxlength="16" autocomplete="off" placeholder="NIK penerima (16 digit)" class="' + INPUT + ' sm:max-w-xs" />' +
        '<button type="submit" class="h-10 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700">Cari Penerima</button>' +
      '</form>' +
      '<div id="rs-hasil-nik" class="mt-3"></div>' +
    '</div>' +
    '<div id="rs-area-form"></div>';
  }

  function kartuPenerima(p) {
    var aktif = !!p.aktif;
    return '<div class="rounded-lg border ' + (aktif ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50') + ' p-3 text-sm">' +
      '<div class="font-bold text-slate-800">' + esc(p.nama) + ' <span class="font-mono text-xs font-normal text-slate-500">' + esc(p.nik) + '</span></div>' +
      '<div class="text-xs text-slate-600 mt-0.5">' + esc(p.layanan) + ' &middot; ' + esc(p.kecamatan) + ' / ' + esc(p.kelurahan) + (p.tempatTugas ? ' &middot; ' + esc(p.tempatTugas) : '') + '</div>' +
      '<div class="text-xs mt-1">Status saat ini: <b class="' + (aktif ? 'text-emerald-700' : 'text-amber-800') + '">' + esc(p.status || '-') + '</b></div>' +
    '</div>';
  }

  function pasangCariNik(setelahDitemukan) {
    var form = $('rs-form-nik');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nik = $('rs-nik').value.replace(/[^0-9]/g, '');
      var hasil = $('rs-hasil-nik'), area = $('rs-area-form');
      area.innerHTML = '';
      S.penerima = null; S.bpjs = null;
      if (nik.length !== 16) { hasil.innerHTML = '<p class="text-sm text-red-600">NIK harus 16 digit angka.</p>'; return; }
      var seq = ++S.seq;
      hasil.innerHTML = '<p class="text-sm text-slate-500">Mencari...</p>';
      google.script.run
        .withSuccessHandler(function (res) {
          if (seq !== S.seq) return;
          if (!res || !res.sukses) { hasil.innerHTML = '<p class="text-sm text-red-600">' + esc((res && res.pesan) || 'Gagal mencari penerima.') + '</p>'; return; }
          if (!res.ditemukan) { hasil.innerHTML = '<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">' + esc(res.pesan) + '</div>'; return; }
          S.penerima = res.penerima; S.bpjs = res.bpjs;
          hasil.innerHTML = kartuPenerima(res.penerima);
          setelahDitemukan(res.penerima, res.bpjs);
        })
        .withFailureHandler(function (err) { if (seq === S.seq) hasil.innerHTML = '<p class="text-sm text-red-600">' + esc(galat(err)) + '</p>'; })
        .statusCariPenerima(token(), nik);
    });
  }

  // -------------------------------------------------------------------------
  // Unggah dokumen ke Drive (satu berkas) -> tautan
  // -------------------------------------------------------------------------
  function unggahDokumen(file, penerima, label, selesai) {
    if (typeof unggahBerkasKeDriveGAS !== 'function') { selesai({ sukses: false, pesan: 'Fungsi unggah tidak tersedia. Muat ulang halaman.' }); return; }
    var map = {};
    map.dokumen = { file: file, namaFile: file.name, mimeType: file.type || 'application/octet-stream', ukuranByte: file.size, label: label };
    unggahBerkasKeDriveGAS({ kecamatan: 'RETUR', layanan: 'LAPORAN STATUS PENERIMA', nama: penerima.nama, nik: penerima.nik }, map)
      .then(function (r) {
        if (r && r.sukses && r.link && r.link.dokumen) selesai({ sukses: true, url: r.link.dokumen });
        else selesai({ sukses: false, pesan: (r && r.pesan) || 'Gagal mengunggah dokumen.' });
      })
      .catch(function (err) { selesai({ sukses: false, pesan: galat(err) }); });
  }

  function periksaBerkas(file, wajib) {
    if (!file) return wajib ? 'Dokumen pendukung wajib diunggah.' : '';
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf') return 'Dokumen harus berupa gambar (JPG/PNG/dll.) atau PDF.';
    if (file.size > MAKS_BERKAS) return 'Dokumen terlalu besar (maksimal 15 MB).';
    return '';
  }

  // -------------------------------------------------------------------------
  // Halaman LAPOR
  // -------------------------------------------------------------------------
  function renderLapor(el) {
    el.innerHTML = htmlCariNik('Laporan Meninggal Dunia / Tidak Aktif',
      'Masukkan NIK penerima. Data penerima terisi otomatis dari data yang sudah terverifikasi. Setelah laporan disimpan, <b>status penerima langsung berubah</b> dan penerima tidak lagi dihitung pada pembayaran.');
    pasangCariNik(function (p) {
      muatStatuses(function (daftar) { renderFormLapor(p, daftar); });
    });
  }

  function renderFormLapor(p, daftar) {
    var area = $('rs-area-form');
    if (!area) return;
    var opsi = '<option value="">-- Pilih status --</option>' + daftar.map(function (s) {
      return '<option value="' + esc(s.kode) + '">' + (s.khususUtama ? '&#128274; ' : '') + esc(s.kode) + '</option>';
    }).join('');
    area.innerHTML =
      '<form id="rs-form" class="rounded-xl border border-slate-200 bg-white p-4 space-y-3" novalidate>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
          '<div><label class="' + LABEL + '" for="rs-status">Status laporan *</label><select id="rs-status" class="' + INPUT + '">' + opsi + '</select></div>' +
          '<div><label class="' + LABEL + '" for="rs-tanggal">Tanggal kematian / tidak aktif *</label><input id="rs-tanggal" type="date" max="' + hariIniWib() + '" class="' + INPUT + '" /></div>' +
        '</div>' +
        '<div id="rs-bpjs"></div>' +
        '<div><label class="' + LABEL + '" for="rs-detail">Keterangan (opsional)</label><textarea id="rs-detail" rows="2" maxlength="500" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"></textarea></div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
          '<div><label class="' + LABEL + '" for="rs-pelapor">Nama pelapor *</label><input id="rs-pelapor" maxlength="100" class="' + INPUT + ' uppercase" /></div>' +
          '<div><label class="' + LABEL + '" for="rs-jabatan">Jabatan pelapor *</label><input id="rs-jabatan" maxlength="100" class="' + INPUT + ' uppercase" /></div>' +
        '</div>' +
        '<div><label class="' + LABEL + '" for="rs-dokumen">Dokumen pendukung (surat kematian / SK / dll.) *</label>' +
          '<input id="rs-dokumen" type="file" accept="image/*,.pdf" class="block w-full text-sm file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold" />' +
          '<p class="text-[11px] text-slate-500 mt-1">Gambar atau PDF, maksimal 15 MB.</p></div>' +
        '<div id="rs-pesan" class="hidden rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"></div>' +
        '<div id="rs-konfirmasi"></div>' +
        '<div id="rs-aksi" class="flex gap-2"><button type="submit" id="rs-simpan" class="h-10 px-5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">Simpan Laporan</button></div>' +
      '</form>';

    $('rs-status').addEventListener('change', function () { tampilBpjs(); });
    $('rs-form').addEventListener('submit', function (e) { e.preventDefault(); mintaKonfirmasiLapor(p); });
  }

  // Pemberitahuan JKM BPJS TK (sama seperti Retur lama; tidak memblokir pengisian).
  function tampilBpjs() {
    var wadah = $('rs-bpjs'), st = $('rs-status');
    if (!wadah || !st) return;
    if (st.value.toUpperCase().indexOf('MENINGGAL') !== -1 && S.bpjs && S.bpjs.ditemukan) {
      wadah.innerHTML = '<div class="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">' +
        '<div class="font-bold mb-1">Informasi Jaminan Kematian BPJS TK</div>' +
        '<p class="text-[13px]">NIK ini <b>SUDAH DIBAYARKAN</b> oleh Pemerintah Kota Medan untuk <b>Jaminan Kematian (JKM) BPJS Ketenagakerjaan</b> (data bulan ' + esc(S.bpjs.bulan) + ' ' + esc(S.bpjs.tahun) + ').</p>' +
        '<p class="text-[13px] mt-1">Untuk informasi lebih lanjut, silakan hubungi Admin Dinas Sosial Kota Medan.</p>' +
        '<p class="text-[13px] font-semibold mt-2">Syarat yang perlu disiapkan Ahli Waris untuk klaim JKM:</p>' +
        '<ol class="text-[13px] list-decimal pl-5"><li>Akta Kematian</li><li>Surat Pernyataan Ahli Waris</li><li>Surat Kuasa Ahli Waris</li><li>Formulir (diambil di Kantor BPJS Ketenagakerjaan)</li></ol></div>';
    } else {
      wadah.innerHTML = '';
    }
  }

  function tampilPesan(teks) {
    var el = $('rs-pesan');
    if (!el) return;
    if (!teks) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = teks; el.classList.remove('hidden');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function bacaFormLapor() {
    return {
      status: $('rs-status').value.trim(),
      tanggal: $('rs-tanggal').value.trim(),
      detail: $('rs-detail').value.trim(),
      namaPelapor: $('rs-pelapor').value.trim(),
      jabatan: $('rs-jabatan').value.trim(),
      file: $('rs-dokumen').files && $('rs-dokumen').files[0]
    };
  }

  function mintaKonfirmasiLapor(p) {
    if (S.sedangSimpan) return;
    var f = bacaFormLapor();
    tampilPesan('');
    if (!f.status) { tampilPesan('Pilih status laporan.'); return; }
    if (!f.tanggal) { tampilPesan('Isi tanggal kematian / tidak aktif.'); return; }
    if (f.tanggal > hariIniWib()) { tampilPesan('Tanggal tidak boleh di masa depan.'); return; }
    if (f.namaPelapor.length < 2) { tampilPesan('Isi nama pelapor.'); return; }
    if (f.jabatan.length < 2) { tampilPesan('Isi jabatan pelapor.'); return; }
    var salah = periksaBerkas(f.file, true);
    if (salah) { tampilPesan(salah); return; }
    // Cek DULU sebelum mengunggah: kalau tidak, dokumen terlanjur masuk Drive lalu laporan ditolak server (berkas yatim).
    // Server tetap memeriksa ulang di dalam transaksi (kasus dua petugas bersamaan).
    if (String(p.status || '').trim().toUpperCase() === f.status.toUpperCase()) { tampilPesan('Penerima ini sudah berstatus ' + f.status + '.'); return; }

    var box = $('rs-konfirmasi');
    $('rs-aksi').classList.add('hidden');
    box.innerHTML = '<div class="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm">' +
      '<p class="font-bold text-amber-900">Periksa sebelum menyimpan</p>' +
      '<p class="mt-1">Status <b>' + esc(p.nama) + '</b> akan diubah dari <b>' + esc(p.status || '-') + '</b> menjadi <b class="text-red-700">' + esc(f.status) + '</b> (tanggal ' + esc(tglIndo(f.tanggal)) + '). ' +
      'Penerima ini <b>tidak akan dihitung lagi</b> pada pembayaran. Hanya Admin Utama yang dapat mengembalikannya.</p>' +
      '<div class="mt-3 flex gap-2"><button type="button" id="rs-ya" class="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold">Ya, Simpan</button>' +
      '<button type="button" id="rs-batal" class="h-9 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Periksa Lagi</button></div></div>';
    $('rs-batal').addEventListener('click', function () { box.innerHTML = ''; $('rs-aksi').classList.remove('hidden'); });
    $('rs-ya').addEventListener('click', function () { jalankanSimpanLapor(p, f); });
  }

  function kunciForm(kunci) {
    var form = $('rs-form');
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea,button'), function (e) { e.disabled = kunci; });
  }

  function jalankanSimpanLapor(p, f) {
    if (S.sedangSimpan) return;
    S.sedangSimpan = true;
    kunciForm(true);
    var box = $('rs-konfirmasi');
    box.innerHTML = '<p class="text-sm text-slate-600">Mengunggah dokumen ke Google Drive...</p>';
    unggahDokumen(f.file, p, 'DOKUMEN ' + stempel(), function (up) {
      if (!up.sukses) { berhentiSimpan('Gagal mengunggah dokumen: ' + up.pesan); return; }
      box.innerHTML = '<p class="text-sm text-slate-600">Menyimpan laporan...</p>';
      google.script.run
        .withSuccessHandler(function (res) {
          if (!res || !res.sukses) { berhentiSimpan((res && res.pesan) || 'Gagal menyimpan laporan.'); return; }
          S.sedangSimpan = false;
          if (typeof bersihkanCacheUploadUntukNik === 'function') bersihkanCacheUploadUntukNik(p.nik, 'LAPORAN STATUS PENERIMA');
          selesaiLapor(res);
        })
        .withFailureHandler(function (err) { berhentiSimpan(galat(err)); })
        .statusSimpanLaporan(token(), { nik: p.nik, status: f.status, tanggal: f.tanggal, detail: f.detail, namaPelapor: f.namaPelapor, jabatan: f.jabatan, urlDokumen: up.url });
    });
  }

  function berhentiSimpan(pesan) {
    S.sedangSimpan = false;
    kunciForm(false);
    var box = $('rs-konfirmasi'); if (box) box.innerHTML = '';
    var aksi = $('rs-aksi'); if (aksi) aksi.classList.remove('hidden');
    tampilPesan(pesan);
    toast(pesan, 'gagal');
  }

  function selesaiLapor(res) {
    toast('Laporan tersimpan. Status ' + res.nama + ' sekarang: ' + res.statusBaru + '.', 'sukses');
    var area = $('rs-area-form');
    area.innerHTML = '<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">' +
      '<p class="font-bold">Laporan tersimpan</p>' +
      '<p class="mt-1">' + esc(res.nama) + ' (' + esc(res.nik) + '): <b>' + esc(res.statusSebelum || '-') + '</b> &rarr; <b>' + esc(res.statusBaru) + '</b>.</p>' +
      '<button type="button" id="rs-lagi" class="mt-3 h-9 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold">Lapor penerima lain</button></div>';
    $('rs-hasil-nik').innerHTML = '';
    $('rs-nik').value = '';
    S.penerima = null; S.bpjs = null;
    $('rs-lagi').addEventListener('click', function () { area.innerHTML = ''; $('rs-nik').focus(); });
  }

  // -------------------------------------------------------------------------
  // Halaman AKTIVASI KEMBALI (khusus Admin Utama)
  // -------------------------------------------------------------------------
  function renderAktivasi(el) {
    if (!adalahUtama()) { el.innerHTML = '<p class="text-sm text-red-600">Halaman ini hanya untuk Admin Utama.</p>'; return; }
    el.innerHTML = htmlCariNik('Aktivasi Kembali Penerima',
      'Mengembalikan penerima yang berstatus tidak aktif (meninggal, mengundurkan diri, dll.) menjadi <b>AKTIF</b> agar dihitung kembali pada pembayaran. <b>Alasan wajib diisi</b> dan tercatat di riwayat.');
    pasangCariNik(function (p) {
      var area = $('rs-area-form');
      if (p.aktif) {
        area.innerHTML = '<div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Penerima ini sudah berstatus aktif, tidak perlu diaktivasi.</div>';
        return;
      }
      area.innerHTML =
        '<form id="rs-form" class="rounded-xl border border-slate-200 bg-white p-4 space-y-3" novalidate>' +
          '<div><label class="' + LABEL + '" for="rs-alasan">Alasan aktivasi kembali * (minimal 10 karakter)</label>' +
            '<textarea id="rs-alasan" rows="3" maxlength="500" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"></textarea></div>' +
          '<div><label class="' + LABEL + '" for="rs-dokumen">Dokumen pendukung (opsional)</label>' +
            '<input id="rs-dokumen" type="file" accept="image/*,.pdf" class="block w-full text-sm file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold" /></div>' +
          '<div id="rs-pesan" class="hidden rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"></div>' +
          '<div id="rs-konfirmasi"></div>' +
          '<div id="rs-aksi"><button type="submit" class="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">Aktifkan Kembali</button></div>' +
        '</form>';
      $('rs-form').addEventListener('submit', function (e) { e.preventDefault(); mintaKonfirmasiAktivasi(p); });
    });
  }

  function mintaKonfirmasiAktivasi(p) {
    if (S.sedangSimpan) return;
    tampilPesan('');
    var alasan = $('rs-alasan').value.trim();
    var file = $('rs-dokumen').files && $('rs-dokumen').files[0];
    if (alasan.length < 10) { tampilPesan('Alasan wajib diisi (minimal 10 karakter).'); return; }
    var salah = periksaBerkas(file, false);
    if (salah) { tampilPesan(salah); return; }
    var box = $('rs-konfirmasi');
    $('rs-aksi').classList.add('hidden');
    box.innerHTML = '<div class="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm">' +
      '<p class="font-bold text-amber-900">Periksa sebelum menyimpan</p>' +
      '<p class="mt-1"><b>' + esc(p.nama) + '</b> akan diaktifkan kembali (status sekarang: <b>' + esc(p.status || '-') + '</b>) dan <b>dihitung lagi pada pembayaran</b>.</p>' +
      '<div class="mt-3 flex gap-2"><button type="button" id="rs-ya" class="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold">Ya, Aktifkan</button>' +
      '<button type="button" id="rs-batal" class="h-9 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Periksa Lagi</button></div></div>';
    $('rs-batal').addEventListener('click', function () { box.innerHTML = ''; $('rs-aksi').classList.remove('hidden'); });
    $('rs-ya').addEventListener('click', function () { jalankanAktivasi(p, alasan, file); });
  }

  function jalankanAktivasi(p, alasan, file) {
    if (S.sedangSimpan) return;
    S.sedangSimpan = true; kunciForm(true);
    var box = $('rs-konfirmasi');
    var kirim = function (url) {
      box.innerHTML = '<p class="text-sm text-slate-600">Menyimpan...</p>';
      google.script.run
        .withSuccessHandler(function (res) {
          if (!res || !res.sukses) { berhentiSimpan((res && res.pesan) || 'Gagal mengaktifkan kembali.'); return; }
          S.sedangSimpan = false;
          if (typeof bersihkanCacheUploadUntukNik === 'function') bersihkanCacheUploadUntukNik(p.nik, 'LAPORAN STATUS PENERIMA');
          toast(res.nama + ' diaktifkan kembali.', 'sukses');
          $('rs-area-form').innerHTML = '<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p class="font-bold">Aktivasi kembali tersimpan</p>' +
            '<p class="mt-1">' + esc(res.nama) + ' (' + esc(res.nik) + '): <b>' + esc(res.statusSebelum || '-') + '</b> &rarr; <b>AKTIF</b>.</p></div>';
          $('rs-hasil-nik').innerHTML = ''; $('rs-nik').value = '';
        })
        .withFailureHandler(function (err) { berhentiSimpan(galat(err)); })
        .statusAktivasiKembali(token(), { nik: p.nik, alasan: alasan, urlDokumen: url || '' });
    };
    if (!file) { kirim(''); return; }
    box.innerHTML = '<p class="text-sm text-slate-600">Mengunggah dokumen ke Google Drive...</p>';
    unggahDokumen(file, p, 'DOKUMEN AKTIVASI ' + stempel(), function (up) {
      if (!up.sukses) { berhentiSimpan('Gagal mengunggah dokumen: ' + up.pesan); return; }
      kirim(up.url);
    });
  }

  // -------------------------------------------------------------------------
  // Halaman REKAP
  // -------------------------------------------------------------------------
  function renderRekap(el, ctx) {
    el.innerHTML =
      '<div class="rounded-xl border border-slate-200 bg-white p-4 mb-4">' +
        '<h3 class="text-sm font-bold text-slate-800 mb-1">Data Tidak Aktif / Meninggal Dunia</h3>' +
        '<p class="text-xs text-slate-500 mb-3">Riwayat laporan status penerima sesuai hak akses Anda, terbaru di atas.</p>' +
        '<form id="rs-form-rekap" class="flex flex-col sm:flex-row gap-2">' +
          '<input id="rs-kata" type="search" autocomplete="off" placeholder="Cari NIK atau nama (minimal 3 karakter), kosongkan untuk semua" class="' + INPUT + ' flex-1" />' +
          '<button type="submit" class="h-10 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold">Cari</button>' +
          '<button type="button" id="rs-unduh" class="h-10 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold">Unduh Excel</button>' +
        '</form></div>' +
      '<div id="rs-rekap-isi"><p class="text-sm text-slate-500">Memuat...</p></div>';
    var muat = function () {
      var kata = $('rs-kata').value.trim();
      if (kata && kata.length < 3) { toast('Isi minimal 3 karakter, atau kosongkan.', 'gagal'); return; }
      var seq = ++S.seq;
      $('rs-rekap-isi').innerHTML = '<p class="text-sm text-slate-500">Memuat...</p>';
      google.script.run
        .withSuccessHandler(function (res) { if (seq === S.seq) tampilRekap(res); })
        .withFailureHandler(function (err) { if (seq === S.seq) $('rs-rekap-isi').innerHTML = '<p class="text-sm text-red-600">' + esc(galat(err)) + '</p>'; })
        .statusRekap(token(), Number(ctx.tahun()), kata);
    };
    $('rs-form-rekap').addEventListener('submit', function (e) { e.preventDefault(); muat(); });
    $('rs-unduh').addEventListener('click', function () {
      var b = $('rs-unduh'); b.disabled = true; var asli = b.textContent; b.textContent = 'Menyiapkan...';
      google.script.run
        .withSuccessHandler(function (res) {
          b.disabled = false; b.textContent = asli;
          if (!res || !res.sukses) { toast((res && res.pesan) || 'Gagal membuat Excel.', 'gagal'); return; }
          if (typeof unduhFileBase64 === 'function') unduhFileBase64(res.base64, res.namaFile);
        })
        .withFailureHandler(function (err) { b.disabled = false; b.textContent = asli; toast(galat(err), 'gagal'); })
        .statusUnduhExcelRekap(token(), Number(ctx.tahun()));
    });
    muat();
  }

  function tampilRekap(res) {
    var wadah = $('rs-rekap-isi');
    if (!wadah) return;
    if (!res || !res.sukses) { wadah.innerHTML = '<p class="text-sm text-red-600">' + esc((res && res.pesan) || 'Gagal memuat rekap.') + '</p>'; return; }
    if (!res.rows.length) { wadah.innerHTML = '<p class="text-sm text-slate-500">Belum ada laporan status penerima pada akses Anda untuk tahun ' + esc(res.tahun) + '.</p>'; return; }
    var th = function (t) { return '<th class="px-3 py-2 whitespace-nowrap">' + t + '</th>'; };
    wadah.innerHTML =
      '<p class="text-xs text-slate-500 mb-2">' + res.rows.length + ' laporan' + (res.terpotong ? ' (dibatasi 2000 terbaru)' : '') + '</p>' +
      '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase"><tr>' +
        th('Tanggal') + th('Nama') + th('NIK') + th('Layanan') + th('Kecamatan') + th('Kelurahan') + th('Status') + th('Sebelumnya') + th('Keterangan') + th('Pelapor') + th('Dokumen') +
      '</tr></thead><tbody>' + res.rows.map(function (r) {
        return '<tr class="border-t border-slate-100 align-top">' +
          '<td class="px-3 py-2 whitespace-nowrap">' + esc(tglIndo(r.tanggal)) + '</td>' +
          '<td class="px-3 py-2 font-medium text-slate-800">' + esc(r.nama) + '</td>' +
          '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(r.nik) + '</td>' +
          '<td class="px-3 py-2">' + esc(r.layanan) + '</td>' +
          '<td class="px-3 py-2">' + esc(r.kecamatan) + '</td>' +
          '<td class="px-3 py-2">' + esc(r.kelurahan) + '</td>' +
          '<td class="px-3 py-2">' + lencana(r.jenis === 'AKTIVASI' ? 'AKTIVASI KEMBALI' : r.status, r.jenis) + '</td>' +
          '<td class="px-3 py-2 text-xs text-slate-600">' + esc(r.statusSebelum || '-') + '</td>' +
          '<td class="px-3 py-2 min-w-[12rem] text-xs">' + esc(r.detail || '-') + '</td>' +
          '<td class="px-3 py-2 text-xs">' + esc(r.pelapor) + '<br><span class="text-slate-500">' + esc(r.jabatan) + '</span></td>' +
          '<td class="px-3 py-2 whitespace-nowrap">' + (linkDriveAman(r.urlDokumen) ? '<a href="' + esc(r.urlDokumen) + '" target="_blank" rel="noopener noreferrer" class="text-sky-700 underline text-xs">Lihat</a>' : '<span class="text-slate-400 text-xs">-</span>') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // -------------------------------------------------------------------------
  // Antarmuka untuk app-retur.js
  // -------------------------------------------------------------------------
  window.rtStatus = {
    render: function (view, el, ctx) {
      S.seq++; S.sedangSimpan = false;
      if (view === 'lapor') renderLapor(el);
      else if (view === 'rekap') renderRekap(el, ctx || { tahun: function () { return '2027'; } });
      else if (view === 'aktivasi') renderAktivasi(el);
    },
    // Dipanggil saat sesi/pengguna berganti: buang semua state milik sesi lama.
    reset: function () { S.statuses = null; S.penerima = null; S.bpjs = null; S.seq++; S.sedangSimpan = false; }
  };
})();
