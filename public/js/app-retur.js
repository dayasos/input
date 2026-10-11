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
    seqCari: 0,
    view: 'ringkasan',
    berkas: null,
    hasilImpor: null,
    seqEkspor: 0
  };

  function $(id) { return document.getElementById(id); }
  function esc(val) {
    if (typeof window.esc === 'function') return window.esc(val);
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function adalahUtama() {
    return typeof dataPengguna !== 'undefined' && !!dataPengguna && String(dataPengguna.role || '').toUpperCase() === 'UTAMA';
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
      '</div>' +
      (adalahUtama()
        ? '<div id="rt-nav" class="flex flex-wrap gap-2 mb-5">' +
            '<button type="button" data-view="ringkasan" class="rt-nav-btn h-9 px-4 rounded-lg text-sm font-semibold border">Ringkasan</button>' +
            '<button type="button" data-view="ekspor" class="rt-nav-btn h-9 px-4 rounded-lg text-sm font-semibold border">Ekspor Data Retur <span class="text-[10px] font-normal opacity-70">(Admin)</span></button>' +
          '</div>'
        : '') +
      '<div id="rt-view-ringkasan">' +
        '<form id="rt-form-cari" class="flex flex-col sm:flex-row gap-2 mb-5">' +
          '<input id="rt-cari" type="search" autocomplete="off" placeholder="Cari NIK atau nama (minimal 3 karakter)" class="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" />' +
          '<button type="submit" class="h-10 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700">Cari</button>' +
          '<button id="rt-hapus-cari" type="button" class="hidden h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">Tutup hasil</button>' +
        '</form>' +
        '<div id="rt-hasil-cari" class="hidden mb-6"></div>' +
        '<div id="rt-kartu" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-6"></div>' +
        '<div id="rt-rincian"></div>' +
      '</div>' +
      '<div id="rt-view-ekspor" class="hidden"></div>';

    var nav = $('rt-nav');
    if (nav) nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b) tampilkanView(b.getAttribute('data-view'));
    });
    tampilkanView('ringkasan');

    $('rt-tahun').addEventListener('change', function (e) {
      S.tahun = e.target.value;
      S.bulanAktif = '';
      S.rincian = [];
      tutupHasilCari();
      $('rt-rincian').innerHTML = '';
      var ve = $('rt-view-ekspor');
      if (ve) { ve.removeAttribute('data-siap'); ve.innerHTML = ''; S.berkas = null; S.hasilImpor = null; S.seqEkspor++; if (S.view === 'ekspor') tampilkanView('ekspor'); }
      muatRingkasan();
    });
    $('rt-muat-ulang').addEventListener('click', function () {
      muatRingkasan();
      if (S.bulanAktif) bukaBulan(S.bulanAktif);
      if (S.view === 'ekspor') muatRiwayatImpor();
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

    // Kolom sesuai tabel data retur: NO | NAMA PADA REKENING | NIK | JK | ALAMAT | LAYANAN | NOMOR REKENING | KECAMATAN | KELURAHAN | NO. KONTAK | STATUS SETELAH PERBAIKAN
    var baris = tampil.map(function (r, i) {
      return '<tr class="border-t border-slate-100 align-top">' +
        '<td class="px-3 py-2 text-slate-500">' + (i + 1) + '</td>' +
        '<td class="px-3 py-2 font-medium text-slate-800">' + esc(r.namaRekening) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(r.nik) + '</td>' +
        '<td class="px-3 py-2 whitespace-nowrap">' + esc(r.jenisKelamin) + '</td>' +
        '<td class="px-3 py-2 min-w-[12rem]">' + esc(r.alamat) + '</td>' +
        '<td class="px-3 py-2">' + esc(r.layanan) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(r.nomorRekening) + '</td>' +
        '<td class="px-3 py-2">' + esc(r.kecamatan) + '</td>' +
        '<td class="px-3 py-2">' + esc(r.kelurahan) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(r.noKontak || '-') + '</td>' +
        '<td class="px-3 py-2 min-w-[14rem]"><span class="inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-normal ' + kelasStatus(r.statusTampil) + '">' + esc(r.statusSetelahPerbaikan || r.statusTampil) + '</span></td>' +
      '</tr>';
    }).join('');

    var th = function (t) { return '<th class="px-3 py-2 whitespace-nowrap">' + t + '</th>'; };
    wadah.innerHTML =
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">' +
        '<h3 class="text-sm font-bold text-slate-800">Data Retur ' + esc(S.bulanAktif) + ' ' + esc(S.tahun) + ' <span class="font-normal text-slate-500">(' + angka(tampil.length) + ' dari ' + angka(S.rincian.length) + ')</span></h3>' +
        '<div class="flex flex-wrap gap-2">' +
          '<select id="rt-f-layanan" class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs">' + opsi(layananUnik, S.filterLayanan, 'Semua layanan') + '</select>' +
          '<select id="rt-f-status" class="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs">' + opsi(statusUnik, S.filterStatus, 'Semua status') + '</select>' +
          (S.rincian.length > 0 ? '<button id="rt-unduh-bulan" type="button" class="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Unduh Excel</button>' : '') +
        '</div>' +
      '</div>' +
      (S.rincian.length === 0
        ? '<p class="text-sm text-slate-500">Tidak ada data retur untuk bulan ini pada akses Anda.</p>'
        : '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="min-w-full text-sm">' +
            '<thead class="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase"><tr>' +
              th('No') + th('Nama pada rekening') + th('NIK') + th('JK') + th('Alamat') + th('Layanan') + th('Nomor rekening') +
              th('Kecamatan') + th('Kelurahan') + th('No. kontak') + th('Status setelah perbaikan') +
            '</tr></thead><tbody>' + baris + '</tbody></table></div>');

    var ub = $('rt-unduh-bulan');
    if (ub) ub.addEventListener('click', function () { unduhExcelBulan(S.tahun, S.bulanAktif, ub); });

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
  // Unduh berkas Excel (hasil dibuat server, dikirim sebagai base64)
  // ---------------------------------------------------------------------------
  function simpanBerkas(base64, namaFile) {
    if (typeof unduhFileBase64 === 'function') unduhFileBase64(base64, namaFile);
    else toast('Fungsi unduh tidak tersedia. Muat ulang halaman.', 'gagal');
  }

  function unduhDariServer(namaAksi, tahun, bulan, tombol) {
    var teksAsli = tombol ? tombol.textContent : '';
    var pulih = function () { if (tombol) { tombol.disabled = false; tombol.textContent = teksAsli; } };
    if (tombol) { tombol.disabled = true; tombol.textContent = 'Menyiapkan...'; }
    google.script.run
      .withSuccessHandler(function (res) {
        pulih();
        if (!res || !res.sukses) { toast((res && res.pesan) || 'Gagal membuat file Excel.', 'gagal'); return; }
        simpanBerkas(res.base64, res.namaFile);
      })
      .withFailureHandler(function (err) { pulih(); toast(galat(err), 'gagal'); })[namaAksi](token(), Number(tahun), bulan);
  }
  function unduhExcelBulan(tahun, bulan, tombol) { unduhDariServer('returUnduhExcelBulan', tahun, bulan, tombol); }
  function unduhExcelTidakDitemukan(tahun, bulan, tombol) { unduhDariServer('returUnduhExcelTidakDitemukan', tahun, bulan, tombol); }

  // ---------------------------------------------------------------------------
  // Halaman admin "Ekspor Data Retur" (khusus Admin Utama)
  // Unggah Excel rekening retur dari bank -> pratinjau -> simpan -> tabel data retur & rekening tidak ditemukan.
  // ---------------------------------------------------------------------------
  var MAKS_BERKAS = 3 * 1024 * 1024;

  function chip(label, nilai, kelas) {
    return '<div class="rounded-lg border px-3 py-2 ' + (kelas || 'border-slate-200 bg-white') + '"><div class="text-[11px] text-slate-500">' + esc(label) + '</div><div class="text-base font-bold text-slate-800">' + esc(nilai) + '</div></div>';
  }

  function renderEkspor() {
    var v = $('rt-view-ekspor');
    if (!v) return;
    v.innerHTML =
      '<div class="rounded-xl border border-slate-200 bg-white p-4 mb-5">' +
        '<h3 class="text-sm font-bold text-slate-800 mb-1">Ekspor Data Retur dari Excel Bank</h3>' +
        '<p class="text-xs text-slate-500 mb-3">Unggah Excel daftar rekening yang retur. Sistem mencocokkan nomor rekening ke Data Detail penerima, lalu membuat tabel data retur bulan itu. Anda bisa melihat pratinjau dulu sebelum menyimpan.</p>' +
        '<div class="flex flex-col lg:flex-row gap-4">' +
          '<div class="shrink-0">' +
            '<div class="text-[11px] font-semibold text-slate-600 mb-1">Format file yang diterima</div>' +
            '<table class="text-xs border border-slate-300 bg-white"><tbody>' +
              '<tr><td class="border border-slate-300 px-3 py-1 text-center font-semibold">AGUSTUS</td><td class="border border-slate-300 px-3 py-1 text-slate-400">&nbsp;</td></tr>' +
              '<tr><td class="border border-slate-300 px-3 py-1">&nbsp;</td><td class="border border-slate-300 px-3 py-1">&nbsp;</td></tr>' +
              '<tr><td class="border border-slate-300 px-3 py-1 text-center font-semibold">NO. REK</td><td class="border border-slate-300 px-3 py-1 font-semibold">NAMA</td></tr>' +
              '<tr><td class="border border-slate-300 px-3 py-1 text-slate-500">1160000000001</td><td class="border border-slate-300 px-3 py-1 text-slate-500">...</td></tr>' +
            '</tbody></table>' +
            '<ul class="mt-2 text-[11px] text-slate-500 list-disc pl-4 space-y-0.5"><li>Sel A1 = nama bulan</li><li>Baris 3 = judul kolom</li><li>Data dimulai baris 4</li><li>Format .xlsx, maksimal 3 MB</li></ul>' +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<label for="rt-berkas" class="block text-xs font-semibold text-slate-600 mb-1">Pilih file Excel</label>' +
            '<input id="rt-berkas" type="file" accept=".xlsx" class="block w-full text-sm file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold" />' +
            '<div class="mt-3 flex flex-wrap gap-2">' +
              '<button id="rt-baca" type="button" class="h-10 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold">Baca &amp; Pratinjau</button>' +
            '</div>' +
            '<p class="mt-2 text-xs text-slate-500">Tahun data penerima yang dicocokkan: <b>' + esc(S.tahun) + '</b> (ubah di pilihan Tahun di atas).</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="rt-pratinjau" class="mb-5"></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4">' +
        '<h3 class="text-sm font-bold text-slate-800 mb-2">Riwayat unggahan ' + esc(S.tahun) + '</h3>' +
        '<div id="rt-riwayat-impor"><p class="text-sm text-slate-500">Memuat...</p></div>' +
      '</div>';

    $('rt-baca').addEventListener('click', function () { mulaiPratinjau(); });
    muatRiwayatImpor();
  }

  function bacaBerkasBase64(file, selesai) {
    var fr = new FileReader();
    fr.onload = function () {
      var d = String(fr.result || '');
      var i = d.indexOf(',');
      selesai(i >= 0 ? d.slice(i + 1) : '');
    };
    fr.onerror = function () { selesai(''); };
    fr.readAsDataURL(file);
  }

  function mulaiPratinjau() {
    var input = $('rt-berkas');
    var file = input && input.files && input.files[0];
    if (!file) { toast('Pilih file Excel dulu.', 'gagal'); return; }
    if (!/\.xlsx$/i.test(file.name)) { toast('File harus berformat .xlsx.', 'gagal'); return; }
    if (file.size > MAKS_BERKAS) { toast('File terlalu besar (maksimal 3 MB).', 'gagal'); return; }
    var btn = $('rt-baca');
    btn.disabled = true; btn.textContent = 'Membaca...';
    bacaBerkasBase64(file, function (b64) {
      if (!b64) { btn.disabled = false; btn.textContent = 'Baca & Pratinjau'; toast('Gagal membaca file.', 'gagal'); return; }
      S.berkas = { nama: file.name, base64: b64 };
      jalankanImpor(false, function () { btn.disabled = false; btn.textContent = 'Baca & Pratinjau'; });
    });
  }

  function jalankanImpor(simpan, selesai) {
    var seq = ++S.seqEkspor;
    var area = $('rt-pratinjau');
    if (!simpan && area) area.innerHTML = '<p class="text-sm text-slate-500">Membaca dan mencocokkan rekening...</p>';
    google.script.run
      .withSuccessHandler(function (res) {
        if (selesai) selesai();
        if (seq !== S.seqEkspor) return;
        if (!res || !res.sukses) {
          if (area) area.innerHTML = '<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">' + esc((res && res.pesan) || 'Gagal memproses file.') + '</div>';
          return;
        }
        S.hasilImpor = res;
        renderPratinjau(res);
        if (res.tersimpan) {
          toast(res.pesan || 'Tersimpan.', 'sukses');
          muatRiwayatImpor();
          muatRingkasan();
        }
      })
      .withFailureHandler(function (err) {
        if (selesai) selesai();
        if (seq !== S.seqEkspor) return;
        if (area) area.innerHTML = '<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">' + esc(galat(err)) + '</div>';
      })
      .returImporBank(token(), Number(S.tahun), S.berkas.base64, S.berkas.nama, !!simpan);
  }

  function renderPratinjau(res) {
    var area = $('rt-pratinjau');
    if (!area) return;
    var r = res.ringkasan;
    var sudahSimpan = !!res.tersimpan;
    var chips =
      chip('Bulan', res.bulan + ' ' + res.tahun) + chip('Baris dibaca', angka(r.barisDibaca)) +
      chip('Cocok', angka(r.cocok), 'border-emerald-200 bg-emerald-50') +
      chip('Tidak ditemukan', angka(r.tidakDitemukan), r.tidakDitemukan ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white') +
      chip('Sudah tersimpan', angka(r.sudahAdaSebelumnya)) + chip('Data baru', angka(r.barisBaru), r.barisBaru ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white');

    var catatan = [];
    (res.peringatan || []).forEach(function (p) { catatan.push(p); });
    if (r.duplikatDalamFile) catatan.push(angka(r.duplikatDalamFile) + ' nomor rekening muncul lebih dari sekali di file (hanya dihitung sekali).');
    if (r.rekeningGanda) catatan.push(angka(r.rekeningGanda) + ' nomor rekening dimiliki lebih dari satu penerima di Data Detail (diambil yang pertama). Periksa data penerima.');
    if (r.penerimaNonAktif) catatan.push(angka(r.penerimaNonAktif) + ' penerima yang cocok berstatus tidak aktif (ditandai kuning pada tabel).');

    var baris = (res.cocok || []).map(function (c) {
      var aktif = /AKTIF/i.test(c.statusPenerima || '') && !/TIDAK/i.test(c.statusPenerima || '');
      return '<tr class="border-t border-slate-100 align-top ' + (aktif ? '' : 'bg-amber-50') + '">' +
        '<td class="px-3 py-2 text-slate-500">' + esc(c.no) + '</td>' +
        '<td class="px-3 py-2 font-medium text-slate-800">' + esc(c.namaRekening) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(c.nik) + '</td>' +
        '<td class="px-3 py-2 whitespace-nowrap">' + esc(c.jenisKelamin) + '</td>' +
        '<td class="px-3 py-2 min-w-[12rem]">' + esc(c.alamat) + '</td>' +
        '<td class="px-3 py-2">' + esc(c.layanan) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(c.nomorRekening) + '</td>' +
        '<td class="px-3 py-2">' + esc(c.kecamatan) + '</td>' +
        '<td class="px-3 py-2">' + esc(c.kelurahan) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">' + esc(c.noKontak) + '</td>' +
        '<td class="px-3 py-2 whitespace-nowrap">' + (aktif ? '<span class="text-emerald-700 text-xs font-semibold">AKTIF</span>' : '<span class="text-amber-700 text-xs font-semibold">' + esc(c.statusPenerima || '-') + '</span>') + '</td>' +
        '<td class="px-3 py-2 whitespace-nowrap text-xs">' + (c.sudahAda ? '<span class="text-slate-500">sudah tersimpan</span>' : '<span class="text-sky-700 font-semibold">baru</span>') + '</td>' +
      '</tr>';
    }).join('');
    var th = function (t) { return '<th class="px-3 py-2 whitespace-nowrap">' + t + '</th>'; };

    var gagalBaris = (res.tidakDitemukan || []).map(function (g) {
      return '<tr class="border-t border-slate-100"><td class="px-3 py-2 text-slate-500">' + esc(g.no) + '</td><td class="px-3 py-2">' + esc(g.nama) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs">' + esc(g.nomorRekening) + '</td><td class="px-3 py-2 text-red-700 text-xs">' + esc(g.keterangan) + '</td></tr>';
    }).join('');

    var aksi = sudahSimpan
      ? '<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 mb-3 text-sm text-emerald-800">' + esc(res.pesan || 'Tersimpan.') + '</div>' +
        '<div class="flex flex-wrap gap-2 mb-4">' +
          '<button id="rt-lihat-bulan" type="button" class="h-9 px-3 rounded-lg bg-slate-800 text-white text-xs font-semibold">Lihat Data Retur ' + esc(res.bulan) + '</button>' +
          '<button id="rt-unduh-hasil" type="button" class="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold">Unduh Excel Data Retur</button>' +
          (r.tidakDitemukan ? '<button id="rt-unduh-gagal" type="button" class="h-9 px-3 rounded-lg bg-white border border-red-300 text-red-700 text-xs font-semibold">Unduh Rekening Tidak Ditemukan</button>' : '') +
        '</div>'
      : '<div class="flex flex-wrap gap-2 mb-4">' +
          '<button id="rt-simpan" type="button" class="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"' + ((r.barisBaru === 0 && r.tidakDitemukanBaru === 0) ? ' disabled' : '') + '>Simpan ke Data Retur</button>' +
          '<button id="rt-batal" type="button" class="h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Batal</button>' +
          (r.barisBaru === 0 && r.tidakDitemukanBaru === 0 ? '<span class="self-center text-xs text-slate-500">Semua baris pada file ini sudah tersimpan.</span>' : '') +
        '</div>';

    area.innerHTML =
      '<div class="rounded-xl border border-slate-200 bg-white p-4">' +
        '<h3 class="text-sm font-bold text-slate-800 mb-3">' + (sudahSimpan ? 'Hasil penyimpanan' : 'Pratinjau (belum disimpan)') + ' <span class="font-normal text-slate-500">&middot; ' + esc(res.namaFile) + '</span></h3>' +
        '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">' + chips + '</div>' +
        (catatan.length ? '<ul class="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 list-disc pl-6 space-y-0.5">' + catatan.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
        aksi +
        '<h4 class="text-xs font-bold text-slate-700 uppercase mb-1">Data retur (rekening cocok)</h4>' +
        ((res.cocok || []).length
          ? '<div class="overflow-x-auto rounded-xl border border-slate-200 mb-4"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase"><tr>' +
              th('No') + th('Nama pada rekening') + th('NIK') + th('JK') + th('Alamat') + th('Layanan') + th('Nomor rekening') + th('Kecamatan') + th('Kelurahan') + th('No. kontak') + th('Status penerima') + th('Keterangan') +
            '</tr></thead><tbody>' + baris + '</tbody></table></div>'
          : '<p class="text-sm text-slate-500 mb-4">Tidak ada rekening yang cocok.</p>') +
        '<h4 class="text-xs font-bold text-slate-700 uppercase mb-1">Rekening tidak ditemukan</h4>' +
        ((res.tidakDitemukan || []).length
          ? '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="min-w-full text-sm"><thead class="bg-red-50 text-left text-xs font-semibold text-red-800 uppercase"><tr>' +
              th('No') + th('Nama penerima yang retur') + th('Nomor rekening') + th('Keterangan') + '</tr></thead><tbody>' + gagalBaris + '</tbody></table></div>'
          : '<p class="text-sm text-slate-500">Semua rekening ditemukan.</p>') +
      '</div>';

    var simpan = $('rt-simpan'), batal = $('rt-batal');
    if (simpan) simpan.addEventListener('click', function () {
      simpan.disabled = true; simpan.textContent = 'Menyimpan...';
      jalankanImpor(true, function () { /* tampilan diganti oleh renderPratinjau */ });
    });
    if (batal) batal.addEventListener('click', function () {
      S.seqEkspor++; S.berkas = null; S.hasilImpor = null; area.innerHTML = '';
      var inp = $('rt-berkas'); if (inp) inp.value = '';
    });
    var lihat = $('rt-lihat-bulan'), uh = $('rt-unduh-hasil'), ug = $('rt-unduh-gagal');
    if (lihat) lihat.addEventListener('click', function () { tampilkanView('ringkasan'); bukaBulan(res.bulan); });
    if (uh) uh.addEventListener('click', function () { unduhExcelBulan(res.tahun, res.bulan, uh); });
    if (ug) ug.addEventListener('click', function () { unduhExcelTidakDitemukan(res.tahun, res.bulan, ug); });
  }

  function muatRiwayatImpor() {
    var wadah = $('rt-riwayat-impor');
    if (!wadah) return;
    google.script.run
      .withSuccessHandler(function (res) {
        var w = $('rt-riwayat-impor');
        if (!w) return;
        if (!res || !res.sukses) { w.innerHTML = '<p class="text-sm text-red-600">' + esc((res && res.pesan) || 'Gagal memuat riwayat.') + '</p>'; return; }
        if (!res.rows.length) { w.innerHTML = '<p class="text-sm text-slate-500">Belum ada unggahan untuk tahun ' + esc(S.tahun) + '.</p>'; return; }
        var th = function (t) { return '<th class="px-3 py-2 whitespace-nowrap">' + t + '</th>'; };
        w.innerHTML = '<div class="overflow-x-auto rounded-xl border border-slate-200"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase"><tr>' +
          th('Waktu') + th('Bulan') + th('File') + th('Dibaca') + th('Cocok') + th('Tidak cocok') + th('Petugas') + th('Unduh') + '</tr></thead><tbody>' +
          res.rows.map(function (x) {
            var waktu = x.waktu ? new Date(x.waktu).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '';
            return '<tr class="border-t border-slate-100"><td class="px-3 py-2 whitespace-nowrap text-xs">' + esc(waktu) + '</td><td class="px-3 py-2 font-semibold">' + esc(x.bulan) + '</td>' +
              '<td class="px-3 py-2 text-xs">' + esc(x.namaFile) + '</td><td class="px-3 py-2">' + angka(x.jumlahBaris) + '</td><td class="px-3 py-2">' + angka(x.jumlahCocok) + '</td>' +
              '<td class="px-3 py-2">' + angka(x.jumlahTidakCocok) + '</td><td class="px-3 py-2">' + esc(x.oleh) + '</td>' +
              '<td class="px-3 py-2 whitespace-nowrap"><button type="button" data-aksi="bulan" data-bulan="' + esc(x.bulan) + '" class="h-8 px-2 rounded-md border border-slate-300 text-xs font-semibold hover:bg-slate-50">Data retur</button> ' +
              (x.jumlahTidakCocok ? '<button type="button" data-aksi="gagal" data-bulan="' + esc(x.bulan) + '" class="h-8 px-2 rounded-md border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50">Tidak ditemukan</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        w.onclick = function (e) {
          var b = e.target.closest('button[data-aksi]');
          if (!b) return;
          if (b.getAttribute('data-aksi') === 'bulan') unduhExcelBulan(S.tahun, b.getAttribute('data-bulan'), b);
          else unduhExcelTidakDitemukan(S.tahun, b.getAttribute('data-bulan'), b);
        };
      })
      .withFailureHandler(function (err) {
        var w = $('rt-riwayat-impor');
        if (w) w.innerHTML = '<p class="text-sm text-red-600">' + esc(galat(err)) + '</p>';
      })
      .returDaftarImpor(token(), Number(S.tahun));
  }

  // ---------------------------------------------------------------------------
  // Pergantian tampilan di dalam panel Retur: Ringkasan (semua peran) | Ekspor Data Retur (khusus Admin Utama)
  // ---------------------------------------------------------------------------
  function tampilkanView(nama) {
    if (nama === 'ekspor' && !adalahUtama()) nama = 'ringkasan';
    S.view = nama;
    var vr = $('rt-view-ringkasan'), ve = $('rt-view-ekspor');
    if (vr) vr.classList.toggle('hidden', nama !== 'ringkasan');
    if (ve) ve.classList.toggle('hidden', nama !== 'ekspor');
    document.querySelectorAll('#rt-nav .rt-nav-btn').forEach(function (b) {
      var aktif = b.getAttribute('data-view') === nama;
      b.classList.toggle('bg-slate-800', aktif); b.classList.toggle('text-white', aktif); b.classList.toggle('border-slate-800', aktif);
      b.classList.toggle('bg-white', !aktif); b.classList.toggle('text-slate-700', !aktif); b.classList.toggle('border-slate-300', !aktif);
    });
    if (nama === 'ekspor' && ve && !ve.getAttribute('data-siap')) {
      ve.setAttribute('data-siap', '1');
      renderEkspor();
    }
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
