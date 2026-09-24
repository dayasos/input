// DJPM 2027 - Modul Admin & Realtime CDC
// Progres Kuota
let grupProgresKuotaCache = [];
let tabProgresKuotaAktif = "KECAMATAN";

function warnaProgresKuota(persen) {
  if (persen >= 100) return { bar: '#15803d', bg: '#f0fdf4', text: '#15803d' }; // hijau tua
  if (persen >= 75) return { bar: '#22c55e', bg: '#f0fdf4', text: '#16a34a' }; // hijau muda
  if (persen >= 50) return { bar: '#eab308', bg: '#fefce8', text: '#a16207' }; // kuning
  if (persen >= 25) return { bar: '#f97316', bg: '#fff7ed', text: '#c2410c' }; // oranye
  return { bar: '#ef4444', bg: '#fef2f2', text: '#b91c1c' }; // merah
}

function bangunProgresKuotaHtml(grup) {
  if (!grup || grup.length === 0) {
    return '<p class="text-slate-400 italic text-sm text-center py-6">Belum ada data kuota untuk kategori ini.</p>';
  }
  let html = '';
  grup.forEach(function (g) {
    const wh = warnaProgresKuota(g.persenLayanan);
    html += `<div class="mb-6">
      <div class="flex items-center justify-between bg-slate-800 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-t-lg gap-2">
        <span class="text-xs sm:text-sm font-bold tracking-wide">${esc(g.layanan)}</span>
        <span class="text-[11px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full whitespace-nowrap" style="background:${wh.bar};color:#fff;">
          ${g.persenLayanan}% &nbsp;(${g.totalInput}/${g.totalKuota})
        </span>
      </div>
      <div class="border border-t-0 border-slate-200 rounded-b-lg divide-y divide-slate-100">`;
    g.baris.forEach(function (b) {
      const w = warnaProgresKuota(b.persen);
      const kecPendek = b.kecamatan.replace('MEDAN ', '');
      html += `<div class="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5">
        <span class="w-20 sm:w-32 shrink-0 text-xs font-semibold text-slate-700 truncate" title="${esc(kecPendek)}">${esc(kecPendek)}</span>
        <div class="flex-1 h-4 rounded-full overflow-hidden" style="background:${w.bg};border:1px solid ${w.bar}33;">
          <div class="h-full rounded-full" style="width:${Math.min(b.persen, 100)}%;background:${w.bar};"></div>
        </div>
        <span class="w-11 sm:w-14 shrink-0 text-right text-xs font-bold" style="color:${w.text};">${b.persen}%</span>
        <span class="w-14 sm:w-16 shrink-0 text-right text-[10px] sm:text-[11px] text-slate-500">${b.input}/${b.kuota}</span>
      </div>`;
    });
    html += `</div></div>`;
  });
  return html;
}

function renderTabProgresKuota() {
  const aktifCls = 'px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition bg-slate-800 text-white inline-flex items-center gap-1.5';
  const pasifCls = 'px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1.5';
  document.getElementById('tab-progres-kec').className = tabProgresKuotaAktif === "KECAMATAN" ? aktifCls : pasifCls;
  document.getElementById('tab-progres-kem').className = tabProgresKuotaAktif === "KEMENAG" ? aktifCls : pasifCls;

  const listLayananKemenag = (masterLayanan.kemenag || []).map(function (l) { return l.toString().toUpperCase(); });
  const grupFilter = grupProgresKuotaCache.filter(function (g) {
    const isKemenag = listLayananKemenag.indexOf(g.layanan) !== -1;
    return tabProgresKuotaAktif === "KEMENAG" ? isKemenag : !isKemenag;
  });
  document.getElementById('isi-progres-kuota').innerHTML = bangunProgresKuotaHtml(grupFilter);
}

document.getElementById('tab-progres-kec').addEventListener('click', function () {
  tabProgresKuotaAktif = "KECAMATAN";
  renderTabProgresKuota();
});
document.getElementById('tab-progres-kem').addEventListener('click', function () {
  tabProgresKuotaAktif = "KEMENAG";
  renderTabProgresKuota();
});

function muatProgresKuota() {
  const isi = document.getElementById('isi-progres-kuota');
  isi.innerHTML = `<div class="flex flex-col items-center justify-center py-10 gap-3"><div class="loader"></div><p class="text-sm text-slate-500 animate-pulse">Menghitung progres kuota...</p></div>`;
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) { isi.innerHTML = `<p class="text-red-500 text-sm text-center py-6">Gagal memuat: ${res ? esc(res.pesan) : 'tidak diketahui'}</p>`; return; }
      grupProgresKuotaCache = res.grup || [];
      renderTabProgresKuota();
    })
    .withFailureHandler(function (err) { isi.innerHTML = `<p class="text-red-500 text-sm text-center py-6">Error server: ${esc(err.message)}</p>`; })
    .getProgresKuota(dataPengguna.token);
}

document.getElementById('btn-progres-kuota').addEventListener('click', function () {
  if (!pastikanLogin()) return;
  document.getElementById('modal-progres-kuota').classList.remove('hidden');
  tabProgresKuotaAktif = "KECAMATAN";
  muatProgresKuota();
});

// Kelola Kuota
let daftarKuotaCache = [];
let dropdownKuotaSudahDiisi = false;

function isiDropdownFormKuota() {
  if (dropdownKuotaSudahDiisi) return;
  const selKec = document.getElementById('kk-kecamatan');
  const selLay = document.getElementById('kk-layanan');
  if (!selKec || !selLay) return;

  DAFTAR_KECAMATAN_MEDAN.forEach(function (k) {
    const o = document.createElement('option'); o.value = k; o.text = k; selKec.appendChild(o);
  });

  const daftarLayanan = [].concat(masterLayanan.kecamatan || [], masterLayanan.kemenag || [])
    .map(function (l) { return l.toString().trim().toUpperCase(); })
    .filter(function (l, i, arr) { return l && arr.indexOf(l) === i; })
    .sort();
  daftarLayanan.forEach(function (l) {
    const o = document.createElement('option'); o.value = l; o.text = l; selLay.appendChild(o);
  });

  dropdownKuotaSudahDiisi = true;
}

function renderTabelKuota(filterTeks) {
  const tbody = document.getElementById('kk-tabel-body');
  if (!tbody) return;
  const cari = (filterTeks || '').toUpperCase().trim();
  // Simpan indeks asli sebelum filter (bukan daftarKuotaCache.indexOf(item) di dalam .map(),
  // yang jadi O(n^2) -- tiap baris hasil filter melakukan scan ulang seluruh cache).
  const dataSaring = daftarKuotaCache
    .map(function (item, idx) { return { item: item, idx: idx }; })
    .filter(function (entry) {
      if (!cari) return true;
      return entry.item.kecamatan.indexOf(cari) !== -1 || entry.item.layanan.indexOf(cari) !== -1;
    });

  if (dataSaring.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-slate-400 italic">Belum ada data kuota tersimpan.</td></tr>';
    return;
  }

  tbody.innerHTML = dataSaring.map(function (entry) {
    const item = entry.item;
    return `<tr class="border-b border-slate-100 hover:bg-slate-50">
        <td class="p-2">${esc(item.kecamatan)}</td>
        <td class="p-2">${esc(item.layanan)}</td>
        <td class="p-2 text-center font-bold">${item.kuota}</td>
        <td class="p-2 text-center">
          <button type="button" onclick="isiFormEditKuota(${entry.idx})"
            class="bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1 rounded text-[11px] font-semibold">Edit</button>
        </td>
      </tr>`;
  }).join('');
}

function isiFormEditKuota(idx) {
  const item = daftarKuotaCache[idx];
  if (!item) return;
  document.getElementById('kk-kecamatan').value = item.kecamatan;
  document.getElementById('kk-layanan').value = item.layanan;
  document.getElementById('kk-kuota').value = item.kuota;
  document.getElementById('kk-kuota').focus();

  const banner = document.getElementById('kk-mode-edit-banner');
  const label = document.getElementById('kk-mode-edit-label');
  const btnSimpan = document.getElementById('kk-btn-simpan');
  if (label) label.textContent = item.kecamatan + ' — ' + item.layanan;
  if (banner) banner.classList.remove('hidden');
  if (btnSimpan) btnSimpan.textContent = 'Perbarui Kuota';
}

function batalEditKuota() {
  document.getElementById('kk-kecamatan').value = '';
  document.getElementById('kk-layanan').value = '';
  document.getElementById('kk-kuota').value = '';
  const banner = document.getElementById('kk-mode-edit-banner');
  const btnSimpan = document.getElementById('kk-btn-simpan');
  if (banner) banner.classList.add('hidden');
  if (btnSimpan) btnSimpan.textContent = 'Simpan Kuota';
}

function muatDaftarKuota() {
  const tbody = document.getElementById('kk-tabel-body');
  if (tbody) tbody.innerHTML = htmlSkeletonBaris(4, 4);
  google.script.run
    .withSuccessHandler(function (list) {
      daftarKuotaCache = list || [];
      renderTabelKuota(document.getElementById('kk-cari').value);
    })
    .withFailureHandler(function (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-red-500">' + esc(pesanErrorRamah(err)) + '</td></tr>';
    })
    .getSemuaKuota(dataPengguna.token);
}

document.getElementById('btn-kelola-kuota').addEventListener('click', function () {
  if (!pastikanLogin()) return;
  isiDropdownFormKuota();
  batalEditKuota();
  document.getElementById('kk-cari').value = '';
  document.getElementById('modal-kelola-kuota').classList.remove('hidden');
  muatDaftarKuota();
});

document.getElementById('kk-cari').addEventListener('input', function (e) {
  renderTabelKuota(e.target.value);
});

// Cegah admin tanpa sadar menimpa kuota yang sudah ada: kalau kombinasi Kecamatan+Layanan
// yang baru saja dipilih manual (bukan lewat tombol Edit di tabel) ternyata SUDAH punya
// baris kuota, otomatis masuk "Mode Ubah" dan isi field Jumlah Kuota dengan nilai lama --
// supaya kelihatan jelas ini akan MENGUBAH, bukan menambah baris baru.
function sinkronFormKuotaDenganPilihan() {
  const kec = document.getElementById('kk-kecamatan').value;
  const lay = document.getElementById('kk-layanan').value;
  if (!kec || !lay) return;

  const idx = daftarKuotaCache.findIndex(function (item) { return item.kecamatan === kec && item.layanan === lay; });
  if (idx !== -1) {
    isiFormEditKuota(idx);
  } else {
    document.getElementById('kk-kuota').value = '';
    const banner = document.getElementById('kk-mode-edit-banner');
    const btnSimpan = document.getElementById('kk-btn-simpan');
    if (banner) banner.classList.add('hidden');
    if (btnSimpan) btnSimpan.textContent = 'Simpan Kuota';
  }
}
document.getElementById('kk-kecamatan').addEventListener('change', sinkronFormKuotaDenganPilihan);
document.getElementById('kk-layanan').addEventListener('change', sinkronFormKuotaDenganPilihan);

document.getElementById('kk-btn-batal-edit').addEventListener('click', batalEditKuota);

