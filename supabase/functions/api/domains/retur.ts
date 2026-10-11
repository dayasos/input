import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { TAHUN_AKTIF } from "../_shared/config.ts";
import {
  kelurahanTerkunciDari,
  lolosAksesBarisLihatData,
  resolveInstansiPengguna,
  subFilterGsmDari,
} from "../_shared/akses.ts";

// ---------------------------------------------------------------------------
// Modul Retur (Fase 1: BACA SAJA). Pengganti dashboard aplikasi Retur lama (Apps Script).
// Tidak ada login terpisah: memakai sesi Input. Hak akses baris = fungsi bersama
// `lolosAksesBarisLihatData` (kecamatan / kelurahan terkunci / layanan Kemenag / sub-filter GSM),
// sama persis dengan "Lihat Data" -- jangan menulis ulang aturan akses di sini.
// ---------------------------------------------------------------------------

export const BULAN = [
  "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
  "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER",
] as const;

type SesiLogin = Awaited<ReturnType<typeof wajibSesi>>;

// Status kerja yang ditampilkan untuk penerima yang ada di daftar retur tapi belum diproses.
const STATUS_BELUM = "BELUM DIUSULKAN";

/** Pembuat penyaring baris sesuai hak akses sesi. `tempatTugas` dibutuhkan sub-filter GSM Katolik/Kristen. */
async function buatPenyaringAkses(sesi: SesiLogin) {
  const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
  if (!instansiPengguna) throw new Error("Peran tidak dikenali.");
  const namaKecamatanPengguna = sesi.kecamatan || "";
  const kelurahanTerkunci = kelurahanTerkunciDari(sesi);
  const subFilterGsm = subFilterGsmDari(sesi);

  // Parameter bertipe `Record<string, any>` karena baris dari postgres.js bertipe `Row` (indeks bebas);
  // kolom yang dibaca selalu ada di SELECT pemanggil (layanan, kecamatan, kelurahan, tempat_tugas).
  // deno-lint-ignore no-explicit-any
  return (b: Record<string, any>) =>
    lolosAksesBarisLihatData({
      instansiPengguna,
      layananPengguna,
      namaKecamatanPengguna,
      kelurahanTerkunci,
      subFilterGsm,
      listLayananKemenag,
      layananSheet: (b.layanan || "").toUpperCase(),
      kecamatanSheet: (b.kecamatan || "").toUpperCase(),
      kelurahanSheet: (b.kelurahan || "").toUpperCase(),
      tempatTugasSheet: (b.tempat_tugas || "").toUpperCase(),
    });
}

function tahunValid(tahun?: number): number {
  const t = Number(tahun) || TAHUN_AKTIF;
  if (!Number.isInteger(t) || t < 2000 || t > 2100) throw new Error("Tahun tidak valid.");
  return t;
}

function bulanValid(bulan?: string): string {
  const b = String(bulan || "").trim().toUpperCase();
  if (!(BULAN as readonly string[]).includes(b)) throw new Error("Bulan tidak valid.");
  return b;
}

function statusTampil(statusKerja: string | null, kendala: string | null): string {
  if (!statusKerja) return STATUS_BELUM;
  if (statusKerja === "KENDALA" && kendala) return `KENDALA: ${kendala}`;
  return statusKerja;
}

/**
 * Ringkasan per bulan untuk satu tahun: total retur, sudah dibayar, proses, kendala, belum diusulkan,
 * dan persen realisasi (sudah dibayar / total). Hanya menghitung baris yang boleh dilihat sesi ini.
 */
