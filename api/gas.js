export const config = {
  maxDuration: 60,
};

// Sebelumnya bernama DEFAULT_GAS_URL (fallback ke Google Apps Script kalau env var kosong/tidak
// valid). Diganti 2026-09-15 sebagai bagian dari keputusan "murni Supabase" — GAS tidak lagi
// dipakai sama sekali oleh proxy ini, baik sebagai target utama maupun fallback darurat, jadi
// nilai default-nya pun diarahkan ke Supabase Edge Function, bukan lagi ke GAS.
const DEFAULT_TARGET_URL = 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api';

// Fungsi helper untuk fetch dengan retry dan timeout per-request
async function fetchWithRetry(url, options, maxRetries = 1, timeoutMs = 15000) {
  let lastError = null;
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Batas waktu permintaan terlampaui (${timeoutMs / 1000} detik)`)), timeoutMs);

    try {
      const optWithSignal = { ...options, signal: controller.signal };
      const res = await fetch(url, optWithSignal);
      clearTimeout(timer);

      // Jika status 502, 503, 504 dari server backend, kita retry
      if (!res.ok && (res.status === 502 || res.status === 503 || res.status === 504)) {
        if (i === maxRetries) return res;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (i === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

// GAS masih diterima sebagai URL yang SAH (isGas) murni sebagai escape hatch operasional darurat
// lewat env var — bukan sesuatu yang otomatis dipakai proxy ini. Selama GAS_API_URL/
// SUPABASE_EDGE_FUNCTION_URL tidak sengaja diisi URL script.google.com, jalur ini tidak pernah
// dipakai.
function sanitizeUrl(raw) {
  if (!raw) return DEFAULT_TARGET_URL;
  let u = raw.trim().replace(/^["']|["']$/g, '');
  if (u.startsWith('ttps://')) u = 'h' + u; // Otomatis perbaiki jika huruf 'h' tertinggal saat copy-paste
  if (u.startsWith('http://') && !u.includes('localhost') && !u.includes('127.0.0.1')) {
    u = 'https://' + u.slice(7);
  }
  const isGas = u.startsWith('https://script.google.com/macros/s/');
  const isSupabase = u.includes('/functions/v1/');
  if (!isGas && !isSupabase) {
    return DEFAULT_TARGET_URL;
  }
  return u;
}

export default async function handler(req, res) {
  // Tangani CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // Dukung GAS_API_URL maupun SUPABASE_EDGE_FUNCTION_URL dari Vercel Environment Variables
  const rawEnv = process.env.GAS_API_URL || process.env.SUPABASE_EDGE_FUNCTION_URL || '';
  const sanitizedTargetUrl = sanitizeUrl(rawEnv);

  // 1. Endpoint Health-Check jika diakses via GET
  if (req.method === 'GET') {
    let pingStatus = 'untested';

    try {
      const pingController = new AbortController();
      const pingTimer = setTimeout(() => pingController.abort(new Error('Ping timeout')), 6000);

      const testRes = await fetch(sanitizedTargetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        },
        body: JSON.stringify({
          action: 'ping',
          _secret: process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET'
        }),
        signal: pingController.signal
      });
      clearTimeout(pingTimer);
      pingStatus = { status: testRes.status, ok: testRes.ok };
    } catch (pingErr) {
      pingStatus = {
        error: pingErr.message,
        cause: pingErr.cause ? (pingErr.cause.message || pingErr.cause.code || String(pingErr.cause)) : null
      };
    }

    return res.status(200).json({
      status: 'API Proxy Online',
      envConfigured: Boolean(rawEnv),
      activeBackendUrl: sanitizedTargetUrl,
      isUsingDefaultTarget: sanitizedTargetUrl === DEFAULT_TARGET_URL && rawEnv !== DEFAULT_TARGET_URL,
      pingTest: pingStatus
    });
  }

  // 2. Hanya izinkan POST untuk pemanggilan fungsi backend
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3. Gunakan URL yang telah disanitasi
  const targetUrl = sanitizedTargetUrl;

  // 4. Siapkan payload dan injeksi Secret Token
  let payloadObj = {};
  try {
    if (req.body) {
      payloadObj = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (e) {
    return res.status(400).json({ error: 'Format JSON payload tidak valid', details: e.message });
  }

  if (!payloadObj || typeof payloadObj !== 'object' || Array.isArray(payloadObj)) {
    payloadObj = {};
  }

  const secretToken = process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET';
  payloadObj._secret = secretToken;

  // simpanDataKeSheet/editDataPenerima/uploadSemuaBerkasKeSupabase membawa berkas (base64) yang
  // di-upload — payload bisa besar & lambat di jaringan lemah. Meng-abort lalu me-retry hanya
  // mengulang unggahan lambat yang sama (tidak mempercepat), jadi aksi ini diberi timeout lebih
  // longgar tapi tanpa retry pada target yang sama.
  const UPLOAD_ACTIONS = new Set(['simpanDataKeSheet', 'editDataPenerima', 'uploadSemuaBerkasKeSupabase']);
  const isUploadAction = UPLOAD_ACTIONS.has(payloadObj.action);

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    },
    body: JSON.stringify(payloadObj),
    redirect: 'follow'
  };

  // Dideklarasikan di sini (bukan di dalam try di bawah) supaya tetap terjangkau dari blok
  // catch terluar — kalau di dalam try, tidak terjangkau di catch pasangannya (ReferenceError
  // saat backend mengembalikan respon bukan-JSON).
  let text = '';
  let data = null;

  // 5. Eksekusi fetch murni ke Supabase -- TIDAK ADA LAGI fallback lintas-backend ke GAS
  // (dihapus total 2026-09-15, keputusan "murni Supabase"). Sebelumnya di sini ada percobaan
  // otomatis ke Google Apps Script kalau panggilan pertama gagal, KHUSUS untuk aksi baca yang
  // dianggap aman -- tapi itu justru menambah satu titik gagal ekstra (GAS punya cold-start &
  // keandalan lebih rendah dari Supabase Edge Function) tanpa manfaat lagi sekarang semua data
  // sudah murni di Supabase. Kalau permintaan ke Supabase gagal, error dikembalikan langsung
  // supaya SWR cache di browser (js/api-bridge.js) yang menangani retry, bukan proxy ini diam-diam
  // mencoba backend lain.
  try {
    const response = await fetchWithRetry(targetUrl, fetchOptions, isUploadAction ? 0 : 1, isUploadAction ? 40000 : 15000);
    text = await response.text();
    data = JSON.parse(text);

    return res.status(200).json(data);
  } catch (err) {
    console.error('Vercel Proxy Error (Supabase Edge Function):', err);

    // Bedakan antara respon bukan JSON (parse error) vs kesalahan jaringan/timeout
    if (err instanceof SyntaxError) {
      return res.status(502).json({
        error: 'Supabase Edge Function tidak mengembalikan respon JSON valid. Pastikan Function aktif dan dapat diakses.',
        details: text ? text.slice(0, 500) : err.message,
        usedUrl: targetUrl
      });
    }

    return res.status(500).json({
      error: 'Terjadi kesalahan koneksi antara server Vercel dan Supabase Edge Function.',
      details: err.toString(),
      cause: err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : null,
      usedUrl: targetUrl
    });
  }
}
