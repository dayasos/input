// DJPM 2027 - Modul Core

// PWA Install Prompt
let promptInstalTersimpan = null;

function sudahTerinstalSebagaiPwa() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch (e) { return false; }
}

function perangkatIOS() {
  if (/iphone|ipad|ipod/i.test(navigator.userAgent || navigator.vendor || '')) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

function cobaTampilkanModalInstall() {
  if (sudahTerinstalSebagaiPwa()) return;
  let sudahDitutup = false;
  try { sudahDitutup = sessionStorage.getItem('djpm_install_prompt_ditutup') === '1'; } catch (e) { }
  if (sudahDitutup) return;

  if (promptInstalTersimpan) {
    document.getElementById('modal-install-app').classList.remove('hidden');
  } else if (perangkatIOS()) {
    document.getElementById('modal-install-ios').classList.remove('hidden');
  }
}

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  promptInstalTersimpan = e;
  cobaTampilkanModalInstall();
});

window.addEventListener('appinstalled', function () {
  try { sessionStorage.setItem('djpm_install_prompt_ditutup', '1'); } catch (e) { }
  const modal = document.getElementById('modal-install-app');
  if (modal) modal.classList.add('hidden');
});

window.installAplikasi = function () {
  const modal = document.getElementById('modal-install-app');
  if (!promptInstalTersimpan) { if (modal) modal.classList.add('hidden'); return; }
  promptInstalTersimpan.prompt();
  promptInstalTersimpan.userChoice.finally(function () {
    promptInstalTersimpan = null;
    if (modal) modal.classList.add('hidden');
    try { sessionStorage.setItem('djpm_install_prompt_ditutup', '1'); } catch (e) { }
  });
};

window.tutupModalInstall = function () {
  const modalApp = document.getElementById('modal-install-app');
  const modalIos = document.getElementById('modal-install-ios');
  if (modalApp) modalApp.classList.add('hidden');
  if (modalIos) modalIos.classList.add('hidden');
  try { sessionStorage.setItem('djpm_install_prompt_ditutup', '1'); } catch (e) { }
};

if (perangkatIOS() && !sudahTerinstalSebagaiPwa()) {
  setTimeout(cobaTampilkanModalInstall, 1200);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* diam saja, bukan fitur kritis */ });
  });
}

// Keyboard accessibility: Tekan ESC untuk menutup modal yang aktif
window.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    const modalLogout = document.getElementById('modal-konfirmasi-logout');
    if (modalLogout && !modalLogout.classList.contains('hidden')) {
      if (typeof window.tutupModalKonfirmasiLogout === 'function') {
        window.tutupModalKonfirmasiLogout();
      } else {
        modalLogout.classList.add('hidden');
      }
    }
  }
});

// Master Layanan Default Baseline (0ms Dropdown Initialization)
let masterLayanan = {
  kecamatan: [
    "BILAL JENAZAH",
    "PENGGALI KUBUR",
    "IMAM MASJID",
    "GURU MAGHRIB MENGAJI",
    "PETUGAS GEREJA KATOLIK",
    "GURU SEKOLAH MINGGU",
    "PENATUA GEREJA",
    "GURU SEKOLAH BUDDHA",
    "GURU SEKOLAH HINDU",
    "USTADZ/USTADZAH",
    "PENGURUS RUMAH IBADAH"
  ],
  kemenag: [
    "GURU SEKOLAH BUDDHA",
    "GURU SEKOLAH HINDU",
    "GURU SEKOLAH MINGGU",
    "PENATUA GEREJA",
    "GURU MAGHRIB MENGAJI"
  ]
};

// Sistem Login & Sesi
let dataPengguna = { username: "", role: "", kecamatan: "", token: "", userId: "", kelurahanTerkunci: "" };
let panelAktif = "input"; // "input", "rekap"
let inputDitutupGlobal = false; // status sakelar tutup input, diisi saat login

// Pulihkan Sesi dengan Optimistic Instant Render (0ms)
(function cobaPulihkanSesi() {
  const modalLoginEl = document.getElementById('modal-login');

  let sesiTersimpan = null;
  try {
    const raw = sessionStorage.getItem('dana_jasa_sesi');
    if (raw) sesiTersimpan = JSON.parse(raw);
  } catch (e) { sesiTersimpan = null; }

  if (!sesiTersimpan || !sesiTersimpan.token) {
    if (modalLoginEl) modalLoginEl.classList.remove('hidden');
    return;
  }

  // 1. Optimistic Instant Render (0ms): render profil subtitle dan buka kontrol navigasi seketika
  try {
    dataPengguna.username = sesiTersimpan.username || "";
    dataPengguna.role = sesiTersimpan.role || "";
    dataPengguna.kecamatan = sesiTersimpan.kecamatan || "";
    dataPengguna.token = sesiTersimpan.token;
    dataPengguna.userId = sesiTersimpan.userId || "";
    dataPengguna.kelurahanTerkunci = "";

    const uid = (dataPengguna.userId || "").toUpperCase().trim();
    if (uid.indexOf("KELURAHAN ") === 0) {
      dataPengguna.kelurahanTerkunci = uid.substring("KELURAHAN ".length).trim();
    }

    const elSubtitle = document.getElementById('info-admin-subtitle');
    if (elSubtitle && dataPengguna.username) {
      let teksSub = 'Administratur : ' + (sesiTersimpan.namaLengkap || dataPengguna.username);
      if (dataPengguna.kelurahanTerkunci) {
        teksSub += ' &nbsp;·&nbsp; Kelurahan ' + dataPengguna.kelurahanTerkunci;
      }
      elSubtitle.innerHTML = teksSub;
    }

    if (modalLoginEl) modalLoginEl.classList.add('hidden');
    if (typeof terapkanHakAkses === "function" && dataPengguna.role) {
      terapkanHakAkses(dataPengguna.role, dataPengguna.kecamatan, false);
    }
  } catch (_optErr) {
    console.warn("Optimistic bootstrap:", _optErr);
  }

  // 2. Revalidasi sesi server di latar belakang (Background Validation)
  google.script.run
    .withSuccessHandler(function (res) {
      if (res && res.sukses) {
        if (typeof masukSetelahAuth === "function") {
          masukSetelahAuth(res);
        }
      } else {
        try { sessionStorage.removeItem('dana_jasa_sesi'); } catch (e) { }
        if (modalLoginEl) modalLoginEl.classList.remove('hidden');
      }
    })
    .withFailureHandler(function () {
      if (!dataPengguna.token && modalLoginEl) modalLoginEl.classList.remove('hidden');
    })
    .pulihkanSesi(sesiTersimpan.token);
})();

function sapaanWaktu() {
  const jam = new Date().getHours();
  if (jam >= 4 && jam < 11) return "Selamat Pagi";
  if (jam >= 11 && jam < 15) return "Selamat Siang";
  if (jam >= 15 && jam < 18) return "Selamat Sore";
  return "Selamat Malam";
}

const KONFIG_TOAST = {
  sukses: { border: "border-emerald-500", iconBg: "bg-emerald-100", iconColor: "text-emerald-600", ikon: "✓" },
  gagal: { border: "border-red-500", iconBg: "bg-red-100", iconColor: "text-red-600", ikon: "✕" },
  info: { border: "border-sky-500", iconBg: "bg-sky-100", iconColor: "text-sky-600", ikon: "i" },
  proses: { border: "border-slate-400", iconBg: "bg-slate-100", iconColor: "text-slate-500", ikon: null }
};
let _toastCounter = 0;

