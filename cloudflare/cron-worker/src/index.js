// Worker khusus untuk cron harian "cekBatasWaktuVerifikasi" -- pengganti Vercel Cron
// (sebelumnya api/cron.js + blok "crons" di vercel.json).
//
// Env vars yang dibutuhkan (set lewat `wrangler secret put NAMA` atau dashboard Cloudflare,
// Workers & Pages -> djpm2027-cron -> Settings -> Variables):
//   GAS_SECRET_TOKEN          (wajib, rahasia)
//   SUPABASE_EDGE_FUNCTION_URL (wajib)
//   SUPABASE_ANON_KEY         (wajib)
//   CRON_SECRET               (opsional, hanya dipakai endpoint trigger manual di bawah)

function headerSupabase(url, anonKey) {
  return url.includes('supabase.co') ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {};
}

async function jalankanCekBatasWaktu(env) {
  const rawUrl = env.SUPABASE_EDGE_FUNCTION_URL || '';
  const supabaseUrl = rawUrl.trim().replace(/^["']|["']$/g, '');
  const gasSecret = env.GAS_SECRET_TOKEN;

  if (!supabaseUrl) throw new Error('SUPABASE_EDGE_FUNCTION_URL belum diset di environment worker ini.');
  if (!gasSecret) throw new Error('GAS_SECRET_TOKEN belum diset di environment worker ini.');

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Batas waktu permintaan ke Supabase terlampaui (25 detik)')),
    25000
  );

  try {
    const response = await fetch(supabaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headerSupabase(supabaseUrl, env.SUPABASE_ANON_KEY || ''),
      },
      body: JSON.stringify({ action: 'cekBatasWaktuVerifikasi', args: [], _secret: gasSecret }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = { error: 'Supabase Edge Function tidak mengembalikan respon JSON valid.', details: text.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  // Dipanggil otomatis oleh Cloudflare sesuai jadwal di wrangler.toml (18:00 UTC / 01:00 WIB).
  // Tidak lewat HTTP publik sama sekali, jadi tidak butuh CRON_SECRET atau pengecekan header
  // seperti versi Vercel (yang harus membedakan panggilan asli dari Vercel Cron vs orang iseng).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const hasil = await jalankanCekBatasWaktu(env);
          console.log('[cron] cekBatasWaktuVerifikasi selesai:', JSON.stringify(hasil).slice(0, 500));
        } catch (err) {
          console.error('[cron] cekBatasWaktuVerifikasi gagal:', err.message);
        }
      })()
    );
  },

  // Endpoint HTTP opsional utk trigger manual (mis. testing tanpa nunggu jadwal). WAJIB Bearer
  // token CRON_SECRET yang cocok. Kalau tidak dibutuhkan sama sekali, boleh hapus method fetch
  // ini -- worker akan tetap jalan normal via jadwal cron tanpa permukaan HTTP sama sekali.
  async fetch(request, env) {
    const cronSecret = env.CRON_SECRET || '';
    if (!cronSecret) {
      return new Response(JSON.stringify({ error: 'CRON_SECRET belum diset -- trigger manual dinonaktifkan.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Kredensial cron tidak sah' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      const hasil = await jalankanCekBatasWaktu(env);
      return new Response(
        JSON.stringify({ cron: 'cekBatasWaktuVerifikasi', timestamp: new Date().toISOString(), result: hasil }),
        { status: hasil.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ cron: 'cekBatasWaktuVerifikasi', timestamp: new Date().toISOString(), error: err.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
