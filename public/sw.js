// Service Worker DJPM 2027 (v3)
// Fitur:
// 1. Memenuhi syarat Installable PWA.
// 2. Network-First untuk Navigasi Dokumen HTML (agar reload selalu menyajikan versi terkini saat online).
// 3. Stale-While-Revalidate HANYA untuk aset statis lokal (/js/, icons, logo, manifest, css).
// 4. MUTLAK BYPASS untuk: request non-GET, endpoint API (/api/), Google Drive/APIs, dan Supabase.
// 5. Otomatis membersihkan cache versi lama saat aktivasi.

const SW_VERSION = 'djpm-sw-v3';
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

  // 4. Hanya aset statis lokal yang di-cache (JS, CSS, Gambar, Font, Manifest)
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/js/') ||
     url.pathname.startsWith('/icons/') ||
     url.pathname.endsWith('.png') ||
     url.pathname.endsWith('.jpg') ||
     url.pathname.endsWith('.svg') ||
     url.pathname.endsWith('.ico') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.js') ||
     url.pathname === '/manifest.json');

  if (!isStaticAsset) {
    // Biarkan browser menangani request normal lainnya
    return;
  }

  // 5. Stale-While-Revalidate untuk aset statis lokal
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
