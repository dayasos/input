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

  // Gunakan URL yang sudah disanitasi (Supabase Edge Function)
  let targetUrl = sanitizedTargetUrl;

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

  // Routing khusus untuk upload ke Google Drive.
  // Fallback ke URL GAS terbaru jika env var GAS_DRIVE_UPLOAD_URL belum diset di Vercel.
  if (payloadObj.action === 'uploadSatuBerkasKeDrive' || payloadObj.action === 'uploadSemuaBerkasKeDrive') {
    targetUrl = process.env.GAS_DRIVE_UPLOAD_URL || 'https://script.google.com/macros/s/AKfycbxGkGyb-Otakqpwn2-RpQQnfRZu9DdnH2Z8by-iZEzZ5CU3UIqNe2bIJwGnPLJQgmqIlQ/exec';
  }

  const secretToken = process.env.GAS_SECRET_TOKEN;
  if (!secretToken) {
    return res.status(500).json({
      error: 'Konfigurasi server tidak lengkap: GAS_SECRET_TOKEN belum diset. Hubungi administrator.',
    });
  }
  payloadObj._secret = secretToken;

  const REALTIME_CHECK_ACTIONS = new Set([
    'cekNikRealtime',
    'cekRekeningRealtime',
    'cekKuotaRealtime',
    'cekTempatTugasGandaRealtime',
    'cekKuotaTersedia',
    'ping',
  ]);
  const UPLOAD_ACTIONS = new Set([
    'simpanDataKeSheet',
    'editDataPenerima',
    'uploadSemuaBerkasKeSupabase',
    'mintaUrlUploadBerkas',
    'konfirmasiUploadBerkas',
    'uploadSatuBerkasKeDrive',
    'uploadSemuaBerkasKeDrive',
  ]);
  let timeoutMs;
  if (REALTIME_CHECK_ACTIONS.has(payloadObj.action)) {
    timeoutMs = 15000; // Fail fast — cek realtime tidak boleh block UI >15 detik
  } else if (payloadObj.action === 'validasiDataBaru') {
    timeoutMs = 25000; // Beberapa query paralel + kuota check
  } else if (UPLOAD_ACTIONS.has(payloadObj.action)) {
    timeoutMs = 50000; // Upload/simpan: payload besar, mendekati batas Vercel 60s
  } else {
    timeoutMs = 30000; // Default: 30s (lebih pendek dari 45s lama)
  }

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
    console.error(`Vercel Proxy Error for action [${payloadObj.action}] timeout=${timeoutMs}ms (${backendName}):`, err.message);

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
    // Deteksi khusus timeout agar pesan error lebih informatif di frontend
    const isTimeout = errString.includes('Batas waktu') || errString.includes('timeout') || errString.includes('abort');
    const pesanUser = isTimeout
      ? `Terjadi kesalahan koneksi antara server Vercel dan ${backendName}. Detail: ${errString}${causeStr}`
      : `Terjadi kesalahan koneksi antara server Vercel dan ${backendName}. Detail: ${errString}${causeStr}`;
    return res.status(500).json({
      error: pesanUser,
      action: payloadObj.action,
      details: errString,
      cause: causeStr,
      timeoutMs,
      usedUrl: targetUrl
    });
  }
}