function tampilkanToast(pesan, jenis, opsi) {
  jenis = KONFIG_TOAST[jenis] ? jenis : "info";
  opsi = opsi || {};
  const cfg = KONFIG_TOAST[jenis];
  const cont = document.getElementById("toast-container");
  if (!cont) { console.log("[TOAST:" + jenis + "]", pesan); return null; }

  const id = "toast-" + (++_toastCounter);
  const el = document.createElement("div");
  el.id = id;
  el.className = "bg-white " + cfg.border + " border-l-4 text-slate-700 text-sm font-medium rounded-lg shadow-lg ring-1 ring-slate-900/5 px-4 py-3 pr-8 flex items-start gap-3 max-w-sm w-max relative pointer-events-auto opacity-0 translate-x-4 transition-all duration-300";
  const ikonHtml = cfg.ikon
    ? '<span class="w-5 h-5 rounded-full ' + cfg.iconBg + ' ' + cfg.iconColor + ' flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">' + cfg.ikon + '</span>'
    : '<span class="w-5 h-5 rounded-full ' + cfg.iconBg + ' flex items-center justify-center shrink-0 mt-0.5"><span class="loader-kecil"></span></span>';
  el.innerHTML =
    ikonHtml +
    '<span class="whitespace-pre-line leading-snug">' + (typeof esc === "function" ? esc(pesan) : String(pesan)) + '</span>' +
    '<button type="button" aria-label="Tutup notifikasi" class="absolute top-2 right-2 text-slate-400 hover:text-slate-600 text-base leading-none" onclick="tutupToast(\'' + id + '\')">&times;</button>';
  cont.appendChild(el);

  requestAnimationFrame(function () { el.classList.remove("opacity-0", "translate-x-4"); });

  if (jenis !== "proses" && !opsi.tetap) {
    setTimeout(function () { tutupToast(id); }, opsi.durasi || 3500);
  }
  return id;
}

function tutupToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("opacity-0", "translate-x-4");
  setTimeout(function () { el.remove(); }, 300);
}

function setTombolMemuat(btn, teksMemuat) {
  if (!btn) return;
  if (btn.dataset.teksAsli === undefined) btn.dataset.teksAsli = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("opacity-70", "cursor-not-allowed");
  btn.innerHTML = '<span class="inline-flex items-center gap-1.5">⏳ ' + (teksMemuat || "Memproses...") + '</span>';
}

function pulihkanTombol(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove("opacity-70", "cursor-not-allowed");
  if (btn.dataset.teksAsli !== undefined) {
    btn.innerHTML = btn.dataset.teksAsli;
    delete btn.dataset.teksAsli;
  }
}

function htmlSkeletonBaris(kolom, jumlahBaris) {
  kolom = kolom || 5;
  jumlahBaris = jumlahBaris || 3;
  let baris = "";
  for (let i = 0; i < jumlahBaris; i++) {
    baris += '<tr><td colspan="' + kolom + '" class="p-3">' +
      '<div class="h-3.5 rounded bg-slate-200 animate-pulse" style="width:' + (60 + (i * 12) % 30) + '%"></div>' +
      '</td></tr>';
  }
  return baris;
}

const DAFTAR_KECAMATAN_MEDAN = [
  "MEDAN AMPLAS", "MEDAN AREA", "MEDAN BARAT", "MEDAN BARU", "MEDAN BELAWAN",
  "MEDAN DELI", "MEDAN DENAI", "MEDAN HELVETIA", "MEDAN JOHOR", "MEDAN KOTA",
  "MEDAN LABUHAN", "MEDAN MAIMUN", "MEDAN MARELAN", "MEDAN PERJUANGAN", "MEDAN PETISAH",
  "MEDAN POLONIA", "MEDAN SELAYANG", "MEDAN SUNGGAL", "MEDAN TEMBUNG", "MEDAN TIMUR", "MEDAN TUNTUNGAN"
];

const TTL_CACHE_DATA_TRANSAKSI_MS = 90 * 1000;
const TTL_CACHE_MASTER_MS = 6 * 60 * 60 * 1000;
// Dropdown Wilayah & Layanan
// dan modal pilih rumah ibadah (Kecamatan lama & Kemenag), lihat pemakaiannya di masing-masing.
const cacheKelurahanByKecamatan = {}; // { [kecamatan]: { data, waktu } }
const cacheRumahIbadah = {};          // { [kategori]: { data, waktu } }
const cacheKemenagData = {};          // { [sheetName]: { data, waktu } }

function isRoleKecKem_(role) {
  const r = (role || "").toString().trim().toUpperCase();
  if (r === "UTAMA") return false;
  if (r === "KECAMATAN") return true;
  const listKemenag = (masterLayanan.kemenag || []).map(function (l) { return l.toString().toUpperCase(); });
  return listKemenag.indexOf(r) !== -1;
}

function togglePw(id, btn) {
  var el = document.getElementById(id);
  if (!el) return;
  var show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" stroke-width=\"2\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.477 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21\"/></svg>'
    : '<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" stroke-width=\"2\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M15 12a3 3 0 11-6 0 3 3 0 016 0z\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z\"/></svg>';
  btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
  el.focus();
}

function pesanErrorRamah(err) {
  const msg = (err && err.message ? err.message : String(err || "")).toLowerCase();
  if (msg.includes("lock") || msg.includes("could not obtain")) {
    return "⏳ Sistem sedang sibuk karena banyak data masuk bersamaan.\n\nSilakan tunggu beberapa saat lalu coba klik Simpan kembali.\nData Anda tidak hilang.";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("deadline")) {
    return "⌛ Koneksi ke server memakan waktu terlalu lama.\n\nSilakan coba kembali. Jika masalah berlanjut, periksa koneksi internet Anda.";
  }
  if (msg.includes("quota") || msg.includes("rate") || msg.includes("too many")) {
    return "⏳ Server sedang menerima terlalu banyak permintaan.\n\nTunggu 1-2 menit lalu coba kembali.";
  }
  if (msg.includes("authorization") || msg.includes("permission") || msg.includes("access")) {
    return "🔒 Sesi Anda telah berakhir. Silakan muat ulang halaman dan login kembali.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("internet")) {
    return "🌐 Koneksi internet terputus. Periksa koneksi Anda lalu coba kembali.";
  }
  // Pesan default — tetap tampilkan tapi dengan konteks yang lebih jelas
  return "❌ Terjadi gangguan saat menghubungi server.\n\nSilakan coba beberapa saat lagi. Jika masalah berlanjut, hubungi administrator.\n\n(Detail teknis: " + (err && err.message ? err.message : String(err)) + ")";
}

const ROLE_KEMENAG_BEBAS = [
  "GURU SEKOLAH BUDDHA",
  "GURU SEKOLAH HINDU",
  "GURU SEKOLAH MINGGU",
  "PENATUA GEREJA"
];
const ROLE_KEMENAG_TERIKAT = ["GURU MAGHRIB MENGAJI"];

function isRoleKemenagBebas(role) { return ROLE_KEMENAG_BEBAS.includes(String(role).toUpperCase()); }
function isRoleKemenagTerikat(role) { return ROLE_KEMENAG_TERIKAT.includes(String(role).toUpperCase()); }
function isRoleKemenag(role) { return isRoleKemenagBebas(role) || isRoleKemenagTerikat(role); }

