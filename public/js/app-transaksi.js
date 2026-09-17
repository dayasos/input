// DJPM 2027 - Modul Transaksi

// Inisialisasi event listener untuk elemen form utama
// Guard null diperlukan karena app-transaksi.js dieksekusi setelah app-core.js,
// namun referensi const (inputTglLahir, dll) di app-core.js bergantung pada
// elemen HTML yang harus sudah ada di DOM.
if (inputTglLahir) {
  inputTglLahir.addEventListener('input', () => {
    if (!inputTglLahir.value) { if (inputUmur) inputUmur.value = ""; setGembokSubFormulir(false); return; }
    const tglLahir = new Date(inputTglLahir.value);
    const tglPatokan = new Date("2027-01-01");
    let usia = tglPatokan.getFullYear() - tglLahir.getFullYear();
    const m = tglPatokan.getMonth() - tglLahir.getMonth();
    if (m < 0 || (m === 0 && tglPatokan.getDate() < tglLahir.getDate())) { usia--; }
    if (inputUmur) inputUmur.value = usia >= 0 ? usia : 0;
    if (usia < 18) { if (modalUsia) modalUsia.classList.remove('hidden'); } else { setGembokSubFormulir(false); }
  });
}

if (btnModalUsiaOk) {
  btnModalUsiaOk.addEventListener('click', () => {
    if (modalUsia) modalUsia.classList.add('hidden');
    setGembokSubFormulir(true);
    if (inputTglLahir) inputTglLahir.focus();
  });
}

if (inputKontak) {
  inputKontak.addEventListener('input', (e) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length >= 2 && !val.startsWith("08")) { tampilkanToast("Nomor kontak harus diawali dengan angka 08!", "gagal"); val = "08"; }
    e.target.value = val;
  });
}

/// Pembaca EXIF GPS mandiri (tanpa library luar) — parsing header JPEG murni JavaScript.
function bacaGpsDariFile(file) {
  return new Promise(function (resolve) {
    if (!file || !file.type || file.type.indexOf('jpeg') === -1 && file.type.indexOf('jpg') === -1) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xFFD8) { resolve(null); return; }

        let offset = 2;
        const length = view.byteLength;

        while (offset < length - 4) {
          if (view.getUint8(offset) !== 0xFF) break;
          const marker = view.getUint16(offset, false);

          if (marker === 0xFFE1) {
            const exifStart = offset + 4;
            if (view.getUint32(exifStart, false) !== 0x45786966) { resolve(null); return; } // bukan "Exif"

            const tiffOffset = exifStart + 6;
            const little = view.getUint16(tiffOffset, false) === 0x4949;
            const firstIFDOffset = view.getUint32(tiffOffset + 4, little);
            const ifdOffset = tiffOffset + firstIFDOffset;

            const numEntries = view.getUint16(ifdOffset, little);
            let gpsIFDOffset = null;
            for (let i = 0; i < numEntries; i++) {
              const entryOffset = ifdOffset + 2 + i * 12;
              if (view.getUint16(entryOffset, little) === 0x8825) {
                gpsIFDOffset = tiffOffset + view.getUint32(entryOffset + 8, little);
                break;
              }
            }
            if (!gpsIFDOffset) { resolve(null); return; }

            const gpsEntries = view.getUint16(gpsIFDOffset, little);
            const gpsTags = {};
            for (let i = 0; i < gpsEntries; i++) {
              const entryOffset = gpsIFDOffset + 2 + i * 12;
              const tag = view.getUint16(entryOffset, little);
              const valueOffset = tiffOffset + view.getUint32(entryOffset + 8, little);

              if (tag === 1 || tag === 3) {
                gpsTags[tag] = String.fromCharCode(view.getUint8(entryOffset + 8));
              } else if (tag === 2 || tag === 4) {
                const vals = [];
                for (let j = 0; j < 3; j++) {
                  const num = view.getUint32(valueOffset + j * 8, little);
                  const den = view.getUint32(valueOffset + j * 8 + 4, little);
                  vals.push(den ? num / den : 0);
                }
                gpsTags[tag] = vals;
              }
            }

            if (gpsTags[2] && gpsTags[4]) {
              let lat = gpsTags[2][0] + gpsTags[2][1] / 60 + gpsTags[2][2] / 3600;
              let lng = gpsTags[4][0] + gpsTags[4][1] / 60 + gpsTags[4][2] / 3600;
              if (gpsTags[1] === 'S') lat = -lat;
              if (gpsTags[3] === 'W') lng = -lng;
              resolve({ latitude: lat, longitude: lng });
            } else {
              resolve(null);
            }
            return;
          }

          const segLength = view.getUint16(offset + 2, false);
          offset += 2 + segLength;
        }
        resolve(null);
      } catch (err) {
        resolve(null);
      }
    };
    reader.onerror = function () { resolve(null); };
    reader.readAsArrayBuffer(file.slice(0, 131072)); // cukup baca 128KB awal, data EXIF selalu di awal file
  });
}

// Koordinat Lokasi EXIF
const KONFIG_KOORDINAT = {
  plank: {
    layananList: ["GURU MAGHRIB MENGAJI"],
    wrapperId: 'wrapper-foto-plank',
    idHidden: 'hidden-koordinat-link',
    idCek: 'status-koordinat-cek',
    idOk: 'status-koordinat-ok',
    idGagal: 'status-koordinat-gagal',
    idTeksOk: 'teks-koordinat-ok',
    idLinkOk: 'link-koordinat-ok',
    idInputManual: 'input-koordinat-manual',
    siap: false
  },
  ibadah: {
    layananList: ["GURU SEKOLAH MINGGU", "GURU SEKOLAH BUDDHA", "GURU SEKOLAH HINDU"],
    wrapperId: 'wrapper-foto-ibadah',
    idHidden: 'hidden-koordinat-link-ibadah',
    idCek: 'status-koordinat-cek-ibadah',
    idOk: 'status-koordinat-ok-ibadah',
    idGagal: 'status-koordinat-gagal-ibadah',
    idTeksOk: 'teks-koordinat-ok-ibadah',
    idLinkOk: 'link-koordinat-ok-ibadah',
    idInputManual: 'input-koordinat-manual-ibadah',
    siap: false
  }
};

function updateStatusTombolSimpan() {
  const btnSimpan = document.getElementById('btn-simpan-data');
  if (!btnSimpan) return;
  const lay = selectLayanan.value;
  let terkunci = false;
  let pesanKunci = '';
  Object.keys(KONFIG_KOORDINAT).forEach(function (mode) {
    const cfg = KONFIG_KOORDINAT[mode];
    if (cfg.layananList.indexOf(lay) !== -1 && !cfg.siap) {
      terkunci = true;
      pesanKunci = 'Lengkapi koordinat lokasi foto terlebih dahulu';
    }
  });
  if (window._kuncianAktif && Object.keys(window._kuncianAktif).length > 0) {
    terkunci = true;
    pesanKunci = 'Perbaiki peringatan validasi di atas terlebih dahulu';
  }
  btnSimpan.disabled = terkunci;
  btnSimpan.classList.toggle('opacity-50', terkunci);
  btnSimpan.classList.toggle('cursor-not-allowed', terkunci);
  btnSimpan.title = pesanKunci;
}

function resetStatusKoordinat(mode) {
  const cfg = KONFIG_KOORDINAT[mode];
  cfg.siap = false;
  document.getElementById(cfg.idHidden).value = '';
  document.getElementById(cfg.idCek).classList.add('hidden');
  document.getElementById(cfg.idOk).classList.add('hidden');
  document.getElementById(cfg.idGagal).classList.add('hidden');
  const inputManual = document.getElementById(cfg.idInputManual);
  if (inputManual) inputManual.value = '';
  updateStatusTombolSimpan();
}

function resetSemuaStatusKoordinat() {
  Object.keys(KONFIG_KOORDINAT).forEach(resetStatusKoordinat);
}

function cekKoordinatManualDiisi(mode) {
  const cfg = KONFIG_KOORDINAT[mode];
  const val = document.getElementById(cfg.idInputManual).value.trim();
  if (val.length > 10) {
    document.getElementById(cfg.idHidden).value = val;
    cfg.siap = true;
  } else {
    document.getElementById(cfg.idHidden).value = '';
    cfg.siap = false;
  }
  updateStatusTombolSimpan();
}

async function prosesKoordinatDariFoto(file, mode) {
  resetStatusKoordinat(mode);
  if (!file) return;
  const cfg = KONFIG_KOORDINAT[mode];
  if (cfg.layananList.indexOf(selectLayanan.value) === -1) return;

  document.getElementById(cfg.idCek).classList.remove('hidden');

  try {
    const gps = await bacaGpsDariFile(file);
    document.getElementById(cfg.idCek).classList.add('hidden');

    if (gps && gps.latitude && gps.longitude) {
      const lat = gps.latitude.toFixed(6);
      const lng = gps.longitude.toFixed(6);
      const mapsLink = 'https://www.google.com/maps?q=' + lat + ',' + lng;

      document.getElementById(cfg.idHidden).value = mapsLink;
      document.getElementById(cfg.idTeksOk).innerText = lat + ', ' + lng;
      document.getElementById(cfg.idLinkOk).onclick = function () { window.open(mapsLink, '_blank'); };
      document.getElementById(cfg.idOk).classList.remove('hidden');
      cfg.siap = true;
    } else {
      document.getElementById(cfg.idGagal).classList.remove('hidden');
      cfg.siap = false;
    }
  } catch (e) {
    document.getElementById(cfg.idCek).classList.add('hidden');
    document.getElementById(cfg.idGagal).classList.remove('hidden');
    cfg.siap = false;
  }
  updateStatusTombolSimpan();
}

filePlank.addEventListener('change', function (e) { prosesKoordinatDariFoto(e.target.files[0], 'plank'); });
fileIbadah.addEventListener('change', function (e) { prosesKoordinatDariFoto(e.target.files[0], 'ibadah'); });

function evaluasiUploadKondisional() {
  const lay = selectLayanan.value;
  wrapperPlank.classList.add('hidden');
  wrapperIbadah.classList.add('hidden');
  wrapperKegiatan.classList.add('hidden');
  wrapperRekomendasiBkm.classList.add('hidden');
  wrapperRekomendasiRi.classList.add('hidden');
  filePlank.required = false; fileIbadah.required = false; fileKegiatan.required = false;
  fileRekomendasiBkm.required = false; fileRekomendasiRi.required = false;

  const labelBerkasPendukung2 = document.getElementById('label-berkas-pendukung-2');
  if (labelBerkasPendukung2) {
    if (lay === "USTADZ" || lay === "USTADZAH") {
      labelBerkasPendukung2.innerHTML = 'Upload Rekomendasi MUI <span class="text-red-500">*</span>';
    } else {
      labelBerkasPendukung2.innerHTML = 'Unggah Berkas Pendukung <span class="text-red-500">*</span>';
    }
  }

  if (lay !== "GURU MAGHRIB MENGAJI") {
    const hiddenJenis = document.getElementById('jenis-tempat-gmm-hidden');
    if (hiddenJenis) hiddenJenis.value = "";
    resetStatusKoordinat('plank');
  }
  if (["GURU SEKOLAH MINGGU", "GURU SEKOLAH BUDDHA", "GURU SEKOLAH HINDU"].indexOf(lay) === -1) {
    resetStatusKoordinat('ibadah');
  }
  bukaKunciTempatTugas();

  if (instansiAktif === "KEMENAG" && lay !== "") {
    if (lay === "GURU MAGHRIB MENGAJI") {
      wrapperPlank.classList.remove('hidden'); wrapperKegiatan.classList.remove('hidden');
      filePlank.required = true; fileKegiatan.required = true;

      const jenisTempat = (document.getElementById('jenis-tempat-gmm-hidden') || {}).value || "";
      if (jenisTempat === "MASJID" || jenisTempat === "MUSHOLLA") {
        wrapperRekomendasiBkm.classList.remove('hidden');
        fileRekomendasiBkm.required = true;
      }
    }
    if (["GURU SEKOLAH BUDDHA", "GURU SEKOLAH HINDU", "GURU SEKOLAH MINGGU"].includes(lay)) {
      wrapperIbadah.classList.remove('hidden'); wrapperKegiatan.classList.remove('hidden');
      fileIbadah.required = true; fileKegiatan.required = true;
    }
    if (isRoleKemenagBebas(lay)) {
      wrapperRekomendasiRi.classList.remove('hidden');
      fileRekomendasiRi.required = true;
    }
  }
  updateStatusTombolSimpan();
}
selectLayanan.addEventListener('change', evaluasiUploadKondisional);

btnResetForm.addEventListener('click', () => {
  setTimeout(() => {
    inputUmur.value = "";
    setGembokSubFormulir(false);
    const hiddenJenis = document.getElementById('jenis-tempat-gmm-hidden');
    if (hiddenJenis) hiddenJenis.value = "";
    resetSemuaStatusKoordinat();
    bukaKunciTempatTugas();
    resetKonfirmasiNamaBeda();
    evaluasiUploadKondisional();

    window._kuncianAktif = {};
    sembunyikanPeringatan('peringatan-nik');
    sembunyikanPeringatan('peringatan-rekening');
    sembunyikanPeringatan('peringatan-tempat-tugas');
    updateStatusTombolSimpan();
    hapusDrafLokalForm();
  }, 50);
});

// =========================================================================
// SISTEM DRAF OTOMATIS & RESTORE FORM INPUT
// =========================================================================
const KUNCI_DRAF_STORAGE = 'djpm_form_draft_2027';
let timerDebounceDraf = null;

function simpanDrafLokalForm() {
  try {
    const elNama = document.getElementById('input-nama');
    const elTmptLahir = document.getElementById('input-tmpt-lahir');
    const elJk = document.getElementById('input-jk');
    const elAlamat = document.getElementById('input-alamat');
    const elKecDom = document.getElementById('input-kecamatan');
    const elKelDom = document.getElementById('input-kelurahan');
    const elNamaRek = document.getElementById('input-nama-rek');
    const elCabang = document.getElementById('input-cabang-bank');
    const elBpjs = document.getElementById('input-bpjs');

    const draf = {
      instansiAktif: typeof instansiAktif !== 'undefined' ? instansiAktif : '',
      controlKecamatan: controlKecamatan ? controlKecamatan.value : '',
      selectLayanan: selectLayanan ? selectLayanan.value : '',
      inputTempatTugas: inputTempatTugas ? inputTempatTugas.value : '',
      inputAlamatTugas: inputAlamatTugas ? inputAlamatTugas.value : '',
      inputNama: elNama ? elNama.value : '',
      inputNik: inputNik ? inputNik.value : '',
      selectGender: elJk ? elJk.value : '',
      inputTempatLahir: elTmptLahir ? elTmptLahir.value : '',
      inputTglLahir: inputTglLahir ? inputTglLahir.value : '',
      inputUmur: inputUmur ? inputUmur.value : '',
      inputKecamatanDomisili: elKecDom ? elKecDom.value : '',
      controlKelurahan: elKelDom ? elKelDom.value : '',
      inputAlamat: elAlamat ? elAlamat.value : '',
      inputNamaRekening: elNamaRek ? elNamaRek.value : '',
      inputNoRekening: inputNoRek ? inputNoRek.value : '',
      inputKantorCabang: elCabang ? elCabang.value : '',
      inputNoKontak: inputKontak ? inputKontak.value : '',
      selectBpjs: elBpjs ? elBpjs.value : '',
      waktuSimpan: Date.now()
    };

    if (draf.inputNik || draf.inputNama || draf.inputTempatTugas || draf.inputNoRekening) {
      sessionStorage.setItem(KUNCI_DRAF_STORAGE, JSON.stringify(draf));
    }
  } catch (_e) { }
}

function hapusDrafLokalForm() {
  try {
    sessionStorage.removeItem(KUNCI_DRAF_STORAGE);
    const banner = document.getElementById('banner-draf-tersimpan');
    if (banner) banner.classList.add('hidden');
  } catch (_e) { }
}

