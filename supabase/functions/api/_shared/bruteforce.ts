import { sql } from "./db.ts";

// Sama persis BATAS_PERCOBAAN_LOGIN & JENDELA_KUNCI_LOGIN_DETIK di Kode.gs
const BATAS_PERCOBAAN_LOGIN = 5;
const JENDELA_KUNCI_LOGIN_DETIK = 15 * 60;

/** Pengganti pengecekan CacheService "loginfail_<user>" >= BATAS_PERCOBAAN_LOGIN. */
export async function cekTerkunci(usernameUpper: string): Promise<boolean> {
  const rows = await sql`
    select 1 from login_percobaan_gagal
    where username_upper = ${usernameUpper}
      and jumlah_gagal >= ${BATAS_PERCOBAAN_LOGIN}
      and jendela_mulai > now() - make_interval(secs => ${JENDELA_KUNCI_LOGIN_DETIK})
    limit 1
  `;
  return rows.length > 0;
}

/**
 * Pengganti cache.put(kunciPercobaan, jumlah+1, JENDELA_KUNCI_LOGIN_DETIK).
 *
 * PENTING: `jendela_mulai` HARUS di-refresh ke now() di SETIAP percobaan gagal (bukan hanya saat
 * jendela lama sudah kedaluwarsa) — ini meniru perilaku CacheService.put() yang selalu me-reset TTL
 * 900 detik setiap kali dipanggil, membuatnya sliding window sungguhan. Versi sebelumnya hanya
 * me-refresh jendela_mulai saat sudah expired, sehingga jumlah_gagal bisa berosilasi 1-2 selamanya
 * pada penyerang yang mencoba ~1x tiap <15 menit dan TIDAK PERNAH mencapai BATAS_PERCOBAAN_LOGIN —
 * ditemukan saat code review, diperbaiki di sini.
 */
export async function catatGagal(usernameUpper: string): Promise<void> {
  await sql`
    insert into login_percobaan_gagal (username_upper, jumlah_gagal, jendela_mulai)
    values (${usernameUpper}, 1, now())
    on conflict (username_upper) do update set
      jumlah_gagal = case
        when login_percobaan_gagal.jendela_mulai > now() - make_interval(secs => ${JENDELA_KUNCI_LOGIN_DETIK})
          then login_percobaan_gagal.jumlah_gagal + 1
        else 1
      end,
      jendela_mulai = now()
  `;
}

/** Pengganti cache.remove(kunciPercobaan) saat login berhasil. */
export async function resetPercobaan(usernameUpper: string): Promise<void> {
  await sql`delete from login_percobaan_gagal where username_upper = ${usernameUpper}`;
}
