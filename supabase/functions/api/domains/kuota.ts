import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { KECAMATAN_MEDAN_URUT, TAHUN_AKTIF } from "../_shared/config.ts";
import { getMasterLayanan } from "./master.ts";

interface BarisKuota {
  kecamatan: string;
  layanan: string;
  kuota: number | string;
}

// Port 1:1 dari getSemuaKuota() — array polos [{kecamatan, layanan, kuota}], dipakai langsung
// sebagai `daftarKuotaCache` di index.html (baris 4941-4942) tanpa pembungkus {sukses,...}.
//
// PENTING: kegagalan sesi SENGAJA dibiarkan melempar (bukan ditangkap jadi array kosong).
// Versi sebelumnya menangkap error sesi lalu mengembalikan [] -- akibatnya modal "Kelola Kuota"
// selalu tampil "Belum ada data kuota tersimpan" saat token kedaluwarsa/tidak sah, walau data di
// tabel `kuota` ada (mis. 336 baris di produksi), menyesatkan admin mengira migrasi belum
// selesai. Dengan melempar, index.ts akan membalikkan {error:...} dan google.script.run shim di
// api-bridge.js otomatis mendeteksi pesan "SESI TIDAK SAH" lalu menampilkan modal login ulang --
// bukan diam-diam menampilkan tabel kosong.
export async function getSemuaKuota(token: string) {
  await wajibSesi(token);
  const rows = await sql<BarisKuota[]>`select kecamatan, layanan, kuota_maks as kuota from kuota`;
  return rows.map((r: BarisKuota) => ({ kecamatan: r.kecamatan, layanan: r.layanan, kuota: Number(r.kuota) || 0 }));
}

// Port dari simpanKuota() — hanya UTAMA. Kode.gs pakai LockService + scan-manual (find-then-update-
// or-append) karena Sheets tidak punya upsert atomik; di Postgres cukup INSERT..ON CONFLICT (atomik
// secara native, tidak perlu lock eksplisit). Deteksi insert-vs-update pakai trik `xmax = 0` supaya
// pesan sukses ("diperbarui" vs "ditambahkan") tetap sama seperti aslinya.
export async function simpanKuota(token: string, kecamatan: string, layanan: string, kuota: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if (sesi.role !== "UTAMA") {
    return { sukses: false, pesan: "Akses ditolak: hanya Admin Utama yang dapat mengubah kuota." };
  }

  try {
    const kecUpper = String(kecamatan || "").trim().toUpperCase();
    const layUpper = String(layanan || "").trim().toUpperCase();
    const kuotaNum = Number(kuota) || 0;

    const rows = await sql`
      insert into kuota (kecamatan, layanan, kuota_maks, diperbarui_at)
      values (${kecUpper}, ${layUpper}, ${kuotaNum}, now())
      on conflict (kecamatan, layanan) do update set kuota_maks = ${kuotaNum}, diperbarui_at = now()
      returning (xmax = 0) as inserted
    `;
    const diubah = !rows[0].inserted;

    return { sukses: true, pesan: diubah ? "Kuota berhasil diperbarui." : "Kuota berhasil ditambahkan." };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari getProgresKuota() — khusus Admin Utama. Pemakaian (jumlah input per
// layanan+kecamatan) dihitung via SQL GROUP BY (bukan loop JS di atas snapshot sheet) — hasil
// akhirnya sama, cuma lebih murah karena agregasi dilakukan di Postgres.
export async function getProgresKuota(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  try {
    const master = await getMasterLayanan();
    const urutanLayanan: string[] = [];
    for (const l of master.kecamatan || []) {
      const u = l.toString().trim().toUpperCase();
      if (!urutanLayanan.includes(u)) urutanLayanan.push(u);
    }
    for (const l of master.kemenag || []) {
      const u = l.toString().trim().toUpperCase();
      if (!urutanLayanan.includes(u)) urutanLayanan.push(u);
    }

    const rowsKuota = await sql`select kecamatan, layanan, kuota_maks from kuota`;
    const kuotaMap: Record<string, number> = {};
    const setLayananDenganKuota = new Set<string>();
    for (const r of rowsKuota) {
      const lay = (r.layanan || "").toUpperCase();
      const kec = (r.kecamatan || "").toUpperCase();
      kuotaMap[lay + "||" + kec] = Number(r.kuota_maks) || 0;
      setLayananDenganKuota.add(lay);
    }

    const rowsPemakaian = await sql`
      select layanan, kecamatan, count(*)::int as jumlah
      from penerima
      where tahun = ${TAHUN_AKTIF}
      group by layanan, kecamatan
    `;
    const pemakaian: Record<string, number> = {};
    for (const r of rowsPemakaian) {
      const lay = (r.layanan || "").toUpperCase();
      const kec = (r.kecamatan || "").toUpperCase();
      if (!lay || !kec) continue;
      pemakaian[lay + "||" + kec] = r.jumlah;
    }

    // deno-lint-ignore no-explicit-any
    const grup: any[] = [];
    for (const lay of urutanLayanan) {
      if (!setLayananDenganKuota.has(lay)) continue;

      // deno-lint-ignore no-explicit-any
      const baris: any[] = [];
      let totalKuota = 0;
      let totalInput = 0;
      for (const kec of KECAMATAN_MEDAN_URUT) {
        const key = lay + "||" + kec;
        if (!(key in kuotaMap)) continue;
        const kuotaNilai = kuotaMap[key];
        const input = pemakaian[key] || 0;
        const persen = kuotaNilai > 0 ? Math.round((input / kuotaNilai) * 1000) / 10 : 0;
        totalKuota += kuotaNilai;
        totalInput += input;
        baris.push({ kecamatan: kec, kuota: kuotaNilai, input, sisa: kuotaNilai - input, persen });
      }
      if (baris.length === 0) continue;

      const persenLayanan = totalKuota > 0 ? Math.round((totalInput / totalKuota) * 1000) / 10 : 0;
      grup.push({ layanan: lay, totalKuota, totalInput, persenLayanan, baris });
    }

    return { sukses: true, grup };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}
