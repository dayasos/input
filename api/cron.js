// Endpoint Vercel Cron untuk menjalankan cekBatasWaktuVerifikasi setiap malam jam 01.00 WIB.
// Di vercel.json:
//   "crons": [{ "path": "/api/cron", "schedule": "0 18 * * *" }]
//   (18:00 UTC = 01:00 WIB, karena WIB = UTC+7)

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  // Hanya terima POST (Vercel Cron) atau GET dengan Authorization header (manual trigger)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verifikasi CRON_SECRET (opsional tapi disarankan)
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (token !== cronSecret && !isVercelCron) {
      return res.status(401).json({ error: 'Unauthorized: Kredensial cron tidak sah' });
    }
  }

  const rawUrl = process.env.SUPABASE_EDGE_FUNCTION_URL ||
    (process.env.GAS_API_URL && process.env.GAS_API_URL.includes('/functions/v1/') ? process.env.GAS_API_URL : '');
  const supabaseUrl = rawUrl ? rawUrl.trim().replace(/^["']|["']$/g, '') : '';
  const gasSecret = process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET';

  if (!supabaseUrl) {
    return res.status(500).json({
      error: 'SUPABASE_EDGE_FUNCTION_URL belum diset di environment variables Vercel.'
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Batas waktu permintaan ke Supabase terlampaui (25 detik)')), 25000);

  try {
    const response = await fetch(supabaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'cekBatasWaktuVerifikasi',
        args: [],
        _secret: gasSecret
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = {
        error: 'Supabase Edge Function tidak mengembalikan respon JSON valid.',
        details: text.slice(0, 500)
      };
    }

    return res.status(response.ok ? 200 : 500).json({
      cron: 'cekBatasWaktuVerifikasi',
      timestamp: new Date().toISOString(),
      result: data
    });
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({
      cron: 'cekBatasWaktuVerifikasi',
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