document.getElementById('kk-btn-simpan').addEventListener('click', function () {
  const btn = this;
  const kecamatan = document.getElementById('kk-kecamatan').value;
  const layanan = document.getElementById('kk-layanan').value;
  const kuotaEl = document.getElementById('kk-kuota');
  const kuota = kuotaEl.value;

  if (!kecamatan) { tampilkanToast('Pilih kecamatan dulu.', 'gagal'); return; }
  if (!layanan) { tampilkanToast('Pilih layanan dulu.', 'gagal'); return; }
  if (kuota === '' || Number(kuota) < 0 || !Number.isInteger(Number(kuota))) {
    tampilkanToast('Jumlah kuota wajib diisi angka bulat 0 atau lebih.', 'gagal');
    kuotaEl.focus();
    return;
  }

  setTombolMemuat(btn, 'Menyimpan...');
  google.script.run
    .withSuccessHandler(function (res) {
      pulihkanTombol(btn);
      if (!res || !res.sukses) { tampilkanToast('Gagal: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal', { durasi: 6000 }); return; }
      tampilkanToast(res.pesan, 'sukses');
      batalEditKuota();
      muatDaftarKuota();
    })
    .withFailureHandler(function (err) {
      pulihkanTombol(btn);
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .simpanKuota(dataPengguna.token, kecamatan, layanan, Number(kuota));
});

// Version Check
let versiLokal = null;
let versionTimer = null;

function mulaiVersionCheck() {
  google.script.run
    .withSuccessHandler(function (v) { versiLokal = v; })
    .withFailureHandler(function () { })
    .getVersiAplikasi();
  if (versionTimer) clearInterval(versionTimer);
  versionTimer = setInterval(cekVersiAplikasi, 2 * 60 * 1000);
}

function cekVersiAplikasi() {
  if (!dataPengguna.token) return;
  google.script.run
    .withSuccessHandler(function (versiServer) {
      if (!versiLokal) { versiLokal = versiServer; return; }
      if (versiServer !== versiLokal) tampilkanModalUpdate();
    })
    .withFailureHandler(function () { })
    .getVersiAplikasi();
}

function formSedangDiisi() {
  const form = document.getElementById('form-pembayaran');
  if (!form) return false;
  const inputs = form.querySelectorAll('input[type="text"], input[type="date"], select');
  for (let i = 0; i < inputs.length; i++) {
    const el = inputs[i];
    if (el.readOnly || el.disabled) continue;
    if (el.value && el.value.trim() !== '') return true;
  }
  return false;
}

function tampilkanModalUpdate() {
  const modal = document.getElementById('modal-update-sistem');
  const pesanForm = document.getElementById('update-pesan-form');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (formSedangDiisi()) {
    pesanForm.classList.remove('hidden');
  } else {
    pesanForm.classList.add('hidden');
  }
  document.getElementById('btn-update-ok').onclick = function () {
    location.href = location.href.split('?')[0] + '?t=' + Date.now();
  };
  const btnNanti = document.getElementById('btn-update-nanti');
  if (btnNanti) {
    btnNanti.onclick = function () {
      modal.classList.add('hidden');
    };
  }
}

// Profil Awal
(function () {
  const modal = document.getElementById('modal-profil-awal');
  const btnSimpan = document.getElementById('profil-simpan');
  const elNama = document.getElementById('profil-nama');
  const elHp = document.getElementById('profil-hp');
  const elJabatan = document.getElementById('profil-jabatan');
  const elPesan = document.getElementById('profil-pesan');

  if (elHp) {
    elHp.addEventListener('keydown', function (e) {
      if (!/^[0-9]$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
      }
    });
    elHp.addEventListener('paste', function (e) {
      e.preventDefault();
      const tempel = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      document.execCommand('insertText', false, tempel);
    });
  }

  function tampilPesanProfil(teks, sukses) {
    if (!elPesan) return;
    elPesan.textContent = teks;
    elPesan.classList.remove('hidden', 'text-red-600', 'bg-red-50', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    elPesan.classList.add(sukses ? 'text-emerald-700' : 'text-red-600', sukses ? 'bg-emerald-50' : 'bg-red-50', sukses ? 'border-emerald-200' : 'border-red-200');
  }

  window.bukaMoldalProfilAwal = function (token, role, kecamatan, inputDitutup) {
    modal.classList.remove('hidden');
    if (elNama) elNama.focus();

    if (btnSimpan) btnSimpan.onclick = function () {
      const nama = elNama ? elNama.value.trim() : "";
      const hp = elHp ? elHp.value.trim() : "";
      const jabatan = elJabatan ? elJabatan.value.trim() : "";
      const passBaru = document.getElementById('profil-pass-baru');
      const passKonfirm = document.getElementById('profil-pass-konfirm');
      const pb = passBaru ? passBaru.value.trim() : "";
      const pk = passKonfirm ? passKonfirm.value.trim() : "";
      if (!nama) { tampilPesanProfil("Nama lengkap wajib diisi.", false); return; }
      if (!hp || !hp.startsWith("08") || hp.length < 10) { tampilPesanProfil("Nomor HP tidak valid (min. 10 digit, diawali 08).", false); return; }
      if (!jabatan) { tampilPesanProfil("Jabatan wajib diisi.", false); return; }
      if (!pb || !pk) { tampilPesanProfil("Password baru dan konfirmasi wajib diisi.", false); return; }
      if (pb !== pk) { tampilPesanProfil("Password baru dan konfirmasi tidak sama.", false); return; }
      if (pb.length < 6) { tampilPesanProfil("Password baru minimal 6 karakter.", false); return; }
      if (!/[A-Za-z]/.test(pb) || !/[0-9]/.test(pb)) { tampilPesanProfil("Password baru harus mengandung huruf dan angka.", false); return; }

      btnSimpan.disabled = true; btnSimpan.textContent = "MENYIMPAN...";
      google.script.run
        .withSuccessHandler(function (res) {
          btnSimpan.disabled = false; btnSimpan.textContent = "SIMPAN & LANJUTKAN";
          if (res && res.sukses) {
            modal.classList.add('hidden');
            // Nama baru saja diisi lewat modal ini (blm pernah tersimpan sblmnya, makanya
            // subtitle header masih fallback ke username sejak login) -- perbarui subtitle
            // & sessi lokal seketika, jangan tunggu revalidasi sesi berikutnya (reload/hard
            // refresh) supaya nama langsung tampil sesuai yg baru diinput. Diseragamkan ke UPPER
            // CASE spy sama persis dgn normalisasi yg dilakukan server (simpanProfilUser di
            // akun.ts men-toUpperCase() nama sblm disimpan) -- kalau tidak, subtitle akan tampil
            // huruf besar/kecil sesuai ketikan user dulu, lalu "berubah sendiri" jadi UPPERCASE
            // begitu revalidasi sesi berikutnya jalan, seperti bug/tidak konsisten.
            const namaTersimpan = nama.toUpperCase();
            try {
              const sesiRaw = sessionStorage.getItem('dana_jasa_sesi');
              if (sesiRaw) {
                const sesi = JSON.parse(sesiRaw);
                sesi.namaLengkap = namaTersimpan;
                sessionStorage.setItem('dana_jasa_sesi', JSON.stringify(sesi));
              }
            } catch (_e) { }
            renderAdminSubtitle(namaTersimpan, dataPengguna.kelurahanTerkunci);
            terapkanHakAkses(role, kecamatan, inputDitutup);
            if (typeof mulaiVersionCheck === "function") mulaiVersionCheck();
          } else {
            tampilPesanProfil(res ? res.pesan : "Gagal menyimpan.", false);
          }
        })
        .withFailureHandler(function (err) {
          btnSimpan.disabled = false; btnSimpan.textContent = "SIMPAN & LANJUTKAN";
          tampilPesanProfil("Error: " + (err && err.message ? err.message : err), false);
        })
        .simpanProfilUser(token, nama, hp, jabatan, pb);
    };
  };
})();

// Ubah Profil User
(function () {
  function tampilPesanUbahProfil(teks, sukses) {
    const el = document.getElementById('up-pesan');
    if (!el) return;
    el.textContent = teks;
    el.classList.remove('hidden', 'text-red-600', 'bg-red-50', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    el.classList.add(sukses ? 'text-emerald-700' : 'text-red-600', sukses ? 'bg-emerald-50' : 'bg-red-50', sukses ? 'border-emerald-200' : 'border-red-200');
  }

  function ubahProfil() {
    if (!pastikanLogin()) return;
    const user = document.getElementById('up-user');
    const nama = document.getElementById('up-nama');
    const hp = document.getElementById('up-hp');
    const jabatan = document.getElementById('up-jabatan');
    const btn = document.getElementById('up-simpan');
    const target = user ? user.value : "";
    const n = nama ? nama.value.trim() : "";
    const h = hp ? hp.value.trim() : "";
    const j = jabatan ? jabatan.value.trim() : "";
    if (!target) { tampilPesanUbahProfil("Pilih user dulu.", false); return; }
    if (!n) { tampilPesanUbahProfil("Nama lengkap wajib diisi.", false); return; }
    if (!h || !h.startsWith("08") || h.length < 10) { tampilPesanUbahProfil("Nomor HP tidak valid.", false); return; }
    if (!j) { tampilPesanUbahProfil("Jabatan wajib diisi.", false); return; }
    btn.disabled = true; btn.textContent = "MENYIMPAN...";
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false; btn.textContent = "SIMPAN PROFIL USER";
        tampilPesanUbahProfil(res && res.sukses ? res.pesan : (res ? res.pesan : "Gagal."), !!(res && res.sukses));
      })
      .withFailureHandler(function (err) {
        btn.disabled = false; btn.textContent = "SIMPAN PROFIL USER";
        tampilPesanUbahProfil("Error: " + (err && err.message ? err.message : err), false);
      })
      .ubahProfilUser(dataPengguna.token, target, n, h, j);
  }

  const btnUp = document.getElementById('up-simpan');
  if (btnUp) btnUp.addEventListener('click', ubahProfil);

  const elUpHp = document.getElementById('up-hp');
  if (elUpHp) {
    elUpHp.addEventListener('keydown', function (e) {
      if (!/^[0-9]$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
      }
    });
    elUpHp.addEventListener('paste', function (e) {
      e.preventDefault();
      const tempel = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      document.execCommand('insertText', false, tempel);
    });
  }

  // Isi dropdown up-user dari daftar yang sudah dimuat rs-user (diambil bersama)
  document.addEventListener('daftarUserDimuat', function (e) {
    const sel = document.getElementById('up-user');
    if (!sel || !e.detail) return;
    let html = '<option value="">-- Pilih user --</option>';
    (e.detail || []).forEach(function (u) {
      const ket = u.role === "KECAMATAN" && u.kecamatan ? (u.role + " " + u.kecamatan) : u.role;
      html += '<option value="' + esc(u.username) + '">' + esc(u.username) + ' (' + esc(ket) + ')</option>';
    });
    sel.innerHTML = html;
  });
})();

// Akun Saya
(function () {
  const fab = document.getElementById('fab-ganti-password');
  const modal = document.getElementById('modal-ganti-password');
  const btnSimpan = document.getElementById('gp-simpan');
  const elLama = document.getElementById('gp-lama');
  const elUser = document.getElementById('gp-username');
  const elBaru = document.getElementById('gp-baru');
  const elKonfirm = document.getElementById('gp-konfirm');
  const elPesan = document.getElementById('gp-pesan');

  function tampilPesan(teks, sukses) {
    if (!elPesan) return;
    elPesan.textContent = teks;
    elPesan.classList.remove('hidden', 'text-red-600', 'bg-red-50', 'border', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    if (sukses) {
      elPesan.classList.add('text-emerald-700', 'bg-emerald-50', 'border', 'border-emerald-200');
    } else {
      elPesan.classList.add('text-red-600', 'bg-red-50', 'border', 'border-red-200');
    }
  }

  function bukaModal() {
    if (!pastikanLogin()) return;
    elLama.value = ""; elUser.value = ""; elBaru.value = ""; elKonfirm.value = "";
    if (elPesan) elPesan.classList.add('hidden');

    const resetSection = document.getElementById('gp-reset-section');
    if (resetSection) {
      if (dataPengguna.role === "UTAMA") {
        resetSection.classList.remove('hidden');
        muatDaftarUser();
      } else {
        resetSection.classList.add('hidden');
      }
    }

    const sakelarSection = document.getElementById('gp-sakelar-section');
    if (sakelarSection) {
      if (dataPengguna.role === "UTAMA") {
        sakelarSection.classList.remove('hidden');
        muatStatusSakelar();
      } else {
        sakelarSection.classList.add('hidden');
      }
    }

    modal.classList.remove('hidden');
    elLama.focus();
  }

  function muatDaftarUser() {
    const sel = document.getElementById('rs-user');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Memuat daftar user --</option>';
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.sukses) { sel.innerHTML = '<option value="">-- Gagal memuat --</option>'; return; }
        let html = '<option value="">-- Pilih user --</option>';
        const pilihanSebelumnya = sel.value;
        const saya = String(dataPengguna.username || '').toLowerCase();
        (res.daftar || []).forEach(function (u) {
          // Akun sendiri tidak ditawarkan untuk reset — ganti password sendiri lewat form di atas.
          if (String(u.username || '').toLowerCase() === saya) return;
          const ket = u.role === "KECAMATAN" && u.kecamatan ? (u.role + " " + u.kecamatan) : u.role;
          html += '<option value="' + esc(u.username) + '">' + esc(u.username) + ' (' + esc(ket) + ')</option>';
        });
        sel.innerHTML = html;
        // Handler bisa terpanggil 2x (cache SWR lalu revalidasi) — jangan hilangkan pilihan admin.
        if (pilihanSebelumnya && Array.from(sel.options).some(function (o) { return o.value === pilihanSebelumnya; })) {
          sel.value = pilihanSebelumnya;
        }
        // Isi juga dropdown ubah profil user
        document.dispatchEvent(new CustomEvent('daftarUserDimuat', { detail: res.daftar }));
      })
      .withFailureHandler(function () { sel.innerHTML = '<option value="">-- Gagal memuat --</option>'; })
      .ambilDaftarAkun(dataPengguna.token);
  }

  function tampilPesanReset(teks, sukses) {
    const el = document.getElementById('rs-pesan');
    if (!el) return;
    el.textContent = teks;
    el.classList.remove('hidden', 'text-red-600', 'bg-red-50', 'border', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    el.classList.add(sukses ? 'text-emerald-700' : 'text-red-600', sukses ? 'bg-emerald-50' : 'bg-red-50', 'border', sukses ? 'border-emerald-200' : 'border-red-200');
  }

  function resetUser() {
    if (!pastikanLogin()) return;
    const sel = document.getElementById('rs-user');
    const elPass = document.getElementById('rs-pass');
    const btn = document.getElementById('rs-simpan');
    const target = sel ? sel.value : "";
    const pass = elPass ? elPass.value.trim() : "";

    if (!target) { tampilPesanReset("Pilih user dulu.", false); return; }
    if (pass.length < 6) { tampilPesanReset("Password sementara minimal 6 karakter.", false); return; }
    if (!/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass)) { tampilPesanReset("Harus mengandung huruf dan angka.", false); return; }

    btn.disabled = true; btn.textContent = "MERESET...";
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false; btn.textContent = "RESET PASSWORD USER";
        if (res && res.sukses) { tampilPesanReset(res.pesan, true); if (elPass) elPass.value = ""; }
        else { tampilPesanReset(res ? res.pesan : "Gagal reset.", false); }
      })
      .withFailureHandler(function (err) {
        btn.disabled = false; btn.textContent = "RESET PASSWORD USER";
        tampilPesanReset("Error: " + (err && err.message ? err.message : err), false);
      })
      .resetPasswordUser(dataPengguna.token, target, pass);
  }

  function simpan() {
    if (!pastikanLogin()) return;
    const verif = elLama.value.trim();
    const userBaru = elUser.value.trim();
    const baru = elBaru.value.trim();
    const konfirm = elKonfirm.value.trim();

    const mauGantiUser = userBaru.length > 0;
    const mauGantiPass = baru.length > 0 || konfirm.length > 0;

    if (!verif) { tampilPesan("Password (verifikasi) wajib diisi.", false); return; }
    if (!mauGantiUser && !mauGantiPass) { tampilPesan("Isi username baru dan/atau password baru.", false); return; }
    if (mauGantiUser) {
      if (userBaru.length < 4) { tampilPesan("Username baru minimal 4 karakter.", false); return; }
      if (!/^[A-Za-z0-9_]+$/.test(userBaru)) { tampilPesan("Username baru hanya boleh huruf, angka, dan garis bawah (_).", false); return; }
    }
    if (mauGantiPass) {
      if (!baru || !konfirm) { tampilPesan("Password baru dan konfirmasi wajib diisi.", false); return; }
      if (baru !== konfirm) { tampilPesan("Password baru dan konfirmasi tidak sama.", false); return; }
      if (baru.length < 6) { tampilPesan("Password baru minimal 6 karakter.", false); return; }
      if (!/[A-Za-z]/.test(baru) || !/[0-9]/.test(baru)) { tampilPesan("Password baru harus mengandung huruf dan angka.", false); return; }
    }

    btnSimpan.disabled = true;
    btnSimpan.textContent = "MENYIMPAN...";
    google.script.run
      .withSuccessHandler(function (res) {
        btnSimpan.disabled = false;
        btnSimpan.textContent = "SIMPAN PERUBAHAN";
        if (res && res.sukses) {
          tampilPesan(res.pesan, true);
          elLama.value = ""; elBaru.value = ""; elKonfirm.value = "";
          if (res.usernameBaru) {
            elUser.value = "";
            try { localStorage.setItem('dana_jasa_username', res.usernameBaru); } catch (e) { }
            setTimeout(function () {
              tampilkanPesanModal({
                judul: "Username Berhasil Diperbarui",
                pesan: "Username berhasil diubah menjadi \"" + res.usernameBaru + "\".\nSilakan login kembali dengan username baru Anda.",
                tipe: "success",
                teksTombol: "Login Ulang"
              }).then(function () {
                dataPengguna = { username: "", role: "", kecamatan: "", token: "" };
                location.href = location.href.split('?')[0] + '?t=' + Date.now();
              });
            }, 500);
          }
        } else {
          tampilPesan(res ? res.pesan : "Gagal menyimpan perubahan.", false);
        }
      })
      .withFailureHandler(function (err) {
        btnSimpan.disabled = false;
        btnSimpan.textContent = "SIMPAN PERUBAHAN";
        tampilPesan("Error: " + (err && err.message ? err.message : err), false);
      })
      .ubahAkunSendiri(dataPengguna.token, verif, userBaru, baru, konfirm);
  }

  window.muatDaftarUser = muatDaftarUser;
  if (fab) fab.addEventListener('click', bukaModal);
  if (btnSimpan) btnSimpan.addEventListener('click', simpan);
  if (elKonfirm) elKonfirm.addEventListener('keydown', function (e) { if (e.key === 'Enter') simpan(); });
  const btnReset = document.getElementById('rs-simpan');
  if (btnReset) btnReset.addEventListener('click', resetUser);
})();

// Sakelar Periode Input
(function () {
  function tampilPesanSakelar(teks, sukses) {
    const el = document.getElementById('sakelar-pesan');
    if (!el) return;
    el.textContent = teks;
    el.classList.remove('hidden', 'text-red-600', 'bg-red-50', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    el.classList.add(sukses ? 'text-emerald-700' : 'text-red-600', sukses ? 'bg-emerald-50' : 'bg-red-50', sukses ? 'border-emerald-200' : 'border-red-200');
  }

  window.muatStatusSakelar = function () {
    if (!pastikanLogin()) return;
    if (dataPengguna.role !== "UTAMA") return;

    const wrap = document.getElementById('sakelar-status-wrap');
    const labelEl = document.getElementById('sakelar-status-label');
    const valueEl = document.getElementById('sakelar-status-value');
    const ikonEl = document.getElementById('sakelar-status-ikon');
    const riwayatEl = document.getElementById('sakelar-riwayat');
    const btn = document.getElementById('sakelar-toggle');

    if (wrap) wrap.className = "rounded-xl px-4 py-3 border border-slate-200 bg-slate-50";
    if (labelEl) labelEl.className = "text-[10px] font-semibold uppercase tracking-wider mb-0.5 text-slate-500";
    if (labelEl) labelEl.textContent = "Status Saat Ini";
    if (valueEl) valueEl.textContent = "Memuat...";
    if (ikonEl) ikonEl.textContent = "⏳";
    if (riwayatEl) riwayatEl.classList.add('hidden');
    if (btn) { btn.disabled = true; btn.textContent = "MEMUAT..."; btn.className = "w-full py-2.5 font-bold text-sm rounded-lg shadow transition bg-slate-300 text-slate-500 cursor-wait"; }

    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.sukses) {
          tampilPesanSakelar("Gagal memuat status sakelar.", false);
          if (btn) { btn.disabled = false; btn.textContent = "COBA LAGI"; btn.className = "w-full py-2.5 font-bold text-sm rounded-lg shadow transition bg-slate-500 hover:bg-slate-600 text-white"; }
          return;
        }
        const ditutup = !!res.ditutup;
        renderStatusSakelar(ditutup, res.terakhirUbah || {});
      })
      .withFailureHandler(function () {
        tampilPesanSakelar("Gagal terhubung ke server.", false);
        if (btn) { btn.disabled = false; btn.textContent = "COBA LAGI"; btn.className = "w-full py-2.5 font-bold text-sm rounded-lg shadow transition bg-slate-500 hover:bg-slate-600 text-white"; }
      })
      .ambilStatusDetailSetelan(dataPengguna.token);
  };

  function renderStatusSakelar(ditutup, terakhirUbah) {
    const wrap = document.getElementById('sakelar-status-wrap');
    const labelEl = document.getElementById('sakelar-status-label');
    const valueEl = document.getElementById('sakelar-status-value');
    const ikonEl = document.getElementById('sakelar-status-ikon');
    const riwayatEl = document.getElementById('sakelar-riwayat');
    const btn = document.getElementById('sakelar-toggle');

    if (ditutup) {
      wrap.className = "rounded-xl px-4 py-3 border border-red-200 bg-red-50";
      labelEl.className = "text-[10px] font-semibold uppercase tracking-wider mb-0.5 text-red-600";
      valueEl.className = "text-sm font-bold text-red-900";
      valueEl.textContent = "DITUTUP";
      ikonEl.innerHTML = '<div class="w-10 h-10 rounded-xl bg-red-100 border border-red-200 text-red-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg></div>';
      btn.innerHTML = '<span class="inline-flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg><span>BUKA PERIODE INPUT</span></span>';
      btn.className = "w-full py-2.5 font-bold text-sm rounded-lg shadow transition bg-emerald-600 hover:bg-emerald-700 text-white";
      btn.disabled = false;
      btn.onclick = function () { konfirmasiToggleSakelar(true); };
    } else {
      wrap.className = "rounded-xl px-4 py-3 border border-emerald-200 bg-emerald-50";
      labelEl.className = "text-[10px] font-semibold uppercase tracking-wider mb-0.5 text-emerald-600";
      valueEl.className = "text-sm font-bold text-emerald-900";
      valueEl.textContent = "DIBUKA";
      ikonEl.innerHTML = '<div class="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg></div>';
      btn.innerHTML = '<span class="inline-flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg><span>TUTUP PERIODE INPUT</span></span>';
      btn.className = "w-full py-2.5 font-bold text-sm rounded-lg shadow transition bg-red-600 hover:bg-red-700 text-white";
      btn.disabled = false;
      btn.onclick = function () { konfirmasiToggleSakelar(false); };
    }

    if (terakhirUbah && terakhirUbah.waktu) {
      riwayatEl.classList.remove('hidden');
      riwayatEl.innerHTML = `Perubahan terakhir: <strong>${esc(terakhirUbah.waktu)}</strong> oleh <strong>${esc(terakhirUbah.username)}</strong>`;
    } else {
      riwayatEl.classList.add('hidden');
    }
  }

  function konfirmasiToggleSakelar(buka) {
    const aksi = buka ? "Membuka" : "Menutup";
    const dampak = buka
      ? "Semua admin kecamatan dan kemenag akan bisa mulai menginput dan mengedit data."
      : "Semua admin kecamatan dan kemenag tidak akan bisa menginput atau mengedit data sampai Anda membuka kembali.";

    konfirmasiAksi({
      judul: aksi + " Periode Input Data",
      pesan: "Anda yakin ingin " + aksi.toLowerCase() + " periode input?\n\n" + dampak + "\n\n(Catatan: Admin utama tetap bebas kapan saja).",
      tipe: buka ? "info" : "warning",
      teksBatal: "Batal",
      teksKonfirmasi: "Ya, " + aksi
    }).then(function (setuju) {
      if (!setuju) return;
      const btn = document.getElementById('sakelar-toggle');
      if (btn) { btn.disabled = true; btn.textContent = "⏳ MEMPROSES..."; }

      google.script.run
        .withSuccessHandler(function (res) {
          if (res && res.sukses) {
            let pesanSukses = "Sakelar berhasil diubah. Perubahan langsung berlaku untuk user yang login berikutnya.";
            if (res.cleanup > 0) {
              pesanSukses += " Auto-cleanup: " + res.cleanup + " sakelar khusus yang jadi redundant telah dihapus.";
            }
            tampilPesanSakelar(pesanSukses, true);
            setTimeout(function () {
              muatStatusSakelar();
              inputDitutupGlobal = res.ditutup;
            }, 500);
          } else {
            tampilPesanSakelar(res ? res.pesan : "Gagal mengubah sakelar.", false);
            if (btn) { btn.disabled = false; muatStatusSakelar(); }
          }
        })
        .withFailureHandler(function (err) {
          tampilPesanSakelar("Error: " + (err && err.message ? err.message : err), false);
          if (btn) { btn.disabled = false; muatStatusSakelar(); }
        })
        .setInputKecKem(dataPengguna.token, buka);
    });
  }
})();