function cekDanTampilkanBannerDraf() {
  try {
    const raw = sessionStorage.getItem(KUNCI_DRAF_STORAGE);
    if (!raw) return;
    const draf = JSON.parse(raw);
    if (draf && (draf.inputNik || draf.inputNama || draf.inputTempatTugas || draf.inputNoRekening)) {
      const banner = document.getElementById('banner-draf-tersimpan');
      if (banner) banner.classList.remove('hidden');
    }
  } catch (_e) { }
}

function pulihkanDrafLokalForm() {
  try {
    const raw = sessionStorage.getItem(KUNCI_DRAF_STORAGE);
    if (!raw) return;
    const draf = JSON.parse(raw);
    if (!draf) return;

    if (draf.controlKecamatan && controlKecamatan && !controlKecamatan.disabled) {
      controlKecamatan.value = draf.controlKecamatan;
      controlKecamatan.dispatchEvent(new Event('change'));
    }

    setTimeout(function () {
      if (draf.selectLayanan && selectLayanan) {
        selectLayanan.value = draf.selectLayanan;
        selectLayanan.dispatchEvent(new Event('change'));
      }

      if (draf.inputTempatTugas && inputTempatTugas) inputTempatTugas.value = draf.inputTempatTugas;
      if (draf.inputAlamatTugas && inputAlamatTugas) inputAlamatTugas.value = draf.inputAlamatTugas;
      const elNama = document.getElementById('input-nama');
      if (draf.inputNama && elNama) elNama.value = draf.inputNama;
      if (draf.inputNik && inputNik) inputNik.value = draf.inputNik;
      const elJk = document.getElementById('input-jk');
      if (draf.selectGender && elJk) elJk.value = draf.selectGender;
      const elTmpt = document.getElementById('input-tmpt-lahir');
      if (draf.inputTempatLahir && elTmpt) elTmpt.value = draf.inputTempatLahir;
      if (draf.inputTglLahir && inputTglLahir) {
        inputTglLahir.value = draf.inputTglLahir;
        inputTglLahir.dispatchEvent(new Event('change'));
      }
      const elKecDom = document.getElementById('input-kecamatan');
      if (draf.inputKecamatanDomisili && elKecDom) {
        elKecDom.value = draf.inputKecamatanDomisili;
        elKecDom.dispatchEvent(new Event('change'));
      }

      setTimeout(function () {
        const elKelDom = document.getElementById('input-kelurahan');
        if (draf.controlKelurahan && elKelDom) elKelDom.value = draf.controlKelurahan;
      }, 300);

      const elAlamat = document.getElementById('input-alamat');
      if (draf.inputAlamat && elAlamat) elAlamat.value = draf.inputAlamat;
      const elNamaRek = document.getElementById('input-nama-rek');
      if (draf.inputNamaRekening && elNamaRek) elNamaRek.value = draf.inputNamaRekening;
      if (draf.inputNoRekening && inputNoRek) inputNoRek.value = draf.inputNoRekening;
      const elCabang = document.getElementById('input-cabang-bank');
      if (draf.inputKantorCabang && elCabang) elCabang.value = draf.inputKantorCabang;
      if (draf.inputNoKontak && inputKontak) inputKontak.value = draf.inputNoKontak;
      const elBpjs = document.getElementById('input-bpjs');
      if (draf.selectBpjs && elBpjs) elBpjs.value = draf.selectBpjs;

      tampilkanToast('Draf formulir berhasil dipulihkan.', 'sukses');
      const banner = document.getElementById('banner-draf-tersimpan');
      if (banner) banner.classList.add('hidden');
    }, 250);
  } catch (err) {
    tampilkanToast('Gagal memulihkan draf: ' + (err ? err.message : err), 'gagal');
  }
}

// Inisialisasi tombol draf
const btnPulihkanDraf = document.getElementById('btn-pulihkan-draf');
if (btnPulihkanDraf) btnPulihkanDraf.addEventListener('click', pulihkanDrafLokalForm);
const btnBuangDraf = document.getElementById('btn-buang-draf');
if (btnBuangDraf) btnBuangDraf.addEventListener('click', hapusDrafLokalForm);

// Perekam otomatis ke sessionStorage saat user mengetik
if (typeof formPembayaran !== 'undefined' && formPembayaran) {
  formPembayaran.addEventListener('input', function () {
    clearTimeout(timerDebounceDraf);
    timerDebounceDraf = setTimeout(simpanDrafLokalForm, 1000);
  });
  formPembayaran.addEventListener('change', function () {
    clearTimeout(timerDebounceDraf);
    timerDebounceDraf = setTimeout(simpanDrafLokalForm, 500);
  });

  // Pengecekan ukuran instan saat user memilih berkas
  formPembayaran.querySelectorAll('input[type="file"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf && file.size > 3.2 * 1024 * 1024) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        tampilkanToast('⚠️ Dokumen PDF "' + file.name + '" (' + mb + ' MB) melebihi batas 3.2 MB gateway upload. Mohon kompres file PDF terlebih dahulu.', 'gagal', { durasi: 7000 });
        input.value = '';
        return;
      }

      if (file.size > 25 * 1024 * 1024) {
        tampilkanToast('⚠️ Berkas "' + file.name + '" melebihi 25 MB. Mohon pilih berkas dengan ukuran lebih kecil.', 'gagal', { durasi: 6000 });
        input.value = '';
        return;
      }
    });
  });
}

setTimeout(cekDanTampilkanBannerDraf, 500);

