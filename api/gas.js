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
    // Secret WAJIB diset lewat env var -- TIDAK ADA LAGI fallback ke nilai default yang
    // tertulis di kode (2026-09-15, insiden: nilai default itu ketahuan masih dipakai di
    // produksi, celah keamanan nyata karena siapa pun yang baca source code tahu nilainya).
    // Ping test dilewati sama sekali kalau secret belum diset -- daripada diam-diam mengirim
    // nilai yang bisa ditebak.
    const secretDikonfigurasi = Boolean(process.env.GAS_SECRET_TOKEN);
    let pingStatus = 'untested';

    if (!secretDikonfigurasi) {
      pingStatus = { error: 'GAS_SECRET_TOKEN belum diset di environment ini -- ping dilewati.' };
    } else {
      try {
        const pingController = new AbortController();
        const pingTimer = setTimeout(() => pingController.abort(new Error('Ping timeout')), 6000);

        const testRes = await fetch(sanitizedTargetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Connection': 'close'
          },
          body: JSON.stringify({
            action: 'ping',
            _secret: process.env.GAS_SECRET_TOKEN
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
    }

    return res.status(200).json({
      status: 'API Proxy Online',
      envConfigured: Boolean(rawEnv),
      secretConfigured: secretDikonfigurasi,
      activeBackendUrl: sanitizedTargetUrl,
      isUsingDefaultTarget: sanitizedTargetUrl === DEFAULT_TARGET_URL && rawEnv !== DEFAULT_TARGET_URL,
      pingTest: pingStatus
    });
  }

  // 2. Hanya izinkan POST untuk pemanggilan fungsi backend
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3. Gunakan URL yang telah disanitasi (default)
  let targetUrl = sanitizedTargetUrl;

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

  // Routing khusus untuk upload ke Google Drive
  if (payloadObj.action === 'uploadSatuBerkasKeDrive' || payloadObj.action === 'uploadSemuaBerkasKeDrive') {
    const driveUrl = process.env.GAS_DRIVE_UPLOAD_URL || 'https://script.google.com/macros/s/AKfycbzrAA20sJ_U0RtzoCEElKUusHJJQm8K-I83R0Ckyxru9F1H-UW9r31Cc9YATp66tKGSRQ/exec';
    if (driveUrl) {
      targetUrl = driveUrl;
    } else {
      return res.status(500).json({ error: 'Konfigurasi server tidak lengkap: GAS_DRIVE_UPLOAD_URL belum diset.' });
    }
  }

  // WAJIB diset lewat env var Vercel -- TIDAK ADA LAGI fallback ke nilai default (2026-09-15,
  // lihat catatan di health-check GET di atas). Gagal keras & tolak permintaan daripada diam-diam
  // memakai secret yang tertulis di source code dan bisa ditebak siapa saja.
  const secretToken = process.env.GAS_SECRET_TOKEN;
  if (!secretToken) {
    return res.status(500).json({
      error: 'Konfigurasi server tidak lengkap: GAS_SECRET_TOKEN belum diset. Hubungi administrator.',
    });
  }
  payloadObj._secret = secretToken;

  // simpanDataKeSheet/editDataPenerima/mintaUrlUploadBerkas/konfirmasiUploadBerkas dan operasi berkas
  // memiliki payload atau proses multi-tahap. Timeout dilonggarkan menjadi 50 detik (mendekati
  // maxDuration Vercel: 60s). Operasi umum lainnya dinaikkan menjadi 45 detik agar cold-start
  // Deno isolate di Supabase tidak pernah terputus prematur di 20 detik.
  const UPLOAD_ACTIONS = new Set([
    'simpanDataKeSheet',
    'editDataPenerima',
    'uploadSemuaBerkasKeSupabase',
    'mintaUrlUploadBerkas',
    'konfirmasiUploadBerkas',
    'uploadSatuBerkasKeDrive',
    'uploadSemuaBerkasKeDrive'
  ]);
  const isUploadAction = UPLOAD_ACTIONS.has(payloadObj.action);
  const timeoutMs = isUploadAction ? 50000 : 45000;

  const anonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cXhic2N1bWFha3Z6aXd6d2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjQ2MTMsImV4cCI6MjEwNDEwMDYxM30.W0hJsUzcnYaOWfF-NHKR1F3RnJR8j-vJsDDqBF636hQ';

  const requestHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Connection': 'close'
  };

  // Sertakan apikey dan Authorization Bearer token untuk Kong Gateway Supabase
  if (targetUrl.includes('supabase.co')) {
    requestHeaders['apikey'] = anonKey;
    requestHeaders['Authorization'] = `Bearer ${anonKey}`;
  }

  const fetchOptions = {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(payloadObj),
    redirect: 'follow'
  };

  // Dideklarasikan di sini (bukan di dalam try di bawah) supaya tetap terjangkau dari blok
  // catch terluar — kalau di dalam try, tidak terjangkau di catch pasangannya (ReferenceError
  // saat backend mengembalikan respon bukan-JSON).
  let text = '';
  let data = null;

  // 5. Eksekusi fetch murni ke Supabase
  // Retry 0x di proxy Vercel karena dengan timeout 45s-50s, retry ganda akan melampaui batas keras 60s
  // Vercel. SWR cache di browser (js/api-bridge.js) yang bertugas menangani retry jika dibutuhkan.
  try {
    const response = await fetchWithRetry(targetUrl, fetchOptions, 0, timeoutMs);
    text = await response.text();
    data = JSON.parse(text);

    return res.status(200).json(data);
  } catch (err) {
    const backendName = targetUrl.includes('script.google.com') ? 'Google Drive Microservice (Apps Script)' : 'Supabase Edge Function';
    console.error(`Vercel Proxy Error for action [${payloadObj.action}] (${backendName}):`, err);

    // Bedakan antara respon bukan JSON (parse error) vs kesalahan jaringan/timeout
    if (err instanceof SyntaxError) {
      return res.status(502).json({
        error: `${backendName} tidak mengembalikan respon JSON valid. Pastikan endpoint aktif dan dapat diakses.`,
        action: payloadObj.action,
        details: text ? text.slice(0, 500) : err.message,
        usedUrl: targetUrl
      });
    }

    const causeStr = err.cause ? ` (Penyebab: ${err.cause.message || err.cause.code || String(err.cause)})` : '';
    const errString = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: `Terjadi kesalahan koneksi antara server Vercel dan ${backendName}. Detail: ${errString}${causeStr}`,
      action: payloadObj.action,
      details: errString,
      cause: causeStr,
      usedUrl: targetUrl
    });
  }
}