// Kelola Akses User
(function () {
  let semuaUser = [];         // cache semua user dari server
  let masterKetutup = false;  // cache status master saat modal terbuka
  let filterAktif = { search: "", role: "", kecamatan: "" };

  function esc(s) {
    return (s == null ? "" : String(s))
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  const btnKelolaUser = document.getElementById('sakelar-kelola-user');
  if (btnKelolaUser) {
    btnKelolaUser.addEventListener('click', function () {
      if (!pastikanLogin()) return;
      if (dataPengguna.role !== "UTAMA") {
        tampilkanToast("Hanya admin utama yang boleh mengelola akses per user.", "gagal");
        return;
      }
      bukaModalKelolaUser();
    });
  }

  function bukaModalKelolaUser() {
    document.getElementById('modal-kelola-akses-user').classList.remove('hidden');
    document.getElementById('ku-loading').classList.remove('hidden');
    document.getElementById('ku-daftar-khusus').classList.add('hidden');
    document.getElementById('ku-daftar-semua').classList.add('hidden');
    document.getElementById('ku-tidak-ada').classList.add('hidden');
    document.getElementById('ku-master-status').textContent = "Memuat...";
    document.getElementById('ku-jumlah-khusus').textContent = "-";

    filterAktif = { search: "", role: "", kecamatan: "" };
    document.getElementById('ku-search').value = "";
    document.getElementById('ku-filter-role').value = "";
    document.getElementById('ku-filter-kecamatan').value = "";

    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('ku-loading').classList.add('hidden');
        if (!res || !res.sukses) {
          tampilkanToast("Gagal memuat daftar user: " + (res && res.pesan ? res.pesan : "Unknown error"), "gagal");
          return;
        }
        semuaUser = res.daftar || [];
        masterKetutup = !!res.masterKetutup;
        document.getElementById('ku-master-status').innerHTML = masterKetutup
          ? '<span class="inline-flex items-center gap-1.5 text-red-700"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg><span>DITUTUP</span></span>'
          : '<span class="inline-flex items-center gap-1.5 text-emerald-700"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg><span>DIBUKA</span></span>';
        document.getElementById('ku-master-status').className = masterKetutup
          ? "text-sm font-bold text-red-700 mt-0.5"
          : "text-sm font-bold text-emerald-700 mt-0.5";
        document.getElementById('ku-jumlah-khusus').textContent = res.jumlahKhusus + " user";
        isiOpsiFilter();
        renderDaftar();
      })
      .withFailureHandler(function (err) {
        document.getElementById('ku-loading').classList.add('hidden');
        tampilkanToast(pesanErrorRamah(err), "gagal");
      })
      .ambilDaftarUserDenganStatus(dataPengguna.token);
  }

  function isiOpsiFilter() {
    const selRole = document.getElementById('ku-filter-role');
    for (let i = selRole.options.length - 1; i >= 2; i--) {
      selRole.remove(i);
    }
    const listKemenag = (masterLayanan.kemenag || []);
    listKemenag.forEach(function (r) {
      const opt = document.createElement('option');
      opt.value = r.toString().toUpperCase();
      opt.textContent = r.toString().toUpperCase();
      selRole.appendChild(opt);
    });

    const selKec = document.getElementById('ku-filter-kecamatan');
    for (let i = selKec.options.length - 1; i >= 1; i--) {
      selKec.remove(i);
    }
    const setKec = {};
    semuaUser.forEach(function (u) {
      if (u.kecamatan) setKec[u.kecamatan] = true;
    });
    Object.keys(setKec).sort().forEach(function (k) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      selKec.appendChild(opt);
    });
  }

  function renderDaftar() {
    const searchLower = filterAktif.search.toLowerCase();
    const daftarKhusus = [];
    const daftarSemua = [];

    semuaUser.forEach(function (u) {
      if (filterAktif.role && u.role !== filterAktif.role) return;
      if (filterAktif.kecamatan && u.kecamatan !== filterAktif.kecamatan) return;
      if (searchLower) {
        const gabungan = [u.username, u.userId, u.nama, u.hp, u.jabatan, u.kecamatan, u.role].join(" ").toLowerCase();
        if (gabungan.indexOf(searchLower) === -1) return;
      }
      if (u.sumber === "KHUSUS") {
        daftarKhusus.push(u);
      } else {
        daftarSemua.push(u);
      }
    });

    const wrapKhusus = document.getElementById('ku-daftar-khusus');
    const listKhusus = document.getElementById('ku-daftar-khusus-list');
    document.getElementById('ku-khusus-count').textContent = daftarKhusus.length;
    if (daftarKhusus.length > 0) {
      wrapKhusus.classList.remove('hidden');
      listKhusus.innerHTML = daftarKhusus.map(renderKartuUser).join("");
    } else {
      wrapKhusus.classList.add('hidden');
      listKhusus.innerHTML = "";
    }

    const wrapSemua = document.getElementById('ku-daftar-semua');
    const listSemua = document.getElementById('ku-daftar-semua-list');
    document.getElementById('ku-semua-count').textContent = daftarSemua.length;
    if (daftarSemua.length > 0) {
      wrapSemua.classList.remove('hidden');
      listSemua.innerHTML = daftarSemua.map(renderKartuUser).join("");
    } else {
      wrapSemua.classList.add('hidden');
      listSemua.innerHTML = "";
    }

    document.getElementById('ku-tidak-ada').classList.toggle('hidden', daftarKhusus.length + daftarSemua.length > 0);
  }

  function renderKartuUser(u) {
    const statusTeks = u.status;
    const sumberTeks = u.sumber === "KHUSUS" ? "Khusus" : "Default (Master)";
    let warnaBadge, warnaBg, ikonSvg;
    if (u.status === "BUKA") {
      warnaBadge = u.sumber === "KHUSUS" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 border border-emerald-300";
      warnaBg = u.sumber === "KHUSUS" ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white";
      ikonSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-current inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>';
    } else {
      warnaBadge = u.sumber === "KHUSUS" ? "bg-red-600 text-white" : "bg-red-50 text-red-700 border border-red-300";
      warnaBg = u.sumber === "KHUSUS" ? "border-red-300 bg-red-50/50" : "border-slate-200 bg-white";
      ikonSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-current inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>';
    }

    const namaTampil = u.nama || u.username;
    const infoKecKemenag = [u.role, u.kecamatan].filter(Boolean).join(" • ");

    return `<div class="border-2 rounded-xl px-3.5 py-3 ${warnaBg} transition" data-user-id="${esc(u.userId)}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="font-bold text-sm text-slate-800 truncate">${esc(namaTampil)}</div>
          <div class="text-[11px] text-slate-500 truncate">@${esc(u.username)}</div>
          <div class="text-[11px] text-slate-600 truncate mt-0.5">${esc(infoKecKemenag)}</div>
          <div class="text-[10px] text-slate-400 truncate mt-0.5 font-mono">ID: ${esc(u.userId || "(kosong)")}</div>
        </div>
        <div class="flex flex-col items-end gap-1.5 shrink-0">
          <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full inline-flex items-center ${warnaBadge}">${ikonSvg}<span>${statusTeks}</span></span>
          <span class="text-[9px] text-slate-500 font-medium">${sumberTeks}</span>
        </div>
      </div>
      <div class="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-3 gap-1.5">
        <button data-aksi="BUKA" data-user-id="${esc(u.userId)}" class="ku-btn-aksi py-1.5 px-2 text-[11px] font-bold rounded-lg transition flex items-center justify-center gap-1 ${u.status === "BUKA" ? "bg-emerald-100 text-emerald-700 cursor-not-allowed opacity-60" : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"}" ${u.status === "BUKA" ? "disabled" : ""}>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-current shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>
          <span>Buka</span>
        </button>
        <button data-aksi="TUTUP" data-user-id="${esc(u.userId)}" class="ku-btn-aksi py-1.5 px-2 text-[11px] font-bold rounded-lg transition flex items-center justify-center gap-1 ${u.status === "TUTUP" ? "bg-red-100 text-red-700 cursor-not-allowed opacity-60" : "bg-red-600 hover:bg-red-700 text-white shadow-xs"}" ${u.status === "TUTUP" ? "disabled" : ""}>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-current shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          <span>Tutup</span>
        </button>
        <button data-aksi="RESET" data-user-id="${esc(u.userId)}" class="ku-btn-aksi py-1.5 px-2 text-[11px] font-bold rounded-lg transition flex items-center justify-center gap-1 ${u.sumber === "MASTER" ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60" : "bg-slate-600 hover:bg-slate-700 text-white shadow-xs"}" ${u.sumber === "MASTER" ? "disabled" : ""}>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-current shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          <span>Reset</span>
        </button>
      </div>
    </div>`;
  }

  document.getElementById('ku-daftar-wrap').addEventListener('click', function (e) {
    const btn = e.target.closest('.ku-btn-aksi');
    if (!btn || btn.disabled) return;
    const aksi = btn.dataset.aksi;
    const userId = btn.dataset.userId;
    if (!userId) {
      tampilkanToast("User ID kosong, tidak bisa mengubah sakelar. Isi kolom User ID di db_admin dulu.", "gagal");
      return;
    }
    eksekusiAksiPerUser(userId, aksi);
  });

  function eksekusiAksiPerUser(userId, aksi) {
    const namaAksi = aksi === "BUKA" ? "Membuka" : (aksi === "TUTUP" ? "Menutup" : "Mereset");
    konfirmasiAksi({
      judul: namaAksi + " Akses Pengguna",
      pesan: "Anda yakin ingin " + namaAksi.toLowerCase() + " akses untuk user ini?\n\nUser ID: " + userId,
      tipe: aksi === "TUTUP" ? "warning" : "info",
      teksBatal: "Batal",
      teksKonfirmasi: "Ya, " + namaAksi
    }).then(function (setuju) {
      if (!setuju) return;
      if (aksi === "RESET") {
        google.script.run
          .withSuccessHandler(function (res) { hasilAksiPerUser(res); })
          .withFailureHandler(function (err) { tampilkanToast(pesanErrorRamah(err), "gagal"); })
          .resetSakelarUserByAdmin(dataPengguna.token, userId);
      } else {
        google.script.run
          .withSuccessHandler(function (res) { hasilAksiPerUser(res); })
          .withFailureHandler(function (err) { tampilkanToast(pesanErrorRamah(err), "gagal"); })
          .setSakelarUserByAdmin(dataPengguna.token, userId, aksi === "BUKA");
      }
    });
  }

  function hasilAksiPerUser(res) {
    if (res && res.sukses) {
      tampilkanToast(res.pesan || "Berhasil.", "sukses");
      bukaModalKelolaUser();
    } else {
      tampilkanToast("Gagal: " + (res && res.pesan ? res.pesan : "Unknown error"), "gagal");
    }
  }

  document.getElementById('ku-search').addEventListener('input', function (e) {
    filterAktif.search = e.target.value.trim();
    renderDaftar();
  });
  document.getElementById('ku-filter-role').addEventListener('change', function (e) {
    filterAktif.role = e.target.value;
    renderDaftar();
  });
  document.getElementById('ku-filter-kecamatan').addEventListener('change', function (e) {
    filterAktif.kecamatan = e.target.value;
    renderDaftar();
  });

  document.getElementById('ku-btn-bulk').addEventListener('click', function () {
    bukaModalBulk();
  });

  // Modal Bulk Kecamatan
  let bkAksiTerpilih = null;

  function bukaModalBulk() {
    document.getElementById('modal-bulk-kecamatan').classList.remove('hidden');
    document.getElementById('bk-preview').classList.add('hidden');
    document.getElementById('bk-pesan').classList.add('hidden');
    document.getElementById('bk-eksekusi').disabled = true;
    bkAksiTerpilih = null;
    document.querySelectorAll('.bk-action-btn').forEach(function (b) { b.classList.remove('ring-4', 'ring-offset-1', 'ring-slate-400'); });

    // Isi dropdown kecamatan dari cache semuaUser
    const selKec = document.getElementById('bk-kecamatan');
    while (selKec.options.length > 1) selKec.remove(1);
    const setKec = {};
    semuaUser.forEach(function (u) {
      const k = u.kecamatan || "(TANPA KECAMATAN)";
      if (!setKec[k]) setKec[k] = 0;
      setKec[k]++;
    });
    Object.keys(setKec).sort(function (a, b) {
      // "(TANPA KECAMATAN)" di paling bawah
      if (a === "(TANPA KECAMATAN)") return 1;
      if (b === "(TANPA KECAMATAN)") return -1;
      return a.localeCompare(b);
    }).forEach(function (k) {
      const opt = document.createElement('option');
      opt.value = k === "(TANPA KECAMATAN)" ? "" : k;
      opt.textContent = k + " (" + setKec[k] + " user)";
      selKec.appendChild(opt);
    });
  }

  document.querySelectorAll('.bk-action-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      bkAksiTerpilih = btn.dataset.action;
      document.querySelectorAll('.bk-action-btn').forEach(function (b) { b.classList.remove('ring-4', 'ring-offset-1', 'ring-slate-400'); });
      btn.classList.add('ring-4', 'ring-offset-1', 'ring-slate-400');
      updatePreviewBulk();
    });
  });

  document.getElementById('bk-kecamatan').addEventListener('change', function () {
    updatePreviewBulk();
  });

  function updatePreviewBulk() {
    const kec = document.getElementById('bk-kecamatan').value;
    const kecLabel = kec || "(TANPA KECAMATAN)";
    const preview = document.getElementById('bk-preview');
    const btnEksekusi = document.getElementById('bk-eksekusi');
    if (!bkAksiTerpilih || !document.getElementById('bk-kecamatan').value && !kec) {
      preview.classList.add('hidden');
      btnEksekusi.disabled = true;
      return;
    }
    const jumlah = semuaUser.filter(function (u) {
      const k = u.kecamatan || "";
      return k === kec;
    }).length;
    if (jumlah === 0) {
      preview.textContent = "Tidak ada user di " + kecLabel + ".";
      preview.classList.remove('hidden');
      btnEksekusi.disabled = true;
      return;
    }
    const namaAksi = bkAksiTerpilih === "BUKA" ? "BUKA" : (bkAksiTerpilih === "TUTUP" ? "TUTUP" : "RESET");
    preview.innerHTML = "Akan <strong>" + namaAksi + "</strong> untuk <strong>" + jumlah + " user</strong> di <strong>" + esc(kecLabel) + "</strong>.";
    preview.classList.remove('hidden');
    btnEksekusi.disabled = false;
  }

  document.getElementById('bk-eksekusi').addEventListener('click', function () {
    const kec = document.getElementById('bk-kecamatan').value;
    if (!bkAksiTerpilih) { tampilkanToast("Pilih aksi dulu.", "gagal"); return; }
    if (kec === undefined || kec === null) { tampilkanToast("Pilih kecamatan dulu.", "gagal"); return; }

    const kecLabel = kec || "(TANPA KECAMATAN)";
    const namaAksi = bkAksiTerpilih === "BUKA" ? "Membuka" : (bkAksiTerpilih === "TUTUP" ? "Menutup" : "Mereset");
    konfirmasiAksi({
      judul: namaAksi + " Akses Massal Kecamatan",
      pesan: "Anda yakin ingin " + namaAksi.toLowerCase() + " akses untuk SEMUA user di " + kecLabel + "?",
      tipe: bkAksiTerpilih === "TUTUP" ? "warning" : "info",
      teksBatal: "Batal",
      teksKonfirmasi: "Ya, " + namaAksi
    }).then(function (setuju) {
      if (!setuju) return;
      document.getElementById('bk-eksekusi').disabled = true;
      document.getElementById('bk-eksekusi').textContent = "Memproses...";

      google.script.run
        .withSuccessHandler(function (res) {
          document.getElementById('bk-eksekusi').textContent = "Eksekusi";
          const pesan = document.getElementById('bk-pesan');
          if (res && res.sukses) {
            pesan.textContent = res.pesan;
            pesan.className = "text-xs font-medium rounded-lg px-3 py-2 border bg-emerald-50 border-emerald-200 text-emerald-700";
            pesan.classList.remove('hidden');
            setTimeout(function () {
              document.getElementById('modal-bulk-kecamatan').classList.add('hidden');
              bukaModalKelolaUser(); // reload daftar user
            }, 1500);
          } else {
            pesan.textContent = (res ? res.pesan : "Unknown error");
            pesan.className = "text-xs font-medium rounded-lg px-3 py-2 border bg-red-50 border-red-200 text-red-700";
            pesan.classList.remove('hidden');
            document.getElementById('bk-eksekusi').disabled = false;
          }
        })
        .withFailureHandler(function (err) {
          document.getElementById('bk-eksekusi').textContent = "Eksekusi";
          document.getElementById('bk-eksekusi').disabled = false;
          tampilkanToast(pesanErrorRamah(err), "gagal");
        })
        .bulkSakelarPerKecamatan(dataPengguna.token, kec, bkAksiTerpilih);
    });
  });

})();

// Masuk Aplikasi
function masukSetelahAuth(res, usernameFallback) {
  const usernameFinal = res.username || usernameFallback || "";
  const namaLengkapFinal = (res.profil && res.profil.namaLengkap) ? res.profil.namaLengkap : "";

  try {
    sessionStorage.setItem('dana_jasa_sesi', JSON.stringify({
      token: res.token, username: usernameFinal, role: res.role,
      kecamatan: res.kecamatan, userId: res.userId || "", namaLengkap: namaLengkapFinal
    }));
  } catch (e) { }

  try { localStorage.setItem('dana_jasa_username', usernameFinal); } catch (e) { }

  dataPengguna.username = usernameFinal;
  dataPengguna.role = res.role;
  dataPengguna.kecamatan = res.kecamatan;
  dataPengguna.token = res.token;
  dataPengguna.userId = res.userId || "";

  dataPengguna.kelurahanTerkunci = kelurahanDariUserId(dataPengguna.userId);

  renderAdminSubtitle(namaLengkapFinal || usernameFinal, dataPengguna.kelurahanTerkunci);

  if (window._muatDaftarTahun) window._muatDaftarTahun();
  document.getElementById('modal-login').classList.add('hidden');

  if (res.profileBelumDiisi) {
    if (res.role === "UTAMA") {
      window.bukaMoldalProfilAwal(res.token, res.role, res.kecamatan, false);
    } else {
      google.script.run
        .withSuccessHandler(function (st) {
          const ditutup = st && st.sukses ? !!st.ditutup : false;
          window.bukaMoldalProfilAwal(res.token, res.role, res.kecamatan, ditutup);
        })
        .withFailureHandler(function () {
          window.bukaMoldalProfilAwal(res.token, res.role, res.kecamatan, false);
        })
        .statusInputKecKem(res.token);
    }
  } else {
    if (typeof mulaiVersionCheck === "function") mulaiVersionCheck();
    terapkanHakAkses(res.role, res.kecamatan, false);
    if (res.role !== "UTAMA") {
      google.script.run
        .withSuccessHandler(function (st) {
          const ditutup = st && st.sukses ? !!st.ditutup : false;
          if (ditutup) {
            terapkanHakAkses(res.role, res.kecamatan, true);
          }
        })
        .withFailureHandler(function () { /* pertahankan status terbuka */ })
        .statusInputKecKem(res.token);
    }
  }
}

