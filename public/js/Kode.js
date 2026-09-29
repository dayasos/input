/**
 * MICROSERVICE UPLOAD GOOGLE DRIVE - DJPM 2027 (v2 - Folder & File Terstruktur)
 */

const FOLDER_ID_INDUK = "19rMR3gd6tQUh-l2JSdBim09EFzwePCg3";
const MAKS_BYTE_PER_BERKAS = 25 * 1024 * 1024; // 25 MB

function doPost(e) {
    try {
        if (!e || !e.postData || !e.postData.contents) {
            return responseJson({ sukses: false, pesan: "Data payload kosong." });
        }

        const request = JSON.parse(e.postData.contents);
        const action = request.action;
        const args = request.args || [];

        if (action === "uploadSemuaBerkasKeDrive" || action === "uploadSatuBerkasKeDrive") {
            const konteks = args[1] || {};
            const berkasMap = args[2] || {};
            const hasil = prosesUploadBerkas(konteks, berkasMap);
            return responseJson({ result: hasil, sukses: hasil.sukses });
        }

        if (action === "ping") {
            return responseJson({ status: "ok", pesan: "Microservice Google Drive Aktif!" });
        }

        return responseJson({ sukses: false, pesan: "Aksi tidak dikenali: " + action });
    } catch (err) {
        return responseJson({ sukses: false, pesan: "Error GAS: " + err.toString() });
    }
}

function doGet(e) {
    return responseJson({ sukses: true, pesan: "Microservice Google Drive DJPM 2027 Aktif!" });
}

function responseJson(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

function dapatkanSubfolder_(folderIndukObj, namaSubfolder) {
    const iter = folderIndukObj.getFoldersByName(namaSubfolder);
    if (iter.hasNext()) return iter.next();
    return folderIndukObj.createFolder(namaSubfolder);
}

function dapatkanFolderPendaftar_(kecamatan, layanan, nama, nik) {
    const folderInduk = DriveApp.getFolderById(FOLDER_ID_INDUK);

    // 1. Folder Kecamatan
    const kecClean = (kecamatan || "").toString().trim().toUpperCase() || "(TANPA KECAMATAN)";
    const folderKec = dapatkanSubfolder_(folderInduk, kecClean);

    // 2. Folder Layanan
    const layClean = (layanan || "").toString().trim().toUpperCase() || "(TANPA LAYANAN)";
    const folderLayanan = dapatkanSubfolder_(folderKec, layClean);

    // 3. Folder Pendaftar: NAMA (NIK)
    const namaClean = (nama || "").toString().trim().toUpperCase() || "PENDAFTAR";
    const nikBersih = String(nik || "").replace(/[^0-9]/g, '') || "TANPA-NIK";
    const namaFolderPendaftar = `${namaClean} (${nikBersih})`;

    return dapatkanSubfolder_(folderLayanan, namaFolderPendaftar);
}

function prosesUploadBerkas(konteks, berkasMap) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(15000); // Kunci agar tidak terjadi folder duplikat
    } catch (e) {
        return { sukses: false, pesan: "Server Drive sibuk, silakan coba lagi." };
    }

    try {
        const K = konteks || {};
        const B = berkasMap || {};

        let folderPendaftar;
        const folderIdTersimpan = (K.folderId || "").toString().trim();
        if (folderIdTersimpan) {
            try {
                folderPendaftar = DriveApp.getFolderById(folderIdTersimpan);
            } catch (e) {
                folderPendaftar = dapatkanFolderPendaftar_(K.kecamatan, K.layanan, K.nama, K.nik);
            }
        } else {
            folderPendaftar = dapatkanFolderPendaftar_(K.kecamatan, K.layanan, K.nama, K.nik);
        }

        const daftarLink = {};

        for (const kunci in B) {
            const item = B[kunci];
            if (!item || !item.dataBase64) continue;

            const bytes = Utilities.base64Decode(item.dataBase64);
            if (bytes.length === 0 || bytes.length > MAKS_BYTE_PER_BERKAS) continue;

            // Beri nama file rapi sesuai jenis berkas: KTP.jpg, Buku Rekening.pdf, dll.
            const labelBersih = (item.label || kunci || "Berkas").trim().replace(/[\/\\:*?"<>|]/g, ' ');
            const ext = (item.namaFile && item.namaFile.lastIndexOf('.') !== -1)
                ? item.namaFile.substring(item.namaFile.lastIndexOf('.'))
                : (item.mimeType === 'application/pdf' ? '.pdf' : '.jpg');
            const namaFileFinal = labelBersih + ext;

            // Hapus file lama jika ada nama file yang sama (misal saat edit perbaikan berkas)
            const fileLama = folderPendaftar.getFilesByName(namaFileFinal);
            while (fileLama.hasNext()) {
                try { fileLama.next().setTrashed(true); } catch (eTrash) { }
            }

            const mime = (item.mimeType || 'application/octet-stream').toLowerCase();
            const blob = Utilities.newBlob(bytes, mime, namaFileFinal);

            const file = folderPendaftar.createFile(blob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            daftarLink[kunci] = file.getUrl();
        }

        daftarLink.idFolderBerkas = folderPendaftar.getId();
        return { sukses: true, link: daftarLink };
    } catch (err) {
        return { sukses: false, pesan: "Gagal simpan ke Drive: " + err.toString() };
    } finally {
        lock.releaseLock();
    }
}