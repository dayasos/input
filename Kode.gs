/**
 * SISTEM INPUT DATA PENERIMA DANA JASA PELAYANAN KEPADA WARGA PELAYAN MASYARAKAT KOTA MEDAN TAHUN 2027
 * -------------------------------------------------------------------------
 * File: Kode.gs  (VERSI PERBAIKAN KEAMANAN)
 * Fokus: ROUTING, VALIDASI, OTORISASI SERVER-SIDE, DAN PENYIMPANAN DATABASE
 *
 * RINGKASAN PERUBAHAN:
 *  - Password di-hash (SHA-256). Tidak lagi membandingkan teks polos.
 *  - Login menghasilkan TOKEN SESI (CacheService) yang wajib dikirim setiap request sensitif.
 *  - Hak akses (role + kecamatan + layanan) diambil DARI SESI di server,
 *    BUKAN dari parameter yang dikirim browser.
 *  - LockService pada penyimpanan data & kuota (anti race-condition).
 *  - Validasi diulang di dalam penyimpanan setelah lock didapat (menutup celah waktu).
 *  - Validasi umur < 18 ditegakkan di server.
 *  - Pengecekan sheet kosong dibuat konsisten.
 */

// =========================================================================
// KONFIGURASI SPREADSHEET & FOLDER GOOGLE DRIVE
// =========================================================================
const SS_ID_MASTER_DROPDOWN = "1wB2xHthdlMzZWG80jkmIPDNkCwtu_9p1zplF8yePGk4";
const SS_ID_PENYIMPANAN     = "1FqXYvce8wvFtWgDmMgXlWhX3AQ_9teHCa_WpftTrJSU";
const NAMA_SHEET_INPUT      = "Data Input 2027";
// Layanan yang hanya boleh ada 1 penerima per tempat tugas.
// Layanan lain (Khatib Jumat, Guru Maghrib Mengaji, Guru Sekolah, Penatua Gereja, dsb.)
// tidak dibatasi — satu tempat tugas boleh memiliki lebih dari 1 penerima.
const LAYANAN_BATASI_TEMPAT_TUGAS = [
  "IMAM MASJID",
  "NAZIR MASJID",
  "NAZIR MUSHOLLA",
  "PENGURUS GEREJA",
  "PENGURUS VIHARA/KLENTENG/KUIL"
];

// Durasi sesi (detik). 6 jam.
const DURASI_SESI_DETIK = 6 * 60 * 60;

const FOLDER_ID_INDUK = "19rMR3gd6tQUh-l2JSdBim09EFzwePCg3";

// =========================================================================
// 1. FUNGSI ROUTING & HELPER
// =========================================================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle("Sistem Layanan Data Penerima Dana Jasa Pelayanan Kepada Warga Pelayan Masyarakat Kota Medan Tahun 2027")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// =========================================================================
// ROUTER REST API — dipanggil dari Vercel Serverless Function (/api/gas)
// Tidak pernah dipanggil langsung dari browser; URL GAS disimpan di .env Vercel.
// =========================================================================
function doPost(e) {
  try {
    var request  = JSON.parse(e.postData.contents);
    var action   = request.action;
    var args     = request.args || [];

    // Mapping nama fungsi → fungsi aktual yang aman diekspos
    var ALLOWED = {
      "loginPengguna"                    : loginPengguna,
      "getMasterLayanan"                 : getMasterLayanan,
      "getKelurahanByKecamatan"          : getKelurahanByKecamatan,
      "validasiDataBaru"                 : validasiDataBaru,
      "cekNikRealtime"                   : cekNikRealtime,
      "cekRekeningRealtime"              : cekRekeningRealtime,
      "cekTempatTugasGandaRealtime"      : cekTempatTugasGandaRealtime,
      "cekKuotaRealtime"                 : cekKuotaRealtime,
      "simpanDataKeSheet"                : simpanDataKeSheet,
      "getSheetName"                     : getSheetName,
      "getDataRumahIbadah"               : getDataRumahIbadah,
      "getKemenagData"                   : getKemenagData,
      "ambilDataLihatDataHakAkses"       : ambilDataLihatDataHakAkses,
      "ambilDetailPenerimaPerBaris"      : ambilDetailPenerimaPerBaris,
      "eksporDataKeSpreadsheet"          : eksporDataKeSpreadsheet,
      "getSemuaKuota"                    : getSemuaKuota,
      "simpanKuota"                      : simpanKuota,
      "cekKuotaTersedia"                 : cekKuotaTersedia,
      "getSemuaKuotaDenganPemakaian"     : getSemuaKuotaDenganPemakaian,
      "getProgresKuota"                  : getProgresKuota,
      "getDashboardProgresVerifikasi"    : getDashboardProgresVerifikasi,
      "kirimPesanChat"                   : kirimPesanChat,
      "ambilPesanChat"                   : ambilPesanChat,
      "tandaiChatDibaca"                 : tandaiChatDibaca,
      "hitungChatBelumDibaca"            : hitungChatBelumDibaca,
      "hapusPesanChat"                   : hapusPesanChat,
      "statusInputKecKem"                : statusInputKecKem,
      "setInputKecKem"                   : setInputKecKem,
      "ambilStatusDetailSetelan"         : ambilStatusDetailSetelan,
      "ubahAkunSendiri"                  : ubahAkunSendiri,
      "ambilDaftarAkun"                  : ambilDaftarAkun,
      "resetPasswordUser"                : resetPasswordUser,
      "simpanProfilUser"                 : simpanProfilUser,
      "ubahProfilUser"                   : ubahProfilUser,
      "editDataPenerima"                 : editDataPenerima,
      "verifikasiSatuData"               : verifikasiSatuData,
      "laporkanPerbaikanBerkas"          : laporkanPerbaikanBerkas,
      "tandaiSudahDiperbaiki"            : tandaiSudahDiperbaiki,
      "verifikasiMassalMemenuhiSyarat"   : verifikasiMassalMemenuhiSyarat,
      "getDaftarBerkasTidakLengkapUntukWA": getDaftarBerkasTidakLengkapUntukWA,
      "cekBatasWaktuVerifikasi"          : cekBatasWaktuVerifikasi,
      "ambilRiwayatEdit"                 : ambilRiwayatEdit,
      "ambilTahunTersedia"               : ambilTahunTersedia,
      "ambilDataTahunHakAkses"           : ambilDataTahunHakAkses,
      "getVersiAplikasi"                 : getVersiAplikasi,
      "setHeaderUserId"                  : setHeaderUserId,
      "setSakelarUserByAdmin"            : setSakelarUserByAdmin,
      "resetSakelarUserByAdmin"          : resetSakelarUserByAdmin,
      "ambilDaftarUserDenganStatus"      : ambilDaftarUserDenganStatus,
      "bulkSakelarPerKecamatan"          : bulkSakelarPerKecamatan,
      "buatTokenSSORetur"                : buatTokenSSORetur
    };

    if (!ALLOWED[action]) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: "Aksi tidak diizinkan: " + action, sukses: false, pesan: "Aksi tidak diizinkan: " + action }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Panggil fungsi yang sesuai dengan args dari Vercel
    var hasil = ALLOWED[action].apply(null, args);

    return ContentService
      .createTextOutput(JSON.stringify({ result: hasil }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString(), sukses: false, pesan: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =========================================================================
// HELPER KEAMANAN: HASH PASSWORD & SESI
// =========================================================================

/**
 * Membuat hash SHA-256 (hex) dari sebuah string.
 * Dipakai untuk menyimpan & memverifikasi password tanpa menyimpan teks aslinya.
 */
function hashString_(teks) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(teks),
    Utilities.Charset.UTF_8
  );
  return raw.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

/**
 * FUNGSI BANTU SEKALI PAKAI (jalankan manual dari editor Apps Script).
 * Tempel password apa adanya, jalankan, lihat hasil hash di Log,
 * lalu salin hash itu ke kolom password di sheet db_admin.
 *
 * Contoh: ubah teks "rahasia123" lalu Run, salin hasilnya.
 */
function buatHashPassword() {
  const passwordPolos = "admin123";
  const hasil = hashString_(passwordPolos);
  Logger.log("Password: " + passwordPolos);
  Logger.log("Hash (salin ini ke sheet db_admin): " + hasil);
  return hasil;
}

/**
 * Membuat token sesi acak dan menyimpan data pengguna ke CacheService.
 */
function buatSesi_(dataPengguna) {
  const token = Utilities.getUuid() + "-" + Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put("sesi_" + token, JSON.stringify(dataPengguna), DURASI_SESI_DETIK);
  return token;
}

/**
 * Mengambil data sesi dari token. Mengembalikan null jika token tidak valid/kedaluwarsa.
 */
function ambilSesi_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const data = cache.get("sesi_" + token);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

/**
 * Memvalidasi token & memastikan pengguna punya peran.
 * Melempar error (yang akan ditangkap di frontend) jika tidak sah.
 */
function wajibSesi_(token) {
  const sesi = ambilSesi_(token);
  if (!sesi || !sesi.role) {
    throw new Error("SESI TIDAK SAH: Silakan login ulang.");
  }
  return sesi;
}

// Daftar layanan yang berada di bawah instansi KEMENAG (dipakai untuk otorisasi server).
function daftarLayananKemenagUpper_() {
  const master = getMasterLayanan();
  return master.kemenag.map(function(v) { return v.toUpperCase(); });
}

// =========================================================================
// FUNGSI AUTENTIKASI LOGIN (DENGAN HASH & SESI)
// =========================================================================
// KEAMANAN: proteksi brute-force login. Maksimal percobaan gagal sebelum akun (per username)
// dikunci sementara, dan berapa lama kuncinya (detik). Dilacak di CacheService (sama seperti
// sesi) supaya tidak perlu tabel/sheet tambahan — otomatis kedaluwarsa sendiri.
const BATAS_PERCOBAAN_LOGIN = 5;
const JENDELA_KUNCI_LOGIN_DETIK = 15 * 60; // 15 menit

function loginPengguna(username, password) {
  try {
    const usernameInput = String(username || "").trim();
    const cache = CacheService.getScriptCache();
    const kunciPercobaan = "loginfail_" + usernameInput.toUpperCase();

    // Sebelumnya TIDAK ada batas percobaan sama sekali — password bisa ditebak berulang kali
    // tanpa hambatan apa pun dari sisi server. Cek dulu sebelum baca sheet sama sekali.
    const percobaanSaatIni = Number(cache.get(kunciPercobaan) || 0);
    if (percobaanSaatIni >= BATAS_PERCOBAAN_LOGIN) {
      return { sukses: false, pesan: "Terlalu banyak percobaan login gagal untuk akun ini. Coba lagi dalam beberapa menit." };
    }

    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet) return { sukses: false, pesan: "Sheet akun tidak ditemukan." };
    if (sheet.getLastRow() < 2) return { sukses: false, pesan: "Belum ada akun terdaftar." };

    const data = sheet.getDataRange().getValues();
    const passwordHashInput = hashString_(String(password || "").trim());

    for (let i = 1; i < data.length; i++) {
      const usernameSheet  = data[i][0] ? data[i][0].toString().trim() : "";
      const passwordSheet  = data[i][1] ? data[i][1].toString().trim() : "";
      const roleSheet      = data[i][2] ? data[i][2].toString().trim().toUpperCase() : "";
      const kecamatanSheet = data[i][3] ? data[i][3].toString().trim().toUpperCase() : "";

      // Kolom E=Nama Lengkap, F=Nomor HP, G=Jabatan (kolom indeks 4, 5, 6)
      const namaSheet    = data[i][4] ? data[i][4].toString().trim() : "";
      const hpSheet      = data[i][5] ? data[i][5].toString().trim() : "";
      const jabatanSheet = data[i][6] ? data[i][6].toString().trim() : "";
      // Kolom H = User ID (untuk sakelar per user)
      const userIdSheet  = data[i][7] ? data[i][7].toString().trim().toUpperCase() : "";

      if (!usernameSheet || !passwordSheet) continue;

      if (usernameSheet === usernameInput && passwordSheet === passwordHashInput) {
        cache.remove(kunciPercobaan); // login berhasil -> reset hitungan percobaan gagal
        const dataPengguna = {
          username: usernameSheet,
          role: roleSheet,
          kecamatan: kecamatanSheet,
          userId: userIdSheet
        };
        const token = buatSesi_(dataPengguna);
        // Profil dianggap belum diisi bila kolom Nama Lengkap (E) masih kosong.
        const profileBelumDiisi = !namaSheet;
        return {
          sukses: true,
          token: token,
          username: usernameSheet,
          role: roleSheet,
          kecamatan: kecamatanSheet,
          userId: userIdSheet,
          profileBelumDiisi: profileBelumDiisi,
          profil: {
            namaLengkap: namaSheet,
            nomorHp: hpSheet,
            jabatan: jabatanSheet
          },
          pesan: "Login berhasil."
        };
      }
    }
    // Login gagal -> catat percobaan (dipakai pengecekan BATAS_PERCOBAAN_LOGIN di atas)
    cache.put(kunciPercobaan, String(percobaanSaatIni + 1), JENDELA_KUNCI_LOGIN_DETIK);
    return { sukses: false, pesan: "Username atau password salah." };
  } catch (e) {
    return { sukses: false, pesan: "Error sistem: " + e.toString() };
  }
}

// =========================================================================
// 2. FUNGSI PENGAMBILAN DATA MASTER (LAYANAN & WILAYAH)
// =========================================================================
function getMasterLayanan() {
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_layanan");
    if (!sheet) throw new Error("Sheet dengan nama 'db_layanan' tidak ditemukan.");

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { kecamatan: [], kemenag: [] };

    // Baca kolom A (Kecamatan) & B (Kemenag) sampai baris terakhir berisi data.
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const bersih = function (v) { return v ? v.toString().trim() : ""; };

    const dataKecamatan = data.map(function (r) { return bersih(r[0]); }).filter(Boolean);
    const dataKemenag   = data.map(function (r) { return bersih(r[1]); }).filter(Boolean);

    return { kecamatan: dataKecamatan, kemenag: dataKemenag };
  } catch (error) {
    throw new Error("Gagal mengambil data layanan: " + error.toString());
  }
}

function getKelurahanByKecamatan(token, kecamatanTerpilih) {
  // KEAMANAN: sebelumnya tidak mensyaratkan sesi sama sekali — data referensi kelurahan (bukan
  // PII) tetap wajib login supaya konsisten dengan pola akses seluruh sistem (mencegah scraping
  // tanpa akun). Tidak dipakai fungsi lain secara internal, jadi aman ditambah token di sini.
  wajibSesi_(token);
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_wilayah");
    if (!sheet) throw new Error("Sheet dengan nama 'db_wilayah' tidak ditemukan.");

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const dataWilayah = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const listKelurahan = [];

    for (let i = 0; i < dataWilayah.length; i++) {
      const kecamatanDiSheet = dataWilayah[i][0].toString().trim().toUpperCase();
      const kelurahanDiSheet = dataWilayah[i][1].toString().trim();

      if (kecamatanDiSheet === kecamatanTerpilih.toString().trim().toUpperCase() && kelurahanDiSheet) {
        listKelurahan.push(kelurahanDiSheet);
      }
    }
    return listKelurahan.sort();
  } catch (error) {
    throw new Error("Gagal memproses filter data kelurahan: " + error.toString());
  }
}

// Pilih ikon rumah ibadah sesuai layanan (untuk pesan validasi tempat tugas).
function ikonRumahIbadah_(layanan) {
  var lay = (layanan || "").toString().trim().toUpperCase();
  switch (lay) {
    case "IMAM MASJID":
    case "NAZIR MASJID":
    case "NAZIR MUSHOLLA":
      return "🕌"; // masjid/musholla
    case "PENGURUS GEREJA":
      return "⛪"; // gereja
    case "PENGURUS VIHARA/KLENTENG/KUIL":
      return "🛕"; // vihara/kuil
    default:
      return "🛐"; // netral (cadangan)
  }
}

// Normalisasi teks: uppercase + rapikan spasi ganda agar pencocokan konsisten.
function rapikanTeks_(s) {
  return (s == null ? "" : s).toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

function validasiDataBaru_(token, nikBaru, layananBaru, tempatTugasBaru, instansiBaru, noRekBaru, kecamatanBaru, alamatTugasBaru) {
  try {
    // KEAMANAN: wajib sesi sah. cekDomisiliCapil_/cekStatusTahunLalu_ di bawah membocorkan
    // nama+alamat+status warga berdasarkan NIK — token diteruskan ke keduanya supaya tidak ada
    // jalur baca data itu yang lolos tanpa login (lihat catatan di definisi masing-masing fungsi).
    wajibSesi_(token);

    // ── CEK DOMISILI CAPIL (hard-block, prioritas tertinggi) ──
    var cekCapil = cekDomisiliCapil_(token, nikBaru);
    if (cekCapil.ditemukan) {
      return {
        valid: false,
        tolakCapil: true,
        namaCapil: cekCapil.nama,
        nikCapil: cekCapil.nik,
        alamatDomisiliCapil: cekCapil.alamatDomisili,
        kabKotaDomisiliCapil: cekCapil.kabKotaDomisili,
        statusCapil: cekCapil.status,
        pesan: "NIK INI TERDAFTAR SEBAGAI DOMISILI DI LUAR KOTA MEDAN: " + cekCapil.kabKotaDomisili
      };
    }

    // ── CEK STATUS TAHUN LALU (hard-block) ──
    var cek2026 = cekStatusTahunLalu_(token, nikBaru);
    if (cek2026.ditemukan && !cek2026.aktif) {
      return {
        valid: false, tolakStatus2026: true,
        status2026: cek2026.status, nama2026: cek2026.nama,
        layanan2026: cek2026.layanan, tahun2026: cek2026.tahun || "",
        pesan: "NIK INI TERDAFTAR DI DATA " + (cek2026.tahun || "SEBELUMNYA") + " DENGAN STATUS: " + cek2026.status
      };
    }

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);

    const nikTarget         = nikBaru.toString().trim();
    const layananTarget     = layananBaru.toString().trim().toUpperCase();
    const tempatTugasTarget = rapikanTeks_(tempatTugasBaru);
    const alamatTugasTarget = rapikanTeks_(alamatTugasBaru);
    const noRekTarget       = noRekBaru.toString().trim();
    const kecamatanTarget   = kecamatanBaru.toString().trim().toUpperCase();

    const temuan = [];
    let nikGanda = false, rekGanda = false, tempatGanda = false;
    let jumlahTerpakaiKuota = 0; // dihitung sekalian di loop yang sama (hindari baca sheet 2x)

    if (sheet && sheet.getLastRow() > 1) {
      // Baca hanya kolom A–N (14 kolom pertama yang dipakai validasi ini),
      // bukan seluruh kolom (yang sekarang sudah sampai ~32, berisi link berkas & koordinat
      // yang tidak relevan untuk cek duplikasi). Ini mempercepat pembacaan seiring data bertambah.
      const lastRow = sheet.getLastRow();
      const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i].length < 14) continue;

        const nikTerdaftar     = data[i][2].toString().trim();
        const namaTerdaftar    = data[i][1].toString().trim();
        const layananTerdaftar = data[i][7].toString().trim().toUpperCase();
        const tempatTerdaftar  = rapikanTeks_(data[i][8]);  // nama tempat tugas
        const alamatTerdaftar  = rapikanTeks_(data[i][9]);  // alamat tugas
        const noRekTerdaftar   = data[i][13].toString().trim();
        const kecTerdaftar     = data[i][10].toString().trim().toUpperCase();

        if (!nikGanda && nikTerdaftar === nikTarget) {
          nikGanda = true;
          temuan.push({ jenis: "NIK", ikon: "🪪",
            detail: "NIK " + nikTarget + " sudah terdaftar atas nama " + namaTerdaftar + "." });
        }
        if (!rekGanda && noRekTerdaftar === noRekTarget) {
          rekGanda = true;
          temuan.push({ jenis: "REKENING", ikon: "🏦",
            detail: "Nomor rekening " + noRekTarget + " sudah digunakan oleh " + namaTerdaftar + "." });
        }
        // Cek 1 penerima per rumah ibadah — LINTAS SEMUA KECAMATAN.
        // Identitas rumah ibadah = NAMA TEMPAT TUGAS + ALAMAT TUGAS, bukan kecamatan/kelurahan domisili.
        if (!tempatGanda && LAYANAN_BATASI_TEMPAT_TUGAS.indexOf(layananTarget) !== -1) {
          if (tempatTerdaftar === tempatTugasTarget
              && alamatTerdaftar === alamatTugasTarget
              && layananTerdaftar === layananTarget) {
            tempatGanda = true;
            temuan.push({ jenis: "TEMPAT TUGAS", ikon: ikonRumahIbadah_(layananTarget),
              detail: tempatTugasBaru + " sudah memiliki penerima untuk layanan " + layananTarget
                      + " atas nama " + namaTerdaftar + " (Kec. " + kecTerdaftar + ")." });
          }
        }

        // Hitung sekalian pemakaian kuota kecamatan+layanan ini, supaya tidak perlu baca ulang
        // seluruh sheet lagi nanti di cekKuotaTersedia.
        if (kecTerdaftar === kecamatanTarget && layananTerdaftar === layananTarget) {
          jumlahTerpakaiKuota++;
        }
      }
    }

    if (temuan.length > 0) {
      return { valid: false, temuan: temuan, pesan: "Ditemukan " + temuan.length + " masalah duplikasi data." };
    }

    const hasilKuota = cekKuotaTersedia(kecamatanBaru, layananBaru, jumlahTerpakaiKuota);
    if (!hasilKuota.tersedia) {
      return { valid: false, pesan: hasilKuota.pesan, kuotaHabis: true };
    }
    return { valid: true, pesan: "DATA VALID" };
  } catch (error) {
    return { valid: false, pesan: "ERROR VALIDASI SERVER: " + error.toString() };
  }
}

function validasiDataBaru(token, nikBaru, layananBaru, tempatTugasBaru, instansiBaru, noRekBaru, kecamatanBaru, alamatTugasBaru) {
  try {
    wajibSesi_(token);
  } catch (e) {
    return { valid: false, pesan: e.message };
  }
  return validasiDataBaru_(token, nikBaru, layananBaru, tempatTugasBaru, instansiBaru, noRekBaru, kecamatanBaru, alamatTugasBaru);
}

