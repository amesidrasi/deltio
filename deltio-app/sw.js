/* Service worker της εφαρμογής «Γ' Αλλαγή».
   - Κρατά αντίγραφο της σελίδας ώστε η εφαρμογή να ανοίγει και χωρίς ίντερνετ.
   - Με ίντερνετ φέρνει πάντα την τελευταία έκδοση από το GitHub.
   - Δεν αγγίζει τις αποστολές προς το Google (δελτία, αναφορές, απόδοση).
   Όταν αλλάζετε ΜΟΝΟ αυτό το αρχείο, αυξήστε το VERSION. */
const VERSION = 'v4';
const CACHE = 'deltio-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './icons/badge.png',
  './fcm-config.js'
];
const NET_TIMEOUT_MS = 3500;

// ---- Ειδοποιήσεις push (Firebase). Αν δεν έχουν ρυθμιστεί, δεν γίνεται τίποτα. ----
try {
  importScripts('fcm-config.js');
  if (self.FCM_CONFIG && self.FCM_CONFIG.apiKey) {
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
                  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
    firebase.initializeApp(self.FCM_CONFIG);
    firebase.messaging();   // οι ειδοποιήσεις εμφανίζονται αυτόματα όταν η εφαρμογή είναι κλειστή
  }
} catch (e) { /* χωρίς push */ }

// Πάτημα σε ειδοποίηση: ανοίγει (ή φέρνει μπροστά) την εφαρμογή στη σωστή κλήση.
self.addEventListener('notificationclick', function (e) {
  const data = (e.notification && e.notification.data) || {};
  const fcm = data.FCM_MSG || {};
  const target = (fcm.data && fcm.data.target) || data.target || '';
  const url = new URL('./' + (target ? '#' + target : ''), self.registration.scope).href;
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (const c of list) { if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.navigate(url).catch(function(){}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});   // με αδύναμο σήμα, μετά από 3,5" ανοίγει το αποθηκευμένο

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);
  // Μόνο αρχεία της ίδιας της εφαρμογής· όλα τα άλλα (Google κ.λπ.) περνάνε κανονικά.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Ρυθμίσεις push: πάντα η πιο πρόσφατη (αλλιώς η αποθηκευμένη).
  if (url.pathname.endsWith('fcm-config.js')) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req); }));
    return;
  }
  // Σελίδα: πρώτα το δίκτυο (για να έρχονται οι ενημερώσεις), αλλιώς το αποθηκευμένο.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(networkFirst(req));
    return;
  }
  // Εικονίδια κ.λπ.: πρώτα το αποθηκευμένο.
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});

function networkFirst(req) {
  return new Promise(function (resolve) {
    let done = false;
    // final=true: το δίκτυο απέτυχε οριστικά, οπότε κάτι πρέπει να επιστραφεί.
    const fallback = function (final) {
      if (done) return;
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html');
      }).then(function (hit) {
        if (done) return;
        if (hit) { done = true; resolve(hit); }
        else if (final) {
          done = true;
          resolve(new Response('<meta charset="utf-8"><p style="font-family:sans-serif;padding:20px">Δεν υπάρχει σύνδεση. Ανοίξτε την εφαρμογή μία φορά με ίντερνετ.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
        }
      });
    };
    const timer = setTimeout(function () { fallback(false); }, NET_TIMEOUT_MS);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) {
          c.put(req, copy.clone());
          c.put('./index.html', copy);   // η τελευταία έκδοση γίνεται και η εφεδρική
        });
      }
      if (!done) { done = true; resolve(res); }
    }).catch(function () { clearTimeout(timer); fallback(true); });
  });
}
