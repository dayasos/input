/**
 * public/js/app-kelola-ibadah.js
 * Modul Manajemen Data Rumah Ibadah In-Page untuk DJPM 2027 (Khusus Admin Utama)
 * Desain clean, tabular profesional, senada dengan tab Kelola Data & Kelola User.
 * Dilengkapi SWR 0ms, Realtime CDC Sync, 4 Stat Cards, Filter Terpadu, & Paginasi Adaptif.
 */
(function () {
  'use strict';

  var tab = document.getElementById('btn-kelola-rumah-ibadah');
  var panel = document.getElementById('panel-kelola-ibadah');
  if (!tab || !panel) return;

  // ---------------------------------------------------------------------------
  // Konfigurasi & Master Data
  // ---------------------------------------------------------------------------
  var DAFTAR_KECAMATAN = (typeof DAFTAR_KECAMATAN_MEDAN !== 'undefined' && Array.isArray(DAFTAR_KECAMATAN_MEDAN))
    ? DAFTAR_KECAMATAN_MEDAN
    : [
      'MEDAN AMPLAS', 'MEDAN AREA', 'MEDAN BARAT', 'MEDAN BARU', 'MEDAN BELAWAN',
      'MEDAN DELI', 'MEDAN DENAI', 'MEDAN HELVETIA', 'MEDAN JOHOR', 'MEDAN KOTA',
      'MEDAN LABUHAN', 'MEDAN MAIMUN', 'MEDAN MARELAN', 'MEDAN PERJUANGAN',
      'MEDAN PETISAH', 'MEDAN POLONIA', 'MEDAN SELAYANG', 'MEDAN SUNGGAL',
      'MEDAN TEMBUNG', 'MEDAN TIMUR', 'MEDAN TUNTUNGAN'
    ];

  var DAFTAR_JENIS = [
    { val: 'MASJID', label: 'Masjid' },
    { val: 'MUSHOLLA', label: 'Musholla' },
    { val: 'GEREJA', label: 'Gereja Protestan' },
    { val: 'GEREJA_KATOLIK', label: 'Gereja Katolik' },
    { val: 'VIHARA', label: 'Vihara' },
    { val: 'KLENTENG', label: 'Klenteng' },
    { val: 'KUIL', label: 'Kuil' }
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var S = {
    siap: false,
    daftar: [],
    cacheBaris: {},
    total: 0,
    page: 1,
    limit: 20,
    totalHalaman: 1,
    cari: '',
    jenis: '',
    kecamatan: '',
    statusKlasifikasi: '',
    waktu: 0,
    kotor: false,
    loading: false,
    seq: 0,
    stats: { total: 0, masjid: 0, gereja: 0, vihara: 0 }
  };

  var CACHE_KEY = 'djpm_swr_kelola_ibadah_v1';
  var TTL_SEGAR_MS = 90 * 1000;
  var timerCari = null;
  var timerRealtime = null;
  var waktuMuatTerakhir = 0;

  var IKON_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  var IKON_HAPUS = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';

  // ---------------------------------------------------------------------------
  // Util
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function esc(val) {
    if (typeof window.esc === 'function') return window.esc(val);
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function adalahUtama() {
    return typeof dataPengguna !== 'undefined' && dataPengguna && String(dataPengguna.role || '').trim().toUpperCase() === 'UTAMA';
  }

  function token() {
    return (typeof dataPengguna !== 'undefined' && dataPengguna && dataPengguna.token) || '';
  }

  function formatJenis(jRaw) {
    var raw = String(jRaw || '').trim();
    if (!raw) return '-';
    var j = raw.toUpperCase().replace(/\s+/g, '_');
    var f = DAFTAR_JENIS.find(function (item) { return item.val === j; });
    if (f) return f.label;
    if (j === 'MUSHOLA') return 'Musholla';
    if (j === 'GEREJA_PROTESTAN') return 'Gereja Protestan';
    if (j === 'VIHARA_KLENTENG_KUIL' || j === 'PGK' || j.indexOf('KLASIFIKASI') !== -1) return 'Perlu Klasifikasi';
    return raw;
  }

  function badgeJenisIbadah(jRaw) {
    var raw = String(jRaw || '').trim();
    if (!raw || raw === '-') {
      return '<span class="text-slate-400 italic text-xs">-</span>';
    }
    var j = raw.toUpperCase().replace(/\s+/g, '_');
    var label = formatJenis(raw);
    var kelas = 'bg-slate-100 text-slate-700 border-slate-200';

    if (j === 'MASJID') {
      kelas = 'bg-emerald-50 text-emerald-700 border-emerald-200/70';
    } else if (j === 'MUSHOLLA' || j === 'MUSHOLA') {
      kelas = 'bg-teal-50 text-teal-700 border-teal-200/70';
    } else if (j === 'GEREJA' || j === 'GEREJA_PROTESTAN') {
      kelas = 'bg-sky-50 text-sky-700 border-sky-200/70';
    } else if (j === 'GEREJA_KATOLIK') {
      kelas = 'bg-indigo-50 text-indigo-700 border-indigo-200/70';
    } else if (j === 'VIHARA') {
      kelas = 'bg-amber-50 text-amber-700 border-amber-200/70';
    } else if (j === 'KLENTENG') {
      kelas = 'bg-rose-50 text-rose-700 border-rose-200/70';
    } else if (j === 'KUIL') {
      kelas = 'bg-orange-50 text-orange-700 border-orange-200/70';
    } else if (j === 'VIHARA_KLENTENG_KUIL' || j === 'PGK' || j.indexOf('KLASIFIKASI') !== -1) {
      kelas = 'bg-amber-50 text-amber-800 border-amber-300 font-semibold';
    }

    return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ' + kelas + '">' + esc(label) + '</span>';
  }

  function bacaCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) { return null; }
  }

  function tulisCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        waktu: Date.now(),
        daftar: data.daftar || [],
        total: data.total || 0,
        stats: S.stats
      }));
    } catch (_e) { }
  }

  function sedangBukaModal() {
    var m = $('modal-form-rumah-ibadah');
    return !!(m && !m.classList.contains('hidden'));
  }

  // ---------------------------------------------------------------------------
  // Template Kerangka In-Page DOM
  // ---------------------------------------------------------------------------
  function renderKerangka() {
    var optJenis = DAFTAR_JENIS.map(function (j) {
      return '<option value="' + j.val + '">' + j.label + '</option>';
    }).join('');

    var optKec = DAFTAR_KECAMATAN.map(function (k) {
      return '<option value="' + k + '">' + k + '</option>';
    }).join('');

    panel.innerHTML =
      '<!-- Header + Total + Toolbar -->' +
      '<div class="flex flex-col gap-3 mb-6 border-b border-slate-100 pb-4">' +
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">' +
      '<div>' +
      '<h2 class="text-lg sm:text-xl font-bold text-slate-800">Manajemen Data Rumah Ibadah</h2>' +
      '<p class="text-xs text-slate-500 mt-1 leading-relaxed">Khusus Admin Utama. Kelola master data rumah ibadah se-Kota Medan secara terpusat untuk verifikasi tempat tugas penerima.</p>' +
      '</div>' +
      '<div id="ki-total-badge" class="self-start sm:self-auto flex-shrink-0 whitespace-nowrap bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg text-xs font-semibold border-2 border-emerald-400">' +
      'Total Rumah Ibadah: Dimuat...' +
      '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 flex-nowrap overflow-x-auto pb-1">' +
      '<button type="button" id="ki-btn-tambah" class="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-sm flex items-center gap-1.5 shrink-0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>' +
      '<span>Tambah Rumah Ibadah</span>' +
      '</button>' +
      '<button type="button" id="ki-btn-refresh" class="bg-white hover:bg-slate-50 active:scale-95 border border-slate-300 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-sm flex items-center gap-1.5 shrink-0" title="Refresh Data">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>' +
      '<span>Refresh</span>' +
      '</button>' +
      '</div>' +
      '</div>' +

      '<!-- 4 Stat Cards Ringkasan Rumah Ibadah -->' +
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5">' +
      '<div class="bg-white border border-slate-200/80 rounded-xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between min-w-0">' +
      '<div class="min-w-0 pr-1.5">' +
      '<div class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider truncate">Total Terdaftar</div>' +
      '<div id="stat-ki-total" class="text-lg sm:text-xl font-black text-slate-800 mt-0.5 tracking-tight">0</div>' +
      '<div class="text-[10px] text-slate-500 mt-0.5 truncate">Seluruh tempat ibadah</div>' +
      '</div>' +
      '<div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">' +
      '<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>' +
      '</div>' +
      '</div>' +

      '<div class="bg-white border border-slate-200/80 rounded-xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between min-w-0">' +
      '<div class="min-w-0 pr-1.5">' +
      '<div class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider truncate">Masjid &amp; Musholla</div>' +
      '<div id="stat-ki-masjid" class="text-lg sm:text-xl font-black text-teal-700 mt-0.5 tracking-tight">0</div>' +
      '<div class="text-[10px] text-slate-500 mt-0.5 truncate">Umat Islam</div>' +
      '</div>' +
      '<div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">' +
      '<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8m0 0l-3 3m3-3l3 3M4 10l8-6 8 6v10a1 1 0 01-1 1H5a1 1 0 01-1-1V10z"/></svg>' +
      '</div>' +
      '</div>' +

      '<div class="bg-white border border-slate-200/80 rounded-xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between min-w-0">' +
      '<div class="min-w-0 pr-1.5">' +
      '<div class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider truncate">Gereja Kristen &amp; Katolik</div>' +
      '<div id="stat-ki-gereja" class="text-lg sm:text-xl font-black text-sky-700 mt-0.5 tracking-tight">0</div>' +
      '<div class="text-[10px] text-slate-500 mt-0.5 truncate">Protestan &amp; Katolik</div>' +
      '</div>' +
      '<div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">' +
      '<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m-5-12h10"/></svg>' +
      '</div>' +
      '</div>' +

      '<div class="bg-white border border-slate-200/80 rounded-xl p-3 sm:p-3.5 shadow-2xs flex items-center justify-between min-w-0">' +
      '<div class="min-w-0 pr-1.5">' +
      '<div class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider truncate">Vihara, Klenteng, Kuil</div>' +
      '<div id="stat-ki-vihara" class="text-lg sm:text-xl font-black text-amber-700 mt-0.5 tracking-tight">0</div>' +
      '<div class="text-[10px] text-slate-500 mt-0.5 truncate">Buddha, Konghucu, Hindu</div>' +
      '</div>' +
      '<div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">' +
      '<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M7.05 16.95l-1.414 1.414M16.95 16.95l1.414 1.414M7.05 7.05L5.636 5.636"/></svg>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<!-- Panel Penyaringan & Pencarian -->' +
      '<div class="mb-5 bg-slate-50 p-4 rounded-xl border border-slate-200/80 shadow-2xs space-y-3">' +
      '<div class="flex items-center justify-between flex-wrap gap-2">' +
      '<div class="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">' +
      '<svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>' +
      '<span>Penyaringan &amp; Pencarian Rumah Ibadah</span>' +
      '</div>' +
      '<button type="button" id="ki-btn-reset-filter" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 border border-slate-300 rounded-xl text-xs font-semibold shadow-2xs transition">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>' +
      '<span>Reset Filter</span>' +
      '</button>' +
      '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">' +
      '<div class="sm:col-span-2 lg:col-span-2">' +
      '<label for="cari-kelola-ri" class="block text-xs font-medium text-slate-600 mb-1">Cari Rumah Ibadah</label>' +
      '<div class="relative">' +
      '<input type="text" id="cari-kelola-ri" placeholder="Cari nama tempat ibadah, kelurahan, alamat..." autocomplete="off" style="text-transform:none"' +
      ' class="w-full pl-8 pr-7 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-700 shadow-2xs transition">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
      '<button type="button" id="ki-btn-clear-search" class="hidden absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-sm leading-none">&times;</button>' +
      '</div>' +
      '</div>' +
      '<div>' +
      '<label for="filter-jenis-kelola-ri" class="block text-xs font-medium text-slate-600 mb-1">Filter Jenis</label>' +
      '<select id="filter-jenis-kelola-ri" class="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-700 shadow-2xs transition">' +
      '<option value="">Semua Jenis</option>' +
      optJenis +
      '</select>' +
      '</div>' +
      '<div>' +
      '<label for="filter-kecamatan-kelola-ri" class="block text-xs font-medium text-slate-600 mb-1">Filter Kecamatan</label>' +
      '<select id="filter-kecamatan-kelola-ri" class="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-700 shadow-2xs transition">' +
      '<option value="">Semua Kecamatan</option>' +
      optKec +
      '</select>' +
      '</div>' +
      '<div>' +
      '<label for="filter-status-klasifikasi-ri" class="block text-xs font-medium text-slate-600 mb-1">Status Klasifikasi</label>' +
      '<select id="filter-status-klasifikasi-ri" class="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-700 shadow-2xs transition">' +
      '<option value="">Semua Status</option>' +
      '<option value="SELESAI">Terklasifikasi</option>' +
      '<option value="PERLU_KLASIFIKASI">Perlu Klasifikasi</option>' +
      '</select>' +
      '</div>' +
      '<div>' +
      '<label for="ki-limit" class="block text-xs font-medium text-slate-600 mb-1">Per Halaman</label>' +
      '<select id="ki-limit" class="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-700 shadow-2xs transition">' +
      '<option value="10">10 data</option>' +
      '<option value="20" selected>20 data</option>' +
      '<option value="50">50 data</option>' +
      '<option value="100">100 data</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<!-- Mobile Hint & Tabel Data -->' +
      '<div class="sm:hidden flex items-center justify-between text-xs text-slate-500 bg-slate-50/90 px-3 py-2 rounded-xl mb-2 border border-slate-200/60 shadow-2xs">' +
      '<span class="flex items-center gap-1.5 font-medium">' +
      '<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>' +
      '<span>Geser tabel ke samping untuk melihat detail wilayah &amp; aksi</span>' +
      '</span>' +
      '</div>' +
      '<div id="ki-hasil" class="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xs transition-opacity duration-150">' +
      '<table class="w-full min-w-[920px] text-left border-collapse bg-white table-auto">' +
      '<thead>' +
      '<tr class="bg-slate-800 text-white text-[11px] font-bold tracking-wider uppercase select-none border-b border-slate-700/80">' +
      '<th class="w-14 px-3 py-3.5 text-center whitespace-nowrap align-middle">No</th>' +
      '<th class="px-4 py-3.5 min-w-[150px] whitespace-nowrap align-middle">Jenis Ibadah</th>' +
      '<th class="px-4 py-3.5 min-w-[220px] whitespace-nowrap align-middle">Nama Tempat Ibadah</th>' +
      '<th class="px-4 py-3.5 min-w-[160px] whitespace-nowrap align-middle">Kecamatan</th>' +
      '<th class="px-4 py-3.5 min-w-[160px] whitespace-nowrap align-middle">Kelurahan</th>' +
      '<th class="px-4 py-3.5 min-w-[220px] whitespace-nowrap align-middle">Alamat Lengkap</th>' +
      '<th class="px-4 py-3.5 text-center min-w-[160px] whitespace-nowrap align-middle">Aksi</th>' +
      '</tr>' +
      '</thead>' +
      '<tbody id="tbody-kelola-ri" class="text-sm text-slate-700 divide-y divide-slate-100 bg-white">' +
      (typeof htmlSkeletonBaris === 'function' ? htmlSkeletonBaris(7, 5) : '<tr><td colspan="7" class="text-center py-8 text-slate-400 italic">Memuat data rumah ibadah...</td></tr>') +
      '</tbody>' +
      '</table>' +
      '</div>' +
      '<div id="loader-kelola-ri" class="hidden flex justify-center items-center py-4">' +
      '<div class="bar-tak-tentu w-28"></div>' +
      '</div>' +

      '<!-- Footer & Paginasi -->' +
      '<div class="mt-5 border-t border-slate-100 pt-4">' +
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">' +
      '<span class="text-[9px] text-slate-400 tracking-widest uppercase font-semibold">Developed by &nbsp;&middot;&nbsp; <span style="color:#ca8a04;">Tim Kelembagaan Bidang Dayasos</span></span>' +
      '<div id="ki-info-halaman" class="text-xs text-slate-500 font-medium"></div>' +
      '</div>' +
      '<div id="ki-pagination" class="flex items-center gap-1 flex-wrap justify-center mt-3"></div>' +
      '</div>';

    pasangModalForm();
    inisialisasiEventFilter();
  }

  // ---------------------------------------------------------------------------
  // Modal Form Tambah / Edit Rumah Ibadah (Diinjeksi ke body)
  // ---------------------------------------------------------------------------
  function pasangModalForm() {
    if ($('modal-form-rumah-ibadah')) return;

    var optJenis = DAFTAR_JENIS.map(function (j) {
      return '<option value="' + j.val + '">' + j.label + '</option>';
    }).join('');

    var optKec = DAFTAR_KECAMATAN.map(function (k) {
      return '<option value="' + k + '">' + k + '</option>';
    }).join('');

    document.body.insertAdjacentHTML('beforeend',
      '<div id="modal-form-rumah-ibadah" class="hidden fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4" onclick="if(event.target===this)window.tutupModalFormRumahIbadah()">' +
      '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden max-h-[92vh] max-h-[92dvh] flex flex-col">' +
      '<div class="flex justify-between items-center px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-800 text-white shrink-0">' +
      '<div class="flex items-center gap-3">' +
      '<div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>' +
      '</div>' +
      '<div>' +
      '<h3 id="judul-modal-form-ri" class="text-sm font-bold tracking-wide uppercase">Tambah Rumah Ibadah Baru</h3>' +
      '<p class="text-[11px] text-slate-300">Isi kelengkapan data rumah ibadah Kota Medan</p>' +
      '</div>' +
      '</div>' +
      '<button type="button" onclick="window.tutupModalFormRumahIbadah()" class="text-white/70 hover:text-white text-2xl leading-none transition" aria-label="Tutup">&times;</button>' +
      '</div>' +
      '<form id="form-modal-ri" onsubmit="window.simpanRumahIbadahBaru(event)" class="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1">' +
      '<input type="hidden" id="mri-id" value="">' +
      '<div>' +
      '<label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Jenis Rumah Ibadah <span class="text-red-500">*</span></label>' +
      '<select id="mri-jenis" required class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">' +
      '<option value="">-- Pilih Jenis --</option>' +
      optJenis +
      '</select>' +
      '</div>' +
      '<div id="mri-pesan" class="hidden text-xs font-semibold p-2.5 rounded-lg"></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
      '<div>' +
      '<label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Kecamatan <span class="text-red-500">*</span></label>' +
      '<select id="mri-kecamatan" required onchange="window.handleKecamatanFormRiChange()" class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">' +
      '<option value="">-- Pilih Kecamatan --</option>' +
      optKec +
      '</select>' +
      '</div>' +
      '<div>' +
      '<label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Kelurahan <span class="text-red-500">*</span></label>' +
      '<select id="mri-kelurahan" required class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">' +
      '<option value="">-- Pilih Kelurahan --</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div>' +
      '<label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Nama Tempat Ibadah <span class="text-red-500">*</span></label>' +
      '<input type="text" id="mri-nama" required placeholder="Contoh: MASJID RAYA AL-MASHUN" class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">' +
      '</div>' +
      '<div>' +
      '<label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Alamat Lengkap</label>' +
      '<textarea id="mri-alamat" rows="2" placeholder="Contoh: JL. MAHMUN AL RASYID NO. 1" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white"></textarea>' +
      '</div>' +
      '<div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">' +
      '<button type="button" onclick="window.tutupModalFormRumahIbadah()" class="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-semibold rounded-xl transition text-center">Batal</button>' +
      '<button type="submit" id="btn-submit-mri" class="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-sm transition text-center flex items-center justify-center gap-1.5">' +
      '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' +
      '<span>Simpan Data</span>' +
      '</button>' +
      '</div>' +
      '</form>' +
      '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------------------
  // Logika Filter & Paginasi
  // ---------------------------------------------------------------------------
  function inisialisasiEventFilter() {
    var inputCari = $('cari-kelola-ri');
    if (inputCari) {
      inputCari.addEventListener('input', function () {
        var btnClear = $('ki-btn-clear-search');
        if (btnClear) btnClear.classList.toggle('hidden', !inputCari.value.trim());
        clearTimeout(timerCari);
        timerCari = setTimeout(function () {
          S.cari = inputCari.value.trim();
          S.page = 1;
          muat(false);
        }, 250);
      });
    }

    var btnClear = $('ki-btn-clear-search');
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (inputCari) inputCari.value = '';
        btnClear.classList.add('hidden');
        S.cari = '';
        S.page = 1;
        muat(false);
      });
    }

    var selJenis = $('filter-jenis-kelola-ri');
    if (selJenis) {
      selJenis.addEventListener('change', function () {
        S.jenis = selJenis.value;
        S.page = 1;
        muat(false);
      });
    }

    var selKec = $('filter-kecamatan-kelola-ri');
    if (selKec) {
      selKec.addEventListener('change', function () {
        S.kecamatan = selKec.value;
        S.page = 1;
        muat(false);
      });
    }

    var selStatus = $('filter-status-klasifikasi-ri');
    if (selStatus) {
      selStatus.addEventListener('change', function () {
        S.statusKlasifikasi = selStatus.value;
        S.page = 1;
        muat(false);
      });
    }

    var selLimit = $('ki-limit');
    if (selLimit) {
      selLimit.addEventListener('change', function () {
        S.limit = selLimit.value;
        S.page = 1;
        muat(false);
      });
    }

    var btnReset = $('ki-btn-reset-filter');
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        window.resetFilterKelolaIbadah();
      });
    }

    var btnRefresh = $('ki-btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', function () {
        muat(false);
      });
    }

    var btnTambah = $('ki-btn-tambah');
    if (btnTambah) {
      btnTambah.addEventListener('click', function () {
        window.bukaModalTambahRumahIbadah();
      });
    }
  }

  window.resetFilterKelolaIbadah = function () {
    var c = $('cari-kelola-ri'); if (c) c.value = '';
    var bc = $('ki-btn-clear-search'); if (bc) bc.classList.add('hidden');
    var j = $('filter-jenis-kelola-ri'); if (j) j.value = '';
    var k = $('filter-kecamatan-kelola-ri'); if (k) k.value = '';
    var s = $('filter-status-klasifikasi-ri'); if (s) s.value = '';
    var l = $('ki-limit'); if (l) l.value = '20';
    S.cari = '';
    S.jenis = '';
    S.kecamatan = '';
    S.statusKlasifikasi = '';
    S.limit = 20;
    S.page = 1;
    muat(false);
  };

  // ---------------------------------------------------------------------------
  // Status Memuat & Skeleton Loading
  // ---------------------------------------------------------------------------
  // Baris lama tetap tampil (agak pudar) selama memuat ulang; skeleton bila tabel masih kosong
  function setMemuat(ya) {
    var h = $('ki-hasil');
    if (h) {
      var pudar = !!ya && S.daftar.length > 0;
      h.classList.toggle('opacity-60', pudar);
      h.classList.toggle('pointer-events-none', pudar);
    }
    var btnRefresh = $('ki-btn-refresh');
    if (btnRefresh) {
      var svg = btnRefresh.querySelector('svg');
      if (svg) svg.classList.toggle('animate-spin', !!ya);
    }
    var loader = $('loader-kelola-ri');
    if (loader) loader.classList.toggle('hidden', !ya || S.daftar.length > 0);
  }

  function skeletonTabel() {
    var tb = $('tbody-kelola-ri');
    if (!tb) return;
    if (typeof htmlSkeletonBaris === 'function') {
      tb.innerHTML = htmlSkeletonBaris(7, 5);
    } else {
      tb.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400 italic">Memuat data...</td></tr>';
    }
  }

  function susulKotor() {
    if (S.kotor && S.siap && !sedangBukaModal() && window.panelAktif === 'kelola_ibadah') {
      S.kotor = false;
      muat(true);
    }
  }
  window.susulKotorKelolaIbadah = susulKotor;
  window.tutupModalFormRumahIbadah = function () {
    var m = $('modal-form-rumah-ibadah');
    if (m) m.classList.add('hidden');
    susulKotor();
  };

  // ---------------------------------------------------------------------------
  // Muat Data (SWR & Background Revalidation)
  // ---------------------------------------------------------------------------
  function muat(senyap) {
    if (!adalahUtama() || !token()) return;

    var tbody = $('tbody-kelola-ri');
    var seq = ++S.seq;

    if (S.daftar.length === 0) skeletonTabel();
    setMemuat(true);

    var limitNum = S.limit === 'all' ? 100 : (Number(S.limit) || 20);

    // Refresh senyap (realtime/revalidasi latar) tidak menampilkan bar; hanya muat yang dipicu pengguna.
    var akhiriProgres = (!senyap && typeof progresSekali === 'function') ? progresSekali() : function () { };
    google.script.run
      .withSuccessHandler(function (res) {
        akhiriProgres();
        if (seq !== S.seq) return;
        setMemuat(false);

        if (!res || !res.sukses) {
          if (!senyap && tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500 font-medium">Gagal memuat: ' + esc(res ? res.pesan : 'Terjadi kesalahan') + '</td></tr>';
          }
          return;
        }

        S.daftar = res.daftar || [];
        S.total = res.total || 0;
        S.totalHalaman = res.totalHalaman || 1;
        S.cacheBaris = {};
        S.daftar.forEach(function (row) { S.cacheBaris[row.id] = row; });
        S.waktu = Date.now();
        S.kotor = false;
        waktuMuatTerakhir = Date.now();

        // Hitung estimasi statistik ringkasan
        kalkulasiStatistik(res);
        perbaruiStatCards();
        renderTabel();
        renderPaginasi();

        // Tulis cache jika pencarian default
        if (!S.cari && !S.jenis && !S.kecamatan && S.page === 1) {
          tulisCache(res);
        }
      })
      .withFailureHandler(function (err) {
        akhiriProgres();
        if (seq !== S.seq) return;
        setMemuat(false);
        if (!senyap && tbody) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500 font-medium">Error: ' + esc(err && err.message ? err.message : err) + '</td></tr>';
        }
      })
      .ambilDaftarRumahIbadahAdmin(token(), {
        cari: S.cari,
        jenis: S.jenis,
        kecamatan: S.kecamatan,
        statusKlasifikasi: S.statusKlasifikasi,
        page: S.page,
        limit: limitNum
      });
  }

  function kalkulasiStatistik(res) {
    if (!S.cari && !S.jenis && !S.kecamatan) {
      S.stats.total = S.total;
    }
    var m = 0, g = 0, v = 0;
    (res.daftar || []).forEach(function (r) {
      var j = String(r.jenis || '').toUpperCase();
      if (j === 'MASJID' || j === 'MUSHOLLA' || j === 'MUSHOLA') m++;
      else if (j === 'GEREJA' || j === 'GEREJA_KATOLIK') g++;
      else v++;
    });
    if (S.total > 0 && S.daftar.length > 0) {
      var ratio = S.total / S.daftar.length;
      S.stats.masjid = Math.round(m * ratio);
      S.stats.gereja = Math.round(g * ratio);
      S.stats.vihara = Math.max(0, S.total - S.stats.masjid - S.stats.gereja);
    }
  }

  function perbaruiStatCards() {
    var elTotal = $('stat-ki-total');
    if (elTotal) elTotal.textContent = (S.stats.total || S.total || 0).toLocaleString('id-ID');

    var elMasjid = $('stat-ki-masjid');
    if (elMasjid) elMasjid.textContent = (S.stats.masjid || 0).toLocaleString('id-ID');

    var elGereja = $('stat-ki-gereja');
    if (elGereja) elGereja.textContent = (S.stats.gereja || 0).toLocaleString('id-ID');

    var elVihara = $('stat-ki-vihara');
    if (elVihara) elVihara.textContent = (S.stats.vihara || 0).toLocaleString('id-ID');

    var elBadge = $('ki-total-badge');
    if (elBadge) {
      elBadge.textContent = 'Total: ' + (S.total || 0).toLocaleString('id-ID') + ' Rumah Ibadah';
    }
  }

  // ---------------------------------------------------------------------------
  // Render Tabel Data
  // ---------------------------------------------------------------------------
  function renderTabel() {
    var tbody = $('tbody-kelola-ri');
    if (!tbody) return;

    if (!S.daftar || S.daftar.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400 italic">Tidak ada data rumah ibadah yang sesuai filter.</td></tr>';
      return;
    }

    var limitNum = S.limit === 'all' ? S.daftar.length : (Number(S.limit) || 20);
    var offset = (S.page - 1) * limitNum;

    var html = S.daftar.map(function (r, i) {
      var namaEsc = esc(r.nama || '-');
      var namaAttr = (r.nama || '').replace(/'/g, "\\'");
      return '<tr class="hover:bg-slate-50/80 transition">' +
        '<td class="w-14 px-3 py-3.5 text-center text-slate-400 font-mono text-xs align-middle">' + (offset + i + 1) + '</td>' +
        '<td class="px-4 py-3.5 whitespace-nowrap align-middle">' +
        badgeJenisIbadah(r.jenis) +
        '</td>' +
        '<td class="px-4 py-3.5 font-bold text-slate-800 align-middle leading-snug">' + namaEsc + '</td>' +
        '<td class="px-4 py-3.5 text-slate-700 font-medium whitespace-nowrap align-middle">' + esc(r.kecamatan || '-') + '</td>' +
        '<td class="px-4 py-3.5 text-slate-600 whitespace-nowrap align-middle">' + esc(r.kelurahan || '-') + '</td>' +
        '<td class="px-4 py-3.5 text-slate-500 max-w-xs truncate align-middle text-xs" title="' + esc(r.alamat || '-') + '">' + esc(r.alamat || '-') + '</td>' +
        '<td class="px-4 py-3.5 text-center whitespace-nowrap align-middle">' +
        '<div class="flex items-center justify-center gap-1.5">' +
        '<button type="button" onclick="window.bukaModalEditRumahIbadah(' + r.id + ')"' +
        ' class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 border border-sky-200/80 rounded-lg font-semibold text-xs transition shadow-2xs" title="Edit Data">' +
        IKON_EDIT + '<span>Edit</span>' +
        '</button>' +
        '<button type="button" onclick="window.konfirmasiHapusRumahIbadah(' + r.id + ', \'' + namaAttr + '\')"' +
        ' class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 active:scale-95 text-red-700 border border-red-200/80 rounded-lg font-semibold text-xs transition shadow-2xs" title="Hapus Data">' +
        IKON_HAPUS + '<span>Hapus</span>' +
        '</button>' +
        '</div>' +
        '</td>' +
        '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Render Paginasi Adaptif (Desktop: Lengkap, Mobile: Ringkas)
  // ---------------------------------------------------------------------------
  function renderPaginasi() {
    var info = $('ki-info-halaman');
    var wadah = $('ki-pagination');
    if (!wadah) return;

    if (S.total === 0) {
      if (info) info.textContent = 'Tidak ada data';
      wadah.innerHTML = '';
      return;
    }

    var limitNum = S.limit === 'all' ? S.total : (Number(S.limit) || 20);
    var dari = (S.page - 1) * limitNum + 1;
    var sampai = Math.min(S.page * limitNum, S.total);

    if (info) {
      info.textContent = 'Menampilkan ' + dari.toLocaleString('id-ID') + ' - ' + sampai.toLocaleString('id-ID') +
        ' dari ' + S.total.toLocaleString('id-ID') + ' data (Halaman ' + S.page + ' / ' + S.totalHalaman + ')';
    }

    if (S.totalHalaman <= 1) {
      wadah.innerHTML = '';
      return;
    }

    var BASE = 'px-3 py-1.5 rounded-xl text-xs font-semibold transition min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-center active:scale-95 shadow-2xs';
    var AKTIF = BASE + ' bg-slate-800 text-white shadow-xs';
    var PASIF = BASE + ' bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 cursor-pointer';
    var NONAKTIF = BASE + ' bg-slate-100/60 border border-slate-200/50 text-slate-300 cursor-not-allowed';

    var ikonPrev = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>';
    var ikonNext = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>';

    var html = '';

    // Deteksi Layar Sempit / Mobile: 3 tombol ringkas
    if (window.innerWidth < 640) {
      var disPrevM = S.page === 1 ? 'disabled class="' + NONAKTIF + '"' : 'class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(' + (S.page - 1) + ')"';
      var disNextM = S.page === S.totalHalaman ? 'disabled class="' + NONAKTIF + '"' : 'class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(' + (S.page + 1) + ')"';
      html += '<button type="button" ' + disPrevM + ' title="Halaman Sebelumnya" aria-label="Halaman sebelumnya">' + ikonPrev + '<span class="ml-1 text-[11px]">Sebelumnya</span></button>';
      html += '<span class="px-3 py-1.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl min-w-[54px] text-center">' + S.page + ' / ' + S.totalHalaman + '</span>';
      html += '<button type="button" ' + disNextM + ' title="Halaman Berikutnya" aria-label="Halaman berikutnya"><span class="mr-1 text-[11px]">Berikutnya</span>' + ikonNext + '</button>';
      wadah.innerHTML = html;
      return;
    }

    // Tampilan Desktop / Tablet: Paginasi bernomor
    var disPrev = S.page === 1 ? 'disabled class="' + NONAKTIF + '"' : 'class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(' + (S.page - 1) + ')"';
    html += '<button type="button" ' + disPrev + ' title="Halaman Sebelumnya" aria-label="Halaman sebelumnya">' + ikonPrev + '</button>';

    var TAMPIL = 5;
    var mulai = Math.max(1, S.page - Math.floor(TAMPIL / 2));
    var akhir = mulai + TAMPIL - 1;
    if (akhir > S.totalHalaman) {
      akhir = S.totalHalaman;
      mulai = Math.max(1, akhir - TAMPIL + 1);
    }

    if (mulai > 1) {
      html += '<button type="button" class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(1)">1</button>';
      if (mulai > 2) html += '<span class="px-1 text-slate-400 text-xs">&hellip;</span>';
    }

    for (var p = mulai; p <= akhir; p++) {
      if (p === S.page) {
        html += '<button type="button" class="' + AKTIF + '" aria-current="page">' + p + '</button>';
      } else {
        html += '<button type="button" class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(' + p + ')">' + p + '</button>';
      }
    }

    if (akhir < S.totalHalaman) {
      if (akhir < S.totalHalaman - 1) html += '<span class="px-1 text-slate-400 text-xs">&hellip;</span>';
      html += '<button type="button" class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(' + S.totalHalaman + ')">' + S.totalHalaman + '</button>';
    }

    var disNext = S.page === S.totalHalaman ? 'disabled class="' + NONAKTIF + '"' : 'class="' + PASIF + '" onclick="window.gantiHalamanKelolaIbadah(' + (S.page + 1) + ')"';
    html += '<button type="button" ' + disNext + ' title="Halaman Berikutnya" aria-label="Halaman berikutnya">' + ikonNext + '</button>';

    wadah.innerHTML = html;
  }

  window.gantiHalamanKelolaIbadah = function (halaman) {
    if (halaman < 1 || halaman > S.totalHalaman) return;
    S.page = halaman;
    muat(false);
    var hasil = $('ki-hasil');
    if (hasil) hasil.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ---------------------------------------------------------------------------
  // Koordinasi Tab & Navigasi
  // ---------------------------------------------------------------------------
  var TAB_LAIN = ['tab-input', 'tab-rekap', 'tab-tools', 'tab-kelola-data', 'btn-kelola-user'];
  var PANEL_LAIN = ['panel-input', 'panel-rekap', 'panel-tools', 'panel-kelola-data', 'panel-kelola-user'];

  function nonaktifkanTabKelolaIbadah() {
    tab.classList.remove('tab-kelola-ibadah-aktif');
    tab.classList.add('bg-emerald-600/80');
    panel.classList.add('hidden');
  }

  function aktifkanTabKelolaIbadah() {
    tab.classList.remove('bg-emerald-600/80');
    tab.classList.add('tab-kelola-ibadah-aktif');
    panel.classList.remove('hidden');
  }

  window.nonaktifkanTabKelolaIbadah = nonaktifkanTabKelolaIbadah;
  window.aktifkanTabKelolaIbadah = aktifkanTabKelolaIbadah;

  TAB_LAIN.forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('click', function () {
      nonaktifkanTabKelolaIbadah();
    });
  });

  function bukaTabKelolaIbadah() {
    if (!adalahUtama()) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Fitur Manajemen Rumah Ibadah hanya dapat diakses oleh Admin Utama.', 'gagal');
      return;
    }

    if (window.panelAktif === 'kelola_ibadah' && panel && !panel.classList.contains('hidden')) {
      return;
    }

    TAB_LAIN.forEach(function (id) {
      var el = $(id);
      if (el && typeof window.setTabTidakAktif === 'function') window.setTabTidakAktif(el);
    });
    if (typeof window.nonaktifkanTabKelolaData === 'function') window.nonaktifkanTabKelolaData();
    if (typeof window.nonaktifkanTabKelolaUser === 'function') window.nonaktifkanTabKelolaUser();

    PANEL_LAIN.forEach(function (id) {
      var p = $(id);
      if (p) p.classList.add('hidden');
    });

    var refreshLihat = $('btn-refresh-data');
    if (refreshLihat) refreshLihat.classList.add('hidden');

    aktifkanTabKelolaIbadah();
    try { window.panelAktif = 'kelola_ibadah'; } catch (_e) { }

    if (!S.siap) {
      S.siap = true;
      renderKerangka();

      // Coba render 0ms instan dari sessionStorage cache jika tersedia
      var cache = bacaCache();
      if (cache && cache.daftar && cache.daftar.length > 0) {
        S.daftar = cache.daftar;
        S.total = cache.total || cache.daftar.length;
        S.stats = cache.stats || { total: S.total, masjid: 0, gereja: 0, vihara: 0 };
        S.waktu = cache.waktu || 0;
        perbaruiStatCards();
        renderTabel();
        renderPaginasi();

        // Revalidasi di latar jika sudah lewat batas segar TTL
        if (Date.now() - S.waktu >= TTL_SEGAR_MS || S.kotor) {
          muat(true);
        }
      } else {
        muat(false);
      }
    } else {
      if (S.daftar.length > 0) {
        perbaruiStatCards();
        renderTabel();
        renderPaginasi();
        if (S.kotor || Date.now() - S.waktu >= TTL_SEGAR_MS) muat(true);
      } else {
        muat(false);
      }
    }
  }

  window.bukaTabKelolaIbadah = bukaTabKelolaIbadah;
  window.bukaModalKelolaRumahIbadah = bukaTabKelolaIbadah; // Backward-compatibility alias

  tab.addEventListener('click', function (e) {
    e.preventDefault();
    bukaTabKelolaIbadah();
  });

  // ---------------------------------------------------------------------------
  // Modal Form Tambah / Edit & CRUD Logic
  // ---------------------------------------------------------------------------
  window.bukaModalTambahRumahIbadah = function () {
    if (!adalahUtama()) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat menambah data.', 'gagal');
      return;
    }
    pasangModalForm();
    var form = $('form-modal-ri');
    if (form) form.reset();
    var pesanEl = $('mri-pesan'); if (pesanEl) pesanEl.classList.add('hidden');

    var idEl = $('mri-id'); if (idEl) idEl.value = '';
    var judul = $('judul-modal-form-ri'); if (judul) judul.textContent = 'Tambah Rumah Ibadah Baru';

    var selectKel = $('mri-kelurahan');
    if (selectKel) selectKel.innerHTML = '<option value="">-- Pilih Kelurahan --</option>';

    var modal = $('modal-form-rumah-ibadah');
    if (modal) modal.classList.remove('hidden');
  };

  window.handleKecamatanFormRiChange = function (callbackKelurahanDipilih) {
    var kecEl = $('mri-kecamatan');
    var kelEl = $('mri-kelurahan');
    if (!kecEl || !kelEl) return;

    var kec = kecEl.value;
    if (!kec) {
      kelEl.innerHTML = '<option value="">-- Pilih Kelurahan --</option>';
      return;
    }

    kelEl.innerHTML = '<option value="">Memuat kelurahan...</option>';
    kelEl.disabled = true;

    google.script.run
      .withSuccessHandler(function (daftarKel) {
        kelEl.disabled = false;
        var list = Array.isArray(daftarKel) ? daftarKel : [];
        kelEl.innerHTML = '<option value="">-- Pilih Kelurahan --</option>' + list.map(function (k) {
          return '<option value="' + k + '">' + k + '</option>';
        }).join('');
        if (typeof callbackKelurahanDipilih === 'function') callbackKelurahanDipilih();
      })
      .withFailureHandler(function () {
        kelEl.disabled = false;
        kelEl.innerHTML = '<option value="">Gagal memuat kelurahan</option>';
      })
      .getKelurahanByKecamatan(token(), kec);
  };

  window.bukaModalEditRumahIbadah = function (id) {
    if (!adalahUtama()) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat mengedit data.', 'gagal');
      return;
    }
    var row = S.cacheBaris[id];
    if (!row) return;

    pasangModalForm();
    var idEl = $('mri-id');
    var jenisEl = $('mri-jenis');
    var kecEl = $('mri-kecamatan');
    var kelEl = $('mri-kelurahan');
    var namaEl = $('mri-nama');
    var alamatEl = $('mri-alamat');
    var judul = $('judul-modal-form-ri');

    if (judul) judul.textContent = 'Edit Data Rumah Ibadah';
    if (idEl) idEl.value = row.id;

    var jenisResmi = DAFTAR_JENIS.some(function (j) { return j.val === row.jenis; });
    if (jenisEl) jenisEl.value = jenisResmi ? row.jenis : '';
    if (kecEl) kecEl.value = row.kecamatan;
    if (namaEl) namaEl.value = row.nama;
    if (alamatEl) alamatEl.value = row.alamat;

    var pesanEl = $('mri-pesan');
    if (jenisResmi) {
      if (pesanEl) pesanEl.classList.add('hidden');
    } else if (pesanEl) {
      pesanEl.textContent = 'Data ini memakai jenis lama "' + (row.jenis || '-') + '". Pilih salah satu jenis resmi sebelum menyimpan.';
      pesanEl.className = 'text-xs font-semibold p-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200';
      pesanEl.classList.remove('hidden');
    }

    window.handleKecamatanFormRiChange(function () {
      if (kelEl && row.kelurahan) kelEl.value = row.kelurahan;
    });

    var modal = $('modal-form-rumah-ibadah');
    if (modal) modal.classList.remove('hidden');
  };

  window.simpanRumahIbadahBaru = function (event) {
    if (event) event.preventDefault();

    if (!adalahUtama() || !token()) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat menyimpan data.', 'gagal');
      return;
    }

    var id = $('mri-id')?.value;
    var jenis = ($('mri-jenis')?.value || '').trim();
    var kecamatan = ($('mri-kecamatan')?.value || '').trim();
    var kelurahan = ($('mri-kelurahan')?.value || '').trim();
    var nama = ($('mri-nama')?.value || '').trim();
    var alamat = ($('mri-alamat')?.value || '').trim();

    if (!jenis) { if (typeof tampilkanToast === 'function') tampilkanToast('Pilih jenis rumah ibadah!', 'gagal'); return; }
    if (!kecamatan) { if (typeof tampilkanToast === 'function') tampilkanToast('Pilih kecamatan!', 'gagal'); return; }
    if (!kelurahan) { if (typeof tampilkanToast === 'function') tampilkanToast('Pilih kelurahan!', 'gagal'); return; }
    if (!nama || nama.length < 3) { if (typeof tampilkanToast === 'function') tampilkanToast('Nama rumah ibadah minimal 3 karakter!', 'gagal'); return; }

    var btnSubmit = $('btn-submit-mri');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Menyimpan...';
    }

    var payload = { jenis: jenis, kecamatan: kecamatan, kelurahan: kelurahan, nama: nama, alamat: alamat };

    if (id) {
      payload.id = Number(id);
      google.script.run
        .withSuccessHandler(function (res) {
          if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
          if (res && res.sukses) {
            if (typeof tampilkanToast === 'function') tampilkanToast(res.pesan || 'Data berhasil diperbarui!', 'sukses');
            $('modal-form-rumah-ibadah')?.classList.add('hidden');
            muat(false);
          } else {
            if (typeof tampilkanToast === 'function') tampilkanToast(res ? res.pesan : 'Gagal memperbarui data.', 'gagal');
          }
        })
        .withFailureHandler(function (err) {
          if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
          if (typeof tampilkanToast === 'function') tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
        })
        .ubahRumahIbadah(token(), payload);
    } else {
      google.script.run
        .withSuccessHandler(function (res) {
          if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
          if (res && res.sukses) {
            if (typeof tampilkanToast === 'function') tampilkanToast(res.pesan || 'Data berhasil ditambahkan!', 'sukses');
            $('modal-form-rumah-ibadah')?.classList.add('hidden');
            S.page = 1;
            muat(false);
          } else {
            if (typeof tampilkanToast === 'function') tampilkanToast(res ? res.pesan : 'Gagal menambahkan data.', 'gagal');
          }
        })
        .withFailureHandler(function (err) {
          if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
          if (typeof tampilkanToast === 'function') tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
        })
        .tambahRumahIbadah(token(), payload);
    }
  };

  window.konfirmasiHapusRumahIbadah = async function (id, nama) {
    if (!adalahUtama() || !token()) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat menghapus data.', 'gagal');
      return;
    }

    var yakin = (typeof window.konfirmasiAksi === 'function')
      ? await window.konfirmasiAksi({
        judul: 'Hapus Tempat Ibadah',
        pesan: 'Apakah Anda yakin ingin menghapus data tempat ibadah:\n"' + nama + '"?\n\nTindakan ini permanen dan tidak dapat dibatalkan.',
        tipe: 'danger',
        teksKonfirmasi: 'Ya, Hapus Data',
        teksBatal: 'Batal'
      })
      : window.confirm('Hapus data "' + nama + '"?');

    if (!yakin) return;

    if (typeof tampilkanToast === 'function') {
      tampilkanToast('Menghapus data "' + nama + '"...', 'proses');
    }

    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.sukses) {
          if (typeof tampilkanToast === 'function') tampilkanToast(res.pesan || 'Data berhasil dihapus.', 'sukses');
          muat(false);
        } else {
          if (typeof tampilkanToast === 'function') tampilkanToast(res ? res.pesan : 'Gagal menghapus data.', 'gagal');
        }
      })
      .withFailureHandler(function (err) {
        if (typeof tampilkanToast === 'function') tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
      })
      .hapusRumahIbadah(token(), id);
  };

  // ---------------------------------------------------------------------------
  // Realtime Sync Listener (Supabase CDC & Window Focus)
  // ---------------------------------------------------------------------------
  window.addEventListener('djpm:swr-invalidated', function (ev) {
    if (!adalahUtama() || !token()) return;
    var domains = (ev.detail && ev.detail.domains) || [];
    if (domains.indexOf('*') === -1 && domains.indexOf('rumah_ibadah') === -1 && domains.indexOf('master') === -1) return;

    if (panel.classList.contains('hidden')) {
      S.kotor = true;
      return;
    }

    if (sedangBukaModal()) {
      S.kotor = true;
      return;
    }

    S.kotor = true;
    clearTimeout(timerRealtime);
    var jeda = Math.max(400, 1500 - (Date.now() - waktuMuatTerakhir));
    timerRealtime = setTimeout(function () {
      timerRealtime = null;
      if (!panel.classList.contains('hidden') && !sedangBukaModal()) {
        muat(true);
      }
    }, jeda);
  });

  window.addEventListener('djpm:swr-window-focus', function () {
    if (!adalahUtama() || !token()) return;
    if (panel.classList.contains('hidden') || document.hidden || sedangBukaModal()) return;
    if (S.kotor || Date.now() - S.waktu >= TTL_SEGAR_MS) {
      muat(true);
    }
  });

  var timerResize = null;
  window.addEventListener('resize', function () {
    clearTimeout(timerResize);
    timerResize = setTimeout(function () {
      if (S.siap && !panel.classList.contains('hidden') && S.totalHalaman > 1) {
        renderPaginasi();
      }
    }, 150);
  });

})();