// Login
(function () {
  const btnLogin = document.getElementById('btn-login');
  const inputPass = document.getElementById('login-password');

  (function () {
    const usernameDisimpan = localStorage.getItem('dana_jasa_username');
    const inputUser = document.getElementById('login-username');
    const infoEl = document.getElementById('login-username-info');
    if (usernameDisimpan && inputUser) {
      inputUser.value = usernameDisimpan;
      if (infoEl) infoEl.classList.remove('hidden');
      const inputPassEl = document.getElementById('login-password');
      if (inputPassEl) setTimeout(function () { inputPassEl.focus(); }, 100);
    }
  })();

  function prosesLogin() {
    // Guard anti-double-submit: dulu hanya tombol yang di-disable, tapi handler Enter-key di kedua
    // input (di bawah) memanggil prosesLogin() langsung tanpa cek ini -- Enter beruntun cepat/
    // key-repeat OS bisa kirim beberapa loginPengguna() bersamaan dgn kredensial sama. Taruh cek
    // di SATU tempat (awal fungsi) supaya menutup semua jalur pemanggil (klik, submit form, Enter
    // di 2 input) sekaligus.
    if (btnLogin && btnLogin.disabled) return;
    const inputUser = document.getElementById('login-username');
    const inputPassEl = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');
    const username = inputUser ? inputUser.value.trim() : "";
    const password = inputPassEl ? inputPassEl.value.trim() : "";
    if (!username || !password) {
      loginError.textContent = "Username dan password wajib diisi.";
      loginError.classList.remove('hidden');
      if (!username && inputUser) inputUser.focus();
      else if (inputPassEl) inputPassEl.focus();
      return;
    }
    btnLogin.disabled = true;
    btnLogin.textContent = "MEMVERIFIKASI...";
    loginError.classList.add('hidden');
    google.script.run
      .withSuccessHandler(function (res) {
        btnLogin.disabled = false;
        btnLogin.textContent = "MASUK";
        if (res.sukses) {
          masukSetelahAuth(res, username);
          const namaSapa = (res.profil && res.profil.namaLengkap) ? res.profil.namaLengkap : (res.username || username);
          tampilkanToast(sapaanWaktu() + ", " + namaSapa + "! Selamat bekerja.", "sukses", { durasi: 4500 });
        } else {
          loginError.textContent = res.pesan || "Username atau password salah.";
          loginError.classList.remove('hidden');
          if (inputPassEl) { inputPassEl.value = ""; inputPassEl.focus(); }
        }
      })
      .withFailureHandler(function (err) {
        btnLogin.disabled = false;
        btnLogin.textContent = "MASUK";
        const pesanErr = (err && err.message) ? err.message : "Gagal terhubung ke server. Silakan coba beberapa saat lagi.";
        loginError.textContent = pesanErr;
        loginError.classList.remove('hidden');
      })
      .loginPengguna(username, password);
  }

  if (btnLogin) btnLogin.addEventListener('click', prosesLogin);

  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', function (e) {
      e.preventDefault();
      prosesLogin();
    });
  }

  const inputUser = document.getElementById('login-username');
  if (inputUser) {
    inputUser.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        if (inputPass && !inputPass.value.trim()) {
          e.preventDefault();
          inputPass.focus();
        } else {
          prosesLogin();
        }
      }
    });
  }

  if (inputPass) {
    inputPass.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') prosesLogin();
    });
  }
})();

// Penanda Field Selesai
(function () {
  const form = document.getElementById('form-pembayaran');
  if (!form) return;

  const WARNA_BORDER = '#0ea5e9'; // sky-500

  const SVG_CENTANG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%231e3a8a'%3E%3Cpath fill-rule='evenodd' d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z' clip-rule='evenodd'/%3E%3C/svg%3E\")";

  function pasang(el) {
    if (el.__penandaDipasang) return;
    el.__penandaDipasang = true;
    ['input', 'change', 'blur'].forEach(function (ev) {
      el.addEventListener(ev, function () {
        setTimeout(function () { perbarui(el); }, 0);
      });
    });
  }

  function valid(el) {
    if (el.type === 'file') return !!(el.files && el.files.length);
    const v = (el.value || '').toString().trim();
    switch (el.id) {
      case 'input-nik': return v.length === 16;
      case 'input-no-rek': return v.length === 14;
      case 'input-kontak': return v.startsWith('08') && v.length >= 10;
      case 'input-tgl-lahir': {
        const u = parseInt((document.getElementById('input-umur') || {}).value, 10);
        return !!v && !isNaN(u) && u >= 18;
      }
      case 'input-umur': {
        const u = parseInt(v, 10);
        return !isNaN(u) && u >= 18;
      }
      default: return v !== '';
    }
  }

  function perbarui(el) {
    const ok = valid(el);
    const isFile = el.type === 'file';
    const isSel = el.tagName === 'SELECT';

    if (isFile) {
      el.style.outline = ok ? '2px solid ' + WARNA_BORDER : '';
      el.style.borderRadius = ok ? '6px' : '';
      return;
    }

    if (ok) {
      el.style.borderColor = WARNA_BORDER;
      el.style.boxShadow = '0 0 0 1px ' + WARNA_BORDER;
      el.style.backgroundImage = SVG_CENTANG;
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = isSel ? 'right 28px center' : 'right 8px center';
      el.style.backgroundSize = '16px 16px';
      if (!isSel) el.style.paddingRight = '28px';
    } else {
      el.style.borderColor = '';
      el.style.boxShadow = '';
      el.style.backgroundImage = '';
      el.style.backgroundRepeat = '';
      el.style.backgroundPosition = '';
      el.style.backgroundSize = '';
      if (!isSel) el.style.paddingRight = '';
    }

    if (el.id === 'input-tgl-lahir') {
      const umurEl = document.getElementById('input-umur');
      if (umurEl && umurEl.__penandaDipasang) perbarui(umurEl);
    }
  }

  function semuaField() {
    return Array.prototype.slice
      .call(form.querySelectorAll('input, select'))
      .filter(function (el) { return el.type !== 'hidden'; });
  }

  window.refreshPenandaForm = function () {
    semuaField().forEach(function (el) {
      if (el.__penandaDipasang) perbarui(el);
    });
  };

  semuaField().forEach(pasang);

  const btnReset = document.getElementById('btn-reset-form');
  if (btnReset) {
    btnReset.addEventListener('click', function () {
      setTimeout(function () {
        semuaField().forEach(function (el) {
          el.style.borderColor = '';
          el.style.boxShadow = '';
          el.style.backgroundImage = '';
          el.style.backgroundRepeat = '';
          el.style.backgroundPosition = '';
          el.style.backgroundSize = '';
          el.style.paddingRight = '';
          el.style.outline = '';
          el.style.borderRadius = '';
        });
      }, 60);
    });
  }
})();

// Dropdown Berjenjang
(function () {
  const filterKecamatanAtas = document.getElementById('control-kecamatan');
  const domisiliKecamatanForm = document.getElementById('input-kecamatan');
  const domisiliKelurahanForm = document.getElementById('input-kelurahan');

  if (filterKecamatanAtas) {
    filterKecamatanAtas.addEventListener('change', function () {
      const nilaiKecamatan = this.value.trim().toUpperCase();

      if (!nilaiKecamatan) {
        if (domisiliKecamatanForm) {
          domisiliKecamatanForm.value = "";
          domisiliKecamatanForm.disabled = false;
          domisiliKecamatanForm.classList.remove('bg-slate-100', 'cursor-not-allowed');
        }
        if (domisiliKelurahanForm) {
          domisiliKelurahanForm.innerHTML = '<option value="">-- PILIH KELURAHAN --</option>';
        }
        return;
      }

      if (domisiliKecamatanForm) {
        domisiliKecamatanForm.value = nilaiKecamatan;
        domisiliKecamatanForm.disabled = true;
        domisiliKecamatanForm.classList.add('bg-slate-100', 'cursor-not-allowed');
      }

      if (domisiliKelurahanForm) {
        const isiDropdownKelurahan = function (daftarKelurahan) {
          domisiliKelurahanForm.innerHTML = '<option value="">-- PILIH KELURAHAN --</option>';
          if (daftarKelurahan && daftarKelurahan.length > 0) {
            daftarKelurahan.forEach(function (kelurahan) {
              const opt = document.createElement('option');
              const teksKapital = kelurahan.trim().toUpperCase();
              opt.value = teksKapital;
              opt.textContent = teksKapital;
              domisiliKelurahanForm.appendChild(opt);
            });

            // Kunci kelurahan otomatis jika operator memiliki kelurahanTerkunci
            if (dataPengguna && dataPengguna.kelurahanTerkunci) {
              const kelTerkunci = dataPengguna.kelurahanTerkunci.trim().toUpperCase();
              const cocok = Array.from(domisiliKelurahanForm.options).some(function (o) { return o.value === kelTerkunci; });
              if (cocok) {
                domisiliKelurahanForm.value = kelTerkunci;
                domisiliKelurahanForm.disabled = true;
                domisiliKelurahanForm.classList.add('bg-slate-100', 'cursor-not-allowed');
                domisiliKelurahanForm.classList.remove('bg-white');
              }
            }
          } else {
            domisiliKelurahanForm.innerHTML = '<option value="">DATA KELURAHAN TIDAK DITEMUKAN</option>';
          }
        };

        let tersimpan = cacheKelurahanByKecamatan[nilaiKecamatan];
        if (!tersimpan) {
          try {
            const raw = localStorage.getItem('cache_kel_' + nilaiKecamatan);
            if (raw) tersimpan = JSON.parse(raw);
          } catch (e) { }
        }
        if (tersimpan && tersimpan.data && (Date.now() - tersimpan.waktu) < TTL_CACHE_MASTER_MS) {
          cacheKelurahanByKecamatan[nilaiKecamatan] = tersimpan;
          isiDropdownKelurahan(tersimpan.data);
          return;
        }

        domisiliKelurahanForm.innerHTML = '<option value="">MENGAMBIL DATA KELURAHAN...</option>';

        google.script.run
          .withSuccessHandler(function (daftarKelurahan) {
            const entri = { data: daftarKelurahan, waktu: Date.now() };
            cacheKelurahanByKecamatan[nilaiKecamatan] = entri;
            try { localStorage.setItem('cache_kel_' + nilaiKecamatan, JSON.stringify(entri)); } catch (e) { }
            isiDropdownKelurahan(daftarKelurahan);
          })
          .withFailureHandler(function (error) {
            console.error("Gagal memuat kelurahan:", error);
            domisiliKelurahanForm.innerHTML = '<option value="">GAGAL MEMUAT DATA</option>';
          })
          .getKelurahanByKecamatan(dataPengguna.token, nilaiKecamatan);
      }
    });
  }
})();

// Layanan Kecamatan & Kemenag
const inputLayanan = document.getElementById('input-layanan');
const hiddenKategori = document.getElementById('kategori-terpilih');

const kategoriModal = [
  "IMAM MASJID",
  "KHATIB JUMAT",
  "NAZIR MASJID",
  "NAZIR MUSHOLLA",
  "PENGURUS GEREJA",
  "PENGURUS VIHARA/KLENTENG/KUIL",
  "PETUGAS GEREJA KATOLIK"
];

if (inputLayanan) {
  inputLayanan.addEventListener('focus', function () {
    this.dataset.lastValue = this.value;
    this.value = "";
  });

  inputLayanan.addEventListener('change', function () {
    const val = this.value.toUpperCase().trim();
    if (val === "") return;

    if (hiddenKategori) {
      hiddenKategori.value = val;
    }

    const daftarKemenag = (typeof masterLayanan !== 'undefined' && masterLayanan.kemenag)
      ? masterLayanan.kemenag.map(v => v.trim().toUpperCase())
      : [];

    if (daftarKemenag.includes(val)) {
      openKemenagModal(val);
      this.blur();
    }
    else if (kategoriModal.includes(val)) {
      openModal(val);
      this.blur();
    }
    else if (val === "USTADZ" || val === "USTADZAH") {
      openKemenagModal(val);
      this.blur();
    }
    else {
      const inputTempat = document.getElementById('input-tempat-tugas');
      const inputAlmt = document.getElementById('input-almt-tugas');
      if (inputTempat) inputTempat.value = "";
      if (inputAlmt) inputAlmt.value = "";
      this.blur();
    }
  });

  inputLayanan.addEventListener('blur', function () {
    if (this.value === "") {
      this.value = this.dataset.lastValue || "";
    }
  });
}

// Helper Tempat Tugas
function isiTempatTugas(nama, alamat) {
  const inputTempat = document.getElementById('input-tempat-tugas');
  const inputAlmt = document.getElementById('input-almt-tugas');
  if (inputTempat) { inputTempat.value = nama; inputTempat.dispatchEvent(new Event('change')); }
  if (inputAlmt) { inputAlmt.value = alamat; inputAlmt.dispatchEvent(new Event('change')); }

  if (typeof kunciTempatTugas === 'function') kunciTempatTugas();

  if (typeof jalankanCekTempatTugas === 'function') jalankanCekTempatTugas();
}

// Modal Kecamatan
let dataCache = [];

function openModal(kategori) {
  const modalRi = document.getElementById('modal-ri');
  const bodyRi = document.getElementById('body-ri');

  if (modalRi) modalRi.classList.remove('hidden');

  const tersimpan = cacheRumahIbadah[kategori];
  if (tersimpan && (Date.now() - tersimpan.waktu) < TTL_CACHE_MASTER_MS) {
    renderTable(tersimpan.data);
    return;
  }

  if (bodyRi) bodyRi.innerHTML = htmlSkeletonBaris(5, 4);

  google.script.run
    .withSuccessHandler(function (data) {
      cacheRumahIbadah[kategori] = { data: data, waktu: Date.now() };
      renderTable(data);
    })
    .withFailureHandler(function (err) {
      if (!bodyRi) return;
      const pesan = (typeof pesanErrorRamah === 'function') ? pesanErrorRamah(err) : 'Gagal memuat data. Silakan coba lagi.';
      bodyRi.innerHTML =
        '<tr><td colspan="5" class="text-center p-4 text-red-600 text-sm whitespace-pre-line">' + esc(pesan) + '</td></tr>' +
        '<tr><td colspan="5" class="text-center pb-4"><button type="button" id="btn-retry-modal-ri" class="inline-flex items-center gap-1.5 bg-sky-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-sky-700 transition"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>Coba Lagi</span></button></td></tr>';
      const btnRetry = document.getElementById('btn-retry-modal-ri');
      if (btnRetry) btnRetry.addEventListener('click', function () { openModal(kategori); });
    })
    .getDataRumahIbadah(dataPengguna.token, kategori);
}

function renderTable(data) {
  dataCache = data;
  const tbody = document.getElementById('body-ri');
  const selectKec = document.getElementById('modal-ri-filter-kecamatan');
  const selectKel = document.getElementById('modal-ri-filter-kelurahan');

  if (tbody) {
    tbody.innerHTML = data.map((row, i) => {
      return `<tr>
        <td class="p-2 font-medium text-slate-900">${esc(row[2])}</td>
        <td class="p-2 text-slate-600">${esc(row[3])}</td>
        <td class="p-2">${esc(row[0])}</td>
        <td class="p-2">${esc(row[1])}</td>
        <td class="p-2 text-center"><button onclick="pilihRI(${i})" class="bg-sky-500 text-white px-2 py-1 rounded text-xs">OK</button></td>
      </tr>`;
    }).join('');
  }

  const kecList = [...new Set(data.map(r => (r[0] || '').trim().toUpperCase()))].filter(Boolean).sort();

  if (selectKec) {
    selectKec.innerHTML = '<option value="">-- SEMUA KECAMATAN --</option>' + kecList.map(k => `<option value="${k}">${k}</option>`).join('');
  }

  if (selectKel) {
    selectKel.innerHTML = '<option value="">-- PILIH KELURAHAN --</option>';
    selectKel.disabled = true;
  }
}

function updateOldModalKelurahan() {
  const selectKec = document.getElementById('modal-ri-filter-kecamatan');
  const selectKel = document.getElementById('modal-ri-filter-kelurahan');
  if (!selectKec || !selectKel) return;

  const kecVal = selectKec.value.toUpperCase();

  if (!kecVal) {
    selectKel.innerHTML = '<option value="">-- PILIH KELURAHAN --</option>';
    selectKel.disabled = true;
  } else {
    const kelList = [...new Set(
      dataCache
        .filter(r => (r[0] || '').trim().toUpperCase() === kecVal)
        .map(r => (r[1] || '').trim().toUpperCase())
    )].filter(Boolean).sort();

    selectKel.innerHTML = '<option value="">-- SEMUA KELURAHAN --</option>' + kelList.map(k => `<option value="${k}">${k}</option>`).join('');
    selectKel.disabled = false;
  }
  filterTable();
}

function filterTable() {
  const selectKec = document.getElementById('modal-ri-filter-kecamatan');
  const selectKel = document.getElementById('modal-ri-filter-kelurahan');
  const searchRi = document.getElementById('search-ri');
  const tbody = document.getElementById('body-ri');

  if (!tbody) return;
  const rows = tbody.getElementsByTagName('tr');

  const kecVal = selectKec ? selectKec.value.toUpperCase() : "";
  const kelVal = selectKel ? selectKel.value.toUpperCase() : "";
  const searchVal = searchRi ? searchRi.value.toUpperCase().trim() : "";

  dataCache.forEach((row, i) => {
    const matchKec = kecVal === "" || (row[0] || '').toUpperCase() === kecVal;
    const matchKel = kelVal === "" || (row[1] || '').toUpperCase() === kelVal;
    const matchName = (row[2] || '').toUpperCase().includes(searchVal) || (row[3] || '').toUpperCase().includes(searchVal);

    if (rows[i]) {
      rows[i].style.display = (matchKec && matchKel && matchName) ? "" : "none";
    }
  });
}

function pilihRI(index) {
  const nama = (dataCache[index][2] || '').trim().toUpperCase();
  const alamat = (dataCache[index][3] || '').trim().toUpperCase();
  isiTempatTugas(nama, alamat);
  closeModal();
}