export async function returRingkasan(token: string, tahun?: number) {
  try {
    const sesi = await wajibSesi(token);
    const t = tahunValid(tahun);
    const boleh = await buatPenyaringAkses(sesi);

    const rows = await sql`
      select r.bulan, r.layanan, r.kecamatan, r.kelurahan, d.tempat_tugas,
             p.status_kerja, p.kendala
      from retur_daftar r
      join data_detail d on d.id = r.data_detail_id and d.tahun = r.tahun
      left join retur_proses p on p.tahun = r.tahun and p.bulan = r.bulan and p.data_detail_id = r.data_detail_id
      where r.tahun = ${t}
    `;

    const per: Record<string, { total: number; sudahDibayarkan: number; proses: number; kendala: number; belum: number }> = {};
    for (const b of BULAN) per[b] = { total: 0, sudahDibayarkan: 0, proses: 0, kendala: 0, belum: 0 };
    for (const r of rows) {
      if (!boleh(r)) continue;
      const p = per[r.bulan];
      if (!p) continue;
      p.total++;
      if (r.status_kerja === "SUDAH DIBAYARKAN") p.sudahDibayarkan++;
      else if (r.status_kerja === "PROSES PEMBAYARAN") p.proses++;
      else if (r.status_kerja === "KENDALA") p.kendala++;
      else p.belum++;
    }

    const bulan = BULAN.map((nama) => {
      const p = per[nama];
      return { bulan: nama, ...p, persenRealisasi: p.total ? Math.round((p.sudahDibayarkan / p.total) * 1000) / 10 : 0 };
    });
    return { sukses: true, tahun: t, bulan };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}

/** Rincian daftar retur satu bulan beserta status kerjanya (hanya baris yang boleh dilihat sesi ini). */
export async function returDaftarBulan(token: string, tahun: number | undefined, bulan: string) {
  try {
    const sesi = await wajibSesi(token);
    const t = tahunValid(tahun);
    const b = bulanValid(bulan);
    const boleh = await buatPenyaringAkses(sesi);

    const rows = await sql`
      select r.data_detail_id, r.nama_rekening, r.nik, r.jenis_kelamin, r.alamat, r.layanan,
             r.nomor_rekening, r.kecamatan, r.kelurahan, r.no_kontak, d.tempat_tugas,
             p.nomor_perbaikan, p.status_kerja, p.kendala, p.diubah_at
      from retur_daftar r
      join data_detail d on d.id = r.data_detail_id and d.tahun = r.tahun
      left join retur_proses p on p.tahun = r.tahun and p.bulan = r.bulan and p.data_detail_id = r.data_detail_id
      where r.tahun = ${t} and r.bulan = ${b}
      order by r.layanan, r.kecamatan, r.kelurahan, r.nama_rekening
    `;

    const hasil = [];
    for (const r of rows) {
      if (!boleh(r)) continue;
      hasil.push({
        dataDetailId: Number(r.data_detail_id),
        namaRekening: r.nama_rekening,
        nik: r.nik,
        jenisKelamin: r.jenis_kelamin,
        alamat: r.alamat,
        layanan: r.layanan,
        nomorRekening: r.nomor_rekening,
        kecamatan: r.kecamatan,
        kelurahan: r.kelurahan,
        noKontak: (r.no_kontak || "").toString().replace(/^'+/, "").trim(),
        nomorPerbaikan: r.nomor_perbaikan ?? null,
        statusKerja: r.status_kerja ?? null,
        kendala: r.kendala ?? null,
        statusTampil: statusTampil(r.status_kerja, r.kendala),
        diubahAt: r.diubah_at ?? null,
      });
    }
    return { sukses: true, tahun: t, bulan: b, rows: hasil };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cari satu penerima (NIK persis, atau potongan nama) di seluruh bulan satu tahun: tampilkan semua
 * kemunculannya di daftar retur beserta status dan riwayat prosesnya. Hanya baris yang boleh dilihat.
 */
export async function returCari(token: string, tahun: number | undefined, kata: string) {
  try {
    const sesi = await wajibSesi(token);
    const t = tahunValid(tahun);
    const q = String(kata || "").trim();
    if (q.length < 3) return { sukses: false, pesan: "Isi minimal 3 karakter NIK atau nama." };
    const boleh = await buatPenyaringAkses(sesi);
    const pola = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

    const rows = await sql`
      select r.data_detail_id, r.bulan, r.nama_rekening, r.nik, r.layanan, r.nomor_rekening,
             r.kecamatan, r.kelurahan, d.tempat_tugas,
             p.id as proses_id, p.nomor_perbaikan, p.status_kerja, p.kendala
      from retur_daftar r
      join data_detail d on d.id = r.data_detail_id and d.tahun = r.tahun
      left join retur_proses p on p.tahun = r.tahun and p.bulan = r.bulan and p.data_detail_id = r.data_detail_id
      where r.tahun = ${t} and (r.nik = ${q} or r.nama_rekening ilike ${pola})
      order by r.nik, r.dibuat_at
      limit 200
    `;
    const diizinkan = rows.filter((r) => boleh(r));

    const idProses = diizinkan.map((r) => r.proses_id).filter((x) => x != null).map(Number);
    const riwayat = idProses.length
      ? await sql`
          select proses_id, waktu, oleh_nama, aksi, nomor_perbaikan, kendala, catatan
          from retur_riwayat where proses_id in ${sql(idProses)} order by waktu
        `
      : [];
    const riwayatPer = new Map<number, unknown[]>();
    for (const h of riwayat) {
      const k = Number(h.proses_id);
      if (!riwayatPer.has(k)) riwayatPer.set(k, []);
      riwayatPer.get(k)!.push({
        waktu: h.waktu, oleh: h.oleh_nama, aksi: h.aksi,
        nomorPerbaikan: h.nomor_perbaikan, kendala: h.kendala, catatan: h.catatan,
      });
    }

    return {
      sukses: true,
      tahun: t,
      rows: diizinkan.map((r) => ({
        dataDetailId: Number(r.data_detail_id),
        bulan: r.bulan,
        namaRekening: r.nama_rekening,
        nik: r.nik,
        layanan: r.layanan,
        nomorRekening: r.nomor_rekening,
        kecamatan: r.kecamatan,
        kelurahan: r.kelurahan,
        nomorPerbaikan: r.nomor_perbaikan ?? null,
        statusTampil: statusTampil(r.status_kerja, r.kendala),
        riwayat: r.proses_id != null ? (riwayatPer.get(Number(r.proses_id)) ?? []) : [],
      })),
    };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}
