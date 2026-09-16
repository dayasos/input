// Service Worker MINIMAL -- satu-satunya tujuannya memenuhi syarat "installable" PWA di Chrome/
// Edge/Android (butuh service worker terdaftar dengan listener 'fetch' supaya event
// beforeinstallprompt bisa muncul). SENGAJA TIDAK melakukan caching respons API -- ini aplikasi
// data pemerintah yang datanya berubah dinamis.
//
// Revisi (v2): HANYA tangani GET untuk navigasi/aset statis.
// Jangan pernah mencegat request POST (/api/gas), PUT (upload berkas), atau URL berawalan /api/
// agar stream jaringan berjalan langsung di browser tanpa memicu uncaught promise rejection (sw.js:16).

const SW_VERSION = 'djpm-sw-v2';

self.addEventListener('install', (_event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Lewatkan langsung request non-GET dan request ke endpoint API/Storage
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  // Tangani GET dengan fallback aman jika offline
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response('Koneksi internet tidak tersedia.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
    })
  );
});

