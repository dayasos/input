/**
 * MICROSERVICE UPLOAD GOOGLE DRIVE - DJPM 2027 (v3.1 - terautentikasi, per-berkas, tahan konkurensi)
 *
 * Salin isi file ini ke proyek Apps Script, lalu Deploy > Manage deployments > Edit > New version.
 * (File ini SENGAJA di luar public/ supaya tidak ikut ter-deploy ke situs.)
 *
 * WAJIB diset di Project Settings > Script Properties:
 *   EDGE_URL   = https://<project>.supabase.co/functions/v1/api
 *   ANON_KEY   = anon key Supabase (dipakai hanya utk lolos gateway; keabsahan sesi dicek di Edge Function)
 *   FOLDER_ID_INDUK = (opsional) ID folder induk; default konstanta di bawah
 *
 * Aksi:
 *   ping                    -> cek hidup (tanpa token)
 *   siapkanFolderDrive      -> args [token, konteks]               : cari/buat folder pendaftar
 *   uploadSatuBerkasKeDrive -> args [token, konteks, {kunci:item}] : simpan 1 berkas (TANPA lock global)
 *   uploadSemuaBerkasKeDrive-> kompatibilitas klien lama; sama, tapi banyak berkas
 * Semua aksi selain ping WAJIB token sesi valid (args[0]).
 *
 * Desain konkurensi:
 *  - Lock global HANYA utk membuat folder Kecamatan/Layanan (dipakai bersama semua pendaftar). ID kedua
 *    folder itu di-cache, jadi hampir semua submission TIDAK menyentuh lock sama sekali.
 *  - Folder pendaftar "NAMA (NIK)" tanpa lock: kalau dua request bersamaan membuat dua folder, semua
 *    pihak konvergen ke folder TERTUA (folder kembar yg kosong dibuang).
 *  - Panggilan Drive yg kena rate limit sementara di-retry di sini (backoff + jitter).
 */

const FOLDER_ID_INDUK_DEFAULT = "19rMR3gd6tQUh-l2JSdBim09EFzwePCg3";
const MAKS_BYTE_PER_BERKAS = 25 * 1024 * 1024; // 25 MB
const MAKS_BERKAS_PER_REQUEST = 15;
const MIME_DIIZINKAN = [
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
    "image/bmp", "image/gif", "application/pdf"
];
const TTL_CACHE_SESI_DETIK = 300;      // sesi valid di-cache 5 menit -> tidak fetch ke Supabase per berkas
const TTL_CACHE_FOLDER_DETIK = 21600;  // 6 jam (batas maksimum CacheService)
const WAIT_LOCK_MS = 25000;

function props_() {
    return PropertiesService.getScriptProperties();
}

function folderIndukId_() {
    return (props_().getProperty("FOLDER_ID_INDUK") || FOLDER_ID_INDUK_DEFAULT).trim();
}

function responseJson(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
    return responseJson({ sukses: true, pesan: "Microservice Google Drive DJPM 2027 Aktif!" });
}

function doPost(e) {
    try {
        if (!e || !e.postData || !e.postData.contents) {
            return responseJson({ sukses: false, pesan: "Data payload kosong." });
        }
        const request = JSON.parse(e.postData.contents);
        const action = request.action;
        const args = request.args || [];

        if (action === "ping") {
            return responseJson({ status: "ok", pesan: "Microservice Google Drive Aktif!" });
        }

        const aksiDikenal = ["siapkanFolderDrive", "uploadSatuBerkasKeDrive", "uploadSemuaBerkasKeDrive"];
        if (aksiDikenal.indexOf(action) === -1) {
            return responseJson({ sukses: false, pesan: "Aksi tidak dikenali: " + action });
        }

        const cekSesi = validasiSesi_(args[0]);
        if (!cekSesi.sah) {
            return responseJson({ sukses: false, pesan: cekSesi.pesan });
        }

        const konteks = args[1] || {};
        let hasil;
        if (action === "siapkanFolderDrive") {
            hasil = siapkanFolder_(konteks);
        } else {
            hasil = prosesUploadBerkas_(konteks, args[2] || {});
        }
        return responseJson({ result: hasil, sukses: hasil.sukses });
    } catch (err) {
        return responseJson({ sukses: false, pesan: "Error GAS: " + err.toString() });
    }
}

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------
function hashTeks_(teks) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(teks));
    return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

