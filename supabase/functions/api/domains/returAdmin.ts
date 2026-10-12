import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { muatExcelJS } from "../_shared/excelGaya.ts";
import { BULAN, bulanValid, returDaftarBulan, TEKS_BELUM_DIUSULKAN, tahunValid } from "./retur.ts";

// ---------------------------------------------------------------------------
// Modul Retur -- halaman ADMIN UTAMA (pengganti menu "Eksport Data" di Apps Script Retur lama):
// unggah Excel rekening retur dari bank -> cocokkan ke data_detail -> tabel data retur bulan itu
// (+ daftar rekening yang tidak ditemukan). Hasilnya bisa diunduh sebagai Excel.
//
// Format Excel bank (sama persis dengan yang dipakai Retur lama):
//   A1 = nama bulan (mis. AGUSTUS) | baris 2 kosong | baris 3 = header "NO. REK" | "NAMA" | data mulai baris 4.
// ---------------------------------------------------------------------------

// Batas dijaga di bawah batas badan permintaan proxy Vercel (4,5 MB; base64 = 4/3 ukuran berkas).
const MAKS_UKURAN_BASE64 = 2_800_000; // ±2 MB berkas asli; Excel rekening bulanan hanya beberapa KB
const MAKS_BARIS = 5000;
const MAKS_NAMA = 200; // batas panjang teks dari berkas/klien yang disimpan ke database
const MAKS_REKENING = 60;
const WARNA_HEADER_DATA = "FF2F5597"; // biru tua, sama dengan file "Retur Pembayaran Bulan X" lama
const WARNA_HEADER_GAGAL = "FFEA9999"; // merah muda, sama dengan "REKENING TIDAK DITEMUKAN" lama

async function wajibUtama(token: string) {
  const sesi = await wajibSesi(token);
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    throw new Error("Akses ditolak: halaman ini hanya untuk Admin Utama.");
  }
  return sesi;
}

// Nilai sel exceljs bisa string, angka, tanggal, atau objek (rich text / formula / hyperlink).
// deno-lint-ignore no-explicit-any
function teksSel(nilai: any): string {
  if (nilai === null || nilai === undefined) return "";
  if (typeof nilai === "object") {
    if (nilai instanceof Date) return nilai.toISOString().slice(0, 10);
    if (Array.isArray(nilai.richText)) return nilai.richText.map((p: { text?: string }) => p.text ?? "").join("");
    if (nilai.result !== undefined) return teksSel(nilai.result);
    if (nilai.text !== undefined) return teksSel(nilai.text);
    return "";
  }
  // Angka besar (nomor rekening) dicetak tanpa notasi ilmiah oleh String() selama < 1e21.
  return String(nilai).trim();
}

/** Nomor rekening dibandingkan hanya dari digitnya (spasi, titik, strip, apostrof diabaikan). */
function digitSaja(teks: string): string {
  return teks.replace(/[^0-9]/g, "");
}

interface BarisBank { rek: string; nama: string; barisExcel: number; tidakValid?: string }
interface HasilBacaBank { bulan: string; baris: BarisBank[]; duplikatDalamFile: number; peringatan: string[] }

