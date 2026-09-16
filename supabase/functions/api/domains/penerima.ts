import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { LAYANAN_BATASI_TEMPAT_TUGAS, rapikanTeks, TAHUN_AKTIF } from "../_shared/config.ts";
import { bersihkanSelUntukArray, formatTanggalDDMMYYYY, formatTanggalWaktuWIB } from "../_shared/tanggal.ts";
import {
  daftarLayananKemenagUpper,
  kelurahanTerkunciDari,
  lolosAksesBarisLihatData,
  resolveInstansiPengguna,
  subFilterGsmDari,
} from "../_shared/akses.ts";
import { cekAksesInputUser } from "./setelan.ts";
import { validasiDataBaru } from "./validasi.ts";

// ---------------------------------------------------------------------------
// CATATAN ARSITEKTUR PENTING: identitas baris ("nomorBaris")
//
// Di Kode.gs, index.html memakai NOMOR BARIS FISIK di sheet (i+2, dari getSnapshotSheetInput_)
// sebagai "id" yang dikirim balik ke server untuk aksi lanjutan (ambilDetailPenerimaPerBaris,
// editDataPenerima, verifikasiSatuData, dst) — lihat `masterDataLihat[i][0]` di index.html.
//
// Di Postgres, nomor baris fisik sheet TIDAK stabil/tidak selalu tersedia (baris baru belum
// tentu sudah tersinkron ke Sheets saat pertama kali dibuat — lihat pola outbox di rencana
// migrasi). Sebagai gantinya, kolom PERTAMA yang dikembalikan di sini diisi `penerima.id`
// (primary key Postgres, tersedia seketika, permanen) — bukan `sheet_row_number`.
//
// index.html memperlakukan nilai ini sebagai token buram (diteruskan apa adanya ke pemanggilan
// berikutnya, tidak pernah dihitung/dibandingkan sebagai angka baris) sehingga substitusi ini
// AMAN bagi UI — dan seluruh fungsi lanjutan yang menerima parameter ini (ambilDetailPenerimaPerBaris,
// editDataPenerima, verifikasiSatuData, ambilRiwayatEdit, laporkanPerbaikanBerkas) SUDAH konsisten
// menafsirkannya sebagai `penerima.id` (Postgres primary key), bukan nomor baris sheet fisik.
// ---------------------------------------------------------------------------

// Port dari ambilDataLihatDataHakAkses() — kontrak dipertahankan: fungsi ini mengembalikan STRING
// hasil JSON.stringify() (bukan objek biasa), karena index.html memanggil JSON.parse(jsonResponse)
// sendiri di withSuccessHandler (lihat index.html baris 3581). Bentuk tiap baris array TETAP
// array-of-array posisional (bukan objek) — lihat pemakaian masterDataLihat[i][0..19] di index.html.
export async function ambilDataLihatDataHakAkses(token: string): Promise<string> {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return JSON.stringify({ sukses: false, pesan: e instanceof Error ? e.message : String(e) });
  }

  try {
    const namaKecamatanPengguna = sesi.kecamatan || "";
    const kelurahanTerkunci = kelurahanTerkunciDari(sesi);
    const subFilterGsm = subFilterGsmDari(sesi);

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) {
      return JSON.stringify({ sukses: false, pesan: "Peran tidak dikenali." });
    }

    const rows = await sql`
      select id, nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat, layanan,
             tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening, nomor_rekening,
             kantor_cabang, no_kontak, status_bpjs_tk, umur, status_verifikasi, tanggal_lapor_perbaikan
      from penerima
      where tahun = ${TAHUN_AKTIF}
      order by nomor_urut
    `;

    const resultRows: unknown[][] = [];
    for (const row of rows) {
      const layananSheet = (row.layanan || "").toUpperCase();
      const kecamatanSheet = (row.kecamatan || "").toUpperCase();
      const kelurahanSheet = (row.kelurahan || "").toUpperCase();
      const tempatTugasSheet = (row.tempat_tugas || "").toUpperCase();

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

      resultRows.push([
        row.id,
        row.nama,
        row.nik,
        row.jenis_kelamin,
        row.tempat_lahir,
        formatTanggalDDMMYYYY(row.tanggal_lahir),
        row.alamat,
        row.layanan,
        row.tempat_tugas,
        row.alamat_tugas,
        row.kecamatan,
        row.kelurahan,
        row.nama_rekening,
        row.nomor_rekening,
        row.kantor_cabang,
        (row.no_kontak || "").toString().replace(/^'+/, "").trim(),
        row.status_bpjs_tk,
        // umur bisa NULL kalau backfill data lama tidak punya nilai valid (lihat angkaAtauNull di
        // scripts/backfill) — jadikan "" (bukan `null` literal) supaya perilakunya sama seperti sel
        // Sheets kosong yang dibaca Kode.gs asli (getRange().getValues() tidak pernah mengembalikan
        // null untuk sel kosong, selalu "").
        row.umur ?? "",
        row.status_verifikasi || "Proses Verifikasi",
        // Dikonfirmasi ke laporkanPerbaikanBerkas() (Kode.gs baris 3054): ditulis sbg string
        // "dd-MM-yyyy HH:mm" WIB, bukan ISO. index.html sendiri di sini cuma memakainya sbg
        // penanda truthy/falsy (row[19], lihat index.html baris 3706/3757) jadi formatnya tidak
        // kritikal DI FUNGSI INI, tapi disamakan supaya konsisten dgn dataLengkap[38] di bawah.
        formatTanggalWaktuWIB(row.tanggal_lapor_perbaikan),
      ]);
    }

    return JSON.stringify({ sukses: true, rows: resultRows });
  } catch (error) {
    return JSON.stringify({ sukses: false, pesan: String(error) });
  }
}

