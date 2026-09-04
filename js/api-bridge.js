/**
 * API Bridge - Pengganti google.script.run untuk lingkungan Vercel
 * File ini akan membungkus seluruh pemanggilan google.script.run.namaFungsi() 
 * dari frontend dan mengirimkannya secara aman ke backend Vercel (/api/gas).
 */

class GoogleScriptRunProxy {
  constructor(successHandler = null, failureHandler = null) {
    this._successHandler = successHandler;
    this._failureHandler = failureHandler;

    return new Proxy(this, {
      get: (target, prop) => {
        // Tangkap handler berantai (chained methods)
        if (prop === 'withSuccessHandler') {
          return (cb) => new GoogleScriptRunProxy(cb, target._failureHandler);
        }
        if (prop === 'withFailureHandler') {
          return (cb) => new GoogleScriptRunProxy(target._successHandler, cb);
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
            .then(res => res.json())
            .then(data => {
              if (data.error) {
                // Jika server mengembalikan error, jalankan failureHandler
                if (target._failureHandler) {
                  target._failureHandler(new Error(data.error));
                } else {
                  console.error("Backend GAS Error:", data.error);
                }
              } else {
                // Jika sukses, jalankan successHandler
                if (target._successHandler) {
                  target._successHandler(data.result);
                }
              }
            })
            .catch(err => {
              if (target._failureHandler) {
                target._failureHandler(err);
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
