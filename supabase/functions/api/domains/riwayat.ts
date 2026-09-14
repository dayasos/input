import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { TAHUN_AKTIF } from "../_shared/config.ts";
import { formatTanggalWaktuWIB } from "../_shared/tanggal.ts";
import {
  kelurahanTerkunciDari,
  lolosAksesBarisLihatData,
  resolveInstansiPengguna,
  subFilterGsmDari,
} from "../_shared/akses.ts";

interface BarisTahun {
  tahun: unknown;
}

interface BarisPenerimaMultiTahun {
  nama?: string;
  nik?: string;
  layanan?: string;
  kecamatan?: string;
  kelurahan?: string;
  tempat_tugas?: string;
  status_verifikasi?: string;
}

interface BarisRiwayatEdit {
  waktu: Date | string;
  editor_username?: string;
  editor_role?: string;
  kolom_diubah?: string;
  sebelum?: string | null;
  sesudah?: string | null;
}

// Port 1:1 dari ambilTahunTersedia() — Kode.gs mencari sheet bernama "db_<tahun>" (arsip),
// SENGAJA TIDAK termasuk tahun aktif (yang sheet-nya bernama "Data Input <tahun>", pola beda).
// Di Postgres: semua tahun (termasuk aktif) ada di tabel `penerima` yang sama, jadi exclude
// TAHUN_AKTIF secara eksplisit supaya perilaku "hanya tahun arsip" tetap sama.
export async function ambilTahunTersedia(token: string) {
  try {
    await wajibSesi(token);
    const rows = await sql<BarisTahun[]>`
      select distinct tahun from penerima where tahun <> ${TAHUN_AKTIF} order by tahun desc
    `;
    return { sukses: true, tahun: rows.map((r: BarisTahun) => String(r.tahun ?? "")) };
  } catch (_e) {
    return { sukses: false, tahun: [] };
  }
}

// Port 1:1 dari ambilDataTahunHakAkses() — otorisasi baris memakai helper akses yang sama dgn
// ambilDataLihatDataHakAkses (kelurahan-lock + sub-filter GSM sudah ada di fungsi asli, dipertahankan).
// Kontrak dipertahankan: kembalikan STRING hasil JSON.stringify() (index.html men-JSON.parse sendiri,
// lihat index.html baris 2440-an), tiap baris array [nama, nik, layanan, kecamatan, kelurahan, status].
export async function ambilDataTahunHakAkses(token: string, tahun: string | number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return JSON.stringify({ sukses: false, pesan: e instanceof Error ? e.message : String(e) });
  }

  try {
    const tahunStr = String(tahun ?? "").trim();
    if (!/^\d{4}$/.test(tahunStr)) {
      return JSON.stringify({ sukses: false, pesan: "Format tahun tidak valid." });
    }
    const tahunNum = Number(tahunStr);

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) {
      return JSON.stringify({ sukses: true, rows: [], tahun: tahunStr });
    }
    const namaKecamatanPengguna = sesi.kecamatan || "";
    const kelurahanTerkunci = kelurahanTerkunciDari(sesi);
    const subFilterGsm = subFilterGsmDari(sesi);

    // Kode.gs baris 3464-3471: sub-filter GSM di fungsi ini JUGA membaca tempat_tugas (kolom I
    // sheet arsip) — jadi ikut di-select di sini, bukan cuma 6 kolom yang tampil di output.
    const dataRows = await sql<BarisPenerimaMultiTahun[]>`
      select nama, nik, layanan, kecamatan, kelurahan, tempat_tugas, status_verifikasi
      from penerima where tahun = ${tahunNum}
      order by nomor_urut asc, id asc
    `;
    if (dataRows.length === 0) {
      return JSON.stringify({ sukses: true, rows: [], tahun: tahunStr });
    }

    const rows: unknown[][] = [];
    for (const row of dataRows) {
      const nama = (row.nama || "").toString().trim();
      const nik = (row.nik || "").toString().trim();
      if (!nama && !nik) continue;

      const layananSheet = (row.layanan || "").toString().trim().toUpperCase();
      const kecamatanSheet = (row.kecamatan || "").toString().trim().toUpperCase();
      const kelurahanSheet = (row.kelurahan || "").toString().trim().toUpperCase();
      const tempatTugasSheet = (row.tempat_tugas || "").toString().trim().toUpperCase();

      const lolos = lolosAksesBarisLihatData({
        instansiPengguna,
        layananPengguna,
        namaKecamatanPengguna,
        kelurahanTerkunci,
        subFilterGsm,
        listLayananKemenag,
        layananSheet,
        kecamatanSheet,
        kelurahanSheet,
        tempatTugasSheet,
      });
      if (!lolos) continue;

      rows.push([
        nama,
        nik,
        layananSheet,
        kecamatanSheet,
        kelurahanSheet,
        (row.status_verifikasi || "").toString().trim().toUpperCase(),
      ]);
    }

    return JSON.stringify({ sukses: true, rows, tahun: tahunStr });
  } catch (error) {
    return JSON.stringify({ sukses: false, pesan: String(error) });
  }
}