function kompresGambar(file, maxDim, kualitas) {
  return new Promise(function (resolve) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0 || file.type === 'image/svg+xml') {
      resolve(file); return;
    }
    if (file.size < 400 * 1024) { resolve(file); return; } // sudah kecil, tidak perlu dikompres

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      const batas = maxDim || 1600;
      if (w > batas || h > batas) {
        if (w >= h) { h = Math.round(h * (batas / w)); w = batas; }
        else { w = Math.round(w * (batas / h)); h = batas; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) {
        if (!blob) { resolve(file); return; }
        const namaBaru = (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
        resolve(new File([blob], namaBaru, { type: 'image/jpeg' }));
      }, 'image/jpeg', kualitas || 0.75);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Helper Upload Berkas
async function bacaFileTerkompresi(inputEl) {
  if (!inputEl || !inputEl.files || inputEl.files.length === 0) return null;

  let file = inputEl.files[0];
  try {
    file = await kompresGambar(file); // PDF/non-gambar otomatis dilewati di dalam fungsi ini
  } catch (eKompres) {
  }

  const MAKS_BYTE = 25 * 1024 * 1024; // 25 MB per berkas
  if (file.size > MAKS_BYTE) throw new Error('Ukuran berkas "' + file.name + '" melebihi 25 MB. Mohon perkecil ukuran file.');

  // Vercel serverless request body memiliki batas keras 4.5 MB.
  // Base64 encoding menambah overhead ~33%. File > 3.2 MB akan menghasilkan > 4.3 MB payload yang ditolak proxy.
  if (file.size > 3.2 * 1024 * 1024) {
    throw new Error('Ukuran berkas "' + file.name + '" (' + (file.size / (1024 * 1024)).toFixed(1) + ' MB) terlalu besar untuk gateway upload. Maksimal 3.2 MB per berkas (khusus dokumen PDF, mohon dikompres terlebih dahulu).');
  }

  const base64Data = await new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const res = reader.result;
      resolve(res.substring(res.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return { namaFile: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: base64Data };
}

function panggilAksiPromise(namaAksi) {
  const args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve, reject) {
    const run = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
    run[namaAksi].apply(run, args);
  });
}

async function unggahBerkasLangsungKeStorage(konteks, berkasMap) {
  const kunciList = Object.keys(berkasMap);
  if (kunciList.length === 0) return { sukses: true, link: {} };

  const totalBerkas = kunciList.length;
  let berkasSelesai = 0;

  // Elemen progress bar pada loadingOverlay
  const progressContainer = document.getElementById('loading-progress-container');
  const progressLabel = document.getElementById('loading-progress-label');
  const progressPersen = document.getElementById('loading-progress-persen');
  const progressBar = document.getElementById('loading-progress-bar');
  const progressSub = document.getElementById('loading-progress-sub');

  if (progressContainer) {
    progressContainer.classList.remove('hidden');
    if (progressPersen) progressPersen.innerText = '0%';
    if (progressBar) progressBar.style.width = '0%';
    if (progressLabel) progressLabel.innerText = `Mengunggah Berkas (0/${totalBerkas})`;
    if (progressSub) progressSub.innerText = 'Menyiapkan pengunggahan berkas ke Google Drive...';
  }

  // Pemanasan (Warmup) GAS untuk mencegah timeout saat cold start
  try {
    await panggilAksiPromise('uploadSemuaBerkasKeDrive', dataPengguna.token, konteks, {});
  } catch (_e) { /* abaikan error warmup */ }

  function updateProgressUI(namaBerkas, sedangUnggah) {
    if (!progressContainer) return;
    const persen = Math.round((berkasSelesai / totalBerkas) * 100);
    if (progressPersen) progressPersen.innerText = persen + '%';
    if (progressBar) progressBar.style.width = persen + '%';
    if (progressLabel) progressLabel.innerText = `Mengunggah Berkas (${berkasSelesai}/${totalBerkas})`;
    if (progressSub) {
      progressSub.innerText = sedangUnggah ? `Mengunggah: ${namaBerkas}...` : `Selesai: ${namaBerkas}`;
    }
  }

  // Upload satu berkas dengan auto-retry hingga 2x (3 total kesempatan)
  async function uploadSatuBerkasDenganRetry(k, item, maxRetries) {
    const limitRetry = typeof maxRetries === 'number' ? maxRetries : 2;
    const labelBerkas = item.label || k;
    const mapKecil = {};
    mapKecil[k] = item;

    let lastErrorMsg = null;
    for (let attempt = 0; attempt <= limitRetry; attempt++) {
      if (attempt > 0) {
        if (progressSub) progressSub.innerText = `Koneksi terganggu. Mencoba ulang (${attempt}/${limitRetry}): ${labelBerkas}... ⏱️`;
        await new Promise(function (res) { setTimeout(res, 1000 * attempt); });
      } else {
        updateProgressUI(labelBerkas, true);
      }

      try {
        const res = await panggilAksiPromise('uploadSemuaBerkasKeDrive', dataPengguna.token, konteks, mapKecil);
        if (res && res.sukses && res.link && res.link[k]) {
          berkasSelesai++;
          updateProgressUI(labelBerkas, false);
          return { k: k, linkDrive: res.link[k], gagal: null };
        }
        if (res && res.pesan && res.pesan.includes('Batas waktu')) {
          lastErrorMsg = 'Server upload Google Drive tidak merespons (cold start). Coba ulangi beberapa saat.';
        } else {
          lastErrorMsg = res ? res.pesan : 'Tidak ada respons dari server upload.';
        }
      } catch (eNet) {
        const errMsg = eNet && eNet.message ? eNet.message : 'timeout';
        if (errMsg.includes('Batas waktu')) {
          lastErrorMsg = 'Server upload Google Drive tidak merespons (cold start). Coba ulangi beberapa saat.';
        } else {
          lastErrorMsg = 'Kendala jaringan (' + errMsg + ').';
        }
      }
    }

    return { k: k, linkDrive: null, gagal: `Gagal mengunggah "${labelBerkas}": ${lastErrorMsg}` };
  }

  // Concurrency Pool: batasi maksimal 2 antrean paralel agar tidak membebani limit GAS / Vercel
  const CONCURRENCY_LIMIT = 2;
  const hasilList = [];
  let indexAntrean = 0;
  let adaGagalFatal = false;

  async function antreanWorker() {
    while (indexAntrean < kunciList.length && !adaGagalFatal) {
      const idx = indexAntrean++;
      const k = kunciList[idx];
      const item = berkasMap[k];
      const hasil = await uploadSatuBerkasDenganRetry(k, item, 2);
      hasilList.push(hasil);
      if (hasil.gagal) {
        adaGagalFatal = true;
        break;
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY_LIMIT, kunciList.length);
  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(antreanWorker());
  }
  await Promise.all(workers);

  if (progressContainer) {
    progressContainer.classList.add('hidden');
  }

  const gagalPertama = hasilList.find(function (r) { return r.gagal; });
  if (gagalPertama) {
    return { sukses: false, pesan: gagalPertama.gagal };
  }

  const daftarLink = {};
  hasilList.forEach(function (r) { if (r.linkDrive) daftarLink[r.k] = r.linkDrive; });

  return { sukses: true, link: daftarLink };
}

async function kumpulkanDataForm() {
  function val(name) {
    const el = formPembayaran.querySelector('[name="' + name + '"]');
    return el ? el.value : "";
  }
  function fileEl(name) { return formPembayaran.querySelector('input[type="file"][name="' + name + '"]'); }

  const namaFileInput = ['fileKtp', 'fileBukuRekening', 'fileSuratPermohon', 'filePernyataan', null, 'fileDomisili', 'fileBerkasPendukung', 'fileBerkasPendukung2', 'fileFotoPlank', 'fileFotoIbadah', 'fileFotoKegiatan', 'fileRekomendasiBkm', 'fileRekomendasiRi'];

  const data = {
    selectLayanan: val('selectLayanan'),
    inputTempatTugas: val('inputTempatTugas'),
    inputAlamatTugas: val('inputAlamatTugas'),
    inputNama: val('inputNama'),
    inputNik: val('inputNik'),
    selectGender: val('selectGender'),
    inputTempatLahir: val('inputTempatLahir'),
    inputTglLahir: val('inputTglLahir'),
    inputUmur: val('inputUmur'),
    inputAlamat: val('inputAlamat'),
    controlKecamatan: document.getElementById('control-kecamatan') ? document.getElementById('control-kecamatan').value : "",
    controlKelurahan: val('controlKelurahan'),
    inputNamaRekening: val('inputNamaRekening'),
    inputNoRekening: val('inputNoRekening'),
    inputKantorCabang: val('inputKantorCabang'),
    inputNoKontak: val('inputNoKontak'),
    selectBpjs: val('selectBpjs'),
    catatanPerbedaanNama: namaBerbedaDikonfirmasi ? catatanPerbedaanNamaTersimpan : "",
    koordinatLink: KONFIG_KOORDINAT.plank.siap
      ? document.getElementById(KONFIG_KOORDINAT.plank.idHidden).value
      : (KONFIG_KOORDINAT.ibadah.siap ? document.getElementById(KONFIG_KOORDINAT.ibadah.idHidden).value : "")
  };

  const berkas = {};
  await Promise.all(namaFileInput.map(async function (nm) {
    if (!nm) return;
    const el = fileEl(nm);
    // Lewati input yang tersembunyi (wrapper .hidden)
    const wrapperHidden = el && el.closest('.hidden');
    if (el && !wrapperHidden) {
      berkas[nm] = await bacaFileTerkompresi(el);
    } else {
      berkas[nm] = null;
    }
  }));
  data.__berkas = berkas;
  return data;
}

function labelBerkasSimpanBaru(layanan) {
  const lay = (layanan || "").toString().toUpperCase().trim();
  return {
    fileKtp: "KTP", fileBukuRekening: "Buku Rekening", fileSuratPermohon: "Surat Permohonan",
    filePernyataan: "Surat Pernyataan", fileDomisili: "Domisili Kelurahan",
    fileBerkasPendukung: "Formulir Pendataan",
    fileBerkasPendukung2: (lay === "USTADZ" || lay === "USTADZAH") ? "Rekomendasi MUI" : "Berkas Pendukung",
    fileFotoPlank: "Foto Plank Rumah Ibadah", fileFotoIbadah: "Foto Lokasi Ibadah", fileFotoKegiatan: "Foto Kegiatan Belajar",
    fileRekomendasiBkm: "Rekomendasi BKM", fileRekomendasiRi: "Rekomendasi Rumah Ibadah"
  };
}

function panggilSimpanDataKeSheetSetelahUpload(dataObjek, pulihkanTombol) {
  function eksekusiSimpan() {
    google.script.run
      .withSuccessHandler(function (response) {
        if (typeof pulihkanTombol === 'function') pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        if (response.sukses) {
          invalidateCacheDataTransaksi();
          hapusDrafLokalForm();
          tampilkanToast(response.pesan, 'sukses');
          formPembayaran.reset();
          btnResetForm.click();
        } else {
          tampilkanToast("Gagal menyimpan: " + response.pesan, 'gagal', { durasi: 6000 });
        }
      })
      .withFailureHandler(function (errSimpan) {
        if (typeof pulihkanTombol === 'function') pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        tampilkanToast(pesanErrorRamah(errSimpan), 'gagal', { durasi: 6000 });
      })
      .simpanDataKeSheet(dataPengguna.token, dataObjek);
  }

  const berkasMentah = dataObjek.__berkas || {};
  const adaBerkas = Object.keys(berkasMentah).some(function (k) { return berkasMentah[k] && berkasMentah[k].dataBase64; });

  if (!adaBerkas) {
    loadingOverlay.querySelector('h3').innerText = "MENYIMPAN DATA...";
    eksekusiSimpan();
    return;
  }

  loadingOverlay.querySelector('h3').innerText = "MENGUNGGAH BERKAS...";
  const label = labelBerkasSimpanBaru(dataObjek.selectLayanan);
  const berkasUntukUpload = {};
  Object.keys(berkasMentah).forEach(function (k) {
    const item = berkasMentah[k];
    if (item && item.dataBase64) {
      berkasUntukUpload[k] = { dataBase64: item.dataBase64, namaFile: item.namaFile, mimeType: item.mimeType, label: label[k] || k };
    }
  });

  unggahBerkasLangsungKeStorage(
    { kecamatan: dataObjek.controlKecamatan, layanan: dataObjek.selectLayanan, nama: dataObjek.inputNama, nik: dataObjek.inputNik },
    berkasUntukUpload
  ).then(function (hasilUpload) {
    if (!hasilUpload || !hasilUpload.sukses) {
      if (typeof pulihkanTombol === 'function') pulihkanTombol();
      loadingOverlay.classList.add('hidden');
      tampilkanToast("Gagal mengunggah berkas: " + (hasilUpload ? hasilUpload.pesan : "Tidak ada respons."), 'gagal', { durasi: 6000 });
      return;
    }
    dataObjek.__linkBerkas = hasilUpload.link;
    delete dataObjek.__berkas;
    loadingOverlay.querySelector('h3').innerText = "MENYIMPAN DATA...";
    eksekusiSimpan();
  }).catch(function (errUpload) {
    if (typeof pulihkanTombol === 'function') pulihkanTombol();
    loadingOverlay.classList.add('hidden');
    tampilkanToast("Gagal mengunggah berkas: " + pesanErrorRamah(errUpload), 'gagal', { durasi: 6000 });
  });
}

function prosesValidasiDanSimpan() {
  const btnSimpan = document.getElementById('btn-simpan-data');
  if (btnSimpan) {
    btnSimpan.disabled = true;
    btnSimpan.classList.add('opacity-50', 'cursor-not-allowed');
  }

  function pulihkanTombol() {
    if (btnSimpan) {
      btnSimpan.disabled = false;
      btnSimpan.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  loadingOverlay.classList.remove('hidden');
  loadingOverlay.querySelector('h3').innerText = "MEMVERIFIKASI DATA...";

  google.script.run
    .withSuccessHandler(function (status) {
      if (!status.valid && status.tolakCapil) {
        pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        document.getElementById('teks-nama-capil').textContent = status.namaCapil || '-';
        document.getElementById('teks-nik-capil').textContent = status.nikCapil || inputNik.value || '-';
        document.getElementById('teks-alamat-capil').textContent = status.alamatDomisiliCapil || '-';
        document.getElementById('teks-kabkota-capil').textContent = status.kabKotaDomisiliCapil || '-';
        document.getElementById('teks-status-capil').textContent = status.statusCapil || '-';
        document.getElementById('modal-tolak-capil').classList.remove('hidden');
        return;
      }

      if (!status.valid && status.tolakStatus2026) {
        pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        document.getElementById('teks-nama-2026').textContent = status.nama2026 || '-';
        document.getElementById('teks-nik-2026').textContent = inputNik.value || '-';
        document.getElementById('teks-layanan-2026').textContent = status.layanan2026 || '-';
        document.getElementById('teks-status-2026').textContent = status.status2026 || 'TIDAK AKTIF';
        document.getElementById('modal-tolak-2026').classList.remove('hidden');
        return;
      }
      if (!status.valid && status.kuotaHabis) {
        pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        document.getElementById('pesan-kuota-habis').textContent = status.pesan;
        document.getElementById('modal-kuota-habis').classList.remove('hidden');
        return;
      }
      if (!status.valid && status.temuan && status.temuan.length > 0) {
        pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        const wrap = document.getElementById('daftar-temuan-duplikat');
        wrap.innerHTML = status.temuan.map(function (t) {
          return '<div class="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">' +
            '<span class="text-xl shrink-0 mt-0.5">' + t.ikon + '</span>' +
            '<div>' +
            '<div class="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-0.5">' + esc(t.jenis) + '</div>' +
            '<div class="text-sm text-slate-700 leading-snug">' + esc(t.detail) + '</div>' +
            '</div>' +
            '</div>';
        }).join('');
        document.getElementById('modal-temuan-duplikat').classList.remove('hidden');
        return;
      }
      if (!status.valid) {
        pulihkanTombol();
        loadingOverlay.classList.add('hidden');
        tampilkanToast(status.pesan, 'gagal', { durasi: 6000 });
        return;
      }
      // Validasi lolos -> baca berkas jadi base64, lalu kirim sebagai OBJEK (bukan elemen form).
      loadingOverlay.querySelector('h3').innerText = "MEMBACA BERKAS...";
      kumpulkanDataForm()
        .then(function (dataObjek) {
          panggilSimpanDataKeSheetSetelahUpload(dataObjek, pulihkanTombol);
        })
        .catch(function (errBaca) {
          pulihkanTombol();
          loadingOverlay.classList.add('hidden');
          tampilkanToast("Gagal membaca berkas: " + (errBaca && errBaca.message ? errBaca.message : errBaca), 'gagal');
        });
    })
    .withFailureHandler(function (err) {
      pulihkanTombol();
      loadingOverlay.classList.add('hidden');
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .validasiDataBaru(dataPengguna.token, inputNik.value, selectLayanan.value, inputTempatTugas.value, instansiAktif, inputNoRek.value, document.getElementById('control-kecamatan').value, document.getElementById('input-almt-tugas').value);
}

// Cek Kesesuaian Nama Rekening
const DAFTAR_GELAR_DIABAIKAN = [
  'DR', 'DRS', 'DRA', 'IR', 'PROF', 'H', 'HJ', 'KH', 'TGK', 'HC',
  'SPD', 'SE', 'ST', 'SH', 'SSOS', 'SSI', 'SAG', 'SKOM', 'SIP', 'SFARM', 'SPT', 'SPI', 'SKM', 'SPSI',
  'MSI', 'MPD', 'MH', 'MM', 'MKES', 'MSC', 'MAG', 'MSOS', 'MEI', 'MPDI',
  'SP', 'APT', 'AMD', 'AMDKEB', 'AMK'
];

function normalisasiNama(nama) {
  if (!nama) return '';
  let n = nama.toString().toUpperCase().trim().replace(/[.,]/g, ' ');
  const kata = n.split(/\s+/).filter(function (w) {
    return w && DAFTAR_GELAR_DIABAIKAN.indexOf(w) === -1;
  });
  return kata.join(' ').trim();
}

function bangunHtmlHighlight(namaAsli, kataPembanding) {
  const kataAsli = namaAsli.toUpperCase().trim().split(/\s+/);
  const setPembanding = new Set(kataPembanding);
  return kataAsli.map(function (w) {
    return setPembanding.has(w) ? esc(w) : '<span class="bg-yellow-200 px-1 rounded">' + esc(w) + '</span>';
  }).join(' ');
}

let namaBerbedaDikonfirmasi = false;
let catatanPerbedaanNamaTersimpan = "";

function resetKonfirmasiNamaBeda() {
  namaBerbedaDikonfirmasi = false;
  catatanPerbedaanNamaTersimpan = "";
}

function cekKesesuaianNama() {
  const elNamaLengkap = document.getElementById('input-nama');
  const elNamaRekening = document.getElementById('input-nama-rek');
  const namaLengkap = elNamaLengkap ? elNamaLengkap.value.trim() : '';
  const namaRekening = elNamaRekening ? elNamaRekening.value.trim() : '';
  if (!namaLengkap || !namaRekening) return true; // biar validasi 'required' bawaan yang tangani

  const normLengkap = normalisasiNama(namaLengkap);
  const normRekening = normalisasiNama(namaRekening);

  if (normLengkap === normRekening) { resetKonfirmasiNamaBeda(); return true; }
  if (namaBerbedaDikonfirmasi) return true; // sudah dikonfirmasi sebelumnya untuk pasangan nama ini

  // Tampilkan modal perbandingan
  const kataLengkap = normalisasiNama(namaLengkap).split(/\s+/);
  const kataRekening = normalisasiNama(namaRekening).split(/\s+/);
  document.getElementById('tampil-nama-lengkap-diff').innerHTML = bangunHtmlHighlight(namaLengkap, kataRekening);
  document.getElementById('tampil-nama-rekening-diff').innerHTML = bangunHtmlHighlight(namaRekening, kataLengkap);
  document.getElementById('area-tombol-awal-beda').classList.remove('hidden');
  document.getElementById('area-keterangan-beda').classList.add('hidden');
  document.getElementById('input-catatan-nama-beda').value = '';
  document.getElementById('modal-nama-beda').classList.remove('hidden');
  return false;
}

document.getElementById('btn-perbaiki-nama').addEventListener('click', function () {
  document.getElementById('modal-nama-beda').classList.add('hidden');
  document.getElementById('input-nama-rek').focus();
});

document.getElementById('btn-konfirmasi-orang-sama').addEventListener('click', function () {
  document.getElementById('area-tombol-awal-beda').classList.add('hidden');
  document.getElementById('area-keterangan-beda').classList.remove('hidden');
});

document.getElementById('btn-lanjutkan-nama-beda').addEventListener('click', function () {
  const ket = document.getElementById('input-catatan-nama-beda').value.trim().toUpperCase();
  if (!ket) { tampilkanToast('Keterangan wajib diisi.', 'gagal'); return; }
  namaBerbedaDikonfirmasi = true;
  catatanPerbedaanNamaTersimpan = ket;
  document.getElementById('modal-nama-beda').classList.add('hidden');
  formPembayaran.requestSubmit(); // jalankan ulang proses submit, sekarang akan lolos pengecekan nama
});

document.getElementById('input-nama').addEventListener('input', resetKonfirmasiNamaBeda);
document.getElementById('input-nama-rek').addEventListener('input', resetKonfirmasiNamaBeda);

formPembayaran.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pastikanLogin()) return;

  // Wajib ada koordinat lokasi untuk GMM / Guru Sekolah Minggu/Buddha/Hindu sebelum lanjut
  for (const modeKoordinat of Object.keys(KONFIG_KOORDINAT)) {
    const cfgKoordinat = KONFIG_KOORDINAT[modeKoordinat];
    if (cfgKoordinat.layananList.indexOf(selectLayanan.value) !== -1 && !cfgKoordinat.siap) {
      tampilkanToast("Koordinat lokasi foto wajib terisi (otomatis dari GPS foto, atau tempel tautan Google Maps manual) sebelum data bisa disimpan.", "gagal", { durasi: 6000 });
      document.getElementById(cfgKoordinat.wrapperId).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  // Uppercase semua field teks sebelum validasi
  const semuaInputTeks = formPembayaran.querySelectorAll('input[type="text"]');
  semuaInputTeks.forEach(input => { input.value = input.value.trim().toUpperCase(); });

  // Cek Kesesuaian Nama Rekening
  if (!cekKesesuaianNama()) return;

  // Validasi lokal cepat sebelum tampilkan modal
  const kecVal = document.getElementById('control-kecamatan').value;
  if (!kecVal) { tampilkanToast("Kecamatan lokasi tugas wajib dipilih!", "gagal"); document.getElementById('control-kecamatan').focus(); return; }
  if (parseInt(inputUmur.value) < 18) { tampilkanToast("Umur di bawah 18 tahun!", "gagal"); inputTglLahir.focus(); return; }
  if (inputNik.value.length !== 16) { tampilkanToast("NIK wajib 16 digit!", "gagal"); inputNik.focus(); return; }
  if (inputNoRek.value.length !== 14) { tampilkanToast("No Rekening wajib 14 digit!", "gagal"); inputNoRek.focus(); return; }
  if (!inputKontak.value.startsWith("08") || inputKontak.value.length < 10 || inputKontak.value.length > 13) {
    tampilkanToast("Nomor kontak tidak valid! Harus diawali 08, tanpa spasi/simbol, dan panjang 10-13 digit.", "gagal");
    inputKontak.focus();
    return;
  }

  // Periksa apakah ada dokumen PDF yang melebihi batas 3.2 MB gateway upload
  const semuaFileInput = formPembayaran.querySelectorAll('input[type="file"]');
  for (let f = 0; f < semuaFileInput.length; f++) {
    const fIn = semuaFileInput[f];
    if (fIn.files && fIn.files[0]) {
      const file = fIn.files[0];
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf && file.size > 3.2 * 1024 * 1024) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        tampilkanToast('Dokumen PDF "' + file.name + '" (' + mb + ' MB) melebihi batas 3.2 MB gateway upload. Mohon kompres file PDF terlebih dahulu.', 'gagal', { durasi: 7000 });
        fIn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  }

  // Tampilkan modal konfirmasi
  document.getElementById('modal-konfirmasi-simpan').classList.remove('hidden');
});

document.getElementById('btn-konfirmasi-ok').addEventListener('click', function () {
  document.getElementById('modal-konfirmasi-simpan').classList.add('hidden');
  prosesValidasiDanSimpan();
});

document.getElementById('btn-konfirmasi-kembali').addEventListener('click', function () {
  document.getElementById('modal-konfirmasi-simpan').classList.add('hidden');
});

// Lihat Data & Rekap
let masterDataLihat = [];
let waktuMasterDataLihat = 0; // timestamp fetch terakhir, dipakai untuk cache TTL_CACHE_DATA_TRANSAKSI_MS
let halamanSekarang = 1;
const dataPerHalaman = 50;

// Lihat Data & Rekap
function invalidateCacheDataTransaksi() {
  waktuMasterDataLihat = 0;
  cacheDashboardProgres = {};
  try { sessionStorage.removeItem('dana_jasa_lihat_cache'); } catch (e) { }
}

function perbaruiStatusDiMasterData(nomorBaris, statusBaru) {
  for (let i = 0; i < masterDataLihat.length; i++) {
    if (masterDataLihat[i][0] === nomorBaris) {
      masterDataLihat[i][18] = statusBaru;
      break;
    }
  }
  if (typeof saringDanTampilkanTabel === 'function') saringDanTampilkanTabel();
}
let penandaWaktuKetik;

function inisialisasiMenuLihatData() {
  if (!pastikanLogin()) return;
  const btnVerifMassal = document.getElementById('btn-verifikasi-massal');
  if (btnVerifMassal) btnVerifMassal.classList.toggle('hidden', dataPengguna.role !== "UTAMA");
  const btnSalinWA = document.getElementById('btn-salin-wa-berkas');
  if (btnSalinWA) btnSalinWA.classList.toggle('hidden', dataPengguna.role !== "UTAMA");

  // Optimistic Instant Render: Coba pulihkan dari sessionStorage jika memori masih kosong
  if (!masterDataLihat || masterDataLihat.length === 0) {
    try {
      const tersimpan = sessionStorage.getItem('dana_jasa_lihat_cache');
      if (tersimpan) {
        const parsed = JSON.parse(tersimpan);
        if (parsed && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
          masterDataLihat = parsed.rows;
          waktuMasterDataLihat = parsed.waktu || Date.now();
          const infoTotal = document.getElementById('info-total-penerima');
          if (infoTotal) infoTotal.innerText = "Total Data: " + masterDataLihat.length + " Baris";
          membangunOpsiFilter(masterDataLihat);
          saringDanTampilkanTabel();
          setupPencarianRealtime();
        }
      }
    } catch (e) { }
  }

  // Tampilkan skeleton hanya jika belum ada baris data sama sekali
  const tbodyLihat = document.getElementById('body-tabel-lihat');
  if (tbodyLihat && (!masterDataLihat || masterDataLihat.length === 0)) {
    tbodyLihat.innerHTML = htmlSkeletonBaris(8, 5);
  }

  google.script.run
    .withSuccessHandler(function (jsonResponse) {
      try {
        const response = jsonResponse ? JSON.parse(jsonResponse) : null;
        if (response && response.sukses) {
          masterDataLihat = response.rows;
          waktuMasterDataLihat = Date.now();
          try {
            sessionStorage.setItem('dana_jasa_lihat_cache', JSON.stringify({ rows: response.rows, waktu: waktuMasterDataLihat }));
          } catch (e) { }
          const infoTotal = document.getElementById('info-total-penerima');
          if (infoTotal) infoTotal.innerText = "Total Data: " + masterDataLihat.length + " Baris";
          if (masterDataLihat.length === 0) {
            document.getElementById('body-tabel-lihat').innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400 italic">Belum ada data tersimpan.</td></tr>';
            return;
          }
          membangunOpsiFilter(masterDataLihat);
          // halamanSekarang = 1; // DIHAPUS: Agar pengguna tidak kembali ke halaman 1 saat SWR refresh di background
          saringDanTampilkanTabel();
          setupPencarianRealtime();
        } else { tampilkanToast("Gagal memuat data: " + (response ? response.pesan : "Error JSON"), "gagal"); }
      } catch (err) { tampilkanToast("Error Render: " + err.message, "gagal"); }
    })
    .withFailureHandler(function (error) { tampilkanToast(pesanErrorRamah(error), "gagal", { durasi: 6000 }); })
    .ambilDataLihatDataHakAkses(dataPengguna.token);
}

window.tampilkanDataDetail = function () {
  if (!pastikanLogin()) return;
  document.getElementById('body-tabel-data-detail').innerHTML = htmlSkeletonBaris(20, 5);
  document.getElementById('info-total-data-detail').innerText = '';
  document.getElementById('modal-data-detail').classList.remove('hidden');
  muatDataDetail(true);
};

function muatDataDetail(bolehCobaLagi) {
  const info = document.getElementById('info-total-data-detail');
  const timerPenenang = setTimeout(function () {
    if (info) info.innerText = 'Server sedang bersiap, mohon tunggu sebentar lagi...';
  }, 4000);

  google.script.run
    .withSuccessHandler(function (res) {
      clearTimeout(timerPenenang);
      if (!res || !res.sukses) {
        document.getElementById('body-tabel-data-detail').innerHTML =
          '<tr><td colspan="20" class="px-4 py-6 text-center text-red-500">' + esc(res ? res.pesan : 'Gagal memuat data') + '</td></tr>';
        if (info) info.innerText = '';
        return;
      }
      renderTabelDataDetail(res.rows);
    })
    .withFailureHandler(function (err) {
      clearTimeout(timerPenenang);
      if (bolehCobaLagi) {
        if (info) info.innerText = 'Sempat gagal terhubung, mencoba lagi...';
        muatDataDetail(false);
        return;
      }
      document.getElementById('body-tabel-data-detail').innerHTML =
        '<tr><td colspan="20" class="px-4 py-6 text-center text-red-500">' + esc(pesanErrorRamah(err)) + '</td></tr>';
      if (info) info.innerText = '';
    })
    .ambilDataDetail(dataPengguna.token);
}

function renderTabelDataDetail(rows) {
  const tbody = document.getElementById('body-tabel-data-detail');
  document.getElementById('info-total-data-detail').innerText = 'Total Data: ' + rows.length + ' Baris';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="20" class="px-4 py-6 text-center text-slate-400 italic">Belum ada data Memenuhi Syarat.</td></tr>';
    return;
  }
  let html = '';
  rows.forEach(function (r, idx) {
    html += `
  <tr class="hover:bg-slate-50 transition border-b border-slate-100">
    <td class="px-3 py-2 text-center font-medium text-slate-400">${idx + 1}</td>
    <td class="px-3 py-2 font-semibold text-slate-800">${esc(r.nama) || '-'}</td>
    <td class="px-3 py-2 font-mono text-xs text-slate-600">${esc(r.nik) || '-'}</td>
    <td class="px-3 py-2">${esc(r.jenisKelamin) || '-'}</td>
    <td class="px-3 py-2">${esc(r.tempatLahir) || '-'}</td>
    <td class="px-3 py-2">${esc(r.tanggalLahir) || '-'}</td>
    <td class="px-3 py-2">${esc(r.alamat) || '-'}</td>
    <td class="px-3 py-2">${esc(r.layanan) || '-'}</td>
    <td class="px-3 py-2">${esc(r.tempatTugas) || '-'}</td>
    <td class="px-3 py-2">${esc(r.alamatTugas) || '-'}</td>
    <td class="px-3 py-2">${esc(r.kecamatan) || '-'}</td>
    <td class="px-3 py-2">${esc(r.kelurahan) || '-'}</td>
    <td class="px-3 py-2">${esc(r.namaRekening) || '-'}</td>
    <td class="px-3 py-2 font-mono text-xs">${esc(r.nomorRekening) || '-'}</td>
    <td class="px-3 py-2">${esc(r.kantorCabang) || '-'}</td>
    <td class="px-3 py-2">${esc(r.noKontak) || '-'}</td>
    <td class="px-3 py-2">${esc(r.statusBpjsTk) || '-'}</td>
    <td class="px-3 py-2 text-center">${esc(r.umur) || '-'}</td>
    <td class="px-3 py-2"><span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full">${esc(r.status) || '-'}</span></td>
    <td class="px-3 py-2 text-xs text-slate-500">${esc(r.tglStatus) || '-'}</td>
  </tr>`;
  });
  tbody.innerHTML = html;
}

function setupPencarianRealtime() {
  const inputCari = document.getElementById('input-cari-global');
  if (!inputCari) return;
  inputCari.oninput = null;
  inputCari.oninput = function () {
    clearTimeout(penandaWaktuKetik);
    penandaWaktuKetik = setTimeout(function () { aksiGantiFilter(); }, 120);
  };
}
function aksiGantiFilter() { halamanSekarang = 1; saringDanTampilkanTabel(); }

function membangunOpsiFilter(rows) {
  const setKecamatan = new Set(), setLayanan = new Set();
  const petaKelurahan = {};
  for (let i = 0; i < rows.length; i++) {
    const kec = rows[i][10], kel = rows[i][11], lay = rows[i][7];
    if (kec) { setKecamatan.add(kec); if (!petaKelurahan[kec]) petaKelurahan[kec] = new Set(); if (kel) petaKelurahan[kec].add(kel); }
    if (lay) setLayanan.add(lay);
  }
  const dKec = document.getElementById('filter-kecamatan');
  const dKel = document.getElementById('filter-kelurahan');
  const dLay = document.getElementById('filter-layanan');
  if (!dKec || !dKel || !dLay) return;
  let htmlKec = '<option value="">-- Semua Kecamatan --</option>';
  Array.from(setKecamatan).sort().forEach(v => htmlKec += `<option value="${v}">${v}</option>`);
  dKec.innerHTML = htmlKec;
  let htmlKel = '<option value="">-- Semua Kelurahan --</option>';
  const semuaKelurahan = new Set();
  Object.values(petaKelurahan).forEach(setKel => setKel.forEach(k => semuaKelurahan.add(k)));
  Array.from(semuaKelurahan).sort().forEach(v => htmlKel += `<option value="${v}">${v}</option>`);
  dKel.innerHTML = htmlKel;
  let htmlLay = '<option value="">-- Semua Layanan --</option>';
  Array.from(setLayanan).sort().forEach(v => htmlLay += `<option value="${v}">${v}</option>`);
  dLay.innerHTML = htmlLay;
  dKec.addEventListener('change', function () {
    const kecTerpilih = this.value;
    dKel.value = "";
    if (!kecTerpilih) {
      let htmlKelSemua = '<option value="">-- Semua Kelurahan --</option>';
      Array.from(semuaKelurahan).sort().forEach(v => htmlKelSemua += `<option value="${v}">${v}</option>`);
      dKel.innerHTML = htmlKelSemua;
    } else {
      const kelF = petaKelurahan[kecTerpilih] ? Array.from(petaKelurahan[kecTerpilih]).sort() : [];
      let htmlKelFilter = '<option value="">-- Semua Kelurahan --</option>';
      kelF.forEach(v => htmlKelFilter += `<option value="${v}">${v}</option>`);
      dKel.innerHTML = htmlKelFilter;
    }
    halamanSekarang = 1;
    saringDanTampilkanTabel();
  });

  if (dataPengguna.kecamatan) {
    const cocokKec = Array.from(setKecamatan).some(v => v.toUpperCase().trim() === dataPengguna.kecamatan.toUpperCase().trim());
    if (cocokKec) {
      dKec.value = dataPengguna.kecamatan;
      dKec.dispatchEvent(new Event('change')); // isi ulang daftar Kelurahan sesuai kecamatan ini

      if (dataPengguna.kelurahanTerkunci) {
        const cocokKel = Array.from(dKel.options).some(o => o.value.toUpperCase().trim() === dataPengguna.kelurahanTerkunci);
        if (cocokKel) dKel.value = dataPengguna.kelurahanTerkunci;
      }
      halamanSekarang = 1;
      saringDanTampilkanTabel();
    }
  }
}

function resetSemuaFilter() {
  const elCari = document.getElementById('input-cari-global');
  const elKec = document.getElementById('filter-kecamatan');
  const elKel = document.getElementById('filter-kelurahan');
  const elLay = document.getElementById('filter-layanan');
  const elVerif = document.getElementById('filter-verifikasi');

  if (elCari) elCari.value = '';
  if (elKec) {
    if (typeof dataPengguna !== 'undefined' && dataPengguna.role === 'KECAMATAN' && dataPengguna.kecamatan) {
      elKec.value = dataPengguna.kecamatan;
    } else {
      elKec.value = '';
    }
  }
  if (elKel) {
    if (typeof dataPengguna !== 'undefined' && dataPengguna.kelurahanTerkunci) {
      elKel.value = dataPengguna.kelurahanTerkunci;
    } else {
      elKel.value = '';
    }
  }
  if (elLay) elLay.value = '';
  if (elVerif) elVerif.value = '';

  halamanSekarang = 1;
  saringDanTampilkanTabel();
  if (typeof tampilkanToast === 'function') {
    tampilkanToast("Filter telah disetel ulang", "info", { durasi: 2000 });
  }
}
window.resetSemuaFilter = resetSemuaFilter;

function saringDanTampilkanTabel() {
  // Jika sedang menampilkan data tahun historis, alihkan ke renderer historis
  if (window._tahunDipilihGetter && window._tahunAktifGetter &&
    window._tahunDipilihGetter() !== window._tahunAktifGetter() &&
    window._dataHistorisSedang) {
    if (window._tampilDataHistoris) window._tampilDataHistoris();
    return;
  }

  // Pastikan kolom Verifikasi tampil lagi saat berada di tahun aktif (2027)
  const thVerif = document.getElementById('th-verifikasi');
  if (thVerif) thVerif.classList.remove('hidden');

  // Urutkan tampilan: Layanan > Kecamatan > Kelurahan (murni tampilan, tidak mengubah data di sheet)
  masterDataLihat.sort(function (a, b) {
    const lay = (a[7] || "").localeCompare(b[7] || "");
    if (lay !== 0) return lay;
    const kec = (a[10] || "").localeCompare(b[10] || "");
    if (kec !== 0) return kec;
    return (a[11] || "").localeCompare(b[11] || "");
  });
  const valKec = document.getElementById('filter-kecamatan').value;
  const valKel = document.getElementById('filter-kelurahan').value;
  const valLay = document.getElementById('filter-layanan').value;
  const valVerif = document.getElementById('filter-verifikasi') ? document.getElementById('filter-verifikasi').value : "";
  const kataKunci = document.getElementById('input-cari-global')?.value.toLowerCase() || "";
  const tbody = document.getElementById('body-tabel-lihat');
  if (!tbody) return;
  tbody.innerHTML = '';
  const dataLolosSaring = [];
  for (let i = 0; i < masterDataLihat.length; i++) {
    const row = masterDataLihat[i];
    const lolosKec = !valKec || row[10] === valKec;
    const lolosKel = !valKel || row[11] === valKel;
    const lolosLay = !valLay || row[7] === valLay;
    const statusRowIni = row[18] || "Proses Verifikasi";
    const sudahLaporIni = !!row[19];
    const lolosVerif = !valVerif
      || (valVerif === "Sudah Dilaporkan" ? (statusRowIni === "Berkas Tidak Lengkap" && sudahLaporIni) : statusRowIni === valVerif);
    const teksGabungan = (row[1] + " " + row[2] + " " + row[15] + " " + row[8]).toLowerCase();
    const lolosCari = !kataKunci || teksGabungan.includes(kataKunci);
    if (lolosKec && lolosKel && lolosLay && lolosCari && lolosVerif) dataLolosSaring.push(row);
  }
  const totalDataLolos = dataLolosSaring.length;
  const totalHalaman = Math.ceil(totalDataLolos / dataPerHalaman) || 1;
  if (halamanSekarang > totalHalaman) halamanSekarang = totalHalaman;
  if (halamanSekarang < 1) halamanSekarang = 1;
  const indeksAwal = (halamanSekarang - 1) * dataPerHalaman;
  const indeksAkhir = Math.min(indeksAwal + dataPerHalaman, totalDataLolos);
  const infoTotal = document.getElementById('info-total-penerima');
  if (totalDataLolos === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400 italic">Tidak ada data yang sesuai filter atau kata kunci.</td></tr>';
    if (infoTotal) infoTotal.innerText = "Total Data: 0 Baris";
    perbaruiElemenNavigasi(1, 1);
    return;
  }
  let nomorUrut = indeksAwal + 1;
  let barisTabelHtml = "";
  for (let k = indeksAwal; k < indeksAkhir; k++) {
    const row = dataLolosSaring[k];
    barisTabelHtml += `
  <tr class="hover:bg-slate-50 transition border-b border-slate-100">
    <td class="px-4 py-3 text-center font-medium text-slate-400">${nomorUrut++}</td>
    <td class="px-4 py-3 font-semibold text-slate-800 break-words">${esc(row[1]) || '-'}</td>
    <td class="px-4 py-3 font-mono text-xs text-slate-600 break-words">${esc(row[2]) || '-'}</td>
    <td class="px-4 py-3 break-words"><span class="bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 rounded-full font-medium inline-block">${esc(row[7]) || '-'}</span></td>
    <td class="px-4 py-3 text-xs text-slate-600 break-words">${esc(row[10]) || '-'}</td>
    <td class="px-4 py-3 text-xs text-slate-600 break-words">${esc(row[11]) || '-'}</td>
    <td class="px-4 py-3 text-center">${badgeStatusVerifikasi(row[18], row[19])}</td>
    <td class="px-4 py-3 text-center">
      <div class="flex flex-col items-center gap-1.5">
        <button onclick="tampilkanDetailKeModalOnDemand(${row[0]})" class="inline-flex items-center justify-center gap-1.5 w-full px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 border border-sky-200/80 rounded-lg font-semibold text-xs transition shadow-2xs">
          <svg class="w-3.5 h-3.5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>Detail</span>
        </button>
      </div>
    </td>
  </tr>`;
  }
  tbody.innerHTML = barisTabelHtml;
  if (infoTotal) infoTotal.innerText = "Total Data: " + totalDataLolos + " Baris";
  perbaruiElemenNavigasi(halamanSekarang, totalHalaman);
}

function badgeStatusVerifikasi(status, tanggalLapor) {
  const s = (status || "Proses Verifikasi").toString();
  if (s === "Memenuhi Syarat") {
    return '<span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-xs"><svg class="w-3 h-3 text-emerald-600 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>Memenuhi Syarat</span>';
  }
  if (s === "Tidak Memenuhi Syarat") {
    return '<span class="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200/80 text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-xs"><svg class="w-3 h-3 text-rose-600 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>Tidak Memenuhi</span>';
  }
  if (s === "Berkas Tidak Lengkap") {
    if (tanggalLapor) {
      return '<span class="inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-200/80 text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-xs"><svg class="w-3 h-3 text-sky-600 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/></svg>Sudah Dilaporkan</span>';
    }
    return '<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200/80 text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-xs"><svg class="w-3 h-3 text-amber-600 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>Berkas Kurang</span>';
  }
  return '<span class="inline-flex items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200/80 text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-xs"><svg class="w-3 h-3 text-slate-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>Proses Verifikasi</span>';
}

// Pembayaran Bank Sumut
const PERAN_TTD_LABEL = { KEPALA_DINAS: "Kepala Dinas Sosial", PPTK: "PPTK", BENDAHARA: "Bendahara Pengeluaran" };

function formatRupiahTools(angka) {
  return "Rp " + (Number(angka) || 0).toLocaleString('id-ID');
}

function inisialisasiMenuTools() {
  if (!pastikanLogin()) return;
  toolsMuatDaftarBatch();
  setTimeout(toolsMuatPejabat, 200);
  setTimeout(toolsMuatReferensiSk, 400);
  setTimeout(toolsMuatSkLayanan, 600);
}

function toolsMuatDaftarBatch() {
  const tbody = document.getElementById('tools-body-tabel-batch');
  tbody.innerHTML = htmlSkeletonBaris(6, 3);
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-500">' + esc(res ? res.pesan : 'Gagal memuat data') + '</td></tr>';
        return;
      }
      toolsRenderTabelBatch(res.daftar);
    })
    .withFailureHandler(function (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-500">' + esc(pesanErrorRamah(err)) + '</td></tr>';
    })
    .ambilDaftarBatchPembayaran(dataPengguna.token);
}

function toolsRenderTabelBatch(daftar) {
  const tbody = document.getElementById('tools-body-tabel-batch');
  if (!daftar || daftar.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 italic">Belum ada data pembayaran dibuat.</td></tr>';
    return;
  }
  let html = '';
  daftar.forEach(function (b) {
    const tglDibuat = b.diperbaruiAt ? new Date(b.diperbaruiAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    html += `
  <tr class="hover:bg-slate-50 transition border-b border-slate-100">
    <td class="px-3 py-2 font-semibold text-slate-800">${esc(b.bulan)} ${esc(b.tahun)}</td>
    <td class="px-3 py-2"><span class="bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 rounded-full font-medium">${esc(b.jenis)}</span></td>
    <td class="px-3 py-2 text-center">${esc(b.jumlahBaris)}</td>
    <td class="px-3 py-2 text-right font-mono text-xs">${formatRupiahTools(b.totalNominal)}</td>
    <td class="px-3 py-2 text-xs text-slate-500">${esc(tglDibuat)}</td>
    <td class="px-3 py-2 text-center">
      <button onclick="toolsDownloadBatch(${b.id})" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-emerald-700 border border-emerald-200 rounded-md font-semibold text-xs transition">📥 Download</button>
    </td>
  </tr>`;
  });
  tbody.innerHTML = html;
}

window.toolsBuatBatch = function () {
  if (!pastikanLogin()) return;
  const bulan = document.getElementById('tools-select-bulan').value;
  const jenis = document.getElementById('tools-select-jenis').value;
  if (!bulan) { tampilkanToast('Pilih bulan pembayaran dulu.', 'gagal'); return; }
  if (!jenis) { tampilkanToast('Pilih jenis pembayaran dulu.', 'gagal'); return; }

  const btn = document.getElementById('btn-tools-buat-batch');
  const labelAsli = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Memproses...';
  document.getElementById('tools-preview-rekap').innerHTML = '';

  google.script.run
    .withSuccessHandler(function (res) {
      btn.disabled = false;
      btn.innerHTML = labelAsli;
      if (!res || !res.sukses) {
        tampilkanToast('Gagal: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal', { durasi: 6000 });
        return;
      }
      tampilkanToast('Data pembayaran ' + bulan + ' (' + jenis + ') berhasil dibuat — ' + res.jumlahBaris + ' orang.', 'sukses');
      toolsTampilkanPreviewRekap(res.rekap);
      toolsMuatDaftarBatch();
    })
    .withFailureHandler(function (err) {
      btn.disabled = false;
      btn.innerHTML = labelAsli;
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .buatBatchPembayaran(dataPengguna.token, bulan, jenis);
};

function toolsTampilkanPreviewRekap(rekap) {
  const wrap = document.getElementById('tools-preview-rekap');
  if (!rekap || rekap.length === 0) { wrap.innerHTML = ''; return; }
  let html = '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">';
  rekap.forEach(function (r) {
    html += `
    <div class="bg-white border border-slate-200 rounded-lg p-3">
      <p class="text-xs font-bold text-slate-700">${esc(r.layananKode)}</p>
      <p class="text-[11px] text-slate-500">${esc(r.total)} orang (&lt;65: ${esc(r.bwh65)}, &ge;65: ${esc(r.ats65)})</p>
      <p class="text-xs font-mono text-emerald-700 mt-1">${formatRupiahTools(r.uang)}</p>
    </div>`;
  });
  html += '</div>';
  wrap.innerHTML = html;
}

window.toolsDownloadBatch = function (batchId) {
  if (!pastikanLogin()) return;
  tampilkanToast('Menyiapkan file Excel...', 'info');
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        tampilkanToast('Gagal: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal', { durasi: 6000 });
        return;
      }
      unduhFileBase64(res.base64, res.namaFile);
    })
    .withFailureHandler(function (err) {
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .unduhExcelBatch(dataPengguna.token, batchId);
};

function toolsMuatPejabat() {
  const wrap = document.getElementById('tools-form-pejabat');
  wrap.innerHTML = '<p class="text-xs text-slate-400 italic col-span-3">Memuat...</p>';
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        wrap.innerHTML = '<p class="text-xs text-red-500 col-span-3">' + esc(res ? res.pesan : 'Gagal memuat data') + '</p>';
        return;
      }
      toolsRenderFormPejabat(res.pejabat);
    })
    .withFailureHandler(function (err) {
      wrap.innerHTML = '<p class="text-xs text-red-500 col-span-3">' + esc(pesanErrorRamah(err)) + '</p>';
    })
    .ambilPejabatTtd(dataPengguna.token);
}

function toolsRenderFormPejabat(daftarPejabat) {
  const wrap = document.getElementById('tools-form-pejabat');
  let html = '';
  (daftarPejabat || []).forEach(function (p) {
    const idAman = p.peran;
    html += `
    <div class="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
      <p class="text-xs font-bold text-slate-700 uppercase">${esc(PERAN_TTD_LABEL[p.peran] || p.peran)}</p>
      <div>
        <label class="block text-[11px] font-medium text-slate-500 mb-0.5">Nama</label>
        <input type="text" id="tools-pejabat-nama-${idAman}" value="${esc(p.nama)}" class="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md" />
      </div>
      <div>
        <label class="block text-[11px] font-medium text-slate-500 mb-0.5">Jabatan / Pangkat</label>
        <input type="text" id="tools-pejabat-jabatan-${idAman}" value="${esc(p.jabatan)}" class="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md" />
      </div>
      <div>
        <label class="block text-[11px] font-medium text-slate-500 mb-0.5">NIP</label>
        <input type="text" id="tools-pejabat-nip-${idAman}" value="${esc(p.nip)}" class="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md" />
      </div>
      <button onclick="toolsSimpanPejabat('${idAman}')" class="w-full px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold transition">💾 Simpan</button>
    </div>`;
  });
  wrap.innerHTML = html;
}

window.toolsSimpanPejabat = function (peran) {
  if (!pastikanLogin()) return;
  const nama = document.getElementById('tools-pejabat-nama-' + peran).value.trim();
  const jabatan = document.getElementById('tools-pejabat-jabatan-' + peran).value.trim();
  const nip = document.getElementById('tools-pejabat-nip-' + peran).value.trim();

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        tampilkanToast('Gagal: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal', { durasi: 6000 });
        return;
      }
      tampilkanToast('Data pejabat berhasil disimpan.', 'sukses');
    })
    .withFailureHandler(function (err) {
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .simpanPejabatTtd(dataPengguna.token, peran, nama, jabatan, nip);
};

function toolsMuatReferensiSk() {
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) return;
      document.getElementById('tools-sk-nomor').value = res.nomorSk || '';
      document.getElementById('tools-sk-tanggal').value = res.tanggalSk || '';
    })
    .withFailureHandler(function () { /* diam saja, biarkan kosong */ })
    .ambilReferensiSkWalikota(dataPengguna.token);
}