function closeModal() {
  const modalRi = document.getElementById('modal-ri');
  if (modalRi) modalRi.classList.add('hidden');
}

// Modal Kemenag
let kemenagCache = [];

function openKemenagModal(layanan) {
  const modal = document.getElementById('modal-kemenag');
  const subPilihan = document.getElementById('modal-sub-pilihan');
  const contentArea = document.getElementById('modal-content-area');

  if (modal) modal.classList.remove('hidden');
  if (contentArea) contentArea.innerHTML = "";

  if (subPilihan) {
    if (layanan === "GURU MAGHRIB MENGAJI") {
      subPilihan.innerHTML = `
          <select id="gmm-pilihan" onchange="renderGmmContent(this.value)" class="w-full p-2 border rounded font-medium text-sm">
            <option value="">-- PILIH JENIS TEMPAT TUGAS --</option>
            <option value="db_masjid">MASJID</option>
            <option value="db_musholla">MUSHOLLA</option>
            <option value="RUMAH">RUMAH</option>
            <option value="LAINNYA">LAINNYA</option>
          </select>`;

    } else if (layanan === "USTADZ" || layanan === "USTADZAH") {
      subPilihan.innerHTML = `
          <select id="ustadz-pilihan" onchange="renderUstadzContent(this.value)" class="w-full p-2 border rounded font-medium text-sm">
            <option value="">-- PILIH JENIS TEMPAT TUGAS --</option>
            <option value="db_masjid">MASJID</option>
            <option value="db_musholla">MUSHOLLA</option>
            <option value="LAINNYA">LAINNYA</option>
          </select>`;
    }
    else if (layanan === "GURU SEKOLAH MINGGU") {
      subPilihan.innerHTML = `
          <select id="gsm-pilihan" onchange="loadDataToModal(this.value)" class="w-full p-2 border rounded font-medium text-sm">
            <option value="">-- PILIH JENIS GURU SEKOLAH MINGGU --</option>
            <option value="db_gereja">GSM PROTESTAN</option>
            <option value="db_pgk">GSM KATOLIK</option>
          </select>`;
    }
    else if (layanan === "GURU SEKOLAH BUDDHA") {
      subPilihan.innerHTML = "";
      loadDataToModal("db_vihara");
    }
    else if (layanan === "GURU SEKOLAH HINDU") {
      subPilihan.innerHTML = "";
      loadDataToModal("db_kuil");
    }
    else if (layanan === "GURU SEKOLAH KONG HU CHU") {
      subPilihan.innerHTML = "";
      loadDataToModal("db_klenteng");
    }
    else if (layanan === "PENATUA GEREJA") {
      subPilihan.innerHTML = "";
      loadDataToModal("db_gereja");
    }
  }
}

function renderGmmContent(jenis) {
  const hiddenJenisGmm = document.getElementById('jenis-tempat-gmm-hidden');
  const petaJenisGmm = { db_masjid: "MASJID", db_musholla: "MUSHOLLA", RUMAH: "RUMAH", LAINNYA: "LAINNYA" };
  if (hiddenJenisGmm) hiddenJenisGmm.value = petaJenisGmm[jenis] || "";
  if (typeof evaluasiUploadKondisional === 'function') evaluasiUploadKondisional();

  const contentArea = document.getElementById('modal-content-area');
  if (!contentArea) return;

  if (jenis === "RUMAH") {
    contentArea.innerHTML = `
        <div class="space-y-4 mt-2">
          <div class="text-xs font-semibold text-slate-500 uppercase">Tempat Tugas Terisi Otomatis:</div>
          <input type="text" id="manual-tempat" value="RUMAH" readonly class="w-full p-2 border rounded bg-slate-100 font-medium cursor-not-allowed">
          <input type="text" id="manual-alamat" placeholder="Masukkan Alamat Rumah Lengkap" class="w-full p-2 border rounded text-sm">
          <button onclick="submitManual()" class="w-full bg-sky-600 text-white p-2 rounded text-sm font-semibold hover:bg-sky-700 transition">Simpan Data</button>
        </div>`;
  } else if (jenis === "LAINNYA") {
    contentArea.innerHTML = `
        <div class="space-y-4 mt-2">
          <input type="text" id="manual-tempat" placeholder="Masukkan Nama Tempat Tugas / Lembaga" class="w-full p-2 border rounded text-sm">
          <input type="text" id="manual-alamat" placeholder="Masukkan Alamat Tempat Tugas Lengkap" class="w-full p-2 border rounded text-sm">
          <button onclick="submitManual()" class="w-full bg-sky-600 text-white p-2 rounded text-sm font-semibold hover:bg-sky-700 transition">Simpan Data</button>
        </div>`;
  } else if (jenis !== "") {
    loadDataToModal(jenis);
  } else {
    contentArea.innerHTML = "";
  }
}

function renderUstadzContent(jenis) {
  const contentArea = document.getElementById('modal-content-area');
  if (!contentArea) return;

  if (jenis === "LAINNYA") {
    contentArea.innerHTML = `
        <div class="space-y-4 mt-2">
          <input type="text" id="manual-tempat" placeholder="Masukkan Nama Tempat Tugas / Lembaga" class="w-full p-2 border rounded text-sm">
          <input type="text" id="manual-alamat" placeholder="Masukkan Alamat Tempat Tugas Lengkap" class="w-full p-2 border rounded text-sm">
          <button onclick="submitManual()" class="w-full bg-sky-600 text-white p-2 rounded text-sm font-semibold hover:bg-sky-700 transition">Simpan Data</button>
        </div>`;
  } else if (jenis !== "") {
    loadDataToModal(jenis);
  } else {
    contentArea.innerHTML = "";
  }
}

function loadDataToModal(sheetName) {
  const contentArea = document.getElementById('modal-content-area');
  if (!contentArea) return;
  if (!sheetName) {
    contentArea.innerHTML = "";
    return;
  }

  const tersimpan = cacheKemenagData[sheetName];
  if (tersimpan && (Date.now() - tersimpan.waktu) < TTL_CACHE_MASTER_MS) {
    renderKemenagTable(tersimpan.data, contentArea);
    return;
  }

  contentArea.innerHTML = "<p class='text-center p-4 text-slate-500 text-sm animate-pulse'>Sedang memuat data dari database...</p>";

  google.script.run
    .withSuccessHandler(function (data) {
      if (data.error || !data.length) {
        contentArea.innerHTML = "<p class='text-center p-4 text-red-500 text-sm'>Gagal memuat data atau database kosong.</p>";
        return;
      }
      cacheKemenagData[sheetName] = { data: data, waktu: Date.now() };
      renderKemenagTable(data, contentArea);
    })
    .withFailureHandler(function (err) {
      const pesan = (typeof pesanErrorRamah === 'function') ? pesanErrorRamah(err) : 'Gagal memuat data. Silakan coba lagi.';
      contentArea.innerHTML =
        "<p class='text-center p-4 text-red-600 text-sm whitespace-pre-line'>" + esc(pesan) + "</p>" +
        "<div class='text-center pb-2'><button type='button' id='btn-retry-modal-kemenag' class='inline-flex items-center gap-1.5 bg-sky-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-sky-700 transition'><svg xmlns='http://www.w3.org/2000/svg' class='w-3.5 h-3.5' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'><path stroke-linecap='round' stroke-linejoin='round' d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'/></svg><span>Coba Lagi</span></button></div>";
      const btnRetry = document.getElementById('btn-retry-modal-kemenag');
      if (btnRetry) btnRetry.addEventListener('click', function () { loadDataToModal(sheetName); });
    })
    .getKemenagData(dataPengguna.token, sheetName);
}

function renderKemenagTable(data, contentArea) {
  kemenagCache = data;
  const kecList = [...new Set(data.map(r => (r[0] || '').trim().toUpperCase()))].filter(Boolean).sort();

  let filterHtml = `
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filter Kecamatan</label>
              <select id="kemenag-filter-kec" onchange="updateKemenagKelurahanFilter()" class="w-full p-2 border rounded text-xs bg-white font-medium">
                <option value="">-- SEMUA KECAMATAN --</option>
                ${kecList.map(k => `<option value="${k}">${k}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filter Kelurahan</label>
              <select id="kemenag-filter-kel" onchange="filterKemenagTable()" class="w-full p-2 border rounded text-xs bg-white font-medium" disabled>
                <option value="">-- PILIH KELURAHAN --</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cari Nama / Alamat</label>
              <input type="text" id="kemenag-search" oninput="filterKemenagTable()" placeholder="Ketik nama atau alamat..." class="w-full p-2 border rounded text-xs bg-white">
            </div>
          </div>
        `;

  let tableHtml = `
          <div class="overflow-x-auto max-h-[45vh] overflow-y-auto border border-slate-200 rounded-lg">
            <table class="w-full text-xs border-collapse">
              <thead class="sticky top-0 bg-slate-100 z-10 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                <tr class="text-left text-slate-700 font-bold uppercase">
                  <th class="p-2 border-b border-slate-200">KECAMATAN</th>
                  <th class="p-2 border-b border-slate-200">KELURAHAN</th>
                  <th class="p-2 border-b border-slate-200">NAMA RUMAH IBADAH</th>
                  <th class="p-2 border-b border-slate-200">ALAMAT RUMAH IBADAH</th>
                  <th class="p-2 border-b border-slate-200 text-center">AKSI</th>
                </tr>
              </thead>
              <tbody id="kemenag-table-body">`;

  data.forEach((row, index) => {
    tableHtml += `<tr class="border-b hover:bg-slate-50 transition kemenag-row-item">
    <td class="p-2 border-r border-slate-100">${esc(row[0])}</td>
    <td class="p-2 border-r border-slate-100">${esc(row[1])}</td>
    <td class="p-2 border-r border-slate-100 font-medium text-slate-900">${esc(row[2])}</td>
    <td class="p-2 border-r border-slate-100 text-slate-600">${esc(row[3])}</td>
    <td class="p-2 text-center">
      <button onclick="pilihData(${index})"
              class="bg-green-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-green-700 transition">
        Pilih
      </button>
    </td>
  </tr>`;
  });

  tableHtml += `</tbody></table></div>`;
  contentArea.innerHTML = filterHtml + tableHtml;
}

function updateKemenagKelurahanFilter() {
  const selectKec = document.getElementById('kemenag-filter-kec');
  const selectKel = document.getElementById('kemenag-filter-kel');
  if (!selectKec || !selectKel) return;

  const kecVal = selectKec.value.toUpperCase();

  if (!kecVal) {
    selectKel.innerHTML = '<option value="">-- PILIH KELURAHAN --</option>';
    selectKel.disabled = true;
  } else {
    const kelList = [...new Set(
      kemenagCache
        .filter(r => (r[0] || '').trim().toUpperCase() === kecVal)
        .map(r => (r[1] || '').trim().toUpperCase())
    )].filter(Boolean).sort();

    selectKel.innerHTML = '<option value="">-- SEMUA KELURAHAN --</option>' + kelList.map(k => `<option value="${k}">${k}</option>`).join('');
    selectKel.disabled = false;
  }
  filterKemenagTable();
}

function filterKemenagTable() {
  const selectKec = document.getElementById('kemenag-filter-kec');
  const selectKel = document.getElementById('kemenag-filter-kel');
  const searchInput = document.getElementById('kemenag-search');
  const rows = document.getElementsByClassName('kemenag-row-item');

  const kecVal = selectKec ? selectKec.value.toUpperCase() : "";
  const kelVal = selectKel ? selectKel.value.toUpperCase() : "";
  const searchVal = searchInput ? searchInput.value.toUpperCase().trim() : "";

  kemenagCache.forEach((row, i) => {
    const matchKec = kecVal === "" || (row[0] || '').toUpperCase() === kecVal;
    const matchKel = kelVal === "" || (row[1] || '').toUpperCase() === kelVal;
    const matchSearch = searchVal === "" || (row[2] || '').toUpperCase().includes(searchVal) || (row[3] || '').toUpperCase().includes(searchVal);

    if (rows[i]) {
      rows[i].style.display = (matchKec && matchKel && matchSearch) ? "" : "none";
    }
  });
}

function pilihData(index) {
  const nama = (kemenagCache[index][2] || '').trim().toUpperCase();
  const alamat = (kemenagCache[index][3] || '').trim().toUpperCase();
  isiTempatTugas(nama, alamat);
  const modalKemenag = document.getElementById('modal-kemenag');
  if (modalKemenag) modalKemenag.classList.add('hidden');
}

function submitManual() {
  const manualTempat = document.getElementById('manual-tempat');
  const manualAlamat = document.getElementById('manual-alamat');

  const nama = manualTempat ? manualTempat.value.trim().toUpperCase() : "";
  const alamat = manualAlamat ? manualAlamat.value.trim().toUpperCase() : "";

  if (!nama || !alamat) {
    tampilkanToast("Mohon lengkapi nama tempat tugas dan alamat terlebih dahulu!", "gagal");
    return;
  }

  isiTempatTugas(nama, alamat);

  const modalKemenag = document.getElementById('modal-kemenag');
  if (modalKemenag) modalKemenag.classList.add('hidden');
}


// CRUD User UI
// Memungkinkan Admin Utama mengelola akun langsung dari UI tanpa buka Supabase

const PILIHAN_ROLE_PENGGUNA = [
  { nilai: 'UTAMA', label: 'Utama' },
  { nilai: 'KECAMATAN', label: 'Kecamatan' },
  { nilai: 'GURU SEKOLAH BUDDHA', label: 'Guru Sekolah Buddha' },
  { nilai: 'GURU SEKOLAH HINDU', label: 'Guru Sekolah Hindu' },
  { nilai: 'GURU SEKOLAH KONG HU CHU', label: 'Guru Sekolah Kong Hu Chu' },
  { nilai: 'GURU SEKOLAH MINGGU', label: 'Guru Sekolah Minggu' },
  { nilai: 'PENATUA GEREJA', label: 'Penatua Gereja' },
  { nilai: 'GURU MAGHRIB MENGAJI', label: 'Guru Maghrib Mengaji' }
];
// KECAMATAN wajib kecamatan (+ kelurahan opsional); GURU MAGHRIB MENGAJI kecamatan opsional
// (kosong = se-Kota Medan). Harus selaras dengan supabase/functions/api/domains/akun.ts.
const ROLE_DENGAN_KECAMATAN = new Set(['KECAMATAN', 'GURU MAGHRIB MENGAJI']);
const ROLE_WAJIB_KECAMATAN = new Set(['KECAMATAN']);
const ROLE_DENGAN_KELURAHAN = new Set(['KECAMATAN']);

function opsiRolePenggunaHtml() {
  return PILIHAN_ROLE_PENGGUNA.map(function (role) {
    return '<option value="' + role.nilai + '">' + role.label + '</option>';
  }).join('');
}

function isiPilihanRoleKelolaPengguna() {
  const opsi = opsiRolePenggunaHtml();
  const filter = document.getElementById('filter-role-kelola-user');
  const tambah = document.getElementById('tu-role');
  const edit = document.getElementById('eu-role');
  if (filter) filter.innerHTML = '<option value="">Semua Role</option>' + opsi;
  if (tambah) tambah.innerHTML = '<option value="">-- Pilih Role --</option>' + opsi;
  if (edit) edit.innerHTML = '<option value="">-- Pilih Role --</option>' + opsi;
}

function roleMemerlukanKecamatan(role) {
  return ROLE_DENGAN_KECAMATAN.has(String(role || '').trim().toUpperCase());
}

function roleWajibKecamatan(role) {
  return ROLE_WAJIB_KECAMATAN.has(String(role || '').trim().toUpperCase());
}

function roleMemakaiKelurahan(role) {
  return ROLE_DENGAN_KELURAHAN.has(String(role || '').trim().toUpperCase());
}

// Isi dropdown kelurahan sesuai kecamatan. Aman terhadap:
// - respons usang (kecamatan sudah diganti sebelum respons datang) -> diabaikan;
// - success handler SWR yang terpanggil 2x (cache lalu revalidasi) -> pilihan user dipertahankan;
// - kelurahan tersimpan yang (sudah) tidak ada di tabel wilayah -> tetap ditampilkan sebagai
//   "(data lama)" supaya menyimpan profil tidak diam-diam melebarkan akses akun.
function muatOpsiKelurahanAkun(selKel, kecamatan, nilaiAwal) {
  if (!selKel) return;
  const kec = String(kecamatan || '').trim().toUpperCase();
  const awal = String(nilaiAwal || '').trim().toUpperCase();
  selKel.dataset.kecamatan = kec;
  selKel.dataset.terisi = '';

  if (!kec) {
    selKel.innerHTML = '<option value="">-- Pilih kecamatan dulu --</option>';
    selKel.disabled = true;
    return;
  }

  function isi(daftar, gagal) {
    if (selKel.dataset.kecamatan !== kec) return; // respons untuk kecamatan lama
    const pilihan = selKel.dataset.terisi === kec ? selKel.value : awal;
    const nama = [];
    (daftar || []).forEach(function (k) {
      const v = String(k || '').trim().toUpperCase();
      if (v && nama.indexOf(v) === -1) nama.push(v);
    });
    let html = '<option value="">' + (gagal ? '-- Semua Kelurahan (daftar gagal dimuat) --' : '-- Semua Kelurahan (tingkat kecamatan) --') + '</option>';
    if (pilihan && nama.indexOf(pilihan) === -1) {
      html += '<option value="' + esc(pilihan) + '">' + esc(pilihan) + ' (data lama)</option>';
    }
    nama.forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>'; });
    selKel.innerHTML = html;
    selKel.value = pilihan;
    selKel.disabled = false;
    selKel.dataset.terisi = kec;
  }

  selKel.disabled = true;
  selKel.innerHTML = '<option value="' + esc(awal) + '">Memuat kelurahan...</option>';
  google.script.run
    .withSuccessHandler(function (daftar) { isi(Array.isArray(daftar) ? daftar : [], false); })
    .withFailureHandler(function () {
      // Data cache sudah tampil lalu revalidasi gagal -> pertahankan daftar yang ada.
      if (selKel.dataset.kecamatan !== kec || selKel.dataset.terisi === kec) return;
      isi([], true);
      tampilkanToast('Daftar kelurahan gagal dimuat. Coba pilih ulang kecamatan.', 'gagal');
    })
    .getKelurahanByKecamatan(dataPengguna.token, kec);
}

// Atur tampilan field kecamatan/kelurahan sesuai role — dipakai modal Tambah (prefix 'tu') & Edit ('eu').
function aturFieldWilayahAkun(prefix, role, kecamatanAwal, kelurahanAwal) {
  const divKec = document.getElementById(prefix + '-div-kecamatan');
  const selKec = document.getElementById(prefix + '-kecamatan');
  const tandaWajib = document.getElementById(prefix + '-wajib-kecamatan');
  const info = document.getElementById(prefix + '-info-kecamatan');
  const divKel = document.getElementById(prefix + '-div-kelurahan');
  const selKel = document.getElementById(prefix + '-kelurahan');
  if (!divKec || !selKec) return;

  const pakaiKec = roleMemerlukanKecamatan(role);
  const wajibKec = roleWajibKecamatan(role);
  divKec.classList.toggle('hidden', !pakaiKec);
  selKec.required = wajibKec;
  if (tandaWajib) tandaWajib.classList.toggle('hidden', !wajibKec);
  if (info) info.classList.toggle('hidden', !pakaiKec || wajibKec);
  const opsiKosong = selKec.querySelector('option[value=""]');
  if (opsiKosong) opsiKosong.textContent = wajibKec ? '-- Pilih Kecamatan --' : '-- Tidak ada (se-Kota Medan) --';
  if (kecamatanAwal !== undefined) selKec.value = pakaiKec ? (kecamatanAwal || '') : '';
  if (!pakaiKec) selKec.value = '';

  const pakaiKel = roleMemakaiKelurahan(role);
  if (divKel) divKel.classList.toggle('hidden', !pakaiKel);
  if (selKel) {
    if (pakaiKel) {
      muatOpsiKelurahanAkun(selKel, selKec.value, kelurahanAwal);
    } else {
      muatOpsiKelurahanAkun(selKel, '', '');
    }
  }
}

function labelRolePengguna(role) {
  const nilai = String(role || '').trim().toUpperCase();
  const ditemukan = PILIHAN_ROLE_PENGGUNA.find(function (pilihan) { return pilihan.nilai === nilai; });
  return ditemukan ? ditemukan.label : nilai;
}

let daftarAkunLengkapCache = [];

isiPilihanRoleKelolaPengguna();

let nomorPermintaanDaftarAkun = 0;

// senyap=true dipakai refresh realtime: tabel lama tetap tampil (tidak berkedip "Memuat...") dan
// kegagalan tidak menimpa tabel yang sudah ada.
function muatDaftarUserLengkap(senyap) {
  const tbody = document.getElementById('tbody-kelola-user');
  const loader = document.getElementById('loader-kelola-user');
  const nomor = ++nomorPermintaanDaftarAkun;
  clearTimeout(window.__timerSegarKelolaAkun);
  if (!senyap) {
    if (loader) loader.classList.remove('hidden');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-slate-400 italic">Memuat data pengguna...</td></tr>';
  }

  google.script.run
    .withSuccessHandler(function (res) {
      if (nomor !== nomorPermintaanDaftarAkun) return; // sudah ada permintaan yang lebih baru
      if (loader) loader.classList.add('hidden');
      if (!res || !res.sukses) {
        if (!senyap && tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500 font-semibold">' + esc(res ? res.pesan : 'Gagal memuat') + '</td></tr>';
        return;
      }
      daftarAkunLengkapCache = res.daftar || [];
      filterTabelKelolaUser(); // hormati kata kunci & filter role yang sedang aktif
    })
    .withFailureHandler(function (err) {
      if (nomor !== nomorPermintaanDaftarAkun) return;
      if (loader) loader.classList.add('hidden');
      if (!senyap && tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500 font-semibold">Error: ' + esc(err && err.message ? err.message : err) + '</td></tr>';
    })
    .ambilDaftarAkunLengkap(dataPengguna.token);
}

function renderTabelKelolaUser(list) {
  const tbody = document.getElementById('tbody-kelola-user');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-slate-400 italic">Tidak ada akun yang sesuai kriteria pencarian.</td></tr>';
    return;
  }

  let html = '';
  list.forEach(function (u, idx) {
    const roleBadgeColor = u.role === 'UTAMA' ? 'bg-purple-100 text-purple-700 border-purple-200' : (u.role === 'KECAMATAN' ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-amber-100 text-amber-700 border-amber-200');
    html += `<tr class="hover:bg-slate-50 transition border-b border-slate-100">
      <td class="px-3 py-2.5 text-xs text-slate-500 text-center">${idx + 1}</td>
      <td class="px-3 py-2.5 text-xs font-bold text-slate-800">${esc(u.username)}</td>
      <td class="px-3 py-2.5 text-xs text-slate-700 font-medium">${esc(u.namaLengkap || '-')}</td>
      <td class="px-3 py-2.5 text-xs"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${roleBadgeColor}">${esc(labelRolePengguna(u.role))}</span></td>
      <td class="px-3 py-2.5 text-xs text-slate-600">${esc(u.kecamatan || '-')}${u.kelurahan ? '<div class="text-[10px] text-slate-500">Kel. ' + esc(u.kelurahan) + '</div>' : ''}</td>
      <td class="px-3 py-2.5 text-xs text-slate-600 font-mono">${esc(u.nomorHp || '-')}</td>
      <td class="px-3 py-2.5 text-xs text-center">
        <div class="flex items-center justify-center gap-1.5 whitespace-nowrap">
          <button onclick="bukaModalEditUser('${esc(u.username)}')" class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200/80 rounded-md font-semibold text-[11px] transition flex items-center gap-1" title="Edit Akun">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            <span>Edit</span>
          </button>
          <button onclick="bukaModalResetSandiUser('${esc(u.username)}')" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/80 rounded-md font-semibold text-[11px] transition flex items-center gap-1" title="Reset Password">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            <span>Reset</span>
          </button>
          <button onclick="konfirmasiHapusUser('${esc(u.username)}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200/80 rounded-md font-semibold text-[11px] transition flex items-center gap-1" title="Hapus Akun">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span>Hapus</span>
          </button>
        </div>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

function filterTabelKelolaUser() {
  const q = (document.getElementById('cari-kelola-user')?.value || '').trim().toLowerCase();
  const r = (document.getElementById('filter-role-kelola-user')?.value || '').trim().toUpperCase();

  const filtered = daftarAkunLengkapCache.filter(function (u) {
    const matchRole = !r || (u.role || '').toUpperCase() === r;
    const matchQuery = !q || (u.username || '').toLowerCase().includes(q) || (u.namaLengkap || '').toLowerCase().includes(q) || (u.kecamatan || '').toLowerCase().includes(q) || (u.kelurahan || '').toLowerCase().includes(q);
    return matchRole && matchQuery;
  });

  renderTabelKelolaUser(filtered);
}

function bukaModalTambahUser() {
  const modal = document.getElementById('modal-tambah-user');
  if (!modal) return;
  document.getElementById('form-tambah-user')?.reset();
  document.getElementById('tu-pesan')?.classList.add('hidden');
  handleRoleTambahUserChange();
  modal.classList.remove('hidden');
}

function handleRoleTambahUserChange() {
  const selRole = document.getElementById('tu-role');
  if (!selRole) return;
  aturFieldWilayahAkun('tu', selRole.value, undefined, '');
}

function handleKecamatanTambahUserChange() {
  const selRole = document.getElementById('tu-role');
  const selKec = document.getElementById('tu-kecamatan');
  if (!selRole || !selKec || !roleMemakaiKelurahan(selRole.value)) return;
  muatOpsiKelurahanAkun(document.getElementById('tu-kelurahan'), selKec.value, '');
}

// Kelurahan masih dimuat untuk kecamatan terpilih -> jangan kirim dulu (nilainya belum pasti).
function kelurahanAkunBelumSiap(prefix, role, kecamatan) {
  if (!roleMemakaiKelurahan(role) || !kecamatan) return false;
  const selKel = document.getElementById(prefix + '-kelurahan');
  return !!selKel && selKel.dataset.terisi !== String(kecamatan).trim().toUpperCase();
}

function simpanPenggunaBaru(e) {
  if (e) e.preventDefault();
  const uName = (document.getElementById('tu-username')?.value || '').trim();
  const pass = (document.getElementById('tu-password')?.value || '').trim();
  const role = (document.getElementById('tu-role')?.value || '').trim();
  const kec = roleMemerlukanKecamatan(role) ? (document.getElementById('tu-kecamatan')?.value || '').trim() : '';
  const kel = roleMemakaiKelurahan(role) ? (document.getElementById('tu-kelurahan')?.value || '').trim() : '';
  const nama = (document.getElementById('tu-nama')?.value || '').trim();
  const hp = (document.getElementById('tu-hp')?.value || '').trim();
  const jbt = (document.getElementById('tu-jabatan')?.value || '').trim();
  const btn = document.getElementById('btn-simpan-tambah-user');
  const pesanEl = document.getElementById('tu-pesan');

  if (!uName || !pass || !role) {
    tampilkanToast('Mohon lengkapi username, password, dan role!', 'gagal');
    return;
  }
  if (roleWajibKecamatan(role) && !kec) {
    tampilkanToast('Kecamatan wajib dipilih untuk role yang dipilih!', 'gagal');
    return;
  }
  if (kelurahanAkunBelumSiap('tu', role, kec)) {
    tampilkanToast('Daftar kelurahan masih dimuat, tunggu sebentar.', 'gagal');
    return;
  }

  const labelTombol = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'MENYIMPAN...'; }
  if (pesanEl) pesanEl.classList.add('hidden');

  const payload = { username: uName, password: pass, role: role, kecamatan: kec, kelurahan: kel, namaLengkap: nama, nomorHp: hp, jabatan: jbt };

  google.script.run
    .withSuccessHandler(function (res) {
      if (btn) { btn.disabled = false; btn.innerHTML = labelTombol; }
      if (res && res.sukses) {
        tampilkanToast(res.pesan, 'sukses');
        document.getElementById('modal-tambah-user')?.classList.add('hidden');
        segarkanDaftarAkunSetelahMutasi();
      } else {
        if (pesanEl) { pesanEl.textContent = res ? res.pesan : 'Gagal menambah user.'; pesanEl.className = 'text-xs font-semibold p-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200'; pesanEl.classList.remove('hidden'); }
      }
    })
    .withFailureHandler(function (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = labelTombol; }
      tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
    })
    .tambahUserBaru(dataPengguna.token, payload);
}