// Port dari ambilDetailPenerimaPerBaris() — `nomorBarisAsli` sekarang ditafsirkan sebagai
// `penerima.id` (lihat catatan arsitektur di atas), BUKAN nomor baris fisik sheet.
//
// PENGERASAN DISENGAJA (atas permintaan eksplisit, BUKAN bagian dari "porting 1:1"): fungsi asli
// di Kode.gs TIDAK menerapkan kelurahan-lock maupun sub-filter GSM Katolik/Kristen di sini (beda
// dari ambilDataLihatDataHakAkses) — celah yang sama persis kelasnya dengan bug ambilDataDetailByNik
// (lihat memori project-bug-akses-data-detail-gsm). Di sini SEKARANG dipakai helper akses penuh
// yang sama (`lolosAksesBarisLihatData`) supaya tampilan detail-per-baris tidak pernah lebih
// longgar daripada daftar "Lihat Data" yang menampilkannya.
export async function ambilDetailPenerimaPerBaris(token: string, nomorBarisAsli: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return JSON.stringify({ sukses: false, pesan: e instanceof Error ? e.message : String(e) });
  }

  try {
    const id = Number(nomorBarisAsli);
    if (!id) return JSON.stringify({ sukses: false, pesan: "Nomor baris tidak valid." });

    const rows = await sql`
      select * from penerima where id = ${id} and tahun = ${TAHUN_AKTIF} limit 1
    `;
    if (rows.length === 0) return JSON.stringify({ sukses: false, pesan: "Nomor baris tidak valid." });
    const row = rows[0];

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) {
      return JSON.stringify({ sukses: false, pesan: "Anda tidak berhak melihat data ini." });
    }

    const boleh = lolosAksesBarisLihatData({
      instansiPengguna,
      layananPengguna,
      namaKecamatanPengguna: sesi.kecamatan || "",
      kelurahanTerkunci: kelurahanTerkunciDari(sesi),
      subFilterGsm: subFilterGsmDari(sesi),
      listLayananKemenag,
      layananSheet: (row.layanan || "").toUpperCase(),
      kecamatanSheet: (row.kecamatan || "").toUpperCase(),
      kelurahanSheet: (row.kelurahan || "").toUpperCase(),
      tempatTugasSheet: (row.tempat_tugas || "").toUpperCase(),
    });
    if (!boleh) return JSON.stringify({ sukses: false, pesan: "Anda tidak berhak melihat data ini." });

    // Array 40 kolom, urutan PERSIS header "Data Input <tahun>" asli (lihat migrasi
    // 20260907090200_penerima_partitioned.sql) — index.html membaca lewat dataLengkap[0..39]
    // posisional (mis. dataAktif[32] = status verifikasi, dikonfirmasi dari index.html baris 4360).
    const dataLengkap = [
      row.nomor_urut, row.nama, row.nik, row.jenis_kelamin, row.tempat_lahir, row.tanggal_lahir,
      row.alamat, row.layanan, row.tempat_tugas, row.alamat_tugas, row.kecamatan, row.kelurahan,
      row.nama_rekening, row.nomor_rekening, row.kantor_cabang, row.no_kontak, row.status_bpjs_tk,
      row.umur, row.link_ktp, row.link_buku_rekening, row.link_surat_permohonan,
      row.link_pernyataan_satu_bantuan, row.link_domisili_kelurahan, row.link_formulir_pendataan,
      row.link_berkas_pendukung, row.link_foto_plank_rumah_ibadah, row.link_foto_lokasi_ibadah,
      row.link_foto_kegiatan_belajar, row.link_rekomendasi_bkm, row.link_rekomendasi_rumah_ibadah,
      row.id_folder_berkas, row.link_koordinat_lokasi, row.status_verifikasi,
      row.keterangan_verifikasi, row.tanggal_verifikasi, row.diverifikasi_oleh,
      row.batas_waktu_perbaikan, row.catatan_perbedaan_nama, row.tanggal_lapor_perbaikan,
      row.dilapor_oleh,
    ].map(bersihkanSelUntukArray);

    // tanggal_verifikasi (index 34) & tanggal_lapor_perbaikan (index 38) BUKAN tanggal murni —
    // dikonfirmasi ke verifikasiSatuData (Kode.gs baris 2988) & laporkanPerbaikanBerkas (baris 3054):
    // keduanya ditulis sbg "dd-MM-yyyy HH:mm" WIB (menyertakan jam), beda dari tanggal_lahir/
    // batas_waktu_perbaikan yang cuma tanggal. Timpa hasil map generik di atas dengan format yang benar.
    dataLengkap[34] = formatTanggalWaktuWIB(row.tanggal_verifikasi);
    dataLengkap[38] = formatTanggalWaktuWIB(row.tanggal_lapor_perbaikan);

    // Bersihkan kutip depan pada no kontak (index 15) — port dari Kode.gs baris 1457.
    if (dataLengkap[15]) {
      dataLengkap[15] = (dataLengkap[15] as string).replace(/^'+/, "").trim();
    }

    return JSON.stringify({ sukses: true, dataLengkap });
  } catch (error) {
    return JSON.stringify({ sukses: false, pesan: String(error) });
  }
}

