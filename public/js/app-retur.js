/**
 * public/js/app-retur.js
 * Modul Retur Pembayaran terintegrasi (Fase 1: BACA SAJA) -- pengganti dashboard aplikasi Retur lama.
 * Memakai sesi login Input (tanpa login terpisah). Hak akses baris dijaga di server
 * (supabase/functions/api/domains/retur.ts); tampilan ini hanya merender apa yang dikembalikan server.
 * Sementara masa pengembangan tab ini hanya tampil untuk Admin Utama (kelas `utama-show`);
 * tombol "Retur & Kematian" lama tetap mengarah ke aplikasi Retur lama sampai go-live.
 */
(function () {
  'use strict';

  var tab = document.getElementById('tab-retur');
  var panel = document.getElementById('panel-retur');
  if (!tab || !panel) return;

  var DAFTAR_TAHUN = ['2027', '2026'];
  var SINGKAT_BULAN = { JANUARI: 'Jan', FEBRUARI: 'Feb', MARET: 'Mar', APRIL: 'Apr', MEI: 'Mei', JUNI: 'Jun', JULI: 'Jul', AGUSTUS: 'Agu', SEPTEMBER: 'Sep', OKTOBER: 'Okt', NOVEMBER: 'Nov', DESEMBER: 'Des' };

  var S = {
    siap: false,
    tahun: '2027',
    ringkasan: null,
    bulanAktif: '',
    rincian: [],
    filterStatus: '',
    filterLayanan: '',
    seqRingkasan: 0,
    seqRincian: 0,
    seqCari: 0
  };

  function $(id) { return document.getElementById(id); }
  function esc(val) {
    if (typeof window.esc === 'function') return window.esc(val);
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function token() {
    return (typeof dataPengguna !== 'undefined' && dataPengguna && dataPengguna.token) || '';
  }
  function galat(err) {
    return typeof pesanErrorRamah === 'function' ? pesanErrorRamah(err) : String(err && err.message || err || 'Terjadi kesalahan.');
  }
  function toast(pesan, jenis) {
    if (typeof tampilkanToast === 'function') tampilkanToast(pesan, jenis || 'info');
  }
  function angka(n) { return Number(n || 0).toLocaleString('id-ID'); }

  // ---------------------------------------------------------------------------
  // Status -> lencana warna
  // ---------------------------------------------------------------------------
  function kelasStatus(teks) {
    var t = String(teks || '');
    if (t === 'SUDAH DIBAYARKAN') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (t === 'PROSES PEMBAYARAN') return 'bg-sky-50 text-sky-700 border-sky-200';
    if (t.indexOf('KENDALA') === 0) return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  function lencana(teks) {
    return '<span class="inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ' + kelasStatus(teks) + '">' + esc(teks) + '</span>';
  }

  // ---------------------------------------------------------------------------
  // Kerangka halaman
  // ---------------------------------------------------------------------------
  function renderKerangka() {
    var opsiTahun = DAFTAR_TAHUN.map(function (t) {
      return '<option value="' + t + '"' + (t === S.tahun ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    panel.innerHTML =
      '<div class="flex flex-col gap-3 mb-5 border-b border-slate-100 pb-4">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">' +
          '<div>' +
            '<h2 class="text-base sm:text-lg font-bold text-slate-800">Retur Pembayaran</h2>' +
            '<p class="text-xs text-slate-500">Ringkasan retur per bulan. Menu ini sedang dalam tahap uji (hanya terlihat oleh Admin Utama).</p>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label for="rt-tahun" class="text-xs font-semibold text-slate-600">Tahun</label>' +
            '<select id="rt-tahun" class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">' + opsiTahun + '</select>' +
            '<button id="rt-muat-ulang" type="button" class="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">Muat ulang</button>' +
          '</div>' +
        '</div>' +
        '<form id="rt-form-cari" class="flex flex-col sm:flex-row gap-2">' +
          '<input id="rt-cari" type="search" autocomplete="off" placeholder="Cari NIK atau nama (minimal 3 karakter)" class="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" />' +
          '<button type="submit" class="h-10 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700">Cari</button>' +
          '<button id="rt-hapus-cari" type="button" class="hidden h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">Tutup hasil</button>' +
        '</form>' +
      '</div>' +
      '<div id="rt-hasil-cari" class="hidden mb-6"></div>' +
      '<div id="rt-kartu" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-6"></div>' +
      '<div id="rt-rincian"></div>';

    $('rt-tahun').addEventListener('change', function (e) {
      S.tahun = e.target.value;
      S.bulanAktif = '';
      S.rincian = [];
      tutupHasilCari();
      $('rt-rincian').innerHTML = '';
      muatRingkasan();
    });
    $('rt-muat-ulang').addEventListener('click', function () {
      muatRingkasan();
      if (S.bulanAktif) bukaBulan(S.bulanAktif);
    });
    $('rt-form-cari').addEventListener('submit', function (e) {
      e.preventDefault();
      jalankanCari($('rt-cari').value);
    });
    $('rt-hapus-cari').addEventListener('click', function () {
      $('rt-cari').value = '';
      tutupHasilCari();
    });
    $('rt-kartu').addEventListener('click', function (e) {
      var kartu = e.target.closest('[data-bulan]');
      if (kartu) bukaBulan(kartu.getAttribute('data-bulan'));
    });
  }

  // ---------------------------------------------------------------------------
  // Ringkasan per bulan
  // ---------------------------------------------------------------------------
  function muatRingkasan() {
    var wadah = $('rt-kartu');
    if (!wadah) return;
    var seq = ++S.seqRingkasan;
    wadah.innerHTML = '<p class="col-span-full text-sm text-slate-500">Memuat ringkasan...</p>';
    google.script.run
      .withSuccessHandler(function (res) {
        if (seq !== S.seqRingkasan) return; // jawaban usang (tahun sudah diganti)
        if (!res || !res.sukses) {
          wadah.innerHTML = '<p class="col-span-full text-sm text-red-600">' + esc((res && res.pesan) || 'Gagal memuat ringkasan.') + '</p>';
          return;
        }
        S.ringkasan = res.bulan;
        renderKartu();
      })
      .withFailureHandler(function (err) {
        if (seq !== S.seqRingkasan) return;
        wadah.innerHTML = '<p class="col-span-full text-sm text-red-600">' + esc(galat(err)) + '</p>';
      })
      .returRingkasan(token(), Number(S.tahun));
  }

  function renderKartu() {
    var wadah = $('rt-kartu');
    if (!wadah || !S.ringkasan) return;
    var adaData = S.ringkasan.some(function (b) { return b.total > 0; });
    var html = S.ringkasan.map(function (b) {
      var aktif = b.bulan === S.bulanAktif;
      var kosong = b.total === 0;
      return '<button type="button" data-bulan="' + esc(b.bulan) + '" class="text-left rounded-xl border p-3.5 transition ' +
        (aktif ? 'border-slate-800 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-400') +
        (kosong ? ' opacity-60' : '') + '">' +
        '<div class="flex items-baseline justify-between">' +
          '<span class="text-sm font-bold text-slate-800">' + esc(b.bulan) + '</span>' +
          '<span class="text-xs text-slate-500">' + angka(b.total) + ' retur</span>' +
        '</div>' +
        '<div class="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-emerald-500" style="width:' + Math.min(100, b.persenRealisasi) + '%"></div></div>' +
        '<div class="mt-1 text-[11px] text-slate-500">Realisasi ' + esc(b.persenRealisasi) + '%</div>' +
        '<div class="mt-2 flex flex-wrap gap-1 text-[11px]">' +
          '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Dibayar ' + angka(b.sudahDibayarkan) + '</span>' +
          '<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">Proses ' + angka(b.proses) + '</span>' +
          '<span class="px-1.5 py-0.5 rounded bg-red-50 text-red-700">Kendala ' + angka(b.kendala) + '</span>' +
          '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Belum ' + angka(b.belum) + '</span>' +
        '</div>' +
      '</button>';
    }).join('');
    if (!adaData) {
      html = '<p class="col-span-full text-sm text-slate-500 mb-1">Belum ada data retur untuk tahun ' + esc(S.tahun) + '.</p>' + html;
    }
    wadah.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Rincian satu bulan
  // ---------------------------------------------------------------------------
  function bukaBulan(bulan) {
    S.bulanAktif = bulan;
    S.filterStatus = '';
    S.filterLayanan = '';
    renderKartu();
    var wadah = $('rt-rincian');
    if (!wadah) return;
    var seq = ++S.seqRincian;
    wadah.innerHTML = '<p class="text-sm text-slate-500">Memuat rincian ' + esc(bulan) + '...</p>';
    google.script.run
      .withSuccessHandler(function (res) {
        if (seq !== S.seqRincian) return;
        if (!res || !res.sukses) {
          wadah.innerHTML = '<p class="text-sm text-red-600">' + esc((res && res.pesan) || 'Gagal memuat rincian.') + '</p>';
          return;
        }
        S.rincian = res.rows || [];
        renderRincian();
      })
      .withFailureHandler(function (err) {
        if (seq !== S.seqRincian) return;
        wadah.innerHTML = '<p class="text-sm text-red-600">' + esc(galat(err)) + '</p>';
      })
      .returDaftarBulan(token(), Number(S.tahun), bulan);
  }

  function unik(arr) {
    var seen = {};
    return arr.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }).sort();
  }

  function renderRincian() {
    var wadah = $('rt-rincian');
    if (!wadah) return;
    var statusUnik = unik(S.rincian.map(function (r) { return r.statusTampil; }));
    var layananUnik = unik(S.rincian.map(function (r) { return r.layanan; }));
    var tampil = S.rincian.filter(function (r) {
      return (!S.filterStatus || r.statusTampil === S.filterStatus) && (!S.filterLayanan || r.layanan === S.filterLayanan);
    });

    var opsi = function (daftar, terpilih, semua) {
      return '<option value="">' + semua + '</option>' + daftar.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === terpilih ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    };

    var baris = tampil.map(function (r, i) {
      return '<tr class="border-t border-slate-100">' +
        '<td class="px-3 py-2 text-slate-500">' + (i + 1) + '</td>' +
        '<td class="px-3 py-2 font-medium text-slate-800">' + esc(r.namaRekening) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs">' + esc(r.nik) + '</td>' +
        '<td class="px-3 py-2">' + esc(r.layanan) + '</td>' +
        '<td class="px-3 py-2">' + esc(r.kecamatan) + '</td>' +
        '<td class="px-3 py-2">' + esc(r.kelurahan) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs">' + esc(r.nomorRekening) + '</td>' +
        '<td class="px-3 py-2">' + lencana(r.statusTampil) + '</td>' +
        '<td class="px-3 py-2 text-center">' + (r.nomorPerbaikan == null ? '-' : esc(r.nomorPerbaikan)) + '</td>' +
      '</tr>';
    }).join('');

    wadah.innerHTML =
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">' +
        '<h3 class="text-sm font-bold text-slate-800">Rincian ' + esc(S.bulanAktif) + ' ' + esc(S.tahun) + ' <span class="font-normal text-slate-500">(' + angka(tampil.length) + ' dari ' + angka(S.rincian.length) + ')</span></h3>' +
        '<div class="flex flex-wrap gap-2">' +
          '<select id="rt-f-layanan" class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs">' + opsi(layananUnik, S.filterLayanan, 'Semua layanan') + '</select>' +
          '<select id="rt-f-status" class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs">' + opsi(statusUnik, S.filterStatus, 'Semua status') + '</select>' +
        '</div>' +
      '</div>' +
      (S.rincian.length === 0
        ? '<p class="text-sm text-slate-500">Tidak ada data retur untuk bulan ini pada akses Anda.</p>'
        : '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="min-w-full text-sm">' +
            '<thead class="bg-slate-50 text-left text-xs font-semibold text-slate-600"><tr>' +
              '<th class="px-3 py-2">No</th><th class="px-3 py-2">Nama pada rekening</th><th class="px-3 py-2">NIK</th><th class="px-3 py-2">Layanan</th>' +
              '<th class="px-3 py-2">Kecamatan</th><th class="px-3 py-2">Kelurahan</th><th class="px-3 py-2">No. rekening</th><th class="px-3 py-2">Status</th><th class="px-3 py-2 text-center">Perbaikan ke-</th>' +
            '</tr></thead><tbody>' + baris + '</tbody></table></div>');

    var fl = $('rt-f-layanan'), fs = $('rt-f-status');
    if (fl) fl.addEventListener('change', function (e) { S.filterLayanan = e.target.value; renderRincian(); });
    if (fs) fs.addEventListener('change', function (e) { S.filterStatus = e.target.value; renderRincian(); });
  }

  // ---------------------------------------------------------------------------
  // Pencarian NIK / nama
  // ---------------------------------------------------------------------------
  function tutupHasilCari() {
    S.seqCari++;
    var h = $('rt-hasil-cari'), b = $('rt-hapus-cari');
    if (h) { h.classList.add('hidden'); h.innerHTML = ''; }
    if (b) b.classList.add('hidden');
  }

  function jalankanCari(kata) {
    kata = String(kata || '').trim();
    if (kata.length < 3) { toast('Isi minimal 3 karakter NIK atau nama.', 'gagal'); return; }
    var h = $('rt-hasil-cari');
    if (!h) return;
    var seq = ++S.seqCari;
    h.classList.remove('hidden');
    $('rt-hapus-cari').classList.remove('hidden');
    h.innerHTML = '<p class="text-sm text-slate-500">Mencari...</p>';
    google.script.run
      .withSuccessHandler(function (res) {
        if (seq !== S.seqCari) return;
        if (!res || !res.sukses) {
          h.innerHTML = '<p class="text-sm text-red-600">' + esc((res && res.pesan) || 'Pencarian gagal.') + '</p>';
          return;
        }
        renderHasilCari(res, kata);
      })
      .withFailureHandler(function (err) {
        if (seq !== S.seqCari) return;
        h.innerHTML = '<p class="text-sm text-red-600">' + esc(galat(err)) + '</p>';
      })
      .returCari(token(), Number(S.tahun), kata);
  }

  function renderRiwayat(daftar) {
    if (!daftar || !daftar.length) return '<p class="text-xs text-slate-400">Belum ada riwayat proses.</p>';
    return '<ul class="text-xs text-slate-600 space-y-0.5">' + daftar.map(function (h) {
      var waktu = h.waktu ? new Date(h.waktu).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return '<li>[' + esc(waktu) + ' - ' + esc(h.oleh || '-') + '] ' + esc(h.aksi) +
        (h.nomorPerbaikan != null ? ' (ke-' + esc(h.nomorPerbaikan) + ')' : '') +
        (h.kendala ? ' - ' + esc(h.kendala) : '') + (h.catatan ? ' - ' + esc(h.catatan) : '') + '</li>';
    }).join('') + '</ul>';
  }

  function renderHasilCari(res, kata) {
    var h = $('rt-hasil-cari');
    var rows = res.rows || [];
    var isi;
    if (!rows.length) {
      isi = '<p class="text-sm text-slate-500">Tidak ditemukan retur untuk "' + esc(kata) + '" pada tahun ' + esc(S.tahun) + ' (sesuai akses Anda).</p>';
    } else {
      isi = rows.map(function (r) {
        return '<div class="rounded-xl border border-slate-200 bg-white p-3.5">' +
          '<div class="flex flex-wrap items-center justify-between gap-2">' +
            '<div><span class="font-semibold text-slate-800">' + esc(r.namaRekening) + '</span> ' +
              '<span class="font-mono text-xs text-slate-500">' + esc(r.nik) + '</span></div>' +
            '<div class="flex items-center gap-2"><span class="text-xs font-semibold text-slate-600">' + esc(r.bulan) + '</span>' + lencana(r.statusTampil) + '</div>' +
          '</div>' +
          '<div class="mt-1 text-xs text-slate-500">' + esc(r.layanan) + ' &middot; ' + esc(r.kecamatan) + ' / ' + esc(r.kelurahan) +
            ' &middot; Rek. ' + esc(r.nomorRekening) + (r.nomorPerbaikan != null ? ' &middot; Perbaikan ke-' + esc(r.nomorPerbaikan) : '') + '</div>' +
          '<div class="mt-2">' + renderRiwayat(r.riwayat) + '</div>' +
        '</div>';
      }).join('');
      if (res.terpotong) isi += '<p class="text-xs text-amber-700">Hasil dibatasi 200 baris pertama. Persempit pencarian dengan nama lengkap atau NIK.</p>';
    }
    h.innerHTML = '<div class="flex items-center justify-between mb-2"><h3 class="text-sm font-bold text-slate-800">Hasil pencarian</h3></div><div class="space-y-2">' + isi + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Koordinasi tab & navigasi (pola sama dengan modul Kelola Ibadah)
  // ---------------------------------------------------------------------------
  var TAB_LAIN = ['tab-input', 'tab-rekap', 'tab-tools', 'tab-kelola-data', 'btn-kelola-user', 'btn-kelola-rumah-ibadah'];
  var PANEL_LAIN = ['panel-input', 'panel-rekap', 'panel-tools', 'panel-kelola-data', 'panel-kelola-user', 'panel-kelola-ibadah'];

  function nonaktifkanTabRetur() {
    tab.classList.remove('tab-retur-aktif');
    tab.classList.add('bg-sky-600/80');
    panel.classList.add('hidden');
  }
  function aktifkanTabRetur() {
    tab.classList.remove('bg-sky-600/80');
    tab.classList.add('tab-retur-aktif');
    panel.classList.remove('hidden');
  }
  window.nonaktifkanTabRetur = nonaktifkanTabRetur;

  TAB_LAIN.forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('click', nonaktifkanTabRetur);
  });

  tab.addEventListener('click', function (e) {
    e.preventDefault();
    if (typeof dataPengguna === 'undefined' || !dataPengguna || String(dataPengguna.role || '').toUpperCase() !== 'UTAMA') {
      toast('Menu Retur masih tahap uji dan hanya untuk Admin Utama.', 'gagal');
      return;
    }
    PANEL_LAIN.forEach(function (id) { var p = $(id); if (p) p.classList.add('hidden'); });
    ['nonaktifkanTabKelolaData', 'nonaktifkanTabKelolaUser', 'nonaktifkanTabKelolaIbadah'].forEach(function (fn) {
      if (typeof window[fn] === 'function') window[fn]();
    });
    ['tab-input', 'tab-rekap', 'tab-tools'].forEach(function (id) {
      if (typeof window.setTabTidakAktif === 'function') window.setTabTidakAktif($(id));
    });
    var refresh = $('btn-refresh-data');
    if (refresh) refresh.classList.add('hidden');
    aktifkanTabRetur();
    try { window.panelAktif = 'retur'; } catch (_e) { }
    if (!S.siap) {
      S.siap = true;
      renderKerangka();
    }
    muatRingkasan();
    if (S.bulanAktif) bukaBulan(S.bulanAktif);
  });
})();
