// Service worker MINIMAL -- satu-satunya tujuannya memenuhi syarat "installable" PWA di Chrome/
// Edge/Android (butuh service worker terdaftar dengan listener 'fetch' supaya event
// beforeinstallprompt bisa muncul). SENGAJA TIDAK melakukan caching apa pun -- ini aplikasi
// data pemerintah yang datanya berubah terus (status verifikasi, kuota, dsb), jadi menyimpan
// respons lama di cache berisiko menampilkan data BASI ke user tanpa mereka sadari. Semua
// request tetap diteruskan langsung ke jaringan, sama seperti tanpa service worker.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