// Retry utk error sementara Drive/Cache ("Service invoked too many times", "Rate Limit Exceeded", dsb.).
function denganRetry_(fn, percobaan) {
    const maks = percobaan || 4;
    let terakhir = null;
    for (let i = 0; i < maks; i++) {
        try {
            return fn();
        } catch (err) {
            terakhir = err;
            if (i < maks - 1) Utilities.sleep(400 * Math.pow(2, i) + Math.floor(Math.random() * 300));
        }
    }
    throw terakhir;
}

// ---------------------------------------------------------------------------
// Autentikasi: token sesi divalidasi ke Edge Function (aksi `ping` hanya lolos kalau sesi valid).
// Hasil sah di-cache singkat (hash token, bukan token mentah).
// Pesan "ditolak" = permanen (klien tidak akan retry). Gangguan jaringan/5xx ke Supabase sengaja
// TIDAK memakai kata itu, supaya klien mencoba lagi dan bukan langsung menyerah.
// ---------------------------------------------------------------------------
function validasiSesi_(token) {
    const t = (token || "").toString().trim();
    if (!t) return { sah: false, pesan: "Akses ditolak: token sesi tidak ada." };

    const cache = CacheService.getScriptCache();
    const kunci = "ses_" + hashTeks_(t);
    try { if (cache.get(kunci)) return { sah: true }; } catch (_e) { }

    const edgeUrl = (props_().getProperty("EDGE_URL") || "").trim();
    const anonKey = (props_().getProperty("ANON_KEY") || "").trim();
    if (!edgeUrl || !anonKey) {
        return { sah: false, pesan: "Konfigurasi GAS belum lengkap (EDGE_URL/ANON_KEY di Script Properties)." };
    }

    let res;
    try {
        res = denganRetry_(function () {
            return UrlFetchApp.fetch(edgeUrl, {
                method: "post",
                contentType: "application/json",
                headers: { "x-session-token": t, "apikey": anonKey, "Authorization": "Bearer " + anonKey },
                payload: JSON.stringify({ action: "ping", args: [] }),
                muteHttpExceptions: true
            });
        }, 3);
    } catch (err) {
        return { sah: false, pesan: "Gagal menghubungi server verifikasi sesi, coba lagi: " + err.toString() };
    }

    const kode = res.getResponseCode();
    let json = null;
    try { json = JSON.parse(res.getContentText()); } catch (_e) { }

    if (json && json.result && json.result.pong) {
        try { cache.put(kunci, "1", TTL_CACHE_SESI_DETIK); } catch (_e) { }
        return { sah: true };
    }
    if (kode >= 500 || kode === 429 || !json) {
        return { sah: false, pesan: "Server verifikasi sesi sedang sibuk (kode " + kode + "), coba lagi." };
    }
    return { sah: false, pesan: "Akses ditolak: sesi tidak sah atau sudah berakhir. Silakan login ulang." };
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------
function bersihNama_(s, fallback) {
    const v = (s == null ? "" : String(s)).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    return (v || fallback).substring(0, 120);
}

// Folder harus turunan FOLDER_ID_INDUK (bukan induk itu sendiri) -- cegah klien menyuruh script
// menulis ke folder Drive lain.
function dalamInduk_(folder) {
    const indukId = folderIndukId_();
    if (folder.getId() === indukId) return false;
    const cache = CacheService.getScriptCache();
    const kunci = "in_" + folder.getId();
    try { if (cache.get(kunci)) return true; } catch (_e) { }

    let cur = folder;
    for (let i = 0; i < 6; i++) {
        const parents = cur.getParents();
        if (!parents.hasNext()) return false;
        cur = parents.next();
        if (cur.getId() === indukId) {
            try { cache.put(kunci, "1", TTL_CACHE_FOLDER_DETIK); } catch (_e) { }
            return true;
        }
    }
    return false;
}

function ambilFolderTersimpan_(id) {
    if (!id) return null;
    try {
        const f = DriveApp.getFolderById(id);
        if (f.isTrashed()) return null;
        return dalamInduk_(f) ? f : null;
    } catch (_e) {
        return null;
    }
}

// Pilih folder bernama `nama` di `induk`: kalau ada beberapa (hasil race), pakai yang TERTUA.
function cariFolderTertua_(induk, nama) {
    const iter = induk.getFoldersByName(nama);
    let terpilih = null;
    while (iter.hasNext()) {
        const f = iter.next();
        if (!terpilih || f.getDateCreated().getTime() < terpilih.getDateCreated().getTime()) terpilih = f;
    }
    return terpilih;
}

// Folder Kecamatan/Layanan dipakai bersama semua pendaftar -> pembuatannya dikunci & di-cache.
function folderBersama_(induk, nama, kunciCache) {
    const cache = CacheService.getScriptCache();
    let id = null;
    try { id = cache.get(kunciCache); } catch (_e) { }
    if (id) {
        try {
            const f = DriveApp.getFolderById(id);
            if (!f.isTrashed()) return f;
        } catch (_e) { }
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(WAIT_LOCK_MS); // lempar error kalau gagal -> ditangkap siapkanFolder_ jadi "sibuk"
    try {
        // Cek ulang di dalam lock: request lain mungkin baru saja membuatnya.
        let f = cariFolderTertua_(induk, nama);
        if (!f) f = denganRetry_(function () { return induk.createFolder(nama); });
        try { cache.put(kunciCache, f.getId(), TTL_CACHE_FOLDER_DETIK); } catch (_e) { }
        return f;
    } finally {
        lock.releaseLock();
    }
}

// Folder pendaftar (unik per NIK) TANPA lock; race diselesaikan dgn konvergensi ke folder tertua.
function folderPendaftar_(folderLayanan, nama) {
    let f = cariFolderTertua_(folderLayanan, nama);
    if (f) return f;
    const baru = denganRetry_(function () { return folderLayanan.createFolder(nama); });
    const tertua = cariFolderTertua_(folderLayanan, nama) || baru;
    if (tertua.getId() !== baru.getId()) {
        try { baru.setTrashed(true); } catch (_e) { } // folder kembar (masih kosong) dibuang
    }
    return tertua;
}

function siapkanFolder_(konteks) {
    const K = konteks || {};

    const tersimpan = ambilFolderTersimpan_((K.folderId || "").toString().trim());
    if (tersimpan) return { sukses: true, folderId: tersimpan.getId() };

    try {
        const kec = bersihNama_(K.kecamatan, "(TANPA KECAMATAN)");
        const lay = bersihNama_(K.layanan, "(TANPA LAYANAN)");
        const nik = String(K.nik || "").replace(/[^0-9]/g, "") || "TANPA-NIK";

        const induk = DriveApp.getFolderById(folderIndukId_());
        const folderKec = folderBersama_(induk, kec, "kec_" + hashTeks_(kec));
        const folderLay = folderBersama_(folderKec, lay, "lay_" + hashTeks_(kec + "|" + lay));
        const folder = folderPendaftar_(folderLay, bersihNama_(K.nama, "PENDAFTAR") + " (" + nik + ")");
        return { sukses: true, folderId: folder.getId() };
    } catch (err) {
        const pesan = err && err.toString ? err.toString() : String(err);
        if (/lock/i.test(pesan)) return { sukses: false, pesan: "Server Drive sibuk, silakan coba lagi." };
        return { sukses: false, pesan: "Gagal menyiapkan folder Drive: " + pesan };
    }
}

// ---------------------------------------------------------------------------
// Upload berkas (tanpa lock global)
// ---------------------------------------------------------------------------
function ekstensiDari_(item) {
    const nama = (item.namaFile || "").toString();
    const i = nama.lastIndexOf(".");
    if (i !== -1) {
        const ext = nama.substring(i).toLowerCase().replace(/[^a-z0-9.]/g, "");
        if (ext.length > 1 && ext.length <= 6) return ext;
    }
    return (item.mimeType || "").toLowerCase() === "application/pdf" ? ".pdf" : ".jpg";
}

// Hapus file lama dengan nama dasar sama (apa pun ekstensinya: KTP.jpg diganti KTP.pdf tidak menyisakan duplikat).
function buangBerkasLama_(folder, labelBersih) {
    const files = folder.getFiles();
    while (files.hasNext()) {
        const f = files.next();
        const nama = f.getName();
        const titik = nama.lastIndexOf(".");
        const dasar = titik !== -1 ? nama.substring(0, titik) : nama;
        if (dasar === labelBersih) {
            try { f.setTrashed(true); } catch (_e) { }
        }
    }
}

function prosesUploadBerkas_(konteks, berkasMap) {
    try {
        const K = konteks || {};
        const B = berkasMap || {};
        const kunciList = Object.keys(B).filter(function (k) { return B[k] && B[k].dataBase64; });
        if (kunciList.length === 0) return { sukses: false, pesan: "Tidak ada berkas yang dikirim." };
        if (kunciList.length > MAKS_BERKAS_PER_REQUEST) return { sukses: false, pesan: "Terlalu banyak berkas dalam satu permintaan." };

        // Validasi semua dulu (fail-fast, jangan menulis sebagian lalu diam-diam melewati sisanya)
        const bytesMap = {};
        const labelSudahDipakai = {};
        for (let i = 0; i < kunciList.length; i++) {
            const kunci = kunciList[i];
            const item = B[kunci];
            const mime = (item.mimeType || "").toString().trim().toLowerCase();
            const label = (item.label || kunci);
            if (MIME_DIIZINKAN.indexOf(mime) === -1) {
                return { sukses: false, pesan: 'Berkas "' + label + '" memakai format tidak didukung (' + (mime || "tanpa tipe") + "). Gunakan JPG, PNG, WEBP, HEIC, atau PDF." };
            }
            const bytes = Utilities.base64Decode(item.dataBase64);
            if (bytes.length === 0) return { sukses: false, pesan: 'Berkas "' + label + '" kosong.' };
            if (bytes.length > MAKS_BYTE_PER_BERKAS) return { sukses: false, pesan: 'Berkas "' + label + '" melebihi 25 MB.' };
            bytesMap[kunci] = bytes;
            const lb = namaDasar_(item, kunci);
            if (labelSudahDipakai[lb]) return { sukses: false, pesan: 'Dua berkas memakai label sama "' + lb + '".' };
            labelSudahDipakai[lb] = true;
        }

        const hf = siapkanFolder_(K);
        if (!hf.sukses) return hf;
        const folder = DriveApp.getFolderById(hf.folderId);

        const daftarLink = {};
        for (let i = 0; i < kunciList.length; i++) {
            const kunci = kunciList[i];
            const item = B[kunci];
            const labelBersih = namaDasar_(item, kunci);
            const namaFinal = labelBersih + ekstensiDari_(item);

            buangBerkasLama_(folder, labelBersih);

            const blob = Utilities.newBlob(bytesMap[kunci], item.mimeType.toString().toLowerCase(), namaFinal);
            const file = denganRetry_(function () { return folder.createFile(blob); });
            try {
                denganRetry_(function () { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); });
            } catch (errShare) {
                try { file.setTrashed(true); } catch (_e) { } // jangan tinggalkan file yatim; klien akan retry
                throw errShare;
            }
            daftarLink[kunci] = file.getUrl();
        }

        daftarLink.idFolderBerkas = hf.folderId;
        return { sukses: true, link: daftarLink };
    } catch (err) {
        return { sukses: false, pesan: "Gagal simpan ke Drive: " + err.toString() };
    }
}

function namaDasar_(item, kunci) {
    return (item.label || kunci).toString().trim().replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").substring(0, 80) || "Berkas";
}
