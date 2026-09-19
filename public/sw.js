// Service Worker DJPM 2027 (v4)
// Fitur:
// 1. Memenuhi syarat Installable PWA.
// 2. Network-First untuk Navigasi Dokumen HTML (agar reload selalu menyajikan versi terkini saat online).
// 3. Network-First (fallback cache) untuk skrip /js/ -- skrip ini berisi logika (bukan cuma
//    tampilan), jadi TIDAK boleh stale: dulu dipukul rata dgn ikon/gambar pakai Stale-While-
//    Revalidate, akibatnya perbaikan bug baru butuh hard refresh manual utk tampil (SW selalu
//    menyajikan versi cache lama seketika, baru memperbarui cache di latar belakang utk load
//    BERIKUTNYA -- 1 load selalu tertinggal 1 versi, dan kalau SW_VERSION lupa dinaikkan saat
//    deploy, cache lama itu tidak pernah tergantikan sama sekali).
// 4. Stale-While-Revalidate utk aset statis non-skrip (icons, logo, manifest, css) -- aman basi
//    sebentar demi kecepatan karena tidak mengandung logika.
// 5. MUTLAK BYPASS untuk: request non-GET, endpoint API (/api/), Google Drive/APIs, dan Supabase.
// 6. Otomatis membersihkan cache versi lama saat aktivasi + langsung ambil alih tab yang terbuka
//    (skipWaiting + clients.claim) supaya versi baru aktif tanpa perlu tutup semua tab.

const SW_VERSION = 'djpm-sw-v4';
const STATIC_CACHE_NAME = `djpm-static-${SW_VERSION}`;

// Daftar aset inti yang di-precache saat instalasi
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/logo-medan.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache gagal untuk beberapa aset:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('djpm-static-') && name !== STATIC_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Terima sinyal SKIP_WAITING dari halaman (lihat registrasi SW di app-core.js). Instalasi baru
// sebenarnya sudah otomatis skipWaiting() di atas, tapi handler ini membuat pesan yang sudah
// dikirim halaman tidak hilang percuma dan tetap aman kalau strategi auto-skip di atas suatu
// saat diubah.
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 1. MUTLAK BYPASS request non-GET
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // 2. MUTLAK BYPASS API internal dan eksternal (Supabase, Google Drive / APIs)
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.protocol.startsWith('chrome-extension')
  ) {
    return;
  }

  // 3. Navigasi Dokumen HTML: Network-First (dengan fallback ke cache jika offline)
  const isNavigasi = req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isNavigasi && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(req).then((cached) => cached || caches.match('/index.html'));
      })
    );
    return;
  }

  // 4. Skrip aplikasi (/js/): Network-First -- selalu coba versi terbaru dulu, cache hanya
  // sebagai fallback offline/koneksi gagal. Mencegah bug yang sudah diperbaiki di kode tetap
  // tersaji dari cache lama sampai user hard refresh.
  const isScriptAsset = url.origin === self.location.origin && url.pathname.startsWith('/js/');
  if (isScriptAsset) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        return fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(req, networkResponse.clone());
            return networkResponse;
          }
          // Respons jaringan tidak sehat (mis. 500/502/503 sementara di origin/CDN) -- jangan
          // pecahkan halaman kalau ada salinan cache yang masih valid, pakai itu dulu drpd
          // meneruskan respons error ke browser.
          return cache.match(req).then((cached) => cached || networkResponse);
        }).catch(() => {
          // fetch() gagal total (offline/DNS) -- kalau cache juga kosong (mis. kunjungan
          // pertama yg langsung offline), Response.error() dipakai supaya respondWith() tetap
          // menerima Response yang valid, bukan undefined (yg bikin browser lempar TypeError).
          return cache.match(req).then((cached) => cached || Response.error());
        });
      })
    );
    return;
  }

  // 5. Aset statis lain (ikon, gambar, css, manifest): di-cache
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/icons/') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.ico') ||
      url.pathname.endsWith('.css') ||
      url.pathname === '/manifest.json');

  if (!isStaticAsset) {
    // Biarkan browser menangani request normal lainnya
    return;
  }

  // 6. Stale-While-Revalidate untuk aset statis non-skrip (aman basi sebentar, tidak ada logika)
  event.respondWith(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.match(req).then((cachedResponse) => {
        const fetchPromise = fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(req, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Jika fetch gagal (offline), kembalikan cachedResponse jika ada
          return cachedResponse;
        });

        // Kembalikan aset dari cache seketika jika ada, atau tunggu network jika belum di-cache
        return cachedResponse || fetchPromise;
      });
    }).catch(() => {
      return fetch(req);
    })
  );
});
