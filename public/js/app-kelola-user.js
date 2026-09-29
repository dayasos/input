/**
 * public/js/app-kelola-user.js
 * Modul Manajemen Pengguna In-Page untuk DJPM 2027 (Khusus Admin Utama)
 * Desain ultra-clean, tabular profesional, bebas ornamen/dekorasi berlebih
 * senada dengan tab Kelola Data. Dilengkapi SWR 0ms, Realtime CDC, & Paginasi.
 */
(function () {
  'use strict';

  var tab = document.getElementById('btn-kelola-user');
  var panel = document.getElementById('panel-kelola-user');
  if (!tab || !panel) return;

  // ---------------------------------------------------------------------------
  // Konfigurasi & State
  // ---------------------------------------------------------------------------
  var DAFTAR_KECAMATAN = [
    'MEDAN AMPLAS', 'MEDAN AREA', 'MEDAN BARAT', 'MEDAN BARU', 'MEDAN BELAWAN',
    'MEDAN DELI', 'MEDAN DENAI', 'MEDAN HELVETIA', 'MEDAN JOHOR', 'MEDAN KOTA',
    'MEDAN LABUHAN', 'MEDAN MAIMUN', 'MEDAN MARELAN', 'MEDAN PERJUANGAN',
    'MEDAN PETISAH', 'MEDAN POLONIA', 'MEDAN SELAYANG', 'MEDAN SUNGGAL',
    'MEDAN TEMBUNG', 'MEDAN TIMUR', 'MEDAN TUNTUNGAN'
  ];

  var PILIHAN_ROLE = [
    { nilai: 'UTAMA', label: 'Utama' },
    { nilai: 'KECAMATAN', label: 'Kecamatan' },
    { nilai: 'GURU SEKOLAH BUDDHA', label: 'Guru Sekolah Buddha' },
    { nilai: 'GURU SEKOLAH HINDU', label: 'Guru Sekolah Hindu' },
    { nilai: 'GURU SEKOLAH KONG HU CHU', label: 'Guru Sekolah Kong Hu Chu' },
    { nilai: 'GURU SEKOLAH MINGGU', label: 'Guru Sekolah Minggu' },
    { nilai: 'PENATUA GEREJA', label: 'Penatua Gereja' },
    { nilai: 'GURU MAGHRIB MENGAJI', label: 'Guru Maghrib Mengaji' }
  ];

  var S = {
    siap: false,
    daftarSemua: [],
    daftarTerfilter: [],
    total: 0,
    page: 1,
    limit: 20,
    totalHalaman: 1,
    q: '',
    role: '',
    kecamatan: '',
    waktu: 0,
    kotor: false,
    loading: false,
    seq: 0
  };

  var CACHE_KEY = 'djpm_swr_kelola_user_v1';
  var TTL_SEGAR_MS = 90 * 1000;
  var timerCari = null;
  var timerRealtime = null;
  var waktuMuatTerakhir = 0;

  var IKON_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  var IKON_RESET = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>';
  var IKON_HAPUS = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';

  // ---------------------------------------------------------------------------
  // Util
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function adalahUtama() {
    return typeof dataPengguna !== 'undefined' && dataPengguna && String(dataPengguna.role || '').trim().toUpperCase() === 'UTAMA';
  }

  function token() {
    return (typeof dataPengguna !== 'undefined' && dataPengguna && dataPengguna.token) || '';
  }

  function formatAngka(n) {
    return Number(n || 0).toLocaleString('id-ID');
  }

  function labelRole(role) {
    var val = String(role || '').trim().toUpperCase();
    var f = PILIHAN_ROLE.find(function (p) { return p.nilai === val; });
    return f ? f.label : (val || '-');
  }

  function formatNomorHpLink(hp) {
    if (!hp) return null;
    var digits = String(hp).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    if (digits.length >= 10 && digits.length <= 15) return 'https://wa.me/' + digits;
    return null;
  }

  function sedangBukaModal() {
    var cek = function (id) { var el = $(id); return !!el && !el.classList.contains('hidden'); };
    return cek('modal-tambah-user') || cek('modal-edit-user') || cek('modal-reset-sandi-user') || cek('modal-konfirmasi-universal');
  }

  // ---------------------------------------------------------------------------
  // SWR Cache Storage
  // ---------------------------------------------------------------------------
  function simpanCache(daftar) {
    try {
      var item = { waktu: Date.now(), daftar: daftar || [] };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(item));
    } catch (_e) { /* kuota session penuh diabaikan */ }
  }

  function bacaCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.daftar)) return parsed;
    } catch (_e) { /* parse gagal */ }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Status Memuat & Skeleton Loading
  // ---------------------------------------------------------------------------
  function setMemuat(ya) {
    var h = $('ku-hasil');
    if (h) {
      var pudar = !!ya && S.daftarSemua.length > 0;
      h.classList.toggle('opacity-60', pudar);
      h.classList.toggle('pointer-events-none', pudar);
    }
    var btnRefresh = $('ku-btn-refresh');
    if (btnRefresh) {
      var svg = btnRefresh.querySelector('svg');
      if (svg) svg.classList.toggle('animate-spin', !!ya);
    }
    var loader = $('loader-kelola-user');
    if (loader) loader.classList.toggle('hidden', !ya || S.daftarSemua.length > 0);
  }

  function skeletonTabel() {
    var tb = $('tbody-kelola-user');
    if (!tb) return;
    if (typeof htmlSkeletonBaris === 'function') {
      tb.innerHTML = htmlSkeletonBaris(7, 5);
    } else {
      tb.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400 italic">Memuat pengguna...</td></tr>';
    }
  }

  // ---------------------------------------------------------------------------
  // Pemanggilan Data (SWR & Background Revalidation)
  // ---------------------------------------------------------------------------
  function muat(senyap) {
    if (!adalahUtama() || !token()) return;

    var nomor = ++S.seq;
    S.loading = true;

    if (S.daftarSemua.length === 0) skeletonTabel();
    setMemuat(true);

    google.script.run
      .withSuccessHandler(function (res) {
        if (nomor !== S.seq) return;
        S.loading = false;
        setMemuat(false);

        if (!res || !res.sukses) {
          if (!senyap && S.daftarSemua.length === 0) {
            var tb = $('tbody-kelola-user');
            if (tb) tb.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-rose-500 font-semibold">' + esc(res ? res.pesan : 'Gagal memuat daftar pengguna') + '</td></tr>';
          }
          return;
        }

        var daftar = Array.isArray(res.daftar) ? res.daftar : [];
        S.daftarSemua = daftar;
        window.daftarAkunLengkapCache = daftar;
        S.waktu = Date.now();
        S.kotor = false;
        waktuMuatTerakhir = Date.now();
        simpanCache(daftar);

        perbaruiStatCards();
        terapkanFilter(false);
      })
      .withFailureHandler(function (err) {
        if (nomor !== S.seq) return;
        S.loading = false;
        setMemuat(false);

        if (!senyap && S.daftarSemua.length === 0) {
          var tb = $('tbody-kelola-user');
          if (tb) tb.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-rose-500 font-semibold">Gagal memuat: ' + esc(err && err.message ? err.message : err) + '</td></tr>';
        }
      })
      .ambilDaftarAkunLengkap(token());
  }

  // ---------------------------------------------------------------------------
  // Perhitungan Statistik (Stat Cards)
  // ---------------------------------------------------------------------------
  function perbaruiStatCards() {
    var semua = S.daftarSemua || [];
    var total = semua.length;
    var jmlKec = 0;
    var jmlKemenag = 0;
    var jmlUtama = 0;

    semua.forEach(function (u) {
      var r = String(u.role || '').toUpperCase();
      if (r === 'UTAMA') jmlUtama++;
      else if (r === 'KECAMATAN') jmlKec++;
      else jmlKemenag++;
    });

    var badgeTotal = $('ku-total-badge');
    if (badgeTotal) badgeTotal.textContent = 'Total Pengguna: ' + formatAngka(total) + ' Akun';

    var elTotal = $('stat-ku-total');
    if (elTotal) elTotal.textContent = formatAngka(total);

    var elKec = $('stat-ku-kecamatan');
    if (elKec) elKec.textContent = formatAngka(jmlKec);

    var elKem = $('stat-ku-kemenag');
    if (elKem) elKem.textContent = formatAngka(jmlKemenag);

    var elUtama = $('stat-ku-utama');
    if (elUtama) elUtama.textContent = formatAngka(jmlUtama);
  }

  // ---------------------------------------------------------------------------
  // Filter & Pencarian
  // ---------------------------------------------------------------------------
  function terapkanFilter(resetPage) {
    if (resetPage) S.page = 1;

    var inputCari = $('cari-kelola-user');
    var q = inputCari ? (inputCari.value || '').trim().toLowerCase() : '';
    S.q = q;

    var btnClear = $('ku-btn-clear-search');
    if (btnClear) btnClear.classList.toggle('hidden', !q);

    var selRole = $('filter-role-kelola-user');
    var r = selRole ? (selRole.value || '').trim().toUpperCase() : '';
    S.role = r;

    var selKec = $('filter-kecamatan-kelola-user');
    var kec = selKec ? (selKec.value || '').trim().toUpperCase() : '';
    S.kecamatan = kec;

    var hasil = S.daftarSemua.filter(function (u) {
      if (r && String(u.role || '').toUpperCase() !== r) return false;
      if (kec && String(u.kecamatan || '').toUpperCase() !== kec) return false;
      if (!q) return true;

      var matchUser = (u.username || '').toLowerCase().indexOf(q) !== -1;
      var matchNama = (u.namaLengkap || '').toLowerCase().indexOf(q) !== -1;
      var matchKec = (u.kecamatan || '').toLowerCase().indexOf(q) !== -1;
      var matchKel = (u.kelurahan || '').toLowerCase().indexOf(q) !== -1;
      var matchHp = (u.nomorHp || '').toLowerCase().indexOf(q) !== -1;
      var matchJbt = (u.jabatan || '').toLowerCase().indexOf(q) !== -1;

      return matchUser || matchNama || matchKec || matchKel || matchHp || matchJbt;
    });

    S.daftarTerfilter = hasil;
    S.total = hasil.length;

    var selLimit = $('ku-limit');
    var valLimit = selLimit ? selLimit.value : '20';
    S.limit = valLimit === 'all' ? (S.total || 1) : (parseInt(valLimit, 10) || 20);
    S.totalHalaman = Math.max(1, Math.ceil(S.total / S.limit));
    if (S.page > S.totalHalaman) S.page = S.totalHalaman;

    renderTabel();
    renderPaginasi();
  }

  // ---------------------------------------------------------------------------
  // Render Tabel Data Pengguna (Clean, Minimalis, Tanpa Badge/Icon/Inisial)
  // ---------------------------------------------------------------------------
  function renderTabel() {
    var tbody = $('tbody-kelola-user');
    if (!tbody) return;

    var list = S.daftarTerfilter || [];
    if (list.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center py-12 px-4">' +
        '<div class="flex flex-col items-center justify-center text-slate-400">' +
        '<p class="text-sm font-semibold text-slate-700">Tidak ada pengguna yang sesuai</p>' +
        '<p class="text-xs text-slate-400 mt-1 max-w-sm">Periksa kembali kata kunci pencarian atau kombinasi filter role dan kecamatan Anda.</p>' +
        '<button type="button" onclick="window.resetFilterKelolaUser()" class="mt-3 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition">Reset Filter</button>' +
        '</div></td></tr>';
      return;
    }

    var startIndex = (S.page - 1) * S.limit;
    var endIndex = Math.min(startIndex + S.limit, S.total);
    var halamanItems = list.slice(startIndex, endIndex);

    var html = '';
    halamanItems.forEach(function (u, idx) {
      var noUrut = startIndex + idx + 1;
      var waLink = formatNomorHpLink(u.nomorHp);

      // Wilayah penugasan (teks bersih tanpa icon)
      var teksKecamatan = u.kecamatan ? esc(u.kecamatan) : 'Se-Kota Medan';
      var teksKelurahan = u.kelurahan ? 'Kel. ' + esc(u.kelurahan) : '';

      html += '<tr class="hover:bg-sky-50/40 transition-colors duration-150 border-b border-slate-100/90">' +
        // 1. No
        '<td class="w-14 px-3 py-3 text-center font-medium text-xs text-slate-400 align-middle whitespace-nowrap">' + noUrut + '</td>' +

        // 2. Pengguna (Username Bersih Tanpa Avatar, Tanpa Status Dot, Tanpa Tanggal)
        '<td class="px-4 py-3 font-semibold text-slate-800 text-xs whitespace-nowrap align-middle">' +
        esc(u.username) +
        '</td>' +

        // 3. Penanggung Jawab & Jabatan
        '<td class="px-4 py-3 text-xs align-middle min-w-[180px]">' +
        '<div class="font-semibold text-slate-800">' + (u.namaLengkap ? esc(u.namaLengkap) : '<span class="text-slate-400 font-normal italic">-</span>') + '</div>' +
        (u.jabatan ? '<div class="text-[11px] text-slate-500 mt-0.5">' + esc(u.jabatan) + '</div>' : '') +
        '</td>' +

        // 4. Peran / Role (Teks Bersih Tanpa Badge/Pill)
        '<td class="px-4 py-3 text-xs text-slate-700 font-medium whitespace-nowrap align-middle min-w-[150px]">' +
        esc(labelRole(u.role)) +
        '</td>' +

        // 5. Wilayah Penugasan (Teks Bersih Tanpa Ikon Pin Alamat)
        '<td class="px-4 py-3 text-xs text-slate-700 whitespace-nowrap align-middle min-w-[160px]">' +
        '<div class="font-medium text-slate-800">' + teksKecamatan + '</div>' +
        (teksKelurahan ? '<div class="text-[11px] text-slate-500 mt-0.5">' + teksKelurahan + '</div>' : '') +
        '</td>' +

        // 6. Kontak HP (Font Mono Bersih Tanpa Badge Hijau)
        '<td class="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap align-middle min-w-[130px]">' +
        (u.nomorHp ? (
          waLink ?
            '<a href="' + waLink + '" target="_blank" rel="noopener noreferrer" class="hover:text-sky-600 hover:underline transition">' + esc(u.nomorHp) + '</a>' :
            esc(u.nomorHp)
        ) : '<span class="text-slate-400 italic">-</span>') +
        '</td>' +

        // 7. Aksi Cepat (Tombol Ergonomis Senada Kelola Data)
        '<td class="px-4 py-3 text-center whitespace-nowrap align-middle min-w-[210px]">' +
        '<div class="flex items-center justify-center gap-1.5">' +
        '<button type="button" onclick="bukaModalEditUser(\'' + esc(u.username) + '\')" class="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 border border-sky-200/80 rounded-lg font-semibold text-xs transition shadow-2xs" title="Edit Data Pengguna">' + IKON_EDIT + '<span>Edit</span></button>' +
        '<button type="button" onclick="bukaModalResetSandiUser(\'' + esc(u.username) + '\')" class="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 active:scale-95 text-amber-700 border border-amber-200/80 rounded-lg font-semibold text-xs transition shadow-2xs" title="Reset Password">' + IKON_RESET + '<span>Reset</span></button>' +
        '<button type="button" onclick="konfirmasiHapusUser(\'' + esc(u.username) + '\')" class="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 active:scale-95 text-red-700 border border-red-200 rounded-lg font-semibold text-xs transition shadow-2xs" title="Hapus Pengguna">' + IKON_HAPUS + '<span>Hapus</span></button>' +
        '</div>' +
        '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Render Paginasi
  // ---------------------------------------------------------------------------
  function renderPaginasi() {
    var info = $('ku-info-halaman');
    var wadah = $('ku-pagination');
    if (!info || !wadah) return;

    if (S.total === 0) {
      info.textContent = 'Tidak ada data pengguna';
      wadah.innerHTML = '';
      return;
    }

    var awal = (S.page - 1) * S.limit + 1;
    var akhir = Math.min(awal + S.limit - 1, S.total);
    info.textContent = 'Menampilkan ' + awal + ' - ' + akhir + ' dari ' + formatAngka(S.total) + ' pengguna';

    if (S.totalHalaman <= 1) {
      wadah.innerHTML = '';
      return;
    }

    var html = '';
    var BASE = 'px-3 py-1.5 rounded-xl text-xs font-semibold transition min-w-[34px] min-h-[34px] inline-flex items-center justify-center text-center active:scale-95 shadow-2xs';
    var AKTIF = BASE + ' bg-slate-800 text-white shadow-xs';
    var PASIF = BASE + ' bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 cursor-pointer';
    var NONAKTIF = BASE + ' bg-slate-100/60 border border-slate-200/50 text-slate-300 cursor-not-allowed';
    var ikonPrev = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>';
    var ikonNext = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>';

    var disPrev = S.page === 1 ? 'disabled class="' + NONAKTIF + '"' : 'class="' + PASIF + '" onclick="window.gantiHalamanKelolaUser(' + (S.page - 1) + ')"';
    html += '<button type="button" ' + disPrev + ' title="Halaman Sebelumnya" aria-label="Halaman sebelumnya">' + ikonPrev + '</button>';

    var isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    var maxTampil = isMobile ? 3 : 5;
    var startP = Math.max(1, S.page - Math.floor(maxTampil / 2));
    var endP = Math.min(S.totalHalaman, startP + maxTampil - 1);
    if (endP - startP + 1 < maxTampil) startP = Math.max(1, endP - maxTampil + 1);

    if (startP > 1) {
      html += '<button type="button" class="' + PASIF + '" onclick="window.gantiHalamanKelolaUser(1)">1</button>';
      if (startP > 2) html += '<span class="px-1 text-slate-400 text-xs">&hellip;</span>';
    }

    for (var p = startP; p <= endP; p++) {
      if (p === S.page) {
        html += '<button type="button" class="' + AKTIF + '" aria-current="page">' + p + '</button>';
      } else {
        html += '<button type="button" class="' + PASIF + '" onclick="window.gantiHalamanKelolaUser(' + p + ')">' + p + '</button>';
      }
    }

    if (endP < S.totalHalaman) {
      if (endP < S.totalHalaman - 1) html += '<span class="px-1 text-slate-400 text-xs">&hellip;</span>';
      html += '<button type="button" class="' + PASIF + '" onclick="window.gantiHalamanKelolaUser(' + S.totalHalaman + ')">' + S.totalHalaman + '</button>';
    }

    var disNext = S.page === S.totalHalaman ? 'disabled class="' + NONAKTIF + '"' : 'class="' + PASIF + '" onclick="window.gantiHalamanKelolaUser(' + (S.page + 1) + ')"';
    html += '<button type="button" ' + disNext + ' title="Halaman Berikutnya" aria-label="Halaman berikutnya">' + ikonNext + '</button>';

    wadah.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Koordinasi Tab & Navigasi
  // ---------------------------------------------------------------------------
  var TAB_LAIN = ['tab-input', 'tab-rekap', 'tab-tools', 'tab-kelola-data', 'btn-kelola-rumah-ibadah'];
  var PANEL_LAIN = ['panel-input', 'panel-rekap', 'panel-tools', 'panel-kelola-data', 'panel-kelola-ibadah'];

  function nonaktifkanTabKelolaUser() {
    tab.classList.remove('tab-kelola-user-aktif');
    tab.classList.add('bg-indigo-600/80');
    panel.classList.add('hidden');
  }

  function aktifkanTabKelolaUser() {
    tab.classList.remove('bg-indigo-600/80');
    tab.classList.add('tab-kelola-user-aktif');
    panel.classList.remove('hidden');
  }

  window.nonaktifkanTabKelolaUser = nonaktifkanTabKelolaUser;
  window.aktifkanTabKelolaUser = aktifkanTabKelolaUser;

  // Pasang listener saat tab lain diklik agar panel kelola user bersembunyi
  TAB_LAIN.forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('click', function () {
      nonaktifkanTabKelolaUser();
    });
  });

  function bukaTabKelolaUser() {
    if (!adalahUtama()) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Fitur Manajemen Pengguna hanya dapat diakses oleh Admin Utama.', 'gagal');
      return;
    }

    // Nonaktifkan tab & panel lain
    TAB_LAIN.forEach(function (id) {
      var el = $(id);
      if (el && typeof window.setTabTidakAktif === 'function') window.setTabTidakAktif(el);
    });
    if (typeof window.nonaktifkanTabKelolaData === 'function') window.nonaktifkanTabKelolaData();
    if (typeof window.nonaktifkanTabKelolaIbadah === 'function') window.nonaktifkanTabKelolaIbadah();

    PANEL_LAIN.forEach(function (id) {
      var p = $(id);
      if (p) p.classList.add('hidden');
    });

    var refreshLihat = $('btn-refresh-data');
    if (refreshLihat) refreshLihat.classList.add('hidden');

    aktifkanTabKelolaUser();
    try { window.panelAktif = 'kelola_user'; } catch (_e) { }

    if (!S.siap) {
      S.siap = true;
      inisialisasiDropdownFilter();

      // Coba render 0ms instan dari cache sessionStorage jika tersedia
      var cache = bacaCache();
      if (cache && cache.daftar && cache.daftar.length > 0) {
        S.daftarSemua = cache.daftar;
        window.daftarAkunLengkapCache = cache.daftar;
        S.waktu = cache.waktu || 0;
        perbaruiStatCards();
        terapkanFilter(false);

        // Jika cache sudah lewat masa segar TTL, revalidasi di latar belakang
        if (Date.now() - S.waktu >= TTL_SEGAR_MS || S.kotor) {
          muat(true);
        }
      } else {
        muat(false);
      }
    } else {
      if (S.daftarSemua.length > 0) {
        perbaruiStatCards();
        terapkanFilter(false);
        if (S.kotor || Date.now() - S.waktu >= TTL_SEGAR_MS) muat(true);
      } else {
        muat(false);
      }
    }
  }

  window.bukaTabKelolaUser = bukaTabKelolaUser;

  // Sambungkan klik tombol navigasi tab Kelola User
  tab.addEventListener('click', function (e) {
    e.preventDefault();
    bukaTabKelolaUser();
  });

  // ---------------------------------------------------------------------------
  // Inisialisasi Dropdown Filter & Event Form
  // ---------------------------------------------------------------------------
  function inisialisasiDropdownFilter() {
    var selRole = $('filter-role-kelola-user');
    if (selRole) {
      var htmlRole = '<option value="">Semua Role</option>';
      PILIHAN_ROLE.forEach(function (r) {
        htmlRole += '<option value="' + r.nilai + '">' + r.label + '</option>';
      });
      selRole.innerHTML = htmlRole;
      selRole.addEventListener('change', function () { terapkanFilter(true); });
    }

    var selKec = $('filter-kecamatan-kelola-user');
    if (selKec) {
      var htmlKec = '<option value="">Semua Kecamatan</option>';
      DAFTAR_KECAMATAN.forEach(function (k) {
        htmlKec += '<option value="' + k + '">' + k + '</option>';
      });
      selKec.innerHTML = htmlKec;
      selKec.addEventListener('change', function () { terapkanFilter(true); });
    }

    var selLimit = $('ku-limit');
    if (selLimit) {
      selLimit.addEventListener('change', function () { terapkanFilter(true); });
    }

    var inputCari = $('cari-kelola-user');
    if (inputCari) {
      inputCari.addEventListener('input', function () {
        clearTimeout(timerCari);
        timerCari = setTimeout(function () { terapkanFilter(true); }, 200);
      });
    }

    var btnClear = $('ku-btn-clear-search');
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (inputCari) inputCari.value = '';
        terapkanFilter(true);
      });
    }

    var btnReset = $('ku-btn-reset-filter');
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        window.resetFilterKelolaUser();
      });
    }

    var btnRefresh = $('ku-btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', function () {
        muat(false);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Expose Global Helper
  // ---------------------------------------------------------------------------
  window.resetFilterKelolaUser = function () {
    var c = $('cari-kelola-user'); if (c) c.value = '';
    var r = $('filter-role-kelola-user'); if (r) r.value = '';
    var k = $('filter-kecamatan-kelola-user'); if (k) k.value = '';
    var l = $('ku-limit'); if (l) l.value = '20';
    terapkanFilter(true);
  };

  window.gantiHalamanKelolaUser = function (halaman) {
    if (halaman < 1 || halaman > S.totalHalaman) return;
    S.page = halaman;
    renderTabel();
    renderPaginasi();
    var hasil = $('ku-hasil');
    if (hasil) hasil.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Override fungsi global muatDaftarUserLengkap agar sinkron dengan modul in-page
  window.muatDaftarUserLengkap = function (senyap) {
    muat(senyap);
  };

  window.filterTabelKelolaUser = function () {
    terapkanFilter(true);
  };

  window.renderTabelKelolaUser = function (list) {
    if (Array.isArray(list)) {
      S.daftarSemua = list;
      perbaruiStatCards();
      terapkanFilter(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Realtime Sync Listener (Supabase CDC & Broadcast Bus)
  // ---------------------------------------------------------------------------
  window.addEventListener('djpm:swr-invalidated', function (ev) {
    if (!adalahUtama() || !token()) return;
    var domains = (ev.detail && ev.detail.domains) || [];
    if (domains.indexOf('*') === -1 && domains.indexOf('akun') === -1) return;

    // Jika tab kelola user sedang tidak aktif, tandai kotor dan dimuat saat dibuka
    if (panel.classList.contains('hidden')) {
      S.kotor = true;
      return;
    }

    // Jika sedang membuka modal edit/tambah/reset, tunda agar tidak mengganggu admin
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

  // Listener window focus / device online
  window.addEventListener('djpm:swr-window-focus', function () {
    if (!adalahUtama() || !token()) return;
    if (panel.classList.contains('hidden') || document.hidden || sedangBukaModal()) return;
    if (S.kotor || Date.now() - S.waktu >= TTL_SEGAR_MS) {
      muat(true);
    }
  });

  // Listener resize untuk adaptasi paginasi mobile/desktop saat rotasi layar
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