function pastikanLogin() {
  if (!dataPengguna.token) {
    tampilkanToast("🔒 Sesi Anda berakhir atau belum login. Silakan login ulang.", "gagal");
    document.getElementById('modal-login').classList.remove('hidden');
    return false;
  }
  return true;
}

function terapkanHakAkses(role, kecamatan, inputDitutup) {
  inputDitutupGlobal = !!inputDitutup;

  // Ambil elemen DOM secara langsung agar aman dari Temporal Dead Zone
  // (const tabInput, panelInput, dll dideklarasikan SETELAH fungsi ini di file)
  const _tabInput = document.getElementById('tab-input');
  const _tabRekap = document.getElementById('tab-rekap');
  const _panelInput = document.getElementById('panel-input');
  const _fsContainer = document.getElementById('fs-container');
  const _btnKec = document.getElementById('btn-instansi-kec');
  const _btnKem = document.getElementById('btn-instansi-kem');

  if (_tabInput) _tabInput.classList.remove('hidden');
  if (_tabRekap) _tabRekap.classList.remove('hidden');
  if (_tabInput) _tabInput.click();

  const btnReturKematian = document.getElementById('btn-retur-kematian');
  if (btnReturKematian) btnReturKematian.classList.remove('hidden');
  const btnKeluar = document.getElementById('btn-keluar-aplikasi');
  if (btnKeluar) btnKeluar.classList.remove('hidden');
  const fabGantiPassword = document.getElementById('fab-ganti-password');
  if (fabGantiPassword) fabGantiPassword.classList.remove('hidden');
  const btnProgresKuota = document.getElementById('btn-progres-kuota');
  if (btnProgresKuota) btnProgresKuota.classList.toggle('hidden', role !== "UTAMA");
  const btnKelolaKuota = document.getElementById('btn-kelola-kuota');
  if (btnKelolaKuota) btnKelolaKuota.classList.toggle('hidden', role !== "UTAMA");
  const tabTools = document.getElementById('tab-tools');
  if (tabTools) tabTools.classList.toggle('hidden', role !== "UTAMA");
  const btnKelolaUser = document.getElementById('btn-kelola-user');
  if (btnKelolaUser) btnKelolaUser.classList.toggle('hidden', role !== "UTAMA");
  const btnDashboardProgres = document.getElementById('btn-dashboard-progres');
  if (btnDashboardProgres) btnDashboardProgres.classList.remove('hidden');

  if (role === "UTAMA") {
    if (_btnKec) { _btnKec.disabled = false; _btnKec.classList.remove('opacity-40', 'cursor-not-allowed'); }
    if (_btnKem) { _btnKem.disabled = false; _btnKem.classList.remove('opacity-40', 'cursor-not-allowed'); }

  } else if (role === "KECAMATAN") {
    if (_btnKem) { _btnKem.disabled = true; _btnKem.classList.add('opacity-40', 'cursor-not-allowed'); }
    murniGantiInstansi("KECAMATAN", _btnKec, _btnKem);
    const controlKec = document.getElementById('control-kecamatan');
    if (controlKec && kecamatan) {
      controlKec.value = kecamatan;
      controlKec.disabled = true;
      controlKec.classList.add('bg-slate-100', 'cursor-not-allowed');
      controlKec.classList.remove('bg-white');
      controlKec.dispatchEvent(new Event('change'));
    }

  } else if (isRoleKemenagBebas(role)) {
    if (_btnKec) { _btnKec.disabled = true; _btnKec.classList.add('opacity-40', 'cursor-not-allowed'); }
    murniGantiInstansi("KEMENAG", _btnKem, _btnKec);
    const controlKec = document.getElementById('control-kecamatan');
    if (controlKec) {
      controlKec.disabled = false;
      controlKec.classList.remove('bg-slate-100', 'cursor-not-allowed');
      controlKec.classList.add('bg-white');
    }
    renderDropdownLayananTunggal(role);

  } else if (isRoleKemenagTerikat(role)) {
    if (_btnKec) { _btnKec.disabled = true; _btnKec.classList.add('opacity-40', 'cursor-not-allowed'); }
    murniGantiInstansi("KEMENAG", _btnKem, _btnKec);
    const controlKec = document.getElementById('control-kecamatan');
    if (controlKec && kecamatan) {
      controlKec.value = kecamatan;
      controlKec.disabled = true;
      controlKec.classList.add('bg-slate-100', 'cursor-not-allowed');
      controlKec.classList.remove('bg-white');
      controlKec.dispatchEvent(new Event('change'));
    }
    renderDropdownLayananTunggal(role);
  }

  if (inputDitutup && role !== "UTAMA") {
    if (_tabInput) { _tabInput.classList.add('hidden'); _tabInput.disabled = true; _tabInput.style.pointerEvents = 'none'; }
    if (_panelInput) _panelInput.classList.add('hidden');

    if (_fsContainer) {
      _fsContainer.disabled = true;
      _fsContainer.classList.add('opacity-50', 'pointer-events-none');
    }
    const controlKec = document.getElementById('control-kecamatan');
    if (controlKec) controlKec.disabled = true;
    if (_btnKec) { _btnKec.disabled = true; _btnKec.style.pointerEvents = 'none'; }
    if (_btnKem) { _btnKem.disabled = true; _btnKem.style.pointerEvents = 'none'; }

    if (_tabRekap) _tabRekap.click();

    const banner = document.getElementById('banner-tutup');
    if (banner) banner.classList.remove('hidden');

    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.sukses && res.ditutup) {
          const meta = document.getElementById('notif-tutup-meta');
          if (meta && res.terakhirUbah && res.terakhirUbah.waktu) {
            meta.classList.remove('hidden');
            meta.innerHTML = `
              <div class="flex justify-between text-[11px]">
                <span class="text-slate-500 font-semibold">Ditutup pada:</span>
                <span class="text-slate-800 font-bold">${esc(res.terakhirUbah.waktu)}</span>
              </div>
              <div class="flex justify-between text-[11px]">
                <span class="text-slate-500 font-semibold">Oleh:</span>
                <span class="text-slate-800 font-bold">${esc(res.terakhirUbah.username)}</span>
              </div>
            `;
          }
          document.getElementById('modal-notif-tutup').classList.remove('hidden');
        }
      })
      .withFailureHandler(function () {
        document.getElementById('modal-notif-tutup').classList.remove('hidden');
      })
      .ambilStatusDetailSetelan(dataPengguna.token);

    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.sukses) return;
        if (res.sumber === "KHUSUS") {
          const modalNotif = document.getElementById('modal-notif-tutup');
          if (modalNotif) {
            const headerJudul = modalNotif.querySelector('.text-white.font-bold');
            const headerSubjudul = modalNotif.querySelector('.text-amber-50');
            if (headerJudul) headerJudul.textContent = "Akses Akun Anda Ditutup";
            if (headerSubjudul) headerSubjudul.textContent = "Pengecualian khusus oleh admin utama";
            // Cari <p> pertama di dalam bg-amber-50, ganti isinya
            const isiPesan = modalNotif.querySelector('.bg-amber-50 p');
            if (isiPesan) {
              isiPesan.innerHTML = "Akses akun Anda telah <strong>ditutup secara khusus</strong> oleh Admin Utama Dinas Sosial Kota Medan. Ini adalah pengecualian yang diterapkan pada akun Anda, bukan penutupan periode secara umum.";
            }
          }
          const banner = document.getElementById('banner-tutup');
          if (banner) {
            const bannerJudul = banner.querySelector('p.font-bold');
            const bannerIsi = banner.querySelector('p.text-amber-800');
            if (bannerJudul) bannerJudul.textContent = "Akses Akun Anda Ditutup Khusus";
            if (bannerIsi) bannerIsi.innerHTML = "Akun Anda menerima pengecualian penutupan dari admin utama. Hubungi Dinas Sosial Kota Medan untuk klarifikasi.";
          }
        }
      })
      .withFailureHandler(function () { /* silent */ })
      .statusInputKecKem(dataPengguna.token);
  } else {
    const banner = document.getElementById('banner-tutup');
    if (banner) banner.classList.add('hidden');
    if (_tabInput) { _tabInput.disabled = false; _tabInput.style.pointerEvents = ''; }
  }
}

