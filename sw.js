// Blunder Lab web app: keeps a copy of the app's own files so it opens and runs with no connection.
// The network is tried first, so a new version shows up as soon as you are online; the copy is the fallback.
const CACHE = 'blunderlab-1.7.2';
const FILES = ['./', 'index.html', 'app.css', 'site.webmanifest', 'js/app.js', 'js/board.js', 'js/chess.js', 'js/courses.js', 'js/engine.js', 'js/platform.js', 'js/review.js', 'js/sync.js', 'js/trainer.js',
  'data/book.json', 'data/openings.json', 'engine/stockfish-19-lite-single.js', 'engine/stockfish-19-lite-single.wasm', 'icons/icon32.png', 'icons/icon180.png', 'icons/icon192.png']
  .concat(['w', 'b'].flatMap(c => ['K', 'Q', 'R', 'B', 'N', 'P'].map(p => 'pieces/' + c + p + '.svg')));
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => { /* one missing file must not stop the rest */ })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // chess.com and GitHub go straight to the network
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
