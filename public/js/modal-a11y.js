/**
 * public/js/modal-a11y.js
 * Perilaku pop up (modal) yang seragam untuk seluruh aplikasi, tanpa mengubah satu per satu modal:
 *   - role="dialog" + aria-modal + aria-labelledby otomatis.
 *   - Scroll halaman di belakang dikunci selama ada modal terbuka.
 *   - Fokus dipindah ke modal saat dibuka (tanpa memunculkan keyboard HP) & dikembalikan saat ditutup.
 *   - Tab tidak keluar dari modal teratas (focus trap).
 *   - ESC menutup modal teratas LEWAT tombol tutupnya sendiri (supaya pembersihan/cleanup bawaan modal
 *     tetap jalan). Modal wajib yang tidak punya tombol tutup (login, profil awal, update sistem, dll.)
 *     otomatis tidak bisa ditutup ESC.
 *   - Formulir isian (atribut data-jaga-isian): klik di luar modal TIDAK menutup bila ada isian yang
 *     sudah diubah (minta konfirmasi), dan tidak menutup bila klik berasal dari seret/pilih teks.
 *   - Label <label> yang belum terhubung ke input-nya dihubungkan otomatis; tombol "×" diberi nama
 *     aksesibel & area sentuh lebih besar.
 * Pemantau hanya bereaksi pada elemen "overlay" (class fixed + inset-0 + ber-id), jadi murah.
 */