// Fungsi periksaStatusAkses: memeriksa status buka/tutup input berdasarkan role pengguna
// dan memperbarui UI (banner, tab) sesuai kondisi terkini dari server.
function periksaStatusAkses() {
  if (!dataPengguna.token || dataPengguna.role === "UTAMA") return;
  const _tabInput = document.getElementById('tab-input');
  google.script.run
    .withSuccessHandler(function (st) {
      const ditutup = st && st.sukses ? !!st.ditutup : false;
      terapkanHakAkses(dataPengguna.role, dataPengguna.kecamatan, ditutup);
    })
    .withFailureHandler(function () { /* silent: pertahankan status terakhir */ })
    .statusInputKecKem(dataPengguna.token);
}
window.periksaStatusAkses = periksaStatusAkses;

document.getElementById('btn-retur-kematian').addEventListener('click', function () {
  if (!pastikanLogin()) return;
  const btn = this;
  setTombolMemuat(btn, "Membuka...");
  google.script.run
    .withSuccessHandler(function (res) {
      pulihkanTombol(btn);
      if (res && res.sukses) {
        window.open(res.url, '_blank');
      } else {
        tampilkanToast('Gagal membuka aplikasi Retur: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal');
      }
    })
    .withFailureHandler(function (err) {
      pulihkanTombol(btn);
      tampilkanToast(pesanErrorRamah(err), 'gagal');
    })
    .buatTokenSSORetur(dataPengguna.token);
});

const btnKelolaUserNav = document.getElementById('btn-kelola-user');
if (btnKelolaUserNav) {
  btnKelolaUserNav.addEventListener('click', function () {
    if (!pastikanLogin()) return;
    if (dataPengguna.role !== "UTAMA") {
      tampilkanToast("Fitur Manajemen Pengguna hanya dapat diakses oleh Admin Utama.", "gagal");
      return;
    }
    const m = document.getElementById('modal-kelola-user');
    if (m) m.classList.remove('hidden');
    if (typeof muatDaftarUserLengkap === "function") {
      muatDaftarUserLengkap();
    } else if (typeof window.muatDaftarUserLengkap === "function") {
      window.muatDaftarUserLengkap();
    }
  });
}

