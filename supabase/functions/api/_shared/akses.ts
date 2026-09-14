import { getMasterLayanan } from "../domains/master.ts";
import type { DataSesi } from "./sesi.ts";

export type Instansi = "SUPERADMIN" | "KECAMATAN" | "KEMENAG";
export type SubFilterGsm = "" | "KATOLIK" | "BUKAN_KATOLIK";

// Port dari daftarLayananKemenagUpper_() di Kode.gs.
export async function daftarLayananKemenagUpper(): Promise<string[]> {
  const master = await getMasterLayanan();
  return master.kemenag.map((v) => v.toUpperCase());
}

/**
 * Port dari resolusi instansiPengguna/layananPengguna yang berulang di banyak fungsi Kode.gs
 * (ambilDataLihatDataHakAkses, ambilDetailPenerimaPerBaris, getDashboardProgresVerifikasi, dst).
 *
 * Selalu ikut mengembalikan `listLayananKemenag` (dihitung sekali di sini) — dulu tiap pemanggil
 * memanggil `daftarLayananKemenagUpper()` LAGI secara terpisah setelah ini untuk dapat list yang
 * SAMA (dibutuhkan `lolosAksesBarisLihatData`), jadi query ke `layanan_master` jalan 2x per
 * request di 4+ fungsi (penerima.ts, riwayat.ts, verifikasi.ts) — ditemukan saat code review.
 * Pemanggil sekarang cukup pakai field ini, jangan panggil `daftarLayananKemenagUpper()` lagi.
 */
export async function resolveInstansiPengguna(
  role: string,
): Promise<{ instansiPengguna: Instansi | null; layananPengguna: string; listLayananKemenag: string[] }> {
  const listLayananKemenag = await daftarLayananKemenagUpper();
  if (role === "UTAMA") return { instansiPengguna: "SUPERADMIN", layananPengguna: "", listLayananKemenag };
  if (role === "KECAMATAN") return { instansiPengguna: "KECAMATAN", layananPengguna: "", listLayananKemenag };
  if (listLayananKemenag.includes(role)) return { instansiPengguna: "KEMENAG", layananPengguna: role, listLayananKemenag };
  return { instansiPengguna: null, layananPengguna: "", listLayananKemenag };
}

/** Port dari pola "kalau USER_ID diawali 'KELURAHAN '" (ambilDataLihatDataHakAkses baris 1298-1301). */
export function kelurahanTerkunciDari(sesi: DataSesi): string {
  const userIdSesi = (sesi.userId || "").toString().toUpperCase().trim();
  return userIdSesi.indexOf("KELURAHAN ") === 0 ? userIdSesi.slice("KELURAHAN ".length).trim() : "";
}

/** Port dari sub-filter GSM Katolik/Kristen (ambilDataLihatDataHakAkses baris 1303-1308). */
export function subFilterGsmDari(sesi: DataSesi): SubFilterGsm {
  const userIdSesi = (sesi.userId || "").toString().toUpperCase().trim();
  if (userIdSesi === "BIMAS KATOLIK") return "KATOLIK";
  if (userIdSesi === "BIMAS KRISTEN") return "BUKAN_KATOLIK";
  return "";
}

/**
 * Port 1:1 dari cascade otorisasi baris di ambilDataLihatDataHakAkses() (Kode.gs baris 1347-1380):
 * instansi+layanan+kecamatan -> lapis kelurahan-terkunci -> lapis sub-filter GSM. Diekstrak jadi
 * satu fungsi (bukan disalin-tempel tiap kali dipakai) supaya ke depan tidak berisiko satu fungsi
 * baru "lupa" menerapkan salah satu lapis — persis kelas bug yang ditemukan code review pada
 * `ambilDataDetailByNik` di Kode.gs (lihat memori project-bug-akses-data-detail-gsm).
 */
export function lolosAksesBarisLihatData(params: {
  instansiPengguna: Instansi | null;
  layananPengguna: string;
  namaKecamatanPengguna: string;
  kelurahanTerkunci: string;
  subFilterGsm: SubFilterGsm;
  listLayananKemenag: string[];
  layananSheet: string;
  kecamatanSheet: string;
  kelurahanSheet: string;
  tempatTugasSheet: string;
}): boolean {
  const {
    instansiPengguna, layananPengguna, namaKecamatanPengguna, listLayananKemenag,
    layananSheet, kecamatanSheet, kelurahanSheet, tempatTugasSheet,
  } = params;

  let lolos = false;
  if (instansiPengguna === "KECAMATAN") {
    lolos = kecamatanSheet === namaKecamatanPengguna.toUpperCase() && !listLayananKemenag.includes(layananSheet);
  } else if (instansiPengguna === "KEMENAG") {
    if (listLayananKemenag.includes(layananSheet)) {
      if (layananPengguna) {
        if (layananSheet === layananPengguna.toUpperCase()) {
          lolos = namaKecamatanPengguna ? kecamatanSheet === namaKecamatanPengguna.toUpperCase() : true;
        }
      } else {
        lolos = true;
      }
    }
  } else if (instansiPengguna === "SUPERADMIN") {
    lolos = true;
  }

  if (lolos && params.kelurahanTerkunci) {
    lolos = kelurahanSheet === params.kelurahanTerkunci;
  }

  if (lolos && params.subFilterGsm === "KATOLIK") {
    lolos = tempatTugasSheet.includes("KATOLIK");
  } else if (lolos && params.subFilterGsm === "BUKAN_KATOLIK") {
    lolos = !tempatTugasSheet.includes("KATOLIK");
  }

  return lolos;
}