window.toolsSimpanReferensiSk = function () {
  if (!pastikanLogin()) return;
  const nomorSk = document.getElementById('tools-sk-nomor').value.trim();
  const tanggalSk = document.getElementById('tools-sk-tanggal').value.trim();

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        tampilkanToast('Gagal: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal', { durasi: 6000 });
        return;
      }
      tampilkanToast('Referensi SK Wali Kota berhasil disimpan.', 'sukses');
    })
    .withFailureHandler(function (err) {
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .simpanReferensiSkWalikota(dataPengguna.token, nomorSk, tanggalSk);
};

function toolsMuatSkLayanan() {
  const tbody = document.getElementById('tools-body-sk-layanan');
  tbody.innerHTML = htmlSkeletonBaris(3, 3);
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-6 text-center text-red-500">' + esc(res ? res.pesan : 'Gagal memuat data') + '</td></tr>';
        return;
      }
      toolsRenderTabelSkLayanan(res.daftar);
    })
    .withFailureHandler(function (err) {
      tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-6 text-center text-red-500">' + esc(pesanErrorRamah(err)) + '</td></tr>';
    })
    .ambilSkLayanan(dataPengguna.token);
}

function toolsRenderTabelSkLayanan(daftar) {
  const tbody = document.getElementById('tools-body-sk-layanan');
  if (!daftar || daftar.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-6 text-center text-slate-400 italic">Tidak ada data.</td></tr>';
    return;
  }
  let html = '';
  daftar.forEach(function (r) {
    const idAman = r.layananKode.replace(/[^A-Za-z0-9]/g, '_');
    html += `
  <tr class="hover:bg-slate-50 transition border-b border-slate-100">
    <td class="px-3 py-2 font-semibold text-slate-800">${esc(r.namaLengkap)}</td>
    <td class="px-3 py-2">
      <input type="number" min="0" id="tools-sk-jumlah-${idAman}" value="${r.jumlahSk === null || r.jumlahSk === undefined ? '' : esc(r.jumlahSk)}"
        placeholder="-" class="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md" />
    </td>
    <td class="px-3 py-2">
      <button onclick="toolsSimpanSkLayanan('${esc(r.layananKode)}')" class="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 border border-sky-200 rounded-md font-semibold text-xs transition">💾 Simpan</button>
    </td>
  </tr>`;
  });
  tbody.innerHTML = html;
}