// ---------------------------------------------------------------------------
// PETA KOLOM INDEX (0-based, sesuai posisi di sheet "Data Input 2027") → nama kolom Postgres.
// Dipakai editDataPenerima untuk teks maupun berkas.
// Sumber: header appendRow di Kode.gs baris 997-1007 & KOLOM_TEKS_BOLEH/KOLOM_BERKAS baris 2635-2650.
// ---------------------------------------------------------------------------
const MAP_IDX_KE_KOLOM_TEKS: Record<number, string> = {
  1: "nama",
  2: "nik",
  3: "jenis_kelamin",
  4: "tempat_lahir",
  5: "tanggal_lahir",    // format "dd-MM-yyyy" dari frontend; dikonversi ke date Postgres di bawah
  6: "alamat",
  8: "tempat_tugas",
  9: "alamat_tugas",
  11: "kelurahan",
  12: "nama_rekening",
  13: "nomor_rekening",
  14: "kantor_cabang",
  15: "no_kontak",
  16: "status_bpjs_tk",
};

const MAP_IDX_KE_KOLOM_BERKAS: Record<number, string> = {
  18: "link_ktp",
  19: "link_buku_rekening",
  20: "link_surat_permohonan",
  21: "link_pernyataan_satu_bantuan",
  22: "link_domisili_kelurahan",
  23: "link_formulir_pendataan",
  24: "link_berkas_pendukung",
  25: "link_foto_plank_rumah_ibadah",
  26: "link_foto_lokasi_ibadah",
  27: "link_foto_kegiatan_belajar",
  28: "link_rekomendasi_bkm",
  29: "link_rekomendasi_rumah_ibadah",
};

// Label kolom untuk riwayat_edit (sama persis labelKolom_() Kode.gs baris 3102-3110)
function labelKolom(idx: number): string {
  const MAP: Record<number, string> = {
    1: "Nama Lengkap", 2: "NIK", 3: "Jenis Kelamin", 4: "Tempat Lahir",
    5: "Tanggal Lahir", 6: "Alamat Domisili", 8: "Tempat Tugas", 9: "Alamat Tugas",
    11: "Kelurahan", 12: "Nama Rekening", 13: "Nomor Rekening",
    14: "Kantor Cabang", 15: "No. Kontak", 16: "Status BPJS",
    18: "KTP", 19: "Buku Rekening", 20: "Surat Permohonan",
    21: "Surat Pernyataan (Satu Jenis & Bukan ASN/BUMN/BUMD/TNI/POLRI)",
    22: "Domisili Kelurahan", 23: "Formulir Pendataan", 24: "Berkas Pendukung",
    25: "Foto Plank", 26: "Foto Lokasi Ibadah", 27: "Foto Kegiatan",
    28: "Rekomendasi BKM", 29: "Rekomendasi Pengurus Rumah Ibadah",
  };
  return MAP[idx] || ("Kolom " + idx);
}