// Port 1:1 dari ambilRiwayatEdit() — `nomorBarisAsli` ditafsirkan sebagai `penerima.id` (lihat
// catatan arsitektur di domains/penerima.ts). PENGERASAN DISENGAJA (konsisten dgn perbaikan
// ambilDetailPenerimaPerBaris atas permintaan user): fungsi asli tidak menerapkan kelurahan-lock
// maupun sub-filter GSM di sini — ditambahkan di sini juga lewat helper akses yang sama, supaya
// riwayat edit tidak bisa dilihat oleh akun yang datanya sendiri saja tidak boleh dia lihat.
export async function ambilRiwayatEdit(token: string, nomorBarisAsli: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, riwayat: [], pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const id = Number(nomorBarisAsli);
    if (!id) return { sukses: false, riwayat: [], pesan: "Nomor baris tidak valid." };

    const rowsPenerima = await sql`
      select layanan, kecamatan, kelurahan, tempat_tugas from penerima
      where id = ${id} and tahun = ${TAHUN_AKTIF} limit 1
    `;
    if (rowsPenerima.length === 0) {
      return { sukses: false, riwayat: [], pesan: "Baris tidak ditemukan." };
    }
    const rowPenerima = rowsPenerima[0];

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) {
      return { sukses: false, riwayat: [], pesan: "Anda tidak berhak melihat riwayat data ini." };
    }

    const boleh = lolosAksesBarisLihatData({
      instansiPengguna,
      layananPengguna,
      namaKecamatanPengguna: sesi.kecamatan || "",
      kelurahanTerkunci: kelurahanTerkunciDari(sesi),
      subFilterGsm: subFilterGsmDari(sesi),
      listLayananKemenag,
      layananSheet: (rowPenerima.layanan || "").toUpperCase(),
      kecamatanSheet: (rowPenerima.kecamatan || "").toUpperCase(),
      kelurahanSheet: (rowPenerima.kelurahan || "").toUpperCase(),
      tempatTugasSheet: (rowPenerima.tempat_tugas || "").toUpperCase(),
    });
    if (!boleh) return { sukses: false, riwayat: [], pesan: "Anda tidak berhak melihat riwayat data ini." };

    const rowsRiwayat = await sql<BarisRiwayatEdit[]>`
      select waktu, editor_username, editor_role, kolom_diubah, sebelum, sesudah
      from riwayat_edit
      where penerima_id = ${id} and tahun = ${TAHUN_AKTIF}
      order by waktu asc
    `;

    // Catatan format: Kode.gs asli menampilkan `waktu` mentah dari sel sheet (string locale
    // id-ID "D/M/YYYY, HH.MM.SS" dari catatRiwayatEdit_) — di sini dipakai formatTanggalWaktuWIB
    // ("dd-MM-yyyy HH:mm") supaya konsisten dgn format tanggal lain yang sudah diporting
    // (tanggal_verifikasi/tanggal_lapor_perbaikan). Ini beda tampilan kosmetik kecil dari aslinya,
    // bukan perubahan fungsional (index.html cuma menampilkan String(r.waktu) apa adanya).
    const riwayat = rowsRiwayat.map((r: BarisRiwayatEdit) => ({
      waktu: formatTanggalWaktuWIB(r.waktu),
      editor: String(r.editor_username || ""),
      role: String(r.editor_role || ""),
      kolom: String(r.kolom_diubah || ""),
      sebelum: r.sebelum != null ? String(r.sebelum) : "-",
      sesudah: r.sesudah != null ? String(r.sesudah) : "-",
    }));

    return { sukses: true, riwayat };
  } catch (error) {
    return { sukses: false, riwayat: [], pesan: String(error) };
  }
}
