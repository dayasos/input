const _SUPABASE_EDGE_URL = (function () {
  // Coba baca dari meta tag (diinjeksi Vite/build, atau bisa diset manual di index.html):
  //   <meta name="supabase-edge-url" content="https://xxxx.supabase.co/functions/v1/api">
  const metaTag = document.querySelector('meta[name="supabase-edge-url"]');
  if (metaTag && metaTag.getAttribute('content')) {
    return metaTag.getAttribute('content').trim();
  }
  // Fallback hardcoded (sama dengan DEFAULT_TARGET_URL di api/gas.js)
  return 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api';
})();

const _SUPABASE_ANON_KEY = (function () {
  const metaTag = document.querySelector('meta[name="supabase-anon-key"]');
  if (metaTag && metaTag.getAttribute('content')) return metaTag.getAttribute('content').trim();
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cXhic2N1bWFha3Z6aXd6d2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjQ2MTMsImV4cCI6MjEwNDEwMDYxM30.W0hJsUzcnYaOWfF-NHKR1F3RnJR8j-vJsDDqBF636hQ';
})();

/**
 * Ambil session token dari sessionStorage (kunci sama dengan yang disimpan saat login).
 * Return null jika belum login atau token tidak ada.
 */
function _getSessionToken() {
  try {
    const sesiRaw = sessionStorage.getItem('dana_jasa_sesi');
    if (!sesiRaw) return null;
    const sesi = JSON.parse(sesiRaw);
    return (sesi && sesi.token) ? sesi.token : null;
  } catch (_e) { return null; }
}

/**
 * Fetch langsung ke Supabase Edge Function dengan X-Session-Token header.
 * Mengeliminasi hop Vercel proxy → latensi turun ~100-500ms per request.
 * _secret tidak pernah ada di browser.
 */
