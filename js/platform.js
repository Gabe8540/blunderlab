// Where Blunder Lab keeps its data. As a Chrome extension: chrome.storage. As a web app (phone, tablet, any browser):
// IndexedDB in that browser. Both look the same to the app: get(null) -> everything, set({ key: value }).
export const isExt = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);

function webStore() {
  const mem = {};
  let dbp = null;
  const open = () => dbp || (dbp = new Promise(res => {
    try {
      const rq = indexedDB.open('blunderlab', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = rq.onblocked = () => res(null);
    } catch (e) { res(null); } // private browsing: keep going in memory
  }));
  const tx = (db, mode, fn) => new Promise(res => {
    try { const t = db.transaction('kv', mode), out = fn(t.objectStore('kv')); t.oncomplete = () => res(out); t.onerror = t.onabort = () => res(out); } catch (e) { res(null); }
  });
  return {
    async get() {
      const db = await open();
      if (!db) return Object.assign({}, mem);
      const out = {};
      await tx(db, 'readonly', s => { const rq = s.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } }; });
      return out;
    },
    async set(obj) {
      Object.assign(mem, obj);
      const db = await open();
      if (db) await tx(db, 'readwrite', s => { for (const k in obj) s.put(obj[k], k); });
    },
    async remove(keys) {
      const db = await open();
      for (const k of [].concat(keys)) delete mem[k];
      if (db) await tx(db, 'readwrite', s => { for (const k of [].concat(keys)) s.delete(k); });
    }
  };
}
export const store = isExt ? chrome.storage.local : webStore();
export const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches;