// Cek 3 hal berbasis NIK sekaligus secara real-time: Domisili Capil, Status Tahun Lalu, NIK Ganda.
function cekNikRealtime(token, nik) {
  try { wajibSesi_(token); } catch (e) { return { blokir: false }; }
  try {
    const nikTarget = (nik || "").toString().trim();
    if (nikTarget.length !== 16) return { blokir: false };

    const cekCapil = cekDomisiliCapil_(token, nikTarget);
    if (cekCapil.ditemukan) {
      return {
        blokir: true, jenis: "CAPIL",
        pesan: "NIK ini terdaftar sebagai domisili di luar Kota Medan: " + cekCapil.kabKotaDomisili,
        nama: cekCapil.nama
      };
    }

    const cek2026 = cekStatusTahunLalu_(token, nikTarget);
    if (cek2026.ditemukan && !cek2026.aktif) {
      return {
        blokir: true, jenis: "STATUS_LAMA",
        pesan: "NIK ini terdaftar di data " + (cek2026.tahun || "sebelumnya") + " dengan status: " + cek2026.status,
        nama: cek2026.nama
      };
    }

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (sheet && sheet.getLastRow() > 1) {
      const lastRow = sheet.getLastRow();
      const data = sheet.getRange(2, 2, lastRow - 1, 2).getValues(); // B=Nama, C=NIK
      for (let i = 0; i < data.length; i++) {
        if ((data[i][1] || "").toString().trim() === nikTarget) {
          return { blokir: true, jenis: "NIK_GANDA", pesan: "NIK ini sudah terdaftar atas nama " + (data[i][0] || "").toString().trim() + ".", nama: (data[i][0] || "").toString().trim() };
        }
      }
    }
    return { blokir: false };
  } catch (e) {
    return { blokir: false }; // gagal cek -> jangan blokir; validasi final saat submit tetap jadi jaring pengaman
  }
}

// Cek Rekening Ganda secara real-time.
function cekRekeningRealtime(token, noRekening) {
  try { wajibSesi_(token); } catch (e) { return { blokir: false }; }
  try {
    const rekTarget = (noRekening || "").toString().trim();
    if (rekTarget.length !== 14) return { blokir: false };

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || sheet.getLastRow() < 2) return { blokir: false };

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 2, lastRow - 1, 13).getValues(); // B=Nama(0) .. N=NoRekening(12)
    for (let i = 0; i < data.length; i++) {
      if ((data[i][12] || "").toString().trim() === rekTarget) {
        return { blokir: true, pesan: "Nomor rekening ini sudah digunakan oleh " + (data[i][0] || "").toString().trim() + ".", nama: (data[i][0] || "").toString().trim() };
      }
    }
    return { blokir: false };
  } catch (e) {
    return { blokir: false };
  }
}

// Cek Tempat Tugas Ganda (Rumah Ibadah) secara real-time.
function cekTempatTugasGandaRealtime(token, layanan, tempatTugas, alamatTugas) {
  try { wajibSesi_(token); } catch (e) { return { blokir: false, relevan: false }; }
  try {
    const layananTarget = (layanan || "").toString().trim().toUpperCase();
    if (LAYANAN_BATASI_TEMPAT_TUGAS.indexOf(layananTarget) === -1) return { blokir: false, relevan: false };

    const tempatTarget = rapikanTeks_(tempatTugas);
    const alamatTarget = rapikanTeks_(alamatTugas);
    if (!tempatTarget || !alamatTarget) return { blokir: false, relevan: true };

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || sheet.getLastRow() < 2) return { blokir: false, relevan: true };

    const lastRow = sheet.getLastRow();
    // B=Nama(0) H=Layanan(6) I=TempatTugas(7) J=AlamatTugas(8) K=Kecamatan(9)
    const data = sheet.getRange(2, 2, lastRow - 1, 10).getValues();
    for (let i = 0; i < data.length; i++) {
      const laySheet    = (data[i][6] || "").toString().trim().toUpperCase();
      const tempatSheet = rapikanTeks_(data[i][7]);
      const alamatSheet = rapikanTeks_(data[i][8]);
      if (laySheet === layananTarget && tempatSheet === tempatTarget && alamatSheet === alamatTarget) {
        return { blokir: true, relevan: true, nama: (data[i][0] || "").toString().trim(), kecamatan: (data[i][9] || "").toString().trim() };
      }
    }
    return { blokir: false, relevan: true };
  } catch (e) {
    return { blokir: false, relevan: false };
  }
}

// Cek Kuota Tersedia secara real-time (begitu Kecamatan + Layanan dipilih di awal form).
function cekKuotaRealtime(token, kecamatan, layanan) {
  try { wajibSesi_(token); } catch (e) { return { blokir: false }; }
  const hasil = cekKuotaTersedia(kecamatan, layanan);
  if (!hasil.tersedia) {
    return { blokir: true, pesan: hasil.pesan };
  }
  return { blokir: false, terpakai: hasil.terpakai, maks: hasil.maks };
}

// =========================================================================
// 4. FUNGSI UTAMA PENYIMPANAN DATA DAN UPLOAD BERKAS
// =========================================================================
function simpanDataKeSheet(token, formObject) {
  // Otorisasi: wajib punya sesi yang sah.
  let sesi;
  try {
    sesi = wajibSesi_(token);
  } catch (e) {
    return { sukses: false, pesan: e.message };
  }

  // Kunci agar tidak ada dua proses simpan bersamaan (anti race-condition).
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // tunggu maksimal 30 detik
  } catch (e) {
    return { sukses: false, pesan: "Server sedang sibuk, coba lagi sebentar lagi." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    let sheet = ss.getSheetByName(NAMA_SHEET_INPUT);

    if (!sheet) {
      sheet = ss.insertSheet(NAMA_SHEET_INPUT);
    }

    // Tulis header kalau sheet masih kosong total (baru dibuat, atau isinya sudah dihapus semua).
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "NO", "NAMA", "NIK", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR", "ALAMAT",
        "LAYANAN", "TEMPAT TUGAS", "ALAMAT TUGAS", "KECAMATAN", "KELURAHAN",
        "NAMA REKENING", "NOMOR REKENING", "KANTOR CABANG", "NO. KONTAK", "STATUS BPJS TK", "UMUR",
        "LINK KTP", "LINK BUKU REKENING", "LINK SURAT PERMOHONAN", "LINK PERNYATAAN SATU BANTUAN",
        "LINK DOMISILI KELURAHAN", "LINK FORMULIR PENDATAAN", "LINK BERKAS PENDUKUNG",
        "LINK FOTO PLANK RUMAH IBADAH", "LINK FOTO LOKASI IBADAH", "LINK FOTO KEGIATAN BELAJAR",
        "LINK REKOMENDASI BKM", "LINK REKOMENDASI RUMAH IBADAH", "ID FOLDER BERKAS", "LINK KOORDINAT LOKASI",
        "STATUS VERIFIKASI", "KETERANGAN VERIFIKASI", "TANGGAL VERIFIKASI", "DIVERIFIKASI OLEH", "BATAS WAKTU PERBAIKAN",
        "CATATAN PERBEDAAN NAMA", "TANGGAL LAPOR PERBAIKAN", "DILAPOR OLEH"
      ]);
    }

    // PEMETAAN NILAI FORM
    const nama           = (formObject.inputNama || "").trim().toUpperCase();
    const nik            = String(formObject.inputNik || "").trim();
    const jenisKelamin   = (formObject.selectGender || "").trim().toUpperCase();
    const tempatLahir    = (formObject.inputTempatLahir || "").trim().toUpperCase();

    let tanggalLahir = "";
    let umurHitung = -1;
    if (formObject.inputTglLahir) {
      const rawDate = new Date(formObject.inputTglLahir);
      tanggalLahir = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "dd-MM-yyyy");
      // Hitung umur di server berdasarkan patokan 1 Januari 2027.
      const patokan = new Date("2027-01-01");
      umurHitung = patokan.getFullYear() - rawDate.getFullYear();
      const m = patokan.getMonth() - rawDate.getMonth();
      if (m < 0 || (m === 0 && patokan.getDate() < rawDate.getDate())) umurHitung--;
    }

    const alamat         = (formObject.inputAlamat || "").trim().toUpperCase();
    const layanan        = (formObject.selectLayanan || "").trim().toUpperCase();
    const tempatTugas    = (formObject.inputTempatTugas || "").trim().toUpperCase();
    const alamatTugas    = (formObject.inputAlamatTugas || "").trim().toUpperCase();
    const kecamatan      = (formObject.controlKecamatan || "").trim().toUpperCase();
    const kelurahan      = (formObject.controlKelurahan || "").trim().toUpperCase();
    const namaRekening   = (formObject.inputNamaRekening || "").trim().toUpperCase();
    const nomorRekening  = String(formObject.inputNoRekening || "").trim();
    const kantorCabang   = (formObject.inputKantorCabang || "").trim().toUpperCase();
    const noKontak       = "'" + String(formObject.inputNoKontak || "").trim();
    const statusBpjs     = (formObject.selectBpjs || "").trim().toUpperCase();
    const umur           = (formObject.inputUmur || "").trim();

    // Peran sesi (server-side, TIDAK bisa dipalsukan dari browser).
    const peranSesi = (sesi.role || "").toString().trim().toUpperCase();

    // Tentukan instansi dari peran sesi (bukan dari browser) jika memungkinkan,
    // jika peran UTAMA, gunakan apa yang dikirim (admin pusat boleh keduanya).
    let instansiEfektif;
    if (peranSesi === "KECAMATAN") {
      instansiEfektif = "KECAMATAN";
    } else if (daftarLayananKemenagUpper_().indexOf(peranSesi) !== -1) {
      instansiEfektif = "KEMENAG";
    } else {
      // UTAMA / pusat: tentukan dari layanan
      instansiEfektif = (daftarLayananKemenagUpper_().indexOf(layanan) !== -1) ? "KEMENAG" : "KECAMATAN";
    }

    // ---- OTORISASI (KEAMANAN): kecamatan & layanan yang DISIMPAN harus konsisten dengan sesi ----
    // Sebelumnya nilai `kecamatan`/`layanan` di atas (dari formObject/browser) dipakai apa adanya
    // tanpa dicocokkan ke akun yang login — akun non-UTAMA bisa mengirim kecamatan/layanan siapa
    // saja lewat request langsung (bukan lewat form biasa), memakai kuota kecamatan lain atau
    // menembus batas layanan akun Kemenag. Untuk peran UTAMA, nilai dari form tetap dipercaya
    // (admin pusat memang berwenang input untuk kecamatan/layanan mana pun).
    if (peranSesi !== "UTAMA") {
      if (peranSesi === "KECAMATAN") {
        if (daftarLayananKemenagUpper_().indexOf(layanan) !== -1) {
          return { sukses: false, pesan: "GAGAL: Akun Kecamatan tidak berwenang mengisi layanan Kemenag." };
        }
        // Akun KECAMATAN wajib punya kecamatan terisi di db_admin (beda dari akun Kemenag "bebas"
        // yang kolom Kecamatan-nya memang sengaja kosong). Kalau kosong (data akun salah input),
        // TOLAK alih-alih membiarkan akun ini bebas mengisi kecamatan mana pun (fail-closed, bukan
        // fail-open) — dicek eksplisit di sini karena guard umum di bawah hanya berlaku jika
        // kecSesi tidak kosong.
        if (!(sesi.kecamatan || "").toString().trim()) {
          return { sukses: false, pesan: "GAGAL: Akun Anda belum terdaftar untuk kecamatan mana pun. Hubungi admin utama." };
        }
      } else if (layanan !== peranSesi) {
        // Akun Kemenag: peran akun (mis. "GURU MAGHRIB MENGAJI") adalah satu-satunya
        // layanan yang berwenang diisi oleh akun ini.
        return { sukses: false, pesan: "GAGAL: Akun Anda hanya berwenang mengisi layanan \"" + sesi.role + "\"." };
      }
      // Kalau akun terikat ke satu kecamatan spesifik (kolom Kecamatan akun di db_admin terisi —
      // berlaku untuk akun KECAMATAN maupun akun Kemenag yang "terikat" satu kecamatan), kecamatan
      // yang disimpan wajib sama dengan kecamatan akun tsb. Akun Kemenag "bebas" (kolom Kecamatan
      // kosong di db_admin) tetap boleh memilih kecamatan mana pun, sesuai desain form.
      const kecSesi = (sesi.kecamatan || "").toString().trim().toUpperCase();
      if (kecSesi && kecamatan !== kecSesi) {
        return { sukses: false, pesan: "GAGAL: Akun Anda hanya berwenang mengisi data untuk Kecamatan " + kecSesi + "." };
      }
    }

    // Penjagaan sakelar: tolak input dari kecamatan/kemenag bila DITUTUP.
    const adalahKecKem = (peranSesi === "KECAMATAN") ||
                         (daftarLayananKemenagUpper_().indexOf(peranSesi) !== -1);
    if (adalahKecKem) {
      const akses = cekAksesInputUser_(token, sesi.userId);
      if (akses.ditutup) {
        const pesan = akses.sumber === "KHUSUS"
          ? "Akses input untuk akun Anda telah ditutup secara khusus oleh admin utama. Hubungi Dinas Sosial Kota Medan."
          : "Periode input sudah ditutup oleh admin utama.";
        return { sukses: false, pesan: pesan };
      }
    }

    // ---- VALIDASI SERVER (DIULANG SETELAH LOCK) ----
    // 1. Umur wajib >= 18.
    if (umurHitung < 18) {
      return { sukses: false, pesan: "GAGAL: Usia di bawah 18 tahun tidak memenuhi syarat." };
    }
    // 2. Field wajib minimal terisi.
    if (!nama || nik.length !== 16 || nomorRekening.length !== 14 || !layanan || !kecamatan) {
      return { sukses: false, pesan: "GAGAL: Data wajib tidak lengkap atau format NIK/Rekening salah." };
    }
    // 3. Duplikat & kuota (memakai data terbaru di dalam lock).
    const cekUlang = validasiDataBaru_(token, nik, layanan, tempatTugas, instansiEfektif, nomorRekening, kecamatan, alamatTugas);
    if (!cekUlang.valid) {
      return { sukses: false, pesan: cekUlang.pesan, kuotaHabis: cekUlang.kuotaHabis || false };
    }

    // Hitung nomor urut SETELAH lock agar tidak bentrok.
    const lastRow = sheet.getLastRow();
    const nomorUrut = lastRow <= 1 ? 1 : Number(sheet.getRange(lastRow, 1).getValue()) + 1;

    // Sumber berkas: objek base64 dari frontend (formObject.__berkas).
    const B = formObject.__berkas || {};

    // KEAMANAN: batas ukuran GABUNGAN semua berkas dalam satu submit — sebelumnya hanya ada
    // batas per-file (di blobDariBerkas_/front-end), tidak ada batas total. Formulir ini punya
    // sampai 13 field upload; tanpa batas gabungan, payload base64 bisa membengkak sangat besar
    // sebelum sampai ke titik ini. Estimasi ukuran dari panjang string base64 (~3/4 dari panjang
    // string = perkiraan byte asli) supaya bisa ditolak SEBELUM proses decode/upload yang mahal.
    const MAKS_TOTAL_BYTE_BERKAS = 60 * 1024 * 1024; // 60 MB gabungan per submit
    let totalPerkiraanByte = 0;
    Object.keys(B).forEach(function(k) {
      const item = B[k];
      if (item && item.dataBase64) totalPerkiraanByte += item.dataBase64.length * 0.75;
    });
    if (totalPerkiraanByte > MAKS_TOTAL_BYTE_BERKAS) {
      return { sukses: false, pesan: "GAGAL: Total ukuran seluruh berkas terlalu besar (maksimal 60 MB gabungan). Perkecil ukuran file lalu coba lagi." };
    }

    // KEAMANAN/INTEGRITAS DATA: validasi TIAP berkas (tipe file & ukuran) SEBELUM upload dimulai.
    // Sebelumnya berkas yang ditolak blobDariBerkas_/uploadBerkasPenerima_ (tipe tidak didukung atau
    // kelewat besar) akan tersimpan sebagai link KOSONG secara diam-diam, sementara submit tetap
    // dilaporkan "SUKSES" ke petugas — berisiko data bansos tersimpan tanpa lampiran KTP/rekening/
    // surat tanpa ada yang sadar. Sekarang submit digagalkan lebih dulu dengan pesan jelas.
    const LABEL_FIELD_BERKAS = {
      fileKtp: "KTP", fileBukuRekening: "Buku Rekening", fileSuratPermohon: "Surat Permohonan",
      filePernyataan: "Surat Pernyataan", fileDomisili: "Domisili Kelurahan",
      fileBerkasPendukung: "Formulir Pendataan", fileBerkasPendukung2: "Berkas Pendukung",
      fileFotoPlank: "Foto Plank Rumah Ibadah", fileFotoIbadah: "Foto Lokasi Ibadah", fileFotoKegiatan: "Foto Kegiatan Belajar",
      fileRekomendasiBkm: "Rekomendasi BKM", fileRekomendasiRi: "Rekomendasi Rumah Ibadah"
    };
    for (const kunciBerkas in LABEL_FIELD_BERKAS) {
      const pesanErrorBerkas = validasiBerkasSebelumUpload_(B[kunciBerkas], LABEL_FIELD_BERKAS[kunciBerkas]);
      if (pesanErrorBerkas) {
        return { sukses: false, pesan: "GAGAL: " + pesanErrorBerkas };
      }
    }

    // Buat/ambil folder khusus pendaftar ini: Induk > KECAMATAN > "NAMA (4 digit NIK)"
    const folderPendaftar = dapatkanFolderPendaftar_(kecamatan, layanan, nama, nik);

    // A. UPLOAD BERKAS WAJIB UMUM
    const linkKtp = uploadBerkasPenerima_(blobDariBerkas_(B.fileKtp), folderPendaftar, "KTP");
    const linkBukuRekening = uploadBerkasPenerima_(blobDariBerkas_(B.fileBukuRekening), folderPendaftar, "BUKU REKENING");
    const linkSuratPermohon = uploadBerkasPenerima_(blobDariBerkas_(B.fileSuratPermohon), folderPendaftar, "SURAT PERMOHONAN");
    // Surat Pernyataan digabung menjadi satu: Satu Jenis Tanda Jasa & Bukan ASN/BUMN/BUMD/TNI/POLRI
    const linkPernyataan = uploadBerkasPenerima_(blobDariBerkas_(B.filePernyataan), folderPendaftar, "SURAT PERNYATAAN");
    const linkDomisili = uploadBerkasPenerima_(blobDariBerkas_(B.fileDomisili), folderPendaftar, "DOMISILI KELURAHAN");

    // Formulir Pendataan & Berkas Pendukung kini disimpan di kolom MASING-MASING.
    const linkFormulirPendataan = uploadBerkasPenerima_(blobDariBerkas_(B.fileBerkasPendukung), folderPendaftar, "FORMULIR PENDATAAN");
    const labelBerkasPendukung2 = (layanan === "USTADZ" || layanan === "USTADZAH") ? "REKOMENDASI MUI" : "BERKAS PENDUKUNG";
    const linkBerkasPendukung   = uploadBerkasPenerima_(blobDariBerkas_(B.fileBerkasPendukung2), folderPendaftar, labelBerkasPendukung2);

    // B. UPLOAD 3 BERKAS TAMBAHAN KONDISIONAL KEMENAG
    const linkFotoPlank = uploadBerkasPenerima_(blobDariBerkas_(B.fileFotoPlank), folderPendaftar, "FOTO PLANK");
    const linkFotoIbadah = uploadBerkasPenerima_(blobDariBerkas_(B.fileFotoIbadah), folderPendaftar, "FOTO LOKASI IBADAH");
    const linkFotoKegiatan = uploadBerkasPenerima_(blobDariBerkas_(B.fileFotoKegiatan), folderPendaftar, "FOTO KEGIATAN");

    // C. UPLOAD BERKAS REKOMENDASI (kondisional: GMM Masjid/Musholla & Kemenag Bebas)
    const linkRekomendasiBkm = uploadBerkasPenerima_(blobDariBerkas_(B.fileRekomendasiBkm), folderPendaftar, "REKOMENDASI BKM");
    const linkRekomendasiRi  = uploadBerkasPenerima_(blobDariBerkas_(B.fileRekomendasiRi), folderPendaftar, "REKOMENDASI RUMAH IBADAH");

    sheet.appendRow([
      nomorUrut, nama, nik, jenisKelamin, tempatLahir, tanggalLahir, alamat,
      layanan, tempatTugas, alamatTugas, kecamatan, kelurahan,
      namaRekening, nomorRekening, kantorCabang, noKontak, statusBpjs, umur,
      linkKtp, linkBukuRekening, linkSuratPermohon, linkPernyataan,
      linkDomisili, linkFormulirPendataan, linkBerkasPendukung,
      linkFotoPlank, linkFotoIbadah, linkFotoKegiatan,
      linkRekomendasiBkm, linkRekomendasiRi,
      folderPendaftar.getId(),
      (formObject.koordinatLink || ""),
      "Proses Verifikasi", "", "", "", "",
      (formObject.catatanPerbedaanNama || ""), "", ""
    ]);

    SpreadsheetApp.flush();
    return { sukses: true, pesan: "Data dan berkas berhasil disimpan ke Database!" };
  } catch (error) {
    return { sukses: false, pesan: "Gagal Sistem: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Ubah objek berkas {namaFile, mimeType, dataBase64} dari frontend menjadi Blob.
// Mengembalikan null bila kosong/tidak valid.
// KEAMANAN: sebelumnya blobDariBerkas_ tidak memvalidasi ukuran maupun tipe file sama sekali —
// front-end punya batas 25MB/file (lihat MAKS_BYTE di Index.html), tapi itu bisa dilewati kalau
// simpanDataKeSheet dipanggil langsung lewat request buatan sendiri (bukan lewat form). File yang
// lolos di sini langsung diupload ke Drive dan otomatis dibagikan publik (ANYONE_WITH_LINK) oleh
// uploadBerkasPenerima_, jadi validasi di titik ini adalah lapisan pertahanan terakhir sebelum itu.
const MAKS_BYTE_PER_BERKAS = 25 * 1024 * 1024; // 25 MB — disamakan dengan batas di front-end
const MIME_BERKAS_DIIZINKAN = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'image/bmp', 'image/gif', // format lama dari scanner/kamera lawas — tetap diizinkan sebagai jaring pengaman
  'application/pdf'
];

function blobDariBerkas_(berkas) {
  try {
    if (!berkas || !berkas.dataBase64) return null;
    const bytes = Utilities.base64Decode(berkas.dataBase64);
    if (bytes.length === 0 || bytes.length > MAKS_BYTE_PER_BERKAS) return null;

    const mime = (berkas.mimeType || 'application/octet-stream').toString().trim().toLowerCase();
    if (MIME_BERKAS_DIIZINKAN.indexOf(mime) === -1) return null;

    const nama = berkas.namaFile || 'berkas';
    return Utilities.newBlob(bytes, mime, nama);
  } catch (e) {
    return null;
  }
}

// KEAMANAN/INTEGRITAS DATA: blobDariBerkas_ di atas menolak berkas yang tidak lolos ukuran/tipe
// dengan mengembalikan `null` secara DIAM-DIAM (dipakai luas, termasuk saat edit — di sana memang
// wajar dilewati begitu saja). Tapi kalau dipakai apa adanya saat SUBMIT BARU, berkas yang ditolak
// akan membuat kolom link-nya kosong sementara `simpanDataKeSheet` tetap melapor "SUKSES" ke user —
// petugas tidak akan pernah tahu KTP/rekening/surat gagal terupload. Fungsi ini dipakai
// `simpanDataKeSheet` untuk memvalidasi SEMUA berkas SEBELUM upload dimulai, supaya berkas yang
// ditolak menggagalkan submit dengan pesan jelas (bukan tersimpan senyap dengan link kosong).
// Mengembalikan pesan error (string) kalau berkas ada tapi tidak valid, atau null kalau valid/tidak
// ada berkas dikirim (field opsional yang memang tidak diisi untuk layanan ini).
function validasiBerkasSebelumUpload_(berkas, labelField) {
  if (!berkas || !berkas.dataBase64) return null;
  const namaTampil = berkas.namaFile || 'tanpa nama';
  const mime = (berkas.mimeType || '').toString().trim().toLowerCase();
  if (MIME_BERKAS_DIIZINKAN.indexOf(mime) === -1) {
    return 'Berkas "' + labelField + '" (' + namaTampil + ') memakai format file yang tidak didukung' +
      (mime ? ' (' + mime + ')' : '') + '. Gunakan JPG, PNG, WEBP, HEIC, atau PDF.';
  }
  // Estimasi ukuran dari panjang base64 (~3/4 dari panjang string = perkiraan byte asli),
  // konsisten dengan cara MAKS_TOTAL_BYTE_BERKAS dihitung di simpanDataKeSheet.
  const perkiraanByte = berkas.dataBase64.length * 0.75;
  if (perkiraanByte > MAKS_BYTE_PER_BERKAS) {
    return 'Berkas "' + labelField + '" (' + namaTampil + ') ukurannya melebihi 25 MB.';
  }
  return null;
}

// Cari subfolder dengan nama tertentu di dalam folder induk; buat baru kalau belum ada.
function dapatkanOrBuatSubfolder_(folderIndukObj, namaSubfolder) {
  const iter = folderIndukObj.getFoldersByName(namaSubfolder);
  if (iter.hasNext()) return iter.next();
  return folderIndukObj.createFolder(namaSubfolder);
}

// Dapatkan (atau buat baru) folder khusus 1 pendaftar: Induk > KECAMATAN > LAYANAN > "NAMA (4 digit NIK)"
function dapatkanFolderPendaftar_(kecamatan, layanan, nama, nik) {
  const folderInduk = DriveApp.getFolderById(FOLDER_ID_INDUK);
  const kecClean = (kecamatan || "").toString().trim().toUpperCase();
  const folderKec = dapatkanOrBuatSubfolder_(folderInduk, kecClean || "(TANPA KECAMATAN)");

  const layClean = (layanan || "").toString().trim().toUpperCase();
  const folderLayanan = dapatkanOrBuatSubfolder_(folderKec, layClean || "(TANPA LAYANAN)");

  const namaClean = (nama || "").toString().trim().toUpperCase();
  // Pakai NIK PENUH (bukan hanya 4 digit terakhir) sebagai identifier folder — dua pendaftar
  // berbeda dengan nama sama persis dan 4 digit akhir NIK yang kebetulan sama dulu bisa tertimpa/
  // tercampur ke satu folder yang sama. NIK penuh membuat nama folder unik per orang (NIK sendiri
  // sudah divalidasi tidak boleh ganda di validasiDataBaru_). Ini tidak menambah paparan data baru —
  // KTP dengan NIK penuh sudah ikut tersimpan di dalam folder yang sama.
  const nikBersih = String(nik || "").replace(/[^0-9]/g, '');
  const namaFolderPendaftar = namaClean + " (" + (nikBersih || "TANPA-NIK") + ")";

  return dapatkanOrBuatSubfolder_(folderLayanan, namaFolderPendaftar);
}

function uploadBerkasPenerima_(fileBlob, folderObj, jenisBerkas) {
  if (!fileBlob || !fileBlob.getName || fileBlob.getBytes().length === 0) return "";
  try {
    const originalName = fileBlob.getName();
    const extension = originalName.indexOf('.') !== -1 ? originalName.substring(originalName.lastIndexOf('.')) : '';
    const jbClean = (jenisBerkas || "").trim().replace(/\s+/g, ' ');
    const namaFileBaru = jbClean + extension;

    fileBlob.setName(namaFileBaru);
    const file = folderObj.createFile(fileBlob);
    // Catatan keamanan: ANYONE_WITH_LINK membuka berkas pribadi ke siapa pun yang punya link.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    return "Gagal Upload: " + e.toString();
  }
}

// =========================================================================
// 6. FUNGSI PEMETAAN RUMAH IBADAH (MODAL KECAMATAN & KEMENAG)
// =========================================================================
function getSheetName(kategori) {
  switch (kategori) {
    case "IMAM MASJID": case "KHATIB JUMAT": case "NAZIR MASJID": return "db_masjid";
    case "NAZIR MUSHOLLA": return "db_musholla";
    case "PENGURUS GEREJA": return "db_gereja";
    case "PENGURUS VIHARA/KLENTENG/KUIL": return "db_vihara_klenteng_kuil";
    case "PETUGAS GEREJA KATOLIK": return "db_pgk";
    default: return null;
  }
}

function getDataRumahIbadah(token, kategori) {
  // KEAMANAN: sebelumnya tidak mensyaratkan sesi sama sekali — data referensi rumah ibadah
  // (nama+alamat) bukan PII penerima dana, tapi tetap wajib login supaya konsisten dengan
  // pola akses seluruh sistem (dan mencegah scraping data referensi tanpa akun).
  try { wajibSesi_(token); } catch (e) { return []; }

  const sheetName = getSheetName(kategori);
  if (!sheetName) return [];
  const sheet = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN).getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
}