window.toolsSimpanSkLayanan = function (layananKode) {
  if (!pastikanLogin()) return;
  const idAman = layananKode.replace(/[^A-Za-z0-9]/g, '_');
  const input = document.getElementById('tools-sk-jumlah-' + idAman);
  const nilaiTeks = input.value.trim();
  const jumlahSk = nilaiTeks === '' ? null : Number(nilaiTeks);

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) {
        tampilkanToast('Gagal: ' + (res ? res.pesan : 'tidak diketahui'), 'gagal', { durasi: 6000 });
        return;
      }
      tampilkanToast('Jumlah SK ' + layananKode + ' berhasil disimpan.', 'sukses');
    })
    .withFailureHandler(function (err) {
      tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
    })
    .simpanSkLayanan(dataPengguna.token, layananKode, jumlahSk);
};

function perbaruiElemenNavigasi(sekarang, total) {
  const infoHal = document.getElementById('info-halaman');
  const wrap = document.getElementById('pagination-wrap');
  if (!wrap) return;

  // Info teks
  if (infoHal) {
    const awal = total === 0 ? 0 : (sekarang - 1) * dataPerHalaman + 1;
    const akhir = Math.min(sekarang * dataPerHalaman, total === 0 ? 0 :
      (() => { let t = 0; /* hitung total data dari filter aktif nanti */ return total * dataPerHalaman; })());
    infoHal.textContent = total === 0 ? 'Tidak ada data' : `Halaman ${sekarang} dari ${total}`;
  }

  if (total <= 1) { wrap.innerHTML = ''; return; }

  // Tentukan range nomor yang ditampilkan (maks 5 nomor)
  const TAMPIL = 5;
  let mulai = Math.max(1, sekarang - Math.floor(TAMPIL / 2));
  let akhirRange = mulai + TAMPIL - 1;
  if (akhirRange > total) { akhirRange = total; mulai = Math.max(1, akhirRange - TAMPIL + 1); }

  const BASE = 'px-3 py-1.5 rounded-xl text-xs font-semibold transition min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-center active:scale-95 shadow-2xs';
  const AKTIF = BASE + ' bg-slate-800 text-white shadow-xs';
  const PASIF = BASE + ' bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 cursor-pointer';
  const NONAKTIF = BASE + ' bg-slate-100/60 border border-slate-200/50 text-slate-300 cursor-not-allowed';

  let h = '';

  const ikonPrev = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>';
  const ikonNext = '<svg class="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>';

  h += `<button onclick="halamanSebelumnya()" ${sekarang === 1 ? 'disabled' : ''} class="${sekarang === 1 ? NONAKTIF : PASIF}" title="Halaman Sebelumnya">${ikonPrev}</button>`;

  // Ellipsis kiri
  if (mulai > 1) {
    h += `<button onclick="pindahHalaman(1)" class="${PASIF}">1</button>`;
    if (mulai > 2) h += `<span class="px-1 text-slate-400 text-xs">…</span>`;
  }

  // Nomor halaman
  for (let i = mulai; i <= akhirRange; i++) {
    h += `<button onclick="pindahHalaman(${i})" class="${i === sekarang ? AKTIF : PASIF}">${i}</button>`;
  }

  // Ellipsis kanan
  if (akhirRange < total) {
    if (akhirRange < total - 1) h += `<span class="px-1 text-slate-400 text-xs">…</span>`;
    h += `<button onclick="pindahHalaman(${total})" class="${PASIF}">${total}</button>`;
  }

  h += `<button onclick="halamanBerikutnya()" ${sekarang === total ? 'disabled' : ''} class="${sekarang === total ? NONAKTIF : PASIF}" title="Halaman Berikutnya">${ikonNext}</button>`;

  wrap.innerHTML = h;
}

function pindahHalaman(nomor) {
  halamanSekarang = nomor;
  saringDanTampilkanTabel();
}
function halamanSebelumnya() { if (halamanSekarang > 1) { halamanSekarang--; saringDanTampilkanTabel(); } }
function halamanBerikutnya() {
  halamanSekarang++;
  saringDanTampilkanTabel();
}