function esc(val) {
  return String(val === null || val === undefined ? '' : val)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let instansiAktif = "";

const formPembayaran = document.getElementById('form-pembayaran');
const btnKec = document.getElementById('btn-instansi-kec');
const btnKem = document.getElementById('btn-instansi-kem');
const controlKecamatan = document.getElementById('control-kecamatan');
const fsContainer = document.getElementById('fs-container');
const fsSubIdentitas = document.getElementById('fs-sub-identitas');
const fsSubDomisiliKec = document.getElementById('fs-sub-domisili-kec');
const fsSubBawah = document.getElementById('fs-sub-bawah');
const selectLayanan = document.getElementById('input-layanan');
const inputTempatTugas = document.getElementById('input-tempat-tugas');
const inputAlamatTugas = document.getElementById('input-almt-tugas');
const inputNik = document.getElementById('input-nik');
const inputNoRek = document.getElementById('input-no-rek');
const inputKontak = document.getElementById('input-kontak');
const inputTglLahir = document.getElementById('input-tgl-lahir');
const inputUmur = document.getElementById('input-umur');
const btnResetForm = document.getElementById('btn-reset-form');
const modalUsia = document.getElementById('modal-usia-alert');
const btnModalUsiaOk = document.getElementById('btn-modal-usia-ok');
const loadingOverlay = document.getElementById('loading-overlay');
const wrapperPlank = document.getElementById('wrapper-foto-plank');
const wrapperIbadah = document.getElementById('wrapper-foto-ibadah');
const wrapperKegiatan = document.getElementById('wrapper-foto-kegiatan');
const filePlank = wrapperPlank.querySelector('input[type="file"]');
const fileIbadah = wrapperIbadah.querySelector('input[type="file"]');
const fileKegiatan = wrapperKegiatan.querySelector('input[type="file"]');
const wrapperRekomendasiBkm = document.getElementById('wrapper-rekomendasi-bkm');
const wrapperRekomendasiRi = document.getElementById('wrapper-rekomendasi-ri');
const fileRekomendasiBkm = wrapperRekomendasiBkm.querySelector('input[type="file"]');
const fileRekomendasiRi = wrapperRekomendasiRi.querySelector('input[type="file"]');
const tabInput = document.getElementById('tab-input');
const tabRekap = document.getElementById('tab-rekap');
const tabTools = document.getElementById('tab-tools');
const panelInput = document.getElementById('panel-input');
const panelRekap = document.getElementById('panel-rekap');
const panelTools = document.getElementById('panel-tools');

window.addEventListener('DOMContentLoaded', () => {
  google.script.run
    .withSuccessHandler((data) => { masterLayanan = data; })
    .withFailureHandler((err) => { tampilkanToast("Gagal mengambil data master: " + pesanErrorRamah(err), "gagal", { durasi: 6000 }); })
    .getMasterLayanan();
});

function setTabTidakAktif(tabEl) {
  tabEl.classList.remove('bg-white', 'text-slate-900', 'shadow-sm');
  tabEl.classList.add('text-white', 'hover:bg-slate-700');
}
function setTabAktif(tabEl) {
  tabEl.classList.remove('text-white', 'hover:bg-slate-700');
  tabEl.classList.add('bg-white', 'text-slate-900', 'shadow-sm');
}

tabInput.addEventListener('click', () => {
  if (inputDitutupGlobal && dataPengguna.role !== "UTAMA") {
    tampilkanToast("Periode input telah ditutup. Anda hanya bisa melihat data.", "info");
    return;
  }

  tabInput.className = "px-4 py-2 rounded-md bg-white text-slate-900 shadow-sm transition";
  panelAktif = "input";
  tabRekap.className = "px-4 py-2 rounded-md text-white hover:bg-slate-700 transition";
  setTabTidakAktif(tabTools);
  panelInput.classList.remove('hidden');
  panelRekap.classList.add('hidden');
  panelTools.classList.add('hidden');
  document.getElementById('btn-refresh-data').classList.add('hidden');

  if (dataPengguna.role === "UTAMA" || dataPengguna.role === "") {
    if (!instansiAktif) {
      btnKec.className = "w-full py-3 px-4 rounded-lg font-bold text-sm border border-slate-300 bg-slate-200 text-slate-600 hover:bg-slate-300/70 transition duration-200";
      btnKem.className = "w-full py-3 px-4 rounded-lg font-bold text-sm border border-slate-300 bg-slate-200 text-slate-600 hover:bg-slate-300/70 transition duration-200";
      controlKecamatan.value = "";
      controlKecamatan.disabled = true;
      controlKecamatan.classList.add('bg-slate-100', 'cursor-not-allowed');
      controlKecamatan.classList.remove('bg-white');
      fsContainer.disabled = true;
      fsContainer.classList.add('opacity-50', 'pointer-events-none');
      formPembayaran.reset();
      inputUmur.value = "";
      setGembokSubFormulir(false);
      evaluasiUploadKondisional();
    }
  } else if (dataPengguna.role === "KECAMATAN") {
    if (instansiAktif !== "KECAMATAN") {
      murniGantiInstansi("KECAMATAN", btnKec, btnKem);
    }
    if (btnKem) { btnKem.disabled = true; btnKem.classList.add('opacity-40', 'cursor-not-allowed'); }
    if (controlKecamatan && dataPengguna.kecamatan) {
      controlKecamatan.value = dataPengguna.kecamatan;
      controlKecamatan.disabled = true;
      controlKecamatan.classList.add('bg-slate-100', 'cursor-not-allowed');
      controlKecamatan.classList.remove('bg-white');
      controlKecamatan.dispatchEvent(new Event('change'));
    }
    fsContainer.disabled = false;
    fsContainer.classList.remove('opacity-50', 'pointer-events-none');
  } else if (isRoleKemenagBebas(dataPengguna.role)) {
    if (instansiAktif !== "KEMENAG") {
      murniGantiInstansi("KEMENAG", btnKem, btnKec);
    }
    if (btnKec) { btnKec.disabled = true; btnKec.classList.add('opacity-40', 'cursor-not-allowed'); }
    controlKecamatan.disabled = false;
    controlKecamatan.classList.remove('bg-slate-100', 'cursor-not-allowed');
    controlKecamatan.classList.add('bg-white');
    renderDropdownLayananTunggal(dataPengguna.role);
    evaluasiUploadKondisional();
  } else if (isRoleKemenagTerikat(dataPengguna.role)) {
    if (instansiAktif !== "KEMENAG") {
      murniGantiInstansi("KEMENAG", btnKem, btnKec);
    }
    if (btnKec) { btnKec.disabled = true; btnKec.classList.add('opacity-40', 'cursor-not-allowed'); }
    if (controlKecamatan && dataPengguna.kecamatan) {
      controlKecamatan.value = dataPengguna.kecamatan;
      controlKecamatan.disabled = true;
      controlKecamatan.classList.add('bg-slate-100', 'cursor-not-allowed');
      controlKecamatan.classList.remove('bg-white');
      controlKecamatan.dispatchEvent(new Event('change'));
    }
    fsContainer.disabled = false;
    fsContainer.classList.remove('opacity-50', 'pointer-events-none');
    renderDropdownLayananTunggal(dataPengguna.role);
    evaluasiUploadKondisional();
  }
});

tabRekap.addEventListener('click', () => {
  tabRekap.className = "px-4 py-2 rounded-md bg-white text-slate-900 shadow-sm transition";
  panelAktif = "rekap";
  tabInput.className = "px-4 py-2 rounded-md text-white hover:bg-slate-700 transition";
  setTabTidakAktif(tabTools);
  panelRekap.classList.remove('hidden');
  panelInput.classList.add('hidden');
  panelTools.classList.add('hidden');
  document.getElementById('btn-refresh-data').classList.remove('hidden');
  const dataMasihSegar = masterDataLihat.length > 0 && (Date.now() - waktuMasterDataLihat) < TTL_CACHE_DATA_TRANSAKSI_MS;
  if (!dataMasihSegar) inisialisasiMenuLihatData();
});

tabTools.addEventListener('click', () => {
  if (dataPengguna.role !== "UTAMA") return; // safeguard tambahan, tombolnya juga sudah disembunyikan
  setTabAktif(tabTools);
  panelAktif = "tools";
  tabInput.className = "px-4 py-2 rounded-md text-white hover:bg-slate-700 transition";
  tabRekap.className = "px-4 py-2 rounded-md text-white hover:bg-slate-700 transition";
  panelTools.classList.remove('hidden');
  panelInput.classList.add('hidden');
  panelRekap.classList.add('hidden');
  document.getElementById('btn-refresh-data').classList.add('hidden');
  inisialisasiMenuTools();
});

// Multi-Tahun
(function () {
  var tahunAktif = '2027'; // tahun input aktif — data dari sheet Data Input
  var tahunDipilih = '2027';
  var masterDataTahun = {}; // cache per tahun { '2026': [...], '2027': [...] }

  window._muatDaftarTahun = function () {
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.sukses) return;
        var sel = document.getElementById('select-tahun-data');
        if (!sel) return;
        sel.innerHTML = '';
        var optAktif = document.createElement('option');
        optAktif.value = tahunAktif;
        optAktif.textContent = tahunAktif + ' (Aktif)';
        sel.appendChild(optAktif);
        res.tahun.forEach(function (thn) {
          if (thn === tahunAktif) return; // skip tahun aktif (sudah ada)
          var opt = document.createElement('option');
          opt.value = thn;
          opt.textContent = thn;
          sel.appendChild(opt);
        });
        sel.value = tahunDipilih;
      })
      .withFailureHandler(function () { })
      .ambilTahunTersedia(dataPengguna.token);
  };

  window.gantTahunData = function () {
    var sel = document.getElementById('select-tahun-data');
    if (!sel) return;
    tahunDipilih = sel.value;

    var thStatus = document.getElementById('th-status-tahun');
    var thAksi = document.querySelector('#body-tabel-lihat')?.closest('table')?.querySelector('th:last-child');
    if (thStatus) {
      if (tahunDipilih !== tahunAktif) {
        thStatus.textContent = 'Status ' + tahunDipilih;
        thStatus.classList.remove('hidden');
      } else {
        thStatus.classList.add('hidden');
      }
    }
    const thAksiEl = document.getElementById('th-aksi-lihat');
    if (thAksiEl) thAksiEl.classList.toggle('hidden', tahunDipilih !== tahunAktif);

    if (tahunDipilih === tahunAktif) {
      masterDataLihat = [];
      inisialisasiMenuLihatData();
    } else {
      if (masterDataTahun[tahunDipilih]) {
        renderTabelTahunHistoris(masterDataTahun[tahunDipilih], tahunDipilih);
      } else {
        muatDataTahunHistoris(tahunDipilih);
      }
    }
  };

  function muatDataTahunHistoris(tahun) {
    var elCari = document.getElementById('input-cari-global');
    var elKec = document.getElementById('filter-kecamatan');
    var elKel = document.getElementById('filter-kelurahan');
    var elLay = document.getElementById('filter-layanan');
    if (elCari) elCari.value = '';
    if (elKec) { elKec.innerHTML = '<option value="">-- Semua Kecamatan --</option>'; elKec.value = ''; }
    if (elKel) { elKel.innerHTML = '<option value="">-- Semua Kelurahan --</option>'; elKel.value = ''; }
    if (elLay) { elLay.innerHTML = '<option value="">-- Semua Layanan --</option>'; elLay.value = ''; }

    const tbody = document.getElementById('body-tabel-lihat');
    tbody.innerHTML = htmlSkeletonBaris(8, 5);
    document.getElementById('info-total-penerima').textContent = 'Total Data: Memuat...';

    google.script.run
      .withSuccessHandler(function (json) {
        try {
          var res = JSON.parse(json);
          if (!res.sukses) {
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-400">${esc(res.pesan || 'Gagal memuat.')}</td></tr>`;
            return;
          }
          masterDataTahun[tahun] = res.rows || [];
          renderTabelTahunHistoris(masterDataTahun[tahun], tahun);
        } catch (e) {
          tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-400">Error: ${e.message}</td></tr>`;
        }
      })
      .withFailureHandler(function (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-400">Gagal: ${err && err.message ? err.message : err}</td></tr>`;
      })
      .ambilDataTahunHakAkses(dataPengguna.token, tahun);
  }

  function renderTabelTahunHistoris(data, tahun) {
    const setKec = new Set(), setKel = new Set(), setLay = new Set();
    data.forEach(function (r) {
      if (r[3]) setKec.add(r[3]);
      if (r[4]) setKel.add(r[4]);
      if (r[2]) setLay.add(r[2]);
    });

    function isiFilter(id, set) {
      var el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '<option value="">-- Semua --</option>';
      [...set].sort().forEach(function (v) {
        var o = document.createElement('option');
        o.value = o.textContent = v;
        el.appendChild(o);
      });
    }
    isiFilter('filter-kecamatan', setKec);
    isiFilter('filter-kelurahan', setKel);
    isiFilter('filter-layanan', setLay);

    const dKecHist = document.getElementById('filter-kecamatan');
    if (dKecHist && dataPengguna.kecamatan) {
      const cocokKecHist = Array.from(dKecHist.options).some(o => o.value.toUpperCase().trim() === dataPengguna.kecamatan.toUpperCase().trim());
      if (cocokKecHist) dKecHist.value = dataPengguna.kecamatan;
    }

    window._dataHistorisSedang = { data: data, tahun: tahun };
    tampilDataHistoris();
  }

  function tampilDataHistoris() {
    if (!window._dataHistorisSedang) return;
    var data = window._dataHistorisSedang.data;
    var tahun = window._dataHistorisSedang.tahun;

    const thVerif = document.getElementById('th-verifikasi');
    if (thVerif) thVerif.classList.add('hidden');

    var cari = (document.getElementById('input-cari-global').value || "").toLowerCase().trim();
    var kec = (document.getElementById('filter-kecamatan').value || "").toUpperCase();
    var kel = (document.getElementById('filter-kelurahan').value || "").toUpperCase();
    var lay = (document.getElementById('filter-layanan').value || "").toUpperCase();

    var filtered = data.filter(function (r) {
      if (kec && r[3] !== kec) return false;
      if (kel && r[4] !== kel) return false;
      if (lay && r[2] !== lay) return false;
      if (cari) {
        var gabung = (r[0] || "").toLowerCase() + (r[1] || "").toLowerCase();
        if (!gabung.includes(cari)) return false;
      }
      return true;
    });

    var infoTotal = document.getElementById('info-total-penerima');
    if (infoTotal) infoTotal.textContent = 'Total Data: ' + filtered.length + ' Baris';

    var totalHal = Math.max(1, Math.ceil(filtered.length / dataPerHalaman));
    if (halamanSekarang > totalHal) halamanSekarang = 1;
    var awal = (halamanSekarang - 1) * dataPerHalaman;
    var halIni = filtered.slice(awal, awal + dataPerHalaman);

    var STATUS_WARNA = {
      'AKTIF': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    };

    var tbody = document.getElementById('body-tabel-lihat');
    if (!halIni.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 italic">Tidak ada data sesuai filter.</td></tr>';
      perbaruiElemenNavigasi(1, 1);
      return;
    }

    tbody.innerHTML = halIni.map(function (r, i) {
      var no = awal + i + 1;
      var status = (r[5] || '-').toString().trim().toUpperCase();
      var warna = STATUS_WARNA[status] || 'bg-red-100 text-red-700 border-red-200';
      return `<tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-3 text-center text-xs text-slate-400">${no}</td>
        <td class="px-4 py-3 font-medium break-words">${esc(r[0] || '-')}</td>
        <td class="px-4 py-3 font-mono text-xs break-words">${esc(r[1] || '-')}</td>
        <td class="px-4 py-3 text-xs break-words">${esc(r[2] || '-')}</td>
        <td class="px-4 py-3 text-xs break-words">${esc(r[3] || '-')}</td>
        <td class="px-4 py-3 text-xs break-words">${esc(r[4] || '-')}</td>
        <td class="px-4 py-3 text-center">
          <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${warna}">${esc(status)}</span>
        </td>
      </tr>`;
    }).join('');

    perbaruiElemenNavigasi(halamanSekarang, totalHal);
  }

  window._tampilDataHistoris = tampilDataHistoris;
  window._tahunDipilihGetter = function () { return tahunDipilih; };
  window._tahunAktifGetter = function () { return tahunAktif; };
})();