(function () {
  'use strict';

  var SEL_FOKUS = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var SEL_KONTROL = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea';
  // Punya mekanisme sendiri sepenuhnya -> jangan diatur di sini.
  var ABAIKAN = { 'loading-overlay': 1 };
  // ESC sudah ditangani handler lain di app-core.js -> jangan ditutup dua kali.
  var ESC_SENDIRI = { 'modal-konfirmasi-universal': 1, 'modal-konfirmasi-logout': 1 };
  var TEKS_TUTUP = { '×': 1, '✕': 1, 'tutup': 1, 'batal': 1, 'kembali': 1, 'nanti saja': 1 };

  var state = new Map();   // overlay terbuka -> { opener, dirty, urutan }
  var urutanBuka = 0;
  var jumlahKunci = 0;
  var bodySebelum = null;
  var downTarget = null;
  var idAcak = 0;

  function uji() { return window.__ujiModalA11y === true; }

  function adalahOverlay(el) {
    return !!el && el.nodeType === 1 && !!el.id && !ABAIKAN[el.id] &&
      el.classList.contains('fixed') && el.classList.contains('inset-0');
  }

  function terbuka(el) {
    if (el.classList.contains('hidden')) return false;
    if (el.style && el.style.display === 'none') return false;
    // Modal konfirmasi memudar dulu (opacity-0 + pointer-events-none) sebelum diberi 'hidden'.
    if (el.classList.contains('opacity-0') && el.classList.contains('pointer-events-none')) return false;
    return true;
  }

  function zIndexDari(el) {
    var m = /(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(el.className || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  function teratas() {
    var terpilih = null, zTerpilih = -1, uTerpilih = -1;
    state.forEach(function (s, el) {
      var z = zIndexDari(el);
      if (z > zTerpilih || (z === zTerpilih && s.urutan > uTerpilih)) {
        terpilih = el; zTerpilih = z; uTerpilih = s.urutan;
      }
    });
    return terpilih;
  }

  function tampak(el) {
    return !el.closest('.hidden,[hidden]');
  }

  function elemenFokus(wadah) {
    return Array.prototype.filter.call(wadah.querySelectorAll(SEL_FOKUS), tampak);
  }

  // ---- Kunci scroll halaman ----------------------------------------------------------------
  function kunciScroll() {
    jumlahKunci++;
    if (jumlahKunci !== 1) return;
    var b = document.body;
    bodySebelum = { overflow: b.style.overflow, paddingRight: b.style.paddingRight };
    var lebarBar = window.innerWidth - document.documentElement.clientWidth;
    b.style.overflow = 'hidden';
    if (lebarBar > 0) {
      var awal = parseFloat(window.getComputedStyle(b).paddingRight) || 0;
      b.style.paddingRight = (awal + lebarBar) + 'px';
    }
  }

  function lepasScroll() {
    if (jumlahKunci === 0) return;
    jumlahKunci--;
    if (jumlahKunci === 0 && bodySebelum) {
      document.body.style.overflow = bodySebelum.overflow;
      document.body.style.paddingRight = bodySebelum.paddingRight;
      bodySebelum = null;
    }
  }

  // ---- Atribut aksesibilitas ----------------------------------------------------------------
  function rapikanLabel(akar) {
    var daftar = akar.querySelectorAll('label:not([for])');
    for (var i = 0; i < daftar.length; i++) {
      var lb = daftar[i];
      if (lb.querySelector(SEL_KONTROL)) continue;            // sudah membungkus inputnya
      var kontrol = null, induk = lb.parentElement;
      if (induk) {
        var anak = induk.querySelectorAll(SEL_KONTROL);
        // Hanya bila induknya memuat tepat 1 label & 1 kontrol (pasangan jelas), supaya tidak salah tautan.
        if (anak.length === 1 && !anak[0].closest('label') && induk.querySelectorAll('label').length === 1) kontrol = anak[0];
      }
      if (!kontrol && lb.nextElementSibling) {
        var sb = lb.nextElementSibling;
        if (sb.matches && sb.matches(SEL_KONTROL)) kontrol = sb;
        else if (sb.querySelectorAll) {
          var dlm = sb.querySelectorAll(SEL_KONTROL);
          if (dlm.length === 1) kontrol = dlm[0];
        }
      }
      if (!kontrol) continue;
      if (!kontrol.id) kontrol.id = 'fld-auto-' + (++idAcak);
      lb.setAttribute('for', kontrol.id);
    }
  }

  function pasangAria(el) {
    if (!el.hasAttribute('role')) {
      el.setAttribute('role', 'dialog');
      el.setAttribute('data-a11y-otomatis', '');   // penanda: role ini dipasang di sini, bukan oleh modalnya
    }
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    if (!el.hasAttribute('aria-labelledby') && !el.hasAttribute('aria-label')) {
      var judul = el.querySelector('h1,h2,h3,h4');
      if (judul) {
        if (!judul.id) judul.id = el.id + '-judul';
        el.setAttribute('aria-labelledby', judul.id);
      }
    }
    var tombol = el.querySelectorAll('button');
    for (var i = 0; i < tombol.length; i++) {
      var t = (tombol[i].textContent || '').trim();
      if ((t === '×' || t === '✕') && !tombol[i].hasAttribute('aria-label')) {
        tombol[i].setAttribute('aria-label', 'Tutup');
        // Perbesar area sentuh tanpa menggeser tata letak (padding diimbangi margin negatif).
        tombol[i].style.padding = '10px 12px';
        tombol[i].style.margin = '-10px -12px';
      }
    }
    rapikanLabel(el);
  }

  // ---- Buka / tutup ----------------------------------------------------------------------------
  function saatDibuka(el) {
    var aktif = document.activeElement;
    state.set(el, {
      opener: (aktif && aktif !== document.body && !el.contains(aktif)) ? aktif : null,
      dirty: false,
      urutan: ++urutanBuka,
    });
    pasangAria(el);
    kunciScroll();
    // Fokus ke wadah modal (bukan ke input) supaya keyboard HP tidak muncul sendiri. Kalau modal
    // sudah memindahkan fokus ke dalamnya (mis. login), jangan diganggu.
    setTimeout(function () {
      if (state.has(el) && !el.contains(document.activeElement)) {
        try { el.focus({ preventScroll: true }); } catch (_e) { /* abaikan */ }
      }
    }, 0);
  }

  function saatDitutup(el) {
    var s = state.get(el);
    state.delete(el);
    lepasScroll();
    if (s && s.opener && s.opener.isConnected) {
      var a = document.activeElement;
      if (!a || a === document.body || el.contains(a)) {
        try { s.opener.focus({ preventScroll: true }); } catch (_e) { /* abaikan */ }
      }
    }
  }

  function sinkron(el) {
    if (!adalahOverlay(el)) return;
    var buka = terbuka(el);
    if (buka && !state.has(el)) saatDibuka(el);
    else if (!buka && state.has(el)) saatDitutup(el);
  }

  function pindaiSemua() {
    var daftar = document.querySelectorAll('.fixed.inset-0[id]');
    for (var i = 0; i < daftar.length; i++) sinkron(daftar[i]);
  }

  // ---- Tombol tutup bawaan modal (dipakai ESC) ---------------------------------------------
  function tombolTutup(el) {
    var tombol = el.querySelectorAll('button,[role="button"]');
    for (var i = 0; i < tombol.length; i++) {
      var b = tombol[i];
      if (!tampak(b) || b.disabled) continue;
      if (b.hasAttribute('data-modal-close') || b.getAttribute('aria-label') === 'Tutup') return b;
      var t = (b.textContent || '').trim().toLowerCase();
      if (TEKS_TUTUP[t]) return b;
    }
    return null;
  }

  // ---- Papan ketik -----------------------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.isComposing || state.size === 0) return;
    var el = teratas();
    if (!el) return;

    if (e.key === 'Escape') {
      // Modal konfirmasi/logout menangani ESC-nya sendiri. Bila salah satunya terbuka, jangan
      // ikut menutup modal di bawahnya pada penekanan tombol yang sama.
      for (var id in ESC_SENDIRI) {
        var lain = document.getElementById(id);
        if (lain && state.has(lain)) return;
      }
      if (el.getAttribute('data-esc-sendiri') !== null) return;
      // Modal yang dibuat skrip lain dan sudah mengatur ESC-nya sendiri (kelola data/ibadah).
      if (el.hasAttribute('role') && !el.hasAttribute('data-a11y-otomatis')) return;
      var tb = tombolTutup(el);
      if (tb) { e.preventDefault(); tb.click(); }
      return;
    }

    if (e.key === 'Tab') {
      var fokus = elemenFokus(el);
      if (fokus.length === 0) { e.preventDefault(); el.focus(); return; }
      var pertama = fokus[0], terakhir = fokus[fokus.length - 1], a = document.activeElement;
      if (!el.contains(a) || a === el) {
        e.preventDefault();
        (e.shiftKey ? terakhir : pertama).focus();
      } else if (e.shiftKey && a === pertama) {
        e.preventDefault(); terakhir.focus();
      } else if (!e.shiftKey && a === terakhir) {
        e.preventDefault(); pertama.focus();
      }
    }
  });

  // ---- Perlindungan isian pada formulir -----------------------------------------------------
  function tandaiKotor(e) {
    if (!e.isTrusted && !uji()) return;            // abaikan perubahan nilai oleh program
    var ov = e.target && e.target.closest ? e.target.closest('[data-jaga-isian]') : null;
    var s = ov ? state.get(ov) : null;
    if (s) s.dirty = true;
  }
  document.addEventListener('input', tandaiKotor, true);
  document.addEventListener('change', tandaiKotor, true);

  document.addEventListener('pointerdown', function (e) { downTarget = e.target; }, true);
  document.addEventListener('mousedown', function (e) { downTarget = e.target; }, true);

  // Fase tangkap: berjalan SEBELUM onclick inline di overlay ("if(event.target===this) ... hidden").
  document.addEventListener('click', function (e) {
    var ov = e.target;
    if (!adalahOverlay(ov) || !ov.hasAttribute('data-jaga-isian') || !state.has(ov)) return;
    var mulaiDariLuar = downTarget === ov;
    // Klik "jadi" di overlay karena seret dari dalam panel (mis. memilih teks) -> bukan klik backdrop.
    if (!mulaiDariLuar) { e.stopImmediatePropagation(); e.preventDefault(); return; }
    var s = state.get(ov);
    if (!s.dirty) return;                          // tidak ada isian -> perilaku lama (langsung tutup)
    e.stopImmediatePropagation();
    e.preventDefault();
    if (typeof window.konfirmasiAksi !== 'function') return;   // tanpa dialog konfirmasi, jangan menutup
    window.konfirmasiAksi({
      judul: 'Buang isian?',
      pesan: 'Isian yang sudah Anda ketik belum disimpan. Tutup formulir ini dan buang isiannya?',
      tipe: 'warning',
      teksBatal: 'Lanjut mengisi',
      teksKonfirmasi: 'Buang & Tutup',
    }).then(function (ya) {
      if (ya && state.has(ov)) ov.classList.add('hidden');
    });
  }, true);

  // ---- Pemantau ----------------------------------------------------------------------------------
  function mulai() {
    var gaya = document.createElement('style');
    gaya.id = 'modal-a11y-css';
    gaya.textContent =
      '[role="dialog"]:focus{outline:none}' +
      '[role="dialog"] button:focus-visible,[role="dialog"] a:focus-visible{outline:2px solid #0284c7;outline-offset:2px}';
    document.head.appendChild(gaya);

    rapikanLabel(document);
    pindaiSemua();

    // 1) Buka/tutup modal = perubahan class/style pada overlay itu sendiri.
    new MutationObserver(function (catatan) {
      for (var i = 0; i < catatan.length; i++) sinkron(catatan[i].target);
    }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });

    // 2) Modal yang dibuat/dibuang skrip lain: cukup anak langsung <body> (tidak subtree, supaya
    //    render tabel besar tidak ikut memicu pemantau ini).
    new MutationObserver(function (catatan) {
      for (var i = 0; i < catatan.length; i++) {
        var c = catatan[i], j;
        for (j = 0; j < c.addedNodes.length; j++) sinkron(c.addedNodes[j]);
        for (j = 0; j < c.removedNodes.length; j++) {
          if (state.has(c.removedNodes[j])) saatDitutup(c.removedNodes[j]);
        }
      }
    }).observe(document.body, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai);
  else mulai();

  window.__modalA11y = { tumpukan: function () { return state.size; } };
})();
