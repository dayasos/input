/**
 * API Bridge - Pengganti google.script.run untuk lingkungan Vercel & Supabase
 * Dilengkapi dengan Smart SWR (Stale-While-Revalidate) Cache & Realtime Sync.
 * 
 * Fitur Utama:
 * 1. 0ms Instant Response (Stale): Mengembalikan data lokal seketika tanpa spinner.
 * 2. Background Revalidation: Mengambil data terbaru di latar belakang secara transparan.
 * 3. Zero-Flicker Differential Update: Handler UI hanya dipanggil ulang jika data server benar-benar berubah.
 * 4. Targeted Mutation Invalidation: Operasi tulis/simpan/verifikasi otomatis menghapus cache terkait.
 * 5. Request Deduplication: Mencegah panggilan ganda untuk query yang sama saat bersamaan.
 * 6. Cross-Tab Synchronization: Menggunakan BroadcastChannel agar perubahan di satu tab tersinkron ke tab lain.
 * 7. Window Focus & Reconnect Auto-Revalidate: Revalidasi otomatis saat tab aktif kembali atau koneksi pulih.
 */

// ============================================================================
// 1. KONFIGURASI SMART SWR & TAKSONOMI AKSI
// ============================================================================

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

  // Kuota: TTL 5 menit
  getSemuaKuota: { ttl: 5 * 60 * 1000, domain: 'kuota' },
  getProgresKuota: { ttl: 5 * 60 * 1000, domain: 'kuota' },

  // Sakelar & Setelan: TTL 2 menit
  statusInputKecKem: { ttl: 2 * 60 * 1000, domain: 'setelan' },
  ambilStatusDetailSetelan: { ttl: 2 * 60 * 1000, domain: 'setelan' },
  ambilDaftarUserDenganStatus: { ttl: 2 * 60 * 1000, domain: 'setelan' },

  // Akun & Audit: TTL 5 menit
  ambilDaftarAkun: { ttl: 5 * 60 * 1000, domain: 'akun' },
  ambilRiwayatEdit: { ttl: 3 * 60 * 1000, domain: 'riwayat' },
};

// Pemetaan operasi tulis (mutasi) -> domain cache yang harus otomatis dibersihkan
const MUTATION_INVALIDATIONS = {
  simpanDataKeSheet: ['penerima', 'dashboard', 'kuota'],
  editDataPenerima: ['penerima', 'penerima_detail', 'dashboard', 'riwayat'],
  verifikasiSatuData: ['penerima', 'penerima_detail', 'dashboard'],
  laporkanPerbaikanBerkas: ['penerima', 'penerima_detail'],
  tandaiSudahDiperbaiki: ['penerima', 'penerima_detail', 'dashboard'],
  verifikasiMassalMemenuhiSyarat: ['penerima', 'dashboard'],
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
};

// ============================================================================
// 2. KELAS SWR CACHE MANAGER
// ============================================================================

class SWRCacheManager {
  constructor() {
    this._memoryCache = new Map();
    this._inFlightRequests = new Map();
    this._prefix = 'djpm_swr_v1_';
    this._broadcastChannel = null;

    // Inisialisasi BroadcastChannel untuk sinkronisasi antar-tab
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this._broadcastChannel = new BroadcastChannel('djpm_realtime_bus');
        this._broadcastChannel.onmessage = (event) => {
          if (event && event.data && event.data.type === 'INVALIDATE') {
            this.invalidate(event.data.domains, false);
          }
        };
      } catch (_e) {
        // Fallback anggun jika BroadcastChannel dicekal browser
      }
    }

    // Muat cache dari sessionStorage saat inisialisasi awal
    this._loadSessionCache();

    // Pasang auto-revalidate saat window focus dan koneksi online
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
      // Abaikan jika storage penuh atau dinonaktifkan
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

    // Simpan juga ke sessionStorage (kecuali data berukuran sangat raksasa > 2MB)
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

    // Hapus dari memori
    for (const [key, entry] of this._memoryCache.entries()) {
      if (isAll || domainList.includes(entry.domain)) {
        this._memoryCache.delete(key);
        if (typeof sessionStorage !== 'undefined') {
          try { sessionStorage.removeItem(this._prefix + key); } catch (_e) { }
        }
      }
    }

    // Siarkan ke tab lain dalam browser yang sama
    if (broadcast && this._broadcastChannel) {
      try {
        this._broadcastChannel.postMessage({ type: 'INVALIDATE', domains: domainList });
      } catch (_e) { }
    }

    // Siarkan ke Supabase Realtime (lintas pengguna & perangkat secara global)
    if (broadcast && typeof window !== 'undefined' && window.djpmRealtimeChannel) {
      try {
        window.djpmRealtimeChannel.send({
          type: 'broadcast',
          event: 'MUTATION',
          payload: { domains: domainList, timestamp: Date.now() },
        });
      } catch (_e) { }
    }

    // Picu custom event lokal
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
    // Beri tahu UI bahwa tab kembali aktif, view aktif dapat memicu refresh halus jika diperlukan
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

// ============================================================================
// 3. PROXY HANDLER (GOOGLE SCRIPT RUN COMPATIBLE)
// ============================================================================

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

          // ── STRATEGI 1: CEK CACHE SWR (0ms INSTANT RETURN) ──
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

              // Jika cache masih sangat segar (< 20 detik), tidak perlu fetch ulang segera
              if (cachedEntry.age < 20000 && !cachedEntry.isExpired) {
                return;
              }
            }
          }

          // ── STRATEGI 2: DEDUPLIKASI IN-FLIGHT REQUEST ──
          const reqKey = `${action}:${JSON.stringify(args || [])}`;
          let fetchPromise = swrCache._inFlightRequests.get(reqKey);

          if (!fetchPromise) {
            const payload = { action, args };

            fetchPromise = fetch('/api/gas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
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

          // ── STRATEGI 3: PROSES HASIL BACKGROUND FETCH (REVALIDATE) ──
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
                    alert("Sesi Anda telah berakhir. Silakan login kembali untuk melanjutkan.");
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
                  alert("Sesi Anda telah berakhir. Silakan login kembali untuk melanjutkan.");
                }
              }

              // Jika ini adalah aksi mutasi, bersihkan domain cache terkait
              if (mutationDomains) {
                swrCache.invalidate(mutationDomains, true);
              }

              // Jika ini aksi SWR, bandingkan data baru dengan cache
              if (isSwrEligible) {
                // JANGAN pernah simpan respons error ke dalam cache SWR! Beberapa aksi (mis.
                // ambilDataLihatDataHakAkses, ambilDetailPenerimaPerBaris) mengembalikan hasil
                // sebagai STRING hasil JSON.stringify() (kontrak dipertahankan dari Kode.gs), bukan
                // objek langsung — jadi periksa isinya lewat parse dulu, bukan cuma typeof === 'object'.
                // TAPI beberapa aksi lain (getSheetName, getVersiAplikasi) mengembalikan STRING BIASA
                // (bukan JSON) sebagai hasil valid — kalau JSON.parse gagal, itu BUKAN tanda error,
                // cukup anggap string apa adanya (persis perilaku semula), jangan digagalkan.
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

                  // Perbarui cache dengan data segar
                  swrCache.set(action, args, freshResult);

                  // Jika sebelumnya data cache sudah dirender dan isinya SAMA PERSIS,
                  // lewati re-render kedua untuk menghindari kedipan (zero-flicker).
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