// Hitung umur berdasarkan patokan 1 Januari TAHUN_AKTIF (port hitungUmur_ Kode.gs baris 3112-3127)
function hitungUmur(tglStr: string): number | null {
  try {
    const parts = tglStr.split(/[-/]/);
    if (parts.length < 3) return null;
    let d: number, m: number, y: number;
    if (parts[0].length === 4) {
      y = Number(parts[0]); m = Number(parts[1]); d = Number(parts[2]);
    } else {
      d = Number(parts[0]); m = Number(parts[1]); y = Number(parts[2]);
    }
    const lahir = new Date(y, m - 1, d);
    const patokan = new Date(TAHUN_AKTIF, 0, 1); // 1 Januari tahun aktif
    let umur = patokan.getFullYear() - lahir.getFullYear();
    const selisihBulan = patokan.getMonth() - lahir.getMonth();
    if (selisihBulan < 0 || (selisihBulan === 0 && patokan.getDate() < lahir.getDate())) umur--;
    return umur >= 0 ? umur : null;
  } catch (_e) {
    return null;
  }
}

// Konversi "dd-MM-yyyy" → "yyyy-MM-dd" untuk Postgres date type
function tglDDMMYYYYkeISO(tglStr: string): string | null {
  try {
    const parts = tglStr.trim().split(/[-/]/);
    if (parts.length < 3) return null;
    if (parts[0].length === 4) return tglStr.trim(); // sudah ISO
    const [d, m, y] = parts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Port dari simpanDataKeSheet() — Kode.gs baris 970-1183.
//
// PERUBAHAN ARSITEKTUR DISENGAJA (Fase 4):
// Upload berkas ke Google Drive TETAP dilakukan oleh GAS (microservice upload),
// karena Drive write dari personal account tidak bisa dilakukan via Service Account/Edge Function.
// formObject.__linkBerkas = { fileKtp, fileBukuRekening, ... } berisi URL Drive yang sudah jadi
// (dihasilkan oleh panggilan terpisah ke GAS sebelum submit ke sini).
// formObject.__berkas (base64) TIDAK diproses di sini.
//
// Kontrak respons identik: { sukses, pesan } — tidak ada perubahan di frontend yang mengkonsumsi
// respons ini (index.html baris sekitar 3100-3140 hanya cek sukses/pesan).
// ---------------------------------------------------------------------------
export async function simpanDataKeSheet(token: string, formObject: Record<string, unknown>) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    // ── Pemetaan nilai form (port 1:1 dari Kode.gs baris 1011-1039) ──
    const nama = ((formObject.inputNama as string) || "").trim().toUpperCase();
    const nik = String(formObject.inputNik || "").trim();
    const jenisKelamin = ((formObject.selectGender as string) || "").trim().toUpperCase();
    const tempatLahir = ((formObject.inputTempatLahir as string) || "").trim().toUpperCase();
    const tglLahirRaw = (formObject.inputTglLahir as string) || "";
    const tanggalLahirISO = tglLahirRaw ? tglDDMMYYYYkeISO(tglLahirRaw) : null;
    const umurHitung = tglLahirRaw ? hitungUmur(tglLahirRaw) : -1;
    const alamat = ((formObject.inputAlamat as string) || "").trim().toUpperCase();
    const layanan = ((formObject.selectLayanan as string) || "").trim().toUpperCase();
    const tempatTugas = ((formObject.inputTempatTugas as string) || "").trim().toUpperCase();
    const alamatTugas = ((formObject.inputAlamatTugas as string) || "").trim().toUpperCase();
    const kecamatan = ((formObject.controlKecamatan as string) || "").trim().toUpperCase();
    const kelurahan = ((formObject.controlKelurahan as string) || "").trim().toUpperCase();
    const namaRekening = ((formObject.inputNamaRekening as string) || "").trim().toUpperCase();
    const nomorRekening = String(formObject.inputNoRekening || "").trim();
    const kantorCabang = ((formObject.inputKantorCabang as string) || "").trim().toUpperCase();
    const noKontak = String(formObject.inputNoKontak || "").trim();
    const statusBpjs = ((formObject.selectBpjs as string) || "").trim().toUpperCase();
    const koordinatLink = ((formObject.koordinatLink as string) || "").trim();
    const catatanPerbedaanNama = ((formObject.catatanPerbedaanNama as string) || "").trim();

    // Link berkas dari GAS microservice upload (bukan base64)
    const L = (formObject.__linkBerkas as Record<string, string>) || {};
    const linkKtp = L.fileKtp || "";
    const linkBukuRekening = L.fileBukuRekening || "";
    const linkSuratPermohon = L.fileSuratPermohon || "";
    const linkPernyataan = L.filePernyataan || "";
    const linkDomisili = L.fileDomisili || "";
    const linkFormulirPendataan = L.fileBerkasPendukung || "";
    const linkBerkasPendukung = L.fileBerkasPendukung2 || "";
    const linkFotoPlank = L.fileFotoPlank || "";
    const linkFotoIbadah = L.fileFotoIbadah || "";
    const linkFotoKegiatan = L.fileFotoKegiatan || "";
    const linkRekomendasiBkm = L.fileRekomendasiBkm || "";
    const linkRekomendasiRi = L.fileRekomendasiRi || "";
    const idFolderBerkas = L.idFolderBerkas || "";

    // ── Otorisasi server-side: RBAC layanan+kecamatan (port Kode.gs baris 1057-1072) ──
    const peranSesi = (sesi.role || "").toString().trim().toUpperCase();
    const listLayananKemenag = await daftarLayananKemenagUpper();

    if (peranSesi !== "UTAMA") {
      if (peranSesi === "KECAMATAN") {
        if (listLayananKemenag.includes(layanan)) {
          return { sukses: false, pesan: "GAGAL: Akun Kecamatan tidak berwenang mengisi layanan Kemenag." };
        }
        if (!(sesi.kecamatan || "").toString().trim()) {
          return { sukses: false, pesan: "GAGAL: Akun Anda belum terdaftar untuk kecamatan mana pun. Hubungi admin utama." };
        }
      } else if (layanan !== peranSesi) {
        return { sukses: false, pesan: `GAGAL: Akun Anda hanya berwenang mengisi layanan "${sesi.role}".` };
      }
      const kecSesi = (sesi.kecamatan || "").toString().trim().toUpperCase();
      if (kecSesi && kecamatan !== kecSesi) {
        return { sukses: false, pesan: "GAGAL: Akun Anda hanya berwenang mengisi data untuk Kecamatan " + kecSesi + "." };
      }
    }

    // ── Cek sakelar tutup (port Kode.gs baris 1074-1085) ──
    const adalahKecKem = peranSesi === "KECAMATAN" || listLayananKemenag.includes(peranSesi);
    if (adalahKecKem) {
      const akses = await cekAksesInputUser(sesi.userId);
      if (akses.ditutup) {
        const pesan = akses.sumber === "KHUSUS"
          ? "Akses input untuk akun Anda telah ditutup secara khusus oleh admin utama. Hubungi Dinas Sosial Kota Medan."
          : "Periode input sudah ditutup oleh admin utama.";
        return { sukses: false, pesan };
      }
    }

    // ── Validasi server (port Kode.gs baris 1087-1100) ──
    if ((umurHitung ?? -1) < 18) {
      return { sukses: false, pesan: "GAGAL: Usia di bawah 18 tahun tidak memenuhi syarat." };
    }
    if (!nama || nik.length !== 16 || nomorRekening.length !== 14 || !layanan || !kecamatan) {
      return { sukses: false, pesan: "GAGAL: Data wajib tidak lengkap atau format NIK/Rekening salah." };
    }

    // Tentukan instansi efektif untuk validasiDataBaru (port Kode.gs baris 1044-1054)
    let instansiEfektif: string;
    if (peranSesi === "KECAMATAN") {
      instansiEfektif = "KECAMATAN";
    } else if (listLayananKemenag.includes(peranSesi)) {
      instansiEfektif = "KEMENAG";
    } else {
      instansiEfektif = listLayananKemenag.includes(layanan) ? "KEMENAG" : "KECAMATAN";
    }

    // Validasi duplikat + kuota via validasiDataBaru (reuse yang sudah ada di validasi.ts)
    const cekUlang = await validasiDataBaru(
      token, nik, layanan, tempatTugas, instansiEfektif, nomorRekening, kecamatan, alamatTugas,
    );
    if (!cekUlang.valid) {
      return {
        sukses: false,
        pesan: cekUlang.pesan,
        kuotaHabis: (cekUlang as Record<string, unknown>).kuotaHabis || false,
      };
    }

    // ── Hitung nomor urut (serial per tahun, aman dari race condition via unique index) ──
    const rowsNomor = await sql`
      select coalesce(max(nomor_urut), 0) + 1 as next_nomor
      from penerima where tahun = ${TAHUN_AKTIF}
    `;
    const nomorUrut = Number(rowsNomor[0]?.next_nomor) || 1;

    // ── INSERT ke Postgres + enqueue sinkronisasi ke Sheets, SATU transaksi ──
    // (sync_worker memproses `sync_outbox` async, baca ULANG baris ini fresh saat diproses —
    // lihat catatan desain di supabase/functions/sync-worker/index.ts — jadi payload outbox di
    // sini sengaja kosong `{}`, cukup entity_ref utk sync-worker tahu baris mana yang harus dibaca.)
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      const rows = await trx`
        insert into penerima (
          tahun, nomor_urut,
          nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat,
          layanan, tempat_tugas, alamat_tugas, kecamatan, kelurahan,
          nama_rekening, nomor_rekening, kantor_cabang, no_kontak, status_bpjs_tk, umur,
          link_ktp, link_buku_rekening, link_surat_permohonan, link_pernyataan_satu_bantuan,
          link_domisili_kelurahan, link_formulir_pendataan, link_berkas_pendukung,
          link_foto_plank_rumah_ibadah, link_foto_lokasi_ibadah, link_foto_kegiatan_belajar,
          link_rekomendasi_bkm, link_rekomendasi_rumah_ibadah,
          id_folder_berkas, link_koordinat_lokasi,
          status_verifikasi, catatan_perbedaan_nama,
          dibuat_oleh_akun_id, sync_status
        ) values (
          ${TAHUN_AKTIF}, ${nomorUrut},
          ${nama}, ${nik}, ${jenisKelamin}, ${tempatLahir}, ${tanggalLahirISO}, ${alamat},
          ${layanan}, ${rapikanTeks(tempatTugas)}, ${rapikanTeks(alamatTugas)},
          ${kecamatan}, ${kelurahan},
          ${namaRekening}, ${nomorRekening}, ${kantorCabang}, ${noKontak}, ${statusBpjs},
          ${umurHitung},
          ${linkKtp}, ${linkBukuRekening}, ${linkSuratPermohon}, ${linkPernyataan},
          ${linkDomisili}, ${linkFormulirPendataan}, ${linkBerkasPendukung},
          ${linkFotoPlank}, ${linkFotoIbadah}, ${linkFotoKegiatan},
          ${linkRekomendasiBkm}, ${linkRekomendasiRi},
          ${idFolderBerkas}, ${koordinatLink},
          'Proses Verifikasi', ${catatanPerbedaanNama},
          ${sesi.akunId}, 'SUKSES'
        )
        returning id
      `;
    });

    return { sukses: true, pesan: "Data dan berkas berhasil disimpan ke Database!" };
  } catch (error) {
    // Tangkap pelanggaran unique constraint (NIK/rekening/tempat tugas ganda lewat race condition)
    const msg = String(error);
    if (msg.includes("uq_penerima_nik")) {
      return { sukses: false, pesan: "GAGAL: NIK sudah terdaftar (race condition). Coba lagi." };
    }
    if (msg.includes("uq_penerima_rekening")) {
      return { sukses: false, pesan: "GAGAL: Nomor rekening sudah terdaftar (race condition). Coba lagi." };
    }
    if (msg.includes("uq_penerima_tempat_tugas")) {
      return {
        sukses: false,
        pesan: "GAGAL: Tempat tugas sudah memiliki penerima untuk layanan ini (race condition). Coba lagi.",
      };
    }
    return { sukses: false, pesan: "Gagal Sistem: " + msg };
  }
}