function bukaModalEditUser(username) {
  const u = daftarAkunLengkapCache.find(function (x) { return x.username === username; });
  if (!u) return;

  const modal = document.getElementById('modal-edit-user');
  if (!modal) return;

  document.getElementById('eu-username-target').value = u.username;
  document.getElementById('eu-username-display').textContent = u.username;
  const selRole = document.getElementById('eu-role');
  const roleResmi = PILIHAN_ROLE_PENGGUNA.some(function (role) { return role.nilai === u.role; });
  if (selRole) selRole.value = roleResmi ? u.role : '';
  document.getElementById('eu-nama').value = u.namaLengkap || '';
  document.getElementById('eu-hp').value = u.nomorHp || '';
  document.getElementById('eu-jabatan').value = u.jabatan || '';

  aturFieldWilayahAkun('eu', roleResmi ? u.role : '', u.kecamatan || '', u.kelurahan || '');

  const pesanEl = document.getElementById('eu-pesan');
  if (roleResmi) {
    pesanEl?.classList.add('hidden');
  } else if (pesanEl) {
    pesanEl.textContent = 'Akun ini masih memakai role lama "' + (u.role || '-') + '". Pilih salah satu dari tujuh role resmi sebelum menyimpan perubahan.';
    pesanEl.className = 'text-xs font-semibold p-2.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200';
    pesanEl.classList.remove('hidden');
  }
  modal.classList.remove('hidden');
}

function handleRoleEditUserChange() {
  const selRole = document.getElementById('eu-role');
  const selKec = document.getElementById('eu-kecamatan');
  const selKel = document.getElementById('eu-kelurahan');
  if (!selRole) return;
  // Pertahankan kecamatan/kelurahan yang sudah terpilih saat role diganti bolak-balik.
  aturFieldWilayahAkun('eu', selRole.value, selKec ? selKec.value : '', selKel ? selKel.value : '');
}

function handleKecamatanEditUserChange() {
  const selRole = document.getElementById('eu-role');
  const selKec = document.getElementById('eu-kecamatan');
  if (!selRole || !selKec || !roleMemakaiKelurahan(selRole.value)) return;
  muatOpsiKelurahanAkun(document.getElementById('eu-kelurahan'), selKec.value, '');
}

function simpanPerubahanUser(e) {
  if (e) e.preventDefault();
  const target = document.getElementById('eu-username-target')?.value;
  const role = document.getElementById('eu-role')?.value;
  const kec = roleMemerlukanKecamatan(role) ? (document.getElementById('eu-kecamatan')?.value || '') : '';
  const kel = roleMemakaiKelurahan(role) ? (document.getElementById('eu-kelurahan')?.value || '') : '';
  const nama = document.getElementById('eu-nama')?.value;
  const hp = document.getElementById('eu-hp')?.value;
  const jbt = document.getElementById('eu-jabatan')?.value;
  const btn = document.getElementById('btn-simpan-edit-user');
  const pesanEl = document.getElementById('eu-pesan');

  if (!role) {
    tampilkanToast('Pilih salah satu role resmi sebelum menyimpan perubahan.', 'gagal');
    return;
  }
  if (roleWajibKecamatan(role) && !kec) {
    tampilkanToast('Kecamatan wajib dipilih untuk role yang dipilih!', 'gagal');
    return;
  }
  if (kelurahanAkunBelumSiap('eu', role, kec)) {
    tampilkanToast('Daftar kelurahan masih dimuat, tunggu sebentar.', 'gagal');
    return;
  }

  const labelTombol = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'MENYIMPAN...'; }

  const payload = { role: role, kecamatan: kec, kelurahan: kel, namaLengkap: nama, nomorHp: hp, jabatan: jbt };

  google.script.run
    .withSuccessHandler(function (res) {
      if (btn) { btn.disabled = false; btn.innerHTML = labelTombol; }
      if (res && res.sukses) {
        tampilkanToast(res.pesan, 'sukses');
        document.getElementById('modal-edit-user')?.classList.add('hidden');
        segarkanDaftarAkunSetelahMutasi();
      } else {
        if (pesanEl) { pesanEl.textContent = res ? res.pesan : 'Gagal mengubah user.'; pesanEl.className = 'text-xs font-semibold p-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200'; pesanEl.classList.remove('hidden'); }
      }
    })
    .withFailureHandler(function (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = labelTombol; }
      tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
    })
    .ubahDataUserOlehAdmin(dataPengguna.token, target, payload);
}

// Reset password user LAIN lewat modal khusus. Sengaja tidak memakai modal "Akun Saya"
// (modal-ganti-password): form utama di sana mengganti password akun yang sedang login, dan
// dulu admin tanpa sengaja mengganti password akunnya sendiri lewat jalur ini.
function bukaModalResetSandiUser(username) {
  const modal = document.getElementById('modal-reset-sandi-user');
  if (!modal || !username) return;
  if (String(username).toLowerCase() === String(dataPengguna.username || '').toLowerCase()) {
    tampilkanToast('Untuk akun Anda sendiri, gunakan menu Akun Saya.', 'gagal');
    return;
  }
  const u = daftarAkunLengkapCache.find(function (x) { return x.username === username; }) || {};
  document.getElementById('rsu-username-target').value = username;
  document.getElementById('rsu-username-display').textContent = username;
  const ket = [labelRolePengguna(u.role), u.kecamatan, u.kelurahan ? 'Kel. ' + u.kelurahan : '', u.namaLengkap]
    .filter(Boolean).join(' · ');
  document.getElementById('rsu-keterangan').textContent = ket;
  const elPass = document.getElementById('rsu-pass');
  if (elPass) elPass.value = '';
  document.getElementById('rsu-pesan')?.classList.add('hidden');
  modal.classList.remove('hidden');
  if (elPass) elPass.focus();
}

function buatPasswordSementaraAcak() {
  // Tanpa karakter ambigu (0/O, 1/l/I) supaya mudah didiktekan ke user.
  const huruf = 'abcdefghjkmnpqrstuvwxyz';
  const angka = '23456789';
  const acak = function (n) {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  let hasil = '';
  for (let i = 0; i < 5; i++) hasil += huruf[acak(huruf.length)];
  for (let i = 0; i < 3; i++) hasil += angka[acak(angka.length)];
  const elPass = document.getElementById('rsu-pass');
  if (elPass) elPass.value = hasil;
}

function simpanResetSandiUser(e) {
  if (e) e.preventDefault();
  if (!pastikanLogin()) return;
  const target = (document.getElementById('rsu-username-target')?.value || '').trim();
  const pass = (document.getElementById('rsu-pass')?.value || '').trim();
  const btn = document.getElementById('btn-simpan-reset-sandi-user');
  const pesanEl = document.getElementById('rsu-pesan');
  const tampilPesan = function (teks, sukses) {
    if (!pesanEl) return;
    pesanEl.textContent = teks;
    pesanEl.className = 'text-xs font-semibold p-2.5 rounded-lg border ' + (sukses ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200');
  };

  if (!target) { tampilPesan('User target tidak valid. Tutup dan buka ulang dari tabel.', false); return; }
  if (target.toLowerCase() === String(dataPengguna.username || '').toLowerCase()) {
    tampilPesan('Untuk akun Anda sendiri, gunakan menu Akun Saya.', false); return;
  }
  if (pass.length < 6) { tampilPesan('Password sementara minimal 6 karakter.', false); return; }
  if (!/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass)) { tampilPesan('Password sementara harus mengandung huruf dan angka.', false); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'MERESET...'; }
  google.script.run
    .withSuccessHandler(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'RESET PASSWORD'; }
      if (res && res.sukses) {
        tampilPesan(res.pesan + ' Password sementara: ' + pass, true);
        tampilkanToast('Password "' + target + '" berhasil direset.', 'sukses');
      } else {
        tampilPesan(res ? res.pesan : 'Gagal reset.', false);
      }
    })
    .withFailureHandler(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'RESET PASSWORD'; }
      tampilPesan('Error: ' + (err && err.message ? err.message : err), false);
    })
    .resetPasswordUser(dataPengguna.token, target, pass);
}

// muatDaftarUser() (dropdown reset/ubah profil di modal Akun Saya) hidup di dalam IIFE "Akun Saya"
// dan diekspos lewat window — dulu dipanggil langsung di sini sehingga melempar ReferenceError
// setelah simpan berhasil.
function segarkanDaftarAkunSetelahMutasi() {
  muatDaftarUserLengkap();
  if (typeof window.muatDaftarUser === 'function') window.muatDaftarUser();
}