function getKemenagData(token, sheetName) {
  // KEAMANAN: sama seperti getDataRumahIbadah — wajib login dulu.
  try { wajibSesi_(token); } catch (e) { return { error: "Sesi tidak sah. Silakan login ulang." }; }

  const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
  const allowedSheets = ["db_gereja", "db_pgk", "db_masjid", "db_musholla", "db_vihara_klenteng_kuil"];
  if (!allowedSheets.includes(sheetName)) return { error: "Akses ditolak" };
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: "Sheet tidak ditemukan" };
  if (sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  data.shift();
  return data;
}

// =========================================================================
// 1. FUNGSI LIHAT DATA - DENGAN OTORISASI SERVER-SIDE
// =========================================================================
function ambilDataLihatDataHakAkses(token) {
  try {
    // Ambil hak akses DARI SESI, bukan dari parameter browser.
    let sesi;
    try {
      sesi = wajibSesi_(token);
    } catch (e) {
      return JSON.stringify({ sukses: false, pesan: e.message });
    }

    const role = sesi.role;                 // mis. "UTAMA", "KECAMATAN", atau nama layanan kemenag
    const namaKecamatanPengguna = sesi.kecamatan || "";

    // Kalau USER_ID akun ini diawali "KELURAHAN ", batasi tampilan cuma ke kelurahan itu
    // (di luar itu, akun kecamatan biasa tetap lihat semua kelurahan di kecamatannya).
    const userIdSesi = (sesi.userId || "").toString().toUpperCase().trim();
    const kelurahanTerkunci = userIdSesi.indexOf("KELURAHAN ") === 0
      ? userIdSesi.substring("KELURAHAN ".length).trim()
      : "";

    // Khusus GURU SEKOLAH MINGGU: pisah Katolik vs Kristen berdasarkan kata di Tempat Tugas.
    // Katolik = mengandung kata "KATOLIK". Kristen = TIDAK mengandung kata "KATOLIK"
    // (karena nama gereja Kristen jarang eksplisit menulis "Kristen").
    const subFilterGsm = userIdSesi === "BIMAS KATOLIK" ? "KATOLIK"
                        : userIdSesi === "BIMAS KRISTEN" ? "BUKAN_KATOLIK"
                        : "";

    // Tentukan instansi & filter layanan berdasarkan peran tepercaya dari sesi.
    const listLayananKemenag = daftarLayananKemenagUpper_();
    let instansiPengguna;
    let layananPengguna = "";

    if (role === "UTAMA") {
      instansiPengguna = "SUPERADMIN";
    } else if (role === "KECAMATAN") {
      instansiPengguna = "KECAMATAN";
    } else if (listLayananKemenag.indexOf(role) !== -1) {
      instansiPengguna = "KEMENAG";
      layananPengguna = role; // role kemenag = nama layanannya
    } else {
      // Peran tidak dikenal → tolak.
      return JSON.stringify({ sukses: false, pesan: "Peran tidak dikenali." });
    }

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet) return JSON.stringify({ sukses: false, pesan: "Sheet tidak ditemukan" });
    if (sheet.getLastRow() <= 1) return JSON.stringify({ sukses: true, rows: [] });

    const data = sheet.getDataRange().getValues();
    const resultRows = [];
    const INDEKS_LAYANAN = 7;
    const INDEKS_KECAMATAN = 10;
    const INDEKS_KELURAHAN = 11;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 12) continue;

      const layananSheet = row[INDEKS_LAYANAN] ? row[INDEKS_LAYANAN].toString().trim().toUpperCase() : "";
      const kecamatanSheet = row[INDEKS_KECAMATAN] ? row[INDEKS_KECAMATAN].toString().trim().toUpperCase() : "";
      const kelurahanSheet = row[INDEKS_KELURAHAN] ? row[INDEKS_KELURAHAN].toString().trim().toUpperCase() : "";
      const tempatTugasSheet = row[8] ? row[8].toString().trim().toUpperCase() : "";

      let lolosAkses = false;
      if (instansiPengguna === "KECAMATAN") {
        if (kecamatanSheet === namaKecamatanPengguna.toUpperCase() && listLayananKemenag.indexOf(layananSheet) === -1) {
          lolosAkses = true;
        }
      } else if (instansiPengguna === "KEMENAG") {
        if (listLayananKemenag.indexOf(layananSheet) !== -1) {
          if (layananPengguna) {
            if (layananSheet === layananPengguna.toUpperCase()) {
              if (namaKecamatanPengguna) {
                if (kecamatanSheet === namaKecamatanPengguna.toUpperCase()) lolosAkses = true;
              } else {
                lolosAkses = true;
              }
            }
          } else {
            lolosAkses = true;
          }
        }
      } else {
        lolosAkses = true; // SUPERADMIN
      }

      // Lapis tambahan: kalau akun ini terikat 1 kelurahan spesifik, wajib cocok juga kelurahannya.
      if (lolosAkses && kelurahanTerkunci) {
        lolosAkses = (kelurahanSheet === kelurahanTerkunci);
      }

      // Lapis tambahan: khusus GSM, pisah berdasarkan kata "KATOLIK" di Tempat Tugas.
      if (lolosAkses && subFilterGsm === "KATOLIK") {
        lolosAkses = tempatTugasSheet.indexOf("KATOLIK") !== -1;
      } else if (lolosAkses && subFilterGsm === "BUKAN_KATOLIK") {
        lolosAkses = tempatTugasSheet.indexOf("KATOLIK") === -1;
      }

      if (lolosAkses) {
        resultRows.push([
          i + 1,
          row[1], row[2], row[3], row[4],
          (function () {
            if (!row[5]) return "";
            if (row[5] instanceof Date) {
              const d = ("0" + row[5].getDate()).slice(-2);
              const m = ("0" + (row[5].getMonth() + 1)).slice(-2);
              const y = row[5].getFullYear();
              return d + "-" + m + "-" + y;
            }
            return row[5].toString().trim();
          })(),
          row[6], row[7], row[8], row[9], row[10], row[11],
          row[12], row[13], row[14],
          (function () {
            if (!row[15]) return "";
            return row[15].toString().replace(/^'+/, '').trim();
          })(),
          row[16], row[17],
          row[32] || "Proses Verifikasi",
          row[38] || ""
        ]);
      }
    }

    return JSON.stringify({ sukses: true, rows: resultRows });
  } catch (error) {
    return JSON.stringify({ sukses: false, pesan: error.toString() });
  }
}

// =========================================================================
// 2. AMBIL DETAIL ON-DEMAND (DENGAN OTORISASI)
// =========================================================================
function ambilDetailPenerimaPerBaris(token, nomorBarisAsli) {
  try {
    let sesi;
    try {
      sesi = wajibSesi_(token);
    } catch (e) {
      return JSON.stringify({ sukses: false, pesan: e.message });
    }

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet) return JSON.stringify({ sukses: false, pesan: "Sheet tidak ditemukan" });

    const baris = Number(nomorBarisAsli);
    if (!baris || baris < 2 || baris > sheet.getLastRow()) {
      return JSON.stringify({ sukses: false, pesan: "Nomor baris tidak valid." });
    }

    const row = sheet.getRange(baris, 1, 1, 40).getValues()[0];

    // Cek apakah peran ini berhak melihat baris tsb (mencegah enumerasi baris orang lain).
    const listLayananKemenag = daftarLayananKemenagUpper_();
    const layananSheet = row[7] ? row[7].toString().trim().toUpperCase() : "";
    const kecamatanSheet = row[10] ? row[10].toString().trim().toUpperCase() : "";
    const role = sesi.role;
    const kecPengguna = (sesi.kecamatan || "").toUpperCase();

    let boleh = false;
    if (role === "UTAMA") {
      boleh = true;
    } else if (role === "KECAMATAN") {
      boleh = (kecamatanSheet === kecPengguna && listLayananKemenag.indexOf(layananSheet) === -1);
    } else if (listLayananKemenag.indexOf(role) !== -1) {
      // peran kemenag: hanya layanannya sendiri (dan kecamatannya bila terikat)
      if (layananSheet === role) {
        boleh = kecPengguna ? (kecamatanSheet === kecPengguna) : true;
      }
    }
    if (!boleh) return JSON.stringify({ sukses: false, pesan: "Anda tidak berhak melihat data ini." });

    for (let c = 0; c < row.length; c++) {
      if (row[c] instanceof Date) {
        const year = row[c].getFullYear();
        const month = ("0" + (row[c].getMonth() + 1)).slice(-2);
        const day = ("0" + row[c].getDate()).slice(-2);
        row[c] = day + "-" + month + "-" + year;
      } else if (row[c] === null || row[c] === undefined) {
        row[c] = "";
      }
    }
    // Bersihkan kutip pada no kontak (kolom index 15)
    if (row[15]) row[15] = row[15].toString().replace(/^'+/, '').trim();

    return JSON.stringify({ sukses: true, dataLengkap: row });
  } catch (error) {
    return JSON.stringify({ sukses: false, pesan: error.toString() });
  }
}