btnKec.addEventListener('click', () => { murniGantiInstansi("KECAMATAN", btnKec, btnKem); });
btnKem.addEventListener('click', () => { murniGantiInstansi("KEMENAG", btnKem, btnKec); });

function murniGantiInstansi(instansi, targetBtn, otherBtn) {
  if (dataPengguna.role === "KECAMATAN" && instansi === "KEMENAG") return;
  if (isRoleKemenag(dataPengguna.role) && instansi === "KECAMATAN") return;
  formPembayaran.reset();
  inputUmur.value = "";
  instansiAktif = instansi;
  targetBtn.className = "w-full py-3 px-4 rounded-lg font-bold text-sm border-2 border-sky-600 bg-sky-600 text-white shadow-sm transition duration-200";
  otherBtn.className = "w-full py-3 px-4 rounded-lg font-bold text-sm border border-slate-300 bg-slate-200 text-slate-600 hover:bg-slate-300/70 transition duration-200";
  controlKecamatan.disabled = false;
  controlKecamatan.classList.remove('bg-slate-100', 'cursor-not-allowed');
  controlKecamatan.classList.add('bg-white');
  controlKecamatan.value = "";
  fsContainer.disabled = false;
  fsContainer.classList.remove('opacity-50', 'pointer-events-none');
  setGembokSubFormulir(false);
  if (isRoleKemenag(dataPengguna.role)) { renderDropdownLayananTunggal(dataPengguna.role); }
  else { renderDropdownLayanan(instansi); }
}

function renderDropdownLayanan(instansi) {
  selectLayanan.innerHTML = '<option value="">-- PILIH LAYANAN --</option>';
  const list = instansi === "KECAMATAN" ? masterLayanan.kecamatan : masterLayanan.kemenag;
  list.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l; opt.textContent = l;
    selectLayanan.appendChild(opt);
  });
  evaluasiUploadKondisional();
}

function renderDropdownLayananTunggal(layanan) {
  selectLayanan.innerHTML = `
    <option value="">-- PILIH LAYANAN --</option>
    <option value="${layanan}">${layanan}</option>`;
  selectLayanan.value = layanan;
  selectLayanan.disabled = false;
  selectLayanan.classList.remove('bg-slate-100', 'cursor-not-allowed');
  evaluasiUploadKondisional();
  // Dropdown Wilayah & Layanan
  if (window.refreshPenandaForm) window.refreshPenandaForm();
}

function setGembokSubFormulir(kondisiLock) {
  fsSubIdentitas.disabled = kondisiLock;
  fsSubDomisiliKec.disabled = kondisiLock;
  fsSubBawah.disabled = kondisiLock;
  if (kondisiLock) {
    fsSubIdentitas.classList.add('opacity-40', 'pointer-events-none');
    fsSubDomisiliKec.classList.add('opacity-40', 'pointer-events-none');
    fsSubBawah.classList.add('opacity-40', 'pointer-events-none');
  } else {
    fsSubIdentitas.classList.remove('opacity-40', 'pointer-events-none');
    fsSubDomisiliKec.classList.remove('opacity-40', 'pointer-events-none');
    fsSubBawah.classList.remove('opacity-40', 'pointer-events-none');
  }
}