async function _fetchEdgeDirect(payload, sessionToken) {
  return fetch(_SUPABASE_EDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': _SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + _SUPABASE_ANON_KEY,
      'x-session-token': sessionToken,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Fetch via Vercel proxy (/api/gas) — dipakai sebagai fallback jika session token
 * belum tersedia (mis. saat login), atau untuk aksi yang memerlukan _secret di body
 * (mis. loginPengguna, pulihkanSesi yang tidak bisa diautentikasi via session token).
 */
async function _fetchViaProxy(payload) {
  return fetch('/api/gas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Aksi-aksi yang SELALU lewat Vercel proxy (butuh _secret, tidak bisa via session token)
const _PROXY_ONLY_ACTIONS = new Set([
  'loginPengguna',
  'pulihkanSesi',
  'logoutPengguna',
  'ping',
]);

// Konfigurasi Smart SWR

const SWR_CONFIG = {
  // Master data & Wilayah: TTL 30 menit
  getMasterLayanan: { ttl: 30 * 60 * 1000, domain: 'master' },
  getKelurahanByKecamatan: { ttl: 30 * 60 * 1000, domain: 'master' },
  getSheetName: { ttl: 60 * 60 * 1000, domain: 'master' },
  getVersiAplikasi: { ttl: 60 * 60 * 1000, domain: 'master' },
  ambilTahunTersedia: { ttl: 60 * 60 * 1000, domain: 'master' },

  // Rumah Ibadah & Kemenag: TTL 15 menit
  getDataRumahIbadah: { ttl: 15 * 60 * 1000, domain: 'rumah_ibadah' },
  getKemenagData: { ttl: 15 * 60 * 1000, domain: 'rumah_ibadah' },

  // Data Transaksi Penerima & Dashboard: TTL 3 menit (revalidasi di latar belakang)
  ambilDataLihatDataHakAkses: { ttl: 3 * 60 * 1000, domain: 'penerima' },
  ambilDetailPenerimaPerBaris: { ttl: 2 * 60 * 1000, domain: 'penerima_detail' },
  getDashboardProgresVerifikasi: { ttl: 3 * 60 * 1000, domain: 'dashboard' },
  ambilDataDetail: { ttl: 3 * 60 * 1000, domain: 'data_detail' },

  // Kuota: TTL 5 menit
  getSemuaKuota: { ttl: 5 * 60 * 1000, domain: 'kuota' },
  getProgresKuota: { ttl: 5 * 60 * 1000, domain: 'kuota' },

  statusInputKecKem: { ttl: 2 * 60 * 1000, domain: 'setelan' },
  ambilStatusDetailSetelan: { ttl: 2 * 60 * 1000, domain: 'setelan' },
  ambilDaftarUserDenganStatus: { ttl: 2 * 60 * 1000, domain: 'setelan' },

  // Akun & Audit: TTL 5 menit
  ambilDaftarAkun: { ttl: 5 * 60 * 1000, domain: 'akun' },
  ambilRiwayatEdit: { ttl: 3 * 60 * 1000, domain: 'riwayat' },

  // Data tahun arsip (dropdown "Tahun" di Lihat Data, tahun selain TAHUN_AKTIF): baris-baris
  // tahun lampau tidak pernah bisa diedit lagi (lihat _shared/config.ts TAHUN_AKTIF -- semua
  // query tulis dikunci ke tahun aktif), jadi aman di-cache lama tanpa risiko data usang.
  ambilDataTahunHakAkses: { ttl: 60 * 60 * 1000, domain: 'arsip_tahun' },

  // Halaman Tools (khusus UTAMA): data berubah jarang (diisi manual), TTL 10 menit.
  // Domain dipisah per-bagian supaya menyimpan 1 pejabat tidak ikut membuang cache
  // daftar batch/SK yang tidak berhubungan.
  ambilDaftarBatchPembayaran: { ttl: 10 * 60 * 1000, domain: 'tools_batch' },
  ambilPejabatTtd: { ttl: 10 * 60 * 1000, domain: 'tools_pejabat' },
  ambilReferensiSkWalikota: { ttl: 10 * 60 * 1000, domain: 'tools_referensi_sk' },
  ambilSkLayanan: { ttl: 10 * 60 * 1000, domain: 'tools_sk_layanan' },
};

// Ambang batas kesegaran cache (freshness threshold) cerdas per domain
// Menghindari background fetch berulang untuk data yang jarang berubah
const DOMAIN_FRESHNESS = {
  master: 5 * 60 * 1000,        // 5 menit: respons 0ms instan untuk master data & dropdown wilayah
  rumah_ibadah: 3 * 60 * 1000,  // 3 menit
  kuota: 60 * 1000,             // 1 menit
  setelan: 60 * 1000,           // 1 menit
  akun: 60 * 1000,              // 1 menit
  riwayat: 60 * 1000,           // 1 menit
  penerima: 20 * 1000,          // 20 detik (transaksi dinamis)
  penerima_detail: 20 * 1000,   // 20 detik
  dashboard: 20 * 1000,         // 20 detik
  data_detail: 20 * 1000,       // 20 detik
  tools_batch: 60 * 1000,          // 1 menit
  tools_pejabat: 60 * 1000,        // 1 menit
  tools_referensi_sk: 60 * 1000,   // 1 menit
  tools_sk_layanan: 60 * 1000,     // 1 menit
  arsip_tahun: 30 * 60 * 1000,     // 30 menit -- data tahun lampau tidak pernah berubah
};

const MUTATION_INVALIDATIONS = {
  simpanDataKeSheet: ['penerima', 'dashboard', 'kuota'],
  editDataPenerima: ['penerima', 'penerima_detail', 'dashboard', 'riwayat'],
  verifikasiSatuData: ['penerima', 'penerima_detail', 'dashboard', 'data_detail'],
  laporkanPerbaikanBerkas: ['penerima', 'penerima_detail'],
  tandaiSudahDiperbaiki: ['penerima', 'penerima_detail', 'dashboard', 'data_detail'],
  verifikasiMassalMemenuhiSyarat: ['penerima', 'dashboard', 'data_detail'],
  simpanKuota: ['kuota', 'dashboard'],
  setInputKecKem: ['setelan'],
  setSakelarUserByAdmin: ['setelan'],
  resetSakelarUserByAdmin: ['setelan'],
  bulkSakelarPerKecamatan: ['setelan'],
  ubahAkunSendiri: ['akun'],
  resetPasswordUser: ['akun'],
  simpanProfilUser: ['akun'],
  ubahProfilUser: ['akun'],
  logoutPengguna: ['*'],

  buatBatchPembayaran: ['tools_batch'],
  simpanPejabatTtd: ['tools_pejabat'],
  simpanReferensiSkWalikota: ['tools_referensi_sk'],
  simpanSkLayanan: ['tools_sk_layanan'],
};

// SWR Cache Manager

class SWRCacheManager {
  constructor() {
    this._memoryCache = new Map();
    this._inFlightRequests = new Map();
    this._prefix = 'djpm_swr_v1_';
    this._broadcastChannel = null;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this._broadcastChannel = new BroadcastChannel('djpm_realtime_bus');
        this._broadcastChannel.onmessage = (event) => {
          if (event && event.data && event.data.type === 'INVALIDATE') {
            this.invalidate(event.data.domains, false);
          }
        };
      } catch (_e) {
      }
    }

    this._loadSessionCache();

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this._handleWindowFocus();
        }
      });
      window.addEventListener('online', () => {
        this._handleWindowFocus();
      });
    }
  }

  _buildKey(action, args) {
    try {
      return `${action}:${JSON.stringify(args || [])}`;
    } catch (_e) {
      return `${action}:${String(args)}`;
    }
  }

  _fastHash(str) {
    let hash = 5381;
    let i = str.length;
    while (i) {
      hash = (hash * 33) ^ str.charCodeAt(--i);
    }
    return (hash >>> 0).toString(16);
  }

  _loadSessionCache() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const now = Date.now();
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(this._prefix)) {
          keys.push(k);
        }
      }
      for (const k of keys) {
        const raw = sessionStorage.getItem(k);
        if (raw) {
          try {
            const entry = JSON.parse(raw);
            if (entry && entry.expiresAt > now) {
              const cacheKey = k.slice(this._prefix.length);
              this._memoryCache.set(cacheKey, entry);
            } else {
              sessionStorage.removeItem(k);
            }
          } catch (_err) {
            sessionStorage.removeItem(k);
          }
        }
      }
    } catch (_e) {
    }
  }

  get(action, args) {
    const config = SWR_CONFIG[action];
    if (!config) return null;

    const key = this._buildKey(action, args);
    let entry = this._memoryCache.get(key);

    if (!entry && typeof sessionStorage !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(this._prefix + key);
        if (raw) {
          entry = JSON.parse(raw);
          if (entry && entry.expiresAt > Date.now()) {
            this._memoryCache.set(key, entry);
          } else {
            entry = null;
          }
        }
      } catch (_e) {
        entry = null;
      }
    }

    if (!entry) return null;

    const now = Date.now();
    return {
      data: entry.data,
      hash: entry.hash,
      isExpired: now > entry.expiresAt,
      age: now - entry.cachedAt,
      domain: config.domain,
    };
  }

  set(action, args, data) {
    const config = SWR_CONFIG[action];
    if (!config) return;

    const key = this._buildKey(action, args);
    const now = Date.now();
    const rawString = typeof data === 'string' ? data : JSON.stringify(data);
    const hash = this._fastHash(rawString);

    const entry = {
      action,
      domain: config.domain,
      cachedAt: now,
      expiresAt: now + config.ttl,
      hash,
      data,
    };

    this._memoryCache.set(key, entry);

    if (typeof sessionStorage !== 'undefined') {
      try {
        if (rawString.length < 2 * 1024 * 1024) {
          sessionStorage.setItem(this._prefix + key, JSON.stringify(entry));
        }
      } catch (_e) {
        // Kuota storage penuh -> abaikan, memori cache tetap jalan
      }
    }
  }

  invalidate(domains, broadcast = true) {
    if (!domains || !domains.length) return;

    const domainList = Array.isArray(domains) ? domains : [domains];
    const isAll = domainList.includes('*');

    for (const [key, entry] of this._memoryCache.entries()) {
      if (isAll || domainList.includes(entry.domain)) {
        this._memoryCache.delete(key);
        if (typeof sessionStorage !== 'undefined') {
          try { sessionStorage.removeItem(this._prefix + key); } catch (_e) { }
        }
      }
    }

    if (broadcast && this._broadcastChannel) {
      try {
        this._broadcastChannel.postMessage({ type: 'INVALIDATE', domains: domainList });
      } catch (_e) { }
    }

    if (broadcast && typeof window !== 'undefined' && window.djpmRealtimeChannel) {
      try {
        window.djpmRealtimeChannel.send({
          type: 'broadcast',
          event: 'MUTATION',
          payload: { domains: domainList, timestamp: Date.now() },
        });
      } catch (_e) { }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('djpm:swr-invalidated', { detail: { domains: domainList } }));
    }
  }

  clear() {
    this._memoryCache.clear();
    if (typeof sessionStorage !== 'undefined') {
      try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(this._prefix)) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      } catch (_e) { }
    }
  }

  _handleWindowFocus() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('djpm:swr-window-focus', { detail: { timestamp: Date.now() } }));
    }
  }

  getStats() {
    return {
      memoryEntries: this._memoryCache.size,
      inFlight: this._inFlightRequests.size,
      cachedActions: Array.from(this._memoryCache.values()).map(e => `${e.action} (${e.domain})`),
    };
  }
}