// Detail & Edit Penerima
(function () {

  const KOLOM_TEKS = {
    1: { label: "Nama Lengkap", type: "text" },
    2: { label: "NIK", type: "text" },
    3: { label: "Jenis Kelamin", type: "select", opsi: ["LAKI-LAKI", "PEREMPUAN"] },
    4: { label: "Tempat Lahir", type: "text" },
    5: { label: "Tanggal Lahir", type: "text", hint: "Format: DD-MM-YYYY" },
    6: { label: "Alamat Domisili", type: "text" },
    11: { label: "Kelurahan", type: "text" },
    12: { label: "Nama Rekening", type: "text" },
    13: { label: "Nomor Rekening", type: "text" },
    14: { label: "Kantor Cabang", type: "text" },
    15: { label: "No. Kontak", type: "text", hint: "Diawali 08" },
    16: { label: "Status BPJS TK", type: "select", opsi: ["YA", "TIDAK"] },
  };
  const KOLOM_BERKAS = {
    18: ["KTP"], 19: ["Buku Rekening"], 20: ["Surat Permohonan"],
    21: ["Surat Pernyataan (Satu Jenis & Bukan ASN/BUMN/BUMD/TNI/POLRI)"],
    22: ["Domisili Kelurahan"], 23: ["Formulir Pendataan"], 24: ["Berkas Pendukung"],
    25: ["Foto Plank"], 26: ["Foto Lokasi Ibadah"], 27: ["Foto Kegiatan"],
  };

  let nomorBarisAktif = null;
  let dataAktif = null;
  let modeEdit = false;
  let berkasBaruMap = {}; // {idx: {namaFile, mimeType, file}}

  const modal = document.getElementById('modal-detail-penerima');
  const isiKonten = document.getElementById('isi-konten-detail');
  const btnEdit = document.getElementById('btn-edit-detail');
  const btnSimpan = document.getElementById('btn-simpan-edit');
  const btnBatal = document.getElementById('btn-batal-edit');

  function getBerkasSesuaiLayanan(layanan) {
    const lay = (layanan || "").toString().toUpperCase().trim();
    // Berkas wajib semua layanan
    const dasar = [
      { idx: 18, label: "KTP" },
      { idx: 19, label: "Buku Rekening" },
      { idx: 20, label: "Surat Permohonan" },
      { idx: 22, label: "Domisili Kelurahan" },
      { idx: 21, label: "Surat Pernyataan (Satu Jenis & Bukan ASN/BUMN/BUMD/TNI/POLRI)" },
      { idx: 23, label: "Formulir Pendataan" },
      { idx: 24, label: (lay === "USTADZ" || lay === "USTADZAH") ? "Rekomendasi MUI" : "Berkas Pendukung" },
    ];
    // Foto & rekomendasi tambahan berdasarkan layanan
    if (lay === "GURU MAGHRIB MENGAJI") {
      dasar.push({ idx: 25, label: "Foto Plank Guru Maghrib Mengaji" });
      dasar.push({ idx: 27, label: "Foto Kegiatan Mengajar" });
      dasar.push({ idx: 28, label: "Rekomendasi BKM" }); // kosong jika tempat tugas Rumah/Lainnya
    } else if (["GURU SEKOLAH MINGGU", "GURU SEKOLAH BUDDHA", "GURU SEKOLAH HINDU"].includes(lay)) {
      dasar.push({ idx: 26, label: "Foto Rumah Ibadah Lokasi Tugas" });
      dasar.push({ idx: 27, label: "Foto Kegiatan Mengajar" });
      dasar.push({ idx: 29, label: "Rekomendasi Pengurus Rumah Ibadah" });
    } else if (lay === "PENATUA GEREJA") {
      dasar.push({ idx: 29, label: "Rekomendasi Pengurus Rumah Ibadah" });
    }
    return dasar;
  }

  function renderBaca(d) {
    const labelKolom = ["No. Urut", "Nama Lengkap", "NIK", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "Alamat Domisili", "Jenis Layanan", "Tempat Tugas", "Alamat Tugas", "Kecamatan", "Kelurahan", "Nama Rekening", "Nomor Rekening", "Kantor Cabang", "No. Kontak", "Status BPJS TK", "Umur"];

    const statusVerif = d[32] || "Proses Verifikasi";
    const keteranganVerif = d[33] || "";
    const tglVerif = d[34] || "";
    const olehVerif = d[35] || "";
    const batasWaktuVerif = d[36] || "";
    let h = `<div class="mb-4">${badgeStatusVerifikasi(statusVerif)}`;
    if ((statusVerif === "Tidak Memenuhi Syarat" || statusVerif === "Berkas Tidak Lengkap") && keteranganVerif) {
      const warnaBox = statusVerif === "Berkas Tidak Lengkap" ? "amber" : "red";
      const batasWaktuHtml = (statusVerif === "Berkas Tidak Lengkap" && batasWaktuVerif) ? ('<span class="block text-[11px] font-bold text-amber-700 mt-1">Batas waktu perbaikan: ' + esc(batasWaktuVerif) + '</span>') : '';
      h += `<div class="mt-2 bg-${warnaBox}-50 border border-${warnaBox}-200 rounded-lg px-3 py-2 text-xs text-${warnaBox}-700">
        <span class="font-bold">Keterangan:</span> ${esc(keteranganVerif)}
        <span class="block text-[10px] text-${warnaBox}-500 mt-1">Diverifikasi oleh ${esc(olehVerif)} · ${esc(tglVerif)}</span>
        ${batasWaktuHtml}
      </div>`;
    }
    h += `</div>`;

    const tglLaporPerbaikan = d[38] || "";
    const dilaporOlehPerbaikan = d[39] || "";

    if (isRoleKecKem_(dataPengguna.role) && statusVerif === "Berkas Tidak Lengkap") {
      if (tglLaporPerbaikan) {
        h += `<div class="mb-4 bg-sky-50 border border-sky-200 rounded-lg px-4 py-3">
          <p class="text-xs text-sky-800">🔔 Sudah dilaporkan diperbaiki oleh <strong>${esc(dilaporOlehPerbaikan)}</strong> pada ${esc(tglLaporPerbaikan)} — menunggu dicek ulang Admin Utama.</p>
        </div>`;
      } else {
        h += `<div class="mb-4 bg-sky-50 border border-sky-200 rounded-lg px-4 py-3">
          <p class="text-xs text-sky-800 mb-2">Sudah selesai memperbaiki berkas yang kurang? Beri tahu Admin Utama lewat sistem.</p>
          <button id="btn-lapor-perbaikan" class="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
            📢 Laporkan Sudah Diperbaiki
          </button>
        </div>`;
      }
    }

    if (dataPengguna.role === "UTAMA") {
      if (statusVerif === "Berkas Tidak Lengkap") {
        h += `<div class="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          ${tglLaporPerbaikan ? `<p class="text-xs text-emerald-800 mb-2">🔔 Dilaporkan sudah diperbaiki oleh <strong>${esc(dilaporOlehPerbaikan)}</strong> (${esc(tglLaporPerbaikan)}). Cek berkasnya, lalu:</p>` : `<p class="text-xs text-emerald-800 mb-2">Kalau sudah dicek dan berkasnya benar sudah lengkap:</p>`}
          <button id="btn-tandai-sudah-diperbaiki" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
            ✅ Tandai Sudah Diperbaiki
          </button>
        </div>`;
      }
      h += `<div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <p class="text-xs font-bold text-amber-900 uppercase mb-2">🔍 Verifikasi Admin Utama</p>
        <textarea id="input-keterangan-verifikasi" rows="2" placeholder="Tulis alasan jika data ini TIDAK memenuhi syarat..." class="w-full text-xs p-2 border border-amber-300 rounded-md mb-2"></textarea>
        <label class="block text-[10px] font-semibold text-amber-800 mb-1">Batas Waktu Perbaikan (khusus jika pilih "Berkas Tidak Lengkap")</label>
        <input type="date" id="input-batas-waktu-verifikasi" class="w-full text-xs p-2 border border-amber-300 rounded-md mb-2">
        <div class="flex gap-2">
          <button id="btn-tandai-berkas-tidak-lengkap" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
            📋 Tandai Berkas Tidak Lengkap
          </button>
          <button id="btn-tandai-tidak-memenuhi" class="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
            ❌ Tandai Tidak Memenuhi Syarat
          </button>
        </div>
      </div>`;
    }

    const catatanNamaBeda = d[37] || "";

    h += `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">`;
    for (let i = 0; i < labelKolom.length; i++) {
      const v = d[i] !== undefined && d[i] !== "" ? d[i] : "-";
      h += `<div class="bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-100"><p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">${esc(labelKolom[i])}</p><p class="text-sm font-medium text-slate-800 break-words">${esc(String(v))}</p></div>`;

      // Nama Rekening ada di index 12 — sisipkan catatan tepat di bawahnya (kalau ada)
      if (i === 12 && catatanNamaBeda) {
        h += `<div class="col-span-1 sm:col-span-2 bg-amber-50/60 border border-amber-100 rounded-lg px-4 py-2"><p class="text-xs text-amber-700"><span class="font-semibold">📝 Catatan:</span> ${esc(catatanNamaBeda)}</p></div>`;
      }
    }
    h += `</div>`;

    // Berkas sesuai layanan
    const berkasList = getBerkasSesuaiLayanan(d[7]);
    h += `<div class="mt-4 border-t border-slate-200 pt-4"><p class="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">Berkas & Dokumen</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">`;
    berkasList.forEach(function (b) {
      const lnk = d[b.idx];
      const ada = lnk && lnk.toString().startsWith("http");
      h += `<div class="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 gap-2"><p class="text-xs font-medium text-slate-700 truncate">${esc(b.label)}</p>${ada ? `<a href="${lnk}" target="_blank" class="shrink-0 text-[11px] font-semibold text-white bg-sky-500 hover:bg-sky-600 px-2.5 py-1 rounded-md">Buka ↗</a>` : `<span class="shrink-0 text-[11px] text-slate-400 italic">Tidak ada</span>`}</div>`;
    });
    h += `</div></div>`;
    // Riwayat edit
    h += `<div id="riwayat-edit-wrap" class="mt-4 border-t border-slate-200 pt-4"><p class="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Riwayat Perubahan</p><div id="riwayat-edit-isi" class="text-xs text-slate-400 italic">Memuat...</div></div>`;

    // Info sakelar tutup untuk kecamatan/kemenag
    if (isRoleKecKem_(dataPengguna.role) && inputDitutupGlobal) {
      h += `<div class="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p class="text-sm text-amber-900 font-semibold mb-1">🔒 Periode Input Telah Ditutup</p>
        <p class="text-xs text-amber-800 leading-relaxed">
          Data ini tidak dapat diubah karena periode input tahun 2027 sudah berakhir. Perubahan data hanya dapat dilakukan oleh <strong>Admin Utama Dinas Sosial Kota Medan</strong> berdasarkan surat resmi dari instansi terkait.
        </p>
      </div>`;
    }

    isiKonten.innerHTML = h;

    function jalankanVerifikasi(statusBaru, tombolAktif, teksAsliTombol) {
      const ket = document.getElementById('input-keterangan-verifikasi').value.trim().toUpperCase();
      if (!ket) { tampilkanToast('Keterangan hasil verifikasi wajib diisi.', 'gagal'); return; }

      let batasWaktu = "";
      if (statusBaru === "Berkas Tidak Lengkap") {
        batasWaktu = document.getElementById('input-batas-waktu-verifikasi').value;
        if (!batasWaktu) { tampilkanToast('Batas waktu perbaikan wajib diisi untuk status Berkas Tidak Lengkap.', 'gagal'); return; }
      }

      tombolAktif.disabled = true;
      tombolAktif.innerText = 'Menyimpan...';
      google.script.run
        .withSuccessHandler(function (res) {
          tombolAktif.disabled = false;
          tombolAktif.innerText = teksAsliTombol;
          if (!res.sukses) { tampilkanToast('Gagal: ' + res.pesan, 'gagal'); return; }
          dataAktif[32] = res.status;
          dataAktif[33] = res.keterangan;
          dataAktif[34] = res.tanggal;
          dataAktif[35] = res.verifikator;
          dataAktif[36] = res.batasWaktu || "";
          renderBaca(dataAktif);
          perbaruiStatusDiMasterData(nomorBarisAktif, res.status);
          invalidateCacheDataTransaksi();
          tampilkanToast('Status verifikasi berhasil disimpan.', 'sukses');
        })
        .withFailureHandler(function (err) {
          tombolAktif.disabled = false;
          tombolAktif.innerText = teksAsliTombol;
          tampilkanToast(pesanErrorRamah(err), 'gagal');
        })
        .verifikasiSatuData(dataPengguna.token, nomorBarisAktif, statusBaru, ket, batasWaktu, dataAktif[32] || "");
    }

    const btnTandai = document.getElementById('btn-tandai-tidak-memenuhi');
    if (btnTandai) {
      btnTandai.addEventListener('click', function () {
        jalankanVerifikasi('Tidak Memenuhi Syarat', btnTandai, '❌ Tandai Tidak Memenuhi Syarat');
      });
    }
    const btnBerkasKurang = document.getElementById('btn-tandai-berkas-tidak-lengkap');
    if (btnBerkasKurang) {
      btnBerkasKurang.addEventListener('click', function () {
        jalankanVerifikasi('Berkas Tidak Lengkap', btnBerkasKurang, '📋 Tandai Berkas Tidak Lengkap');
      });
    }

    const btnLaporPerbaikan = document.getElementById('btn-lapor-perbaikan');
    if (btnLaporPerbaikan) {
      btnLaporPerbaikan.addEventListener('click', function () {
        const teksAsli = btnLaporPerbaikan.innerHTML;
        btnLaporPerbaikan.disabled = true;
        btnLaporPerbaikan.innerText = 'Mengirim...';
        google.script.run
          .withSuccessHandler(function (res) {
            if (!res.sukses) { tampilkanToast('Gagal: ' + res.pesan, 'gagal'); btnLaporPerbaikan.disabled = false; btnLaporPerbaikan.innerHTML = teksAsli; return; }
            dataAktif[38] = res.tanggalLapor;
            dataAktif[39] = res.dilaporOleh;
            renderBaca(dataAktif);
            invalidateCacheDataTransaksi();
            tampilkanToast('Perbaikan berkas berhasil dilaporkan.', 'sukses');
          })
          .withFailureHandler(function (err) {
            btnLaporPerbaikan.disabled = false;
            btnLaporPerbaikan.innerHTML = teksAsli;
            tampilkanToast(pesanErrorRamah(err), 'gagal');
          })
          .laporkanPerbaikanBerkas(dataPengguna.token, nomorBarisAktif);
      });
    }

    const btnSudahDiperbaiki = document.getElementById('btn-tandai-sudah-diperbaiki');
    if (btnSudahDiperbaiki) {
      btnSudahDiperbaiki.addEventListener('click', function () {
        const teksAsli = btnSudahDiperbaiki.innerHTML;
        btnSudahDiperbaiki.disabled = true;
        btnSudahDiperbaiki.innerText = 'Menyimpan...';
        google.script.run
          .withSuccessHandler(function (res) {
            if (!res.sukses) { tampilkanToast('Gagal: ' + res.pesan, 'gagal'); btnSudahDiperbaiki.disabled = false; btnSudahDiperbaiki.innerHTML = teksAsli; return; }
            dataAktif[32] = res.status;
            dataAktif[33] = "";
            dataAktif[34] = res.tanggal;
            dataAktif[35] = res.verifikator;
            dataAktif[36] = "";
            dataAktif[38] = "";
            dataAktif[39] = "";
            renderBaca(dataAktif);
            perbaruiStatusDiMasterData(nomorBarisAktif, res.status);
            invalidateCacheDataTransaksi();
            tampilkanToast('Data ditandai sudah diperbaiki.', 'sukses');
          })
          .withFailureHandler(function (err) {
            btnSudahDiperbaiki.disabled = false;
            btnSudahDiperbaiki.innerHTML = teksAsli;
            tampilkanToast(pesanErrorRamah(err), 'gagal');
          })
          .tandaiSudahDiperbaiki(dataPengguna.token, nomorBarisAktif);
      });
    }

    google.script.run
      .withSuccessHandler(function (res) {
        const el = document.getElementById('riwayat-edit-isi');
        if (!el) return;
        if (!res.riwayat || res.riwayat.length === 0) { el.innerHTML = '<span>Belum ada perubahan.</span>'; return; }
        let rh = '<div class="space-y-1">';
        res.riwayat.slice(-10).reverse().forEach(function (r) {
          rh += `<div class="bg-amber-50 border border-amber-100 rounded px-3 py-1.5"><span class="font-semibold text-amber-700">${esc(r.kolom)}</span> &nbsp;<span class="text-slate-400">${esc(r.sebelum)}</span> → <span class="text-slate-700">${esc(r.sesudah)}</span><span class="ml-2 text-[10px] text-slate-400">${esc(r.editor)} · ${esc(String(r.waktu))}</span></div>`;
        });
        rh += '</div>';
        el.innerHTML = rh;
      })
      .withFailureHandler(function () {
        const el = document.getElementById('riwayat-edit-isi');
        if (el) el.innerHTML = '<span>Gagal memuat riwayat.</span>';
      })
      .ambilRiwayatEdit(dataPengguna.token, nomorBarisAktif);
  }
  function renderEdit(d) {
    berkasBaruMap = {};
    let h = `<div class="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-4 text-xs text-sky-800">✏️  Mode edit aktif. Ubah kolom yang diperlukan lalu klik <strong>Simpan Perubahan</strong>.</div>`;
    h += `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">`;
    for (let i = 0; i < 18; i++) {
      const label = ["No. Urut", "Nama Lengkap", "NIK", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "Alamat Domisili", "Jenis Layanan", "Tempat Tugas", "Alamat Tugas", "Kecamatan", "Kelurahan", "Nama Rekening", "Nomor Rekening", "Kantor Cabang", "No. Kontak", "Status BPJS TK", "Umur"][i];
      const v = d[i] !== undefined ? String(d[i]) : "";
      const kolDef = KOLOM_TEKS[i];
      if (!kolDef) {
        h += `<div class="bg-slate-100 rounded-lg px-4 py-2.5 border border-slate-200 opacity-60"><p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">${esc(label)}</p><p class="text-sm text-slate-500">${esc(v || "-")}</p></div>`;
      } else if (kolDef.type === 'select') {
        h += `<div class="bg-white rounded-lg px-4 py-2.5 border border-sky-300"><p class="text-[10px] font-semibold text-sky-600 uppercase tracking-wider mb-1">${esc(label)}</p><select id="edit-${i}" class="w-full border border-slate-300 rounded-md p-1.5 text-sm focus:outline-none focus:border-sky-500" style="text-transform:none">`;
        const vNorm = v.toString().trim().toUpperCase();
        kolDef.opsi.forEach(function (o) { h += `<option value="${o}"${vNorm === o.toUpperCase() ? " selected" : ""}>${o}</option>`; });
        h += `</select></div>`;
      } else {
        h += `<div class="bg-white rounded-lg px-4 py-2.5 border border-sky-300"><p class="text-[10px] font-semibold text-sky-600 uppercase tracking-wider mb-1">${esc(label)}${kolDef.hint ? ` <span class="font-normal text-slate-400 normal-case">${esc(kolDef.hint)}</span>` : ""}</p><input id="edit-${i}" type="text" value="${esc(v)}" class="w-full border border-slate-300 rounded-md p-1.5 text-sm focus:outline-none focus:border-sky-500" style="text-transform:none"></div>`;
      }
    }
    h += `</div>`;
    // Berkas sesuai layanan
    const berkasList = getBerkasSesuaiLayanan(d[7]);
    h += `<div class="mt-4 border-t border-slate-200 pt-4"><p class="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">Berkas & Dokumen <span class="font-normal text-slate-400 normal-case">(klik Ganti untuk mengupload file baru)</span></p><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">`;
    berkasList.forEach(function (b) {
      const idx = b.idx;
      const lnk = d[idx];
      const ada = lnk && lnk.toString().startsWith("http");
      h += `<div class="flex flex-col gap-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-slate-700">${esc(b.label)}</p>
          ${ada ? `<a href="${lnk}" target="_blank" class="shrink-0 text-[11px] font-semibold text-white bg-slate-500 hover:bg-slate-600 px-2 py-0.5 rounded-md">Lihat</a>` : ""}
        </div>
        <div class="flex items-center gap-2">
          <label class="shrink-0 cursor-pointer text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-700 px-2.5 py-1 rounded-md">
            Ganti File <input type="file" class="hidden" accept="image/*,.pdf" data-berkas-idx="${idx}" onchange="window._pilihBerkasEdit(this)">
          </label>
          <span id="label-berkas-${idx}" class="text-[11px] text-slate-400 truncate">${ada ? "File ada" : "Belum ada"}</span>
        </div>
      </div>`;
    });
    h += `</div></div>`;
    isiKonten.innerHTML = h;

    if (window._pasangOtorSpasiModal) window._pasangOtorSpasiModal(isiKonten);

    // Validasi no kontak: hanya angka
    const kontakEl = document.getElementById('edit-15');
    if (kontakEl) {
      kontakEl.addEventListener('keydown', function (e) {
        if (!/^[0-9]$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)) e.preventDefault();
      });
    }
  }

  window._pilihBerkasEdit = function (inputEl) {
    const idx = inputEl.dataset.berkasIdx;
    const file = inputEl.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { tampilkanToast("Ukuran berkas melebihi 25 MB.", "gagal"); inputEl.value = ""; return; }
    const labelEl = document.getElementById("label-berkas-" + idx);
    berkasBaruMap[idx] = { namaFile: file.name, mimeType: file.type, file: file };
    if (labelEl) labelEl.textContent = file.name;
  };

  function aktifkanModeEdit() {
    if (!dataAktif) return;
    modeEdit = true;
    btnEdit.classList.add('hidden');
    btnSimpan.classList.remove('hidden');
    btnBatal.classList.remove('hidden');
    renderEdit(dataAktif);
  }

  function batalkanEdit() {
    modeEdit = false;
    berkasBaruMap = {};
    btnSimpan.classList.add('hidden');
    btnBatal.classList.add('hidden');
    btnEdit.classList.remove('hidden');
    renderBaca(dataAktif);
  }

  function simpanEdit() {
    if (!pastikanLogin() || !nomorBarisAktif || !dataAktif) return;
    const teks = {};
    Object.keys(KOLOM_TEKS).forEach(function (i) {
      const el = document.getElementById('edit-' + i);
      if (!el) return;
      const nilaiInput = el.value.toString().trim().toUpperCase();
      const nilaiLama = String(dataAktif[Number(i)] !== undefined && dataAktif[Number(i)] !== null ? dataAktif[Number(i)] : "").toString().trim().toUpperCase();
      if (nilaiInput !== nilaiLama) teks[i] = el.value.toString().trim();
    });
    if (Object.keys(teks).length === 0 && Object.keys(berkasBaruMap).length === 0) {
      tampilkanToast("Tidak ada perubahan yang dilakukan.", "info"); return;
    }
    btnSimpan.disabled = true;
    btnSimpan.textContent = "⏳ Menyimpan...";

    function eksekusiEdit(berkasUntukDikirim, idFolderBerkasUntukDikirim) {
      google.script.run
        .withSuccessHandler(function (res) {
          btnSimpan.disabled = false;
          btnSimpan.textContent = "💾 Simpan Perubahan";
          if (res && res.sukses) {
            tampilkanToast(res.pesan, "sukses");
            modeEdit = false;
            berkasBaruMap = {};
            btnSimpan.classList.add('hidden');
            btnBatal.classList.add('hidden');
            btnEdit.classList.remove('hidden');
            // Reload detail dari server agar data segar
            ambilDanTampilkanDetail(nomorBarisAktif);

            // OPTIMISTIC UPDATE: Update data lokal di masterDataLihat agar tabel instan berubah
            const barisTarget = masterDataLihat.find(function (r) { return r[0] == nomorBarisAktif; });
            if (barisTarget) {
              Object.keys(teks).forEach(function (i) { barisTarget[Number(i)] = teks[i]; });
              saringDanTampilkanTabel(); // Render seketika 0ms
            }

            // Invalidate cache saja, fetch ulang akan terjadi secara asinkron di belakang 
            // layar saat inisialisasiMenuLihatData dipanggil (SWR)
            invalidateCacheDataTransaksi();
            // Panggil inisialisasi secara silent tanpa skeleton loader jika memungkinkan
            if (typeof inisialisasiMenuLihatData === 'function') inisialisasiMenuLihatData(true);
          } else {
            tampilkanToast(res ? res.pesan : "Gagal menyimpan.", "gagal", { durasi: 6000 });
          }
        })
        .withFailureHandler(function (err) {
          btnSimpan.disabled = false;
          btnSimpan.textContent = "💾 Simpan Perubahan";
          tampilkanToast(pesanErrorRamah(err), "gagal", { durasi: 6000 });
        })
        .editDataPenerima(dataPengguna.token, nomorBarisAktif, { teks: teks, berkas: berkasUntukDikirim, idFolderBerkas: idFolderBerkasUntukDikirim || "" });
    }

    const adaBerkasBaru = Object.keys(berkasBaruMap).some(function (k) { return berkasBaruMap[k] && berkasBaruMap[k].file; });
    if (!adaBerkasBaru) {
      eksekusiEdit(berkasBaruMap, "");
      return;
    }

    btnSimpan.textContent = "⏳ Mengunggah berkas...";
    const labelPerIdx = {};
    getBerkasSesuaiLayanan(dataAktif[7]).forEach(function (b) { labelPerIdx[b.idx] = b.label; });
    const berkasUntukUpload = {};
    Object.keys(berkasBaruMap).forEach(function (k) {
      const item = berkasBaruMap[k];
      if (item && item.file) {
        berkasUntukUpload[k] = { file: item.file, namaFile: item.namaFile, mimeType: item.mimeType, label: labelPerIdx[k] || ("Kolom " + k) };
      }
    });

    unggahBerkasLangsungKeStorage(
      { kecamatan: dataAktif[10], layanan: dataAktif[7], nama: dataAktif[1], nik: dataAktif[2], folderId: dataAktif[30] },
      berkasUntukUpload
    ).then(function (hasilUpload) {
      if (!hasilUpload || !hasilUpload.sukses) {
        btnSimpan.disabled = false;
        btnSimpan.textContent = "💾 Simpan Perubahan";
        tampilkanToast("Gagal mengunggah berkas: " + (hasilUpload ? hasilUpload.pesan : "Tidak ada respons."), "gagal", { durasi: 6000 });
        return;
      }
      btnSimpan.textContent = "⏳ Menyimpan...";
      const link = hasilUpload.link || {};
      const idFolderBaru = link.idFolderBerkas || "";
      delete link.idFolderBerkas;
      eksekusiEdit(link, idFolderBaru);
    }).catch(function (errUpload) {
      btnSimpan.disabled = false;
      btnSimpan.textContent = "💾 Simpan Perubahan";
      tampilkanToast("Gagal mengunggah berkas: " + pesanErrorRamah(errUpload), "gagal", { durasi: 6000 });
    });
  }

  function ambilDanTampilkanDetail(nomorBaris) {
    isiKonten.innerHTML = `<div class="flex flex-col items-center justify-center py-10 gap-3"><div class="loader"></div><p class="text-sm text-slate-500 animate-pulse">Mengambil data dari server...</p></div>`;
    google.script.run
      .withSuccessHandler(function (jsonResponse) {
        try {
          if (modeEdit) return;
          const response = JSON.parse(jsonResponse);
          if (!response.sukses) { isiKonten.innerHTML = `<p class="text-red-500 text-sm">Gagal memuat: ${response.pesan}</p>`; return; }
          dataAktif = response.dataLengkap;
          // Tampilkan tombol edit sesuai role & status sakelar
          const r = dataPengguna.role;
          const isUtama = r === "UTAMA";
          const isKecKem = isRoleKecKem_(r);
          const statusVerifData = dataAktif[32] || "Proses Verifikasi";

          const bolehEdit = (statusVerifData !== "Tidak Memenuhi Syarat") && (isUtama || (isKecKem && !inputDitutupGlobal));

          if (bolehEdit) {
            btnEdit.classList.remove('hidden');
          } else {
            btnEdit.classList.add('hidden');
          }
          btnSimpan.classList.add('hidden');
          btnBatal.classList.add('hidden');
          renderBaca(dataAktif);
        } catch (err) {
          isiKonten.innerHTML = `<p class="text-red-500 text-sm">Error render: ${esc(err.message)}</p>`;
        }
      })
      .withFailureHandler(function (err) {
        isiKonten.innerHTML = `<p class="text-red-500 text-sm">Error server: ${esc(err.message)}</p>`;
      })
      .ambilDetailPenerimaPerBaris(dataPengguna.token, nomorBaris);
  }

  window.tampilkanDetailKeModalOnDemand = function (nomorBaris) {
    if (!pastikanLogin()) return;
    nomorBarisAktif = nomorBaris;
    dataAktif = null;
    modeEdit = false;
    berkasBaruMap = {};
    modal.classList.remove('hidden');
    ambilDanTampilkanDetail(nomorBaris);
    document.getElementById('tutup-modal-detail').onclick = function () {
      modal.classList.add('hidden');
      isiKonten.innerHTML = "";
      modeEdit = false;
      berkasBaruMap = {};
      btnSimpan.classList.add('hidden');
      btnBatal.classList.add('hidden');
      btnEdit.classList.add('hidden');
    };
  };

  if (btnEdit) btnEdit.addEventListener('click', aktifkanModeEdit);
  if (btnSimpan) btnSimpan.addEventListener('click', simpanEdit);
  if (btnBatal) btnBatal.addEventListener('click', batalkanEdit);

})();