// =========================================================================
// EKSPOR DATA (DENGAN OTORISASI)
// =========================================================================
function formatBarisDalamEkspor_(row, sheet) {
  const r = row.slice();
  r[5] = r[5] ? r[5].toString().trim() : "";
  const nikBersih = r[2] ? r[2].toString().replace(/^'+/, '').trim() : "";
  const noRekBersih = r[13] ? r[13].toString().replace(/^'+/, '').trim() : "";
  const noKontakBersih = r[15] ? r[15].toString().replace(/^'+/, '').trim() : "";
  r[2] = "";
  r[13] = "";
  r[15] = "";
  sheet.appendRow(r);

  const barisTerakhir = sheet.getLastRow();
  sheet.getRange(barisTerakhir, 3).setNumberFormat("@").setValue("'" + nikBersih);   // NIK
  sheet.getRange(barisTerakhir, 6).setNumberFormat("@");                              // Tanggal lahir
  sheet.getRange(barisTerakhir, 14).setNumberFormat("@").setValue("'" + noRekBersih); // Nomor rekening
  sheet.getRange(barisTerakhir, 16).setNumberFormat("@").setValue("'" + noKontakBersih); // No kontak
}

function eksporDataKeSpreadsheet(token, dataRows, namaFile) {
  try {
    wajibSesi_(token);
  } catch (e) {
    return { sukses: false, pesan: e.message };
  }
  try {
    const ss = SpreadsheetApp.create(namaFile);
    const sheet = ss.getActiveSheet();
    sheet.setName("Rekap Penerima");

    const header = [
      "NO", "NAMA", "NIK", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR", "ALAMAT",
      "JENIS LAYANAN", "TEMPAT TUGAS", "ALAMAT TUGAS", "KECAMATAN", "KELURAHAN",
      "NAMA REKENING", "NOMOR REKENING", "KANTOR CABANG", "NO. KONTAK", "STATUS BPJS TK", "UMUR"
    ];
    sheet.appendRow(header);

    const headerRange = sheet.getRange(1, 1, 1, header.length);
    headerRange.setBackground("#1d4ed8");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    headerRange.setVerticalAlignment("middle");
    headerRange.setWrap(true);

    for (let i = 0; i < dataRows.length; i++) {
      formatBarisDalamEkspor_(dataRows[i], sheet);
    }

    sheet.autoResizeColumns(1, header.length);
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();

    const fileId = ss.getId();
    const oauthToken = ScriptApp.getOAuthToken();
    const url = "https://www.googleapis.com/drive/v3/files/" + fileId + "/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&alt=media";

    const response = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: { "Authorization": "Bearer " + oauthToken },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error("Gagal konversi xlsx: " + response.getContentText());
    }

    const xlsxBlob = response.getBlob();
    const base64 = Utilities.base64Encode(xlsxBlob.getBytes());

    // Hapus file sementara di Drive — tidak ada yang tersimpan.
    DriveApp.getFileById(fileId).setTrashed(true);

    return { sukses: true, base64: base64, namaFile: namaFile + ".xlsx" };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// =========================================================================
// FUNGSI MANAJEMEN KUOTA
// =========================================================================
function getSemuaKuota(token) {
  // KEAMANAN: sebelumnya tidak mensyaratkan sesi sama sekali — siapa pun (termasuk yang belum
  // login) bisa menarik data kuota seluruh kecamatan+layanan lewat google.script.run langsung.
  // Kedua pemanggil (getSemuaKuotaDenganPemakaian, getProgresKuota) sudah tervalidasi sesi
  // sendiri, jadi ini murni defense-in-depth agar fungsi ini tidak bisa dipanggil telanjang.
  try { wajibSesi_(token); } catch (e) { return []; }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_kuota");
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    return data.filter(r => r[0] && r[1]).map(r => ({
      kecamatan: r[0].toString().trim().toUpperCase(),
      layanan: r[1].toString().trim().toUpperCase(),
      kuota: Number(r[2]) || 0
    }));
  } catch (e) {
    return [];
  }
}

function simpanKuota(token, kecamatan, layanan, kuota) {
  // Hanya peran UTAMA yang boleh mengubah kuota.
  let sesi;
  try {
    sesi = wajibSesi_(token);
  } catch (e) {
    return { sukses: false, pesan: e.message };
  }
  if (sesi.role !== "UTAMA") {
    return { sukses: false, pesan: "Akses ditolak: hanya Admin Utama yang dapat mengubah kuota." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { sukses: false, pesan: "Server sibuk, coba lagi." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_kuota");
    if (!sheet) return { sukses: false, pesan: "Sheet db_kuota tidak ditemukan." };

    const kecUpper = kecamatan.toString().trim().toUpperCase();
    const layUpper = layanan.toString().trim().toUpperCase();
    const kuotaNum = Number(kuota) || 0;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim().toUpperCase() === kecUpper &&
          data[i][1].toString().trim().toUpperCase() === layUpper) {
        sheet.getRange(i + 1, 3).setValue(kuotaNum);
        return { sukses: true, pesan: "Kuota berhasil diperbarui." };
      }
    }
    sheet.appendRow([kecUpper, layUpper, kuotaNum]);
    return { sukses: true, pesan: "Kuota berhasil ditambahkan." };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function cekKuotaTersedia(kecamatan, layanan, jumlahTerpakaiOverride) {
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheetKuota = ss.getSheetByName("db_kuota");
    if (!sheetKuota) return { tersedia: false, pesan: "Sheet kuota tidak ditemukan." };

    const kecUpper = kecamatan.toString().trim().toUpperCase();
    const layUpper = layanan.toString().trim().toUpperCase();

    let kuotaMaks = 0;
    let kuotaDitemukan = false;

    if (sheetKuota.getLastRow() >= 2) {
      const dataKuota = sheetKuota.getDataRange().getValues();
      for (let i = 1; i < dataKuota.length; i++) {
        if (dataKuota[i][0].toString().trim().toUpperCase() === kecUpper &&
            dataKuota[i][1].toString().trim().toUpperCase() === layUpper) {
          kuotaMaks = Number(dataKuota[i][2]) || 0;
          kuotaDitemukan = true;
          break;
        }
      }
    }

    if (!kuotaDitemukan) {
      return {
        tersedia: false,
        pesan: "Kuota layanan " + layanan + " untuk " + kecamatan + " belum diset. Silahkan hubungi Admin Dinas Sosial Kota Medan."
      };
    }

    let jumlahTerpakai;

    if (typeof jumlahTerpakaiOverride === "number") {
      // Sudah dihitung sebelumnya (oleh validasiDataBaru_ dalam loop yang sama) — tidak perlu baca ulang sheet.
      jumlahTerpakai = jumlahTerpakaiOverride;
    } else {
      // Dipanggil berdiri sendiri (bukan dari validasiDataBaru_) — tetap hitung manual seperti biasa.
      const ssPenyimpanan = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
      const sheetData = ssPenyimpanan.getSheetByName(NAMA_SHEET_INPUT);
      if (!sheetData || sheetData.getLastRow() < 2) {
        return { tersedia: true, terpakai: 0, maks: kuotaMaks };
      }
      const lastRowData = sheetData.getLastRow();
      // Kolom H(8)=Layanan, I(9)=Tempat Tugas, J(10)=Alamat Tugas, K(11)=Kecamatan — baca 4 kolom, pakai H & K saja.
      const dataInput = sheetData.getRange(2, 8, lastRowData - 1, 4).getValues();
      jumlahTerpakai = 0;
      for (let i = 0; i < dataInput.length; i++) {
        const laySheet = dataInput[i][0] ? dataInput[i][0].toString().trim().toUpperCase() : "";
        const kecSheet = dataInput[i][3] ? dataInput[i][3].toString().trim().toUpperCase() : "";
        if (kecSheet === kecUpper && laySheet === layUpper) jumlahTerpakai++;
      }
    }

    if (jumlahTerpakai >= kuotaMaks) {
      return {
        tersedia: false,
        pesan: "Kuota Layanan " + layanan + " untuk Kecamatan " + kecamatan + " sudah terpenuhi (" + jumlahTerpakai + "/" + kuotaMaks + "). Silahkan hubungi Admin Dinas Sosial Kota Medan."
      };
    }

    return { tersedia: true, terpakai: jumlahTerpakai, maks: kuotaMaks };
  } catch (e) {
    return { tersedia: false, pesan: "Error cek kuota: " + e.toString() };
  }
}

function getSemuaKuotaDenganPemakaian(token) {
  let sesi;
  try {
    sesi = wajibSesi_(token);
  } catch (e) {
    return { kecamatanList: [], layananList: [], matriksData: {}, pesan: e.message };
  }
  // KEAMANAN: sebelumnya hanya mensyaratkan sesi valid (login apa pun), tanpa cek role — akun
  // KECAMATAN/KEMENAG mana pun bisa melihat kuota+pemakaian SEMUA kecamatan lain, bukan hanya
  // miliknya sendiri. Disamakan dengan getProgresKuota yang sudah benar membatasi ke UTAMA.
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { kecamatanList: [], layananList: [], matriksData: {}, pesan: "Fitur ini khusus Admin Utama." };
  }
  try {
    const listKuota = getSemuaKuota(token);
    if (listKuota.length === 0) return { kecamatanList: [], layananList: [], matriksData: {} };

    const ssPenyimpanan = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ssPenyimpanan.getSheetByName(NAMA_SHEET_INPUT);

    const pemakaian = {};
    if (sheet && sheet.getLastRow() >= 2) {
      const dataInput = sheet.getDataRange().getValues();
      for (let i = 1; i < dataInput.length; i++) {
        const kec = dataInput[i][10] ? dataInput[i][10].toString().trim().toUpperCase() : "";
        const lay = dataInput[i][7] ? dataInput[i][7].toString().trim().toUpperCase() : "";
        if (kec && lay) {
          const key = lay + "||" + kec;
          pemakaian[key] = (pemakaian[key] || 0) + 1;
        }
      }
    }

    const setKecamatan = new Set();
    const setLayanan = new Set();
    listKuota.forEach(item => {
      setKecamatan.add(item.kecamatan);
      setLayanan.add(item.layanan);
    });

    const kecamatanList = Array.from(setKecamatan).sort();
    const layananList = Array.from(setLayanan).sort();

    const matriksData = {};
    listKuota.forEach(item => {
      if (!matriksData[item.layanan]) matriksData[item.layanan] = {};
      const key = item.layanan + "||" + item.kecamatan;
      const terpakai = pemakaian[key] || 0;
      matriksData[item.layanan][item.kecamatan] = {
        kuota: item.kuota,
        terpakai: terpakai,
        sisa: item.kuota - terpakai
      };
    });

    return { kecamatanList, layananList, matriksData };
  } catch (e) {
    return { kecamatanList: [], layananList: [], matriksData: {}, pesan: e.toString() };
  }
}

// #########################################################################
// ## TAMBAHAN: PROGRES KUOTA (khusus Admin Utama)
// #########################################################################
const KECAMATAN_MEDAN_URUT = [
  "MEDAN AMPLAS","MEDAN AREA","MEDAN BARAT","MEDAN BARU","MEDAN BELAWAN",
  "MEDAN DELI","MEDAN DENAI","MEDAN HELVETIA","MEDAN JOHOR","MEDAN KOTA",
  "MEDAN LABUHAN","MEDAN MAIMUN","MEDAN MARELAN","MEDAN PERJUANGAN","MEDAN PETISAH",
  "MEDAN POLONIA","MEDAN SELAYANG","MEDAN SUNGGAL","MEDAN TEMBUNG","MEDAN TIMUR","MEDAN TUNTUNGAN"
];

function getProgresKuota(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  try {
    // Urutan layanan: sesuai master (kecamatan dulu, lalu kemenag) — TIDAK diurutkan berdasarkan capaian.
    const master = getMasterLayanan();
    const urutanLayanan = [];
    (master.kecamatan || []).forEach(function(l) {
      const u = l.toString().trim().toUpperCase();
      if (urutanLayanan.indexOf(u) === -1) urutanLayanan.push(u);
    });
    (master.kemenag || []).forEach(function(l) {
      const u = l.toString().trim().toUpperCase();
      if (urutanLayanan.indexOf(u) === -1) urutanLayanan.push(u);
    });

    // Kuota dari db_kuota
    const listKuota = getSemuaKuota(token); // [{kecamatan, layanan, kuota}]
    const kuotaMap = {}; // "LAY||KEC" -> kuota
    const setLayananDenganKuota = {};
    listKuota.forEach(function(item) {
      kuotaMap[item.layanan + "||" + item.kecamatan] = item.kuota;
      setLayananDenganKuota[item.layanan] = true;
    });

    // Pemakaian (jumlah input) per layanan+kecamatan
    const ssP = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheetP = ssP.getSheetByName(NAMA_SHEET_INPUT);
    const pemakaian = {};
    if (sheetP && sheetP.getLastRow() >= 2) {
      const dataInput = sheetP.getDataRange().getValues();
      for (let i = 1; i < dataInput.length; i++) {
        const lay = dataInput[i][7] ? dataInput[i][7].toString().trim().toUpperCase() : "";
        const kec = dataInput[i][10] ? dataInput[i][10].toString().trim().toUpperCase() : "";
        if (!lay || !kec) continue;
        const key = lay + "||" + kec;
        pemakaian[key] = (pemakaian[key] || 0) + 1;
      }
    }

    // Susun grup sesuai urutan layanan tetap; baris kecamatan juga urutan tetap.
    const grup = [];
    urutanLayanan.forEach(function(lay) {
      if (!setLayananDenganKuota[lay]) return; // layanan tanpa kuota sama sekali -> skip
      const baris = [];
      let totalKuota = 0, totalInput = 0;
      KECAMATAN_MEDAN_URUT.forEach(function(kec) {
        const key = lay + "||" + kec;
        if (!kuotaMap.hasOwnProperty(key)) return; // kombinasi tanpa kuota diset -> skip
        const kuota = Number(kuotaMap[key]) || 0;
        const input = pemakaian[key] || 0;
        const persen = kuota > 0 ? Math.round((input / kuota) * 1000) / 10 : 0;
        totalKuota += kuota;
        totalInput += input;
        baris.push({ kecamatan: kec, kuota: kuota, input: input, sisa: kuota - input, persen: persen });
      });
      if (baris.length === 0) return;
      const persenLayanan = totalKuota > 0 ? Math.round((totalInput / totalKuota) * 1000) / 10 : 0;
      grup.push({ layanan: lay, totalKuota: totalKuota, totalInput: totalInput, persenLayanan: persenLayanan, baris: baris });
    });

    return { sukses: true, grup: grup };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

function getDashboardProgresVerifikasi(token, kecamatanFilter) {
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }

  try {
    const role = (sesi.role || "").toString().trim().toUpperCase();
    const kecUser = (sesi.kecamatan || "").toString().trim().toUpperCase();
    const kecFilterInput = (kecamatanFilter || "").toString().trim().toUpperCase();

    const KECAMATAN_MEDAN_URUT = [
      "MEDAN AMPLAS","MEDAN AREA","MEDAN BARAT","MEDAN BARU","MEDAN BELAWAN",
      "MEDAN DELI","MEDAN DENAI","MEDAN HELVETIA","MEDAN JOHOR","MEDAN KOTA",
      "MEDAN LABUHAN","MEDAN MAIMUN","MEDAN MARELAN","MEDAN PERJUANGAN","MEDAN PETISAH",
      "MEDAN POLONIA","MEDAN SELAYANG","MEDAN SUNGGAL","MEDAN TEMBUNG","MEDAN TIMUR","MEDAN TUNTUNGAN"
    ];

    // Ambil kuota dari db_kuota -> map "LAYANAN||KECAMATAN" -> angka
    const ssMaster = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheetKuota = ssMaster.getSheetByName("db_kuota");
    const kuotaMap = {};
    if (sheetKuota && sheetKuota.getLastRow() >= 2) {
      const dataKuota = sheetKuota.getDataRange().getValues();
      for (let i = 1; i < dataKuota.length; i++) {
        const kecK = (dataKuota[i][0] || "").toString().trim().toUpperCase();
        const layK = (dataKuota[i][1] || "").toString().trim().toUpperCase();
        kuotaMap[layK + "||" + kecK] = Number(dataKuota[i][2]) || 0;
      }
    }

    // Ambil kuota khusus Katolik (subset dari kuota GSM gabungan di atas) -> "LAYANAN||KECAMATAN" -> angka
    const sheetKuotaKatolik = ssMaster.getSheetByName("db_kuotakatolik");
    const kuotaKatolikMap = {};
    if (sheetKuotaKatolik && sheetKuotaKatolik.getLastRow() >= 2) {
      const dataKuotaKatolik = sheetKuotaKatolik.getDataRange().getValues();
      for (let i = 1; i < dataKuotaKatolik.length; i++) {
        const kecK = (dataKuotaKatolik[i][0] || "").toString().trim().toUpperCase();
        const layK = (dataKuotaKatolik[i][1] || "").toString().trim().toUpperCase();
        kuotaKatolikMap[layK + "||" + kecK] = Number(dataKuotaKatolik[i][2]) || 0;
      }
    }

    const master = getMasterLayanan();
    let layananRelevan = [];
    if (role === "UTAMA") {
      layananRelevan = [].concat(master.kecamatan || [], master.kemenag || []);
    } else if (role === "KECAMATAN") {
      layananRelevan = (master.kecamatan || []).slice();
    } else {
      layananRelevan = [sesi.role];
    }

    // Kemenag TANPA kecamatan tetap -> pecah jadi 21 kartu (1 per kecamatan) untuk layanan itu.
    const modeKecamatanPisah = (role !== "UTAMA" && role !== "KECAMATAN" && !kecUser);

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || sheet.getLastRow() < 2) {
      return { sukses: true, kartu: [], bisaFilterKecamatan: (role === "UTAMA") };
    }

    const lastRow = sheet.getLastRow();
    const dataLayanan = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
    const dataTempatTugas = sheet.getRange(2, 9, lastRow - 1, 1).getValues();
    const dataKecamatan = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
    const dataKelurahan = sheet.getRange(2, 12, lastRow - 1, 1).getValues();
    const dataStatus = sheet.getRange(2, 33, lastRow - 1, 1).getValues();

    // Kalau USER_ID akun ini diawali "KELURAHAN ", batasi rekap cuma ke kelurahan itu.
    const userIdSesi = (sesi.userId || "").toString().toUpperCase().trim();
    const kelurahanTerkunci = userIdSesi.indexOf("KELURAHAN ") === 0
      ? userIdSesi.substring("KELURAHAN ".length).trim()
      : "";

    // Khusus GURU SEKOLAH MINGGU: pisah Katolik vs Kristen berdasarkan kata di Tempat Tugas.
    const subFilterGsm = userIdSesi === "BIMAS KATOLIK" ? "KATOLIK"
                        : userIdSesi === "BIMAS KRISTEN" ? "BUKAN_KATOLIK"
                        : "";

    const rekap = {};
    function kunciKartu(lay, kec) { return modeKecamatanPisah ? (lay + "||" + kec) : lay; }

    if (modeKecamatanPisah) {
      const lay = layananRelevan[0].toString().trim().toUpperCase();
      KECAMATAN_MEDAN_URUT.forEach(function (kec) {
        rekap[kunciKartu(lay, kec)] = { layanan: layananRelevan[0], kecamatanLabel: kec, total: 0, prosesVerifikasi: 0, memenuhiSyarat: 0, tidakMemenuhiSyarat: 0, berkasTidakLengkap: 0 };
      });
    } else {
      layananRelevan.forEach(function (lay) {
        rekap[lay.toString().trim().toUpperCase()] = { layanan: lay, kecamatanLabel: null, total: 0, prosesVerifikasi: 0, memenuhiSyarat: 0, tidakMemenuhiSyarat: 0, berkasTidakLengkap: 0 };
      });
    }

    for (let i = 0; i < dataLayanan.length; i++) {
      const lay = (dataLayanan[i][0] || "").toString().trim().toUpperCase();
      const kec = (dataKecamatan[i][0] || "").toString().trim().toUpperCase();
      const kel = (dataKelurahan[i][0] || "").toString().trim().toUpperCase();
      const tempatTugas = (dataTempatTugas[i][0] || "").toString().trim().toUpperCase();
      if (!lay) continue;

      if (role === "KECAMATAN" && kec !== kecUser) continue;
      if (role !== "UTAMA" && role !== "KECAMATAN" && kecUser && kec !== kecUser) continue;
      if (kecFilterInput && role === "UTAMA" && kec !== kecFilterInput) continue;
      if (kelurahanTerkunci && kel !== kelurahanTerkunci) continue;
      if (subFilterGsm === "KATOLIK" && tempatTugas.indexOf("KATOLIK") === -1) continue;
      if (subFilterGsm === "BUKAN_KATOLIK" && tempatTugas.indexOf("KATOLIK") !== -1) continue;

      const kunci = kunciKartu(lay, kec);
      if (!rekap.hasOwnProperty(kunci)) continue;

      const status = (dataStatus[i][0] || "Proses Verifikasi").toString().trim();
      rekap[kunci].total++;
      if (status === "Memenuhi Syarat") rekap[kunci].memenuhiSyarat++;
      else if (status === "Tidak Memenuhi Syarat") rekap[kunci].tidakMemenuhiSyarat++;
      else if (status === "Berkas Tidak Lengkap") rekap[kunci].berkasTidakLengkap++;
      else rekap[kunci].prosesVerifikasi++;
    }

    const kartu = Object.keys(rekap).map(function (k) {
      const item = rekap[k];
      const layUpper = item.layanan.toString().trim().toUpperCase();
      let kuota = 0;

      if (modeKecamatanPisah) {
        kuota = kuotaMap[layUpper + "||" + item.kecamatanLabel] || 0;
      } else if (role === "UTAMA" && kecFilterInput) {
        kuota = kuotaMap[layUpper + "||" + kecFilterInput] || 0;
      } else if (kecUser) {
        kuota = kuotaMap[layUpper + "||" + kecUser] || 0;
      } else {
        KECAMATAN_MEDAN_URUT.forEach(function (kec) { kuota += kuotaMap[layUpper + "||" + kec] || 0; });
      }

      // Khusus admin GSM Katolik/Kristen: pecah kuota gabungan di atas jadi porsi masing-masing.
      if (subFilterGsm === "KATOLIK" || subFilterGsm === "BUKAN_KATOLIK") {
        const kecUntukKuota = item.kecamatanLabel || kecUser || kecFilterInput;
        const kuotaKatolikKec = kuotaKatolikMap[layUpper + "||" + kecUntukKuota] || 0;
        kuota = (subFilterGsm === "KATOLIK") ? kuotaKatolikKec : (kuota - kuotaKatolikKec);
      }

      item.kuota = kuota;
      item.sisaKuota = kuota - item.total;
      return item;
    });

    if (modeKecamatanPisah) {
      kartu.sort(function (a, b) { return KECAMATAN_MEDAN_URUT.indexOf(a.kecamatanLabel) - KECAMATAN_MEDAN_URUT.indexOf(b.kecamatanLabel); });
    }

    return { sukses: true, kartu: kartu, bisaFilterKecamatan: (role === "UTAMA") };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// #########################################################################
// ## TAMBAHAN: CHAT GRUP
// #########################################################################
// =========================================================================
// FITUR CHAT GRUP (admin utama <-> kecamatan / kemenag)
// =========================================================================
// Ruang obrolan TUNGGAL yang dilihat semua admin. Pesan & status baca
// disimpan di file MASTER DROPDOWN (SS_ID_MASTER_DROPDOWN).
//
// Sheet yang dipakai (dibuat otomatis bila belum ada):
//   db_chat       : A=ID | B=Waktu(ISO) | C=Username | D=Role | E=Kecamatan | F=Pesan
//   db_chat_baca  : A=Username | B=WaktuBacaTerakhir(ISO)
//
// PENTING — PRASYARAT:
// Sesi harus memuat "username". Tambahkan username ke sesi di loginPengguna
// (lihat INSTRUKSI di bawah). Tanpa itu, pengirim akan tampil "TANPA NAMA".
//
// =========================================================================

const NAMA_SHEET_CHAT = "db_chat";
const NAMA_SHEET_CHAT_BACA = "db_chat_baca";
const BATAS_PANJANG_PESAN = 1000; // karakter maksimum per pesan
const MAKS_PESAN_DIMUAT = 300;    // ambil paling banyak N pesan terakhir

// Pastikan sheet chat ada; buat header bila belum.
function pastikanSheetChat_() {
  const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
  let sheet = ss.getSheetByName(NAMA_SHEET_CHAT);
  if (!sheet) {
    sheet = ss.insertSheet(NAMA_SHEET_CHAT);
    sheet.appendRow(["ID", "Waktu", "Username", "Role", "Kecamatan", "Pesan"]);
  }
  let sheetBaca = ss.getSheetByName(NAMA_SHEET_CHAT_BACA);
  if (!sheetBaca) {
    sheetBaca = ss.insertSheet(NAMA_SHEET_CHAT_BACA);
    sheetBaca.appendRow(["Username", "WaktuBacaTerakhir"]);
  }
  return { sheet: sheet, sheetBaca: sheetBaca };
}

// Identitas pengirim dari sesi (tak bisa dipalsukan browser).
function identitasDariSesi_(sesi) {
  return {
    username: (sesi.username || "TANPA NAMA").toString().trim().toUpperCase(),
    role: (sesi.role || "").toString().trim().toUpperCase(),
    kecamatan: (sesi.kecamatan || "").toString().trim().toUpperCase()
  };
}

// ---- KIRIM PESAN ----
function kirimPesanChat(token, teksPesan) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  const teks = String(teksPesan || "").trim();
  if (!teks) return { sukses: false, pesan: "Pesan kosong." };
  if (teks.length > BATAS_PANJANG_PESAN) {
    return { sukses: false, pesan: "Pesan terlalu panjang (maks " + BATAS_PANJANG_PESAN + " karakter)." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const { sheet } = pastikanSheetChat_();
    // ID unik = (ID terbesar yang ada) + 1, agar tetap unik meski ada baris terhapus.
    let id = 1;
    const lastRowNow = sheet.getLastRow();
    if (lastRowNow >= 2) {
      const idVals = sheet.getRange(2, 1, lastRowNow - 1, 1).getValues();
      let maxId = 0;
      for (let i = 0; i < idVals.length; i++) {
        const n = Number(idVals[i][0]);
        if (!isNaN(n) && n > maxId) maxId = n;
      }
      id = maxId + 1;
    }
    const ident = identitasDariSesi_(sesi);
    const waktuIso = new Date().toISOString();
    sheet.appendRow([id, waktuIso, ident.username, ident.role, ident.kecamatan, teks]);
    SpreadsheetApp.flush();
    // Pengirim otomatis dianggap sudah membaca sampai pesannya sendiri.
    tandaiSudahBaca_(ident.username, waktuIso);
    return { sukses: true };
  } catch (e) {
    return { sukses: false, pesan: "Gagal mengirim: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ---- AMBIL PESAN (paling banyak MAKS_PESAN_DIMUAT terakhir) ----
function ambilPesanChat(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  try {
    const { sheet } = pastikanSheetChat_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sukses: true, pesan: "", daftar: [], usernameSaya: identitasDariSesi_(sesi).username };

    const mulai = Math.max(2, lastRow - MAKS_PESAN_DIMUAT + 1);
    const jml = lastRow - mulai + 1;
    const data = sheet.getRange(mulai, 1, jml, 6).getValues();

    const daftar = data.map(function(r) {
      return {
        id: r[0],
        waktu: r[1] ? r[1].toString() : "",
        username: r[2] ? r[2].toString() : "",
        role: r[3] ? r[3].toString() : "",
        kecamatan: r[4] ? r[4].toString() : "",
        pesan: r[5] ? r[5].toString() : ""
      };
    });

    return { sukses: true, daftar: daftar, usernameSaya: identitasDariSesi_(sesi).username };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// ---- TANDAI SUDAH BACA (dipanggil saat user membuka chat) ----
function tandaiChatDibaca(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  try {
    const ident = identitasDariSesi_(sesi);
    tandaiSudahBaca_(ident.username, new Date().toISOString());
    return { sukses: true };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// Helper internal: simpan/update waktu baca terakhir untuk seorang username.
function tandaiSudahBaca_(username, waktuIso) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const { sheetBaca } = pastikanSheetChat_();
    const lastRow = sheetBaca.getLastRow();
    let ditemukan = false;
    if (lastRow >= 2) {
      const data = sheetBaca.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim().toUpperCase() === username) {
          sheetBaca.getRange(i + 2, 2).setValue(waktuIso);
          ditemukan = true;
          break;
        }
      }
    }
    if (!ditemukan) {
      sheetBaca.appendRow([username, waktuIso]);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// ---- JUMLAH PESAN BELUM DIBACA (untuk badge) ----
function hitungChatBelumDibaca(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message, jumlah: 0 }; }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName(NAMA_SHEET_CHAT);
    const sheetBaca = ss.getSheetByName(NAMA_SHEET_CHAT_BACA);
    if (!sheet || sheet.getLastRow() < 2) return { sukses: true, jumlah: 0 };

    const ident = identitasDariSesi_(sesi);

    // Ambil waktu baca terakhir user.
    let waktuBaca = null;
    if (sheetBaca && sheetBaca.getLastRow() >= 2) {
      const dataBaca = sheetBaca.getRange(2, 1, sheetBaca.getLastRow() - 1, 2).getValues();
      for (let i = 0; i < dataBaca.length; i++) {
        if (dataBaca[i][0] && dataBaca[i][0].toString().trim().toUpperCase() === ident.username) {
          waktuBaca = dataBaca[i][1] ? new Date(dataBaca[i][1].toString()) : null;
          break;
        }
      }
    }

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 2, lastRow - 1, 2).getValues(); // kolom B(Waktu) & C(Username)
    let jumlah = 0;
    for (let i = 0; i < data.length; i++) {
      const waktuPesan = data[i][0] ? new Date(data[i][0].toString()) : null;
      const pengirim = data[i][1] ? data[i][1].toString().trim().toUpperCase() : "";
      if (pengirim === ident.username) continue;       // pesan sendiri tidak dihitung
      if (!waktuPesan) continue;
      if (!waktuBaca || waktuPesan > waktuBaca) jumlah++;
    }
    return { sukses: true, jumlah: jumlah };
  } catch (e) {
    return { sukses: false, pesan: e.toString(), jumlah: 0 };
  }
}

// ---- HAPUS PESAN (KHUSUS ADMIN UTAMA) ----
function hapusPesanChat(token, idPesan) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  // Otorisasi: hanya peran UTAMA.
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh menghapus pesan." };
  }

  const idTarget = String(idPesan || "").trim();
  if (!idTarget) return { sukses: false, pesan: "ID pesan tidak valid." };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const { sheet } = pastikanSheetChat_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sukses: false, pesan: "Tidak ada pesan." };

    const idKolom = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // kolom A = ID
    for (let i = 0; i < idKolom.length; i++) {
      if (idKolom[i][0] !== "" && String(idKolom[i][0]).trim() === idTarget) {
        sheet.deleteRow(i + 2);
        SpreadsheetApp.flush();
        return { sukses: true };
      }
    }
    return { sukses: false, pesan: "Pesan tidak ditemukan (mungkin sudah dihapus)." };
  } catch (e) {
    return { sukses: false, pesan: "Gagal menghapus: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// #########################################################################
// ## TAMBAHAN: SAKELAR SETELAN (buka/tutup input)
// #########################################################################
// =========================================================================
// SAKELAR BUKA/TUTUP HALAMAN INPUT (untuk KECAMATAN & KEMENAG)
// =========================================================================
// Disimpan di sheet "db_setelan" pada file MASTER DROPDOWN, format key-value:
//   Kolom A = Key | Kolom B = Value
//   Baris key "INPUT_KECAMATAN_KEMENAG" bernilai "BUKA" atau "TUTUP".
//
// - "BUKA"  : kecamatan/kemenag boleh mengakses halaman Input (default).
// - "TUTUP" : kecamatan/kemenag TIDAK boleh input; tab Input disembunyikan,
//             mereka langsung mendarat di Lihat Data. Admin UTAMA tetap bebas.
//
// Sheet db_setelan dibuat otomatis bila belum ada (default BUKA).
// =========================================================================

const NAMA_SHEET_SETELAN = "db_setelan";
const KEY_INPUT_KECKEM = "INPUT_KECAMATAN_KEMENAG";

function pastikanSheetSetelan_() {
  const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
  let sheet = ss.getSheetByName(NAMA_SHEET_SETELAN);
  if (!sheet) {
    sheet = ss.insertSheet(NAMA_SHEET_SETELAN);
    sheet.appendRow(["Key", "Value"]);
    sheet.appendRow([KEY_INPUT_KECKEM, "BUKA"]);
  }
  return sheet;
}

// Ambil nilai sebuah key (string). Mengembalikan "" jika tidak ada.
function ambilSetelan_(key) {
  const sheet = pastikanSheetSetelan_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim().toUpperCase() === key.toUpperCase()) {
      return data[i][1] ? data[i][1].toString().trim().toUpperCase() : "";
    }
  }
  return "";
}

// true jika input kecamatan/kemenag sedang DITUTUP.
function inputKecKemDitutup_() {
  const v = ambilSetelan_(KEY_INPUT_KECKEM);
  return v === "TUTUP";
}

// Dipanggil frontend saat login untuk tahu apakah tab Input boleh tampil.
// Mengembalikan {sukses, ditutup} — ditutup=true berarti sembunyikan tab Input
// untuk peran kecamatan/kemenag.
function statusInputKecKem(token) {
  try {
    // Sesi wajib biar hanya user login yang bisa lihat status
    const sesi = wajibSesi_(token);
    const peranSesi = (sesi.role || "").toString().trim().toUpperCase();

    // Admin utama tidak terkena sakelar — selalu return BUKA
    if (peranSesi === "UTAMA") {
      return { sukses: true, ditutup: false, sumber: "UTAMA_BEBAS" };
    }

    // Cek akses per user (dengan fallback ke master)
    const akses = cekAksesInputUser_(token, sesi.userId);
    return {
      sukses: true,
      ditutup: akses.ditutup,
      sumber: akses.sumber,   // "KHUSUS" atau "MASTER"
      nilai: akses.nilai      // "BUKA" atau "TUTUP"
    };
  } catch (e) {
    return { sukses: false, pesan: e.message };
  }
}

// (OPSIONAL) Ubah sakelar dari dalam aplikasi — KHUSUS admin utama.
// Anda juga bisa mengubahnya langsung di sheet db_setelan tanpa fungsi ini.
// Perubahan otomatis dicatat ke sheet db_riwayat_setelan.
function setInputKecKem(token, buka) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah setelan ini." };
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const sheet = pastikanSheetSetelan_();
    const nilaiBaru = buka ? "BUKA" : "TUTUP";
    let nilaiLama = "BUKA"; // default
    const lastRow = sheet.getLastRow();
    let ketemu = false;
    if (lastRow >= 2) {
      const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim().toUpperCase() === KEY_INPUT_KECKEM) {
          nilaiLama = data[i][1] ? data[i][1].toString().trim().toUpperCase() : "BUKA";
          sheet.getRange(i + 2, 2).setValue(nilaiBaru);
          ketemu = true;
          break;
        }
      }
    }
    if (!ketemu) sheet.appendRow([KEY_INPUT_KECKEM, nilaiBaru]);

    // Catat riwayat perubahan master
    if (nilaiLama !== nilaiBaru) {
      catatRiwayatSetelan_(sesi.username, KEY_INPUT_KECKEM, nilaiLama, nilaiBaru);
    }

    // AUTO-CLEANUP: hapus semua sakelar khusus yang jadi redundant dengan master baru.
    // Contoh: master baru BUKA → semua INPUT_USER_* dengan nilai BUKA jadi redundant (dihapus).
    // Kalau ada admin yang perlu di-tutup saat master BUKA, mereka pasti punya sakelar TUTUP
    // yang tetap dipertahankan (karena TUTUP tidak match dengan master BUKA).
    let jumlahDihapus = 0;
    if (nilaiLama !== nilaiBaru) {
      const lastRowSekarang = sheet.getLastRow();
      if (lastRowSekarang >= 2) {
        const dataSetelan = sheet.getRange(2, 1, lastRowSekarang - 1, 2).getValues();
        // Kumpulkan baris yang perlu dihapus (dari bawah supaya index tidak bergeser)
        const barisDihapus = [];
        for (let j = 0; j < dataSetelan.length; j++) {
          const key = dataSetelan[j][0] ? dataSetelan[j][0].toString().trim().toUpperCase() : "";
          const nilai = dataSetelan[j][1] ? dataSetelan[j][1].toString().trim().toUpperCase() : "";
          if (key.indexOf(PREFIX_SAKELAR_USER) === 0 && nilai === nilaiBaru) {
            // Sakelar khusus ini jadi redundant → tandai untuk dihapus
            barisDihapus.push({ index: j + 2, userId: key.substring(PREFIX_SAKELAR_USER.length) });
          }
        }
        // Hapus dari bawah ke atas biar tidak salah index
        for (let k = barisDihapus.length - 1; k >= 0; k--) {
          sheet.deleteRow(barisDihapus[k].index);
          jumlahDihapus++;
        }
        // Catat cleanup ke riwayat kalau ada yang dihapus
        if (jumlahDihapus > 0) {
          catatRiwayatSetelan_(
            sesi.username,
            "AUTO_CLEANUP_" + nilaiBaru,
            jumlahDihapus + " sakelar khusus " + nilaiBaru,
            "(dihapus, jadi redundant dgn master)"
          );
        }
      }
    }

    SpreadsheetApp.flush();
    return {
      sukses: true,
      ditutup: !buka,
      cleanup: jumlahDihapus  // frontend bisa tampilkan info ini
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Helper: catat riwayat perubahan setelan ke sheet audit.
function catatRiwayatSetelan_(username, key, nilaiLama, nilaiBaru) {
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    let sheet = ss.getSheetByName("db_riwayat_setelan");
    if (!sheet) {
      sheet = ss.insertSheet("db_riwayat_setelan");
      sheet.appendRow(["Waktu", "Username", "Key", "Nilai Lama", "Nilai Baru", "Keterangan"]);
      sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
    const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    sheet.appendRow([waktu, username, key, nilaiLama, nilaiBaru, ""]);
  } catch (e) {
    Logger.log("Gagal catat riwayat setelan: " + e.toString());
  }
}

// Ambil status sakelar + info perubahan terakhir (siapa dan kapan).
// Dipanggil frontend untuk menampilkan banner/modal notifikasi ke admin
// kecamatan/kemenag dengan konteks yang jelas.
function ambilStatusDetailSetelan(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  try {
    const ditutup = inputKecKemDitutup_();
    let terakhirUbah = { waktu: "", username: "", nilaiBaru: "" };

    // Cari perubahan terakhir untuk key INPUT_KECAMATAN_KEMENAG di sheet riwayat.
    try {
      const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
      const sheet = ss.getSheetByName("db_riwayat_setelan");
      if (sheet && sheet.getLastRow() >= 2) {
        const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
        // Cari dari bawah ke atas (data terbaru)
        for (let i = data.length - 1; i >= 0; i--) {
          if (data[i][2] && data[i][2].toString().trim().toUpperCase() === KEY_INPUT_KECKEM) {
            terakhirUbah = {
              waktu: data[i][0] ? data[i][0].toString() : "",
              username: data[i][1] ? data[i][1].toString() : "",
              nilaiBaru: data[i][4] ? data[i][4].toString() : ""
            };
            break;
          }
        }
      }
    } catch (e) { /* biar tidak mengganggu — return status saja */ }

    return {
      sukses: true,
      ditutup: ditutup,
      terakhirUbah: terakhirUbah
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// =========================================================================
// FUNGSI SEKALI-JALAN: HASH SEMUA PASSWORD POLOS DI db_admin
// =========================================================================
// Gunakan untuk setup awal banyak akun (mis. 50 user) TANPA perlu Run satu
// per satu. Langkah:
//   1. Isi db_admin: kolom A=Username, B=Password (ketik POLOS/biasa dulu),
//      C=Role, D=Kecamatan. Lakukan untuk semua user.
//   2. Di editor Apps Script, pilih fungsi: hashSemuaPasswordAwal
//   3. Klik Run. Selesai — semua password polos di kolom B berubah jadi hash.
//
// PENGAMAN:
//   - Sel yang SUDAH berupa hash (64 karakter heksadesimal) DILEWATI, sehingga
//     aman dijalankan lebih dari sekali tanpa merusak password yang sudah benar.
//   - Baris tanpa username atau tanpa password DILEWATI.
//   - Hasil ringkasan dicatat di Logger (Lihat > Execution log).
//
// TAMBAHKAN fungsi ini ke Kode.gs (boleh diletakkan di mana saja dalam proyek).
//
// KEAMANAN: fungsi ini top-level tanpa parameter/token dan tidak dipanggil dari front-end
// manapun (murni utilitas setup manual), sehingga tetap bisa dipanggil siapa pun dari browser
// lewat google.script.run.hashSemuaPasswordAwal() tanpa login. Risikonya rendah — operasi ini
// idempotent (baris yang sudah ter-hash dilewati, lihat PENGAMAN di atas) dan tidak membocorkan
// apa pun, hanya menulis ulang db_admin. Tetap didokumentasikan di sini sebagai pengingat: jangan
// tambahkan logika baru di fungsi ini yang bergantung pada asumsi "hanya developer yang bisa
// memanggil" tanpa menambahkan wajibSesi_ terlebih dahulu.

function hashSemuaPasswordAwal() {
  const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
  const sheet = ss.getSheetByName("db_admin");
  if (!sheet) { Logger.log("Sheet db_admin tidak ditemukan."); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log("Belum ada akun di db_admin."); return; }

  // Ambil kolom Username (A) & Password (B).
  const rentang = sheet.getRange(2, 1, lastRow - 1, 2);
  const data = rentang.getValues();

  let diHash = 0;
  let dilewatiSudahHash = 0;
  let dilewatiKosong = 0;

  for (let i = 0; i < data.length; i++) {
    const username = data[i][0] ? data[i][0].toString().trim() : "";
    const password = data[i][1] ? data[i][1].toString().trim() : "";

    if (!username || !password) { dilewatiKosong++; continue; }

    // Lewati bila sudah berbentuk hash (64 karakter heksadesimal).
    if (/^[0-9a-f]{64}$/i.test(password)) { dilewatiSudahHash++; continue; }

    // Hash password polos -> tulis kembali ke sel B baris ini.
    const hash = hashString_(password);
    sheet.getRange(i + 2, 2).setValue(hash);
    diHash++;
  }

  SpreadsheetApp.flush();
  const ringkasan =
    "Selesai. Di-hash: " + diHash +
    " | Dilewati (sudah hash): " + dilewatiSudahHash +
    " | Dilewati (kosong): " + dilewatiKosong;
  Logger.log(ringkasan);
  return ringkasan;
}


// =========================================================================
// UBAH AKUN SENDIRI (semua role) — ganti USERNAME dan/atau PASSWORD
// =========================================================================
// Dipanggil frontend:
//   ubahAkunSendiri(token, passwordVerifikasi, usernameBaru, passwordBaru, konfirmasiBaru)
//
// Aturan:
//   - passwordVerifikasi WAJIB & harus cocok (kunci pembuka).
//   - usernameBaru (opsional): jika diisi -> min 4 karakter, hanya huruf/angka/
//     garis bawah, dan harus UNIK (tidak dipakai akun lain).
//   - passwordBaru (opsional): jika diisi -> min 6 karakter, mengandung huruf &
//     angka, tidak sama dengan password lama; konfirmasi harus cocok.
//   - Minimal salah satu (username atau password) harus diisi.
//
// Mengembalikan { sukses, pesan, usernameBaru? } — usernameBaru dikembalikan
// bila username berubah, agar frontend bisa memberi tahu user login ulang.
function ubahAkunSendiri(token, passwordVerifikasi, usernameBaru, passwordBaru, konfirmasiBaru) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  const verif = String(passwordVerifikasi || "").trim();
  const userBaru = String(usernameBaru || "").trim();
  const passBaru = String(passwordBaru || "").trim();
  const konfirm = String(konfirmasiBaru || "").trim();

  if (!verif) {
    return { sukses: false, pesan: "Password (verifikasi) wajib diisi." };
  }
  const mauGantiUser = userBaru.length > 0;
  const mauGantiPass = passBaru.length > 0 || konfirm.length > 0;
  if (!mauGantiUser && !mauGantiPass) {
    return { sukses: false, pesan: "Isi username baru dan/atau password baru." };
  }

  // Validasi username baru (bila diisi).
  if (mauGantiUser) {
    if (userBaru.length < 4) {
      return { sukses: false, pesan: "Username baru minimal 4 karakter." };
    }
    if (!/^[A-Za-z0-9_]+$/.test(userBaru)) {
      return { sukses: false, pesan: "Username baru hanya boleh huruf, angka, dan garis bawah (_)." };
    }
  }

  // Validasi password baru (bila diisi).
  if (mauGantiPass) {
    if (!passBaru || !konfirm) {
      return { sukses: false, pesan: "Password baru dan konfirmasi wajib diisi." };
    }
    if (passBaru !== konfirm) {
      return { sukses: false, pesan: "Password baru dan konfirmasi tidak sama." };
    }
    if (passBaru.length < 6) {
      return { sukses: false, pesan: "Password baru minimal 6 karakter." };
    }
    if (!/[A-Za-z]/.test(passBaru) || !/[0-9]/.test(passBaru)) {
      return { sukses: false, pesan: "Password baru harus mengandung huruf dan angka." };
    }
    if (passBaru === verif) {
      return { sukses: false, pesan: "Password baru tidak boleh sama dengan password lama." };
    }
  }

  const usernameSesi = String(sesi.username || "").trim();
  if (!usernameSesi) {
    return { sukses: false, pesan: "Sesi tidak memuat username. Silakan login ulang." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) {
      return { sukses: false, pesan: "Data akun tidak ditemukan." };
    }

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); // A=Username, B=Password
    const hashVerif = hashString_(verif);

    // Cari baris milik user ini, dan sekaligus cek keunikan username baru.
    let barisUser = -1;
    let usernameBentrok = false;
    for (let i = 0; i < data.length; i++) {
      const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
      if (usernameSheet === usernameSesi) {
        barisUser = i;
      }
      if (mauGantiUser &&
          usernameSheet &&
          usernameSheet.toLowerCase() === userBaru.toLowerCase() &&
          usernameSheet !== usernameSesi) {
        usernameBentrok = true;
      }
    }

    if (barisUser === -1) {
      return { sukses: false, pesan: "Akun tidak ditemukan." };
    }

    // Verifikasi password lama.
    const passwordSheet = data[barisUser][1] ? data[barisUser][1].toString().trim() : "";
    if (passwordSheet !== hashVerif) {
      return { sukses: false, pesan: "Password salah." };
    }

    // Cek bentrok username.
    if (mauGantiUser && usernameBentrok) {
      return { sukses: false, pesan: "Username \"" + userBaru + "\" sudah dipakai akun lain." };
    }

    const rowSheet = barisUser + 2;
    let usernameBerubah = false;

    if (mauGantiUser && userBaru !== usernameSesi) {
      sheet.getRange(rowSheet, 1).setValue(userBaru); // kolom A
      usernameBerubah = true;
    }
    if (mauGantiPass) {
      sheet.getRange(rowSheet, 2).setValue(hashString_(passBaru)); // kolom B
    }
    SpreadsheetApp.flush();

    let pesan = "Perubahan berhasil disimpan.";
    if (usernameBerubah) {
      pesan += " Username diubah — silakan login ulang dengan username baru.";
    }
    return { sukses: true, pesan: pesan, usernameBaru: usernameBerubah ? userBaru : "" };
  } catch (e) {
    return { sukses: false, pesan: "Gagal menyimpan perubahan: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}


// =========================================================================
// RESET PASSWORD OLEH ADMIN UTAMA (tanpa menyimpan password asli)
// =========================================================================
// Admin utama memilih user, lalu menetapkan password sementara. Password
// di-hash sebelum disimpan (tidak ada password asli tersimpan di sheet).
// User memakai password sementara untuk login, lalu menggantinya sendiri.

// Ambil daftar akun (username, role, kecamatan) — KHUSUS admin utama.
function ambilDaftarAkun(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengakses daftar akun." };
  }
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) return { sukses: true, daftar: [] };
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues(); // A..D
    const daftar = [];
    for (let i = 0; i < data.length; i++) {
      const username = data[i][0] ? data[i][0].toString().trim() : "";
      if (!username) continue;
      daftar.push({
        username: username,
        role: data[i][2] ? data[i][2].toString().trim().toUpperCase() : "",
        kecamatan: data[i][3] ? data[i][3].toString().trim().toUpperCase() : ""
      });
    }
    daftar.sort(function(a, b) { return a.username.localeCompare(b.username); });
    return { sukses: true, daftar: daftar };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// Reset password seorang user ke password sementara — KHUSUS admin utama.
// Dipanggil frontend: resetPasswordUser(token, usernameTarget, passwordSementara)
function resetPasswordUser(token, usernameTarget, passwordSementara) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mereset password." };
  }

  const target = String(usernameTarget || "").trim();
  const passBaru = String(passwordSementara || "").trim();
  if (!target) return { sukses: false, pesan: "Pilih user yang akan direset." };
  if (passBaru.length < 6) {
    return { sukses: false, pesan: "Password sementara minimal 6 karakter." };
  }
  if (!/[A-Za-z]/.test(passBaru) || !/[0-9]/.test(passBaru)) {
    return { sukses: false, pesan: "Password sementara harus mengandung huruf dan angka." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) {
      return { sukses: false, pesan: "Data akun tidak ditemukan." };
    }
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // kolom A = Username
    for (let i = 0; i < data.length; i++) {
      const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
      if (usernameSheet === target) {
        sheet.getRange(i + 2, 2).setValue(hashString_(passBaru)); // kolom B = Password (hash)
        SpreadsheetApp.flush();
        return { sukses: true, pesan: "Password untuk \"" + target + "\" berhasil direset. Sampaikan password sementara ini ke user, lalu minta mereka menggantinya lewat menu Akun Saya." };
      }
    }
    return { sukses: false, pesan: "User tidak ditemukan." };
  } catch (e) {
    return { sukses: false, pesan: "Gagal reset: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}


// =========================================================================
// PROFIL USER — identitas nyata di balik akun
// =========================================================================
// db_admin kolom: A=Username, B=Password, C=Role, D=Kecamatan,
//                 E=Nama Lengkap, F=Nomor HP, G=Jabatan
//
// Profil dianggap belum diisi bila kolom E (Nama Lengkap) masih kosong.
// Saat pertama login, frontend menampilkan form profil (wajib diisi).
// Hanya admin utama yang bisa mengubah profil user lain.

// Dipanggil user sendiri saat pertama login. Sekaligus wajib ganti password.
function simpanProfilUser(token, namaLengkap, nomorHp, jabatan, passwordBaru) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  const nama = String(namaLengkap || "").trim().toUpperCase();
  // Konversi ke string dulu agar leading zero tidak hilang bila browser kirim angka
  let hp = String(nomorHp || "").trim().replace(/[^0-9]/g, '');
  if (hp && hp[0] !== '0') hp = '0' + hp; // jaga leading zero
  const jbt  = String(jabatan || "").trim().toUpperCase();
  const pb   = String(passwordBaru || "").trim();

  if (!nama) return { sukses: false, pesan: "Nama lengkap wajib diisi." };
  if (!hp || !hp.startsWith("08") || hp.length < 10) {
    return { sukses: false, pesan: "Nomor HP tidak valid. Harus diawali 08 dan minimal 10 digit angka." };
  }
  if (!jbt) return { sukses: false, pesan: "Jabatan wajib diisi." };

  // Validasi password baru
  if (!pb) return { sukses: false, pesan: "Password baru wajib diisi." };
  if (pb.length < 6) return { sukses: false, pesan: "Password baru minimal 6 karakter." };
  if (!/[A-Za-z]/.test(pb) || !/[0-9]/.test(pb)) {
    return { sukses: false, pesan: "Password baru harus mengandung huruf dan angka." };
  }

  // Simpan password baru (hash) ke kolom B di db_admin.
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
      if (usernameSheet === sesi.username) {
        sheet.getRange(i + 1, 2).setValue(hashString_(pb)); // kolom B = password
        break;
      }
    }
  } catch (e) {
    return { sukses: false, pesan: "Gagal menyimpan password: " + e.toString() };
  }

  return simpanProfilKeSheet_(token, sesi.username, nama, hp, jbt);
}

// Dipanggil admin utama untuk mengubah profil user lain.
function ubahProfilUser(token, usernameTarget, namaLengkap, nomorHp, jabatan) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah profil user lain." };
  }

  const target = String(usernameTarget || "").trim();
  const nama   = String(namaLengkap || "").trim().toUpperCase();
  let hp       = String(nomorHp || "").trim().replace(/[^0-9]/g, '');
  if (hp && hp[0] !== '0') hp = '0' + hp;
  const jbt    = String(jabatan || "").trim().toUpperCase();

  if (!target) return { sukses: false, pesan: "Pilih user yang profilnya akan diubah." };
  if (!nama) return { sukses: false, pesan: "Nama lengkap wajib diisi." };
  if (!hp || !hp.startsWith("08") || hp.length < 10) {
    return { sukses: false, pesan: "Nomor HP tidak valid." };
  }
  if (!jbt) return { sukses: false, pesan: "Jabatan wajib diisi." };

  return simpanProfilKeSheet_(token, target, nama, hp, jbt);
}

// Helper internal: tulis E/F/G di baris username yang dimaksud.
function simpanProfilKeSheet_(token, usernameTarget, nama, hp, jabatan) {
  // KEAMANAN: sebelumnya fungsi ini tidak mengecek sesi/kepemilikan sama sekali — proteksi
  // "hanya admin utama boleh ubah profil ORANG LAIN" hanya ada di fungsi wrapper ubahProfilUser,
  // tapi karena ini fungsi top-level, tetap bisa dipanggil langsung untuk mengubah profil akun
  // MANA PUN (nama/HP/jabatan) tanpa login sama sekali. Izinkan hanya kalau: (a) pelaku mengedit
  // profilnya sendiri (dipakai simpanProfilUser), atau (b) pelaku admin UTAMA (dipakai ubahProfilUser).
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }
  const peran = (sesi.role || "").toString().trim().toUpperCase();
  const milikSendiri = (sesi.username || "").toString().trim() === String(usernameTarget || "").trim();
  if (!milikSendiri && peran !== "UTAMA") {
    return { sukses: false, pesan: "Anda tidak berhak mengubah profil akun ini." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) {
      return { sukses: false, pesan: "Data akun tidak ditemukan." };
    }
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // kolom A
    for (let i = 0; i < data.length; i++) {
      const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
      if (usernameSheet === usernameTarget) {
        // Tulis ke kolom E(5), F(6), G(7)
        // Kolom F (HP) disimpan sebagai teks agar leading zero tidak hilang di Sheets.
        sheet.getRange(i + 2, 5).setValue(nama);
        sheet.getRange(i + 2, 6).setNumberFormat('@STRING@').setValue(hp);
        sheet.getRange(i + 2, 7).setValue(jabatan);
        SpreadsheetApp.flush();
        return { sukses: true, pesan: "Profil berhasil disimpan." };
      }
    }
    return { sukses: false, pesan: "Akun tidak ditemukan." };
  } catch (e) {
    return { sukses: false, pesan: "Gagal menyimpan profil: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}


// =========================================================================
// EDIT DATA PENERIMA — timpa langsung + catat riwayat ke db_riwayat_edit
// =========================================================================
// Kolom Data Input (0-based index):
//  0=No.Urut  1=Nama  2=NIK  3=JK  4=TmptLahir  5=TglLahir  6=Alamat
//  7=Layanan  8=TempatTugas  9=AlamatTugas  10=Kecamatan  11=Kelurahan
//  12=NamaRek  13=NoRek  14=KantorCabang  15=NoKontak  16=BPJS  17=Umur
//  18=linkKtp  19=linkRek  20=linkPermohon
//  21=linkPernyataan (Satu Jenis & Bukan ASN/BUMN/BUMD/TNI/POLRI — digabung)
//  22=linkDomisili  23=linkFormulir  24=linkPendukung
//  25=linkFotoPlank  26=linkFotoIbadah  27=linkFotoKegiatan
//
// editData.teks: { 1:nilai, 2:nilai, ... } hanya kolom yang diubah
// editData.berkas: { 18:{ namaFile, mimeType, dataBase64 }, ... } opsional

function editDataPenerima(token, nomorBarisAsli, editData) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  const baris = Number(nomorBarisAsli);
  if (!baris || baris < 2) return { sukses: false, pesan: "Nomor baris tidak valid." };

  const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
  const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
  if (!sheet || baris > sheet.getLastRow()) return { sukses: false, pesan: "Baris tidak ditemukan." };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    // Ambil data baris saat ini (kolom 1-31, termasuk ID Folder Berkas)
    const rowLama = sheet.getRange(baris, 1, 1, 40).getValues()[0];

    // Cek hak akses edit (sama dengan hak lihat + validasi wilayah)
    const listLayananKemenag = daftarLayananKemenagUpper_();
    const layananSheet = (rowLama[7] || "").toString().trim().toUpperCase();
    const kecamatanSheet = (rowLama[10] || "").toString().trim().toUpperCase();
    const role = sesi.role;
    const kecPengguna = (sesi.kecamatan || "").toUpperCase();

    let bolehEdit = false;
    if (role === "UTAMA") {
      bolehEdit = true;
    } else if (role === "KECAMATAN") {
      bolehEdit = (kecamatanSheet === kecPengguna && listLayananKemenag.indexOf(layananSheet) === -1);
    } else if (listLayananKemenag.indexOf(role) !== -1) {
      bolehEdit = (layananSheet === role) && (kecPengguna ? kecamatanSheet === kecPengguna : true);
    }
    if (!bolehEdit) return { sukses: false, pesan: "Anda tidak berhak mengedit data ini." };

    // Cek sakelar tutup: kecamatan/kemenag tidak boleh edit saat periode ditutup.
    // Admin utama tetap bebas mengedit kapan saja (sesuai kebijakan).
    // Cek sakelar per user (yang otomatis fall back ke master kalau tidak ada khusus).
    const peranSesi = (sesi.role || "").toString().trim().toUpperCase();
    const adalahKecKem = (peranSesi === "KECAMATAN") ||
                         (daftarLayananKemenagUpper_().indexOf(peranSesi) !== -1);
    if (adalahKecKem) {
      const akses = cekAksesInputUser_(token, sesi.userId);
      if (akses.ditutup) {
        const pesan = akses.sumber === "KHUSUS"
          ? "Akses edit untuk akun Anda telah ditutup secara khusus oleh admin utama. Perubahan data hanya dapat dilakukan oleh Admin Utama Dinas Sosial Kota Medan berdasarkan surat resmi."
          : "Periode input telah ditutup. Perubahan data hanya dapat dilakukan oleh Admin Utama Dinas Sosial Kota Medan berdasarkan surat resmi dari instansi.";
        return { sukses: false, pesan: pesan };
      }
    }

    // Kolom yang boleh diedit (0-based index, teks)
    const KOLOM_TEKS_BOLEH = [1,2,3,4,5,6,8,9,11,12,13,14,15,16];
    // Kolom berkas (0-based index → FOLDER_IDS key)
    const KOLOM_BERKAS = {
      18: "KTP",
      19: "Buku Rekening",
      20: "Surat Permohonan",
      21: "Surat Pernyataan (Satu Jenis & Bukan ASN/BUMN/BUMD/TNI/POLRI)",
      22: "Domisili Kelurahan",
      23: "Formulir Pendataan",
      24: "Berkas Pendukung",
      25: "Foto Plank",
      26: "Foto Lokasi Ibadah",
      27: "Foto Kegiatan",
      28: "Rekomendasi BKM",
      29: "Rekomendasi Pengurus Rumah Ibadah",
    };

    const riwayat = []; // [{kolom, label, sebelum, sesudah}]
    const teks = editData.teks || {};
    const berkas = editData.berkas || {};

    // ── VALIDASI ULANG: NIK ganda / Rekening ganda / Tempat-tugas ganda / Umur ──
    // Sebelumnya kolom-kolom ini bisa diedit tanpa validasi ulang sama sekali — berbeda dari alur
    // submit data baru (simpanDataKeSheet/validasiDataBaru_) yang memang mengecek semua ini. Admin
    // yang mengedit bisa tanpa sadar mengubah NIK/rekening jadi sama dengan milik orang lain, atau
    // mengubah tanggal lahir jadi <18 tahun, dan tetap tersimpan tanpa penolakan. Dicek di sini
    // SEBELUM baris mana pun ditimpa.
    const nikBaruEdit = (teks[2] !== undefined) ? teks[2].toString().trim() : (rowLama[2] || "").toString().trim();
    const rekBaruEdit = (teks[13] !== undefined) ? teks[13].toString().trim() : (rowLama[13] || "").toString().trim();
    const tempatTugasBaruEdit = rapikanTeks_(teks[8] !== undefined ? teks[8] : rowLama[8]);
    const alamatTugasBaruEdit = rapikanTeks_(teks[9] !== undefined ? teks[9] : rowLama[9]);

    const nikBerubah = (teks[2] !== undefined) && nikBaruEdit !== (rowLama[2] || "").toString().trim();
    const rekBerubah = (teks[13] !== undefined) && rekBaruEdit !== (rowLama[13] || "").toString().trim();
    const tempatTugasBerubah = (teks[8] !== undefined) || (teks[9] !== undefined);

    if (nikBerubah || rekBerubah || tempatTugasBerubah) {
      const lastRowCek = sheet.getLastRow();
      if (lastRowCek > 1) {
        const dataCek = sheet.getRange(2, 1, lastRowCek - 1, 14).getValues();
        for (let i = 0; i < dataCek.length; i++) {
          if (i + 2 === baris) continue; // lewati baris yang sedang diedit sendiri
          if (dataCek[i].length < 14) continue;

          if (nikBerubah && (dataCek[i][2] || "").toString().trim() === nikBaruEdit) {
            return { sukses: false, pesan: "GAGAL: NIK " + nikBaruEdit + " sudah terdaftar atas nama " + (dataCek[i][1] || "").toString().trim() + "." };
          }
          if (rekBerubah && (dataCek[i][13] || "").toString().trim() === rekBaruEdit) {
            return { sukses: false, pesan: "GAGAL: Nomor rekening " + rekBaruEdit + " sudah digunakan oleh " + (dataCek[i][1] || "").toString().trim() + "." };
          }
          if (tempatTugasBerubah && LAYANAN_BATASI_TEMPAT_TUGAS.indexOf(layananSheet) !== -1) {
            const tempatTerdaftar = rapikanTeks_(dataCek[i][8]);
            const alamatTerdaftar = rapikanTeks_(dataCek[i][9]);
            const layananTerdaftar = (dataCek[i][7] || "").toString().trim().toUpperCase();
            if (tempatTerdaftar === tempatTugasBaruEdit && alamatTerdaftar === alamatTugasBaruEdit && layananTerdaftar === layananSheet) {
              return { sukses: false, pesan: "GAGAL: " + tempatTugasBaruEdit + " sudah memiliki penerima untuk layanan " + layananSheet + " atas nama " + (dataCek[i][1] || "").toString().trim() + "." };
            }
          }
        }
      }
    }

    if (teks[5] !== undefined) {
      const umurCekBaru = hitungUmur_(teks[5].toString().trim());
      if (umurCekBaru !== null && umurCekBaru < 18) {
        return { sukses: false, pesan: "GAGAL: Usia di bawah 18 tahun tidak memenuhi syarat." };
      }
    }

    // ── Perubahan teks ──
    for (const idxStr of Object.keys(teks)) {
      const idx = Number(idxStr);
      if (KOLOM_TEKS_BOLEH.indexOf(idx) === -1) continue;
      const nilaiLama = (rowLama[idx] !== null && rowLama[idx] !== undefined) ? rowLama[idx].toString().trim() : "";
      let nilaiBaru = (teks[idxStr] || "").toString().trim();
      // Uppercase kecuali kolom nomor (NIK, rekening, kontak)
      if ([2,13,15].indexOf(idx) === -1) nilaiBaru = nilaiBaru.toUpperCase();
      if (nilaiLama === nilaiBaru) continue;

      if (idx === 15) {
        // No kontak: simpan sebagai teks agar leading zero aman
        sheet.getRange(baris, idx + 1).setNumberFormat('@STRING@').setValue(nilaiBaru);
      } else {
        sheet.getRange(baris, idx + 1).setValue(nilaiBaru);
      }
      riwayat.push({ kolom: idx, label: labelKolom_(idx), sebelum: nilaiLama, sesudah: nilaiBaru });
    }

    // ── Perbarui umur bila tanggal lahir berubah (indeks 5) ──
    if (teks[5] !== undefined) {
      const tglBaru = teks[5].toString().trim();
      const umurBaru = hitungUmur_(tglBaru);
      if (umurBaru !== null) sheet.getRange(baris, 18).setValue(umurBaru); // kolom 18 = Umur (1-based)
    }

    // ── Perubahan berkas ──
    for (const idxStr of Object.keys(berkas)) {
      const idx = Number(idxStr);
      if (!KOLOM_BERKAS[idx]) continue;
      const berkasObj = berkas[idxStr];
      if (!berkasObj || !berkasObj.dataBase64) continue;

      const blob = blobDariBerkas_(berkasObj);
      if (!blob) continue;

      const labelBerkas = KOLOM_BERKAS[idx];

      // Pakai folder pendaftar yang sudah tersimpan (kolom 31). Kalau kosong (data lama), buat baru.
      const folderIdTersimpan = (rowLama[30] || "").toString().trim();
      let folderPendaftar;
      try {
        folderPendaftar = folderIdTersimpan
          ? DriveApp.getFolderById(folderIdTersimpan)
          : dapatkanFolderPendaftar_(kecamatanSheet, layananSheet, (rowLama[1] || "").toString(), (rowLama[2] || "").toString());
      } catch (eFolder) {
        folderPendaftar = dapatkanFolderPendaftar_(kecamatanSheet, layananSheet, (rowLama[1] || "").toString(), (rowLama[2] || "").toString());
      }
      if (!folderIdTersimpan) {
        sheet.getRange(baris, 31).setValue(folderPendaftar.getId());
      }

      const linkBaru = uploadBerkasPenerima_(blob, folderPendaftar, labelBerkas);
      if (!linkBaru) continue;

      const linkLama = (rowLama[idx] || "").toString().trim();
      sheet.getRange(baris, idx + 1).setValue(linkBaru);
      riwayat.push({ kolom: idx, label: labelBerkas, sebelum: linkLama ? "[link lama]" : "-", sesudah: "[link baru]" });
    }

    SpreadsheetApp.flush();

    // ── Catat riwayat ke db_riwayat_edit ──
    if (riwayat.length > 0) {
      catatRiwayatEdit_(ss, baris, rowLama, riwayat, sesi);
    }

    return { sukses: true, pesan: "Data berhasil diperbarui (" + riwayat.length + " kolom diubah)." };
  } catch (e) {
    return { sukses: false, pesan: "Gagal mengedit data: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function verifikasiSatuData(token, nomorBarisAsli, statusBaru, keterangan, batasWaktu, statusSebelumnyaDiharapkan) {
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  const baris = Number(nomorBarisAsli);
  if (!baris || baris < 2) return { sukses: false, pesan: "Nomor baris tidak valid." };

  const statusValid = ["Tidak Memenuhi Syarat", "Berkas Tidak Lengkap"];
  if (statusValid.indexOf(statusBaru) === -1) return { sukses: false, pesan: "Status tidak valid." };

  const keteranganBersih = (keterangan || "").toString().trim();
  if (!keteranganBersih) return { sukses: false, pesan: "Keterangan hasil verifikasi wajib diisi." };

  let batasWaktuBersih = "";
  if (statusBaru === "Berkas Tidak Lengkap") {
    batasWaktuBersih = (batasWaktu || "").toString().trim();
    if (!batasWaktuBersih) return { sukses: false, pesan: "Batas waktu perbaikan wajib diisi untuk status Berkas Tidak Lengkap." };
  }

  // INTEGRITAS DATA: sebelumnya tidak ada LockService maupun pengecekan status sebelum menimpa —
  // kalau dua admin UTAMA membuka baris yang sama nyaris bersamaan, verifikasi terakhir yang
  // tersimpan akan menimpa yang pertama tanpa peringatan apa pun. Sekarang dikunci + status
  // TERKINI di sheet dibandingkan dengan status yang terakhir dimuat di layar admin (dikirim
  // front-end sebagai statusSebelumnyaDiharapkan); kalau sudah berubah, tolak dan minta muat ulang.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { sukses: false, pesan: "Server sedang sibuk, coba lagi sebentar lagi." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || baris > sheet.getLastRow()) return { sukses: false, pesan: "Baris tidak ditemukan." };

    const statusSaatIni = (sheet.getRange(baris, 33).getValue() || "").toString().trim();
    const statusDiharapkan = (statusSebelumnyaDiharapkan || "").toString().trim();
    if (statusDiharapkan && statusSaatIni !== statusDiharapkan) {
      return {
        sukses: false,
        konflik: true,
        statusTerkini: statusSaatIni,
        pesan: "Data ini sudah diverifikasi/diubah oleh admin lain (status terkini: \"" + statusSaatIni + "\"). Muat ulang data sebelum menyimpan lagi."
      };
    }

    const tglSekarang = Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy HH:mm");
    const namaVerifikator = (sesi.username || "UTAMA").toString().toUpperCase();

    // Kolom 33-37 = Status, Keterangan, Tanggal, Diverifikasi Oleh, Batas Waktu Perbaikan
    sheet.getRange(baris, 33, 1, 5).setValues([[
      statusBaru, keteranganBersih, tglSekarang, namaVerifikator, batasWaktuBersih
    ]]);

    return {
      sukses: true, pesan: "Status verifikasi berhasil disimpan.",
      status: statusBaru, keterangan: keteranganBersih,
      tanggal: tglSekarang, verifikator: namaVerifikator, batasWaktu: batasWaktuBersih
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Dipanggil Kecamatan/Kemenag setelah memperbaiki berkas — sekadar penanda "sudah dilaporkan",
// TIDAK mengubah status. Admin Utama tetap yang menentukan lewat tandaiSudahDiperbaiki().
function laporkanPerbaikanBerkas(token, nomorBarisAsli) {
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }

  const baris = Number(nomorBarisAsli);
  if (!baris || baris < 2) return { sukses: false, pesan: "Nomor baris tidak valid." };

  // INTEGRITAS DATA: baca status lalu tulis tanpa LockService berpotensi race condition ringan
  // kalau dua tab/pengguna melapor untuk baris yang sama nyaris bersamaan — dikunci konsisten
  // dengan pola yang sama di verifikasiSatuData/tandaiSudahDiperbaiki.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { sukses: false, pesan: "Server sedang sibuk, coba lagi sebentar lagi." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || baris > sheet.getLastRow()) return { sukses: false, pesan: "Baris tidak ditemukan." };

    // KEAMANAN (IDOR): sebelumnya fungsi ini hanya mensyaratkan sesi valid (login apa pun) tanpa
    // mencocokkan kepemilikan baris — akun kecamatan/kemenag mana pun bisa menandai baris milik
    // kecamatan/layanan lain sebagai "sudah dilaporkan diperbaiki". Cek kepemilikan memakai pola
    // yang sama persis dengan editDataPenerima/ambilDetailPenerimaPerBaris.
    const rowCek = sheet.getRange(baris, 1, 1, 11).getValues()[0];
    const listLayananKemenag = daftarLayananKemenagUpper_();
    const layananSheet = (rowCek[7] || "").toString().trim().toUpperCase();
    const kecamatanSheet = (rowCek[10] || "").toString().trim().toUpperCase();
    const role = sesi.role;
    const kecPengguna = (sesi.kecamatan || "").toUpperCase();

    let bolehLapor = false;
    if (role === "UTAMA") {
      bolehLapor = true;
    } else if (role === "KECAMATAN") {
      bolehLapor = (kecamatanSheet === kecPengguna && listLayananKemenag.indexOf(layananSheet) === -1);
    } else if (listLayananKemenag.indexOf(role) !== -1) {
      bolehLapor = (layananSheet === role) && (kecPengguna ? kecamatanSheet === kecPengguna : true);
    }
    if (!bolehLapor) return { sukses: false, pesan: "Anda tidak berhak melapor untuk data ini." };

    const statusSaatIni = (sheet.getRange(baris, 33).getValue() || "").toString().trim();
    if (statusSaatIni !== "Berkas Tidak Lengkap") {
      return { sukses: false, pesan: "Data ini bukan berstatus Berkas Tidak Lengkap." };
    }

    const tglSekarang = Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy HH:mm");
    const namaPelapor = (sesi.username || "").toString().toUpperCase();

    // Kolom 39-40 = Tanggal Lapor Perbaikan, Dilapor Oleh
    sheet.getRange(baris, 39, 1, 2).setValues([[tglSekarang, namaPelapor]]);

    return { sukses: true, tanggalLapor: tglSekarang, dilaporOleh: namaPelapor };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Dipanggil Admin Utama setelah mengecek berkas benar-benar sudah diperbaiki.
function tandaiSudahDiperbaiki(token, nomorBarisAsli) {
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  const baris = Number(nomorBarisAsli);
  if (!baris || baris < 2) return { sukses: false, pesan: "Nomor baris tidak valid." };

  // INTEGRITAS DATA: sebelumnya tidak ada LockService maupun pengecekan status sebelum menimpa —
  // dua admin UTAMA bisa saling menimpa hasil tanpa peringatan. Sekarang dikunci + wajib status
  // TERKINI di sheet masih "Berkas Tidak Lengkap" (sesuai maksud fungsi ini, lihat komentar di atas)
  // sebelum direset ke "Memenuhi Syarat".
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { sukses: false, pesan: "Server sedang sibuk, coba lagi sebentar lagi." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || baris > sheet.getLastRow()) return { sukses: false, pesan: "Baris tidak ditemukan." };

    const statusSaatIni = (sheet.getRange(baris, 33).getValue() || "").toString().trim();
    if (statusSaatIni !== "Berkas Tidak Lengkap") {
      return {
        sukses: false,
        konflik: true,
        statusTerkini: statusSaatIni,
        pesan: "Data ini sudah diubah oleh admin lain (status terkini: \"" + statusSaatIni + "\"). Muat ulang data sebelum menyimpan lagi."
      };
    }

    const tglSekarang = Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy HH:mm");
    const namaVerifikator = (sesi.username || "UTAMA").toString().toUpperCase();

    // Kolom 33-37: Status, Keterangan, Tanggal, Diverifikasi Oleh, Batas Waktu -> reset ke Memenuhi Syarat
    sheet.getRange(baris, 33, 1, 5).setValues([[
      "Memenuhi Syarat", "", tglSekarang, namaVerifikator, ""
    ]]);
    // Kolom 39-40: bersihkan juga penanda laporan perbaikan
    sheet.getRange(baris, 39, 1, 2).setValues([["", ""]]);

    return { sukses: true, status: "Memenuhi Syarat", tanggal: tglSekarang, verifikator: namaVerifikator };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function verifikasiMassalMemenuhiSyarat(token) {
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || sheet.getLastRow() < 2) return { sukses: true, jumlah: 0 };

    const lastRow = sheet.getLastRow();
    const KOL_STATUS = 33, JUMLAH_KOLOM = 5;
    const data = sheet.getRange(2, KOL_STATUS, lastRow - 1, JUMLAH_KOLOM).getValues();

    const tglSekarang = Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy HH:mm");
    const namaVerifikator = (sesi.username || "UTAMA").toString().toUpperCase();

    let jumlahDiubah = 0;
    for (let i = 0; i < data.length; i++) {
      const statusSaatIni = (data[i][0] || "").toString().trim();
      // Hanya ubah yang MASIH "Proses Verifikasi" (default). Status lain (termasuk Berkas Tidak Lengkap) TIDAK disentuh.
      if (statusSaatIni === "" || statusSaatIni.toUpperCase() === "PROSES VERIFIKASI") {
        data[i][0] = "Memenuhi Syarat";
        data[i][1] = "";
        data[i][2] = tglSekarang;
        data[i][3] = namaVerifikator;
        data[i][4] = "";
        jumlahDiubah++;
      }
    }

    if (jumlahDiubah > 0) {
      sheet.getRange(2, KOL_STATUS, lastRow - 1, JUMLAH_KOLOM).setValues(data);
      SpreadsheetApp.flush();
    }

    return { sukses: true, jumlah: jumlahDiubah };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getDaftarBerkasTidakLengkapUntukWA(token) {
  let sesi;
  try { sesi = wajibSesi_(token); } catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
    const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheet || sheet.getLastRow() < 2) return { sukses: true, data: [] };

    const lastRow = sheet.getLastRow();
    const dataNama = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    const dataNik = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    const dataLayanan = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
    const dataKecamatan = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
    const dataKelurahan = sheet.getRange(2, 12, lastRow - 1, 1).getValues();
    const dataVerif = sheet.getRange(2, 33, lastRow - 1, 5).getValues(); // Status,Keterangan,Tanggal,Oleh,BatasWaktu

    const hasil = [];
    for (let i = 0; i < dataVerif.length; i++) {
      const status = (dataVerif[i][0] || "").toString().trim();
      if (status !== "Berkas Tidak Lengkap") continue;
      hasil.push({
        nama: (dataNama[i][0] || "").toString().trim(),
        nik: (dataNik[i][0] || "").toString().replace(/'/g, "").trim(),
        layanan: (dataLayanan[i][0] || "").toString().trim(),
        kecamatan: (dataKecamatan[i][0] || "").toString().trim(),
        kelurahan: (dataKelurahan[i][0] || "").toString().trim(),
        keterangan: (dataVerif[i][1] || "").toString().trim(),
        batasWaktu: dataVerif[i][4] ? Utilities.formatDate(new Date(dataVerif[i][4]), "GMT+7", "yyyy-MM-dd") : ""
      });
    }

    return { sukses: true, data: hasil };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

/**
 * Jalankan sekali secara manual dari editor Apps Script untuk memasang trigger harian.
 * Setelah dijalankan sekali, sistem otomatis mengecek batas waktu setiap hari jam 01:00 WIB.
 */
function pasangTriggerCekBatasWaktu() {
  // Hapus trigger lama dengan nama fungsi yang sama (mencegah dobel kalau dijalankan berkali-kali)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "cekBatasWaktuVerifikasi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cekBatasWaktuVerifikasi")
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .inTimezone("Asia/Jakarta")
    .create();
  Logger.log("Trigger harian cekBatasWaktuVerifikasi berhasil dipasang.");
}

// Dipanggil otomatis oleh trigger harian — cari data "Berkas Tidak Lengkap" yang sudah lewat
// batas waktu perbaikannya dan belum diperbaiki, lalu ubah otomatis jadi "Tidak Memenuhi Syarat".
function cekBatasWaktuVerifikasi() {
  const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);
  const sheet = ss.getSheetByName(NAMA_SHEET_INPUT);
  if (!sheet || sheet.getLastRow() < 2) return;

  const lastRow = sheet.getLastRow();
  const KOL_STATUS = 33, JUMLAH_KOLOM = 5;
  const data = sheet.getRange(2, KOL_STATUS, lastRow - 1, JUMLAH_KOLOM).getValues();

  const hariIni = new Date();
  hariIni.setHours(0, 0, 0, 0);

  let jumlahBerubah = 0;
  for (let i = 0; i < data.length; i++) {
    const status = (data[i][0] || "").toString().trim();
    const batasWaktuVal = data[i][4];
    if (status === "Berkas Tidak Lengkap" && batasWaktuVal) {
      const batasWaktu = new Date(batasWaktuVal);
      batasWaktu.setHours(0, 0, 0, 0);
      if (!isNaN(batasWaktu.getTime()) && batasWaktu < hariIni) {
        data[i][0] = "Tidak Memenuhi Syarat";
        data[i][1] = "Otomatis diubah sistem: batas waktu perbaikan berkas (" +
          Utilities.formatDate(batasWaktu, "GMT+7", "dd-MM-yyyy") + ") telah lewat tanpa perbaikan.";
        data[i][2] = Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy HH:mm");
        data[i][3] = "SISTEM (OTOMATIS)";
        data[i][4] = "";
        jumlahBerubah++;
      }
    }
  }

  if (jumlahBerubah > 0) {
    sheet.getRange(2, KOL_STATUS, lastRow - 1, JUMLAH_KOLOM).setValues(data);
    SpreadsheetApp.flush();
  }
  Logger.log(jumlahBerubah + " data diubah otomatis karena lewat batas waktu.");
}

function labelKolom_(idx) {
  const MAP = {
    1:"Nama Lengkap",2:"NIK",3:"Jenis Kelamin",4:"Tempat Lahir",
    5:"Tanggal Lahir",6:"Alamat Domisili",8:"Tempat Tugas",9:"Alamat Tugas",
    11:"Kelurahan",12:"Nama Rekening",13:"Nomor Rekening",
    14:"Kantor Cabang",15:"No. Kontak",16:"Status BPJS"
  };
  return MAP[idx] || "Kolom " + idx;
}

function hitungUmur_(tglStr) {
  try {
    const parts = tglStr.split(/[-/]/);
    if (parts.length < 3) return null;
    // Format DD-MM-YYYY atau YYYY-MM-DD
    let d, m, y;
    if (parts[0].length === 4) { y=Number(parts[0]); m=Number(parts[1]); d=Number(parts[2]); }
    else { d=Number(parts[0]); m=Number(parts[1]); y=Number(parts[2]); }
    const lahir = new Date(y, m-1, d);
    const sekarang = new Date("2027-01-01");
    let umur = sekarang.getFullYear() - lahir.getFullYear();
    const selisihBulan = sekarang.getMonth() - lahir.getMonth();
    if (selisihBulan < 0 || (selisihBulan === 0 && sekarang.getDate() < lahir.getDate())) umur--;
    return umur >= 0 ? umur : null;
  } catch(e) { return null; }
}

function catatRiwayatEdit_(ss, nomorBaris, rowLama, riwayat, sesi) {
  try {
    let sheet = ss.getSheetByName("db_riwayat_edit");
    if (!sheet) {
      sheet = ss.insertSheet("db_riwayat_edit");
      sheet.appendRow(["Waktu","Editor","Role","No.Baris","Nama Penerima","Kolom Diubah","Sebelum","Sesudah"]);
      sheet.getRange(1,1,1,8).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
    const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    const namaPenerima = (rowLama[1] || "").toString().trim();
    for (const r of riwayat) {
      sheet.appendRow([waktu, sesi.username, sesi.role, nomorBaris, namaPenerima, r.label, r.sebelum, r.sesudah]);
    }
  } catch(e) {
    Logger.log("Gagal catat riwayat edit: " + e.toString());
  }
}

// Ambil riwayat edit untuk satu baris (ditampilkan di modal)
function ambilRiwayatEdit(token, nomorBarisAsli) {
  try {
    const sesi = wajibSesi_(token);

    const baris = Number(nomorBarisAsli);
    if (!baris || baris < 2) return { sukses: false, riwayat: [], pesan: "Nomor baris tidak valid." };

    const ss = SpreadsheetApp.openById(SS_ID_PENYIMPANAN);

    // KEAMANAN (IDOR): sebelumnya fungsi ini hanya mensyaratkan sesi valid (login apa pun)
    // tanpa mencocokkan kepemilikan baris — akun kecamatan/kemenag mana pun bisa mengintip
    // riwayat edit (termasuk NIK/rekening/no.kontak "sebelum"/"sesudah") milik kecamatan/
    // layanan lain hanya dengan menebak nomor baris berurutan. Cek kepemilikan di bawah ini
    // memakai pola yang sama persis dengan ambilDetailPenerimaPerBaris.
    const sheetData = ss.getSheetByName(NAMA_SHEET_INPUT);
    if (!sheetData || baris > sheetData.getLastRow()) {
      return { sukses: false, riwayat: [], pesan: "Baris tidak ditemukan." };
    }
    const rowData = sheetData.getRange(baris, 1, 1, 11).getValues()[0];
    const listLayananKemenag = daftarLayananKemenagUpper_();
    const layananSheet = rowData[7] ? rowData[7].toString().trim().toUpperCase() : "";
    const kecamatanSheet = rowData[10] ? rowData[10].toString().trim().toUpperCase() : "";
    const role = sesi.role;
    const kecPengguna = (sesi.kecamatan || "").toUpperCase();

    let boleh = false;
    if (role === "UTAMA") {
      boleh = true;
    } else if (role === "KECAMATAN") {
      boleh = (kecamatanSheet === kecPengguna && listLayananKemenag.indexOf(layananSheet) === -1);
    } else if (listLayananKemenag.indexOf(role) !== -1) {
      if (layananSheet === role) {
        boleh = kecPengguna ? (kecamatanSheet === kecPengguna) : true;
      }
    }
    if (!boleh) return { sukses: false, riwayat: [], pesan: "Anda tidak berhak melihat riwayat data ini." };

    const sheet = ss.getSheetByName("db_riwayat_edit");
    if (!sheet || sheet.getLastRow() < 2) return { sukses: true, riwayat: [] };
    const data = sheet.getDataRange().getValues();
    const hasil = [];
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][3]) === baris) {
        hasil.push({ waktu: data[i][0], editor: data[i][1], role: data[i][2], kolom: data[i][5], sebelum: data[i][6], sesudah: data[i][7] });
      }
    }
    return { sukses: true, riwayat: hasil };
  } catch(e) {
    return { sukses: false, riwayat: [] };
  }
}

// =========================================================================
// MULTI-TAHUN — Scan sheet db_XXXX dan ambil data sesuai tahun & hak akses
// Semua sheet db_XXXX di master dropdown harus berstruktur sama:
//  A=Nama  B=NIK  C=JK  D=TmptLahir  E=TglLahir  F=Alamat
//  G=Layanan  H=TempatTugas  I=AlamatTugas  J=Kecamatan  K=Kelurahan
//  L=NamaRek  M=NoRek  N=KantorCabang  O=NoKontak  P=BPJS  Q=Umur  R=Status
// (baris 1 = header, data mulai baris 2)
// =========================================================================

// Kembalikan daftar tahun yang tersedia berdasarkan sheet db_XXXX di master
function ambilTahunTersedia(token) {
  try {
    wajibSesi_(token);
    var ss     = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    var sheets = ss.getSheets();
    var tahun  = [];
    sheets.forEach(function(sh) {
      var nama = sh.getName();
      if (/^db_\d{4}$/.test(nama)) {
        tahun.push(nama.replace('db_', ''));
      }
    });
    tahun.sort(function(a, b) { return Number(b) - Number(a); }); // terbaru di atas
    return { sukses: true, tahun: tahun };
  } catch(e) {
    return { sukses: false, tahun: [] };
  }
}

// Ambil data dari sheet db_XXXX sesuai tahun dan hak akses user
// Kolom (1-based): A=1=Nama, B=2=NIK, G=7=Layanan, J=10=Kecamatan, K=11=Kelurahan, R=18=Status
function ambilDataTahunHakAkses(token, tahun) {
  var sesi;
  try { sesi = wajibSesi_(token); }
  catch(e) { return JSON.stringify({ sukses: false, pesan: e.message }); }

  try {
    var tahunStr = tahun.toString().trim();
    if (!/^\d{4}$/.test(tahunStr))
      return JSON.stringify({ sukses: false, pesan: "Format tahun tidak valid." });

    var ss    = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    var sheet = ss.getSheetByName("db_" + tahunStr);
    if (!sheet || sheet.getLastRow() < 2)
      return JSON.stringify({ sukses: true, rows: [], tahun: tahunStr });

    var role        = sesi.role;
    var kecPengguna = (sesi.kecamatan || "").toString().trim().toUpperCase();
    var listKemenag = daftarLayananKemenagUpper_();
    var lastRow     = sheet.getLastRow();

    // KEAMANAN: sebelumnya endpoint data tahun sebelumnya ini TIDAK menerapkan pembatasan
    // kelurahan-terkunci maupun sub-filter GSM Katolik/Kristen yang sudah diterapkan dengan benar
    // di ambilDataLihatDataHakAkses (data tahun berjalan) — akun yang harusnya hanya boleh lihat
    // satu kelurahan/sub-kelompok bisa melihat seluruh kecamatan/gabungan Katolik+Kristen untuk
    // data tahun-tahun sebelumnya. Diterapkan pola yang identik di sini.
    var userIdSesi = (sesi.userId || "").toString().toUpperCase().trim();
    var kelurahanTerkunci = userIdSesi.indexOf("KELURAHAN ") === 0
      ? userIdSesi.substring("KELURAHAN ".length).trim()
      : "";
    var subFilterGsm = userIdSesi === "BIMAS KATOLIK" ? "KATOLIK"
                      : userIdSesi === "BIMAS KRISTEN" ? "BUKAN_KATOLIK"
                      : "";

    // Kolom db_XXXX (0-based):
    // A=0(kosong) B=1=Nama C=2=NIK ... H=7=Layanan ... K=10=Kecamatan L=11=Kelurahan ... S=18=Status
    var data = sheet.getRange(2, 1, lastRow - 1, 19).getValues();

    var rows = [];
    for (var i = 0; i < data.length; i++) {
      var r       = data[i];
      var nama    = (r[1]  || "").toString().trim();  // kolom B
      var nik     = (r[2]  || "").toString().trim();  // kolom C
      var layanan = (r[7]  || "").toString().trim().toUpperCase(); // kolom H
      var kec     = (r[10] || "").toString().trim().toUpperCase(); // kolom K
      var kel     = (r[11] || "").toString().trim().toUpperCase(); // kolom L
      var status  = (r[18] || "").toString().trim().toUpperCase(); // kolom S

      if (!nama && !nik) continue; // skip baris kosong

      var lolos = false;
      if (role === "UTAMA") {
        lolos = true;
      } else if (role === "KECAMATAN") {
        lolos = (kec === kecPengguna && listKemenag.indexOf(layanan) === -1);
      } else if (listKemenag.indexOf(role) !== -1) {
        lolos = (layanan === role.toUpperCase()) &&
                (!kecPengguna || kec === kecPengguna);
      }

      // Lapis tambahan: akun terikat 1 kelurahan spesifik wajib cocok juga kelurahannya.
      if (lolos && kelurahanTerkunci) {
        lolos = (kel === kelurahanTerkunci);
      }
      // Lapis tambahan: khusus GSM, pisah berdasarkan kata "KATOLIK" di Tempat Tugas (kolom I = idx 8).
      if (lolos && subFilterGsm) {
        var tempatTugasSheet = (r[8] || "").toString().trim().toUpperCase();
        if (subFilterGsm === "KATOLIK") {
          lolos = tempatTugasSheet.indexOf("KATOLIK") !== -1;
        } else if (subFilterGsm === "BUKAN_KATOLIK") {
          lolos = tempatTugasSheet.indexOf("KATOLIK") === -1;
        }
      }

      if (lolos) rows.push([nama, nik, layanan, kec, kel, status]);
    }

    return JSON.stringify({ sukses: true, rows: rows, tahun: tahunStr });
  } catch(e) {
    return JSON.stringify({ sukses: false, pesan: e.toString() });
  }
}

// =========================================================================
// CEK DOMISILI DARI db_capil
// =========================================================================
// db_capil kolom (1-based):
//   A=NAMA  B=NIK  C=JK  D=TMPT LAHIR  E=TGL LAHIR  F=ALAMAT
//   G=KECAMATAN  H=KELURAHAN  I=STATUS
//   J=KAB/KOTA SIAK_ALAMAT DOMISILI  K=DASAR_KAB/KOTA DOMISILI
//
// Semantik: jika NIK DITEMUKAN di db_capil berarti orangnya berdomisili di
// luar Kota Medan → tolak. Jika TIDAK ditemukan, dianggap warga Kota Medan.
function cekDomisiliCapil_(token, nik) {
  try {
    // KEAMANAN: fungsi ini membocorkan nama+alamat domisili+status seseorang berdasarkan NIK.
    // Sebelumnya tidak menerima/mengecek token sama sekali — karena ini fungsi top-level, Apps
    // Script tetap mengeksposnya ke google.script.run dari browser terlepas dari akhiran "_",
    // sehingga bisa dipanggil langsung tanpa login untuk mengintip data warga per NIK. Sesi wajib
    // divalidasi dulu; kalau tidak sah, kembalikan hasil "tidak ditemukan" (bentuk yang sama
    // dipakai untuk kegagalan baca sheet di bawah) supaya tidak ada data yang bocor maupun error
    // yang mengganggu alur validasi form bagi pemanggil yang sah.
    try { wajibSesi_(token); } catch (eSesi) { return { ditemukan: false }; }

    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_capil");
    if (!sheet || sheet.getLastRow() < 2) {
      // Sheet belum ada / kosong → tidak memblokir.
      return { ditemukan: false };
    }

    const nikTarget = nik.toString().trim();
    // Ambil kolom A-K sekaligus (11 kolom) untuk efisiensi.
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();

    for (let i = 0; i < data.length; i++) {
      const nikSheet = (data[i][1] || "").toString().trim(); // kolom B
      if (nikSheet === nikTarget) {
        return {
          ditemukan: true,
          nama: (data[i][0] || "").toString().trim(),                // A
          nik: nikTarget,                                             // B
          status: (data[i][8] || "").toString().trim(),               // I = STATUS
          alamatDomisili: (data[i][9] || "").toString().trim(),      // J
          kabKotaDomisili: (data[i][10] || "").toString().trim()     // K
        };
      }
    }
    return { ditemukan: false };
  } catch (e) {
    Logger.log("cekDomisiliCapil_ error: " + e.toString());
    // Jika error, JANGAN blokir input — biarkan lanjut agar tidak menghentikan
    // seluruh sistem hanya karena masalah baca sheet capil.
    return { ditemukan: false };
  }
}

// Update cekStatus2026_ → cekStatusTahunLalu_ (cek dari semua sheet db_XXXX kecuali tahun aktif)
function cekStatusTahunLalu_(token, nik) {
  try {
    // KEAMANAN: sama seperti cekDomisiliCapil_ — fungsi ini membocorkan nama+status+layanan
    // seseorang di tahun-tahun sebelumnya berdasarkan NIK, dan sebelumnya bisa dipanggil langsung
    // tanpa login. Wajib sesi sah dulu; kalau tidak, kembalikan "tidak ditemukan" (aman, konsisten
    // dengan fallback error lain di fungsi ini).
    try { wajibSesi_(token); } catch (eSesi) { return { ditemukan: false }; }

    var ssMaster  = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    var sheets    = ssMaster.getSheets();
    // Tahun input aktif diambil dari konstanta NAMA_SHEET_INPUT agar otomatis
    // menyesuaikan saat pergantian tahun (misal "Data Input 2028" → "2028").
    var tahunAktif = NAMA_SHEET_INPUT.replace("Data Input ", "").trim();

    var sheetDb = sheets
      .filter(function(sh) { return /^db_\d{4}$/.test(sh.getName()); })
      .sort(function(a, b) { return Number(b.getName().slice(3)) - Number(a.getName().slice(3)); });

    var nikTarget = nik.toString().trim();

    for (var s = 0; s < sheetDb.length; s++) {
      var sh  = sheetDb[s];
      var thn = sh.getName().slice(3);
      if (thn === tahunAktif) continue;

      var lastRow = sh.getLastRow();
      if (lastRow < 2) continue;

      // Ambil semua data sekaligus untuk menghindari multiple getRange calls
      // Kolom A(1) s/d S(19) — 19 kolom
      try {
        var semuaData = sh.getRange(2, 1, lastRow - 1, 19).getValues();
        for (var i = 0; i < semuaData.length; i++) {
          var r = semuaData[i];
          // NIK kolom C = indeks 2 (0-based)
          var nikSheet = (r[2] || "").toString().trim();
          if (nikSheet === nikTarget) {
            var status  = (r[18] || "").toString().trim().toUpperCase(); // kolom S
            var nama    = (r[1]  || "").toString().trim();               // kolom B
            var layanan = (r[7]  || "").toString().trim().toUpperCase(); // kolom H
            Logger.log("cekStatusTahunLalu_: NIK ditemukan di " + sh.getName() + " status=" + status);
            return {
              ditemukan : true,
              status    : status,
              aktif     : status === "AKTIF",
              nama      : nama,
              layanan   : layanan,
              tahun     : thn
            };
          }
        }
      } catch(eInner) {
        // Sheet mungkin masih loading IMPORTRANGE — catat dan lanjut ke sheet berikutnya
        Logger.log("cekStatusTahunLalu_ skip " + sh.getName() + ": " + eInner.toString());
        continue;
      }
    }
    return { ditemukan: false };
  } catch(e) {
    Logger.log("cekStatusTahunLalu_ error: " + e.toString());
    return { ditemukan: false };
  }
}

// =========================================================================
// VERSION CHECK — deteksi pembaruan aplikasi
// =========================================================================
// Cara pakai: setiap kali deploy versi baru, jalankan setVersiAplikasi()
// sekali dari editor Apps Script, atau ubah langsung nilai di
// PropertiesService > Script Properties > VERSI_APLIKASI

function setVersiAplikasi() {
  // Jalankan fungsi ini sekali dari editor setiap kali deploy versi baru.
  // KEAMANAN: fungsi ini top-level sehingga tetap bisa dipanggil siapa pun dari browser tanpa
  // login (juga dipakai sebagai fallback oleh getVersiAplikasi() saat property belum pernah
  // diisi, sehingga tidak bisa disyaratkan token di sini tanpa merusak alur itu). Untuk membatasi
  // potensi disalahgunakan memicu modal "update paksa" ke semua user berulang-ulang, perubahan
  // nilai dibatasi maksimal sekali per 5 menit — cukup longgar untuk pemakaian deploy normal.
  const props = PropertiesService.getScriptProperties();
  const terakhirDiubah = Number(props.getProperty('VERSI_APLIKASI_TS') || 0);
  const sekarang = Date.now();
  if (sekarang - terakhirDiubah < 5 * 60 * 1000) {
    return props.getProperty('VERSI_APLIKASI') || sekarang.toString();
  }
  const versi = sekarang.toString(); // timestamp unik otomatis
  props.setProperty('VERSI_APLIKASI', versi);
  props.setProperty('VERSI_APLIKASI_TS', versi);
  Logger.log('Versi baru: ' + versi);
  return versi;
}

function getVersiAplikasi() {
  const versi = PropertiesService.getScriptProperties().getProperty('VERSI_APLIKASI');
  if (!versi) {
    // Belum pernah diset → set sekarang
    return setVersiAplikasi();
  }
  return versi;
}

// =========================================================================
// SAKELAR AKSES PER USER
// =========================================================================
// Sistem sakelar granular per user (berdasarkan User ID di db_admin kolom H).
// Exception-based: hanya user dengan sakelar berbeda dari master yang disimpan
// di db_setelan. Kalau tidak ada entry, user mengikuti master switch.
//
// Format key: INPUT_USER_[USER_ID]
// Contoh: INPUT_USER_KELURAHAN HARJOSARI II = BUKA
//         INPUT_USER_GMM MEDAN AMPLAS = TUTUP
//
// User ID adalah identifier stabil yang TIDAK berubah meski username diubah.

const PREFIX_SAKELAR_USER = "INPUT_USER_";
const KOLOM_USER_ID_DB_ADMIN = 8; // Kolom H (1-based)

// Nama kolom User ID di sheet db_admin. Jalankan setHeaderUserId() sekali
// untuk memastikan judul kolom H = "USER_ID".
function setHeaderUserId() {
  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet) return { sukses: false, pesan: "Sheet db_admin tidak ditemukan." };
    const currentHeader = sheet.getRange(1, KOLOM_USER_ID_DB_ADMIN).getValue();
    if (currentHeader === "USER_ID") {
      return { sukses: true, pesan: "Header sudah USER_ID." };
    }
    sheet.getRange(1, KOLOM_USER_ID_DB_ADMIN).setValue("USER_ID");
    SpreadsheetApp.flush();
    return { sukses: true, pesan: "Header kolom H disetel jadi USER_ID." };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// Ambil User ID (kolom H) dari sebuah username.
// Return string kosong "" kalau username tidak ditemukan atau User ID kosong.
function ambilUserIdDariUsername_(token, username) {
  // KEAMANAN: sebelumnya tidak mensyaratkan sesi sama sekali — fungsi ini jadi oracle
  // enumerasi username → User ID internal tanpa login. Saat ini tidak dipanggil dari
  // manapun (dead code), tapi tetap dijaga sebagai defense-in-depth kalau dipakai nanti.
  try { wajibSesi_(token); } catch (e) { return ""; }
  try {
    if (!username) return "";
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) return "";

    const targetUsername = username.toString().trim();
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, KOLOM_USER_ID_DB_ADMIN).getValues();
    for (let i = 0; i < data.length; i++) {
      const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
      if (usernameSheet === targetUsername) {
        return data[i][KOLOM_USER_ID_DB_ADMIN - 1]
          ? data[i][KOLOM_USER_ID_DB_ADMIN - 1].toString().trim().toUpperCase()
          : "";
      }
    }
    return "";
  } catch (e) {
    Logger.log("ambilUserIdDariUsername_ error: " + e.toString());
    return "";
  }
}

// Cek apakah user boleh akses input/edit berdasarkan master + sakelar per user.
// Logika:
//   1. Kalau ada sakelar khusus untuk user tsb, PAKAI itu (override master)
//   2. Kalau tidak ada, ikuti master switch
// Return object { ditutup, sumber } — sumber = "KHUSUS" atau "MASTER".
function cekAksesInputUser_(token, userId) {
  // KEAMANAN: sebelumnya tidak mensyaratkan sesi sama sekali — siapa pun (termasuk yang belum
  // login) bisa memanggil langsung untuk mengintip status buka/tutup akses seorang user. Ketiga
  // pemanggil sudah tervalidasi sesi sendiri sebelum sampai ke sini; ini defense-in-depth.
  try { wajibSesi_(token); } catch (e) { return { ditutup: true, sumber: "MASTER", nilai: "" }; }
  try {
    // Cek sakelar khusus untuk user ini
    if (userId) {
      const nilaiKhusus = ambilSetelan_(PREFIX_SAKELAR_USER + userId);
      if (nilaiKhusus === "BUKA") {
        return { ditutup: false, sumber: "KHUSUS", nilai: "BUKA" };
      }
      if (nilaiKhusus === "TUTUP") {
        return { ditutup: true, sumber: "KHUSUS", nilai: "TUTUP" };
      }
    }
    // Tidak ada sakelar khusus → ikuti master
    return {
      ditutup: inputKecKemDitutup_(),
      sumber: "MASTER",
      nilai: inputKecKemDitutup_() ? "TUTUP" : "BUKA"
    };
  } catch (e) {
    Logger.log("cekAksesInputUser_ error: " + e.toString());
    // Kalau error, JANGAN blokir — fallback ke master
    return { ditutup: inputKecKemDitutup_(), sumber: "MASTER", nilai: "" };
  }
}

// Set sakelar khusus untuk seorang user. Nilai: "BUKA" atau "TUTUP".
// Kalau nilai baru sama dengan master saat ini, sakelar khusus DIHAPUS
// (auto-cleanup redundant entries, sesuai Detail 3 Pilihan X).
function setSakelarUser_(token, userId, nilaiBaru) {
  // KEAMANAN: sebelumnya fungsi ini (dan hapusSakelarUser_) tidak mengecek sesi/role sama sekali —
  // proteksi "hanya admin utama" hanya ada di fungsi wrapper (setSakelarUserByAdmin dkk). Karena ini
  // fungsi top-level, Apps Script tetap mengeksposnya ke google.script.run dari browser terlepas dari
  // akhiran "_", sehingga wrapper itu bisa dilewati begitu saja dengan memanggil fungsi ini langsung
  // tanpa login sama sekali. Sesi + role UTAMA sekarang divalidasi di sini juga (defense-in-depth).
  const sesiPelaku = wajibSesi_(token);
  if ((sesiPelaku.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    throw new Error("Hanya admin utama yang boleh mengubah sakelar user.");
  }

  if (!userId) throw new Error("User ID kosong.");
  const nilaiUpper = nilaiBaru.toString().trim().toUpperCase();
  if (nilaiUpper !== "BUKA" && nilaiUpper !== "TUTUP") {
    throw new Error("Nilai harus BUKA atau TUTUP.");
  }

  const masterKetutup = inputKecKemDitutup_();
  const masterNilai = masterKetutup ? "TUTUP" : "BUKA";
  const keyUser = PREFIX_SAKELAR_USER + userId;

  const sheet = pastikanSheetSetelan_();
  const lastRow = sheet.getLastRow();
  const nilaiLama = ambilSetelan_(keyUser); // "BUKA", "TUTUP", atau ""

  // Kalau nilai baru sama dengan master, hapus sakelar khusus (redundant)
  if (nilaiUpper === masterNilai) {
    if (nilaiLama) {
      hapusSakelarUser_(token, userId);
      return { action: "DIHAPUS", nilaiLama: nilaiLama, alasan: "Sama dengan master" };
    }
    return { action: "TIDAK_BERUBAH", nilaiLama: "", alasan: "Sudah default (ikut master)" };
  }

  // Nilai baru berbeda dari master → simpan sebagai exception
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim().toUpperCase() === keyUser.toUpperCase()) {
        sheet.getRange(i + 2, 2).setValue(nilaiUpper);
        return { action: "DIUBAH", nilaiLama: nilaiLama, nilaiBaru: nilaiUpper };
      }
    }
  }
  sheet.appendRow([keyUser, nilaiUpper]);
  return { action: "DITAMBAH", nilaiLama: "", nilaiBaru: nilaiUpper };
}