// Instance tunggal global untuk manajemen cache
const swrCache = new SWRCacheManager();
if (typeof window !== 'undefined') {
  window.djpmCache = swrCache;
}

class GoogleScriptRunProxy {
  constructor(successHandler = null, failureHandler = null, userObject = null) {
    this._successHandler = successHandler;
    this._failureHandler = failureHandler;
    this._userObject = userObject;

    return new Proxy(this, {
      get: (target, prop) => {
        // Tangkap handler berantai (chained methods)
        if (prop === 'withSuccessHandler') {
          return (cb) => new GoogleScriptRunProxy(cb, target._failureHandler, target._userObject);
        }
        if (prop === 'withFailureHandler') {
          return (cb) => new GoogleScriptRunProxy(target._successHandler, cb, target._userObject);
        }
        if (prop === 'withUserObject') {
          return (uo) => new GoogleScriptRunProxy(target._successHandler, target._failureHandler, uo);
        }

        // Jika fungsi yang dipanggil bukan handler, eksekusi pemanggilan SWR / Fetch
        return (...args) => {
          const action = prop;
          const isSwrEligible = Boolean(SWR_CONFIG[action]);
          const mutationDomains = MUTATION_INVALIDATIONS[action];

          let cachedEntry = null;
          if (isSwrEligible) {
            cachedEntry = swrCache.get(action, args);
            if (cachedEntry) {
              // Jika ada di cache, eksekusi successHandler seketika (Stale)
              if (target._successHandler) {
                try {
                  target._successHandler(cachedEntry.data, target._userObject);
                } catch (shErr) {
                  console.warn(`[SWR] Error saat render data cache ${action}:`, shErr);
                }
              }

              // Jika cache masih sangat segar (sesuai threshold per-domain), tidak perlu fetch ulang segera
              const domain = (SWR_CONFIG[action] && SWR_CONFIG[action].domain) || 'default';
              const freshThreshold = DOMAIN_FRESHNESS[domain] || 20000;
              if (cachedEntry.age < freshThreshold && !cachedEntry.isExpired) {
                return;
              }
            }
          }

          const reqKey = `${action}:${JSON.stringify(args || [])}`;
          let fetchPromise = swrCache._inFlightRequests.get(reqKey);

          if (!fetchPromise) {
            const payload = { action, args };

            // Pilih strategi fetch: langsung ke Edge Function atau via Vercel proxy.
            // Aksi yang butuh _secret (login, pulihkan sesi) tetap via proxy.
            // Semua aksi lain pakai Edge Function langsung jika session token tersedia.
            const sessionToken = _getSessionToken();
            const pakaiDirect = sessionToken && !_PROXY_ONLY_ACTIONS.has(action);

            const fetchFn = pakaiDirect
              ? () => _fetchEdgeDirect(payload, sessionToken)
              : () => _fetchViaProxy(payload);

            fetchPromise = fetchFn()
              .then(async (res) => {
                const contentType = res.headers.get('content-type') || '';
                if (!res.ok) {
                  if (res.status === 413) {
                    throw new Error('Ukuran berkas melebihi batas upload Vercel (maks 4.5 MB). Mohon perkecil ukuran foto atau berkas yang diunggah.');
                  }
                  if (res.status === 504) {
                    throw new Error('Permintaan ke server mengalami batas waktu (timeout). Silakan coba beberapa saat lagi.');
                  }
                  if (contentType.includes('application/json')) {
                    const errJson = await res.json();
                    throw new Error(errJson.error || errJson.pesan || `HTTP Error ${res.status}`);
                  }
                  const errText = await res.text();
                  throw new Error(errText || `Server Error (HTTP ${res.status})`);
                }
                return res.json();
              })
              .finally(() => {
                swrCache._inFlightRequests.delete(reqKey);
              });

            swrCache._inFlightRequests.set(reqKey, fetchPromise);
          }

          fetchPromise
            .then((data) => {
              if (data && data.error) {
                // Deteksi otomatis jika sesi kedaluwarsa dari server
                if (typeof data.error === 'string' && (data.error.includes("SESI TIDAK SAH") || data.error.includes("Silakan login ulang"))) {
                  try { sessionStorage.removeItem('dana_jasa_sesi'); } catch (_e) { }
                  swrCache.clear();
                  const modalLogin = document.getElementById('modal-login');
                  if (modalLogin && modalLogin.classList.contains('hidden')) {
                    modalLogin.classList.remove('hidden');
                    const fsContainer = document.getElementById('fs-container');
                    if (fsContainer) {
                      fsContainer.disabled = true;
                      fsContainer.classList.add('opacity-50', 'pointer-events-none');
                    }
                    const panelRekap = document.getElementById('panel-rekap');
                    if (panelRekap) panelRekap.classList.add('hidden');
                    if (typeof tampilkanToast === "function") {
                      tampilkanToast("Sesi Anda telah berakhir. Silakan login kembali.", "peringatan", { durasi: 6000 });
                    }
                  }
                }

                const errObj = new Error(data.error);
                if (target._failureHandler) {
                  target._failureHandler(errObj, target._userObject);
                } else {
                  console.error("Backend Error:", data.error);
                }
                return;
              }

              const freshResult = data ? data.result : undefined;

              // Deteksi otomatis jika sesi kedaluwarsa (dari top-level error atau result object)
              const possibleErrMsg = (
                (data && typeof data.error === 'string' ? data.error : '') ||
                (freshResult && typeof freshResult === 'object' && typeof freshResult.error === 'string' ? freshResult.error : '') ||
                (freshResult && typeof freshResult === 'object' && typeof freshResult.pesan === 'string' ? freshResult.pesan : '')
              ).toLowerCase();

              if (possibleErrMsg && (possibleErrMsg.includes("sesi tidak sah") || possibleErrMsg.includes("silakan login ulang") || possibleErrMsg.includes("sesi kedaluwarsa") || possibleErrMsg.includes("sesi anda telah berakhir"))) {
                try { sessionStorage.removeItem('dana_jasa_sesi'); } catch (_e) { }
                swrCache.clear();
                const modalLogin = document.getElementById('modal-login');
                if (modalLogin && modalLogin.classList.contains('hidden')) {
                  modalLogin.classList.remove('hidden');
                  const fsContainer = document.getElementById('fs-container');
                  if (fsContainer) {
                    fsContainer.disabled = true;
                    fsContainer.classList.add('opacity-50', 'pointer-events-none');
                  }
                  const panelRekap = document.getElementById('panel-rekap');
                  if (panelRekap) panelRekap.classList.add('hidden');
                  if (typeof tampilkanToast === "function") {
                    tampilkanToast("Sesi Anda telah berakhir. Silakan login kembali.", "peringatan", { durasi: 6000 });
                  }
                }
              }

              // Jika ini adalah aksi mutasi, bersihkan domain cache terkait -- tapi HANYA jika
              // mutasi benar-benar berhasil (result.sukses !== false). Tanpa cek ini, mutasi yang
              // ditolak di level aplikasi (mis. role tidak diizinkan, atau exception yang ditangkap
              // dan dikembalikan sbg {sukses:false}) tetap membuang cache + broadcast realtime ke
              // semua sesi admin lain padahal tidak ada perubahan data sama sekali.
              if (mutationDomains) {
                let hasilMutasi = freshResult;
                if (typeof hasilMutasi === 'string') {
                  try { hasilMutasi = JSON.parse(hasilMutasi); } catch (_e) { /* biarkan apa adanya */ }
                }
                const mutasiGagal = hasilMutasi && typeof hasilMutasi === 'object' && hasilMutasi.sukses === false;
                if (!mutasiGagal) {
                  swrCache.invalidate(mutationDomains, true);
                }
              }

              // Jika ini aksi SWR, bandingkan data baru dengan cache
              if (isSwrEligible) {
                let hasilUntukDicek = freshResult;
                if (typeof freshResult === 'string') {
                  try { hasilUntukDicek = JSON.parse(freshResult); } catch (_e) { hasilUntukDicek = freshResult; }
                }
                const isErrorResult = !freshResult || (
                  typeof hasilUntukDicek === 'object' && hasilUntukDicek !== null && (
                    Boolean(hasilUntukDicek.error) ||
                    hasilUntukDicek.sukses === false
                  )
                );

                if (!isErrorResult) {
                  const rawFresh = typeof freshResult === 'string' ? freshResult : JSON.stringify(freshResult);
                  const freshHash = swrCache._fastHash(rawFresh);

                  swrCache.set(action, args, freshResult);

                  if (cachedEntry && cachedEntry.hash === freshHash) {
                    return;
                  }
                }
              }

              // Panggil successHandler dengan data segar
              if (target._successHandler) {
                target._successHandler(freshResult, target._userObject);
              }
            })
            .catch((err) => {
              if (target._failureHandler) {
                target._failureHandler(err, target._userObject);
              } else {
                console.error("Network / Fetch Error:", err);
              }
            });
        };
      },
    });
  }
}

// Pasangkan proxy ke dalam object global "google" yang biasa dipakai di Apps Script
window.google = window.google || {};
window.google.script = window.google.script || {};
window.google.script.run = new GoogleScriptRunProxy();