export async function bacaExcelBank(base64: string): Promise<HasilBacaBank> {
  if (!base64 || typeof base64 !== "string") throw new Error("File Excel belum dipilih.");
  if (base64.length > MAKS_UKURAN_BASE64) throw new Error("File terlalu besar (maksimal 2 MB).");

  let bytes: Uint8Array;
  try {
    const biner = atob(base64);
    bytes = Uint8Array.from(biner, (c) => c.charCodeAt(0));
  } catch (_e) {
    throw new Error("Isi file tidak valid. Pilih ulang file Excel-nya.");
  }

  const ExcelJS = await muatExcelJS();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch (_e) {
    throw new Error("File bukan Excel .xlsx yang valid. Jika berformat .xls lama, simpan ulang sebagai .xlsx.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File Excel tidak memiliki sheet.");

  const bulan = teksSel(ws.getCell("A1").value).toUpperCase();
  if (!(BULAN as readonly string[]).includes(bulan)) {
    throw new Error(`Sel A1 harus berisi nama bulan (mis. AGUSTUS). Isi sel A1 sekarang: "${bulan || "kosong"}".`);
  }

  const peringatan: string[] = [];
  const hurufSaja = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const headerA = hurufSaja(teksSel(ws.getCell("A3").value));
  const headerB = hurufSaja(teksSel(ws.getCell("B3").value));
  if (!headerA.includes("rek") || !headerB.includes("nama")) {
    peringatan.push('Baris 3 bukan header "NO. REK" | "NAMA". Pastikan kolom A = nomor rekening dan kolom B = nama.');
  }

  const baris: BarisBank[] = [];
  const sudahAda = new Set<string>();
  let duplikatDalamFile = 0;
  // eachRow(includeEmpty:false): hanya baris yang berisi. Berkas yang diformat sampai jutaan baris kosong tidak ikut dipindai.
  // deno-lint-ignore no-explicit-any
  ws.eachRow({ includeEmpty: false }, (row: any, nomor: number) => {
    if (nomor < 4) return;
    const mentah = row.getCell(1).value;
    const rek = teksSel(mentah).slice(0, MAKS_REKENING);
    if (!rek) return;
    const nama = teksSel(row.getCell(2).value).slice(0, MAKS_NAMA);
    // Excel hanya menyimpan 15 digit signifikan pada sel ANGKA: nomor 16 digit ke atas yang diketik sebagai angka sudah
    // dibulatkan (digit terakhir jadi 0) dan bisa SALAH cocok dengan rekening penerima lain. Jangan dicocokkan.
    const tidakValid = typeof mentah === "number" && digitSaja(rek).length >= 16
      ? "Nomor rekening 16 digit ke atas tersimpan sebagai ANGKA di Excel (digit terakhir bisa berubah). Ubah kolom A menjadi format Teks lalu unggah ulang."
      : undefined;
    // Kunci duplikat dipisah untuk baris tidak valid: baris ANGKA yang rusak tidak boleh membuang baris TEKS yang valid
    // dengan digit yang sama.
    const kunci = (tidakValid ? "X:" : "") + (digitSaja(rek) || rek.toUpperCase());
    if (sudahAda.has(kunci)) { duplikatDalamFile++; return; }
    sudahAda.add(kunci);
    if (baris.length >= MAKS_BARIS) throw new Error(`Terlalu banyak baris (maksimal ${MAKS_BARIS} nomor rekening).`);
    baris.push({ rek, nama, barisExcel: nomor, tidakValid });
  });
  if (baris.length === 0) throw new Error("Tidak ada nomor rekening pada file (data dimulai dari baris 4, kolom A).");
  return { bulan, baris, duplikatDalamFile, peringatan };
}

function statusAktif(status: unknown): boolean {
  const s = String(status ?? "").toUpperCase();
  return s.includes("AKTIF") && !s.includes("TIDAK");
}

/**
 * Baca Excel bank, cocokkan rekening ke data_detail tahun yang dipilih, lalu (simpan=false) tampilkan PRATINJAU
 * atau (simpan=true) simpan ke retur_impor / retur_daftar / retur_rek_tidak_ditemukan.
 * Menyimpan ulang berkas yang sama aman: baris yang sudah ada dilewati (tidak ganda, riwayat proses tidak tersentuh).
 */
export async function returImporBank(
  token: string, tahun: number | undefined, base64: string, namaFile: string, simpan: boolean,
) {
  try {
    const sesi = await wajibUtama(token);
    const t = tahunValid(tahun);
    const baca = await bacaExcelBank(base64);
    const bulan = bulanValid(baca.bulan);

    const normalisasi = baca.baris.filter((b) => !b.tidakValid).map((b) => digitSaja(b.rek)).filter((x) => x !== "");
    const unikNormalisasi = [...new Set(normalisasi)];
    // deno-lint-ignore no-explicit-any
    const ditemukan: Record<string, any>[] = unikNormalisasi.length === 0 ? [] : await sql`
      select id, nama_rekening, nik, jenis_kelamin, alamat, layanan, nomor_rekening, kecamatan, kelurahan,
             tempat_tugas, no_kontak, status, regexp_replace(coalesce(nomor_rekening, ''), '[^0-9]', '', 'g') as rek_norm
      from data_detail
      where tahun = ${t}
        and regexp_replace(coalesce(nomor_rekening, ''), '[^0-9]', '', 'g') in ${sql(unikNormalisasi)}
      order by id
    `;
    const perRekening = new Map<string, typeof ditemukan>();
    for (const d of ditemukan) {
      const daftar = perRekening.get(d.rek_norm) ?? [];
      daftar.push(d);
      perRekening.set(d.rek_norm, daftar);
    }

    const cocok: Record<string, unknown>[] = [];
    const tidakDitemukan: { no: number; nama: string; nomorRekening: string; keterangan: string }[] = [];
    let rekeningGanda = 0;
    for (const b of baca.baris) {
      const kunci = b.tidakValid ? "" : digitSaja(b.rek);
      const kandidat = kunci ? perRekening.get(kunci) : undefined;
      if (!kandidat || kandidat.length === 0) {
        tidakDitemukan.push({
          no: tidakDitemukan.length + 1,
          nama: b.nama,
          nomorRekening: b.rek,
          keterangan: b.tidakValid ?? (kunci ? "Tidak ditemukan di Data Detail" : "Nomor rekening tidak valid (bukan angka)"),
        });
        continue;
      }
      if (kandidat.length > 1) rekeningGanda++;
      const d = kandidat[0]; // data_detail dengan id terkecil
      cocok.push({
        dataDetailId: Number(d.id),
        namaRekening: d.nama_rekening ?? "",
        nik: d.nik ?? "",
        jenisKelamin: d.jenis_kelamin ?? "",
        alamat: d.alamat ?? "",
        layanan: d.layanan ?? "",
        nomorRekening: d.nomor_rekening ?? "",
        kecamatan: d.kecamatan ?? "",
        kelurahan: d.kelurahan ?? "",
        tempatTugas: d.tempat_tugas ?? "",
        noKontak: (d.no_kontak || "-").toString().replace(/^'+/, "").trim() || "-",
        statusPenerima: d.status ?? "",
      });
    }

    const idCocok = cocok.map((c) => Number(c.dataDetailId));
    // deno-lint-ignore no-explicit-any
    const sudahAdaRows: Record<string, any>[] = idCocok.length === 0 ? [] : await sql`
      select data_detail_id from retur_daftar
      where tahun = ${t} and bulan = ${bulan} and data_detail_id in ${sql(idCocok)}
    `;
    const sudahAda = new Set(sudahAdaRows.map((r) => Number(r.data_detail_id)));
    const cocokBertanda = cocok.map((c, i) => ({ no: i + 1, ...c, sudahAda: sudahAda.has(Number(c.dataDetailId)) }));

    // Rekening tidak ditemukan yang sudah tercatat pada unggahan sebelumnya (bulan yang sama) tidak dihitung baru.
    // deno-lint-ignore no-explicit-any
    const tercatatRows: Record<string, any>[] = await sql`
      select distinct g.nomor_rekening
      from retur_rek_tidak_ditemukan g join retur_impor i on i.id = g.impor_id
      where i.tahun = ${t} and i.bulan = ${bulan}
    `;
    const sudahTercatatPratinjau = new Set(tercatatRows.map((x) => digitSaja(x.nomor_rekening ?? "")));
    const tidakDitemukanBaru = tidakDitemukan.filter((g) => !sudahTercatatPratinjau.has(digitSaja(g.nomorRekening))).length;

    const ringkasan = {
      barisDibaca: baca.baris.length,
      cocok: cocok.length,
      tidakDitemukan: tidakDitemukan.length,
      tidakDitemukanBaru,
      duplikatDalamFile: baca.duplikatDalamFile,
      rekeningGanda,
      sudahAdaSebelumnya: sudahAda.size,
      barisBaru: cocok.length - sudahAda.size,
      penerimaNonAktif: cocok.filter((c) => !statusAktif(c.statusPenerima)).length,
    };

    const namaBerkas = String(namaFile || "").slice(0, MAKS_NAMA);
    const hasil = {
      sukses: true, tahun: t, bulan, namaFile: namaBerkas, ringkasan,
      peringatan: baca.peringatan, cocok: cocokBertanda, tidakDitemukan,
    };
    // Hanya `true` (boolean) yang menyimpan; nilai lain (mis. teks "false" dari klien lain) dianggap pratinjau.
    if (simpan !== true) return { ...hasil, pratinjau: true, tersimpan: false };

    // ---- simpan (satu transaksi) ----
    let tersimpanBaru = 0, tidakBaru = 0, imporId: number | null = null;
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      // Serialkan penyimpanan untuk (tahun, bulan) yang sama: tanpa ini dua admin yang menyimpan bersamaan bisa sama-sama
      // menganggap sebuah rekening "tidak ditemukan" itu baru dan menggandakannya.
      await trx`select pg_advisory_xact_lock(hashtext(${"retur_impor:" + t + ":" + bulan}))`;
      const barisBaru = cocok.filter((c) => !sudahAda.has(Number(c.dataDetailId)));
      const rekSudahTercatat = await trx`
        select distinct g.nomor_rekening
        from retur_rek_tidak_ditemukan g join retur_impor i on i.id = g.impor_id
        where i.tahun = ${t} and i.bulan = ${bulan}
      `;
      const sudahTercatat = new Set(rekSudahTercatat.map((r: { nomor_rekening: string }) => digitSaja(r.nomor_rekening ?? "")));
      const gagalBaru = tidakDitemukan.filter((g) => !sudahTercatat.has(digitSaja(g.nomorRekening)));

      if (barisBaru.length === 0 && gagalBaru.length === 0) return; // tidak ada yang baru -> tidak membuat catatan impor
      const imp = await trx`
        insert into retur_impor (tahun, bulan, nama_file, jumlah_baris, jumlah_cocok, jumlah_tidak_cocok, diunggah_oleh_akun_id)
        values (${t}, ${bulan}, ${namaBerkas || null}, ${baca.baris.length}, ${cocok.length}, ${tidakDitemukan.length}, ${sesi.akunId})
        returning id
      `;
      imporId = Number(imp[0].id);

      for (let i = 0; i < barisBaru.length; i += 200) {
        const potong = barisBaru.slice(i, i + 200).map((c) => ({
          tahun: t, bulan, data_detail_id: c.dataDetailId, impor_id: imporId,
          nama_rekening: c.namaRekening, nik: c.nik, jenis_kelamin: c.jenisKelamin, alamat: c.alamat,
          layanan: c.layanan, nomor_rekening: c.nomorRekening, kecamatan: c.kecamatan,
          kelurahan: c.kelurahan, tempat_tugas: c.tempatTugas, no_kontak: c.noKontak,
        }));
        const masuk = await trx`
          insert into retur_daftar ${trx(potong,
            "tahun", "bulan", "data_detail_id", "impor_id", "nama_rekening", "nik", "jenis_kelamin", "alamat",
            "layanan", "nomor_rekening", "kecamatan", "kelurahan", "tempat_tugas", "no_kontak")}
          on conflict (tahun, bulan, data_detail_id) do nothing
          returning id
        `;
        tersimpanBaru += masuk.length;
      }
      for (let i = 0; i < gagalBaru.length; i += 200) {
        const potong = gagalBaru.slice(i, i + 200).map((g) => ({ impor_id: imporId, nomor_rekening: g.nomorRekening, nama: g.nama }));
        await trx`insert into retur_rek_tidak_ditemukan ${trx(potong, "impor_id", "nomor_rekening", "nama")}`;
        tidakBaru += potong.length;
      }
    });

    return {
      ...hasil, pratinjau: false, tersimpan: true, imporId, tersimpanBaru, tidakDitemukanBaru: tidakBaru,
      pesan: tersimpanBaru === 0 && tidakBaru === 0
        ? "Tidak ada data baru: seluruh baris pada file ini sudah tersimpan sebelumnya."
        : `Tersimpan: ${tersimpanBaru} data retur baru, ${tidakBaru} rekening tidak ditemukan baru.`,
    };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}

/** Riwayat unggahan Excel bank satu tahun (khusus Admin Utama). */
export async function returDaftarImpor(token: string, tahun?: number) {
  try {
    await wajibUtama(token);
    const t = tahunValid(tahun);
    const rows = await sql`
      select i.id, i.bulan, i.nama_file, i.jumlah_baris, i.jumlah_cocok, i.jumlah_tidak_cocok, i.dibuat_at, a.username
      from retur_impor i left join akun a on a.id = i.diunggah_oleh_akun_id
      where i.tahun = ${t}
      order by i.dibuat_at desc, i.id desc
      limit 200
    `;
    return {
      sukses: true, tahun: t,
      rows: rows.map((r: Record<string, unknown>) => ({
        id: Number(r.id), bulan: r.bulan, namaFile: r.nama_file ?? "", jumlahBaris: r.jumlah_baris,
        jumlahCocok: r.jumlah_cocok, jumlahTidakCocok: r.jumlah_tidak_cocok, waktu: r.dibuat_at, oleh: r.username ?? "",
      })),
    };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Unduh Excel
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function susunExcelBase64(namaSheet: string, header: string[], baris: any[][], lebar: number[], warnaHeader: string, kolomTeks: number[]) {
  const ExcelJS = await muatExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(namaSheet);
  ws.addRow(header);
  for (const b of baris) ws.addRow(b);
  ws.columns = lebar.map((w) => ({ width: w }));
  const tipis = { style: "thin" as const };
  const garis = { top: tipis, left: tipis, bottom: tipis, right: tipis };
  for (let r = 1; r <= baris.length + 1; r++) {
    for (let k = 1; k <= header.length; k++) {
      const sel = ws.getCell(r, k);
      sel.border = garis;
      if (r > 1 && kolomTeks.includes(k)) sel.numFmt = "@"; // NIK / rekening / kontak tetap teks (nol di depan tidak hilang)
      if (r === 1) {
        sel.font = { bold: true, color: { argb: "FFFFFFFF" } };
        sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: warnaHeader } };
        sel.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      }
    }
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const mentah = await wb.xlsx.writeBuffer();
  const buf: Uint8Array = mentah instanceof Uint8Array ? mentah : new Uint8Array(mentah);
  let biner = "";
  for (let i = 0; i < buf.length; i += 8192) biner += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(biner);
}

/**
 * Tabel data retur satu bulan sebagai Excel ("Retur Pembayaran Bulan X <tahun>", sheet ALL):
 * NO | NAMA PADA REKENING | NIK | JK | ALAMAT | LAYANAN | NOMOR REKENING | KECAMATAN | KELURAHAN | NO. KONTAK | STATUS SETELAH PERBAIKAN.
 * Boleh dipanggil semua peran: isinya disaring menurut hak akses pemanggil (kecamatan hanya kecamatannya, dst).
 */
export async function returUnduhExcelBulan(token: string, tahun: number | undefined, bulan: string) {
  try {
    const hasil = await returDaftarBulan(token, tahun, bulan);
    if (!hasil.sukses) return hasil;
    // deno-lint-ignore no-explicit-any
    const rows = (hasil as any).rows as Record<string, any>[];
    if (rows.length === 0) return { sukses: false, pesan: "Belum ada data retur untuk bulan ini pada akses Anda." };
    const header = ["NO", "NAMA PADA REKENING", "NIK", "JK", "ALAMAT", "LAYANAN", "NOMOR REKENING", "KECAMATAN", "KELURAHAN", "NO. KONTAK", "STATUS SETELAH PERBAIKAN"];
    const baris = rows.map((r, i) => [
      i + 1, r.namaRekening, r.nik, r.jenisKelamin, r.alamat, r.layanan, r.nomorRekening,
      r.kecamatan, r.kelurahan, r.noKontak || "-", r.statusSetelahPerbaikan || TEKS_BELUM_DIUSULKAN,
    ]);
    const base64 = await susunExcelBase64("ALL", header, baris, [6, 30, 20, 12, 44, 26, 20, 22, 22, 16, 46], WARNA_HEADER_DATA, [3, 7, 10]);
    // deno-lint-ignore no-explicit-any
    const h = hasil as any;
    return { sukses: true, base64, namaFile: `Retur Pembayaran Bulan ${h.bulan} ${h.tahun}.xlsx` };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}

/** Daftar rekening dari bank yang tidak ditemukan di data_detail untuk satu bulan (khusus Admin Utama). */
export async function returUnduhExcelTidakDitemukan(token: string, tahun: number | undefined, bulan: string) {
  try {
    await wajibUtama(token);
    const t = tahunValid(tahun);
    const b = bulanValid(bulan);
    const rows = await sql`
      select g.nama, g.nomor_rekening
      from retur_rek_tidak_ditemukan g join retur_impor i on i.id = g.impor_id
      where i.tahun = ${t} and i.bulan = ${b}
      order by g.id
    `;
    if (rows.length === 0) return { sukses: false, pesan: "Tidak ada rekening yang tidak ditemukan untuk bulan ini." };
    const header = ["NO", "NAMA PENERIMA YANG RETUR", "NOMOR REKENING", "KETERANGAN"];
    // deno-lint-ignore no-explicit-any
    const baris = rows.map((r: Record<string, any>, i: number) => [
      i + 1, r.nama ?? "", r.nomor_rekening ?? "", "Tidak ditemukan di Data Detail",
    ]);
    const base64 = await susunExcelBase64("REKENING TIDAK DITEMUKAN", header, baris, [6, 36, 22, 36], WARNA_HEADER_GAGAL, [3]);
    return { sukses: true, base64, namaFile: `REKENING TIDAK DITEMUKAN - ${b} ${t}.xlsx` };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}