// Hapus sakelar khusus untuk seorang user (kembali ikuti master).
function hapusSakelarUser_(token, userId) {
  // KEAMANAN: lihat catatan di setSakelarUser_ — proteksi ditegakkan lagi di sini, bukan
  // hanya mengandalkan fungsi wrapper.
  const sesiPelaku = wajibSesi_(token);
  if ((sesiPelaku.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    throw new Error("Hanya admin utama yang boleh mengubah sakelar user.");
  }

  if (!userId) return { action: "TIDAK_ADA_USER_ID" };
  const keyUser = (PREFIX_SAKELAR_USER + userId).toUpperCase();

  const sheet = pastikanSheetSetelan_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { action: "TIDAK_KETEMU" };

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim().toUpperCase() === keyUser) {
      sheet.deleteRow(i + 2);
      return { action: "DIHAPUS" };
    }
  }
  return { action: "TIDAK_KETEMU" };
}

// Dipanggil frontend saat admin utama toggle sakelar untuk user tertentu.
// Otomatis catat riwayat perubahan ke db_riwayat_setelan.
function setSakelarUserByAdmin(token, userId, buka) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah sakelar user." };
  }
  if (!userId) return { sukses: false, pesan: "User ID kosong." };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const nilaiBaru = buka ? "BUKA" : "TUTUP";
    const hasil = setSakelarUser_(token, userId, nilaiBaru);

    // Catat riwayat perubahan
    if (hasil.action === "DITAMBAH" || hasil.action === "DIUBAH" || hasil.action === "DIHAPUS") {
      const nilaiLamaLog = hasil.nilaiLama || "(default)";
      const nilaiBaruLog = hasil.action === "DIHAPUS" ? "(default)" : nilaiBaru;
      catatRiwayatSetelan_(sesi.username, PREFIX_SAKELAR_USER + userId, nilaiLamaLog, nilaiBaruLog);
    }

    SpreadsheetApp.flush();
    return {
      sukses: true,
      action: hasil.action,
      pesan: hasil.action === "TIDAK_BERUBAH"
        ? "Sakelar tidak berubah: " + hasil.alasan
        : "Sakelar user berhasil diubah."
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Hapus sakelar khusus (kembali ikuti master) — dipanggil frontend.
function resetSakelarUserByAdmin(token, userId) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah sakelar user." };
  }
  if (!userId) return { sukses: false, pesan: "User ID kosong." };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const nilaiLama = ambilSetelan_(PREFIX_SAKELAR_USER + userId);
    const hasil = hapusSakelarUser_(token, userId);

    if (hasil.action === "DIHAPUS") {
      catatRiwayatSetelan_(sesi.username, PREFIX_SAKELAR_USER + userId, nilaiLama, "(default)");
    }

    SpreadsheetApp.flush();
    return {
      sukses: true,
      pesan: hasil.action === "DIHAPUS"
        ? "Sakelar khusus dihapus. User kembali mengikuti master."
        : "User tidak punya sakelar khusus. Sudah ikut master."
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Ambil daftar semua user dengan info lengkap + status sakelar mereka.
// Dipakai UI "Kelola Akses per User".
// Return: { sukses, daftar: [{username, userId, role, kecamatan, nama, hp, status, sumber}] }
function ambilDaftarUserDenganStatus(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengakses daftar ini." };
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) return { sukses: true, daftar: [] };

    // Ambil semua kolom A-H dari db_admin
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, KOLOM_USER_ID_DB_ADMIN).getValues();

    // Ambil semua sakelar khusus dari db_setelan sekali (efisien)
    const sheetSetelan = pastikanSheetSetelan_();
    const petaSakelarKhusus = {}; // { "USER_ID": "BUKA"/"TUTUP" }
    if (sheetSetelan.getLastRow() >= 2) {
      const dataSetelan = sheetSetelan.getRange(2, 1, sheetSetelan.getLastRow() - 1, 2).getValues();
      for (let i = 0; i < dataSetelan.length; i++) {
        const key = dataSetelan[i][0] ? dataSetelan[i][0].toString().trim().toUpperCase() : "";
        if (key.indexOf(PREFIX_SAKELAR_USER) === 0) {
          const userId = key.substring(PREFIX_SAKELAR_USER.length);
          const nilai = dataSetelan[i][1] ? dataSetelan[i][1].toString().trim().toUpperCase() : "";
          if (nilai === "BUKA" || nilai === "TUTUP") {
            petaSakelarKhusus[userId] = nilai;
          }
        }
      }
    }

    const masterKetutup = inputKecKemDitutup_();
    const daftar = [];

    for (let i = 0; i < data.length; i++) {
      const username = data[i][0] ? data[i][0].toString().trim() : "";
      if (!username) continue;
      const role = data[i][2] ? data[i][2].toString().trim().toUpperCase() : "";
      // Skip admin utama — mereka tidak terkena sakelar
      if (role === "UTAMA") continue;

      const userId = data[i][KOLOM_USER_ID_DB_ADMIN - 1]
        ? data[i][KOLOM_USER_ID_DB_ADMIN - 1].toString().trim().toUpperCase()
        : "";

      // Tentukan status efektif
      let statusEfektif, sumber;
      if (userId && petaSakelarKhusus[userId]) {
        statusEfektif = petaSakelarKhusus[userId];
        sumber = "KHUSUS";
      } else {
        statusEfektif = masterKetutup ? "TUTUP" : "BUKA";
        sumber = "MASTER";
      }

      daftar.push({
        username: username,
        userId: userId,
        role: role,
        kecamatan: data[i][3] ? data[i][3].toString().trim().toUpperCase() : "",
        nama: data[i][4] ? data[i][4].toString().trim() : "",
        hp: data[i][5] ? data[i][5].toString().trim() : "",
        jabatan: data[i][6] ? data[i][6].toString().trim() : "",
        status: statusEfektif,
        sumber: sumber
      });
    }

    // Urutkan: user dengan sakelar khusus di atas, sisanya berdasarkan kecamatan lalu username
    daftar.sort(function(a, b) {
      if (a.sumber !== b.sumber) return a.sumber === "KHUSUS" ? -1 : 1;
      if (a.kecamatan !== b.kecamatan) return a.kecamatan.localeCompare(b.kecamatan);
      return a.username.localeCompare(b.username);
    });

    return {
      sukses: true,
      daftar: daftar,
      masterKetutup: masterKetutup,
      jumlahKhusus: Object.keys(petaSakelarKhusus).length
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// Bulk action: buka/tutup/reset semua user di sebuah kecamatan.
// Untuk user tanpa kecamatan (koordinator pusat), pakai kecamatan = "" (string kosong).
// action: "BUKA", "TUTUP", atau "RESET"
function bulkSakelarPerKecamatan(token, namaKecamatan, action) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh melakukan aksi ini." };
  }
  const actionUpper = action.toString().trim().toUpperCase();
  if (["BUKA", "TUTUP", "RESET"].indexOf(actionUpper) === -1) {
    return { sukses: false, pesan: "Action harus BUKA, TUTUP, atau RESET." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    // Ambil semua user di kecamatan tsb
    const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
    const sheet = ss.getSheetByName("db_admin");
    if (!sheet || sheet.getLastRow() < 2) return { sukses: false, pesan: "db_admin kosong." };

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, KOLOM_USER_ID_DB_ADMIN).getValues();
    const kecTarget = namaKecamatan.toString().trim().toUpperCase();
    const listUserId = [];

    for (let i = 0; i < data.length; i++) {
      const role = data[i][2] ? data[i][2].toString().trim().toUpperCase() : "";
      if (role === "UTAMA") continue;
      const kecUser = data[i][3] ? data[i][3].toString().trim().toUpperCase() : "";
      if (kecUser !== kecTarget) continue;
      const userId = data[i][KOLOM_USER_ID_DB_ADMIN - 1]
        ? data[i][KOLOM_USER_ID_DB_ADMIN - 1].toString().trim().toUpperCase()
        : "";
      if (userId) listUserId.push(userId);
    }

    if (listUserId.length === 0) {
      return { sukses: false, pesan: "Tidak ada user di kecamatan tsb." };
    }

    let berhasil = 0;
    for (let j = 0; j < listUserId.length; j++) {
      try {
        if (actionUpper === "RESET") {
          hapusSakelarUser_(token, listUserId[j]);
        } else {
          setSakelarUser_(token, listUserId[j], actionUpper);
        }
        berhasil++;
      } catch (eInner) {
        Logger.log("Bulk gagal untuk " + listUserId[j] + ": " + eInner.toString());
      }
    }

    // Catat riwayat bulk sebagai 1 entry ringkasan
    const labelKec = kecTarget || "(TANPA KECAMATAN)";
    catatRiwayatSetelan_(
      sesi.username,
      "BULK_" + actionUpper + "_" + labelKec,
      "-",
      berhasil + " user"
    );

    SpreadsheetApp.flush();
    return {
      sukses: true,
      jumlah: berhasil,
      pesan: "Bulk " + actionUpper + " berhasil untuk " + berhasil + " user di " + labelKec + "."
    };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Jalankan SEKALI dari editor Apps Script untuk membuat kunci rahasia SSO.
// PENTING (KEAMANAN): fungsi ini SENGAJA tidak mengembalikan (return) kunci ke pemanggil,
// supaya tidak bisa dipanggil lewat google.script.run dari browser untuk membocorkan kunci
// (di Apps Script, SEMUA fungsi top-level otomatis bisa dipanggil client, terlepas dari
// niat "jalankan manual dari editor" — akhiran/komentar bukan proteksi runtime).
// Lihat hasilnya HANYA lewat Executions/Log di editor Apps Script (butuh akses editor project).
// Setelah dijalankan, salin nilai dari Log ke Script Properties app RETUR
// dengan nama Property yang SAMA PERSIS: SSO_SECRET_KEY
function generateDanTampilkanKunciSSO() {
  const props = PropertiesService.getScriptProperties();
  let kunci = props.getProperty('SSO_SECRET_KEY');
  if (!kunci) {
    kunci = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SSO_SECRET_KEY', kunci);
  }
  Logger.log('SALIN KUNCI INI KE APP RETUR (Project Settings > Script Properties, nama: SSO_SECRET_KEY):');
  Logger.log(kunci);
  // TIDAK return kunci — lihat catatan keamanan di atas.
}

// =========================================================================
// SSO KE APLIKASI RETUR 2027 (token bertanda tangan, berlaku 60 detik)
// =========================================================================
function ambilUrlRetur_() {
  const DEFAULT_URL_RETUR = "https://script.google.com/macros/s/AKfycbxc4hH7MWBYYk8RpMmiD_oUT0PdqLxqbL0iOPkTXm4a3BuFQRvUcGgfQqCpbP4Uw2y3Ug/exec";
  return PropertiesService.getScriptProperties().getProperty('SSO_URL_RETUR') || DEFAULT_URL_RETUR;
}

function buatTokenSSORetur(token) {
  let sesi;
  try { sesi = wajibSesi_(token); }
  catch (e) { return { sukses: false, pesan: e.message }; }

  // KEAMANAN: pengambil kunci rahasia SSO SENGAJA dijadikan fungsi LOKAL (nested) di sini,
  // bukan fungsi top-level terpisah (dulu bernama ambilKunciSSO_). Di Apps Script, fungsi
  // top-level apa pun — termasuk yang diberi akhiran "_" — tetap bisa dipanggil langsung
  // dari browser lewat google.script.run tanpa melalui wajibSesi_ di atas. Dengan menaruhnya
  // sebagai fungsi lokal di dalam sini, kunci rahasia HANYA bisa diakses lewat jalur ini,
  // setelah token divalidasi.
  function ambilKunciSSOLokal_() {
    return PropertiesService.getScriptProperties().getProperty('SSO_SECRET_KEY') || "";
  }

  try {
    const kunci = ambilKunciSSOLokal_();
    if (!kunci) return { sukses: false, pesan: "Kunci SSO belum diset. Hubungi developer." };

    // Ambil nama lengkap (kolom E) & jabatan (kolom G) dari db_admin untuk identitas di app Retur.
    let nama = sesi.username || "";
    let jabatan = "";
    try {
      const ss = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN);
      const sheet = ss.getSheetByName("db_admin");
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if ((data[i][0] || "").toString().trim() === sesi.username) {
          nama = data[i][4] ? data[i][4].toString().trim() : nama;
          jabatan = data[i][6] ? data[i][6].toString().trim() : "";
          break;
        }
      }
    } catch (eNama) { /* fallback pakai username, jabatan kosong */ }

    const payload = {
      u: sesi.username || "",
      r: sesi.role || "",
      k: sesi.kecamatan || "",
      n: nama,
      j: jabatan,
      t: Date.now()
    };
    const payloadStr = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
    const sigBytes = Utilities.computeHmacSha256Signature(payloadStr, kunci);
    const sig = sigBytes.map(function(b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    }).join("");

    const ssoToken = payloadStr + "." + sig;
    return { sukses: true, url: ambilUrlRetur_() + "?sso=" + encodeURIComponent(ssoToken) };
  } catch (e) {
    return { sukses: false, pesan: e.toString() };
  }
}