function konfirmasiHapusUser(username) {
  konfirmasiAksi({
    judul: "Hapus Akun Pengguna",
    pesan: "Apakah Anda yakin ingin MENGHAPUS akun pengguna \"" + username + "\"?\n\nTindakan ini bersifat permanen dan tidak dapat dibatalkan!",
    tipe: "danger",
    teksBatal: "Batal",
    teksKonfirmasi: "Ya, Hapus Akun"
  }).then(function (setuju) {
    if (!setuju) return;
    tampilkanToast('Menghapus akun ' + username + '...', 'proses');

    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.sukses) {
          tampilkanToast(res.pesan, 'sukses');
          segarkanDaftarAkunSetelahMutasi();
        } else {
          tampilkanToast(res ? res.pesan : 'Gagal menghapus user.', 'gagal');
        }
      })
      .withFailureHandler(function (err) {
        tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
      })
      .hapusUser(dataPengguna.token, username);
  });
}

window.muatDaftarUserLengkap = muatDaftarUserLengkap;
window.bukaModalTambahUser = bukaModalTambahUser;
window.bukaModalEditUser = bukaModalEditUser;
window.bukaModalResetSandiUser = bukaModalResetSandiUser;
window.simpanResetSandiUser = simpanResetSandiUser;
window.buatPasswordSementaraAcak = buatPasswordSementaraAcak;
window.handleKecamatanTambahUserChange = handleKecamatanTambahUserChange;
window.handleKecamatanEditUserChange = handleKecamatanEditUserChange;
window.konfirmasiHapusUser = konfirmasiHapusUser;

// Realtime CDC & Status Badge
(function initDjpmRealtimeSync() {
  const SUPABASE_URL = 'https://wwqxbscumaakvziwzwjx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cXhic2N1bWFha3Z6aXd6d2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjQ2MTMsImV4cCI6MjEwNDEwMDYxM30.W0hJsUzcnYaOWfF-NHKR1F3RnJR8j-vJsDDqBF636hQ';

  function updateStatusBadge(status) {
    const badge = document.getElementById('badge-realtime-status');
    if (!badge) return;

    if (status === 'connected') {
      badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm transition-all duration-300';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span id="label-realtime-status">Realtime Sync</span>';
      badge.title = 'Realtime Smart Sync Terhubung (Supabase & SWR)';
    } else if (status === 'connecting') {
      badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm transition-all duration-300';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span><span id="label-realtime-status">Menghubungkan...</span>';
      badge.title = 'Menghubungkan ke Realtime Sync...';
    } else {
      badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/20 text-slate-400 border border-slate-500/30 shadow-sm transition-all duration-300';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span><span id="label-realtime-status">SWR Mode</span>';
      badge.title = 'Realtime Cloud Terputus (Mode SWR & Cross-Tab Tetap Aktif)';
    }
  }

  window.addEventListener('djpm:swr-invalidated', function (ev) {
    const domains = (ev.detail && ev.detail.domains) || [];
    const isAll = domains.includes('*');

    if (isAll || domains.includes('dashboard')) {
      if (typeof cacheDashboardProgres !== 'undefined') cacheDashboardProgres = {};
      const modalDashboard = document.getElementById('modal-dashboard-progres');
      if (modalDashboard && !modalDashboard.classList.contains('hidden') && typeof muatDashboardProgres === 'function') {
        muatDashboardProgres();
      }
    }

    if (isAll || domains.includes('penerima')) {
      if (typeof panelAktif !== 'undefined' && panelAktif === 'rekap') {
        const modalDetail = document.getElementById('modal-detail-penerima');
        if (!modalDetail || modalDetail.classList.contains('hidden')) {
          if (typeof inisialisasiMenuLihatData === 'function') inisialisasiMenuLihatData();
        }
      }
    }

    if (isAll || domains.includes('arsip_tahun')) {
      if (typeof window.segarkanDataTahunHistoris === 'function') {
        window.segarkanDataTahunHistoris('2026');
      }
    }

    if (isAll || domains.includes('kuota')) {
      const modalKuota = document.getElementById('modal-kelola-kuota');
      if (modalKuota && !modalKuota.classList.contains('hidden') && typeof muatDaftarKuota === 'function') {
        muatDaftarKuota();
      }
      // Modal "Progres Kuota" -- domain sama dengan Kelola Kuota, tapi selama ini belum
      // ikut auto-refresh kalau sedang terbuka. Tab yang sedang aktif (Kecamatan/Kemenag)
      // sengaja TIDAK direset supaya posisi pengguna tidak berpindah tiba-tiba.
      const modalProgresKuota = document.getElementById('modal-progres-kuota');
      if (modalProgresKuota && !modalProgresKuota.classList.contains('hidden') && typeof muatProgresKuota === 'function') {
        muatProgresKuota();
      }
    }

    // Modal "Data Detail" (rekap Memenuhi Syarat) -- domain sama yang dipakai
    // verifikasiSatuData/tandaiSudahDiperbaiki/verifikasiMassalMemenuhiSyarat untuk invalidasi.
    if (isAll || domains.includes('data_detail')) {
      const modalDataDetail = document.getElementById('modal-data-detail');
      if (modalDataDetail && !modalDataDetail.classList.contains('hidden') && typeof muatDataDetail === 'function') {
        muatDataDetail(true);
      }
    }

    if (isAll || domains.includes('setelan')) {
      if (typeof window.muatStatusSakelar === 'function') {
        const sakelarSec = document.getElementById('gp-sakelar-section');
        if (sakelarSec && !sakelarSec.classList.contains('hidden')) window.muatStatusSakelar();
      }
      if (typeof window.periksaStatusAkses === 'function') {
        window.periksaStatusAkses();
      }
    }

    // Kelola Akun -- admin lain (atau tab lain) menambah/mengubah/menghapus akun. Debounce karena
    // satu aksi bisa datang dari 2 jalur sekaligus (DB trigger event bus + broadcast antar-browser).
    if (isAll || domains.includes('akun')) {
      clearTimeout(window.__timerSegarKelolaAkun);
      window.__timerSegarKelolaAkun = setTimeout(function () {
        const modalKelola = document.getElementById('modal-kelola-user');
        if (modalKelola && !modalKelola.classList.contains('hidden') && typeof muatDaftarUserLengkap === 'function') {
          muatDaftarUserLengkap(true);
        }
        const resetSec = document.getElementById('gp-reset-section');
        const modalAkunSaya = document.getElementById('modal-ganti-password');
        if (resetSec && !resetSec.classList.contains('hidden') && modalAkunSaya && !modalAkunSaya.classList.contains('hidden') &&
          typeof window.muatDaftarUser === 'function') {
          window.muatDaftarUser();
        }
      }, 600);
    }

    // Pembaruan Realtime Langsung untuk Panel Input Data
    if (isAll || domains.includes('kuota') || domains.includes('penerima')) {
      if (typeof window.jalankanCekKuota === 'function') {
        const secInput = document.getElementById('panel-input');
        if (secInput && !secInput.classList.contains('hidden')) {
          window.jalankanCekKuota(true);
        }
      }
    }

    // Pembaruan Realtime Halaman Tools -- hanya bagian yang domainnya benar-benar
    // berubah yang dimuat ulang, supaya admin lain yang sedang membuka tab Tools
    // langsung melihat data terbaru tanpa perlu pindah tab atau refresh manual.
    if (typeof panelAktif !== 'undefined' && panelAktif === 'tools') {
      const secTools = document.getElementById('panel-tools');
      if (secTools && !secTools.classList.contains('hidden')) {
        if ((isAll || domains.includes('tools_batch')) && typeof toolsMuatDaftarBatch === 'function') {
          toolsMuatDaftarBatch();
        }
        if ((isAll || domains.includes('tools_pejabat')) && typeof toolsMuatPejabat === 'function') {
          toolsMuatPejabat();
        }
        if ((isAll || domains.includes('tools_referensi_sk')) && typeof toolsMuatReferensiSk === 'function') {
          toolsMuatReferensiSk();
        }
        if ((isAll || domains.includes('tools_sk_layanan')) && typeof toolsMuatSkLayanan === 'function') {
          toolsMuatSkLayanan();
        }
      }
    }
  });

  if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
    try {
      updateStatusBadge('connecting');
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 10 } },
      });

      const channel = client.channel('djpm-sync');

      // Reconnect terjadwal dengan backoff -- sebelumnya SATU-SATUNYA jalur reconnect adalah
      // event 'online' (perangkat balik konek internet). Itu TIDAK menutupi kasus paling umum:
      // channel drop diam-diam karena blip sisi server Supabase, token realtime kedaluwarsa,
      // atau browser menangguhkan WebSocket saat tab di-background lama (banyak terjadi di
      // mobile) -- semuanya terjadi TANPA internet benar-benar putus, jadi event 'online' tidak
      // pernah menyala dan badge tersangkut "SWR Mode" selamanya sampai halaman di-refresh manual.
      let percobaanReconnect = 0;
      let timerReconnect = null;

      function reconnectSekarang() {
        if (timerReconnect) { clearTimeout(timerReconnect); timerReconnect = null; }
        if (!channel || channel.state === 'joined' || channel.state === 'joining') return;
        updateStatusBadge('connecting');
        channel.subscribe();
      }

      function jadwalkanReconnect() {
        if (timerReconnect) return; // sudah ada percobaan terjadwal, jangan ditumpuk
        const jeda = Math.min(30000, 3000 * Math.pow(2, percobaanReconnect)); // backoff, maks 30 detik
        percobaanReconnect++;
        timerReconnect = setTimeout(function () {
          timerReconnect = null;
          reconnectSekarang();
        }, jeda);
      }

      // 1. Tangkap perubahan dari Database via Event Bus Bebas-PII (CDC Realtime)
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_event_bus' }, function (payload) {
          const domain = (payload && payload.new && payload.new.domain) || '*';
          if (window.djpmCache) {
            if (domain === 'penerima') {
              window.djpmCache.invalidate(['penerima', 'dashboard', 'kuota'], false);
            } else if (domain === 'data_detail') {
              window.djpmCache.invalidate(['penerima_detail', 'dashboard', 'data_detail'], false);
            } else if (domain === 'kuota') {
              window.djpmCache.invalidate(['kuota', 'dashboard'], false);
            } else if (domain === 'arsip_tahun') {
              window.djpmCache.invalidate(['arsip_tahun', 'data_detail', 'penerima'], false);
            } else if (domain === 'akun') {
              // Daftar sakelar per-user (domain setelan) ikut memuat role/kecamatan/user_id akun.
              window.djpmCache.invalidate(['akun', 'setelan'], false);
            } else {
              window.djpmCache.invalidate([domain], false);
            }
          }
        })
        // 2. Tangkap penyiaran langsung antar-browser (Instant Web Broadcast)
        .on('broadcast', { event: 'MUTATION' }, function (msg) {
          const payload = msg && msg.payload;
          const domains = (payload && payload.domains) || ['*'];
          if (window.djpmCache) window.djpmCache.invalidate(domains, false);
        })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            percobaanReconnect = 0;
            if (timerReconnect) { clearTimeout(timerReconnect); timerReconnect = null; }
            updateStatusBadge('connected');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            updateStatusBadge('offline');
            jadwalkanReconnect();
          } else {
            // Pada saat inisialisasi awal, jangan membuat badge berkedip ke amber jika koneksi belum error
            if (percobaanReconnect > 0) {
              updateStatusBadge('connecting');
            }
          }
        });

      // Reconnect langsung (tanpa nunggu jadwal backoff) begitu tab kembali terlihat/fokus ATAU
      // perangkat balik online -- 'djpm:swr-window-focus' dari api-bridge.js sudah menyatukan
      // kedua sinyal itu (sebelumnya event ini di-dispatch tapi TIDAK ADA yang mendengarkan sama
      // sekali, jadi reconnect otomatis saat tab dibuka lagi tidak pernah benar-benar terjadi).
      window.addEventListener('djpm:swr-window-focus', reconnectSekarang);

      window.djpmRealtimeChannel = channel;
      window.djpmSupabaseClient = client;
    } catch (err) {
      console.warn('[Realtime] Gagal inisialisasi Supabase Realtime:', err);
      updateStatusBadge('offline');
    }
  } else {
    updateStatusBadge('offline');
  }
})();

// =========================================================================
// MODUL CRUD DATA RUMAH IBADAH KHUSUS ADMIN UTAMA (SUPERADMIN)
// =========================================================================

var _LIST_KECAMATAN_MEDAN = (typeof DAFTAR_KECAMATAN_MEDAN !== 'undefined' && Array.isArray(DAFTAR_KECAMATAN_MEDAN))
  ? DAFTAR_KECAMATAN_MEDAN
  : [
    'MEDAN AMPLAS', 'MEDAN AREA', 'MEDAN BARAT', 'MEDAN BARU', 'MEDAN BELAWAN',
    'MEDAN DELI', 'MEDAN DENAI', 'MEDAN HELVETIA', 'MEDAN JOHOR', 'MEDAN KOTA',
    'MEDAN LABUHAN', 'MEDAN MAIMUN', 'MEDAN MARELAN', 'MEDAN PERJUANGAN',
    'MEDAN PETISAH', 'MEDAN POLONIA', 'MEDAN SELAYANG', 'MEDAN SUNGGAL',
    'MEDAN TEMBUNG', 'MEDAN TIMUR', 'MEDAN TUNTUNGAN'
  ];

var DAFTAR_JENIS_IBADAH_ADMIN = [
  { val: 'MASJID', label: 'Masjid' },
  { val: 'MUSHOLLA', label: 'Musholla' },
  { val: 'GEREJA', label: 'Gereja' },
  { val: 'GEREJA_KATOLIK', label: 'Gereja Katolik' },
  { val: 'VIHARA', label: 'Vihara' },
  { val: 'KLENTENG', label: 'Klenteng' },
  { val: 'KUIL', label: 'Kuil' }
];

let _halamanRiAktif = 1;
let _totalHalamanRi = 1;
let _timerDebounceRi = null;
let _cacheBarisRi = {};

function badgeJenisRumahIbadah(jenis) {
  const j = String(jenis || '').toUpperCase();
  if (j === 'MASJID') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">MASJID</span>';
  if (j === 'MUSHOLLA') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-teal-50 text-teal-700 border border-teal-200">MUSHOLLA</span>';
  if (j === 'GEREJA') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-sky-50 text-sky-700 border border-sky-200">GEREJA</span>';
  if (j === 'GEREJA_KATOLIK') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">GEREJA KATOLIK</span>';
  if (j === 'VIHARA') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200">VIHARA</span>';
  if (j === 'KLENTENG') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200">KLENTENG</span>';
  if (j === 'KUIL') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-orange-50 text-orange-700 border border-orange-200">KUIL</span>';
  if (j === 'VIHARA_KLENTENG_KUIL' || j === 'PGK') return '<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-800 border border-amber-300">PERLU KLASIFIKASI</span>';
  return `<span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200">${typeof esc === 'function' ? esc(j) : j}</span>`;
}

function pastikanModalRumahIbadahSiap() {
  if (document.getElementById('modal-kelola-rumah-ibadah')) return;

  const target = document.getElementById('container-modal-rumah-ibadah') || document.body;
  const optJenis = DAFTAR_JENIS_IBADAH_ADMIN.map(j => `<option value="${j.val}">${j.label}</option>`).join('');
  const optKec = _LIST_KECAMATAN_MEDAN.map(k => `<option value="${k}">${k}</option>`).join('');

  target.insertAdjacentHTML('beforeend', `
    <!-- Modal Utama: Manajemen Data Rumah Ibadah -->
    <div id="modal-kelola-rumah-ibadah" class="hidden fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4" onclick="if(event.target===this)this.classList.add('hidden')">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl border border-slate-100 overflow-hidden max-h-[90vh] max-h-[90dvh] flex flex-col">
        <!-- Header -->
        <div class="flex justify-between items-center px-5 sm:px-6 py-4 bg-slate-800 text-white shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-bold tracking-wide uppercase">Manajemen Data Rumah Ibadah</h3>
              <p class="text-[11px] text-slate-300">Kelola master data rumah ibadah se-Kota Medan secara terpusat</p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('modal-kelola-rumah-ibadah').classList.add('hidden')" class="text-white/70 hover:text-white text-2xl leading-none transition">&times;</button>
        </div>

        <!-- Filter & Toolbar (Full Responsive: Mobile, Tablet, Desktop) -->
        <div class="p-3.5 sm:p-5 border-b border-slate-100 bg-slate-50 shrink-0 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 sm:gap-3">
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 min-w-0">
            <div class="relative flex-1 min-w-0">
              <input type="text" id="cari-kelola-ri" placeholder="Cari tempat ibadah, alamat, kelurahan..." oninput="filterTabelRumahIbadah()"
                class="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white" style="text-transform:none">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div class="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
              <select id="filter-jenis-kelola-ri" onchange="filterTabelRumahIbadah()"
                class="w-full sm:w-auto px-2.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
                <option value="">Semua Jenis</option>
                ${optJenis}
              </select>
              <select id="filter-kecamatan-kelola-ri" onchange="filterTabelRumahIbadah()"
                class="w-full sm:w-auto px-2.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
                <option value="">Semua Kecamatan</option>
                ${optKec}
              </select>
              <select id="filter-status-klasifikasi-ri" onchange="filterTabelRumahIbadah()"
                class="w-full sm:w-auto px-2.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
                <option value="">Semua Status</option>
                <option value="PERLU_KLASIFIKASI">Perlu Klasifikasi</option>
                <option value="SELESAI">Sudah Diklasifikasi</option>
              </select>
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 shrink-0">
            <button type="button" onclick="muatDaftarRumahIbadahAdmin(_halamanRiAktif)"
              class="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 active:scale-95">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Muat Ulang</span>
            </button>
            <button type="button" onclick="bukaModalTambahRumahIbadah()"
              class="flex-1 sm:flex-initial justify-center px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Tambah Rumah Ibadah</span>
            </button>
          </div>
        </div>

        <!-- Tabel Data (Scroll Horizontal Halus di Mobile) -->
        <div class="flex-1 overflow-y-auto p-3 sm:p-5 overscroll-contain">
          <div class="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
            <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead>
                <tr class="bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider select-none">
                  <th class="px-3 py-2.5 text-center w-12">No</th>
                  <th class="px-3 py-2.5">Jenis</th>
                  <th class="px-3 py-2.5">Nama Tempat Ibadah</th>
                  <th class="px-3 py-2.5">Kecamatan</th>
                  <th class="px-3 py-2.5">Kelurahan</th>
                  <th class="px-3 py-2.5">Alamat</th>
                  <th class="px-3 py-2.5 text-center w-36">Aksi</th>
                </tr>
              </thead>
              <tbody id="tbody-kelola-ri" class="divide-y divide-slate-100 bg-white text-slate-700">
                <tr><td colspan="7" class="text-center py-8 text-slate-400 italic">Memuat data rumah ibadah...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="loader-kelola-ri" class="hidden flex justify-center items-center py-4">
            <div class="loader w-6 h-6 border-2"></div>
          </div>
        </div>

        <!-- Footer & Paginasi (Full Responsive) -->
        <div class="px-4 sm:px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-2.5 sm:gap-3 shrink-0">
          <span id="info-total-kelola-ri" class="text-xs text-slate-500 font-medium text-center sm:text-left">Total: 0 data</span>
          <div class="flex items-center justify-center gap-1.5 sm:gap-2 flex-wrap">
            <button type="button" id="btn-prev-page-ri" onclick="gantiHalamanRi(-1)"
              class="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Sebelumnya</span>
            </button>
            <span id="label-halaman-ri" class="text-xs font-semibold text-slate-700 px-2.5 py-1 bg-white border border-slate-200 rounded-lg shadow-xs">1 / 1</span>
            <button type="button" id="btn-next-page-ri" onclick="gantiHalamanRi(1)"
              class="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
              <span>Berikutnya</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button type="button" onclick="document.getElementById('modal-kelola-rumah-ibadah').classList.add('hidden')"
              class="ml-1 sm:ml-2 px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition">
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Form Tambah / Edit Rumah Ibadah (Full Responsive) -->
    <div id="modal-form-rumah-ibadah" class="hidden fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4" onclick="if(event.target===this)this.classList.add('hidden')">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden max-h-[92vh] max-h-[92dvh] flex flex-col">
        <div class="flex justify-between items-center px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-800 text-white shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h3 id="judul-modal-form-ri" class="text-sm font-bold tracking-wide uppercase">Tambah Rumah Ibadah Baru</h3>
              <p class="text-[11px] text-slate-300">Isi kelengkapan data rumah ibadah Kota Medan</p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('modal-form-rumah-ibadah').classList.add('hidden')" class="text-white/70 hover:text-white text-2xl leading-none transition">&times;</button>
        </div>
        <form id="form-modal-ri" onsubmit="simpanRumahIbadah(event)" class="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1">
          <input type="hidden" id="mri-id" value="">
          <div>
            <label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Jenis Rumah Ibadah <span class="text-red-500">*</span></label>
            <select id="mri-jenis" required class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
              <option value="">-- Pilih Jenis --</option>
              ${optJenis}
            </select>
          </div>
          <div id="mri-pesan" class="hidden text-xs font-semibold p-2.5 rounded-lg"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Kecamatan <span class="text-red-500">*</span></label>
              <select id="mri-kecamatan" required onchange="handleKecamatanFormRiChange()" class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
                <option value="">-- Pilih Kecamatan --</option>
                ${optKec}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Kelurahan <span class="text-red-500">*</span></label>
              <select id="mri-kelurahan" required class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
                <option value="">-- Pilih Kelurahan --</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Nama Tempat Ibadah <span class="text-red-500">*</span></label>
            <input type="text" id="mri-nama" required placeholder="Contoh: MASJID RAYA AL-MASHUN"
              class="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Alamat Lengkap</label>
            <textarea id="mri-alamat" rows="2" placeholder="Contoh: JL. MAHMUN AL RASYID NO. 1"
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 bg-white"></textarea>
          </div>
          <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button type="button" onclick="document.getElementById('modal-form-rumah-ibadah').classList.add('hidden')"
              class="flex-1 sm:flex-initial px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition text-center">Batal</button>
            <button type="submit" id="btn-submit-mri"
              class="flex-1 sm:flex-initial px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-lg shadow-sm transition text-center flex items-center justify-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>Simpan Data</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `);
}

