// Keeps Blunder Lab's data the same on every device, in a private GitHub gist that belongs to the user.
// The gist holds state.json (puzzle progress, repertoire, settings that travel) and one rv-YYYY-MM.json per month of reviews.
const API = 'https://api.github.com';
export const GIST_NAME = 'Blunder Lab sync';

export class Gist {
  constructor(token) { this.token = token; this.etag = ''; }
  async req(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json' }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    let r;
    try { r = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body, cache: 'no-store' }); }
    catch (e) { throw new Error('Could not reach GitHub. Check your connection.'); }
    if (r.status === 304) return { same: true };
    if (r.status === 401) throw new Error('GitHub did not accept the token. Make a new one and paste it again.');
    if (r.status === 403 || r.status === 429) throw new Error('GitHub refused the request (' + r.status + '). The token may lack the “gist” permission, or you hit a rate limit; try again in a few minutes.');
    if (r.status === 404) throw new Error('GitHub could not find the sync storage. Turn sync off and on again.');
    if (!r.ok) throw new Error('GitHub returned an error (' + r.status + ').');
    return { json: await r.json(), etag: r.headers.get('ETag') || '' };
  }
  // The id of the user's Blunder Lab gist; makes it the first time.
  async find() {
    for (let page = 1; page <= 3; page++) {
      const list = (await this.req('/gists?per_page=100&page=' + page)).json;
      const g = list.find(x => x.description === GIST_NAME);
      if (g) return g.id;
      if (list.length < 100) break;
    }
    const made = await this.req('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_NAME, public: false, files: { 'state.json': { content: '{}' } } }) });
    return made.json.id;
  }
  // Every file, parsed. Returns null when nothing changed since the last read.
  async read(id) {
    const r = await this.req('/gists/' + id, this.etag ? { headers: { 'If-None-Match': this.etag } } : {});
    if (r.same) return null;
    const out = {};
    for (const name in r.json.files) {
      const f = r.json.files[name];
      let text = f.content;
      if (f.truncated) { try { text = await (await fetch(f.raw_url, { cache: 'no-store' })).text(); } catch (e) { throw new Error('Could not download ' + name + ' from GitHub.'); } }
      try { out[name] = JSON.parse(text || '{}'); } catch (e) { out[name] = {}; }
    }
    this.etag = r.etag;
    return out;
  }
  async write(id, files) {
    const body = {};
    for (const name in files) body[name] = { content: JSON.stringify(files[name]) };
    await this.req('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: body }) });
    this.etag = ''; // our own write changed it; read fresh next time
  }
}

/* ---------- merging two copies (pure) ---------- */

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
export const same = (a, b) => stable(a) === stable(b);
const pickMap = (a, b, better) => { const out = Object.assign({}, a || {}); for (const k in b || {}) out[k] = k in out ? (better(b[k], out[k]) ? b[k] : out[k]) : b[k]; return out; };
// Today's daily puzzles. A newer day replaces an older one. On the same day the set started first is the base, the
// other fills any gaps (five per type at most), and each puzzle keeps its best result.
export function mergeDaily(a, b) {
  const none = { day: '', t: 0, list: [], res: {} };
  if (!a || !a.day) return b && b.day ? b : none;
  if (!b || !b.day) return a;
  if (a.day !== b.day) return a.day > b.day ? a : b;
  const first = (a.t || 0) <= (b.t || 0), x = first ? a : b, y = first ? b : a, list = x.list.slice(), n = {}, rank = { ok: 3, fixed: 2, miss: 1 }, res = Object.assign({}, x.res);
  list.forEach(p => { n[p.th] = (n[p.th] || 0) + 1; });
  for (const p of y.list) if (!list.some(q => q.id === p.id) && (n[p.th] || 0) < 5) { list.push(p); n[p.th] = (n[p.th] || 0) + 1; }
  for (const k in y.res) if ((rank[y.res[k]] || 0) > (rank[res[k]] || 0)) res[k] = y.res[k];
  return { day: x.day, t: x.t, list, res };
}
/* goals: { t, rating, pz, rv }, act: { 'YYYY-MM-DD': { pz } } (each day keeps its highest count).
   state: { user: { v, t }, puzzles: { id: p }, opProg: { name: { n, clean, last } }, rep: { t, list }, calib: { id: { w, b, t } }, endProg: { id: { n, ok } }, pasted: [meta] }
   Nothing is ever lost by merging: the copy with more practice behind it wins, item by item. */
export function mergeState(a, b) {
  a = a || {}; b = b || {};
  const newer = (x, y) => ((x && x.t) || 0) >= ((y && y.t) || 0) ? x : y;
  const pasted = {};
  for (const g of (a.pasted || []).concat(b.pasted || [])) pasted[g.id] = g;
  return {
    user: (u => (u && u.v ? u : [a.user, b.user].find(x => x && x.v) || { v: '', t: 0 }))(newer(a.user, b.user)), // an empty name never beats a real one
    puzzles: pickMap(a.puzzles, b.puzzles, (x, y) => (x.seen || 0) > (y.seen || 0) || ((x.seen || 0) === (y.seen || 0) && (x.due || 0) > (y.due || 0))),
    opProg: pickMap(a.opProg, b.opProg, (x, y) => (x.n || 0) > (y.n || 0)),
    rep: newer(a.rep, b.rep) || { t: 0, list: [] },
    calib: pickMap(a.calib, b.calib, (x, y) => (x.t || 0) > (y.t || 0)),
    endProg: pickMap(a.endProg, b.endProg, (x, y) => (x.n || 0) > (y.n || 0)),
    goals: newer(a.goals, b.goals) || { t: 0 },
    daily: mergeDaily(a.daily, b.daily),
    act: (() => { const out = {}; for (const src of [a.act || {}, b.act || {}]) for (const day in src) { const o = out[day] || (out[day] = {}); for (const k in src[day]) o[k] = Math.max(o[k] || 0, src[day][k]); } return out; })(),
    pasted: Object.values(pasted)
  };
}
// One month of reviews: { gameId: { g: game, rv: review } }. The deeper review wins; at equal depth, the later one.
export const mergeMonth = (a, b) => pickMap(a, b, (x, y) => (x.rv.depth || 0) > (y.rv.depth || 0) || ((x.rv.depth || 0) === (y.rv.depth || 0) && (x.rv.at || 0) > (y.rv.at || 0)));
export function monthKey(t) { const d = new Date(t || 0); return 'rv-' + d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.json'; }
// A review as it travels: the long engine lines are cut short to keep the files small.
export function slim(rv) {
  return Object.assign({}, rv, { evals: rv.evals.map(e => Object.assign({}, e, { lines: e.lines.map((l, i) => (l.pv ? Object.assign({}, l, { pv: l.pv.slice(0, i ? 3 : 8) }) : l)) })) });
}