// ------------------------------------------------------------
// [2] simpanUrlRetur_ — JALANKAN SEKALI dari editor (pilih fungsi
//     ini di dropdown atas -> Run) untuk mengisi Script Properties.
//     Kalau nanti URL Retur berubah lagi, ubah nilai di baris
//     ANGKA_URL_BARU di bawah, lalu jalankan fungsi ini lagi -
//     ATAU (lebih cepat) langsung edit lewat Project Settings
//     seperti dijelaskan di atas, tanpa perlu sentuh kode ini.
//
// KEAMANAN: fungsi ini top-level tanpa parameter/token (tidak ada pemanggil dari front-end
// maupun fungsi lain — murni utilitas setup manual), sehingga tetap bisa dipanggil siapa pun
// dari browser lewat google.script.run.simpanUrlRetur_(). Saat ini AMAN karena ANGKA_URL_BARU
// adalah konstanta tetap (memanggilnya berulang hanya menulis ulang nilai yang sama). JANGAN
// pernah mengubah ANGKA_URL_BARU menjadi parameter dinamis — SSO_URL_RETUR dipakai buatTokenSSORetur
// untuk membentuk URL redirect berisi token sesi user; kalau nilainya bisa ditimpa jadi URL
// server pihak lain, token SSO milik user (termasuk admin UTAMA) akan otomatis terkirim ke
// server tersebut saat mereka klik menu "Retur & Kematian".
// ------------------------------------------------------------
function simpanUrlRetur_() {
  const ANGKA_URL_BARU = "https://script.google.com/macros/s/AKfycbxc4hH7MWBYYk8RpMmiD_oUT0PdqLxqbL0iOPkTXm4a3BuFQRvUcGgfQqCpbP4Uw2y3Ug/exec";
  PropertiesService.getScriptProperties().setProperty('SSO_URL_RETUR', ANGKA_URL_BARU);
  Logger.log("URL Retur 2027 berhasil disimpan ke Script Properties:\n" + ANGKA_URL_BARU);
}