function ambilDataLolosFilter() {
  const valKec = document.getElementById('filter-kecamatan').value;
  const valKel = document.getElementById('filter-kelurahan').value;
  const valLay = document.getElementById('filter-layanan').value;
  const valVerif = document.getElementById('filter-verifikasi') ? document.getElementById('filter-verifikasi').value : "";
  const kataKunci = document.getElementById('input-cari-global')?.value.toLowerCase() || "";
  const dataLolos = [];
  let nomor = 1;
  for (let i = 0; i < masterDataLihat.length; i++) {
    const row = masterDataLihat[i];
    const lolosKec = !valKec || row[10] === valKec;
    const lolosKel = !valKel || row[11] === valKel;
    const lolosLay = !valLay || row[7] === valLay;
    const statusRowIni = row[18] || "Proses Verifikasi";
    const lolosVerif = !valVerif || statusRowIni === valVerif;
    const teksGabungan = (row[1] + " " + row[2] + " " + row[15] + " " + row[8]).toLowerCase();
    const lolosCari = !kataKunci || teksGabungan.includes(kataKunci);
    if (lolosKec && lolosKel && lolosLay && lolosCari && lolosVerif) {
      dataLolos.push([nomor++, row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13], row[14], row[15], row[16], row[17], row[18]]);
    }
  }
  return dataLolos;
}

function ambilDataMemenuhiSyarat() {
  const valKec = document.getElementById('filter-kecamatan').value;
  const valKel = document.getElementById('filter-kelurahan').value;
  const valLay = document.getElementById('filter-layanan').value;
  const kataKunci = document.getElementById('input-cari-global')?.value.toLowerCase() || "";
  const dataLolos = [];
  let nomor = 1;
  for (let i = 0; i < masterDataLihat.length; i++) {
    const row = masterDataLihat[i];
    const statusRowIni = row[18] || "Proses Verifikasi";
    // Hanya loloskan data yang berstatus persis "Memenuhi Syarat"
    if (statusRowIni !== "Memenuhi Syarat") continue;
    const lolosKec = !valKec || row[10] === valKec;
    const lolosKel = !valKel || row[11] === valKel;
    const lolosLay = !valLay || row[7] === valLay;
    const teksGabungan = (row[1] + " " + row[2] + " " + row[15] + " " + row[8]).toLowerCase();
    const lolosCari = !kataKunci || teksGabungan.includes(kataKunci);
    if (lolosKec && lolosKel && lolosLay && lolosCari) {
      dataLolos.push([nomor++, row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13], row[14], row[15], row[16], row[17], row[18]]);
    }
  }
  return dataLolos;
}

