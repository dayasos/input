/**
 * API Bridge - Pengganti google.script.run untuk lingkungan Vercel
 * File ini akan membungkus seluruh pemanggilan google.script.run.namaFungsi() 
 * dari frontend dan mengirimkannya secara aman ke backend Vercel (/api/gas).
 */

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

        // Jika fungsi yang dipanggil bukan handler, eksekusi pemanggilan fetch()
        return (...args) => {
          const payload = {
            action: prop,
            args: args
          };

          // Memanggil Serverless Function Vercel (bukan ke Google secara langsung)
          fetch('/api/gas', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          })
            .then(async res => {
              const contentType = res.headers.get('content-type') || '';
              if (!res.ok) {
                if (res.status === 413) {
                  throw new Error('Ukuran berkas melebihi batas upload Vercel (maks 4.5 MB). Mohon perkecil ukuran foto atau berkas yang diunggah.');
                }
                if (res.status === 504) {
                  throw new Error('Permintaan ke Google Apps Script mengalami batas waktu (timeout). Silakan coba beberapa saat lagi.');
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
            .then(data => {
              if (data && data.error) {
                // Deteksi otomatis jika sesi kedaluwarsa dari server
                if (typeof data.error === 'string' && (data.error.includes("SESI TIDAK SAH") || data.error.includes("Silakan login ulang"))) {
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

                // Jika server mengembalikan error, jalankan failureHandler
                const errObj = new Error(data.error);
                if (target._failureHandler) {
                  target._failureHandler(errObj, target._userObject);
                } else {
                  console.error("Backend GAS Error:", data.error);
                }
              } else {
                // Jika sukses, jalankan successHandler
                if (target._successHandler) {
                  target._successHandler(data ? data.result : undefined, target._userObject);
                }
              }
            })
            .catch(err => {
              if (target._failureHandler) {
                target._failureHandler(err, target._userObject);
              } else {
                console.error("Network / Fetch Error:", err);
              }
            });
        };
      }
    });
  }
}

// Pasangkan proxy ke dalam object global "google" yang biasa dipakai di Apps Script
window.google = window.google || {};
window.google.script = window.google.script || {};
window.google.script.run = new GoogleScriptRunProxy();