// ---------------------------------------------------------------------------
// Port dari editDataPenerima() — Kode.gs baris 2582-2763.
//
// PERUBAHAN ARSITEKTUR DISENGAJA (Fase 4):
// - `nomorBarisAsli` ditafsirkan sebagai `penerima.id` (bukan nomor baris sheet) — konsisten
//   dengan ambilDetailPenerimaPerBaris di atas.
// - Kolom berkas menerima URL Drive langsung (bukan base64) di editData.berkas[idx].
//   Frontend mengirim link baru setelah upload terpisah ke GAS microservice.
// - Hak akses edit menggunakan lolosAksesBarisLihatData (pengerasan RBAC konsisten).
// ---------------------------------------------------------------------------
export async function editDataPenerima(
  token: string,
  nomorBarisAsli: number,
  editData: {
    teks?: Record<string, string>;
    berkas?: Record<string, string>; // idx → URL Drive baru (bukan base64)
    idFolderBerkas?: string; // folder Drive baru dari uploadSemuaBerkasKeDrive, kalau baris belum punya
  },
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const id = Number(nomorBarisAsli);
  if (!id) return { sukses: false, pesan: "Nomor baris tidak valid." };

  try {
    // Ambil data baris saat ini
    const rows = await sql`
      select * from penerima where id = ${id} and tahun = ${TAHUN_AKTIF} limit 1
    `;
    if (rows.length === 0) return { sukses: false, pesan: "Baris tidak ditemukan." };
    const rowLama = rows[0];

    // ── Cek hak akses edit — RBAC identik dengan baca (lolosAksesBarisLihatData) ──
    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) return { sukses: false, pesan: "Anda tidak berhak mengedit data ini." };

    const bolehEdit = lolosAksesBarisLihatData({
      instansiPengguna,
      layananPengguna,
      namaKecamatanPengguna: sesi.kecamatan || "",
      kelurahanTerkunci: kelurahanTerkunciDari(sesi),
      subFilterGsm: subFilterGsmDari(sesi),
      listLayananKemenag,
      layananSheet: (rowLama.layanan || "").toString().toUpperCase(),
      kecamatanSheet: (rowLama.kecamatan || "").toString().toUpperCase(),
      kelurahanSheet: (rowLama.kelurahan || "").toString().toUpperCase(),
      tempatTugasSheet: (rowLama.tempat_tugas || "").toString().toUpperCase(),
    });
    if (!bolehEdit) return { sukses: false, pesan: "Anda tidak berhak mengedit data ini." };

    // ── Cek sakelar tutup (port Kode.gs baris 2618-2632) ──
    const peranSesi = (sesi.role || "").toString().trim().toUpperCase();
    const adalahKecKem = peranSesi === "KECAMATAN" || listLayananKemenag.includes(peranSesi);
    if (adalahKecKem) {
      const akses = await cekAksesInputUser(sesi.userId);
      if (akses.ditutup) {
        const pesan = akses.sumber === "KHUSUS"
          ? "Akses edit untuk akun Anda telah ditutup secara khusus oleh admin utama. Perubahan data hanya dapat dilakukan oleh Admin Utama Dinas Sosial Kota Medan berdasarkan surat resmi."
          : "Periode input telah ditutup. Perubahan data hanya dapat dilakukan oleh Admin Utama Dinas Sosial Kota Medan berdasarkan surat resmi dari instansi.";
        return { sukses: false, pesan };
      }
    }

    const teks = editData.teks || {};
    const berkas = editData.berkas || {};

    // ── Validasi duplikat bila NIK/rekening/tempat-tugas berubah (port Kode.gs baris 2656-2687) ──
    const nikBaruEdit = teks[2] !== undefined ? String(teks[2]).trim() : (rowLama.nik || "").toString().trim();
    const rekBaruEdit = teks[13] !== undefined ? String(teks[13]).trim() : (rowLama.nomor_rekening || "").toString().trim();
    const tempatTugasBaruEdit = rapikanTeks(teks[8] !== undefined ? teks[8] : rowLama.tempat_tugas);
    const alamatTugasBaruEdit = rapikanTeks(teks[9] !== undefined ? teks[9] : rowLama.alamat_tugas);
    const nikBerubah = teks[2] !== undefined && nikBaruEdit !== (rowLama.nik || "").toString().trim();
    const rekBerubah = teks[13] !== undefined && rekBaruEdit !== (rowLama.nomor_rekening || "").toString().trim();
    const tempatBerubah =
      tempatTugasBaruEdit !== rapikanTeks(rowLama.tempat_tugas) ||
      alamatTugasBaruEdit !== rapikanTeks(rowLama.alamat_tugas);
    const layananSheet = (rowLama.layanan || "").toString().trim().toUpperCase();

    if (nikBerubah) {
      const cekNik = await sql`
        select id from penerima
        where tahun = ${TAHUN_AKTIF} and nik = ${nikBaruEdit} and id <> ${id} limit 1
      `;
      if (cekNik.length > 0) {
        return { sukses: false, pesan: "GAGAL: NIK " + nikBaruEdit + " sudah terdaftar." };
      }
    }
    if (rekBerubah && rekBaruEdit) {
      const cekRek = await sql`
        select id from penerima
        where tahun = ${TAHUN_AKTIF} and nomor_rekening = ${rekBaruEdit} and id <> ${id} limit 1
      `;
      if (cekRek.length > 0) {
        return { sukses: false, pesan: "GAGAL: Nomor rekening " + rekBaruEdit + " sudah digunakan." };
      }
    }
    if (tempatBerubah && LAYANAN_BATASI_TEMPAT_TUGAS.includes(layananSheet)) {
      const cekTempat = await sql`
        select nama from penerima
        where tahun = ${TAHUN_AKTIF} and layanan = ${layananSheet}
          and tempat_tugas = ${tempatTugasBaruEdit} and alamat_tugas = ${alamatTugasBaruEdit}
          and id <> ${id}
        limit 1
      `;
      if (cekTempat.length > 0) {
        return {
          sukses: false,
          pesan: "GAGAL: " + tempatTugasBaruEdit + " sudah memiliki penerima untuk layanan " +
            layananSheet + " atas nama " + cekTempat[0].nama + ".",
        };
      }
    }

    // Validasi umur bila tanggal lahir berubah (port Kode.gs baris 2682-2687)
    if (teks[5] !== undefined) {
      const umurCekBaru = hitungUmur(String(teks[5]).trim());
      if (umurCekBaru !== null && umurCekBaru < 18) {
        return { sukses: false, pesan: "GAGAL: Usia di bawah 18 tahun tidak memenuhi syarat." };
      }
    }

    // ── Bangun SET clause dinamis ──
    const riwayat: Array<{ kolom: number; label: string; sebelum: string; sesudah: string }> = [];
    // deno-lint-ignore no-explicit-any
    const setValues: Record<string, any> = {};

    // Perubahan teks (port Kode.gs baris 2689-2713)
    for (const idxStr of Object.keys(teks)) {
      const idx = Number(idxStr);
      const namaKolom = MAP_IDX_KE_KOLOM_TEKS[idx];
      if (!namaKolom) continue;

      let nilaiBaru: string = String(teks[idxStr] || "").trim();
      // Uppercase kecuali kolom numerik/kontak (NIK=2, rekening=13, kontak=15)
      if (![2, 13, 15].includes(idx)) nilaiBaru = nilaiBaru.toUpperCase();

      const nilaiLama = (rowLama[namaKolom] !== null && rowLama[namaKolom] !== undefined)
        ? rowLama[namaKolom].toString().trim()
        : "";

      if (nilaiLama === nilaiBaru) continue;

      if (idx === 5) {
        // Tanggal lahir: konversi ke ISO untuk Postgres
        const isoDate = tglDDMMYYYYkeISO(nilaiBaru);
        if (isoDate) {
          setValues["tanggal_lahir"] = isoDate;
          // Hitung ulang umur sekaligus (port Kode.gs baris 2708-2713)
          const umurBaru = hitungUmur(nilaiBaru);
          if (umurBaru !== null) setValues["umur"] = umurBaru;
        }
      } else {
        setValues[namaKolom] = nilaiBaru;
      }

      riwayat.push({ kolom: idx, label: labelKolom(idx), sebelum: nilaiLama, sesudah: nilaiBaru });
    }

    // Perubahan berkas (port Kode.gs baris 2715-2747)
    // Menerima URL Drive langsung; upload sudah dilakukan di GAS microservice oleh frontend
    for (const idxStr of Object.keys(berkas)) {
      const idx = Number(idxStr);
      const namaKolom = MAP_IDX_KE_KOLOM_BERKAS[idx];
      if (!namaKolom) continue;

      const linkBaru = String(berkas[idxStr] || "").trim();
      if (!linkBaru) continue;

      const linkLama = (rowLama[namaKolom] || "").toString().trim();
      if (linkLama === linkBaru) continue;

      setValues[namaKolom] = linkBaru;
      riwayat.push({
        kolom: idx, label: labelKolom(idx),
        sebelum: linkLama ? "[link lama]" : "-",
        sesudah: "[link baru]",
      });
    }

    // Kalau berkas di-upload lebih dulu lewat uploadSemuaBerkasKeDrive dan baris ini belum punya
    // folder tersimpan (data lama), simpan ID folder yang baru dibuat — supaya edit berikutnya
    // reuse folder yang sama (port dari perilaku yang sama di Kode.gs editDataPenerima).
    if (editData.idFolderBerkas && !(rowLama.id_folder_berkas || "").toString().trim()) {
      setValues["id_folder_berkas"] = editData.idFolderBerkas;
    }

    if (Object.keys(setValues).length === 0) {
      return { sukses: true, pesan: "Data berhasil diperbarui (0 kolom diubah)." };
    }

    setValues["diperbarui_at"] = new Date().toISOString();

    // Bangun query UPDATE dinamis — postgres.js tidak mendukung dynamic SET via tagged template
    // sehingga kita gunakan sql.unsafe() dengan placeholder $N yang aman dari injection.
    const setCols = Object.keys(setValues);
    // deno-lint-ignore no-explicit-any
    const setVals = setCols.map((k) => setValues[k]);
    const setParts = setCols.map((col, i) => `${col} = $${i + 1}`).join(", ");
    const whereIdx = setCols.length + 1;

    // UPDATE data penerima secara langsung di Postgres
    await sql.unsafe(
      `update penerima set ${setParts} where id = $${whereIdx} and tahun = $${whereIdx + 1}`,
      [...setVals, id, TAHUN_AKTIF],
    );

    // ── Catat riwayat edit (port catatRiwayatEdit_ Kode.gs baris 3129-3146) ──
    if (riwayat.length > 0) {
      const namaPenerima = (rowLama.nama || "").toString().trim();
      for (const r of riwayat) {
        // Fire-and-forget: gagal catat riwayat TIDAK menggagalkan edit (sama seperti Kode.gs)
        sql`
          insert into riwayat_edit
            (waktu, editor_username, editor_role, penerima_id, tahun, nama_penerima,
             kolom_diubah, sebelum, sesudah)
          values (now(), ${sesi.username}, ${sesi.role}, ${id}, ${TAHUN_AKTIF},
                  ${namaPenerima}, ${r.label}, ${r.sebelum}, ${r.sesudah})
        `.catch((_e: unknown) => { /* diabaikan, sama seperti Logger.log di Kode.gs */ });
      }
    }

    return { sukses: true, pesan: `Data berhasil diperbarui (${riwayat.length} kolom diubah).` };
  } catch (e) {
    return { sukses: false, pesan: "Gagal mengedit data: " + String(e) };
  }
}