function buatNamaFile() {
  const now = new Date();
  const tgl = ("0" + now.getDate()).slice(-2);
  const bln = ("0" + (now.getMonth() + 1)).slice(-2);
  const thn = now.getFullYear();
  const jam = ("0" + now.getHours()).slice(-2);
  const mnt = ("0" + now.getMinutes()).slice(-2);
  const stempelWaktu = `${tgl}-${bln}-${thn}_${jam}${mnt}`;

  function bersihkanNama(teks) {
    return teks.toString().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  const elFilterLayanan = document.getElementById('filter-layanan');
  const valLayanan = elFilterLayanan ? elFilterLayanan.value : "";
  const namaWilayah = dataPengguna.kelurahanTerkunci || dataPengguna.kecamatan || "";
  const role = dataPengguna.role;

  let bagian = ["REKAP_PENERIMA"];

  if (role === "KECAMATAN") {
    // Admin Kecamatan atau Kelurahan
    if (valLayanan) bagian.push(bersihkanNama(valLayanan));   // aturan #2: layanan dipilih
    if (namaWilayah) bagian.push(bersihkanNama(namaWilayah)); // aturan #1 & #2: nama wilayah selalu ikut
  } else if (role !== "UTAMA") {
    // Admin Kemenag — role-nya sendiri = nama layanan
    bagian.push(bersihkanNama(role)); // aturan #3
  }

  bagian.push(stempelWaktu);
  return bagian.join("_");
}

document.getElementById('btn-export-xlsx').addEventListener('click', function () {
  if (!pastikanLogin()) return;
  const dataEkspor = ambilDataMemenuhiSyarat();
  if (dataEkspor.length === 0) {
    tampilkanToast("Tidak ada data ‘Memenuhi Syarat’ untuk diekspor" + (document.getElementById('filter-kecamatan').value || document.getElementById('filter-kelurahan').value || document.getElementById('filter-layanan').value ? " pada filter yang aktif." : "."), "info");
    return;
  }
  const idToastProses = tampilkanToast("Sedang membuat file Excel (✅ Memenuhi Syarat), mohon tunggu...", "proses");
  google.script.run
    .withSuccessHandler(function (res) {
      tutupToast(idToastProses);
      if (res.sukses) {
        unduhFileBase64(res.base64, res.namaFile);
        tampilkanToast("File berhasil diunduh: " + res.namaFile + " (" + dataEkspor.length + " data Memenuhi Syarat)", "sukses");
      } else {
        tampilkanToast("Gagal: " + res.pesan, "gagal", { durasi: 6000 });
      }
    })
    .withFailureHandler(function (err) { tutupToast(idToastProses); tampilkanToast(pesanErrorRamah(err), "gagal", { durasi: 6000 }); })
    .eksporDataKeSpreadsheet(dataPengguna.token, dataEkspor, buatNamaFile());
});

document.getElementById('btn-verifikasi-massal').addEventListener('click', function () {
  const btn = this;
  konfirmasiAksi({
    judul: "Verifikasi Massal Memenuhi Syarat",
    pesan: "Ini akan menandai SEMUA data yang masih berstatus 'Proses Verifikasi' menjadi 'Memenuhi Syarat', tanpa memandang filter yang sedang aktif.\n\nData yang sudah berstatus 'Tidak Memenuhi Syarat' tidak akan disentuh. Lanjutkan?",
    tipe: "warning",
    teksBatal: "Batal",
    teksKonfirmasi: "Ya, Verifikasi Semua"
  }).then(function (setuju) {
    if (!setuju) return;
    setTombolMemuat(btn, "Memproses...");

    google.script.run
      .withSuccessHandler(function (res) {
        pulihkanTombol(btn);
        if (!res.sukses) { tampilkanToast('Gagal: ' + res.pesan, 'gagal', { durasi: 6000 }); return; }
        tampilkanToast('Selesai! ' + res.jumlah + ' data ditandai "Memenuhi Syarat".', 'sukses');
        for (let i = 0; i < masterDataLihat.length; i++) {
          if ((masterDataLihat[i][18] || "Proses Verifikasi") === "Proses Verifikasi") {
            masterDataLihat[i][18] = "Memenuhi Syarat";
          }
        }
        saringDanTampilkanTabel();
        invalidateCacheDataTransaksi();
        inisialisasiMenuLihatData(true); // sinkronkan dengan data resmi server secara silent
      })
      .withFailureHandler(function (err) {
        pulihkanTombol(btn);
        tampilkanToast(pesanErrorRamah(err), 'gagal', { durasi: 6000 });
      })
      .verifikasiMassalMemenuhiSyarat(dataPengguna.token);
  });
});

window.bukaModalKonfirmasiLogout = function () {
  const modal = document.getElementById('modal-konfirmasi-logout');
  if (!modal) return;
  const elUser = document.getElementById('logout-display-username');
  const elRole = document.getElementById('logout-display-role');
  if (elUser) elUser.textContent = dataPengguna.username || '-';
  if (elRole) {
    const wilayah = dataPengguna.kecamatan ? ` (${dataPengguna.kecamatan})` : '';
    elRole.textContent = (dataPengguna.role || 'PENGGUNA') + wilayah;
  }
  modal.classList.remove('hidden');
};

window.tutupModalKonfirmasiLogout = function () {
  const modal = document.getElementById('modal-konfirmasi-logout');
  if (modal) modal.classList.add('hidden');
};

document.getElementById('btn-keluar-aplikasi').addEventListener('click', function () {
  bukaModalKonfirmasiLogout();
});

const btnEksekusiLogout = document.getElementById('btn-eksekusi-logout');
if (btnEksekusiLogout) {
  btnEksekusiLogout.addEventListener('click', function () {
    const btn = this;
    setTombolMemuat(btn, 'Keluar...');

    const tokenKeluar = dataPengguna.token;
    if (tokenKeluar && window.google && window.google.script && window.google.script.run) {
      try {
        google.script.run.logoutPengguna(tokenKeluar);
      } catch (e) { }
    }

    // Bersihkan SWR cache dan session storage secara menyeluruh agar data tidak bocor antar sesi
    if (window.djpmCache && typeof window.djpmCache.clear === 'function') {
      try { window.djpmCache.clear(); } catch (_e) { }
    }
    try { sessionStorage.removeItem('dana_jasa_sesi'); } catch (e) { }

    dataPengguna = { username: "", role: "", kecamatan: "", token: "", userId: "", kelurahanTerkunci: "" };
    masterDataLihat = [];
    if (typeof cacheDashboardProgres !== 'undefined') {
      cacheDashboardProgres = {};
    }

    ['btn-keluar-aplikasi', 'fab-ganti-password', 'btn-panduan', 'btn-retur-kematian']
      .forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });

    const fsContainerEl = document.getElementById('fs-container');
    if (fsContainerEl) { fsContainerEl.disabled = true; fsContainerEl.classList.add('opacity-50', 'pointer-events-none'); }
    const panelRekapEl = document.getElementById('panel-rekap');
    if (panelRekapEl) panelRekapEl.classList.add('hidden');

    const elPassLogin = document.getElementById('login-password');
    if (elPassLogin) elPassLogin.value = '';

    tutupModalKonfirmasiLogout();
    pulihkanTombol(btn);

    // Tampilkan modal login dan toast notifikasi sukses keluar
    const modalLogin = document.getElementById('modal-login');
    if (modalLogin) modalLogin.classList.remove('hidden');
    tampilkanToast('Anda telah berhasil keluar dari sistem.', 'sukses', { durasi: 3000 });
  });
}

function formatTanggalIndo(tglString) {
  if (!tglString) return '-';
  const bag = tglString.split('-'); // format yyyy-MM-dd dari server
  if (bag.length !== 3) return tglString;
  const d = new Date(Number(bag[0]), Number(bag[1]) - 1, Number(bag[2]));
  if (isNaN(d.getTime())) return tglString;
  const hariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jum'at", "Sabtu"];
  const bulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const tgl2Digit = String(d.getDate()).padStart(2, '0');
  return hariArr[d.getDay()] + ', ' + tgl2Digit + ' ' + bulanArr[d.getMonth()] + ' ' + d.getFullYear() + ' 00:00:00';
}

function susunTeksWhatsAppBerkasTidakLengkap(data) {
  const now = new Date();
  const tglSekarang = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) +
    ', ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

  const grup = {};
  data.forEach(function (d) {
    const kec = d.kecamatan || 'TANPA KECAMATAN';
    if (!grup[kec]) grup[kec] = [];
    grup[kec].push(d);
  });
  const namaKecamatan = Object.keys(grup).sort();

  let teks = '📋 *DAFTAR BERKAS TIDAK LENGKAP*\n';
  teks += '_Diperbarui: ' + tglSekarang + '_\n';
  teks += '_Total: ' + data.length + ' data_\n\n';

  namaKecamatan.forEach(function (kec) {
    const list = grup[kec];
    teks += '━━━━━━━━━━━━━━━\n';
    teks += '📍 *' + kec.toUpperCase() + '* (' + list.length + ' data)\n';
    teks += '━━━━━━━━━━━━━━━\n\n';
    list.forEach(function (d, idx) {
      teks += (idx + 1) + '. *' + d.nama + '* — NIK ' + d.nik + '\n';
      teks += '   Kelurahan: ' + (d.kelurahan || '-') + '\n';
      teks += '   Layanan: ' + d.layanan + '\n';
      teks += '   Alasan: ' + (d.keterangan || '-') + '\n';
      teks += '   ⏰ Batas: ' + formatTanggalIndo(d.batasWaktu) + '\n\n';
    });
  });

  teks += '━━━━━━━━━━━━━━━\n';
  teks += '⚠️ *Perhatian:* Mohon perbaikan berkas dilakukan sebelum batas waktu yang tercantum pada masing-masing data. Apabila hingga batas waktu tersebut berkas belum diperbaiki, sistem akan secara otomatis mengubah status data menjadi *Tidak Memenuhi Syarat*.\n';

  return teks.trim();
}

document.getElementById('btn-salin-wa-berkas').addEventListener('click', function () {
  if (!pastikanLogin()) return;
  const btn = this;
  setTombolMemuat(btn, "Menyiapkan...");

  google.script.run
    .withSuccessHandler(function (res) {
      pulihkanTombol(btn);
      if (!res.sukses) { tampilkanToast('Gagal: ' + res.pesan, 'gagal'); return; }
      if (!res.data || res.data.length === 0) {
        tampilkanToast('Tidak ada data berstatus "Berkas Tidak Lengkap" saat ini.', 'info');
        return;
      }
      const teks = susunTeksWhatsAppBerkasTidakLengkap(res.data);
      navigator.clipboard.writeText(teks).then(function () {
        tampilkanToast('Tersalin ke clipboard! (' + res.data.length + ' data). Buka WhatsApp lalu tempel di chat/grup tujuan.', 'sukses', { durasi: 5000 });
      }).catch(function () {
        prompt('Browser tidak izinkan salin otomatis. Salin manual teks ini (Ctrl+A lalu Ctrl+C):', teks);
      });
    })
    .withFailureHandler(function (err) {
      pulihkanTombol(btn);
      tampilkanToast(pesanErrorRamah(err), 'gagal');
    })
    .getDaftarBerkasTidakLengkapUntukWA(dataPengguna.token);
});

// Helper: unduh file dari base64 langsung ke komputer pengguna.
function unduhFileBase64(base64, namaFile) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('btn-refresh-data').addEventListener('click', function () {
  if (panelAktif === "rekap") {
    document.getElementById('filter-kecamatan').value = "";
    document.getElementById('filter-kelurahan').value = "";
    document.getElementById('filter-layanan').value = "";
    document.getElementById('input-cari-global').value = "";
    masterDataLihat = [];
    const infoTotal = document.getElementById('info-total-penerima');
    if (infoTotal) infoTotal.innerText = "Total Data: Memuat...";
    inisialisasiMenuLihatData();
  }
});

document.getElementById('btn-dashboard-progres').addEventListener('click', function () {
  if (!pastikanLogin()) return;
  document.getElementById('modal-dashboard-progres').classList.remove('hidden');
  muatDashboardProgres();
});

let cacheDashboardProgres = {}; // { [kecFilter]: { res, waktu } }

function muatDashboardProgres() {
  const kecFilter = document.getElementById('filter-dashboard-kecamatan').value || "";
  const isi = document.getElementById('isi-dashboard-progres');

  const tersimpan = cacheDashboardProgres[kecFilter];
  if (tersimpan && (Date.now() - tersimpan.waktu) < TTL_CACHE_DATA_TRANSAKSI_MS) {
    renderDashboardProgres(tersimpan.res, kecFilter);
    return;
  }

  isi.innerHTML = `<div class="flex flex-col items-center justify-center py-10 gap-3"><div class="loader"></div><p class="text-sm text-slate-500 animate-pulse">Memuat dashboard...</p></div>`;

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res || !res.sukses) { isi.innerHTML = `<p class="text-red-500 text-sm text-center py-6">Gagal memuat: ${res ? esc(res.pesan) : 'tidak diketahui'}</p>`; return; }
      cacheDashboardProgres[kecFilter] = { res: res, waktu: Date.now() };
      renderDashboardProgres(res, kecFilter);
    })
    .withFailureHandler(function (err) { isi.innerHTML = `<p class="text-red-500 text-sm text-center py-6">Error: ${esc(err.message || err)}</p>`; })
    .getDashboardProgresVerifikasi(dataPengguna.token, kecFilter);
}

function renderDashboardProgres(res, kecFilter) {
  const isi = document.getElementById('isi-dashboard-progres');

  const judulModal = document.getElementById('judul-modal-dashboard');
  if (judulModal) {
    const kecUntukJudul = kecFilter || dataPengguna.kecamatan || '';
    let teksJudul = '📊 Dashboard Progres Verifikasi' + (kecUntukJudul ? ' — ' + kecUntukJudul.toUpperCase() : '');
    if (dataPengguna.kelurahanTerkunci) {
      teksJudul += ' — ' + dataPengguna.kelurahanTerkunci;
    }
    judulModal.innerText = teksJudul;
  }

  const filterWrap = document.getElementById('filter-dashboard-wrap');
  if (res.bisaFilterKecamatan) {
    filterWrap.classList.remove('hidden');
    const sel = document.getElementById('filter-dashboard-kecamatan');
    if (sel.options.length <= 1) {
      DAFTAR_KECAMATAN_MEDAN.forEach(function (k) {
        const o = document.createElement('option'); o.value = k; o.text = k; sel.appendChild(o);
      });
    }
  }

  if (!res.kartu || res.kartu.length === 0) {
    isi.innerHTML = `<p class="text-slate-400 italic text-sm text-center py-6">Belum ada data untuk ditampilkan.</p>`;
    return;
  }

  isi.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">` +
    res.kartu.map(function (k, i) {
      const selesai = k.memenuhiSyarat + k.tidakMemenuhiSyarat;
      const persen = k.total > 0 ? Math.round((selesai / k.total) * 100) : 0;
      const judul = esc(k.layanan) + (k.kecamatanLabel ? '<span class="block text-slate-900 font-bold normal-case mt-0.5">' + esc(k.kecamatanLabel) + '</span>' : '');
      const warnaSisa = k.sisaKuota <= 0 ? 'text-red-600' : 'text-emerald-600';
      const tampilkanKuota = !dataPengguna.kelurahanTerkunci; // kuota GSM Katolik/Kristen sekarang sudah dipecah dari sheet db_kuotakatolik, jadi boleh ditampilkan lagi
      const delayMs = Math.min(i * 40, 320); // animasi masuk sedikit beruntun, dibatasi supaya kartu terakhir tidak menunggu lama
      return `<div class="kartu-dashboard-animasi border-2 border-sky-200 rounded-xl p-4 bg-slate-50 shadow-sm hover:border-sky-400 hover:shadow-md transition" style="animation-delay:${delayMs}ms">
            <div class="flex justify-between items-start gap-2 mb-2">
              <p class="text-xs font-bold text-slate-800 uppercase">${judul}</p>
              ${tampilkanKuota ? `<span class="text-[10px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full whitespace-nowrap">Kuota: ${k.kuota}</span>` : ''}
            </div>
            <div class="flex justify-between items-center mb-3">
              <p class="text-[11px] text-slate-500">Total: <span class="font-bold text-slate-700">${k.total}</span> data</p>
              ${tampilkanKuota ? `<p class="text-[11px] ${warnaSisa} font-semibold">Sisa Kuota: ${k.sisaKuota}</p>` : ''}
            </div>
            <div class="space-y-1.5 text-[11px]">
              <div class="flex justify-between"><span class="text-slate-500">⏳ Proses Verifikasi</span><span class="font-bold">${k.prosesVerifikasi}</span></div>
              <div class="flex justify-between"><span class="text-emerald-600">✅ Memenuhi Syarat</span><span class="font-bold text-emerald-700">${k.memenuhiSyarat}</span></div>
              <div class="flex justify-between"><span class="text-amber-600">📋 Berkas Tidak Lengkap</span><span class="font-bold text-amber-700">${k.berkasTidakLengkap}</span></div>
              <div class="flex justify-between"><span class="text-red-500">❌ Tidak Memenuhi Syarat</span><span class="font-bold text-red-600">${k.tidakMemenuhiSyarat}</span></div>
            </div>
            <div class="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div class="bar-progres-animasi h-full bg-teal-600" style="width:0%" data-target-width="${persen}"></div>
            </div>
            <p class="text-[10px] text-slate-400 mt-1">${persen}% sudah diverifikasi</p>
          </div>`;
    }).join('') + `</div>`;

  requestAnimationFrame(function () {
    isi.querySelectorAll('.bar-progres-animasi').forEach(function (bar) {
      bar.style.width = bar.dataset.targetWidth + '%';
    });
  });
}
