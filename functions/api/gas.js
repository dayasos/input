// Cloudflare Pages Function — pengganti api/gas.js (Vercel Serverless Function).
//
// File ini otomatis dipetakan ke route /api/gas oleh Cloudflare Pages (folder "functions/" di
// root project = file-based routing, mirip Next.js). public/js/api-bridge.js TIDAK PERLU diubah
// sama sekali -- dia tetap fetch ke "/api/gas" seperti sebelumnya.
//
// Bedanya dari versi Vercel:
// - Runtime Workers pakai Web API murni (Request/Response/fetch/AbortController), bukan gaya
//   Node req/res -- makanya seluruh handler ditulis ulang, bukan cuma disalin.
// - env var diakses lewat `env.NAMA_VAR` (parameter fungsi), BUKAN `process.env.NAMA_VAR`.
// - Tidak ada lagi fallback hardcoded utk SUPABASE_ANON_KEY. Env var wajib diset di dashboard
//   Cloudflare Pages -- kalau kosong, request akan gagal jelas (500) drpd diam-diam pakai key
//   basi yang mungkin sudah dirotasi.
// - Endpoint ini HANYA dipakai utk 3 aksi yang butuh _secret dari server: pulihkanSesi,
//   logoutPengguna, ping (lihat _PROXY_ONLY_ACTIONS di public/js/api-bridge.js). Semua aksi lain
//   sudah langsung browser -> Supabase Edge Function.

const DEFAULT_TARGET_URL = 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api';

function sanitizeUrl(raw) {
  if (!raw) return DEFAULT_TARGET_URL;
  let u = raw.trim().replace(/^["']|["']$/g, '');
  if (u.startsWith('ttps://')) u = 'h' + u; // Otomatis perbaiki kalau huruf 'h' tertinggal saat copy-paste
  if (u.startsWith('http://') && !u.includes('localhost') && !u.includes('127.0.0.1')) {
    u = 'https://' + u.slice(7);
  }
  const isSupabase = u.includes('/functions/v1/');
  if (!isSupabase) return DEFAULT_TARGET_URL;
  return u;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Batas waktu permintaan terlampaui (${timeoutMs / 1000} detik)`)),
    timeoutMs
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Preflight CORS. Sama seperti versi Vercel: dilonggarkan krn endpoint ini juga dipanggil dari
// konteks dev lokal / testing manual. Kalau frontend SELALU same-origin dgn situsnya, header ini
// bisa dipersempit ke origin situs sendiri saja.
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// GET = health-check + ping test, sama seperti versi Vercel.
export async function onRequestGet({ env }) {
  const rawEnv = env.GAS_API_URL || env.SUPABASE_EDGE_FUNCTION_URL || '';
  const sanitizedTargetUrl = sanitizeUrl(rawEnv);
  const secretDikonfigurasi = Boolean(env.GAS_SECRET_TOKEN);
  let pingStatus = 'untested';

  if (!secretDikonfigurasi) {
    pingStatus = { error: 'GAS_SECRET_TOKEN belum diset di environment ini -- ping dilewati.' };
  } else {
    try {
      const testRes = await fetchWithTimeout(
        sanitizedTargetUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            Accept: 'application/json, text/plain, */*',
          },
          body: JSON.stringify({ action: 'ping', _secret: env.GAS_SECRET_TOKEN }),
        },
        6000
      );
      pingStatus = { status: testRes.status, ok: testRes.ok };
    } catch (pingErr) {
      pingStatus = {
        error: pingErr.message,
        cause: pingErr.cause ? pingErr.cause.message || String(pingErr.cause) : null,
      };
    }
  }

  return jsonResponse(
    {
      status: 'API Proxy Online (Cloudflare Pages Functions)',
      envConfigured: Boolean(rawEnv),
      secretConfigured: secretDikonfigurasi,
      activeBackendUrl: sanitizedTargetUrl,
      isUsingDefaultTarget: sanitizedTargetUrl === DEFAULT_TARGET_URL && rawEnv !== DEFAULT_TARGET_URL,
      pingTest: pingStatus,
    },
    200
  );
}

// POST = proxy sesungguhnya, dipakai utk pulihkanSesi / logoutPengguna / ping.
export async function onRequestPost({ request, env }) {
  const rawEnv = env.GAS_API_URL || env.SUPABASE_EDGE_FUNCTION_URL || '';
  let targetUrl = sanitizeUrl(rawEnv);

  let payloadObj = {};
  try {
    payloadObj = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Format JSON payload tidak valid', details: String(e.message || e) }, 400);
  }
  if (!payloadObj || typeof payloadObj !== 'object' || Array.isArray(payloadObj)) {
    payloadObj = {};
  }

  const secretToken = env.GAS_SECRET_TOKEN;
  if (!secretToken) {
    return jsonResponse(
      { error: 'Konfigurasi server tidak lengkap: GAS_SECRET_TOKEN belum diset. Hubungi administrator.' },
      500
    );
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
  ]);
  let timeoutMs;
  if (REALTIME_CHECK_ACTIONS.has(payloadObj.action)) {
    timeoutMs = 15000;
  } else if (payloadObj.action === 'validasiDataBaru') {
    timeoutMs = 25000;
  } else if (UPLOAD_ACTIONS.has(payloadObj.action)) {
    // CATATAN: versi Vercel pakai 50s (mendekati batas keras Vercel 60s). Di sini sengaja
    // diturunkan ke 28s krn endpoint ini SEHARUSNYA cuma dipakai utk 3 aksi ringan
    // (pulihkanSesi/logoutPengguna/ping) -- aksi upload asli sudah langsung browser->Supabase.
    // Verifikasi batas wall-clock free-tier Cloudflare terbaru sebelum menaikkan angka ini.
    timeoutMs = 28000;
  } else {
    timeoutMs = 25000;
  }

  const anonKey = env.SUPABASE_ANON_KEY;
  if (!anonKey && targetUrl.includes('supabase.co')) {
    return jsonResponse({ error: 'Konfigurasi server tidak lengkap: SUPABASE_ANON_KEY belum diset.' }, 500);
  }

  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
  };
  if (targetUrl.includes('supabase.co')) {
    requestHeaders['apikey'] = anonKey;
    requestHeaders['Authorization'] = `Bearer ${anonKey}`;
  }

  let text = '';
  try {
    const response = await fetchWithTimeout(
      targetUrl,
      { method: 'POST', headers: requestHeaders, body: JSON.stringify(payloadObj) },
      timeoutMs
    );
    text = await response.text();
    const data = JSON.parse(text);
    return jsonResponse(data, 200);
  } catch (err) {
    const backendName = 'Supabase Edge Function';
    console.error(
      `Pages Function Proxy Error for action [${payloadObj.action}] timeout=${timeoutMs}ms (${backendName}):`,
      err.message
    );

    if (err instanceof SyntaxError) {
      return jsonResponse(
        {
          error: `${backendName} tidak mengembalikan respon JSON valid. Pastikan endpoint aktif dan dapat diakses.`,
          action: payloadObj.action,
          details: text ? text.slice(0, 500) : err.message,
          usedUrl: targetUrl,
        },
        502
      );
    }

    const errString = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      {
        error: `Terjadi kesalahan koneksi antara server proxy dan ${backendName}. Detail: ${errString}`,
        action: payloadObj.action,
        details: errString,
        timeoutMs,
        usedUrl: targetUrl,
      },
      500
    );
  }
}
