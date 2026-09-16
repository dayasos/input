// =========================================================================
// KONFIGURASI MICROSERVICE UPLOAD GOOGLE DRIVE & AUTHENTICATION
// =========================================================================
const SS_ID_MASTER_DROPDOWN = "1wB2xHthdlMzZWG80jkmIPDNkCwtu_9p1zplF8yePGk4";
const FOLDER_ID_INDUK = "19rMR3gd6tQUh-l2JSdBim09EFzwePCg3";
const DURASI_SESI_DETIK = 6 * 60 * 60;

function doGet() {
    return ContentService
        .createTextOutput(JSON.stringify({
            status: "ok",
            pesan: "Microservice Upload Google Drive & Auth untuk Sistem DJPM 2027. (Database menggunakan Supabase)"
        }))
        .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
    try {
        var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
        var request = JSON.parse(raw);

        var EXPECTED_SECRET = "DJPM2027_DEFAULT_SECRET";
        var scriptProperties = PropertiesService.getScriptProperties();
        var secret = scriptProperties.getProperty('GAS_SECRET_TOKEN') || EXPECTED_SECRET;

        if (request._secret !== secret) {
            return ContentService
                .createTextOutput(JSON.stringify({ error: "Akses Ditolak: Kredensial API tidak sah", sukses: false, pesan: "Akses Ditolak" }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        var action = request.action;
        var args = request.args || [];

        var ALLOWED = {
            "loginPengguna": loginPengguna,
            "logoutPengguna": logoutPengguna,
            "pulihkanSesi": pulihkanSesi,
            "uploadSemuaBerkasKeDrive": uploadSemuaBerkasKeDrive
        };

        if (!ALLOWED[action]) {
            return ContentService
                .createTextOutput(JSON.stringify({ error: "Aksi tidak diizinkan di microservice ini: " + action, sukses: false, pesan: "Aksi tidak diizinkan: " + action }))
                .setMimeType(ContentService.MimeType.JSON);
        }

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
// HELPER AUTHENTICATION & SESSIONS
// =========================================================================
function hashString_(teks) {
    const raw = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        String(teks),
        Utilities.Charset.UTF_8
    );
    return raw.map(function (b) {
        const v = (b < 0 ? b + 256 : b).toString(16);
        return v.length === 1 ? "0" + v : v;
    }).join("");
}

function buatSesi_(dataPengguna) {
    const token = Utilities.getUuid() + "-" + Utilities.getUuid();
    const cache = CacheService.getScriptCache();
    cache.put("sesi_" + token, JSON.stringify(dataPengguna), DURASI_SESI_DETIK);
    return token;
}

function ambilSesi_(token) {
    if (!token) return null;
    const cache = CacheService.getScriptCache();
    const data = cache.get("sesi_" + token);
    if (data) {
        try {
            return JSON.parse(data);
        } catch (e) { }
    }

    // Validasi token langsung ke Supabase Edge Function jika tidak ada di CacheService
    try {
        const scriptProperties = PropertiesService.getScriptProperties();
        const EXPECTED_SECRET = "DJPM2027_DEFAULT_SECRET";
        const secret = scriptProperties.getProperty('GAS_SECRET_TOKEN') || EXPECTED_SECRET;
        const supabaseApiUrl = scriptProperties.getProperty('SUPABASE_EDGE_FUNCTION_URL') ||
            "https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api";

        const resp = UrlFetchApp.fetch(supabaseApiUrl, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({
                action: "pulihkanSesi",
                args: [token],
                _secret: secret
            }),
            muteHttpExceptions: true
        });

        if (resp.getResponseCode() === 200) {
            const resJson = JSON.parse(resp.getContentText());
            if (resJson && resJson.result && resJson.result.sukses && resJson.result.role) {
                const dataPengguna = {
                    username: resJson.result.username,
                    role: resJson.result.role,
                    kecamatan: resJson.result.kecamatan,
                    userId: resJson.result.userId || ""
                };
                // Simpan ke cache 1 jam (3600 detik) agar upload berkas berikutnya instan
                cache.put("sesi_" + token, JSON.stringify(dataPengguna), 3600);
                return dataPengguna;
            }
        }
    } catch (errSupabase) {
        // Jika terjadi timeout atau kendala jaringan, biarkan return null
    }

    return null;
}

function wajibSesi_(token) {
    const sesi = ambilSesi_(token);
    if (!sesi || !sesi.role) {
        throw new Error("SESI TIDAK SAH: Silakan login ulang.");
    }
    return sesi;
}

const BATAS_PERCOBAAN_LOGIN = 5;
const JENDELA_KUNCI_LOGIN_DETIK = 15 * 60; // 15 menit

function loginPengguna(username, password) {
    try {
        const usernameInput = String(username || "").trim();
        const cache = CacheService.getScriptCache();
        const kunciPercobaan = "loginfail_" + usernameInput.toUpperCase();

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
            const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
            const passwordSheet = data[i][1] ? data[i][1].toString().trim() : "";
            const roleSheet = data[i][2] ? data[i][2].toString().trim().toUpperCase() : "";
            const kecamatanSheet = data[i][3] ? data[i][3].toString().trim().toUpperCase() : "";
            const namaSheet = data[i][4] ? data[i][4].toString().trim() : "";
            const hpSheet = data[i][5] ? data[i][5].toString().trim() : "";
            const jabatanSheet = data[i][6] ? data[i][6].toString().trim() : "";
            const userIdSheet = data[i][7] ? data[i][7].toString().trim().toUpperCase() : "";

            if (!usernameSheet || !passwordSheet) continue;

            if (usernameSheet.toUpperCase() === usernameInput.toUpperCase() && passwordSheet === passwordHashInput) {
                cache.remove(kunciPercobaan);
                const dataPengguna = {
                    username: usernameSheet,
                    role: roleSheet,
                    kecamatan: kecamatanSheet,
                    userId: userIdSheet
                };
                const token = buatSesi_(dataPengguna);
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
        cache.put(kunciPercobaan, String(percobaanSaatIni + 1), JENDELA_KUNCI_LOGIN_DETIK);
        return { sukses: false, pesan: "Username atau password salah." };
    } catch (e) {
        return { sukses: false, pesan: "Error sistem: " + e.toString() };
    }
}

function logoutPengguna(token) {
    try {
        if (!token) return { sukses: true };
        const cache = CacheService.getScriptCache();
        cache.remove("sesi_" + token);
        return { sukses: true, pesan: "Sesi berhasil dihapus." };
    } catch (e) {
        return { sukses: false, error: e.toString() };
    }
}

function pulihkanSesi(token) {
    const sesi = ambilSesi_(token);
    if (!sesi || !sesi.role) {
        return { sukses: false, pesan: "Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang." };
    }

    let namaSheet = "", hpSheet = "", jabatanSheet = "";
    try {
        const sheet = SpreadsheetApp.openById(SS_ID_MASTER_DROPDOWN).getSheetByName("db_admin");
        if (sheet && sheet.getLastRow() >= 2) {
            const data = sheet.getDataRange().getValues();
            const usernameTarget = (sesi.username || "").toString().trim().toUpperCase();
            for (let i = 1; i < data.length; i++) {
                const usernameSheet = data[i][0] ? data[i][0].toString().trim() : "";
                if (usernameSheet.toUpperCase() === usernameTarget) {
                    namaSheet = data[i][4] ? data[i][4].toString().trim() : "";
                    hpSheet = data[i][5] ? data[i][5].toString().trim() : "";
                    jabatanSheet = data[i][6] ? data[i][6].toString().trim() : "";
                    break;
                }
            }
        }
    } catch (e) { }

    return {
        sukses: true,
        token: token,
        username: sesi.username,
        role: sesi.role,
        kecamatan: sesi.kecamatan,
        userId: sesi.userId || "",
        profileBelumDiisi: !namaSheet,
        profil: { namaLengkap: namaSheet, nomorHp: hpSheet, jabatan: jabatanSheet }
    };
}


// =========================================================================
// GOOGLE DRIVE UPLOAD MICROSERVICE
// =========================================================================
const MAKS_BYTE_PER_BERKAS = 25 * 1024 * 1024;
const MIME_BERKAS_DIIZINKAN = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'image/bmp', 'image/gif',
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

function validasiBerkasSebelumUpload_(berkas, labelField) {
    if (!berkas || !berkas.dataBase64) return null;
    const namaTampil = berkas.namaFile || 'tanpa nama';
    const mime = (berkas.mimeType || '').toString().trim().toLowerCase();
    if (MIME_BERKAS_DIIZINKAN.indexOf(mime) === -1) {
        return 'Berkas "' + labelField + '" (' + namaTampil + ') memakai format file yang tidak didukung' +
            (mime ? ' (' + mime + ')' : '') + '. Gunakan JPG, PNG, WEBP, HEIC, atau PDF.';
    }
    const perkiraanByte = berkas.dataBase64.length * 0.75;
    if (perkiraanByte > MAKS_BYTE_PER_BERKAS) {
        return 'Berkas "' + labelField + '" (' + namaTampil + ') ukurannya melebihi 25 MB.';
    }
    return null;
}

function dapatkanOrBuatSubfolder_(folderIndukObj, namaSubfolder) {
    const iter = folderIndukObj.getFoldersByName(namaSubfolder);
    if (iter.hasNext()) return iter.next();
    return folderIndukObj.createFolder(namaSubfolder);
}

function dapatkanFolderPendaftar_(kecamatan, layanan, nama, nik) {
    const folderInduk = DriveApp.getFolderById(FOLDER_ID_INDUK);
    const kecClean = (kecamatan || "").toString().trim().toUpperCase();
    const folderKec = dapatkanOrBuatSubfolder_(folderInduk, kecClean || "(TANPA KECAMATAN)");

    const layClean = (layanan || "").toString().trim().toUpperCase();
    const folderLayanan = dapatkanOrBuatSubfolder_(folderKec, layClean || "(TANPA LAYANAN)");

    const namaClean = (nama || "").toString().trim().toUpperCase();
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
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl();
    } catch (e) {
        return "Gagal Upload: " + e.toString();
    }
}

function uploadSemuaBerkasKeDrive(token, konteks, berkasMap) {
    let sesi;
    try { sesi = wajibSesi_(token); }
    catch (e) { return { sukses: false, pesan: e.message }; }

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(15000); // Kunci 15 detik untuk mencegah race condition folder duplikat
    } catch (e) {
        return { sukses: false, pesan: "Server sibuk saat memproses folder, coba lagi sebentar." };
    }

    try {
        const K = konteks || {};
        const B = berkasMap || {};

        const MAKS_TOTAL_BYTE_BERKAS = 60 * 1024 * 1024;
        let totalPerkiraanByte = 0;
        Object.keys(B).forEach(function (k) {
            const item = B[k];
            if (item && item.dataBase64) totalPerkiraanByte += item.dataBase64.length * 0.75;
        });
        if (totalPerkiraanByte > MAKS_TOTAL_BYTE_BERKAS) {
            return { sukses: false, pesan: "GAGAL: Total ukuran seluruh berkas terlalu besar." };
        }

        for (const kunci in B) {
            const item = B[kunci];
            if (!item || !item.dataBase64) continue;
            const labelUntukPesan = item.label || kunci;
            const pesanErrorBerkas = validasiBerkasSebelumUpload_(item, labelUntukPesan);
            if (pesanErrorBerkas) return { sukses: false, pesan: "GAGAL: " + pesanErrorBerkas };
        }

        const folderIdTersimpan = (K.folderId || "").toString().trim();
        let folderPendaftar;
        if (folderIdTersimpan) {
            try {
                folderPendaftar = DriveApp.getFolderById(folderIdTersimpan);
            } catch (eFolder) {
                folderPendaftar = dapatkanFolderPendaftar_(K.kecamatan, K.layanan, K.nama, K.nik);
            }
        } else {
            folderPendaftar = dapatkanFolderPendaftar_(K.kecamatan, K.layanan, K.nama, K.nik);
        }

        const hasil = {};
        for (const kunci in B) {
            const item = B[kunci];
            if (!item || !item.dataBase64) continue;
            const blob = blobDariBerkas_(item);
            if (!blob) continue;
            hasil[kunci] = uploadBerkasPenerima_(blob, folderPendaftar, item.label || kunci);
        }
        hasil.idFolderBerkas = folderPendaftar.getId();

        return { sukses: true, link: hasil };
    } catch (e) {
        return { sukses: false, pesan: "Gagal upload berkas: " + e.toString() };
    } finally {
        lock.releaseLock();
    }
}