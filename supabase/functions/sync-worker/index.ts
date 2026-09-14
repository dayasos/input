// Edge Function terpisah dari `api` — TIDAK dipanggil lewat proxy Vercel/dispatcher {action,args},
// dipicu internal oleh pg_cron + pg_net (lihat migrasi *_pg_net_dan_cron_sync.sql) tiap 1 menit.
// Tugas: proses antrian `sync_outbox` (diisi simpanDataKeSheet/editDataPenerima di domains/penerima.ts)
// -> tulis mirror ke sheet "Data Input <tahun>" lewat Google Sheets API v4.
//
// DESAIN PENTING: payload TIDAK disimpan snapshot di outbox saat enqueue — worker SELALU membaca
// ulang baris `penerima` TERKINI (fresh) saat memproses, supaya kalau ada beberapa edit beruntun
// sebelum worker sempat jalan, yang ter-sync ke sheet selalu data TERBARU, bukan snapshot basi.
// Konsekuensinya: beberapa entri outbox untuk baris yang sama boleh saja mem-produce hasil sync
// yang identik (redundan tapi tidak salah) — lebih aman daripada risiko menimpa data baru dengan
// data lama.
import { sql } from "../api/_shared/db.ts";
import { SS_ID_PENYIMPANAN, TAHUN_AKTIF } from "../api/_shared/config.ts";
import { formatTanggalDDMMYYYY, formatTanggalWaktuWIB } from "../api/_shared/tanggal.ts";
import { ambilAccessTokenGoogleSheets } from "../_shared/googleAuth.ts";

const NAMA_SHEET_INPUT = `Data Input ${TAHUN_AKTIF}`;
const UKURAN_BATCH = 20;
const MAKS_PERCOBAAN = 5;

interface BarisOutbox {
  id: number;
  jenis_operasi: string;
  entity_ref: { tabel: string; id: number; tahun: number };
  percobaan: number;
}

// Bangun array 40 kolom PERSIS urutan header "Data Input <tahun>" (lihat Kode.gs baris 946-956 /
// migrasi 20260907090200_penerima_partitioned.sql) dari satu baris `penerima`. Port dari susunan
// `dataLengkap` di ambilDetailPenerimaPerBaris (domains/penerima.ts), arah sebaliknya (Postgres ->
// tampilan sheet) — tanggal diformat DDMMYYYY/WIB (bukan ISO), NIK/rekening/kontak diberi prefix
// "'" (konvensi Sheets API force-text, resmi dikenali API ini — BEDA dari SheetJS di ekspor.ts
// yang JUSTRU rusak kalau dikasih trik ini, jangan disamakan).
function barisKeArraySheet(r: Record<string, unknown>): unknown[] {
  const teks = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const kutip = (v: unknown) => "'" + teks(v);
  return [
    r.nomor_urut ?? "",
    teks(r.nama),
    kutip(r.nik),
    teks(r.jenis_kelamin),
    teks(r.tempat_lahir),
    formatTanggalDDMMYYYY(r.tanggal_lahir as string),
    teks(r.alamat),
    teks(r.layanan),
    teks(r.tempat_tugas),
    teks(r.alamat_tugas),
    teks(r.kecamatan),
    teks(r.kelurahan),
    teks(r.nama_rekening),
    kutip(r.nomor_rekening),
    teks(r.kantor_cabang),
    kutip(r.no_kontak),
    teks(r.status_bpjs_tk),
    r.umur ?? "",
    teks(r.link_ktp),
    teks(r.link_buku_rekening),
    teks(r.link_surat_permohonan),
    teks(r.link_pernyataan_satu_bantuan),
    teks(r.link_domisili_kelurahan),
    teks(r.link_formulir_pendataan),
    teks(r.link_berkas_pendukung),
    teks(r.link_foto_plank_rumah_ibadah),
    teks(r.link_foto_lokasi_ibadah),
    teks(r.link_foto_kegiatan_belajar),
    teks(r.link_rekomendasi_bkm),
    teks(r.link_rekomendasi_rumah_ibadah),
    teks(r.id_folder_berkas),
    teks(r.link_koordinat_lokasi),
    teks(r.status_verifikasi),
    teks(r.keterangan_verifikasi),
    formatTanggalWaktuWIB(r.tanggal_verifikasi as string),
    teks(r.diverifikasi_oleh),
    formatTanggalDDMMYYYY(r.batas_waktu_perbaikan as string),
    teks(r.catatan_perbedaan_nama),
    formatTanggalWaktuWIB(r.tanggal_lapor_perbaikan as string),
    teks(r.dilapor_oleh),
  ];
}

async function ambilBarisPenerima(id: number, tahun: number) {
  const rows = await sql`select * from penerima where id = ${id} and tahun = ${tahun} limit 1`;
  return rows[0] || null;
}

async function sheetsFetch(path: string, init: RequestInit) {
  const token = await ambilAccessTokenGoogleSheets();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SS_ID_PENYIMPANAN}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const teksError = await res.text();
    throw new Error(`Sheets API gagal (${res.status}): ${teksError}`);
  }
  return res.json();
}

// INSERT: append baris baru ke akhir sheet, kembalikan nomor baris fisik hasilnya.
async function tulisBaru(nilai: unknown[]): Promise<number> {
  const range = encodeURIComponent(`'${NAMA_SHEET_INPUT}'!A:AN`);
  const data = await sheetsFetch(
    `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [nilai] }) },
  );
  // updatedRange contoh: "'Data Input 2027'!A1234:AN1234"
  const match = String(data.updates?.updatedRange || "").match(/![A-Z]+(\d+):/);
  if (!match) throw new Error(`Tidak bisa membaca nomor baris dari respons append: ${JSON.stringify(data)}`);
  return Number(match[1]);
}

// UPDATE: timpa baris yang sudah ada di nomor baris tertentu.
async function tulisUlang(nomorBaris: number, nilai: unknown[]): Promise<void> {
  const range = encodeURIComponent(`'${NAMA_SHEET_INPUT}'!A${nomorBaris}:AN${nomorBaris}`);
  await sheetsFetch(`/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [nilai] }),
  });
}