function bukaModalKelolaRumahIbadah() {
  if (!dataPengguna || dataPengguna.role !== 'UTAMA') {
    if (typeof tampilkanToast === 'function') {
      tampilkanToast('Fitur Manajemen Rumah Ibadah hanya dapat diakses oleh Admin Utama.', 'gagal');
    }
    return;
  }
  pastikanModalRumahIbadahSiap();
  const m = document.getElementById('modal-kelola-rumah-ibadah');
  if (m) m.classList.remove('hidden');
  muatDaftarRumahIbadahAdmin(1);
}

function filterTabelRumahIbadah() {
  if (_timerDebounceRi) clearTimeout(_timerDebounceRi);
  _timerDebounceRi = setTimeout(() => {
    muatDaftarRumahIbadahAdmin(1);
  }, 280);
}

function gantiHalamanRi(arah) {
  const target = _halamanRiAktif + arah;
  if (target >= 1 && target <= _totalHalamanRi) {
    muatDaftarRumahIbadahAdmin(target);
  }
}

function muatDaftarRumahIbadahAdmin(page) {
  if (!dataPengguna || dataPengguna.role !== 'UTAMA') {
    if (typeof tampilkanToast === 'function') {
      tampilkanToast('Akses ditolak: Hanya Admin Utama yang memiliki wewenang.', 'gagal');
    }
    return;
  }
  pastikanModalRumahIbadahSiap();
  _halamanRiAktif = Math.max(1, page || 1);

  const tbody = document.getElementById('tbody-kelola-ri');
  const loader = document.getElementById('loader-kelola-ri');
  const cari = (document.getElementById('cari-kelola-ri')?.value || '').trim();
  const jenis = (document.getElementById('filter-jenis-kelola-ri')?.value || '').trim();
  const kecamatan = (document.getElementById('filter-kecamatan-kelola-ri')?.value || '').trim();
  const statusKlasifikasi = (document.getElementById('filter-status-klasifikasi-ri')?.value || '').trim();

  if (loader) loader.classList.remove('hidden');

  google.script.run
    .withSuccessHandler(function (res) {
      if (loader) loader.classList.add('hidden');
      if (!res || !res.sukses) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red-500 font-medium">Gagal memuat: ${typeof esc === 'function' ? esc(res ? res.pesan : 'Unknown') : 'Error'}</td></tr>`;
        return;
      }

      _totalHalamanRi = res.totalHalaman || 1;
      _cacheBarisRi = {};
      (res.daftar || []).forEach(row => { _cacheBarisRi[row.id] = row; });

      const infoTotal = document.getElementById('info-total-kelola-ri');
      if (infoTotal) infoTotal.textContent = `Total: ${(res.total || 0).toLocaleString('id-ID')} data rumah ibadah (Halaman ${_halamanRiAktif} dari ${_totalHalamanRi})`;

      const lblHalaman = document.getElementById('label-halaman-ri');
      if (lblHalaman) lblHalaman.textContent = `${_halamanRiAktif} / ${_totalHalamanRi}`;

      const btnPrev = document.getElementById('btn-prev-page-ri');
      const btnNext = document.getElementById('btn-next-page-ri');
      if (btnPrev) btnPrev.disabled = _halamanRiAktif <= 1;
      if (btnNext) btnNext.disabled = _halamanRiAktif >= _totalHalamanRi;

      if (!res.daftar || res.daftar.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400 italic">Tidak ada data rumah ibadah yang sesuai filter.</td></tr>';
        return;
      }

      const offset = (_halamanRiAktif - 1) * (res.limit || 25);
      if (tbody) {
        tbody.innerHTML = res.daftar.map((r, i) => `
          <tr class="hover:bg-slate-50/80 transition">
            <td class="px-3 py-2.5 text-center text-slate-400 font-mono">${offset + i + 1}</td>
            <td class="px-3 py-2.5">${badgeJenisRumahIbadah(r.jenis)}</td>
            <td class="px-3 py-2.5 font-bold text-slate-800">${typeof esc === 'function' ? esc(r.nama) : r.nama}</td>
            <td class="px-3 py-2.5 text-slate-600 font-medium">${typeof esc === 'function' ? esc(r.kecamatan) : r.kecamatan}</td>
            <td class="px-3 py-2.5 text-slate-600">${typeof esc === 'function' ? esc(r.kelurahan) : r.kelurahan}</td>
            <td class="px-3 py-2.5 text-slate-500 truncate max-w-xs" title="${typeof esc === 'function' ? esc(r.alamat) : r.alamat}">${typeof esc === 'function' ? esc(r.alamat) : r.alamat}</td>
            <td class="px-3 py-2.5 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button type="button" onclick="bukaModalEditRumahIbadah(${r.id})"
                  class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200/80 rounded-md font-semibold text-[11px] transition flex items-center gap-1"
                  title="Edit Data">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  <span>Edit</span>
                </button>
                <button type="button" onclick="konfirmasiHapusRumahIbadah(${r.id}, '${(r.nama || '').replace(/'/g, "\\'")}')"
                  class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200/80 rounded-md font-semibold text-[11px] transition flex items-center gap-1"
                  title="Hapus Data">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  <span>Hapus</span>
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    })
    .withFailureHandler(function (err) {
      if (loader) loader.classList.add('hidden');
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red-500 font-medium">Error: ${typeof esc === 'function' ? esc(err && err.message ? err.message : err) : 'Error'}</td></tr>`;
    })
    .ambilDaftarRumahIbadahAdmin(dataPengguna.token, { cari, jenis, kecamatan, statusKlasifikasi, page: _halamanRiAktif, limit: 20 });
}

function bukaModalTambahRumahIbadah() {
  if (!dataPengguna || dataPengguna.role !== 'UTAMA') {
    if (typeof tampilkanToast === 'function') tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat menambah data.', 'gagal');
    return;
  }
  pastikanModalRumahIbadahSiap();
  const form = document.getElementById('form-modal-ri');
  if (form) form.reset();
  document.getElementById('mri-pesan')?.classList.add('hidden');

  const idEl = document.getElementById('mri-id');
  if (idEl) idEl.value = '';

  const judul = document.getElementById('judul-modal-form-ri');
  if (judul) judul.textContent = 'Tambah Rumah Ibadah Baru';

  const selectKel = document.getElementById('mri-kelurahan');
  if (selectKel) selectKel.innerHTML = '<option value="">-- Pilih Kelurahan --</option>';

  const modal = document.getElementById('modal-form-rumah-ibadah');
  if (modal) modal.classList.remove('hidden');
}

function handleKecamatanFormRiChange(callbackKelurahanDipilih) {
  const kecEl = document.getElementById('mri-kecamatan');
  const kelEl = document.getElementById('mri-kelurahan');
  if (!kecEl || !kelEl) return;

  const kec = kecEl.value;
  if (!kec) {
    kelEl.innerHTML = '<option value="">-- Pilih Kelurahan --</option>';
    return;
  }

  kelEl.innerHTML = '<option value="">Memuat kelurahan...</option>';
  kelEl.disabled = true;

  google.script.run
    .withSuccessHandler(function (daftarKel) {
      kelEl.disabled = false;
      const list = Array.isArray(daftarKel) ? daftarKel : [];
      kelEl.innerHTML = '<option value="">-- Pilih Kelurahan --</option>' + list.map(k => `<option value="${k}">${k}</option>`).join('');
      if (typeof callbackKelurahanDipilih === 'function') callbackKelurahanDipilih();
    })
    .withFailureHandler(function () {
      kelEl.disabled = false;
      kelEl.innerHTML = '<option value="">Gagal memuat kelurahan</option>';
    })
    .getKelurahanByKecamatan(dataPengguna.token, kec);
}

function bukaModalEditRumahIbadah(id) {
  if (!dataPengguna || dataPengguna.role !== 'UTAMA') {
    if (typeof tampilkanToast === 'function') tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat mengedit data.', 'gagal');
    return;
  }
  const row = _cacheBarisRi[id];
  if (!row) return;

  pastikanModalRumahIbadahSiap();
  const idEl = document.getElementById('mri-id');
  const jenisEl = document.getElementById('mri-jenis');
  const kecEl = document.getElementById('mri-kecamatan');
  const kelEl = document.getElementById('mri-kelurahan');
  const namaEl = document.getElementById('mri-nama');
  const alamatEl = document.getElementById('mri-alamat');
  const judul = document.getElementById('judul-modal-form-ri');

  if (judul) judul.textContent = 'Edit Data Rumah Ibadah';
  if (idEl) idEl.value = row.id;
  const jenisResmi = DAFTAR_JENIS_IBADAH_ADMIN.some(jenis => jenis.val === row.jenis);
  if (jenisEl) jenisEl.value = jenisResmi ? row.jenis : '';
  if (kecEl) kecEl.value = row.kecamatan;
  if (namaEl) namaEl.value = row.nama;
  if (alamatEl) alamatEl.value = row.alamat;

  const pesanEl = document.getElementById('mri-pesan');
  if (jenisResmi) {
    pesanEl?.classList.add('hidden');
  } else if (pesanEl) {
    pesanEl.textContent = 'Data ini memakai jenis lama "' + (row.jenis || '-') + '". Pilih salah satu dari tujuh jenis resmi sebelum menyimpan perubahan.';
    pesanEl.className = 'text-xs font-semibold p-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200';
    pesanEl.classList.remove('hidden');
  }

  handleKecamatanFormRiChange(function () {
    if (kelEl && row.kelurahan) kelEl.value = row.kelurahan;
  });

  const modal = document.getElementById('modal-form-rumah-ibadah');
  if (modal) modal.classList.remove('hidden');
}

function simpanRumahIbadah(event) {
  if (event) event.preventDefault();

  if (!dataPengguna || dataPengguna.role !== 'UTAMA') {
    if (typeof tampilkanToast === 'function') {
      tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat menyimpan data.', 'gagal');
    }
    return;
  }

  const id = document.getElementById('mri-id')?.value;
  const jenis = (document.getElementById('mri-jenis')?.value || '').trim();
  const kecamatan = (document.getElementById('mri-kecamatan')?.value || '').trim();
  const kelurahan = (document.getElementById('mri-kelurahan')?.value || '').trim();
  const nama = (document.getElementById('mri-nama')?.value || '').trim();
  const alamat = (document.getElementById('mri-alamat')?.value || '').trim();

  if (!jenis) { if (typeof tampilkanToast === 'function') tampilkanToast('Pilih jenis rumah ibadah!', 'gagal'); return; }
  if (!kecamatan) { if (typeof tampilkanToast === 'function') tampilkanToast('Pilih kecamatan!', 'gagal'); return; }
  if (!kelurahan) { if (typeof tampilkanToast === 'function') tampilkanToast('Pilih kelurahan!', 'gagal'); return; }
  if (!nama || nama.length < 3) { if (typeof tampilkanToast === 'function') tampilkanToast('Nama rumah ibadah minimal 3 karakter!', 'gagal'); return; }

  const btnSubmit = document.getElementById('btn-submit-mri');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Menyimpan...';
  }

  const payload = { jenis, kecamatan, kelurahan, nama, alamat };

  if (id) {
    // Mode Edit / Update
    payload.id = Number(id);
    google.script.run
      .withSuccessHandler(function (res) {
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
        if (res && res.sukses) {
          if (typeof tampilkanToast === 'function') tampilkanToast(res.pesan || 'Data berhasil diperbarui!', 'sukses');
          document.getElementById('modal-form-rumah-ibadah')?.classList.add('hidden');
          muatDaftarRumahIbadahAdmin(_halamanRiAktif);
        } else {
          if (typeof tampilkanToast === 'function') tampilkanToast(res ? res.pesan : 'Gagal memperbarui data.', 'gagal');
        }
      })
      .withFailureHandler(function (err) {
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
        if (typeof tampilkanToast === 'function') tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
      })
      .ubahRumahIbadah(dataPengguna.token, payload);
  } else {
    // Mode Create / Tambah Baru
    google.script.run
      .withSuccessHandler(function (res) {
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
        if (res && res.sukses) {
          if (typeof tampilkanToast === 'function') tampilkanToast(res.pesan || 'Data berhasil ditambahkan!', 'sukses');
          document.getElementById('modal-form-rumah-ibadah')?.classList.add('hidden');
          muatDaftarRumahIbadahAdmin(1);
        } else {
          if (typeof tampilkanToast === 'function') tampilkanToast(res ? res.pesan : 'Gagal menambahkan data.', 'gagal');
        }
      })
      .withFailureHandler(function (err) {
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'Simpan Data'; }
        if (typeof tampilkanToast === 'function') tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
      })
      .tambahRumahIbadah(dataPengguna.token, payload);
  }
}

async function konfirmasiHapusRumahIbadah(id, nama) {
  if (!dataPengguna || dataPengguna.role !== 'UTAMA') {
    if (typeof tampilkanToast === 'function') {
      tampilkanToast('Akses ditolak: Hanya Admin Utama yang dapat menghapus data.', 'gagal');
    }
    return;
  }

  const yakin = (typeof window.konfirmasiAksi === 'function')
    ? await window.konfirmasiAksi({
      judul: 'Hapus Tempat Ibadah',
      pesan: `Apakah Anda yakin ingin menghapus data tempat ibadah:\n"${nama}"?\n\nTindakan ini permanen dan tidak dapat dibatalkan.`,
      tipe: 'danger',
      teksKonfirmasi: 'Ya, Hapus Data',
      teksBatal: 'Batal'
    })
    : window.confirm(`Hapus data "${nama}"?`);

  if (!yakin) return;

  if (typeof tampilkanToast === 'function') {
    tampilkanToast(`Menghapus data "${nama}"...`, 'proses');
  }

  google.script.run
    .withSuccessHandler(function (res) {
      if (res && res.sukses) {
        if (typeof tampilkanToast === 'function') tampilkanToast(res.pesan || 'Data berhasil dihapus.', 'sukses');
        muatDaftarRumahIbadahAdmin(_halamanRiAktif);
      } else {
        if (typeof tampilkanToast === 'function') tampilkanToast(res ? res.pesan : 'Gagal menghapus data.', 'gagal');
      }
    })
    .withFailureHandler(function (err) {
      if (typeof tampilkanToast === 'function') tampilkanToast('Error: ' + (err && err.message ? err.message : err), 'gagal');
    })
    .hapusRumahIbadah(dataPengguna.token, id);
}

window.bukaModalKelolaRumahIbadah = bukaModalKelolaRumahIbadah;
window.bukaModalTambahRumahIbadah = bukaModalTambahRumahIbadah;
window.bukaModalEditRumahIbadah = bukaModalEditRumahIbadah;
window.konfirmasiHapusRumahIbadah = konfirmasiHapusRumahIbadah;
window.filterTabelRumahIbadah = filterTabelRumahIbadah;
window.muatDaftarRumahIbadahAdmin = muatDaftarRumahIbadahAdmin;
window.handleKecamatanFormRiChange = handleKecamatanFormRiChange;
window.simpanRumahIbadah = simpanRumahIbadah;
window.gantiHalamanRi = gantiHalamanRi;

