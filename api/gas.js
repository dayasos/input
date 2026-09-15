export const config = {
  maxDuration: 60,
};

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwQvkJ_6McDWi6erkIfP6CAnRu0L1f8ipIk18k7SltwQS-xhXyd-atnbaTNBdq0hjHyVg/exec';

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

function sanitizeUrl(raw) {
  if (!raw) return DEFAULT_GAS_URL;
  let u = raw.trim().replace(/^["']|["']$/g, '');
  if (u.startsWith('ttps://')) u = 'h' + u; // Otomatis perbaiki jika huruf 'h' tertinggal saat copy-paste
  if (u.startsWith('http://') && !u.includes('localhost') && !u.includes('127.0.0.1')) {
    u = 'https://' + u.slice(7);
  }
  const isGas = u.startsWith('https://script.google.com/macros/s/');
  const isSupabase = u.includes('/functions/v1/');
  if (!isGas && !isSupabase) {
    return DEFAULT_GAS_URL;
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
      isUsingFallback: sanitizedTargetUrl === DEFAULT_GAS_URL && rawEnv !== DEFAULT_GAS_URL,
      pingTest: pingStatus
    });
  }

  // 2. Hanya izinkan POST untuk pemanggilan fungsi backend
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3. Gunakan URL yang telah disanitasi
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

  const secretToken = process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET';
  payloadObj._secret = secretToken;

  // simpanDataKeSheet/editDataPenerima/uploadSemuaBerkasKeSupabase membawa berkas (base64) yang
  // di-upload — payload bisa besar & lambat di jaringan lemah. Meng-abort lalu me-retry hanya
  // mengulang unggahan lambat yang sama (tidak mempercepat), jadi aksi ini diberi timeout lebih
  // longgar tapi tanpa retry pada target yang sama.
  const UPLOAD_ACTIONS = new Set(['simpanDataKeSheet', 'editDataPenerima', 'uploadSemuaBerkasKeSupabase']);
  const isUploadAction = UPLOAD_ACTIONS.has(payloadObj.action);

  // Upload berkas sekarang ke Supabase Storage (uploadSemuaBerkasKeSupabase, 2026-09-15) — tidak
  // ada lagi aksi yang wajib dipaksa ke GAS apa pun target utama yang aktif. uploadSemuaBerkasKeDrive
  // lama di Kode.gs dibiarkan ada (tidak dihapus, cadangan darurat) tapi tidak dipanggil lagi.

  // Fallback lintas-backend (GAS <-> Supabase Edge Function) HANYA aman untuk aksi baca murni.
  // GAS menulis ke Google Sheets, Supabase Edge Function menulis ke Postgres — dua penyimpanan
  // terpisah yang (pada tahap migrasi ini) belum disinkronkan otomatis dua arah. Kalau aksi TULIS
  // gagal di backend utama lalu diam-diam dicoba ulang ke backend lain, hasilnya bisa "berhasil"
  // di satu sisi tapi tidak tercatat di sisi yang sedang jadi acuan utama (split-state) — atau,
  // untuk sesi login, token yang dibuat di backend fallback tidak akan dikenali saat request
  // berikutnya kembali mencoba backend utama. Sengaja pakai ALLOWLIST (bukan daftar-larangan aksi
  // tulis) supaya aksi baru yang lupa diklasifikasikan default-nya AMAN (tidak fallback), bukan
  // berisiko.
  const FALLBACK_SAFE_ACTIONS = new Set([
    'getMasterLayanan', 'getKelurahanByKecamatan', 'getDataRumahIbadah', 'getKemenagData',
    'getSheetName', 'getVersiAplikasi',
    'cekNikRealtime', 'cekRekeningRealtime', 'cekTempatTugasGandaRealtime', 'cekKuotaRealtime',
    'cekKuotaTersedia', 'validasiDataBaru',
    'ambilDataLihatDataHakAkses', 'ambilDetailPenerimaPerBaris',
    'ambilTahunTersedia', 'ambilDataTahunHakAkses', 'ambilRiwayatEdit',
    'getDashboardProgresVerifikasi', 'getSemuaKuota', 'getProgresKuota',
    'getDaftarBerkasTidakLengkapUntukWA',
    'statusInputKecKem', 'ambilStatusDetailSetelan', 'ambilDaftarUserDenganStatus', 'ambilDaftarAkun',
    'eksporDataKeSpreadsheet', 'buatTokenSSORetur', 'ping',
  ]);
  const isFallbackSafe = FALLBACK_SAFE_ACTIONS.has(payloadObj.action);

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

  // 5. Eksekusi fetch dengan otomatis fallback ke DEFAULT_GAS_URL jika target awal gagal
  let usedUrl = targetUrl;
  let fallbackAttempted = false;
  // Dideklarasikan di sini (bukan di dalam try di bawah) supaya tetap terjangkau dari blok
  // catch terluar — sebelumnya `text` dideklarasikan di dalam try dan tidak terjangkau di
  // catch pasangannya (ReferenceError saat backend mengembalikan respon bukan-JSON).
  let text = '';
  let data = null;

  // Batas waktu total percobaan (primer + fallback), disengaja di bawah `maxDuration: 60`
  // milik Vercel supaya proxy ini sempat mengembalikan JSON error yang rapi sebelum
  // platform mematikan function secara paksa (yang akan menghasilkan 504 mentah tanpa detail).
  const FUNCTION_BUDGET_MS = 48000;
  const startedAt = Date.now();

  const executeFetch = async (endpoint, timeoutMs, retries = 1) => {
    return await fetchWithRetry(endpoint, fetchOptions, retries, timeoutMs);
  };

  const getBackendLabel = (url) => {
    return url.includes('/functions/v1/') ? 'Supabase Edge Function' : 'Google Apps Script';
  };

  // Aksi upload: satu percobaan saja (retry percuma untuk unggahan lambat), timeout longgar.
  // Aksi lain: timeout lebih ketat + 1x retry pada target yang sama (payload kecil, retry murah).
  const primaryTimeout = isUploadAction ? 40000 : 15000;
  const primaryRetries = isUploadAction ? 0 : 1;

  try {
    try {
      const response = await executeFetch(targetUrl, primaryTimeout, primaryRetries);
      text = await response.text();
      data = JSON.parse(text);
    } catch (initialErr) {
      // Fallback lintas-backend hanya untuk aksi baca murni (lihat FALLBACK_SAFE_ACTIONS) DAN
      // hanya jika target awal dari ENV berbeda dari DEFAULT_GAS_URL DAN masih ada sisa anggaran waktu.
      const sisaBudget = FUNCTION_BUDGET_MS - (Date.now() - startedAt);
      if (isFallbackSafe && targetUrl !== DEFAULT_GAS_URL && sisaBudget > 5000) {
        console.warn(`Fetch ke targetUrl (${targetUrl}) gagal (${initialErr.message}). Otomatis fallback ke DEFAULT_GAS_URL...`);
        fallbackAttempted = true;
        usedUrl = DEFAULT_GAS_URL;
        // Fallback: satu kali percobaan saja (tanpa retry internal) dengan timeout dibatasi
        // sisa anggaran waktu, supaya total primer+fallback tidak pernah melewati FUNCTION_BUDGET_MS.
        const fbTimeout = Math.min(15000, sisaBudget - 2000);
        const fbResponse = await executeFetch(DEFAULT_GAS_URL, fbTimeout, 0);
        text = await fbResponse.text();
        data = JSON.parse(text);
      } else {
        throw initialErr;
      }
    }

    return res.status(200).json(data);
  } catch (err) {
    const backendName = getBackendLabel(usedUrl);
    console.error(`Vercel Proxy Error (${backendName}):`, err);

    // Bedakan antara respon bukan JSON (parse error) vs kesalahan jaringan/timeout
    if (err instanceof SyntaxError) {
      return res.status(502).json({
        error: `${backendName} tidak mengembalikan respon JSON valid. Pastikan Web App / Function aktif dan dapat diakses.`,
        details: text ? text.slice(0, 500) : err.message,
        usedUrl,
        fallbackAttempted
      });
    }

    return res.status(500).json({
      error: `Terjadi kesalahan koneksi antara server Vercel dan ${backendName}.`,
      details: err.toString(),
      cause: err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : null,
      usedUrl,
      fallbackAttempted
    });
  }
}