type HasilProses = "SUKSES" | "MENUNGGU";

async function prosesSatuOutbox(item: BarisOutbox): Promise<HasilProses> {
  if (item.entity_ref.tabel !== "penerima") {
    throw new Error(`entity_ref.tabel tidak dikenali: ${item.entity_ref.tabel}`);
  }

  const row = await ambilBarisPenerima(item.entity_ref.id, item.entity_ref.tahun);
  if (!row) {
    // Baris sudah tidak ada (dihapus?) -- tidak ada yang perlu disinkronkan lagi, anggap selesai.
    await sql`update sync_outbox set status='SUKSES', diproses_at=now() where id=${item.id}`;
    return "SUKSES";
  }

  if (item.jenis_operasi === "INSERT_PENERIMA") {
    const nomorBaris = await tulisBaru(barisKeArraySheet(row as Record<string, unknown>));
    await sql`update penerima set sheet_row_number=${nomorBaris} where id=${item.entity_ref.id}`;
    await sql`update sync_outbox set status='SUKSES', diproses_at=now() where id=${item.id}`;
    return "SUKSES";
  }

  if (item.jenis_operasi === "UPDATE_PENERIMA") {
    const nomorBaris = row.sheet_row_number as number | null;
    if (!nomorBaris) {
      // Baris belum pernah di-sync (INSERT_PENERIMA-nya belum diproses) -- BUKAN kegagalan,
      // cuma belum waktunya. Dikembalikan ke PENDING oleh pemanggil (bukan status SUKSES/GAGAL),
      // tanpa menambah `percobaan` -- akan otomatis kebereskan run berikutnya karena
      // INSERT_PENERIMA baris yang sama pasti diproses lebih dulu (id-nya lebih kecil).
      return "MENUNGGU";
    }
    await tulisUlang(nomorBaris, barisKeArraySheet(row as Record<string, unknown>));
    await sql`update sync_outbox set status='SUKSES', diproses_at=now() where id=${item.id}`;
    return "SUKSES";
  }

  throw new Error(`jenis_operasi tidak dikenali: ${item.jenis_operasi}`);
}

Deno.serve(async (req: Request) => {
  // Fungsi ini di-deploy dengan --no-verify-jwt (dipicu pg_cron+pg_net dari dalam Supabase, bukan
  // lewat dispatcher aksi `api` yang sudah punya gate `_secret`) — tanpa pengecekan ini, siapa pun
  // yang tahu URL-nya bisa memicu proses sync berulang-ulang (boros kuota Sheets API, bukan
  // kebocoran data karena respons cuma hitungan, tapi tetap sebaiknya dicegah).
  const secretDiharapkan = Deno.env.get("SYNC_WORKER_SECRET") || "";
  if (secretDiharapkan && req.headers.get("x-sync-secret") !== secretDiharapkan) {
    return new Response(JSON.stringify({ error: "Akses ditolak" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const batch = await sql<BarisOutbox[]>`
    select id, jenis_operasi, entity_ref, percobaan
    from sync_outbox
    where status = 'PENDING' and next_retry_at <= now()
    order by id asc
    limit ${UKURAN_BATCH}
  `;

  if (batch.length === 0) {
    return new Response(JSON.stringify({ diproses: 0 }), { headers: { "content-type": "application/json" } });
  }

  await sql`update sync_outbox set status='PROCESSING' where id = any(${batch.map((b) => b.id)})`;

  let sukses = 0;
  let gagal = 0;
  let ditunda = 0;

  // SEKUENSIAL (bukan Promise.all) -- urutan FIFO harus terjaga supaya INSERT_PENERIMA selalu
  // diproses sebelum UPDATE_PENERIMA baris yang sama (lihat catatan desain di atas file).
  for (const item of batch) {
    try {
      const hasil = await prosesSatuOutbox(item);
      if (hasil === "SUKSES") {
        sukses++;
      } else {
        // MENUNGGU: kembalikan ke PENDING apa adanya, TANPA menambah `percobaan` (bukan kegagalan).
        await sql`update sync_outbox set status='PENDING' where id=${item.id}`;
        ditunda++;
      }
    } catch (err) {
      const pesanError = err instanceof Error ? err.message : String(err);
      const percobaanBaru = item.percobaan + 1;
      if (percobaanBaru >= MAKS_PERCOBAAN) {
        await sql`
          insert into sync_dead_letter (outbox_id, jenis_operasi, sheet_tujuan, payload, error_terakhir)
          select id, jenis_operasi, ${NAMA_SHEET_INPUT}, entity_ref, ${pesanError} from sync_outbox where id=${item.id}
        `;
        await sql`update sync_outbox set status='GAGAL', percobaan=${percobaanBaru}, terakhir_error=${pesanError} where id=${item.id}`;
      } else {
        // Backoff linear sederhana: percobaan ke-N tunggu N menit sebelum dicoba lagi.
        await sql`
          update sync_outbox
          set status='PENDING', percobaan=${percobaanBaru}, terakhir_error=${pesanError},
              next_retry_at = now() + (${percobaanBaru} || ' minutes')::interval
          where id=${item.id}
        `;
      }
      gagal++;
    }
  }

  return new Response(
    JSON.stringify({ diproses: batch.length, sukses, gagal, ditunda }),
    { headers: { "content-type": "application/json" } },
  );
});
