import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { KECAMATAN_MEDAN_URUT, TAHUN_AKTIF } from "../_shared/config.ts";
import { kelurahanTerkunciDari, subFilterGsmDari } from "../_shared/akses.ts";
import { getMasterLayanan } from "./master.ts";

interface KartuDashboard {
  layanan: string;
  kecamatanLabel: string | null;
  total: number;
  prosesVerifikasi: number;
  memenuhiSyarat: number;
  tidakMemenuhiSyarat: number;
  berkasTidakLengkap: number;
  kuota: number;
  sisaKuota: number;
}

// Port 1:1 dari getDashboardProgresVerifikasi() (Kode.gs baris 1788-1930). BUKAN row-filter seperti
// domain penerima/riwayat — ini agregasi kartu statistik per layanan (atau per layanan×kecamatan
// untuk akun Kemenag tanpa kecamatan tetap), digabung dgn 2 sumber kuota (`kuota` + `kuota_katolik`).
// Kontrak dipertahankan: objek biasa (BUKAN JSON.stringify string), field kartu dipakai by-name
// langsung oleh index.html (renderDashboardProgres, baris 4754-4780) — nama field harus persis sama.
export async function getDashboardProgresVerifikasi(token: string, kecamatanFilter?: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const role = (sesi.role || "").toString().trim().toUpperCase();
    const kecUser = (sesi.kecamatan || "").toString().trim().toUpperCase();
    const kecFilterInput = (kecamatanFilter || "").toString().trim().toUpperCase();
    const kelurahanTerkunci = kelurahanTerkunciDari(sesi);
    const subFilterGsm = subFilterGsmDari(sesi);

    // Filter SQL dinamis berdasarkan hak akses user untuk memangkas latensi query & pemakaian memori
    let filterClause = sql``;
    if (role === "KECAMATAN" && kecUser) {
      filterClause = sql`and upper(kecamatan) = ${kecUser} ${kelurahanTerkunci ? sql`and upper(kelurahan) = ${kelurahanTerkunci}` : sql``}`;
    } else if (role === "UTAMA" && kecFilterInput) {
      filterClause = sql`and upper(kecamatan) = ${kecFilterInput}`;
    } else if (role !== "UTAMA" && role !== "KECAMATAN") {
      const layKemenag = (sesi.role || "").toString().trim().toUpperCase();
      if (kecUser) {
        filterClause = sql`and upper(layanan) = ${layKemenag} and upper(kecamatan) = ${kecUser}`;
      } else {
        filterClause = sql`and upper(layanan) = ${layKemenag}`;
      }
    }

    // 4 query di bawah tidak saling bergantung -> jalankan paralel (Promise.all), bukan berurutan
    // (ditemukan saat code review — hasil akhir identik, cuma latensi dashboard ~4x lebih cepat).
    const [rowsKuota, rowsKuotaKatolik, master, barisSnapshot] = await Promise.all([
      sql`select kecamatan, layanan, kuota_maks from kuota`,
      sql`select kecamatan, layanan, kuota_maks from kuota_katolik`,
      getMasterLayanan(),
      sql`
        select layanan, kecamatan, kelurahan, tempat_tugas, status_verifikasi
        from penerima
        where tahun = ${TAHUN_AKTIF} ${filterClause}
      `,
    ]);

    // Kuota gabungan (semua layanan) -> map "LAYANAN||KECAMATAN" -> angka.
    const kuotaMap: Record<string, number> = {};
    for (const r of rowsKuota) {
      const kecK = (r.kecamatan || "").toUpperCase();
      const layK = (r.layanan || "").toUpperCase();
      kuotaMap[layK + "||" + kecK] = Number(r.kuota_maks) || 0;
    }

    // Kuota khusus Katolik (subset dari kuota GSM gabungan di atas) -> map yang sama.
    const kuotaKatolikMap: Record<string, number> = {};
    for (const r of rowsKuotaKatolik) {
      const kecK = (r.kecamatan || "").toUpperCase();
      const layK = (r.layanan || "").toUpperCase();
      kuotaKatolikMap[layK + "||" + kecK] = Number(r.kuota_maks) || 0;
    }

    let layananRelevan: string[];
    if (role === "UTAMA") {
      layananRelevan = [...(master.kecamatan || []), ...(master.kemenag || [])];
    } else if (role === "KECAMATAN") {
      layananRelevan = (master.kecamatan || []).slice();
    } else {
      layananRelevan = [sesi.role];
    }

    // Kemenag TANPA kecamatan tetap -> pecah jadi 21 kartu (1 per kecamatan) untuk layanan itu.
    const modeKecamatanPisah = role !== "UTAMA" && role !== "KECAMATAN" && !kecUser;

    const rekap: Record<string, KartuDashboard> = {};
    const kunciKartu = (lay: string, kec: string) => (modeKecamatanPisah ? lay + "||" + kec : lay);

    if (modeKecamatanPisah) {
      const lay = (layananRelevan[0] || "").toString().trim().toUpperCase();
      for (const kec of KECAMATAN_MEDAN_URUT) {
        rekap[kunciKartu(lay, kec)] = {
          layanan: layananRelevan[0],
          kecamatanLabel: kec,
          total: 0,
          prosesVerifikasi: 0,
          memenuhiSyarat: 0,
          tidakMemenuhiSyarat: 0,
          berkasTidakLengkap: 0,
          kuota: 0,
          sisaKuota: 0,
        };
      }
    } else {
      for (const lay of layananRelevan) {
        rekap[lay.toString().trim().toUpperCase()] = {
          layanan: lay,
          kecamatanLabel: null,
          total: 0,
          prosesVerifikasi: 0,
          memenuhiSyarat: 0,
          tidakMemenuhiSyarat: 0,
          berkasTidakLengkap: 0,
          kuota: 0,
          sisaKuota: 0,
        };
      }
    }

    for (const r of barisSnapshot) {
      const lay = (r.layanan || "").toString().trim().toUpperCase();
      const kec = (r.kecamatan || "").toString().trim().toUpperCase();
      const kel = (r.kelurahan || "").toString().trim().toUpperCase();
      const tempatTugas = (r.tempat_tugas || "").toString().trim().toUpperCase();
      if (!lay) continue;

      if (role === "KECAMATAN" && kec !== kecUser) continue;
      if (role !== "UTAMA" && role !== "KECAMATAN" && kecUser && kec !== kecUser) continue;
      if (kecFilterInput && role === "UTAMA" && kec !== kecFilterInput) continue;
      if (kelurahanTerkunci && kel !== kelurahanTerkunci) continue;
      if (subFilterGsm === "KATOLIK" && !tempatTugas.includes("KATOLIK")) continue;
      if (subFilterGsm === "BUKAN_KATOLIK" && tempatTugas.includes("KATOLIK")) continue;

      const kunci = kunciKartu(lay, kec);
      if (!(kunci in rekap)) continue;

      const status = (r.status_verifikasi || "Proses Verifikasi").toString().trim();
      rekap[kunci].total++;
      if (status === "Memenuhi Syarat") rekap[kunci].memenuhiSyarat++;
      else if (status === "Tidak Memenuhi Syarat") rekap[kunci].tidakMemenuhiSyarat++;
      else if (status === "Berkas Tidak Lengkap") rekap[kunci].berkasTidakLengkap++;
      else rekap[kunci].prosesVerifikasi++;
    }

    const kartu = Object.values(rekap).map((item) => {
      const layUpper = item.layanan.toString().trim().toUpperCase();
      let kuota = 0;

      if (modeKecamatanPisah) {
        kuota = kuotaMap[layUpper + "||" + item.kecamatanLabel] || 0;
      } else if (role === "UTAMA" && kecFilterInput) {
        kuota = kuotaMap[layUpper + "||" + kecFilterInput] || 0;
      } else if (kecUser) {
        kuota = kuotaMap[layUpper + "||" + kecUser] || 0;
      } else {
        for (const kec of KECAMATAN_MEDAN_URUT) kuota += kuotaMap[layUpper + "||" + kec] || 0;
      }

      // Khusus admin GSM Katolik/Kristen: pecah kuota gabungan di atas jadi porsi masing-masing.
      if (subFilterGsm === "KATOLIK" || subFilterGsm === "BUKAN_KATOLIK") {
        const kecUntukKuota = item.kecamatanLabel || kecUser || kecFilterInput;
        const kuotaKatolikKec = kuotaKatolikMap[layUpper + "||" + kecUntukKuota] || 0;
        kuota = subFilterGsm === "KATOLIK" ? kuotaKatolikKec : kuota - kuotaKatolikKec;
      }

      item.kuota = kuota;
      item.sisaKuota = kuota - item.total;
      return item;
    });

    if (modeKecamatanPisah) {
      kartu.sort(
        (a, b) =>
          KECAMATAN_MEDAN_URUT.indexOf(a.kecamatanLabel || "") -
          KECAMATAN_MEDAN_URUT.indexOf(b.kecamatanLabel || ""),
      );
    }

    return { sukses: true, kartu, bisaFilterKecamatan: role === "UTAMA" };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}
