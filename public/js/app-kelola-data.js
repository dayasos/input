(function () {
  'use strict';

  var tab = document.getElementById('tab-kelola-data');
  var panel = document.getElementById('panel-kelola-data');
  if (!tab || !panel) return;

  // ---------------------------------------------------------------------------
  // Konfigurasi
  // ---------------------------------------------------------------------------
  var FIELD = [
    { k: 'nama', d: 'nama', l: 'Nama Lengkap', lebar: 2, maks: 100 },
    { k: 'nik', d: 'nik', l: 'NIK (16 digit)', mentah: true, maks: 16, mode: 'numeric' },
    { k: 'jenis_kelamin', d: 'jenisKelamin', l: 'Jenis Kelamin', pilih: ['LAKI-LAKI', 'PEREMPUAN'] },
    { k: 'tempat_lahir', d: 'tempatLahir', l: 'Tempat Lahir', maks: 100 },
    { k: 'tanggal_lahir', d: 'tanggalLahir', l: 'Tanggal Lahir (DD-MM-YYYY)', mentah: true, maks: 10, mode: 'numeric' },
    { k: 'alamat', d: 'alamat', l: 'Alamat Domisili', lebar: 2, area: true, maks: 100 },
    { k: 'layanan', d: 'layanan', l: 'Layanan', sel: 'layanan' },
    { k: 'tempat_tugas', d: 'tempatTugas', l: 'Tempat Tugas', maks: 100 },
    { k: 'alamat_tugas', d: 'alamatTugas', l: 'Alamat Tugas', lebar: 2, area: true, maks: 100 },
    { k: 'kecamatan', d: 'kecamatan', l: 'Kecamatan', sel: 'kecamatan' },
    { k: 'kelurahan', d: 'kelurahan', l: 'Kelurahan', sel: 'kelurahan' },
    { k: 'nama_rekening', d: 'namaRekening', l: 'Nama Rekening', maks: 100 },
    { k: 'nomor_rekening', d: 'nomorRekening', l: 'Nomor Rekening (14 digit)', mentah: true, maks: 14, mode: 'numeric' },
    { k: 'kantor_cabang', d: 'kantorCabang', l: 'Kantor Cabang', maks: 100 },
    { k: 'no_kontak', d: 'noKontak', l: 'No. Kontak', mentah: true, maks: 20, mode: 'tel' },
    { k: 'status_bpjs_tk', d: 'statusBpjs', l: 'Status BPJS TK', pilih: ['YA', 'TIDAK'] }
  ];

  // Kelas input/label disamakan dengan panel Lihat Data (filter & modal detail).
  var KELAS_INPUT = 'w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-700 shadow-2xs transition disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';
  // slate-500 (bukan 400 seperti tampilan baca di Lihat Data): label ini menempel pada kolom isian, kontrasnya harus cukup.
  var KELAS_LABEL = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';
  var KELAS_LABEL_FILTER = 'block text-xs font-medium text-slate-600 mb-1';
  var KELAS_FILTER = KELAS_INPUT;
  var KELAS_TOMBOL_TEPI = 'bg-white hover:bg-slate-50 active:scale-95 border border-slate-300 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-sm flex items-center gap-1.5 shrink-0';
  var TOTAL_JENIS_BERKAS = 12;
  var KOLOM_TABEL = 10; // termasuk kolom centang (disembunyikan untuk tahun arsip)

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  // waktu: kapan daftar terakhir dimuat -- dipakai TTL yang sama dengan Lihat Data (lihat tombol tab).
  var S = { siap: false, tahun: null, tahunAktif: null, page: 1, limit: 20, total: 0, totalHalaman: 1, bolehUbah: true, opsi: null, daftar: [], seq: 0, pilih: {}, waktu: 0, kotor: false };
  var D = { data: null, berkas: [], versi: '', bolehUbah: false, jumlahBatch: 0, asli: {}, sibuk: false, pilihBerkas: {}, seq: 0 };
  var timerCari = null;

  // ---------------------------------------------------------------------------
  // Util
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function adalahUtama() {
    return typeof dataPengguna !== 'undefined' && dataPengguna && String(dataPengguna.role || '').trim().toUpperCase() === 'UTAMA';
  }

  function token() {
    return (typeof dataPengguna !== 'undefined' && dataPengguna && dataPengguna.token) || '';
  }

  // Panggil aksi backend sebagai Promise; token sesi otomatis jadi argumen pertama.
  function api(aksi) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var run = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      run[aksi].apply(run, [token()].concat(args));
    });
  }

  // Versi SWR dari api(): handler dipanggil SEKALI dari cache (stale, instan) lalu sekali lagi bila
  // data segar dari server berbeda. Promise tidak cocok karena hanya menerima panggilan pertama.
  function apiSWR(aksi, args, onData, onError) {
    var run = google.script.run.withSuccessHandler(onData).withFailureHandler(onError);
    run[aksi].apply(run, [token()].concat(args));
  }

  function ttlSegarMs() {
    return typeof TTL_CACHE_DATA_TRANSAKSI_MS !== 'undefined' ? TTL_CACHE_DATA_TRANSAKSI_MS : 90 * 1000;
  }

  // Ada modal/proses yang sedang berjalan? Refresh senyap dari event realtime tidak boleh mengganggunya.
  function sedangSibuk() {
    var terbuka = function (id) { var el = $(id); return !!el && !el.classList.contains('hidden'); };
    return D.sibuk || M.sibuk || terbuka('kd-modal-detail') || terbuka('kd-modal-hapus') || terbuka('kd-modal-massal');
  }

  // Perubahan dari luar yang tertahan selama modal terbuka dimuat begitu semua modal tertutup.
  function susulKotor() {
    if (S.kotor && S.siap && !sedangSibuk()) muat();
  }

  function pesanDariError(e) {
    var m = (e && e.message) ? e.message : String(e || '');
    if (/network|fetch|timeout|timed out|internet|koneksi/i.test(m) && typeof pesanErrorRamah === 'function') return pesanErrorRamah(e);
    return m || 'Terjadi kesalahan.';
  }

  function toast(pesan, jenis, durasi) {
    if (typeof tampilkanToast === 'function') tampilkanToast(pesan, jenis, { durasi: durasi || 5000 });
  }

  // Pilih <option> yang cocok TANPA membedakan huruf besar/kecil (data tersimpan huruf besar, master bisa campuran).
  function setPilihan(sel, nilai) {
    var target = String(nilai || '').toUpperCase();
    for (var i = 0; i < sel.options.length; i++) {
      if (String(sel.options[i].value).toUpperCase() === target) { sel.selectedIndex = i; return; }
    }
    sel.value = nilai || '';
  }

  function linkAman(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  function nilaiEl(id) { var el = $(id); return el ? String(el.value || '').trim() : ''; }

  function batalkanCacheLama() {
    // Menu "Lihat Data" menyimpan salinan sendiri; buang supaya tidak menampilkan data yang sudah diubah/dihapus.
    try { if (typeof invalidateCacheDataTransaksi === 'function') invalidateCacheDataTransaksi(); } catch (_e) { /* abaikan */ }
  }

  var overlayAsli = null;
  function overlay(tampil, judul, pesan) {
    var o = $('loading-overlay'), j = $('loading-overlay-judul'), p = $('loading-overlay-pesan');
    if (!o) return;
    if (tampil) {
      if (!overlayAsli && j && p) overlayAsli = { j: j.innerHTML, p: p.innerHTML };
      if (j) j.textContent = judul || 'MEMPROSES...';
      if (p) p.textContent = pesan || 'Mohon tunggu sebentar.';
      o.classList.remove('hidden');
    } else {
      o.classList.add('hidden');
      var pc = $('loading-progress-container');
      if (pc) pc.classList.add('hidden');
      if (overlayAsli && j && p) { j.innerHTML = overlayAsli.j; p.innerHTML = overlayAsli.p; overlayAsli = null; }
    }
  }

  function badgeStatus(status) {
    // Badge yang sama persis dengan kolom Verifikasi di Lihat Data.
    if (typeof badgeStatusVerifikasi === 'function') return badgeStatusVerifikasi(status);
    var s = String(status || '').toUpperCase();
    var kelas = 'bg-slate-100 text-slate-600 border-slate-200';
    if (s.indexOf('TIDAK MEMENUHI') === 0) kelas = 'bg-rose-50 text-rose-700 border-rose-200';
    else if (s.indexOf('MEMENUHI') === 0 || s === 'AKTIF') kelas = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    else if (s.indexOf('TIDAK LENGKAP') !== -1) kelas = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (s.indexOf('PROSES') !== -1) kelas = 'bg-sky-50 text-sky-700 border-sky-200';
    return '<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ' + kelas + '">' + esc(status || '-') + '</span>';
  }

  function pillBerkas(n) {
    var kelas = n === 0 ? 'bg-rose-50 text-rose-700 border border-rose-200/80' : 'bg-slate-100 text-slate-700';
    return '<span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ' + kelas + '">' + n + ' berkas</span>';
  }

  // ---------------------------------------------------------------------------
  // Kerangka layar (dirender sekali saat pertama dibuka)
  // ---------------------------------------------------------------------------
  var IKON_MUAT = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
  var IKON_TAMBAH = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>';
  var IKON_HAPUS = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';

  var IKON_FILTER = '<svg class="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>';
  var IKON_MATA = '<svg class="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';

  function renderKerangka() {
    panel.innerHTML =
      // Header + total + toolbar (sama dengan Lihat Data)
      '<div class="flex flex-col gap-3 mb-6 border-b border-slate-100 pb-4">' +
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">' +
      '<div><h2 class="text-xl font-bold text-slate-800">Kelola Data &amp; Berkas</h2>' +
      '<p class="text-xs text-slate-500 mt-1">Khusus Admin Utama. Lihat, ubah, ganti berkas, dan hapus data penerima dari seluruh kecamatan dan Kemenag.</p></div>' +
      '<div id="kd-total" class="self-start sm:self-auto flex-shrink-0 whitespace-nowrap bg-sky-50 text-sky-700 px-3 py-1 rounded-lg text-xs font-semibold border-2 border-sky-400">Total Data: Dimuat</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 flex-nowrap overflow-x-auto pb-1">' +
      '<div class="flex items-center gap-1.5 bg-white border border-slate-300 rounded-xl px-3 py-1.5 shadow-sm text-xs shrink-0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
      '<span class="font-bold text-slate-500 uppercase tracking-wider text-[11px]">Tahun</span>' +
      '<select id="kd-tahun" aria-label="Tahun data" class="text-xs font-bold text-slate-800 bg-transparent border-none outline-none cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-sky-500/40"><option value="">...</option></select>' +
      '</div>' +
      '<button type="button" data-kd="tambah" id="kd-btn-tambah" class="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-sm flex items-center gap-1.5 shrink-0">' + IKON_TAMBAH + '<span>Tambah Data</span></button>' +
      '<button type="button" data-kd="muat" class="' + KELAS_TOMBOL_TEPI + '" title="Refresh Data">' + IKON_MUAT + '<span>Refresh</span></button>' +
      '</div>' +
      '</div>' +

      // Panel penyaringan (sama dengan Lihat Data)
      '<div class="mb-5 bg-slate-50 p-4 rounded-xl border border-slate-200/80 shadow-2xs space-y-3">' +
      '<div class="flex items-center justify-between flex-wrap gap-2">' +
      '<div class="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">' + IKON_FILTER + '<span>Penyaringan &amp; Pencarian Data</span></div>' +
      '<button type="button" data-kd="reset-filter" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 border border-slate-300 rounded-xl text-xs font-semibold shadow-2xs transition">' +
      IKON_MUAT + '<span>Reset Filter</span></button>' +
      '</div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">' +
      '<div class="col-span-2 lg:col-span-1"><label for="kd-cari" class="' + KELAS_LABEL_FILTER + '">Cari Nama / NIK</label>' +
      '<input type="text" id="kd-cari" placeholder="Ketik kata kunci..." autocomplete="off" style="text-transform:none" class="' + KELAS_FILTER + '"></div>' +
      '<div><label for="kd-kategori" class="' + KELAS_LABEL_FILTER + '">Filter Instansi</label>' +
      '<select id="kd-kategori" class="' + KELAS_FILTER + '"><option value="">-- Semua Instansi --</option><option value="KECAMATAN">Kecamatan</option><option value="KEMENAG">Kemenag</option></select></div>' +
      '<div><label for="kd-kecamatan" class="' + KELAS_LABEL_FILTER + '">Filter Kecamatan</label>' +
      '<select id="kd-kecamatan" class="' + KELAS_FILTER + '"><option value="">-- Semua Kecamatan --</option></select></div>' +
      '<div><label for="kd-layanan" class="' + KELAS_LABEL_FILTER + '">Filter Jenis Layanan</label>' +
      '<select id="kd-layanan" class="' + KELAS_FILTER + '"><option value="">-- Semua Layanan --</option></select></div>' +
      '<div><label for="kd-kelengkapan" class="' + KELAS_LABEL_FILTER + '">Filter Kelengkapan Berkas</label>' +
      '<select id="kd-kelengkapan" class="' + KELAS_FILTER + '"><option value="">-- Semua --</option><option value="ADA">Punya berkas</option><option value="KOSONG">Belum ada berkas</option></select></div>' +
      '</div>' +
      '</div>' +

      '<div id="kd-banner-arsip" class="hidden mb-4 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium"></div>' +
      '<div id="kd-error" class="hidden mb-4 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium"></div>' +

      '<div id="kd-bar-pilih" class="hidden sticky top-2 z-20 mb-3 p-2.5 sm:p-3 rounded-xl border border-sky-200 bg-sky-50 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">' +
      '<span id="kd-bar-info" class="text-xs font-semibold text-sky-800"></span>' +
      '<div class="flex items-center gap-2 flex-wrap">' +
      '<button type="button" data-kd="pilih-halaman" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold transition">Pilih semua di halaman</button>' +
      '<button type="button" data-kd="kosongkan-pilih" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold transition">Kosongkan</button>' +
      '<button type="button" data-kd="hapus-terpilih" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-lg text-[11px] font-bold shadow-sm transition flex items-center gap-1.5">' + IKON_HAPUS + '<span>Hapus Terpilih</span></button>' +
      '</div>' +
      '</div>' +

      // Tabel (sama dengan Lihat Data: digeser ke samping di layar kecil)
      '<div class="sm:hidden flex items-center justify-between text-xs text-slate-500 bg-slate-50/90 px-3 py-2 rounded-xl mb-2 border border-slate-200/60 shadow-2xs">' +
      '<span class="flex items-center gap-1.5 font-medium">' +
      '<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>' +
      '<span>Geser tabel ke samping untuk melihat detail status &amp; tombol aksi</span></span>' +
      '</div>' +
      '<div id="kd-hasil" class="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xs transition-opacity duration-150">' +
      '<table class="w-full min-w-[920px] text-left border-collapse bg-white table-auto">' +
      '<thead><tr class="bg-slate-800 text-white text-[11px] font-bold tracking-wider uppercase select-none border-b border-slate-700/80">' +
      '<th id="kd-th-pilih" class="w-12 px-3 py-3.5 text-center align-middle"><input type="checkbox" id="kd-cek-semua" aria-label="Pilih semua di halaman" class="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"></th>' +
      '<th class="w-14 px-3 py-3.5 text-center whitespace-nowrap align-middle">No</th>' +
      '<th class="px-4 py-3.5 min-w-[200px] whitespace-nowrap align-middle">Nama Penerima</th>' +
      '<th class="px-4 py-3.5 whitespace-nowrap align-middle">NIK / No. KTP</th>' +
      '<th class="px-4 py-3.5 min-w-[150px] whitespace-nowrap align-middle">Jenis Layanan</th>' +
      '<th class="px-4 py-3.5 min-w-[130px] whitespace-nowrap align-middle">Kecamatan</th>' +
      '<th class="px-4 py-3.5 min-w-[130px] whitespace-nowrap align-middle">Kelurahan</th>' +
      '<th class="px-4 py-3.5 text-center whitespace-nowrap align-middle">Berkas</th>' +
      '<th class="px-4 py-3.5 text-center min-w-[160px] whitespace-nowrap align-middle">Verifikasi</th>' +
      '<th class="px-4 py-3.5 text-center min-w-[130px] whitespace-nowrap align-middle">Aksi</th>' +
      '</tr></thead>' +
      '<tbody id="kd-tbody" class="text-sm text-slate-700 divide-y divide-slate-100 bg-white"></tbody>' +
      '</table>' +
      '</div>' +

      '<div class="mt-5 border-t border-slate-100 pt-4">' +
      '<div class="flex items-center justify-between flex-wrap gap-2">' +
      '<span class="text-[9px] text-slate-400 tracking-widest uppercase font-semibold">Developed by &nbsp;&middot;&nbsp; <span style="color:#ca8a04;">Tim Kelembagaan Bidang Dayasos</span></span>' +
      '<div id="kd-info-halaman" class="text-xs text-slate-500 font-medium"></div>' +
      '</div>' +
      '<div id="kd-pagination" class="flex items-center gap-1 flex-wrap justify-center mt-2"></div>' +
      '</div>';

    pasangModal();
  }

  function pasangModal() {
    if ($('kd-modal-detail')) return;
    document.body.insertAdjacentHTML('beforeend',
      // ── Modal detail / edit ──
      // Kerangka sama dengan modal detail Lihat Data (header putih, sudut membulat besar, kaki abu muda).
      '<div id="kd-modal-detail" role="dialog" aria-modal="true" aria-labelledby="kd-detail-judul" class="hidden fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 md:p-6 overflow-hidden">' +
      '<div class="bg-white rounded-2xl sm:rounded-3xl w-full max-w-lg sm:max-w-3xl lg:max-w-5xl shadow-2xl border border-slate-200/80 flex flex-col max-h-[94vh] max-h-[94dvh] sm:max-h-[90vh] sm:max-h-[90dvh]">' +
      '<div class="shrink-0 flex justify-between items-center px-5 sm:px-7 py-4 border-b border-slate-100 bg-white rounded-t-2xl sm:rounded-t-3xl">' +
      '<div class="flex items-center gap-2.5 min-w-0">' +
      '<svg class="w-5 h-5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z"/></svg>' +
      '<div class="min-w-0"><h3 id="kd-detail-judul" class="text-sm sm:text-base font-bold text-slate-800 tracking-wide uppercase truncate">Detail Data</h3>' +
      '<p id="kd-detail-sub" class="text-[11px] text-slate-400 truncate"></p></div>' +
      '</div>' +
      '<button type="button" data-kd="tutup-detail" class="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg text-xl font-semibold leading-none transition ml-3" aria-label="Tutup">&times;</button>' +
      '</div>' +
      '<div id="kd-detail-isi" class="flex-1 overflow-y-auto p-4 sm:p-6 text-sm text-slate-700 overscroll-contain"></div>' +
      '<div id="kd-detail-kaki" class="shrink-0 px-5 sm:px-7 py-3.5 bg-slate-50/90 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 rounded-b-2xl sm:rounded-b-3xl"></div>' +
      '</div>' +
      '</div>' +

      // ── Modal konfirmasi hapus data (ketik NIK) ──
      '<div id="kd-modal-hapus" class="hidden fixed inset-0 z-[180] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4">' +
      '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-100 overflow-hidden max-h-[92vh] max-h-[92dvh] flex flex-col">' +
      '<div class="px-5 pt-5 pb-3 text-center shrink-0">' +
      '<div class="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3 bg-rose-100 text-rose-600 ring-8 ring-rose-50">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>' +
      '<h3 class="text-base font-bold text-slate-900">Hapus Data Penerima?</h3>' +
      '<p class="text-xs text-slate-500 mt-1">Data dihapus <b>permanen</b> dan tidak dapat dikembalikan. Berkas di Google Drive dipindah ke Sampah Drive (dapat dipulihkan sekitar 30 hari).</p>' +
      '</div>' +
      '<div id="kd-hapus-isi" class="px-5 pb-2 overflow-y-auto flex-1"></div>' +
      '<div class="px-5 py-4 flex items-center gap-2 border-t border-slate-100 shrink-0">' +
      '<button type="button" data-kd="batal-hapus" class="flex-1 py-2.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition">Batal</button>' +
      '<button type="button" data-kd="konfirmasi-hapus" id="kd-hapus-ya" disabled class="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-md transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100">Hapus Permanen</button>' +
      '</div>' +
      '</div>' +
      '</div>');

    var md = $('kd-modal-detail');
    md.addEventListener('click', function (e) {
      if (e.target === md) tutupDetail();
    });
    md.addEventListener('click', aksiModalDetail);
    md.addEventListener('input', tandaiPerubahan);
    md.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.id === 'kd-f-kecamatan') isiKelurahan(t.value, '');
      if (t && t.id === 'kd-berkas-semua') { pilihSemuaBerkas(t.checked); return; }
      if (t && t.hasAttribute && t.hasAttribute('data-kd-berkas')) {
        var ib = Number(t.getAttribute('data-kd-berkas')), bb = cariBerkas(ib);
        if (t.checked && bb) D.pilihBerkas[ib] = bb.link; else delete D.pilihBerkas[ib];
        perbaruiBarBerkas();
        return;
      }
      if (t && t.matches && t.matches('input[type="file"][data-kd-file]')) {
        var f = t.files && t.files[0];
        var idx = Number(t.getAttribute('data-kd-file'));
        t.value = '';
        if (f) gantiBerkas(idx, f);
        return;
      }
      tandaiPerubahan();
    });

    var mh = $('kd-modal-hapus');
    mh.addEventListener('click', function (e) {
      if (e.target === mh) tutupHapus();
      var b = e.target.closest && e.target.closest('[data-kd]');
      if (!b) return;
      if (b.getAttribute('data-kd') === 'batal-hapus') tutupHapus();
      if (b.getAttribute('data-kd') === 'konfirmasi-hapus') eksekusiHapusData();
    });
    mh.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'kd-hapus-nik') periksaKonfirmasiNik();
    });
    mh.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'kd-hapus-nik') { e.preventDefault(); if (!$('kd-hapus-ya').disabled) eksekusiHapusData(); }
      if (e.key === 'Escape') tutupHapus();
    });
  }

  // ---------------------------------------------------------------------------
  // Daftar
  // ---------------------------------------------------------------------------
  function tampilError(pesan) {
    var el = $('kd-error');
    if (!el) return;
    if (pesan) { el.textContent = pesan; el.classList.remove('hidden'); } else { el.classList.add('hidden'); el.textContent = ''; }
  }

  // Baris lama tetap tampil (agak pudar) selama memuat ulang; skeleton hanya bila tabel masih kosong
  // -- pola yang sama dengan Lihat Data.
  function setMemuat(ya) {
    var h = $('kd-hasil');
    // pointer-events-none: baris lama yang sedang diganti tidak boleh diklik (Kelola/Hapus) selagi memuat.
    if (h) { var pudar = !!ya && S.daftar.length > 0; h.classList.toggle('opacity-60', pudar); h.classList.toggle('pointer-events-none', pudar); }
  }

  function skeletonTabel() {
    var tb = $('kd-tbody');
    if (tb && typeof htmlSkeletonBaris === 'function') tb.innerHTML = htmlSkeletonBaris(KOLOM_TABEL, 5);
  }

  function barisPesan(teks, kelas) {
    var tb = $('kd-tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="' + KOLOM_TABEL + '" class="px-4 py-8 text-center italic ' + (kelas || 'text-slate-400') + '">' + esc(teks) + '</td></tr>';
  }

  function isiOpsiFilter(opsi) {
    if (!opsi) return;
    var selLay = $('kd-layanan'), selKec = $('kd-kecamatan');
    if (selLay && selLay.options.length <= 1) {
      var h = '<option value="">-- Semua Layanan --</option>';
      h += '<optgroup label="Kecamatan">' + (opsi.layananKecamatan || []).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') + '</optgroup>';
      h += '<optgroup label="Kemenag">' + (opsi.layananKemenag || []).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') + '</optgroup>';
      selLay.innerHTML = h;
    }
    if (selKec && selKec.options.length <= 1) {
      selKec.innerHTML = '<option value="">-- Semua Kecamatan --</option>' + (opsi.kecamatan || []).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    }
  }

  function isiPilihanTahun(res) {
    var sel = $('kd-tahun');
    if (!sel) return;
    var list = res.tahunTersedia || [res.tahunAktif];
    var html = list.map(function (t) {
      return '<option value="' + t + '"' + (Number(t) === Number(res.tahun) ? ' selected' : '') + '>' + t + (Number(t) === Number(res.tahunAktif) ? ' (Aktif)' : '') + '</option>';
    }).join('');
    // Balasan cache lalu balasan segar sering identik: jangan bangun ulang (menutup dropdown yang sedang dibuka).
    if (sel.dataset.isi !== html) { sel.innerHTML = html; sel.dataset.isi = html; }
    sel.value = String(res.tahun);
  }

  // Stale-while-revalidate lewat api-bridge (domain 'penerima'): bila ada salinan cache, daftar tampil
  // seketika lalu diperbarui diam-diam kalau data server berbeda. Promise-nya selesai pada balasan
  // pertama (cache atau server) -- cukup untuk alur "simpan lalu muat ulang".
  function muat() {
    var seq = ++S.seq;
    var filter = {
      tahun: S.tahun, page: S.page, limit: S.limit,
      cari: nilaiEl('kd-cari'), kategori: nilaiEl('kd-kategori'), layanan: nilaiEl('kd-layanan'),
      kecamatan: nilaiEl('kd-kecamatan'), kelengkapan: nilaiEl('kd-kelengkapan')
    };
    var pernahTampil = false;
    S.kotor = false;
    tampilError('');
    if (S.daftar.length === 0) skeletonTabel();
    setMemuat(true);
    // Progress bar atas: selesai pada balasan pertama (cache/server) -- dipanggil sekali saja per muat().
    var akhiriProgres = typeof progresSekali === 'function' ? progresSekali() : function () { };

    return new Promise(function (selesai) {
      apiSWR('adminDaftarData', [filter], function (res) {
        akhiriProgres();
        if (seq !== S.seq) return selesai();
        setMemuat(false);
        if (!res || !res.sukses) {
          var pesan = (res && res.pesan) || 'Gagal memuat data.';
          if (pernahTampil) toast(pesan, 'peringatan'); else { tampilError(pesan); if (S.daftar.length === 0) barisPesan(pesan, 'text-rose-500'); }
          return selesai();
        }
        // Halaman terakhir baru saja kosong (mis. semua baris dihapus): mundur ke halaman terakhir yang ada.
        if (res.daftar.length === 0 && res.total > 0 && S.page > res.totalHalaman) { S.page = res.totalHalaman; return selesai(muat()); }
        if (S.tahun !== res.tahun || !res.bolehUbah) S.pilih = {};
        S.tahun = res.tahun; S.tahunAktif = res.tahunAktif; S.total = res.total; S.totalHalaman = res.totalHalaman;
        S.bolehUbah = !!res.bolehUbah; S.opsi = res.opsi; S.daftar = res.daftar; S.waktu = Date.now();
        pernahTampil = true;
        isiPilihanTahun(res); isiOpsiFilter(res.opsi);
        renderDaftar();
        selesai();
      }, function (e) {
        if (seq !== S.seq) return selesai();
        setMemuat(false);
        var pesan = pesanDariError(e);
        if (pernahTampil || S.daftar.length > 0) toast(pesan, 'gagal', 6000); else { tampilError(pesan); barisPesan(pesan, 'text-rose-500'); }
        selesai();
      });
    });
  }

  // Refresh manual: buang cache SWR tab ini dulu, kalau tidak klik dalam jeda kesegaran (20 dtk) hanya
  // menampilkan ulang salinan lama. broadcast:false -- ini bukan mutasi data, tidak perlu ke tab lain.
  var abaikanEvent = false;
  function segarkan() {
    batalkanCacheLama();
    abaikanEvent = true;
    try {
      if (window.djpmCache && typeof window.djpmCache.invalidate === 'function') window.djpmCache.invalidate(['penerima', 'penerima_detail'], false);
    } finally { abaikanEvent = false; }
    muat();
  }

  function resetFilter() {
    ['kd-cari', 'kd-kategori', 'kd-kecamatan', 'kd-layanan', 'kd-kelengkapan'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
    S.page = 1;
    muat();
    toast('Filter telah disetel ulang', 'info', 2000);
  }

  function renderDaftar() {
    var tbody = $('kd-tbody');
    var offset = (S.page - 1) * S.limit;
    var banner = $('kd-banner-arsip');
    if (banner) {
      banner.classList.toggle('hidden', S.bolehUbah);
      banner.textContent = 'Data tahun ' + S.tahun + ' adalah arsip dan hanya bisa dilihat. Sumbernya Google Sheet dan disinkronkan otomatis, sehingga perubahan di sini tidak akan bertahan.';
    }
    var tambah = $('kd-btn-tambah');
    if (tambah) tambah.classList.toggle('hidden', !S.bolehUbah);

    if (S.daftar.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (S.bolehUbah ? KOLOM_TABEL : KOLOM_TABEL - 1) + '" class="px-4 py-8 text-center text-slate-400 italic">Tidak ada data yang sesuai filter atau kata kunci.</td></tr>';
    } else {
      tbody.innerHTML = S.daftar.map(function (r, i) {
        return '<tr class="hover:bg-sky-50/40 transition-colors duration-150 border-b border-slate-100/90' + (S.pilih[r.id] ? ' bg-sky-50/60' : '') + '">' +
          (S.bolehUbah ? '<td class="w-12 px-3 py-3 text-center align-middle">' + kotakPilih(r) + '</td>' : '') +
          '<td class="w-14 px-3 py-3 text-center font-medium text-xs text-slate-400 align-middle whitespace-nowrap">' + (offset + i + 1) + '</td>' +
          '<td class="px-4 py-3 font-semibold text-slate-800 break-words align-middle min-w-[200px]">' + (esc(r.nama) || '-') + '</td>' +
          '<td class="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap align-middle">' + (esc(r.nik) || '-') + '</td>' +
          '<td class="px-4 py-3 whitespace-nowrap align-middle min-w-[150px]"><span class="bg-slate-100 text-slate-700 text-[11px] px-2.5 py-0.5 rounded-full font-medium inline-block">' + (esc(r.layanan) || '-') + '</span></td>' +
          '<td class="px-4 py-3 text-xs text-slate-600 whitespace-nowrap align-middle min-w-[130px]">' + (esc(r.kecamatan) || '-') + '</td>' +
          '<td class="px-4 py-3 text-xs text-slate-600 whitespace-nowrap align-middle min-w-[130px]">' + (esc(r.kelurahan) || '-') + '</td>' +
          '<td class="px-4 py-3 text-center whitespace-nowrap align-middle">' + pillBerkas(r.jumlahBerkas) + '</td>' +
          '<td class="px-4 py-3 text-center whitespace-nowrap align-middle min-w-[160px]">' + badgeStatus(r.status) + '</td>' +
          '<td class="px-4 py-3 whitespace-nowrap align-middle"><div class="flex items-center justify-center gap-1.5">' + tombolBaris(r) + '</div></td>' +
          '</tr>';
      }).join('');
    }

    var thPilih = $('kd-th-pilih');
    if (thPilih) thPilih.classList.toggle('hidden', !S.bolehUbah);
    perbaruiBar();

    $('kd-total').textContent = 'Total Data: ' + S.total + ' Baris';
    renderNavigasi();
  }

  // Penomoran halaman: markup & kelas sama dengan perbaruiElemenNavigasi (Lihat Data), tetapi
  // memakai data-kd karena halamannya dipagi di server.
  function renderNavigasi() {
    var wrap = $('kd-pagination'), info = $('kd-info-halaman');
    if (!wrap) return;
    var sekarang = S.page, total = S.totalHalaman;
    if (info) info.textContent = S.total === 0 ? 'Tidak ada data' : 'Halaman ' + sekarang + ' dari ' + total;
    if (total <= 1) { wrap.innerHTML = ''; return; }
    var TAMPIL = 5;
    var mulai = Math.max(1, sekarang - Math.floor(TAMPIL / 2));
    var akhir = mulai + TAMPIL - 1;
    if (akhir > total) { akhir = total; mulai = Math.max(1, akhir - TAMPIL + 1); }
    var BASE = 'px-3 py-1.5 rounded-xl text-xs font-semibold transition min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-center active:scale-95 shadow-2xs';
    var AKTIF = BASE + ' bg-slate-800 text-white shadow-xs';
    var PASIF = BASE + ' bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 cursor-pointer';
    var NONAKTIF = BASE + ' bg-slate-100/60 border border-slate-200/50 text-slate-300 cursor-not-allowed';
    var ikonPrev = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>';
    var ikonNext = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>';
    var noHal = function (n) { return '<button type="button" data-kd="hal" data-hal="' + n + '" class="' + (n === sekarang ? AKTIF : PASIF) + '" aria-label="Halaman ' + n + '"' + (n === sekarang ? ' aria-current="page"' : '') + '>' + n + '</button>'; };
    var h = '<button type="button" data-kd="prev"' + (sekarang === 1 ? ' disabled' : '') + ' class="' + (sekarang === 1 ? NONAKTIF : PASIF) + '" title="Halaman Sebelumnya" aria-label="Halaman sebelumnya">' + ikonPrev + '</button>';
    if (mulai > 1) {
      h += noHal(1);
      if (mulai > 2) h += '<span class="px-1 text-slate-400 text-xs">&hellip;</span>';
    }
    for (var i = mulai; i <= akhir; i++) h += noHal(i);
    if (akhir < total) {
      if (akhir < total - 1) h += '<span class="px-1 text-slate-400 text-xs">&hellip;</span>';
      h += noHal(total);
    }
    h += '<button type="button" data-kd="next"' + (sekarang === total ? ' disabled' : '') + ' class="' + (sekarang === total ? NONAKTIF : PASIF) + '" title="Halaman Berikutnya" aria-label="Halaman berikutnya">' + ikonNext + '</button>';
    wrap.innerHTML = h;
  }

  function tombolBaris(r) {
    var attr = ' data-id="' + r.id + '" data-tahun="' + r.tahun + '"';
    var kelola = '<button type="button" data-kd="kelola"' + attr + ' class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 border border-sky-200/80 rounded-lg font-semibold text-xs transition shadow-2xs">' + IKON_MATA + '<span>' + (S.bolehUbah ? 'Kelola' : 'Detail') + '</span></button>';
    var hapus = S.bolehUbah
      ? '<button type="button" data-kd="hapus"' + attr + ' title="Hapus data" aria-label="Hapus data" class="inline-flex items-center justify-center px-2.5 py-1.5 bg-red-50 hover:bg-red-100 active:scale-95 text-red-700 border border-red-200 rounded-lg transition shadow-2xs">' + IKON_HAPUS + '</button>'
      : '';
    return kelola + hapus;
  }

  // ---------------------------------------------------------------------------
  // Detail / edit
  // ---------------------------------------------------------------------------
  function bukaModalDetail() { $('kd-modal-detail').classList.remove('hidden'); }

  function perubahanTertunda() { return Object.keys(ambilPerubahan()).length > 0; }

  function tutupDetail(paksa) {
    // D.seq++: balasan detail yang masih di jalan (cache/revalidasi) tidak boleh membuka ulang data ini.
    var lanjut = function () { $('kd-modal-detail').classList.add('hidden'); D.data = null; D.seq++; susulKotor(); };
    if (!paksa && D.data && D.bolehUbah && perubahanTertunda() && typeof konfirmasiAksi === 'function') {
      konfirmasiAksi({ judul: 'Buang perubahan?', pesan: 'Ada perubahan yang belum disimpan. Tutup tanpa menyimpan?', tipe: 'warning', teksKonfirmasi: 'Ya, Buang', teksBatal: 'Kembali' })
        .then(function (ya) { if (ya) lanjut(); });
      return;
    }
    lanjut();
  }

  function skeletonDetail() {
    var kotak = '<div class="h-14 rounded-xl skeleton"></div>';
    var baris = '<div class="h-11 rounded-xl skeleton"></div>';
    var isi = function (n, s) { var o = ''; for (var i = 0; i < n; i++) o += s; return o; };
    return '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5">' + isi(9, kotak) + '</div>' +
      '<div class="mt-5 border-t border-slate-200/80 pt-4 grid grid-cols-1 lg:grid-cols-2 gap-2.5">' + isi(6, baris) + '</div>';
  }

  function tampilGagalDetail(pesan) {
    $('kd-detail-judul').textContent = 'Detail Data';
    $('kd-detail-isi').innerHTML = '<div class="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">' + esc(pesan) + '</div>';
    $('kd-detail-kaki').innerHTML = '<span></span><button type="button" data-kd="tutup-detail" class="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 active:scale-95 text-slate-700 rounded-xl text-xs font-semibold transition">Tutup</button>';
  }

  // Sama seperti daftar: tampil seketika dari cache SWR (domain 'penerima_detail'), lalu diperbarui
  // bila server punya data yang berbeda -- kecuali admin sudah mulai mengetik, agar isian tidak hilang
  // (bentrok versi tetap dijaga server saat simpan).
  function muatDetail(id, tahun) {
    var seq = ++D.seq;
    var sudahAda = !!(D.data && D.data.id === id && D.data.tahun === tahun);
    var dirender = 0;
    if (!sudahAda) {
      D.data = null;
      $('kd-detail-judul').textContent = 'Memuat data...';
      $('kd-detail-sub').textContent = '';
      $('kd-detail-kaki').innerHTML = '';
      $('kd-detail-isi').innerHTML = skeletonDetail();
    }
    bukaModalDetail();

    return new Promise(function (selesai) {
      apiSWR('adminDetailData', [id, tahun], function (res) {
        if (seq !== D.seq) return selesai();
        if (!res || !res.sukses) {
          if (!dirender) tampilGagalDetail((res && res.pesan) || 'Gagal memuat detail.');
          return selesai();
        }
        if (dirender && D.data && D.bolehUbah && perubahanTertunda()) return selesai();
        dirender++;
        D.data = res.data; D.berkas = res.berkas; D.versi = res.versi; D.bolehUbah = !!res.bolehUbah; D.jumlahBatch = res.jumlahBatchPembayaran || 0;
        D.asli = {};
        D.pilihBerkas = {};
        FIELD.forEach(function (f) { D.asli[f.k] = res.data[f.d] || ''; });
        renderDetail();
        selesai();
      }, function (e) {
        if (seq !== D.seq) return selesai();
        if (!dirender) tampilGagalDetail(pesanDariError(e)); else toast(pesanDariError(e), 'gagal', 6000);
        selesai();
      });
    });
  }

  function htmlField(f, data) {
    var id = 'kd-f-' + f.k;
    var nilai = data[f.d] || '';
    var dis = D.bolehUbah ? '' : ' disabled';
    var span = f.lebar === 2 ? ' sm:col-span-2' : '';
    var kontrol;
    if (f.pilih) {
      var ops = f.pilih.slice();
      if (nilai && ops.indexOf(nilai) === -1) ops.unshift(nilai);
      kontrol = '<select id="' + id + '" class="' + KELAS_INPUT + '"' + dis + '>' +
        '<option value="">-- Pilih --</option>' + ops.map(function (o) { return '<option value="' + esc(o) + '"' + (o === nilai ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (f.sel) {
      kontrol = '<select id="' + id + '" class="' + KELAS_INPUT + '"' + dis + '><option value="' + esc(nilai) + '" selected>' + esc(nilai || '-- Pilih --') + '</option></select>';
    } else if (f.area) {
      kontrol = '<textarea id="' + id + '" rows="2"' + (f.maks ? ' maxlength="' + f.maks + '"' : '') + ' class="' + KELAS_INPUT + '"' + dis + '>' + esc(nilai) + '</textarea>';
    } else {
      kontrol = '<input type="text" id="' + id + '" value="' + esc(nilai) + '" autocomplete="off"' +
        (f.maks ? ' maxlength="' + f.maks + '"' : '') + (f.mode ? ' inputmode="' + f.mode + '"' : '') + ' class="' + KELAS_INPUT + '"' + dis + '>';
    }
    return '<div class="bg-slate-50/80 rounded-xl px-4 py-2.5 border border-slate-100/90 transition-colors' + span + '"><label for="' + id + '" class="' + KELAS_LABEL + '">' + esc(f.l) + '</label>' + kontrol + '</div>';
  }

  function htmlBerkas(b) {
    var ada = !!b.link;
    var url = linkAman(b.link);
    var aksi = '';
    if (ada && url) aksi += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 px-3 py-1 rounded-lg transition shadow-2xs">Buka &#8599;</a>';
    if (D.bolehUbah) {
      aksi += '<button type="button" data-kd="ganti" data-idx="' + b.idx + '" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-emerald-700 border border-emerald-200 rounded-lg font-semibold text-[11px] transition">' + (ada ? 'Ganti' : 'Unggah') + '</button>';
      aksi += '<input type="file" data-kd-file="' + b.idx + '" accept="image/*,application/pdf" class="hidden">';
      if (ada) aksi += '<button type="button" data-kd="hapus-berkas" data-idx="' + b.idx + '" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 active:scale-95 text-red-700 border border-red-200 rounded-lg font-semibold text-[11px] transition">Hapus</button>';
    }
    var centang = (ada && D.bolehUbah)
      ? '<input type="checkbox" data-kd-berkas="' + b.idx + '"' + (D.pilihBerkas[b.idx] ? ' checked' : '') + ' aria-label="Pilih ' + esc(b.label) + '" class="w-4 h-4 mr-2 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer">'
      : '';
    return '<div class="flex items-center justify-between gap-2 bg-slate-50/90 border rounded-xl px-3.5 py-2.5 ' + (ada ? 'border-slate-200/80' : 'border-dashed border-slate-300') + '">' +
      '<div class="min-w-0 flex items-center">' + centang + '<div class="min-w-0"><div class="text-xs font-semibold text-slate-700 break-words">' + esc(b.label) + '</div>' +
      '<div class="text-[10px] mt-0.5 ' + (ada ? 'text-emerald-600' : 'text-slate-400') + ' font-semibold uppercase">' + (ada ? 'Sudah ada' : 'Belum ada') + '</div></div></div>' +
      '<div class="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">' + aksi + '</div></div>';
  }

  function renderDetail() {
    var d = D.data;
    $('kd-detail-judul').textContent = d.nama || 'Detail Data';
    $('kd-detail-sub').textContent = 'NIK ' + d.nik + ' · ' + (d.kategori === 'KEMENAG' ? 'Kemenag' : 'Kecamatan') + ' · Tahun ' + d.tahun;

    var punya = D.berkas.filter(function (b) { return b.link; });
    var belum = D.berkas.filter(function (b) { return !b.link; });

    var html = '';
    if (!D.bolehUbah) {
      html += '<div class="mb-4 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium">Data tahun ' + esc(d.tahun) + ' adalah arsip dan hanya bisa dilihat.</div>';
    }
    html += '<div class="mb-4">' + badgeStatus(d.statusVerifikasi) + '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5">' + FIELD.map(function (f) { return htmlField(f, d); }).join('') + '</div>';

    html += '<div class="mt-5 border-t border-slate-200/80 pt-4">' +
      '<div class="flex items-center justify-between gap-2 mb-3"><p class="text-xs font-bold text-slate-700 uppercase tracking-wider">Berkas &amp; Dokumen Pendukung</p>' +
      '<span class="text-[11px] text-slate-500">' + punya.length + ' dari ' + TOTAL_JENIS_BERKAS + ' jenis terisi</span></div>' +
      (D.bolehUbah && punya.length > 1
        ? '<div class="flex items-center justify-between gap-2 mb-2.5 px-3 py-2 rounded-xl bg-slate-50/90 border border-slate-200/80">' +
        '<label class="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer select-none"><input type="checkbox" id="kd-berkas-semua" class="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500">Pilih semua berkas</label>' +
        '<button type="button" data-kd="hapus-berkas-terpilih" id="kd-btn-hapus-berkas-terpilih" class="hidden px-3 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-lg text-[11px] font-bold shadow-sm transition">Hapus Terpilih (0)</button>' +
        '</div>'
        : '') +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-2.5">' + (punya.length ? punya.map(htmlBerkas).join('') : '<div class="lg:col-span-2 text-xs text-slate-400 italic py-2">Belum ada berkas terunggah.</div>') + '</div>' +
      (D.bolehUbah && belum.length
        ? '<details class="mt-3 group"><summary class="cursor-pointer text-xs font-semibold text-sky-700 hover:text-sky-800 select-none">Jenis berkas lain (' + belum.length + ') &mdash; unggah bila diperlukan</summary>' +
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">' + belum.map(htmlBerkas).join('') + '</div></details>'
        : '') +
      '</div>';

    $('kd-detail-isi').innerHTML = html;

    var kaki = '';
    if (D.bolehUbah) {
      kaki += '<button type="button" data-kd="hapus-data" class="w-full sm:w-auto px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 active:scale-95">' + IKON_HAPUS + '<span>Hapus Data</span></button>';
    } else {
      kaki += '<span></span>';
    }
    kaki += '<div class="flex items-center gap-2"><span id="kd-info-ubah" class="hidden sm:inline text-[11px] text-amber-600 font-semibold"></span>' +
      '<button type="button" data-kd="tutup-detail" class="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-200 hover:bg-slate-300 active:scale-95 text-slate-700 rounded-xl text-xs font-semibold transition">Tutup Detail</button>' +
      (D.bolehUbah ? '<button type="button" data-kd="simpan" id="kd-btn-simpan" disabled class="flex-1 sm:flex-initial px-4 py-2.5 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100">Simpan Perubahan</button>' : '') +
      '</div>';
    $('kd-detail-kaki').innerHTML = kaki;

    if (D.bolehUbah) {
      isiLayanan(d.layanan);
      isiKecamatan(d.kecamatan);
      isiKelurahan(d.kecamatan, d.kelurahan);
    }
  }

  function isiLayanan(pilihan) {
    var sel = $('kd-f-layanan');
    if (!sel || !S.opsi) return;
    var kec = S.opsi.layananKecamatan || [], kem = S.opsi.layananKemenag || [];
    var semua = kec.concat(kem).map(function (v) { return String(v).toUpperCase(); });
    var h = '';
    if (pilihan && semua.indexOf(String(pilihan).toUpperCase()) === -1) h += '<option value="' + esc(pilihan) + '" selected>' + esc(pilihan) + '</option>';
    h += '<optgroup label="Kecamatan">' + kec.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') + '</optgroup>';
    h += '<optgroup label="Kemenag">' + kem.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') + '</optgroup>';
    sel.innerHTML = h;
    setPilihan(sel, pilihan);
  }

  function isiKecamatan(pilihan) {
    var sel = $('kd-f-kecamatan');
    if (!sel || !S.opsi) return;
    var list = (S.opsi.kecamatan || []).slice();
    var h = '';
    if (pilihan && list.indexOf(String(pilihan).toUpperCase()) === -1) h += '<option value="' + esc(pilihan) + '">' + esc(pilihan) + '</option>';
    h += list.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    sel.innerHTML = h;
    setPilihan(sel, pilihan);
  }

  function isiKelurahan(kec, pilihan) {
    var sel = $('kd-f-kelurahan');
    if (!sel) return;
    sel.dataset.kec = kec || '';
    if (!kec) { sel.innerHTML = '<option value="">-- Pilih Kecamatan dulu --</option>'; tandaiPerubahan(); return; }
    sel.innerHTML = '<option value="">Memuat...</option>';
    api('getKelurahanByKecamatan', kec).then(function (list) {
      if (sel.dataset.kec !== (kec || '')) return; // kecamatan sudah diganti lagi
      var arr = Array.isArray(list) ? list : [];
      var h = '<option value="">-- Pilih Kelurahan --</option>';
      if (pilihan && arr.map(function (v) { return String(v).toUpperCase(); }).indexOf(String(pilihan).toUpperCase()) === -1) {
        h += '<option value="' + esc(pilihan) + '">' + esc(pilihan) + '</option>';
      }
      h += arr.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
      sel.innerHTML = h;
      setPilihan(sel, pilihan);
      tandaiPerubahan();
    }).catch(function (e) {
      sel.innerHTML = '<option value="">Gagal memuat kelurahan</option>';
      toast('Gagal memuat daftar kelurahan: ' + pesanDariError(e), 'gagal');
    });
  }

  function ambilPerubahan() {
    var out = {};
    if (!D.data || !D.bolehUbah) return out;
    FIELD.forEach(function (f) {
      var el = $('kd-f-' + f.k);
      if (!el) return;
      var baru = String(el.value || '').trim();
      var lama = String(D.asli[f.k] || '').trim();
      var sama = f.mentah ? baru === lama : baru.toUpperCase() === lama.toUpperCase();
      if (!sama) out[f.k] = baru;
    });
    return out;
  }

  function tandaiPerubahan() {
    var btn = $('kd-btn-simpan'), info = $('kd-info-ubah');
    if (!btn) return;
    var n = Object.keys(ambilPerubahan()).length;
    btn.disabled = n === 0 || D.sibuk;
    if (info) { info.textContent = n ? n + ' perubahan belum disimpan' : ''; info.classList.toggle('hidden', !n); }
  }

  function simpanPerubahan() {
    if (!D.data || !D.bolehUbah || D.sibuk) return;
    var perubahan = ambilPerubahan();
    if (Object.keys(perubahan).length === 0) { toast('Tidak ada perubahan.', 'info'); return; }
    var btn = $('kd-btn-simpan');
    D.sibuk = true;
    if (typeof setTombolMemuat === 'function') setTombolMemuat(btn, 'Menyimpan...');
    var id = D.data.id, tahun = D.data.tahun;
    api('adminUbahData', id, tahun, perubahan, D.versi).then(function (res) {
      if (res && res.sukses) {
        toast(res.pesan || 'Data berhasil diperbarui.', 'sukses');
        batalkanCacheLama();
        D.sibuk = false;
        return Promise.all([muatDetail(id, tahun), muat()]);
      }
      toast((res && res.pesan) || 'Gagal menyimpan.', res && res.konflik ? 'peringatan' : 'gagal', 7000);
      if (res && res.konflik) return muatDetail(id, tahun);
    }).catch(function (e) {
      toast(pesanDariError(e), 'gagal', 7000);
    }).then(function () {
      D.sibuk = false;
      if (typeof pulihkanTombol === 'function') pulihkanTombol($('kd-btn-simpan'));
      tandaiPerubahan();
    });
  }

  // ---------------------------------------------------------------------------
  // Berkas: ganti / unggah / hapus
  // ---------------------------------------------------------------------------
  function cariBerkas(idx) {
    for (var i = 0; i < D.berkas.length; i++) if (D.berkas[i].idx === idx) return D.berkas[i];
    return null;
  }

  function gantiBerkas(idx, file) {
    var b = cariBerkas(idx);
    if (!D.data || !D.bolehUbah || !b || D.sibuk) return;
    if (typeof prosesFileTerkompresi !== 'function' || typeof unggahBerkasKeDriveGAS !== 'function') {
      toast('Modul unggah berkas belum siap. Muat ulang halaman.', 'gagal');
      return;
    }
    if (perubahanTertunda()) {
      toast('Simpan atau batalkan perubahan data terlebih dulu sebelum mengganti berkas.', 'peringatan');
      return;
    }
    D.sibuk = true;
    var d = D.data, id = d.id, tahun = d.tahun;
    overlay(true, 'MENGUNGGAH BERKAS...', 'Mengirim "' + b.label + '" ke Google Drive.');
    prosesFileTerkompresi(file).then(function (item) {
      var peta = {};
      peta[idx] = { file: item.file, namaFile: item.namaFile, mimeType: item.mimeType, ukuranByte: item.ukuranByte, label: b.label };
      return unggahBerkasKeDriveGAS(
        { kecamatan: d.kecamatan, layanan: d.layanan, nama: d.nama, nik: d.nik, folderId: d.idFolderBerkas },
        peta
      );
    }).then(function (up) {
      if (!up || !up.sukses) throw new Error((up && up.pesan) || 'Unggah gagal.');
      var link = up.link || {};
      var idFolder = link.idFolderBerkas || '';
      delete link.idFolderBerkas;
      if (!link[idx]) throw new Error('Drive tidak mengembalikan tautan berkas.');
      overlay(true, 'MENYIMPAN...', 'Menautkan berkas ke data penerima.');
      return api('editDataPenerima', id, { teks: {}, berkas: link, idFolderBerkas: idFolder });
    }).then(function (res) {
      if (!res || !res.sukses) throw new Error((res && res.pesan) || 'Gagal menyimpan tautan berkas.');
      try { if (typeof bersihkanCacheUploadUntukNik === 'function') bersihkanCacheUploadUntukNik(d.nik, d.layanan); } catch (_e) { /* abaikan */ }
      toast('Berkas "' + b.label + '" berhasil ' + (b.link ? 'diganti' : 'diunggah') + '.', 'sukses');
      batalkanCacheLama();
      D.sibuk = false;
      return Promise.all([muatDetail(id, tahun), muat()]);
    }).catch(function (e) {
      toast('Gagal ' + (b.link ? 'mengganti' : 'mengunggah') + ' berkas: ' + pesanDariError(e), 'gagal', 8000);
    }).then(function () {
      D.sibuk = false;
      overlay(false);
      tandaiPerubahan();
    });
  }

  function hapusBerkas(idx) {
    var b = cariBerkas(idx);
    if (!D.data || !D.bolehUbah || !b || !b.link || D.sibuk) return;
    var d = D.data, id = d.id, tahun = d.tahun;
    var tanya = typeof konfirmasiAksi === 'function'
      ? konfirmasiAksi({
        judul: 'Hapus berkas?',
        pesan: 'Berkas "' + b.label + '" milik ' + d.nama + ' akan dilepas dari data dan dipindah ke Sampah Google Drive.',
        tipe: 'danger', teksKonfirmasi: 'Ya, Hapus', teksBatal: 'Batal'
      })
      : Promise.resolve(window.confirm('Hapus berkas "' + b.label + '"?'));
    tanya.then(function (ya) {
      if (!ya) return;
      D.sibuk = true;
      overlay(true, 'MENGHAPUS BERKAS...', 'Memindahkan berkas ke Sampah Drive.');
      return api('adminHapusBerkasMassal', id, tahun, [{ idx: idx, link: b.link }]).then(function (res) {
        if (!res || !res.sukses) {
          toast((res && res.pesan) || 'Gagal menghapus berkas.', res && res.konflik ? 'peringatan' : 'gagal', 7000);
          if (res && res.konflik) { D.sibuk = false; return muatDetail(id, tahun); }
          return;
        }
        toast(res.pesan || 'Berkas dihapus.', res.perluTindakLanjut ? 'peringatan' : 'sukses', res.perluTindakLanjut ? 12000 : 5000);
        batalkanCacheLama();
        D.sibuk = false;
        return Promise.all([muatDetail(id, tahun), muat()]);
      });
    }).catch(function (e) {
      toast(pesanDariError(e), 'gagal', 7000);
    }).then(function () {
      D.sibuk = false;
      overlay(false);
    });
  }

  // ---------------------------------------------------------------------------
  // Hapus data penerima (ketik NIK untuk konfirmasi)
  // ---------------------------------------------------------------------------
  var hapusCtx = null;

  function tutupHapus() { $('kd-modal-hapus').classList.add('hidden'); hapusCtx = null; susulKotor(); }

  function periksaKonfirmasiNik() {
    var el = $('kd-hapus-nik'), btn = $('kd-hapus-ya');
    if (!el || !btn || !hapusCtx) return;
    btn.disabled = !(hapusCtx.detail && el.value.trim() === String(hapusCtx.detail.data.nik).trim());
  }

  function bukaHapus(id, tahun) {
    hapusCtx = { id: id, tahun: tahun, detail: null };
    var isi = $('kd-hapus-isi');
    isi.innerHTML = typeof htmlSkeletonPanel === 'function' ? htmlSkeletonPanel('list') : '<div class="flex justify-center py-6"><div class="loader"></div></div>';
    $('kd-hapus-ya').disabled = true;
    $('kd-modal-hapus').classList.remove('hidden');
    var ctx = hapusCtx;
    // Dari baris tabel (tanpa detail terbuka) ambil dari server, bukan salinan cache: jumlah berkas &
    // batch pembayaran yang tampil di konfirmasi hapus harus sesuai kondisi saat ini. broadcast:false
    // + abaikanEvent supaya tidak memicu refresh senyap dari listener di bawah.
    var siap;
    if (D.data && D.data.id === id && D.data.tahun === tahun) {
      siap = Promise.resolve({ sukses: true, data: D.data, berkas: D.berkas, jumlahBatchPembayaran: D.jumlahBatch });
    } else {
      abaikanEvent = true;
      try {
        if (window.djpmCache && typeof window.djpmCache.invalidate === 'function') window.djpmCache.invalidate(['penerima_detail'], false);
      } finally { abaikanEvent = false; }
      siap = api('adminDetailData', id, tahun);
    }
    siap.then(function (res) {
      if (hapusCtx !== ctx) return;
      if (!res || !res.sukses) {
        isi.innerHTML = '<div class="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">' + esc((res && res.pesan) || 'Gagal memuat data.') + '</div>';
        return;
      }
      ctx.detail = res;
      var d = res.data;
      var nBerkas = (res.berkas || []).filter(function (b) { return b.link; }).length;
      var batch = res.jumlahBatchPembayaran || 0;
      isi.innerHTML =
        '<div class="text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 space-y-1">' +
        '<div><span class="text-slate-500">Nama:</span> <b class="text-slate-800">' + esc(d.nama) + '</b></div>' +
        '<div><span class="text-slate-500">NIK:</span> <b class="font-mono text-slate-800">' + esc(d.nik) + '</b></div>' +
        '<div><span class="text-slate-500">Layanan:</span> ' + esc(d.layanan) + '</div>' +
        '<div><span class="text-slate-500">Wilayah:</span> ' + esc(d.kecamatan) + (d.kelurahan ? ' &middot; ' + esc(d.kelurahan) : '') + '</div>' +
        '<div><span class="text-slate-500">Berkas terunggah:</span> ' + nBerkas + ' berkas akan dipindah ke Sampah Drive</div>' +
        '</div>' +
        (batch > 0 ? '<div class="text-xs p-3 mb-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800"><b>Perhatian:</b> NIK ini tercatat di ' + batch + ' batch pembayaran. Laporan pembayaran lama tetap memuat NIK tersebut.</div>' : '') +
        '<label for="kd-hapus-nik" class="' + KELAS_LABEL_FILTER + '">Ketik NIK <span class="font-mono normal-case">' + esc(d.nik) + '</span> untuk mengonfirmasi</label>' +
        '<input type="text" id="kd-hapus-nik" autocomplete="off" inputmode="numeric" maxlength="16" placeholder="Ketik NIK di sini" class="' + KELAS_INPUT + '">';
      var inp = $('kd-hapus-nik');
      if (inp) inp.focus();
    }).catch(function (e) {
      if (hapusCtx !== ctx) return;
      isi.innerHTML = '<div class="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">' + esc(pesanDariError(e)) + '</div>';
    });
  }

  function eksekusiHapusData() {
    var ctx = hapusCtx;
    var inp = $('kd-hapus-nik');
    if (!ctx || !ctx.detail || !inp || D.sibuk) return;
    var nik = inp.value.trim();
    if (nik !== String(ctx.detail.data.nik).trim()) return;
    D.sibuk = true;
    var btn = $('kd-hapus-ya');
    btn.disabled = true;
    overlay(true, 'MENGHAPUS DATA...', 'Menghapus data dan memindahkan berkas ke Sampah Drive.');
    api('adminHapusData', ctx.id, ctx.tahun, nik).then(function (res) {
      if (!res || !res.sukses) {
        toast((res && res.pesan) || 'Gagal menghapus data.', 'gagal', 8000);
        btn.disabled = false;
        return;
      }
      toast(res.pesan || 'Data dihapus.', res.perluTindakLanjut ? 'peringatan' : 'sukses', res.perluTindakLanjut ? 15000 : 6000);
      batalkanCacheLama();
      tutupHapus();
      $('kd-modal-detail').classList.add('hidden');
      D.data = null; D.seq++;
      // Cepat: baris langsung hilang dari tabel dan overlay dilepas; daftar resmi dimuat di latar
      // (bukan ditunggu). Bila muat ulang gagal, baris tetap sudah benar karena server sudah menghapus.
      hapusBarisLokal(ctx.id);
      overlay(false);
      D.sibuk = false;
      muat();
    }, function (e) {
      // Jaringan putus/timeout: server MUNGKIN sudah menghapus. Jangan menyatakan gagal pasti --
      // muat ulang daftar (tanpa cache) supaya admin melihat keadaan sebenarnya.
      toast('Status penghapusan belum pasti (' + pesanDariError(e) + '). Daftar dimuat ulang untuk memeriksa; jangan ulangi sebelum memastikan.', 'peringatan', 10000);
      btn.disabled = false;
      segarkan();
    }).catch(function (err) {
      if (window.console) console.error('[kelola-data] hapus data:', err);
    }).then(function () {
      D.sibuk = false;
      overlay(false);
    });
  }

  // Buang satu baris dari daftar yang sedang tampil tanpa menunggu server (setelah server memastikan terhapus).
  function hapusBarisLokal(id) { hapusBarisLokalBanyak([id]); }

  function hapusBarisLokalBanyak(ids) {
    var buang = {};
    ids.forEach(function (id) { buang[id] = true; delete S.pilih[id]; });
    var sebelum = S.daftar.length;
    S.daftar = S.daftar.filter(function (r) { return !buang[r.id]; });
    S.total = Math.max(0, S.total - (sebelum - S.daftar.length));
    renderDaftar();
  }

  // ---------------------------------------------------------------------------
  // Seleksi baris (untuk hapus data massal)
  // ---------------------------------------------------------------------------
  var MAKS_PILIH = 100;
  // Harus <= MAKS_DATA_MASSAL di kelolaData.ts. 8 = tepat 2 giliran pembersihan Drive (PARALEL_DRIVE = 4)
  // per permintaan: lebih singkat per data daripada 10 (3 giliran) dan jauh dari batas waktu klien 58 dtk.
  var UKURAN_PAKET = 8;
  var MAKS_GAGAL_BERUNTUN = 2; // paket yang gagal total berturut-turut sebelum sisa pilihan dihentikan

  function jumlahPilih() { return Object.keys(S.pilih).length; }

  function kotakPilih(r) {
    return '<input type="checkbox" data-kd-pilih data-id="' + r.id + '"' + (S.pilih[r.id] ? ' checked' : '') +
      ' aria-label="Pilih ' + esc(r.nama) + '" class="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer">';
  }

  function sinkronCentang() {
    var semua = panel.querySelectorAll('[data-kd-pilih]');
    for (var i = 0; i < semua.length; i++) semua[i].checked = !!S.pilih[semua[i].getAttribute('data-id')];
  }

  function perbaruiBar() {
    var n = jumlahPilih();
    var bar = $('kd-bar-pilih');
    if (bar) bar.classList.toggle('hidden', n === 0 || !S.bolehUbah);
    var info = $('kd-bar-info');
    if (info) info.textContent = n + ' data dipilih' + (n >= MAKS_PILIH ? ' (batas maksimum)' : '');
    var semua = $('kd-cek-semua');
    if (semua) {
      var dihalaman = S.daftar.filter(function (r) { return S.pilih[r.id]; }).length;
      semua.checked = S.daftar.length > 0 && dihalaman === S.daftar.length;
      semua.indeterminate = dihalaman > 0 && dihalaman < S.daftar.length;
    }
  }

  // Kembalikan false bila gagal memilih (mis. melewati batas), supaya kotak bisa dikembalikan.
  function ubahPilih(id, ya) {
    id = Number(id);
    if (!ya) { delete S.pilih[id]; return true; }
    var r = S.daftar.filter(function (x) { return x.id === id; })[0];
    if (!r) return false;
    if (!S.pilih[id] && jumlahPilih() >= MAKS_PILIH) {
      toast('Maksimal ' + MAKS_PILIH + ' data dapat dipilih sekaligus.', 'peringatan');
      return false;
    }
    S.pilih[id] = { id: r.id, tahun: r.tahun, nama: r.nama, nik: r.nik, layanan: r.layanan, jumlahBerkas: r.jumlahBerkas };
    return true;
  }

  function pilihSemuaHalaman(ya) {
    for (var i = 0; i < S.daftar.length; i++) { if (!ubahPilih(S.daftar[i].id, ya)) break; }
    sinkronCentang();
    perbaruiBar();
  }

  // ---------------------------------------------------------------------------
  // Modal konfirmasi massal (dipakai hapus data massal dan hapus berkas massal)
  //   fase 1 konfirmasi (daftar + form konfirmasi) -> fase 2 progres -> fase 3 hasil
  // ---------------------------------------------------------------------------
  var M = { opsi: null, sibuk: false };

  function pasangModalMassal() {
    if ($('kd-modal-massal')) return;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="kd-modal-massal" class="hidden fixed inset-0 z-[185] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4">' +
      '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden max-h-[92vh] max-h-[92dvh] flex flex-col">' +
      '<div class="px-5 pt-5 pb-3 text-center shrink-0">' +
      '<div id="kd-massal-ikon" class="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3 bg-rose-100 text-rose-600 ring-8 ring-rose-50">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></div>' +
      '<h3 id="kd-massal-judul" class="text-base font-bold text-slate-900"></h3>' +
      '<p id="kd-massal-sub" class="text-xs text-slate-500 mt-1"></p>' +
      '</div>' +
      '<div id="kd-massal-isi" class="px-5 pb-3 overflow-y-auto flex-1"></div>' +
      '<div id="kd-massal-kaki" class="px-5 py-4 flex items-center gap-2 border-t border-slate-100 shrink-0"></div>' +
      '</div>' +
      '</div>');
    var m = $('kd-modal-massal');
    m.addEventListener('click', function (e) {
      if (e.target === m && !M.sibuk) tutupMassal();
      var b = e.target.closest && e.target.closest('[data-kd]');
      if (!b) return;
      var a = b.getAttribute('data-kd');
      if (a === 'massal-batal' || a === 'massal-tutup') { if (!M.sibuk) tutupMassal(); }
      if (a === 'massal-ya') jalankanMassal();
    });
    m.addEventListener('input', periksaFormMassal);
    m.addEventListener('change', periksaFormMassal);
    m.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !M.sibuk) tutupMassal();
      if (e.key === 'Enter' && e.target && e.target.id === 'kd-massal-kata') {
        e.preventDefault();
        var ya = $('kd-massal-ya');
        if (ya && !ya.disabled) jalankanMassal();
      }
    });
  }

  function tutupMassal() {
    if (M.sibuk) return;
    $('kd-modal-massal').classList.add('hidden');
    var selesai = M.opsi && M.opsi.hasilSiap ? M.opsi.selesai : null;
    M.opsi = null;
    if (selesai) selesai();
    susulKotor();
  }

  function periksaFormMassal() {
    var o = M.opsi, ya = $('kd-massal-ya');
    if (!o || !ya || o.fase !== 'konfirmasi') return;
    var ok = true;
    if (o.kata) { var k = $('kd-massal-kata'); ok = ok && !!k && k.value.trim().toUpperCase() === o.kata; }
    if (o.ack) { var c = $('kd-massal-ack'); ok = ok && !!c && c.checked; }
    ya.disabled = !ok;
  }

  // opsi: { judul, sub, items:[{t, s}], kata, ack, teksYa, jalankan(kabar) -> Promise<{ringkas, baris:[{st,t,s}]}>, selesai() }
  function bukaMassal(opsi) {
    pasangModalMassal();
    opsi.fase = 'konfirmasi';
    opsi.hasilSiap = false;
    M.opsi = opsi; M.sibuk = false;
    $('kd-massal-judul').textContent = opsi.judul;
    $('kd-massal-sub').textContent = opsi.sub || '';
    var daftar = opsi.items.map(function (x, i) {
      return '<li class="flex items-start gap-2 py-1.5 ' + (i ? 'border-t border-slate-100' : '') + '"><span class="text-[10px] font-bold text-slate-400 w-5 text-right shrink-0 pt-0.5">' + (i + 1) + '</span>' +
        '<span class="min-w-0"><span class="block text-xs font-semibold text-slate-800 break-words">' + esc(x.t) + '</span>' +
        (x.s ? '<span class="block text-[11px] text-slate-500 break-words">' + esc(x.s) + '</span>' : '') + '</span></li>';
    }).join('');
    var form = '';
    if (opsi.kata) {
      form += '<label for="kd-massal-kata" class="' + KELAS_LABEL_FILTER + ' mt-3">Ketik <span class="font-mono normal-case">' + esc(opsi.kata) + '</span> untuk mengonfirmasi</label>' +
        '<input type="text" id="kd-massal-kata" autocomplete="off" placeholder="' + esc(opsi.kata) + '" class="' + KELAS_INPUT + '">';
    }
    if (opsi.ack) {
      form += '<label class="mt-3 flex items-start gap-2 text-xs text-slate-700 cursor-pointer"><input type="checkbox" id="kd-massal-ack" class="mt-0.5 w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"><span>' + esc(opsi.ack) + '</span></label>';
    }
    $('kd-massal-isi').innerHTML =
      '<div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">' + opsi.items.length + ' item akan dihapus</div>' +
      '<ul class="max-h-44 overflow-y-auto border border-slate-200 rounded-xl px-3 bg-slate-50">' + daftar + '</ul>' + form;
    $('kd-massal-kaki').innerHTML =
      '<button type="button" data-kd="massal-batal" class="flex-1 py-2.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition">Batal</button>' +
      '<button type="button" data-kd="massal-ya" id="kd-massal-ya" disabled class="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-md transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100">' + esc(opsi.teksYa) + '</button>';
    $('kd-modal-massal').classList.remove('hidden');
    var k = $('kd-massal-kata');
    if (k) k.focus();
    periksaFormMassal();
  }

  function jalankanMassal() {
    var o = M.opsi;
    if (!o || o.fase !== 'konfirmasi' || M.sibuk) return;
    var ya = $('kd-massal-ya');
    if (!ya || ya.disabled) return;
    o.fase = 'progres'; M.sibuk = true;
    $('kd-massal-kaki').innerHTML = '<div class="w-full text-center text-[11px] text-slate-500">Mohon tunggu, jangan tutup halaman ini...</div>';
    $('kd-massal-isi').innerHTML =
      '<div class="py-4"><div class="flex justify-between text-xs font-semibold text-slate-600 mb-1.5"><span id="kd-massal-label">Memulai...</span><span id="kd-massal-persen">0%</span></div>' +
      '<div class="h-2.5 rounded-full bg-slate-200 overflow-hidden"><div id="kd-massal-bar" class="h-full bg-rose-500 transition-all duration-300" style="width:0%"></div></div></div>';
    var kabar = function (selesai, total, teks) {
      var pct = total ? Math.round((selesai / total) * 100) : 0;
      var l = $('kd-massal-label'), p = $('kd-massal-persen'), b = $('kd-massal-bar');
      if (l) l.textContent = teks || '';
      if (p) p.textContent = pct + '%';
      if (b) b.style.width = pct + '%';
    };
    var lanjut = function (hasil) {
      o.fase = 'hasil'; o.hasilSiap = true; M.sibuk = false;
      // Segarkan daftar/detail SEKARANG (di latar), bukan menunggu modal hasil ditutup -- kalau tidak,
      // baris yang sudah terhapus masih terlihat di belakang modal.
      try { if (o.setelahProses) o.setelahProses(); } catch (err) { if (window.console) console.error('[kelola-data] setelahProses:', err); }
      tampilHasilMassal(hasil);
    };
    Promise.resolve().then(function () { return o.jalankan(kabar); }).then(lanjut).catch(function (e) {
      lanjut({ ringkas: 'Proses berhenti karena kesalahan: ' + pesanDariError(e), baris: [], gagalTotal: true });
    });
  }

  var IKON_HASIL = {
    ok: '<span class="text-emerald-600 font-bold shrink-0">&#10003;</span>',
    warn: '<span class="text-amber-600 font-bold shrink-0">!</span>',
    gagal: '<span class="text-rose-600 font-bold shrink-0">&#10007;</span>'
  };

  function tampilHasilMassal(h) {
    var baris = h.baris || [];
    var nGagal = baris.filter(function (b) { return b.st === 'gagal'; }).length;
    var nWarn = baris.filter(function (b) { return b.st === 'warn'; }).length;
    var ikon = $('kd-massal-ikon');
    var aman = !h.gagalTotal && nGagal === 0 && nWarn === 0;
    ikon.className = 'mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3 ring-8 ' +
      (aman ? 'bg-emerald-100 text-emerald-600 ring-emerald-50' : 'bg-amber-100 text-amber-600 ring-amber-50');
    ikon.innerHTML = aman
      ? '<svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
    $('kd-massal-judul').textContent = aman ? 'Selesai' : (h.gagalTotal ? 'Proses terganggu' : 'Selesai dengan catatan');
    $('kd-massal-sub').textContent = h.ringkas || '';
    $('kd-massal-isi').innerHTML = baris.length
      ? '<ul class="max-h-64 overflow-y-auto border border-slate-200 rounded-xl px-3 bg-slate-50">' + baris.map(function (b, i) {
        return '<li class="flex items-start gap-2 py-1.5 ' + (i ? 'border-t border-slate-100' : '') + '">' + (IKON_HASIL[b.st] || '') +
          '<span class="min-w-0"><span class="block text-xs font-semibold text-slate-800 break-words">' + esc(b.t) + '</span>' +
          (b.s ? '<span class="block text-[11px] ' + (b.st === 'ok' ? 'text-slate-500' : 'text-slate-600') + ' break-words">' + esc(b.s) + '</span>' : '') + '</span></li>';
      }).join('') + '</ul>'
      : '';
    $('kd-massal-kaki').innerHTML = '<button type="button" data-kd="massal-tutup" class="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition">Tutup</button>';
    toast(h.ringkas || 'Selesai.', aman ? 'sukses' : 'peringatan', aman ? 5000 : 10000);
  }

  // ---- hapus data terpilih ----
  function bukaMassalData() {
    if (!S.bolehUbah) return;
    var pilihan = Object.keys(S.pilih).map(function (k) { return S.pilih[k]; });
    var n = pilihan.length;
    if (n === 0) return;
    var totalBerkas = pilihan.reduce(function (a, x) { return a + (x.jumlahBerkas || 0); }, 0);
    bukaMassal({
      judul: 'Hapus ' + n + ' data penerima?',
      sub: 'Data dihapus PERMANEN dan tidak dapat dikembalikan. ' + totalBerkas + ' berkas di Google Drive dipindah ke Sampah Drive (dapat dipulihkan sekitar 30 hari).',
      items: pilihan.map(function (x) { return { t: x.nama, s: 'NIK ' + x.nik + ' · ' + x.layanan }; }),
      kata: 'HAPUS',
      teksYa: 'Hapus ' + n + ' Data',
      jalankan: function (kabar) { return eksekusiMassalData(pilihan, kabar); },
      setelahProses: function () { batalkanCacheLama(); perbaruiBar(); muat(); },
      selesai: function () { perbaruiBar(); }
    });
  }

  function potong(arr, ukuran) {
    var hasil = [];
    for (var i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran));
    return hasil;
  }

  function eksekusiMassalData(pilihan, kabar) {
    var baris = [], sukses = 0, gagal = 0, perluDrive = 0, selesai = 0, dilewati = 0, beruntun = 0;
    var paket = potong(pilihan, UKURAN_PAKET);
    var nama = {};
    pilihan.forEach(function (x) { nama[x.id] = x; });
    kabar(0, pilihan.length, 'Menghapus 0 dari ' + pilihan.length + ' data...');

    return paket.reduce(function (rantai, isi) {
      return rantai.then(function () {
        // Koneksi/sesi putus: jangan menunggu tiap paket sisa sampai timeout 58 dtk. Yang belum dikirim
        // TIDAK terhapus dan tetap terpilih, jadi bisa diulang setelah masalahnya beres.
        if (beruntun >= MAKS_GAGAL_BERUNTUN) {
          isi.forEach(function (x) {
            dilewati++;
            baris.push({ st: 'warn', t: x.nama, s: 'Dilewati: proses dihentikan setelah beberapa kegagalan beruntun. Data ini belum dihapus.' });
          });
          selesai += isi.length;
          kabar(selesai, pilihan.length, 'Proses dihentikan...');
          return;
        }
        return api('adminHapusDataMassal', S.tahun, isi.map(function (x) { return { id: x.id, nik: x.nik }; })).then(function (res) {
          if (!res || !res.sukses) throw new Error((res && res.pesan) || 'Permintaan ditolak server.');
          beruntun = 0;
          // Baris yang sudah pasti terhapus langsung hilang dari tabel per paket (tidak menunggu semua paket).
          var terhapus = res.hasil.filter(function (h) { return h.status !== 'gagal'; }).map(function (h) { return h.id; });
          if (terhapus.length) hapusBarisLokalBanyak(terhapus);
          res.hasil.forEach(function (h) {
            var info = nama[h.id] || { nama: 'ID ' + h.id, nik: '' };
            var judul = h.nama || info.nama;
            if (h.status === 'gagal') { gagal++; baris.push({ st: 'gagal', t: judul, s: h.pesan || 'Gagal.' }); }
            else {
              sukses++;
              delete S.pilih[h.id];
              if (h.drive && h.drive.status === 'gagal') { perluDrive++; baris.push({ st: 'warn', t: judul, s: h.pesan }); }
              else baris.push({ st: 'ok', t: judul, s: h.status === 'sudahTiada' ? 'Sudah tidak ada (kemungkinan sudah dihapus).' : 'Dihapus.' });
            }
          });
        }).catch(function (e) {
          // Permintaan gagal/terputus: server MUNGKIN sudah memproses sebagian. Jangan menyatakan gagal pasti.
          beruntun++;
          isi.forEach(function (x) {
            gagal++;
            baris.push({ st: 'gagal', t: x.nama, s: 'Status tidak pasti (' + pesanDariError(e) + '). Muat ulang daftar untuk memeriksa sebelum mengulang.' });
          });
        }).then(function () {
          selesai += isi.length;
          kabar(selesai, pilihan.length, 'Menghapus ' + selesai + ' dari ' + pilihan.length + ' data...');
        });
      });
    }, Promise.resolve()).then(function () {
      return {
        ringkas: sukses + ' data dihapus' + (gagal ? ', ' + gagal + ' gagal' : '') + (dilewati ? ', ' + dilewati + ' dilewati' : '') +
          (perluDrive ? ', ' + perluDrive + ' berkasnya perlu dibereskan manual di Drive' : '') + '.',
        baris: baris
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Seleksi berkas di modal detail (hapus berkas massal)
  // ---------------------------------------------------------------------------
  function jumlahPilihBerkas() { return Object.keys(D.pilihBerkas).length; }

  function perbaruiBarBerkas() {
    var n = jumlahPilihBerkas();
    var ada = D.berkas.filter(function (b) { return b.link; }).length;
    var btn = $('kd-btn-hapus-berkas-terpilih'), semua = $('kd-berkas-semua');
    if (btn) { btn.classList.toggle('hidden', n === 0); btn.textContent = 'Hapus Terpilih (' + n + ')'; }
    if (semua) { semua.checked = ada > 0 && n === ada; semua.indeterminate = n > 0 && n < ada; }
  }

  function pilihSemuaBerkas(ya) {
    D.pilihBerkas = {};
    if (ya) D.berkas.forEach(function (b) { if (b.link) D.pilihBerkas[b.idx] = b.link; });
    var cek = $('kd-modal-detail').querySelectorAll('input[data-kd-berkas]');
    for (var i = 0; i < cek.length; i++) cek[i].checked = !!D.pilihBerkas[cek[i].getAttribute('data-kd-berkas')];
    perbaruiBarBerkas();
  }

  function eksekusiHapusBerkas(daftar, id, tahun, kabar) {
    kabar(0, 1, 'Menghapus ' + daftar.length + ' berkas...');
    return api('adminHapusBerkasMassal', id, tahun, daftar.map(function (x) { return { idx: x.idx, link: x.link }; })).then(function (res) {
      kabar(1, 1, 'Selesai');
      var baris = [];
      if (res && res.drive) {
        res.drive.forEach(function (d) {
          if (d.status === 'gagal') baris.push({ st: 'warn', t: d.label, s: 'Tautan dilepas, tetapi file di Drive belum dipindah ke Sampah: ' + (d.pesan || '') });
          else baris.push({ st: 'ok', t: d.label, s: d.status === 'sudahTiada' ? 'File di Drive sudah tidak ada.' : 'Dihapus.' });
        });
      }
      (res && res.konflikBerkas || []).forEach(function (k) {
        baris.push({ st: 'gagal', t: k.label, s: 'Dilewati: berkas baru saja diganti/dihapus pengguna lain.' });
      });
      if (!res || !res.sukses) {
        if (!baris.length) daftar.forEach(function (x) { baris.push({ st: 'gagal', t: x.label, s: (res && res.pesan) || 'Gagal.' }); });
        return { ringkas: (res && res.pesan) || 'Gagal menghapus berkas.', baris: baris };
      }
      return { ringkas: res.pesan, baris: baris };
    });
  }

  function bukaMassalBerkas() {
    if (!D.data || !D.bolehUbah || D.sibuk) return;
    var pilihan = D.berkas.filter(function (b) { return b.link && D.pilihBerkas[b.idx]; });
    if (pilihan.length === 0) return;
    var d = D.data, id = d.id, tahun = d.tahun;
    bukaMassal({
      judul: 'Hapus ' + pilihan.length + ' berkas?',
      sub: 'Berkas milik ' + d.nama + ' dilepas dari data dan dipindah ke Sampah Google Drive (dapat dipulihkan sekitar 30 hari).',
      items: pilihan.map(function (b) { return { t: b.label, s: '' }; }),
      ack: 'Saya mengerti berkas ini akan dilepas dari data penerima.',
      teksYa: 'Hapus ' + pilihan.length + ' Berkas',
      jalankan: function (kabar) { return eksekusiHapusBerkas(pilihan, id, tahun, kabar); },
      setelahProses: function () { batalkanCacheLama(); muatDetail(id, tahun); muat(); }
    });
  }

  // ---------------------------------------------------------------------------
  // Event: panel utama & modal detail
  // ---------------------------------------------------------------------------
  function aksiModalDetail(e) {
    var b = e.target.closest && e.target.closest('[data-kd]');
    if (!b) return;
    switch (b.getAttribute('data-kd')) {
      case 'tutup-detail': tutupDetail(); break;
      case 'simpan': simpanPerubahan(); break;
      case 'ganti': {
        var inp = $('kd-modal-detail').querySelector('input[data-kd-file="' + b.getAttribute('data-idx') + '"]');
        if (inp) inp.click();
        break;
      }
      case 'hapus-berkas': hapusBerkas(Number(b.getAttribute('data-idx'))); break;
      case 'hapus-berkas-terpilih': bukaMassalBerkas(); break;
      case 'hapus-data':
        if (D.data) bukaHapus(D.data.id, D.data.tahun);
        break;
    }
  }

  panel.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-kd]');
    if (!b) return;
    var id = Number(b.getAttribute('data-id')), tahun = Number(b.getAttribute('data-tahun'));
    switch (b.getAttribute('data-kd')) {
      case 'muat': segarkan(); break;
      case 'reset-filter': resetFilter(); break;
      case 'hal': { var n = Number(b.getAttribute('data-hal')); if (n >= 1 && n <= S.totalHalaman && n !== S.page) { S.page = n; muat(); } break; }
      case 'tambah':
        if (typeof tampilkanToast === 'function') toast('Isi formulir Input Data sebagai Admin Utama untuk menambah penerima baru.', 'info');
        $('tab-input').click();
        break;
      case 'prev': if (S.page > 1) { S.page--; muat(); } break;
      case 'next': if (S.page < S.totalHalaman) { S.page++; muat(); } break;
      case 'kelola': if (id) muatDetail(id, tahun); break;
      case 'pilih-halaman': pilihSemuaHalaman(true); break;
      case 'kosongkan-pilih': S.pilih = {}; renderDaftar(); break;
      case 'hapus-terpilih': bukaMassalData(); break;
      case 'hapus': if (id) bukaHapus(id, tahun); break;
    }
  });

  panel.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'kd-cari') {
      clearTimeout(timerCari);
      timerCari = setTimeout(function () { S.page = 1; muat(); }, 320);
    }
  });

  panel.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'kd-cek-semua') { pilihSemuaHalaman(t.checked); renderDaftar(); return; }
    if (t.hasAttribute && t.hasAttribute('data-kd-pilih')) {
      if (!ubahPilih(t.getAttribute('data-id'), t.checked)) t.checked = !t.checked;
      sinkronCentang(); perbaruiBar();
      var tr = t.closest && t.closest('tr');
      if (tr) tr.classList.toggle('bg-sky-50/60', t.checked);
      return;
    }
    if (!t.id) return;
    if (t.id === 'kd-tahun') { S.tahun = Number(t.value); S.pilih = {}; S.page = 1; muat(); return; }
    if (/^kd-(kategori|layanan|kecamatan|kelengkapan)$/.test(t.id)) { S.page = 1; muat(); }
  });

  // ---------------------------------------------------------------------------
  // Tab & Aksi Tombol Kelola Data
  // ---------------------------------------------------------------------------
  var TAB_LAIN = ['tab-input', 'tab-rekap', 'tab-tools', 'btn-kelola-user', 'btn-kelola-rumah-ibadah'];
  var PANEL_LAIN = ['panel-input', 'panel-rekap', 'panel-tools', 'panel-kelola-user', 'panel-kelola-ibadah'];
  var KELAS_AKTIF = ['tab-kelola-aktif'];
  var KELAS_NORMAL = ['bg-amber-600/80'];
  var KELAS_LEGACY = ['ring-2', 'ring-amber-300', 'shadow-md'];

  function nonaktifkanTab() {
    KELAS_AKTIF.forEach(function (c) { tab.classList.remove(c); });
    KELAS_LEGACY.forEach(function (c) { tab.classList.remove(c); });
    KELAS_NORMAL.forEach(function (c) { tab.classList.add(c); });
  }

  function aktifkanTab() {
    KELAS_NORMAL.forEach(function (c) { tab.classList.remove(c); });
    KELAS_LEGACY.forEach(function (c) { tab.classList.remove(c); });
    KELAS_AKTIF.forEach(function (c) { tab.classList.add(c); });
  }

  window.nonaktifkanTabKelolaData = nonaktifkanTab;
  window.aktifkanTabKelolaData = aktifkanTab;

  TAB_LAIN.forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('click', function () {
      panel.classList.add('hidden');
      nonaktifkanTab();
    });
  });

  tab.addEventListener('click', function () {
    if (!adalahUtama()) return; // pengaman tambahan; server tetap menolak non-UTAMA
    TAB_LAIN.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (typeof setTabTidakAktif === 'function') setTabTidakAktif(el);
    });
    if (typeof window.nonaktifkanTabKelolaUser === 'function') window.nonaktifkanTabKelolaUser();
    if (typeof window.nonaktifkanTabKelolaIbadah === 'function') window.nonaktifkanTabKelolaIbadah();
    PANEL_LAIN.forEach(function (id) { var el = $(id); if (el) el.classList.add('hidden'); });
    var refresh = $('btn-refresh-data');
    if (refresh) refresh.classList.add('hidden');
    aktifkanTab();
    try { panelAktif = 'kelola'; } catch (_e) { /* panelAktif tidak tersedia */ }
    panel.classList.remove('hidden');

    if (!S.siap) {
      S.siap = true;
      renderKerangka();
      // Tahun aktif diketahui sejak awal, jadi kunci cache SWR sama dengan panggilan berikutnya dan
      // daftar bisa langsung tampil dari cache sesi begitu tab dibuka.
      if (S.tahun === null && typeof window._tahunAktifGetter === 'function') S.tahun = Number(window._tahunAktifGetter()) || null;
    }
    // Aturan yang sama dengan tab Lihat Data: daftar yang masih segar (TTL 90 dtk) langsung dipakai
    // tanpa fetch; yang sudah lewat TTL ditampilkan dulu dari memori/cache lalu diperbarui di latar.
    if (S.daftar.length > 0) {
      renderDaftar();
      if (S.kotor || Date.now() - S.waktu >= ttlSegarMs()) muat();
    } else {
      muat();
    }
  });

  // Menutup/menyegarkan tab di tengah simpan, unggah, atau hapus membuat hasilnya tidak terlihat (dan
  // hapus massal berhenti di tengah). Browser hanya menampilkan peringatan bawaannya.
  window.addEventListener('beforeunload', function (e) {
    if (!D.sibuk && !M.sibuk) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // Esc menutup modal detail (lewat tutupDetail, jadi tetap menanyakan bila ada perubahan belum
  // disimpan). Diabaikan bila modal hapus/massal sedang terbuka di atasnya -- keduanya punya Esc sendiri.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || D.sibuk || M.sibuk) return;
    var terbuka = function (id) { var el = $(id); return !!el && !el.classList.contains('hidden'); };
    if (terbuka('kd-modal-hapus') || terbuka('kd-modal-massal') || !terbuka('kd-modal-detail')) return;
    tutupDetail();
  });

  // Mutasi dari tab/perangkat lain (BroadcastChannel & Realtime lewat api-bridge) membuang cache domain
  // 'penerima': segarkan daftar tanpa mengganggu modal/proses yang sedang dikerjakan admin ini.
  var timerEvent = null;
  window.addEventListener('djpm:swr-invalidated', function (ev) {
    if (abaikanEvent || !S.siap || !adalahUtama() || !token()) return;
    var domains = (ev.detail && ev.detail.domains) || [];
    if (domains.indexOf('*') === -1 && domains.indexOf('penerima') === -1) return;
    // Event DB (CDC) tidak membuang cache detail padahal barisnya berubah: buang di sini supaya detail
    // yang dibuka berikutnya tidak memakai salinan lama (memicu event lagi -> dijaga abaikanEvent).
    abaikanEvent = true;
    try {
      if (window.djpmCache && typeof window.djpmCache.invalidate === 'function') window.djpmCache.invalidate(['penerima_detail'], false);
    } finally { abaikanEvent = false; }
    // Tab ini sedang tidak dibuka (mis. data diubah lewat Lihat Data): cukup tandai, dimuat saat dibuka lagi.
    if (panel.classList.contains('hidden')) { S.kotor = true; return; }
    if (sedangSibuk()) { S.kotor = true; return; }
    // Satu perubahan datang lewat dua jalur (trigger DB + siaran antar-browser), dan hapus massal memicu
    // beberapa event beruntun: gabungkan jadi satu muat ulang. Jarak antar muat ulang akibat event
    // minimal 2 dtk, karena puluhan admin kecamatan yang menginput bersamaan juga menghasilkan event
    // 'penerima' dan tidak boleh membanjiri server.
    S.kotor = true;
    if (timerEvent) return;
    var jeda = Math.max(400, 2000 - (Date.now() - waktuMuatEvent));
    timerEvent = setTimeout(function () {
      timerEvent = null;
      jalankanMuatEvent();
    }, jeda);
  });

  var waktuMuatEvent = 0;
  // Muat ulang akibat event/fokus hanya bila layar benar-benar dilihat & tidak sedang mengerjakan sesuatu;
  // selain itu tetap ditandai kotor dan disusul (tab dibuka lagi, modal ditutup, atau tab kembali terlihat).
  function jalankanMuatEvent() {
    if (!S.siap || !S.kotor) return;
    if (panel.classList.contains('hidden') || document.hidden || sedangSibuk()) return;
    waktuMuatEvent = Date.now();
    muat();
  }

  // Tab kembali terlihat / perangkat kembali online: siaran realtime bisa terlewat selama tab di latar
  // (WebSocket ditangguhkan browser), jadi periksa kembali bila ditandai kotor atau sudah lewat TTL.
  window.addEventListener('djpm:swr-window-focus', function () {
    if (!S.siap || !adalahUtama() || !token()) return;
    if (panel.classList.contains('hidden') || document.hidden || sedangSibuk()) return;
    if (S.kotor || Date.now() - S.waktu >= ttlSegarMs()) { S.kotor = true; jalankanMuatEvent(); }
  });
})();