// Validasi Real-time
const URUTAN_FIELDSET = [fsSubIdentitas, fsSubDomisiliKec, fsSubBawah];

window._kuncianAktif = window._kuncianAktif || {};

/**
 * Mendaftarkan kunci untuk `alasan` tertentu mulai dari blok ke-`indeksMulaiKunci` dan seterusnya.
 * Blok SEBELUM indeks itu tetap bebas diisi (untuk alasan ini).
 * Kalau `elemenBebasArray` diberikan, blok di indeks itu sendiri tetap dibuka,
 * tapi field lain di dalamnya (selain yang ada di array) ikut dikunci.
 * Status kunci gabungan dari SEMUA alasan aktif lalu diterapkan ke form.
 */
function kunciDariBlokSetelah(alasan, indeksMulaiKunci, elemenBebasArray) {
  window._kuncianAktif[alasan] = { indeksMulaiKunci: indeksMulaiKunci, elemenBebasArray: elemenBebasArray || null };
  terapkanSemuaKuncian();
}

/**
 * Melepas kunci untuk `alasan` tertentu saja. Alasan lain yang masih aktif (kalau ada)
 * tetap mengunci form — form baru sepenuhnya terbuka kalau semua alasan sudah dilepas.
 */
function bukaKunciForm(alasan) {
  if (!(alasan in window._kuncianAktif)) return;
  delete window._kuncianAktif[alasan];
  terapkanSemuaKuncian();

  if (Object.keys(window._kuncianAktif).length === 0 && inputUmur.value !== "" && parseInt(inputUmur.value) < 18) {
    setGembokSubFormulir(true);
  }
}

function terapkanSemuaKuncian() {
  const semuaAlasan = Object.keys(window._kuncianAktif);

  URUTAN_FIELDSET.forEach(function (fs, idx) {
    let terkunciPenuh = false;   // ada alasan aktif yang mengunci blok ini SEPENUHNYA
    const daftarBebasParsial = []; // alasan aktif yang cuma membebaskan sebagian elemen di blok ini

    semuaAlasan.forEach(function (alasan) {
      const rule = window._kuncianAktif[alasan];
      if (idx < rule.indeksMulaiKunci) return; // alasan ini tidak menyentuh blok ini
      if (idx > rule.indeksMulaiKunci || !rule.elemenBebasArray) {
        terkunciPenuh = true;
      } else {
        daftarBebasParsial.push(rule.elemenBebasArray);
      }
    });

    if (terkunciPenuh) {
      fs.disabled = true;
      fs.classList.add('opacity-40', 'pointer-events-none');
      return;
    }

    fs.disabled = false;
    fs.classList.remove('opacity-40', 'pointer-events-none');

    if (daftarBebasParsial.length === 0) {
      fs.querySelectorAll('input, select, textarea').forEach(function (el) {
        el.disabled = false;
        el.classList.remove('opacity-40');
      });
    } else {
      fs.querySelectorAll('input, select, textarea').forEach(function (el) {
        const bebas = daftarBebasParsial.every(function (list) { return list.indexOf(el) !== -1; });
        el.disabled = !bebas;
        el.classList.toggle('opacity-40', !bebas);
      });
    }
  });

  updateStatusTombolSimpan();
}

function tampilkanPeringatan(idElemen, pesan) {
  const el = document.getElementById(idElemen);
  if (!el) return;
  el.innerText = pesan;
  el.classList.remove('hidden');
}
function sembunyikanPeringatan(idElemen) {
  const el = document.getElementById(idElemen);
  if (!el) return;
  el.classList.add('hidden');
  el.innerText = '';
}

let debounceNikTimer = null;
let nikTerakhirDicek = '';
function triggerCekNik(force) {
  const nik = inputNik.value.trim();
  if (nik.length !== 16) {
    nikTerakhirDicek = '';
    sembunyikanPeringatan('peringatan-nik');
    bukaKunciForm('NIK');
    return;
  }
  if (!force && nik === nikTerakhirDicek) return;
  nikTerakhirDicek = nik;

  sembunyikanPeringatan('peringatan-nik');
  bukaKunciForm('NIK');

  google.script.run
    .withSuccessHandler(function (res) {
      if (res && res.blokir) {
        tampilkanPeringatan('peringatan-nik', '⚠️ ' + res.pesan);
        kunciDariBlokSetelah('NIK', 1, null); // blok Identitas (indeks 0) tetap bebas; mulai Domisili Kec (1) dst dikunci
      }
    })
    .withFailureHandler(function () { /* diam; validasi final saat submit tetap jadi jaring pengaman */ })
    .cekNikRealtime(dataPengguna.token, nik);
}

inputNik.addEventListener('blur', function () {
  triggerCekNik(true);
});

inputNik.addEventListener('input', function (e) {
  e.target.value = e.target.value.replace(/[^0-9]/g, '');
  clearTimeout(debounceNikTimer);
  if (e.target.value.length === 16) {
    debounceNikTimer = setTimeout(function () {
      triggerCekNik(false);
    }, 400);
  } else {
    nikTerakhirDicek = '';
    sembunyikanPeringatan('peringatan-nik');
    bukaKunciForm('NIK');
  }
});

let debounceRekTimer = null;
let rekTerakhirDicek = '';
function triggerCekRekening(force) {
  const rek = inputNoRek.value.trim();
  if (rek.length !== 14) {
    rekTerakhirDicek = '';
    sembunyikanPeringatan('peringatan-rekening');
    bukaKunciForm('REKENING');
    return;
  }
  if (!force && rek === rekTerakhirDicek) return;
  rekTerakhirDicek = rek;

  sembunyikanPeringatan('peringatan-rekening');
  bukaKunciForm('REKENING');

  google.script.run
    .withSuccessHandler(function (res) {
      if (res && res.blokir) {
        tampilkanPeringatan('peringatan-rekening', '⚠️ ' + res.pesan);
        kunciDariBlokSetelah('REKENING', 2, [inputNoRek]); // blok C (indeks 2) dibuka tapi cuma No. Rekening yang bebas
      }
    })
    .withFailureHandler(function () { })
    .cekRekeningRealtime(dataPengguna.token, rek);
}

inputNoRek.addEventListener('blur', function () {
  triggerCekRekening(true);
});

inputNoRek.addEventListener('input', function (e) {
  e.target.value = e.target.value.replace(/[^0-9]/g, '');
  clearTimeout(debounceRekTimer);
  if (e.target.value.length === 14) {
    debounceRekTimer = setTimeout(function () {
      triggerCekRekening(false);
    }, 400);
  } else {
    rekTerakhirDicek = '';
    sembunyikanPeringatan('peringatan-rekening');
    bukaKunciForm('REKENING');
  }
});

inputKontak.addEventListener('input', function (e) {
  e.target.value = e.target.value.replace(/[^0-9]/g, '');
});

function kunciTempatTugas() {
  inputTempatTugas.readOnly = true;
  inputAlamatTugas.readOnly = true;
  inputTempatTugas.classList.add('bg-slate-100', 'cursor-not-allowed');
  inputAlamatTugas.classList.add('bg-slate-100', 'cursor-not-allowed');
  const btnGanti = document.getElementById('btn-ganti-tempat-tugas');
  if (btnGanti) btnGanti.classList.remove('hidden');
}

function bukaKunciTempatTugas() {
  inputTempatTugas.value = '';
  inputAlamatTugas.value = '';
  inputTempatTugas.readOnly = false;
  inputAlamatTugas.readOnly = false;
  inputTempatTugas.classList.remove('bg-slate-100', 'cursor-not-allowed');
  inputAlamatTugas.classList.remove('bg-slate-100', 'cursor-not-allowed');
  const btnGanti = document.getElementById('btn-ganti-tempat-tugas');
  if (btnGanti) btnGanti.classList.add('hidden');
  sembunyikanPeringatan('peringatan-tempat-tugas');
  bukaKunciForm('TEMPAT_TUGAS');
}

function bukaUlangModalRumahIbadah() {
  bukaKunciTempatTugas(); // kosongkan & buka kunci dulu, jaga-jaga kalau modal ditutup tanpa pilih apa pun

  const val = selectLayanan.value.toUpperCase().trim();
  const kategoriModalKec = [
    "IMAM MASJID", "KHATIB JUMAT", "NAZIR MASJID", "NAZIR MUSHOLLA",
    "PENGURUS GEREJA", "PENGURUS VIHARA/KLENTENG/KUIL", "PETUGAS GEREJA KATOLIK"
  ];
  const daftarKemenag = (typeof masterLayanan !== 'undefined' && masterLayanan.kemenag)
    ? masterLayanan.kemenag.map(function (v) { return v.trim().toUpperCase(); })
    : [];

  if (daftarKemenag.indexOf(val) !== -1 || val === "USTADZ" || val === "USTADZAH") {
    if (typeof openKemenagModal === 'function') openKemenagModal(val);
  } else if (kategoriModalKec.indexOf(val) !== -1) {
    if (typeof openModal === 'function') openModal(val);
  }
}

document.getElementById('btn-ganti-tempat-tugas').addEventListener('click', bukaUlangModalRumahIbadah);

function jalankanCekTempatTugas() {
  sembunyikanPeringatan('peringatan-tempat-tugas');
  bukaKunciForm('TEMPAT_TUGAS');
  const lay = selectLayanan.value;
  const tempat = inputTempatTugas.value.trim();
  const alamat = inputAlamatTugas.value.trim();
  if (!tempat || !alamat) return;

  google.script.run
    .withSuccessHandler(function (res) {
      if (res && res.blokir) {
        tampilkanPeringatan('peringatan-tempat-tugas', '⚠️ Sudah ada penerima atas nama ' + res.nama + ' (Kec. ' + res.kecamatan + ') untuk tempat ini.');
        kunciDariBlokSetelah('TEMPAT_TUGAS', 0, null); // field ini di luar semua fieldset -> kunci semuanya
      }
    })
    .withFailureHandler(function () { })
    .cekTempatTugasGandaRealtime(dataPengguna.token, lay, tempat, alamat);
}
inputTempatTugas.addEventListener('blur', jalankanCekTempatTugas);
inputAlamatTugas.addEventListener('blur', jalankanCekTempatTugas);

function perbaruiTampilanKuotaInput(res, kec, lay) {
  const badge = document.getElementById('badge-kuota-input-realtime');
  const info = document.getElementById('info-kuota-layanan');
  if (!kec || !lay) {
    if (badge) { badge.className = 'hidden'; badge.innerHTML = ''; }
    if (info) { info.className = 'hidden'; info.innerHTML = ''; }
    return;
  }

  if (!res) return;

  const maks = res.maks || 0;
  const terpakai = res.terpakai || 0;
  const sisa = res.sisa != null ? res.sisa : Math.max(0, maks - terpakai);
  const isPenuh = Boolean(res.blokir) || (maks > 0 && sisa <= 0);

  if (badge) {
    badge.classList.remove('hidden');
    badge.classList.add('flex');
    if (isPenuh) {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span><span>Kuota Penuh (' + terpakai + '/' + maks + ')</span>';
    } else if (sisa <= 3) {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span>Sisa ' + sisa + ' dari ' + maks + ' kuota</span>';
    } else {
      badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Kuota Tersedia: ' + sisa + ' / ' + maks + '</span>';
    }
  }

  if (info) {
    info.classList.remove('hidden');
    info.classList.add('flex');
    if (isPenuh) {
      info.className = 'flex items-center gap-1.5 text-[11px] mt-1.5 font-bold text-rose-600';
      info.innerHTML = '<span>⚠️ Kuota layanan untuk ' + kec + ' telah terpenuhi (' + terpakai + '/' + maks + ')</span>';
    } else {
      info.className = 'flex items-center gap-1.5 text-[11px] mt-1.5 font-semibold text-emerald-600';
      info.innerHTML = '<span>🟢 Kuota tersedia: ' + sisa + ' dari ' + maks + ' (Terpakai: ' + terpakai + ')</span>';
    }
  }
}

function jalankanCekKuota(isSilent) {
  const kec = controlKecamatan ? controlKecamatan.value : '';
  const lay = selectLayanan ? selectLayanan.value : '';
  if (!kec || !lay) {
    bukaKunciForm('KUOTA');
    perbaruiTampilanKuotaInput(null, '', '');
    return;
  }

  google.script.run
    .withSuccessHandler(function (res) {
      perbaruiTampilanKuotaInput(res, kec, lay);
      if (res && res.blokir) {
        if (!isSilent) tampilkanToast(res.pesan, 'gagal', { durasi: 6000 });
        kunciDariBlokSetelah('KUOTA', 0, null); // field ini di luar semua fieldset -> kunci semuanya
      } else {
        bukaKunciForm('KUOTA');
      }
    })
    .withFailureHandler(function () { })
    .cekKuotaRealtime(dataPengguna.token, kec, lay);
}

window.jalankanCekKuota = jalankanCekKuota;
controlKecamatan.addEventListener('change', function () { jalankanCekKuota(false); });
selectLayanan.addEventListener('change', function () { jalankanCekKuota(false); });

(function () {
  const ID_DIKECUALIKAN = [
    'input-nik', 'input-no-rek', 'input-kontak',
    'input-tgl-lahir', 'input-umur',
    'login-username', 'login-password',
    'gp-lama', 'gp-username', 'gp-baru', 'gp-konfirm'
  ];

  function terapkanAtorSpasi(e) {
    const el = e.target;
    const pos = el.selectionStart;
    const val = el.value;

    let valBaru = val.replace(/\.(?=[^ ])/g, '. ');
    valBaru = valBaru.replace(/\. {2,}/g, '. ');

    if (valBaru !== val) {
      const selisih = valBaru.length - val.length;
      el.value = valBaru;
      try { el.setSelectionRange(pos + selisih, pos + selisih); } catch (_) { }
    }
  }

  function pasangOtorSpasi(el) {
    if (!el || el.__otorSpasiDipasang) return;
    if (ID_DIKECUALIKAN.indexOf(el.id) !== -1) return;
    if (el.type === 'file' || el.type === 'date' || el.type === 'password' || el.type === 'hidden') return;
    el.__otorSpasiDipasang = true;
    el.addEventListener('input', terapkanAtorSpasi);
  }

  const form = document.getElementById('form-pembayaran');
  if (form) {
    form.querySelectorAll('input[type="text"]').forEach(pasangOtorSpasi);
  }

  window._pasangOtorSpasiModal = function (kontainer) {
    if (!kontainer) return;
    kontainer.querySelectorAll('input[type="text"]').forEach(pasangOtorSpasi);
  };
})();
