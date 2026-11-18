// Blunder Lab page: games list, review, lines you can step through, puzzles and insights.
import { Chess } from './chess.js';
import { Engine, analyseGame } from './engine.js';
import * as R from './review.js';
import { Board } from './board.js';
import * as T from './trainer.js';
import { CORE, ideaFor } from './courses.js';
import { store, isExt, touch } from './platform.js';
import * as Y from './sync.js';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ENGINE = 'engine/stockfish-19-lite-single.js';
const DEPTHS = { quick: 10, standard: 14, deep: 18 };

const S = {
  settings: { user: '', depth: 'standard', auto: true },
  games: [], reviews: {}, puzzles: {}, book: { names: {}, set: new Set() },
  tab: 'games', cur: null,          // cur: { meta, game, rv }
  ply: 0, flipped: false, line: null, // line: { base, moves, step, label }
  puzzle: null,                      // { p, state: 'ask' | 'right' | 'wrong' | 'shown', first, note }
  live: { fen: '', lines: [] }, busy: null, error: '', notice: null,
  hist: [], histMonths: [], histUser: '', eloTc: '',   // hist: one small record per game, every game you have played
  train: null,                       // a trainer session on the board
  tr: { sub: 'opp', color: 'w', tc: '', q: '', course: null }, opProg: {},
  rep: { t: 0, list: [] }, calib: {}, endProg: {}, scout: null, pzTheme: '', pzMaking: null, pzMsg: '',
  trainGames: [], // other players' games, hidden everywhere but the tuning (removed ones stay as { id, removed })
  goals: { t: 0 }, act: {}, explain: '', drillMsg: '', daily: { day: '', t: 0, list: [], res: {} },
  sync: { token: '', gist: '', last: 0, error: '', busy: false }
};
let bg, live, liveToken = 0, cancelBatch = false;

/* ---------- storage ---------- */

async function loadAll() {
  const d = await store.get(null);
  if (d.settings) Object.assign(S.settings, d.settings);
  S.games = d.games || [];
  S.puzzles = d.puzzles || {};
  S.hist = d.hist || []; S.histMonths = d.histMonths || []; S.histUser = d.histUser || ''; S.opProg = d.opProg || {};
  S.rep = d.rep || { t: 0, list: [] }; S.calib = d.calib || {}; S.endProg = d.endProg || {};
  S.trainGames = d.trainGames || [];
  S.goals = d.goals || { t: 0 }; S.act = d.act || {}; if (d.daily && d.daily.list) S.daily = d.daily;
  if ((d.histV || 1) < 2) S.histMonths = []; // older records lack the opponent's name: read the months again once
  S.sync.token = d.syncToken || ''; S.sync.gist = d.syncGist || '';
  if (!d.settings && touch) S.settings.depth = 'quick'; // phones and tablets start on the fast setting
  for (const k in d) if (k.startsWith('rv:')) S.reviews[k.slice(3)] = d[k];
  const raw = await (await fetch('data/book.json')).json();
  S.book = { names: raw.names, set: new Set(raw.more) };
}
const saveSettings = () => store.set({ settings: S.settings });
const savePuzzles = () => { touchSync(); return store.set({ puzzles: S.puzzles }); };

/* ---------- chess.com ---------- */

function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = 'blcb' + Date.now() + Math.floor(Math.random() * 1e4), s = document.createElement('script');
    const done = () => { try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); };
    window[cb] = d => { done(); res(d); };
    s.onerror = () => { done(); rej(new Error('blocked')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
    setTimeout(() => { if (window[cb]) { done(); rej(new Error('timeout')); } }, 15000);
  });
}
async function getJSON(url, who) {
  let r;
  try { r = await fetch(url, { credentials: 'omit' }); }
  catch (e) {
    // a web page (not the extension) can be refused by chess.com's cross-site rules: try its script-callback form before giving up
    if (!isExt) { try { return await jsonp(url); } catch (e2) { throw new Error('This browser could not read chess.com directly. With sync on, games reviewed on your computer still show up here.'); } }
    throw new Error('Could not reach chess.com. Check your connection and try again.');
  }
  if (r.status === 404) throw new Error('chess.com has no player called “' + (who || S.settings.user) + '”.');
  if (!r.ok) throw new Error('chess.com returned an error (' + r.status + '). Try again in a minute.');
  return r.json();
}
function toMeta(g, user) {
  const me = user.toLowerCase(), white = (g.white && g.white.username) || '?', black = (g.black && g.black.username) || '?';
  const color = black.toLowerCase() === me ? 'b' : 'w', mine = color === 'w' ? g.white : g.black, opp = color === 'w' ? g.black : g.white;
  const v960 = g.rules === 'chess960';
  let opening = v960 ? 'Chess960' : '';
  if (!v960) try { const game = R.readGame(g.pgn); for (const p of game.plies.slice(0, 40)) { const n = S.book.names[R.bookKey(p.after)]; if (n) opening = n; } } catch (e) { return null; }
  if (!opening) { const m = /\[ECOUrl ".*\/openings\/([^"]+)"\]/.exec(g.pgn); if (m) opening = m[1].replace(/-/g, ' ').replace(/ \d.*$/, ''); }
  return { id: String(g.uuid || g.url), url: g.url || '', pgn: g.pgn, white, black, wr: g.white && g.white.rating, br: g.black && g.black.rating, color,
    result: R.outcome(mine && mine.result), how: (mine && mine.result === 'win' ? opp && opp.result : mine && mine.result) || '', opponent: opp && opp.username,
    timeClass: g.time_class || '', end: (g.end_time || 0) * 1000, opening, v960 };
}
/* Reads games from chess.com. 'full' fetches every month not stored yet (back to your first game) and re-reads the newest two;
   'quick' reads only the current month. Returns the games that finished since the last time we looked. */
async function syncGames(mode) {
  const user = S.settings.user.trim(), lower = user.toLowerCase();
  if (!user) throw new Error('Enter your chess.com username first.');
  const base = 'https://api.chess.com/pub/player/' + encodeURIComponent(lower);
  const same = S.histUser === lower;
  if (!same) { S.hist = []; S.histMonths = []; S.games = S.games.filter(g => g.pasted || g.added || S.reviews[g.id]); }
  const prevNewest = same ? S.games.reduce((a, g) => (g.pasted ? a : Math.max(a, g.end)), 0) : 0;
  let months, metaMonths, settled = [];
  if (mode === 'quick') {
    const d = new Date(), url = t => base + '/games/' + t.getUTCFullYear() + '/' + String(t.getUTCMonth() + 1).padStart(2, '0');
    months = [url(d)];
    if (d.getUTCDate() <= 1) months.push(url(new Date(d.getTime() - 2 * 864e5))); // around midnight on the 1st the game may sit in either month
    metaMonths = new Set(months);
  } else {
    const all = (await getJSON(base + '/games/archives')).archives || [];
    metaMonths = new Set(all.slice(-4)); settled = all.slice(0, -2);
    months = all.filter((m, i) => i >= all.length - 2 || !S.histMonths.includes(m)).reverse();
  }
  const known = new Set(S.games.map(g => g.id)), hk = new Map(S.hist.map((h, i) => [h.id, i])), fresh = [];
  for (let i = 0; i < months.length; i++) {
    if (mode !== 'quick' && S.busy) { S.busy.done = i; S.busy.total = months.length; if (months.length > 4) S.busy.text = 'Loading your game history from chess.com (month ' + (i + 1) + ' of ' + months.length + ', first time only)'; renderStatus(); }
    let d;
    try { d = await getJSON(months[i]); } catch (e) { if (mode === 'quick') continue; throw e; }
    for (const g of d.games || []) {
      if ((g.rules && g.rules !== 'chess' && g.rules !== 'chess960') || !g.pgn) continue;
      const id = String(g.uuid || g.url);
      if (!hk.has(id)) { const h = T.histRecord(g, user, S.book.names); if (h) { hk.set(id, S.hist.length); S.hist.push(h); } }
      else if (S.hist[hk.get(id)].opp === undefined) { const h = T.histRecord(g, user, S.book.names); if (h) S.hist[hk.get(id)] = h; }
      if (!known.has(id) && metaMonths.has(months[i])) { const meta = toMeta(g, user); if (meta) { fresh.push(meta); known.add(id); } }
    }
    if (settled.includes(months[i]) && !S.histMonths.includes(months[i])) S.histMonths.push(months[i]);
  }
  S.hist.sort((a, b) => a.end - b.end);
  const room = {}; // up to 80 recent games of each kind
  S.games = S.games.concat(fresh).sort((a, b) => b.end - a.end).filter(g => g.pasted || g.added || S.reviews[g.id] || (room[gcat(g)] = (room[gcat(g)] == null ? 80 : room[gcat(g)]) - 1) >= 0);
  S.histUser = lower;
  const newest = S.games.reduce((a, g) => (g.pasted ? a : Math.max(a, g.end)), 0);
  await store.set(Object.assign({ games: S.games, hist: S.hist, histMonths: S.histMonths, histUser: lower, lastEnd: newest }, mode === 'quick' ? {} : { histV: 2 }));
  return prevNewest ? fresh.filter(g => g.end > prevNewest && S.games.includes(g)) : [];
}
// Looks for games that have just finished (on any device) and reviews them without being asked.
let syncing = false;
async function autoSync() {
  if (syncing || S.busy || !S.settings.user) return;
  syncing = true;
  try {
    const fresh = (await syncGames('quick')).filter(g => !S.reviews[g.id]);
    if (fresh.length) { softPanel(); if (S.settings.auto !== false) await reviewMany(fresh, true); }
  } catch (e) { /* offline or chess.com busy: try again next minute */ }
  syncing = false;
}
function softPanel() { // refresh the panel unless that would wipe something being typed
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox') return;
  if (S.tab === 'games' || S.tab === 'insights' || (S.tab === 'puzzles' && !S.puzzle)) renderPanel();
}

/* ---------- rating chart ---------- */

let eloData = null;
function eloHTML() {
  const all = ['rapid', 'blitz', 'bullet', 'daily', 'chess960', 'daily960'].map(tc => ({ tc, s: T.ratingSeries(S.hist, tc) })).filter(x => x.s.length >= 3).sort((a, b) => b.s.length - a.s.length);
  if (!all.length) return '<h3>Rating</h3><div class="card"><p class="muted">No rated games loaded yet. Press “Load my games” on the Games tab.</p></div>';
  const pick = all.find(x => x.tc === S.eloTc) || all[0], full = pick.s, ser = S.eloAll ? full : full.slice(-150), n = ser.length, P = T.project(full, 30), ahead = P ? P.ahead : 0, skip = full.length - n;
  S.eloTc = pick.tc;
  const vals = ser.map(h => h.r).concat(P ? [P.projLo, P.projHi, P.proj] : []);
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const pad = Math.max(10, (hi - lo) * 0.12);
  lo = Math.floor((lo - pad) / 10) * 10; hi = Math.ceil((hi + pad) / 10) * 10;
  const span = Math.max(n - 1 + ahead, 1), x = i => i / span * 100, y = v => (1 - (v - lo) / (hi - lo)) * 100, f = v => v.toFixed(2);
  eloData = { ser, n, ahead, P, span, skip };
  let d = '';
  ser.forEach((h, i) => { d += (i ? 'L' : 'M') + f(x(i)) + ' ' + f(y(h.r)); });
  let proj = '';
  if (P) {
    const up = P.pathHi.map((v, i) => f(x(n - 1 + i)) + ' ' + f(y(v))), down = P.pathLo.map((v, i) => f(x(n - 1 + i)) + ' ' + f(y(v))).reverse();
    proj = '<path class="eband" d="M' + up.concat(down).join('L') + 'Z"/><path class="eproj" d="M' + P.path.map((v, i) => f(x(n - 1 + i)) + ' ' + f(y(v))).join('L') + '"/>';
  }
  const ticks = [hi, Math.round((lo + hi) / 20) * 10, lo], cur = ser[n - 1].r, peak = Math.max.apply(null, full.map(h => h.r));
  const side = v => (y(v) < 18 ? 'top:' + (y(v) + 6) : 'top:' + (y(v) - 16)) + '%';
  let h = '<h3>Rating</h3><div class="card">' +
    (all.length > 1 ? '<div class="seg">' + all.map(a => '<button data-act="eloTc" data-v="' + a.tc + '" aria-pressed="' + (a.tc === pick.tc) + '">' + a.tc.charAt(0).toUpperCase() + a.tc.slice(1) + ' <span class="muted">' + a.s.length + '</span></button>').join('') + '</div>' : '') +
    '<div class="stats four"><div><b>' + cur + '</b><span>' + pick.tc + ' now</span></div><div><b>' + peak + '</b><span>peak</span></div><div><b>' + (P ? P.perf : '–') + '</b><span>playing like</span></div><div><b>' + (P ? P.proj : '–') + '</b><span>in ' + (ahead || 30) + ' games</span></div></div>' +
    '<div class="elo"><div class="ey">' + ticks.map(t => '<span style="top:' + y(t) + '%">' + t + '</span>').join('') + '</div>' +
    '<div class="eplot" id="eloPlot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Rating after each rated ' + pick.tc + ' game, with a projection">' +
    ticks.map(t => '<line class="egrid" x1="0" x2="100" y1="' + f(y(t)) + '" y2="' + f(y(t)) + '"/>').join('') +
    (P ? '<line class="enow" x1="' + f(x(n - 1)) + '" x2="' + f(x(n - 1)) + '" y1="0" y2="100"/>' : '') + proj + '<path class="eline" d="' + d + '"/></svg>' +
    '<i class="edot" style="left:' + x(n - 1) + '%;top:' + y(cur) + '%"></i>' +
    (P ? '<i class="edot hollow" style="left:100%;top:' + y(P.proj) + '%"></i><span class="elab" style="right:8px;' + side(P.proj) + '">≈ ' + P.proj + '</span>' : '') +
    '<i class="ecross" id="eloCross" hidden></i></div>' +
    '<div class="ex"><span>' + esc(when(ser[0].end)) + '</span><span>' + (P ? 'next ' + ahead + ' games →' : esc(when(ser[n - 1].end))) + '</span></div></div>' +
    '<p class="muted eread" id="eloRead">' + (skip ? 'Your last ' + n + ' of ' + full.length : 'All ' + n) + ' rated ' + pick.tc + ' games. Point at the chart to read any game.</p>' +
    (full.length > 150 ? '<button class="link" data-act="eloAll">' + (S.eloAll ? 'Show only the last 150 games' : 'Show all ' + full.length + ' games') + '</button>' : '');
  if (!P) return h + '<p>Play at least 8 rated ' + pick.tc + ' games and a projection appears here.</p></div>';
  h += '<p>In your last ' + P.games + ' rated ' + pick.tc + ' games you went ' + P.w + 'W ' + P.d + 'D ' + P.l + 'L against opponents averaging ' + P.avgOpp + '. That is how a player rated about <b>' + P.perf + '</b> scores. Keep playing like that and your rating should be near <b>' + P.proj + '</b> after ' + ahead + ' more games (likely between ' + P.projLo + ' and ' + P.projHi + ').</p>';
  const acc = S.games.filter(g => g.timeClass === pick.tc && S.reviews[g.id] && S.reviews[g.id].acc[g.color] != null).sort((a, b) => a.end - b.end).map(g => accOf(g, S.reviews[g.id], g.color));
  if (acc.length >= 8) {
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length, late = avg(acc.slice(-5)), early = avg(acc.slice(0, -5)), df = late - early;
    h += '<p class="muted">Move quality: ' + late.toFixed(1) + '% accuracy over your last 5 reviewed games, ' + (Math.abs(df) < 1.5 ? 'about the same as the ' + (acc.length - 5) + ' before.' : df > 0 ? 'up ' + df.toFixed(1) + ' points on the ' + (acc.length - 5) + ' before, which backs the projection.' : 'down ' + (-df).toFixed(1) + ' points on the ' + (acc.length - 5) + ' before, so the projection may be optimistic.') + '</p>';
  }
  const grs = S.games.filter(g => g.timeClass === pick.tc && S.reviews[g.id]).sort((a, b) => b.end - a.end).slice(0, 10).map(g => gameRating(g, S.reviews[g.id], g.color)).filter(Boolean);
  if (grs.length >= 3) h += '<p class="muted">Game ratings: your last ' + grs.length + ' reviewed ' + pick.tc + ' games average ' + Math.round(grs.reduce((s, g) => s + g.rating, 0) / grs.length / 10) * 10 + ', against a rating of ' + cur + '.</p>';
  return h + '<p class="muted">An estimate from results, not a promise. The shaded band is the uncertainty from only having ' + P.games + ' games to go on.</p></div>';
}
function eloHover(e) {
  const plot = $('#eloPlot'), D = eloData;
  if (!plot || !D) return;
  const r = plot.getBoundingClientRect(), i = Math.max(0, Math.min(D.span, Math.round((e.clientX - r.left) / r.width * D.span)));
  const cross = $('#eloCross'); cross.hidden = false; cross.style.left = (i / D.span * 100) + '%';
  if (i < D.n) { const h = D.ser[i]; $('#eloRead').textContent = 'Game ' + (D.skip + i + 1) + ' · ' + new Date(h.end).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + h.r + ' after a ' + h.res + (h.o ? ' against ' + h.o : ''); }
  else $('#eloRead').textContent = 'Projected after ' + (i - D.n + 1) + ' more games: about ' + Math.round(D.P.path[i - D.n + 1]) + ' (' + Math.round(D.P.pathLo[i - D.n + 1]) + ' to ' + Math.round(D.P.pathHi[i - D.n + 1]) + ')';
}

/* ---------- reviewing ---------- */

function engines() {
  if (!bg) { bg = Engine.worker(ENGINE); live = Engine.worker(ENGINE); }
}
async function review(meta, onStep) {
  engines();
  const game = R.readGame(meta.pgn);
  const depth = DEPTHS[S.settings.depth] || 14;
  if (bg.v960 !== !!game.v960) { bg.v960 = !!game.v960; bg.option('UCI_Chess960', String(bg.v960)); }
  const evals = await analyseGame(bg, game, R, { depth, movetime: depth >= 18 ? 6000 : 3000 }, onStep, () => cancelBatch);
  if (!evals) return null;
  const k = ccFit().k, recs = R.classify(game, evals, S.book, k);
  const rv = { depth, k, bv: 2, at: Date.now(), end: meta.end, evals, recs, acc: { w: R.accuracy(recs, game.plies, 'w'), b: R.accuracy(recs, game.plies, 'b') },
    colors: game.plies.map(p => p.color), clocks: game.plies.map(p => p.clock) };
  S.reviews[meta.id] = rv;
  await store.set({ ['rv:' + meta.id]: rv });
  // puzzles from my own errors; keep progress on ones already practised
  if (!meta.train) for (const p of R.makePuzzles(game, recs, evals, meta.color, meta)) {
    p.e = R.expPts(evals[p.ply].lines[0]);
    const old = S.puzzles[p.id];
    S.puzzles[p.id] = old ? Object.assign(p, { box: old.box, due: old.due, seen: old.seen, right: old.right }) : p;
  }
  await savePuzzles();
  endCache.delete(meta.id);
  return rv;
}
async function reviewMany(list, auto) {
  cancelBatch = false;
  for (let i = 0; i < list.length; i++) {
    if (cancelBatch) break;
    const m = list[i];
    S.busy = { text: 'Reviewing game ' + (i + 1) + ' of ' + list.length + ' (vs ' + m.opponent + ')', done: 0, total: 1 };
    renderStatus();
    try { await review(m, (a, b) => { S.busy.done = a; S.busy.total = b; renderStatus(); }); }
    catch (e) { S.error = 'One game could not be reviewed: ' + e.message; }
    softPanel();
  }
  const done = list.filter(m => S.reviews[m.id]);
  if (auto && done.length) S.notice = { id: done[0].id, text: done.length === 1 ? 'New game against ' + done[0].opponent + ' reviewed: ' + accOf(done[0], S.reviews[done[0].id], done[0].color) + '% accuracy.' : done.length + ' new games reviewed.' };
  S.busy = null; renderStatus(); softPanel();
}
async function openGame(meta, ply) {
  S.puzzle = null; S.train = null; S.line = null; S.tab = 'review';
  let game;
  try { game = R.readGame(meta.pgn); } catch (e) { S.error = 'That game could not be read.'; render(); return; }
  S.cur = { meta, game, rv: S.reviews[meta.id] || null };
  S.ply = ply != null ? ply : 0; S.flipped = meta.color === 'b';
  render();
  if (!S.cur.rv) {
    cancelBatch = false;
    S.busy = { text: 'Reviewing this game', done: 0, total: 1 }; renderStatus();
    try {
      const rv = await review(meta, (a, b) => { S.busy.done = a; S.busy.total = b; renderStatus(); });
      if (rv && S.cur && S.cur.meta.id === meta.id) S.cur.rv = rv;
    } catch (e) { S.error = 'The review did not finish: ' + e.message; }
    S.busy = null; render();
  }
}

/* ---------- what the board shows ---------- */

function shown() { // { fen, last, whiteToMove }
  if (S.puzzle && !S.line) return { fen: S.puzzle.fen || S.puzzle.p.fen, last: S.puzzle.last || null };
  if (S.train && !S.line) return { fen: S.train.c.fen(), last: S.train.last };
  if (S.line) { const m = S.line.step ? S.line.moves[S.line.step - 1] : null; return { fen: m ? m.fen : S.line.base, last: m ? [m.from, m.to] : null }; }
  if (!S.cur) return { fen: new Chess().fen(), last: null };
  const p = S.ply ? S.cur.game.plies[S.ply - 1] : null;
  return { fen: p ? p.after : S.cur.game.start, last: p ? [p.from, p.to] : null };
}
const wtm = fen => fen.split(' ')[1] === 'w';
// no engine help while there is still something to find: an unanswered puzzle (also after a wrong try), or a training session
const hideEngine = () => !S.line && ((!!S.puzzle && (S.puzzle.state === 'ask' || S.puzzle.state === 'wrong')) || (!!S.train && !S.train.done));

function storedLines(fen) { // lines the review already has for this position
  if (!S.cur || !S.cur.rv || S.line || S.puzzle || S.train) return [];
  const ev = S.cur.rv.evals[S.ply];
  return ev && !ev.lines[0].over ? ev.lines.filter(l => l.pv) : [];
}
function startLive() {
  const { fen } = shown(), token = ++liveToken;
  S.live = { fen, lines: storedLines(fen), over: R.terminalScore(fen) };
  if (!live) return;
  // Chess960: the engine needs to know, and the game's own positions carry their castling rights in a second FEN
  const g960 = !!(S.cur && S.cur.game.v960 && !S.puzzle && !S.train), plies = g960 ? S.cur.game.plies : null;
  const efen = g960 && !S.line ? (S.ply ? plies[S.ply - 1].eafter : S.cur.game.estart) : fen;
  if (live.v960 !== g960) { live.v960 = g960; live.option('UCI_Chess960', String(g960)); }
  if (S.train && hideEngine()) return; // the trainer is using this engine to check moves
  live.stop();
  if (S.live.over || hideEngine()) return;
  live.analyse(efen, { depth: 20, multipv: 3, movetime: 8000, skip: () => token !== liveToken, onInfo: lines => {
    if (token !== liveToken) return;
    if (lines[0] && (!S.live.lines.length || !S.live.lines[0].depth || lines[0].depth >= Math.min(S.live.lines[0].depth, 10))) { S.live.lines = lines.slice(); paintLive(); }
  } });
}
let paintQueued = false;
function paintLive() { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; renderBar(); renderLines(); renderBoard(); }); }

/* ---------- rendering: board side ---------- */

let board;
function renderBoard() {
  const v = shown(), arrows = [];
  let badge = null;
  if (!S.line && !S.puzzle && !S.train && S.cur && S.ply && S.cur.rv) { const r = S.cur.rv.recs[S.ply - 1]; badge = { sq: S.cur.game.plies[S.ply - 1].to, cls: r.cls, text: R.SYMBOL[r.cls] }; }
  if (S.line && S.line.moves[S.line.step]) { const m = S.line.moves[S.line.step]; arrows.push({ from: m.from, to: m.to, kind: 'line' }); }
  else if (!hideEngine() && S.live.fen === v.fen && S.live.lines[0] && S.live.lines[0].pv) { const u = S.live.lines[0].pv[0]; arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'best' }); }
  if (S.puzzle && S.puzzle.state === 'wrong' && S.puzzle.tried) arrows.push({ from: S.puzzle.tried.slice(0, 2), to: S.puzzle.tried.slice(2, 4), kind: 'bad' });
  const z = S.train;
  if (z && !S.line) { if (z.arrow) arrows.push({ from: z.arrow.from, to: z.arrow.to, kind: 'line' }); if (z.tried && !z.done) arrows.push({ from: z.tried.slice(0, 2), to: z.tried.slice(2, 4), kind: 'bad' }); }
  const movable = S.line ? null : S.puzzle ? (S.puzzle.state === 'ask' || S.puzzle.state === 'wrong' ? S.puzzle.p.color : null) : z ? (myTurn(z) ? z.color : null) : null;
  board.render({ fen: v.fen, flipped: S.flipped, last: v.last, arrows, badge, movable });
}
function renderBar() {
  const v = shown(), bar = $('#bar');
  bar.classList.toggle('off', hideEngine());
  bar.classList.toggle('flip', S.flipped);
  const sc = S.live.over || (S.live.fen === v.fen && S.live.lines[0]) || null;
  if (hideEngine() || !sc) { $('#barFill').style.height = '50%'; $('#barText').textContent = ''; return; }
  $('#barFill').style.height = Math.round(R.whiteShare(sc, wtm(v.fen)) * 100) + '%';
  $('#barText').textContent = R.scoreText(sc, wtm(v.fen)).replace(/^[+-]?(\d+\.\d)\d$/, '$1');
}
function renderWho() {
  const m = S.cur && !S.puzzle && !S.train ? S.cur.meta : null, rv = S.cur && S.cur.rv;
  const gr = c => { const g = rv && m ? gameRating(m, rv, c) : null; return g ? ' · played like ' + g.rating : ''; };
  const row = c => !m ? '' : '<span class="dot ' + c + '"></span><b>' + esc(c === 'w' ? m.white : m.black) + '</b> <span class="muted">' + esc((c === 'w' ? m.wr : m.br) || '') + '</span>' +
    (rv ? '<span class="acc">' + accOf(m, rv, c) + '% accuracy' + gr(c) + '</span>' : '');
  $('#top').innerHTML = row(S.flipped ? 'w' : 'b'); $('#bottom').innerHTML = row(S.flipped ? 'b' : 'w');
}
function renderLines() {
  const el = $('#lines'), v = shown();
  if (el.matches(':hover') && el.dataset.fen === v.fen && !S.line && el.dataset.n === String(S.live.lines.length)) return; // don't shift rows under the pointer
  el.dataset.fen = v.fen; el.dataset.n = String(S.live.lines.length);
  if (S.line) {
    const L = S.line;
    el.innerHTML = '<div class="linehead"><b>' + esc(L.label) + '</b><span class="muted">← → step through · Esc to go back</span><button class="link" data-act="exitLine">Back to ' + (S.puzzle ? 'puzzle' : S.train ? 'trainer' : 'game') + '</button></div>' +
      '<div class="line on"><span class="mvs">' + movesHTML(L.base, L.moves, L.step, 0) + '</span></div>';
    return;
  }
  el.classList.toggle('off', hideEngine() && !S.line);
  if (hideEngine()) { el.innerHTML = '<div class="muted pad">' + (S.train ? 'Engine lines are hidden while you train. Each move gets its verdict in the panel.' : 'Engine lines are hidden until you solve it or press “Show the answer”.') + '</div>'; return; }
  if (S.live.over) { el.innerHTML = '<div class="muted pad">' + (S.live.over.over === 'mate' ? 'Checkmate.' : 'Draw.') + '</div>'; return; }
  const lines = S.live.fen === v.fen ? S.live.lines : [];
  if (!lines.length) { el.innerHTML = '<div class="muted pad">' + (live ? 'Thinking…' : 'Open a game to see the engine’s lines.') + '</div>'; return; }
  el.innerHTML = lines.slice(0, 3).map((l, i) => {
    const mv = R.lineToSan(v.fen, l.pv, 12), t = R.scoreText(l, wtm(v.fen));
    return '<div class="line" data-line="' + i + '" title="Click to step through this line"><span class="ev ' + (/^-|^0-1/.test(t) ? 'neg' : 'pos') + '">' + t + '</span><span class="mvs">' + movesHTML(v.fen, mv, -1, i) + '</span></div>';
  }).join('') + '<div class="muted hint">Click a line, then use ← → to play through it.' + (lines[0].depth ? ' Depth ' + lines[0].depth + '.' : '') + '</div>';
}
function movesHTML(base, moves, step, lineIdx) {
  let n = +base.split(' ')[5], white = wtm(base), h = '';
  moves.forEach((m, j) => {
    if (white || j === 0) h += '<i class="num">' + n + (white ? '.' : '…') + '</i>';
    h += '<button class="lm' + (j + 1 === step ? ' cur' : '') + '" data-line="' + lineIdx + '" data-step="' + (j + 1) + '">' + esc(m.san) + '</button>';
    if (!white) n++;
    white = !white;
  });
  return h;
}

/* ---------- rendering: side panel ---------- */

function renderStatus() {
  const el = $('#status');
  if (S.busy) { el.hidden = false; el.className = 'busy'; el.innerHTML = '<span>' + esc(S.busy.text) + '</span><span class="track"><i style="width:' + Math.round(100 * S.busy.done / Math.max(S.busy.total, 1)) + '%"></i></span><button class="link" data-act="cancel">Stop</button>'; }
  else if (S.error) { el.hidden = false; el.className = 'err'; el.innerHTML = '<span>' + esc(S.error) + '</span><button class="link" data-act="clearError">Dismiss</button>'; }
  else if (S.notice) { el.hidden = false; el.className = 'note'; el.innerHTML = '<span>' + esc(S.notice.text) + '</span><button class="link" data-act="openNotice">Open</button><button class="link" data-act="clearNotice">Dismiss</button>'; }
  else el.hidden = true;
}
const badge = cls => '<b class="badge c-' + cls + '" title="' + R.LABEL[cls] + ': ' + esc(R.MEANING[cls]) + '">' + R.SYMBOL[cls] + '</b>';
const when = t => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

// The kind of game, for the categories on the Games tab.
const gcat = g => (g.bot ? 'bot' : g.computer ? 'computer' : g.v960 ? (g.timeClass === 'daily' ? 'daily960' : 'chess960') : g.timeClass || 'other');
const GCAT = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily', chess960: 'Chess960', daily960: 'Daily 960', bot: 'Vs Stockfish', computer: 'Vs computer', other: 'Other' };
// "600" -> 10 min, "180+2" -> 3|2, "1/86400" -> 1 day
function tcLabel(pgn) {
  const m = /\[TimeControl "([^"]+)"\]/.exec(pgn || '');
  if (!m) return '';
  const d = /^1\/(\d+)$/.exec(m[1]);
  if (d) { const days = Math.round(+d[1] / 86400); return days + ' day' + (days === 1 ? '' : 's'); }
  const t = /^(\d+)(?:\+(\d+))?$/.exec(m[1]);
  if (!t) return '';
  const base = +t[1], mins = base >= 60 ? (base % 60 ? (base / 60).toFixed(1) : base / 60) : null;
  return t[2] && +t[2] ? (mins != null ? mins : base + 's') + '|' + t[2] : mins != null ? mins + ' min' : base + ' sec';
}
function gamesHTML() {
  const cats = {};
  S.games.forEach(g => { const k = gcat(g); cats[k] = (cats[k] || 0) + 1; });
  if (S.gcat && !cats[S.gcat]) S.gcat = '';
  const shown = S.games.filter(g => !S.gcat || gcat(g) === S.gcat), un = shown.filter(g => !S.reviews[g.id]);
  let h = '<div class="card"><div class="row"><label class="grow">chess.com username<input id="user" value="' + esc(S.settings.user) + '" placeholder="your username" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
    '<label>Depth<select id="depth">' + [['quick', 'Quick'], ['standard', 'Standard'], ['deep', 'Deep (slow)']].map(o => '<option value="' + o[0] + '"' + (S.settings.depth === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label></div>' +
    '<div class="row"><button class="btn" data-act="load">Load my games</button>' + (un.length ? '<button class="btn ghost" data-act="batch">Review all' + (S.gcat ? ' ' + GCAT[S.gcat].toLowerCase() : '') + ' (' + un.length + ')</button>' : '') +
    '<button class="btn ghost" data-act="paste">Paste a PGN</button><button class="btn ghost" data-act="addLink">Add a game by link</button></div>' +
    '<div id="linkBox" hidden><div class="row"><label class="grow">chess.com game link<input id="gameLink" placeholder="chess.com/game/live/…" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn" data-act="addLinkGo">Add it</button></div></div>' +
    '<label class="chk"><input type="checkbox" id="autoOn"' + (S.settings.auto !== false ? ' checked' : '') + '> Review new games automatically when they finish</label>' +
    '<div id="pasteBox" hidden><textarea id="pgn" rows="5" placeholder="Paste a game’s PGN or its move list here"></textarea><div class="row"><label>I played<select id="pasteColor"><option value="w">White</option><option value="b">Black</option></select></label><label>Against<select id="pasteKind"><option value="person">A person</option><option value="computer">A computer</option></select></label></div>' +
    '<div id="botFields" hidden><div class="row"><label class="grow">Bot’s name<input id="botName" list="botList" placeholder="e.g. Martin" autocomplete="off"></label><label>Bot’s rating<input id="botElo" inputmode="numeric" placeholder="e.g. 250"></label>' +
    '<label>My rating<input id="myElo" inputmode="numeric" placeholder="' + (myElo() || '') + '"></label><label>Date played<input id="gameDate" type="date" value="' + T.dayKey(Date.now()) + '"></label></div>' + botPickHTML('botName', 'botElo', 'myElo', 'gameDate') + '</div><div class="row"><button class="btn" data-act="pasteGo">Review it</button></div></div></div>';
  const sync = trainHTML() + '<h3>Sync between devices</h3><div class="card" id="syncCard">' + syncHTML() + '</div>';
  if (!S.games.length) return h + '<p class="empty">No games loaded yet. Press “Load my games”.</p>' + sync;
  const keys = Object.keys(GCAT).filter(k => cats[k]);
  if (keys.length > 1) h += '<div class="seg chips gcats"><button data-act="gcat" data-v="" aria-pressed="' + !S.gcat + '">All <span class="muted">' + S.games.length + '</span></button>' + keys.map(k => '<button data-act="gcat" data-v="' + k + '" aria-pressed="' + (S.gcat === k) + '">' + GCAT[k] + ' <span class="muted">' + cats[k] + '</span></button>').join('') + '</div>';
  h += '<div class="games">' + shown.map(g => {
    const rv = S.reviews[g.id];
    return '<button class="game" data-game="' + esc(g.id) + '"><span class="res ' + g.result + '">' + g.result.charAt(0).toUpperCase() + '</span>' +
      '<span class="gmain"><b><span class="dot ' + g.color + '"></span>vs ' + esc(g.opponent || '?') + ' <span class="muted">' + esc((g.color === 'w' ? g.br : g.wr) || '') + '</span>' + ccTag(g.id) + '</b>' +
      '<span class="muted">' + esc((g.v960 ? [GCAT[gcat(g)] + ' ' + tcLabel(g.pgn), when(g.end)] : [g.opening || 'Unknown opening', [g.bot || g.computer ? GCAT[gcat(g)] : g.timeClass, g.bot ? '' : tcLabel(g.pgn)].filter(Boolean).join(' '), when(g.end)]).filter(Boolean).join(' · ')) + '</span></span>' +
      '<span class="gacc">' + (rv ? accOf(g, rv, g.color) + '%' + (gameRating(g, rv, g.color) ? '<i>' + gameRating(g, rv, g.color).rating + '</i>' : '') : '<span class="muted">Review</span>') + '</span></button>';
  }).join('') + '</div>';
  return h + sync;
}

// The level each side played at in this game. Worked out from the stored review, so old reviews get it too.
function rawGameRating(meta, rv, c) { return rv.colors ? R.gameRating(rv.recs, rv.colors, c, c === 'w' ? meta.wr : meta.br) : null; }
/* Matching chess.com. S.calib[id] holds what chess.com's Game Review said about a game, typed or pasted in:
   { w, b: game ratings, aw, ab: accuracy, cw, cb: { class: count }, t }. From these, three things are learned:
   a mapping for accuracy, one for game rating, and how wide the inaccuracy / mistake / blunder bands should be. */
function ccFit() {
  if (S._fit) return S._fit;
  const accP = [], grP = [], cls = [];
  for (const id in S.calib) {
    const o = S.calib[id], g = findGame(id), rv = S.reviews[id];
    if (!g || !rv) continue;
    for (const c of ['w', 'b']) {
      if (o['a' + c] && rv.acc[c] != null) accP.push([rv.acc[c], o['a' + c]]);
      const raw = o[c] ? rawGameRating(g, rv, c) : null;
      if (raw) grP.push([raw.rating, o[c]]);
      if (o['c' + c] && rv.colors) cls.push({ recs: rv.recs, colors: rv.colors, c, want: o['c' + c] });
    }
  }
  let k = 1;
  if (cls.length >= 3) {
    let best = Infinity, kb = 1;
    for (let x = 0.6; x <= 1.801; x += 0.05) {
      let e = 0;
      for (const E of cls) { const ours = R.errCounts(E.recs, E.colors, E.c, x), w = E.want; e += Math.pow(ours.inaccuracy - (w.inaccuracy || 0), 2) + Math.pow(ours.mistake - (w.mistake || 0), 2) + Math.pow(ours.blunder - (w.blunder || 0) - (w.miss || 0), 2); }
      if (e < best - 1e-9) { best = e; kb = x; }
    }
    k = Math.round((1 + (kb - 1) * cls.length / (cls.length + 3)) * 100) / 100; // held back toward the standard bands while there is little to go on
  }
  // how far off the estimates are, each pair judged by a fit learned without it
  const check = P => { if (P.length < 2) return null; let was = 0, now = 0; P.forEach((p, i) => { const f = R.fitLine(P.filter((q, j) => j !== i)); was += Math.abs(p[1] - p[0]); now += Math.abs(p[1] - f(p[0])); }); return { was: was / P.length, now: now / P.length }; };
  const err = { acc: check(accP), gr: check(grP) }, use = (P, e) => (e && e.now > e.was ? x => x : R.fitLine(P)); // a fit that does worse than none is not used
  return S._fit = { acc: use(accP, err.acc), gr: use(grP, err.gr), k, n: { acc: accP.length, gr: grP.length, cls: cls.length }, err };
}
const clampR = (v, lo, hi, step) => +Math.max(lo, Math.min(hi, Math.round(v / step) * step)).toFixed(step < 1 ? 1 : 0);
function ownAcc(rv, c) { return rv.acc[c] == null ? null : clampR(ccFit().acc(rv.acc[c]), 0, 100, 0.1); }
// The accuracy shown for a side: chess.com's own number when you entered it, otherwise ours, tuned toward theirs.
function accOf(meta, rv, c) { const typed = (S.calib[meta.id] || {})['a' + c]; return typed || ownAcc(rv, c); }
function ownRating(meta, rv, c) { const g = rawGameRating(meta, rv, c); if (g) g.rating = clampR(ccFit().gr(g.rating), 100, 3300, 10); return g; }
function gameRating(meta, rv, c) {
  const g = ownRating(meta, rv, c), typed = (S.calib[meta.id] || {})[c];
  if (g && typed) g.rating = typed; // a number you entered is shown as it is
  return g;
}
// Re-rates every stored review with the bands learned from chess.com. A move that turns into a mistake becomes a puzzle.
async function applyBands() {
  const k = ccFit().k, sets = {};
  let added = false;
  for (const g of S.games.concat(liveTrain())) {
    const rv = S.reviews[g.id];
    if (!rv || ((rv.k || 1) === k && rv.bv === 2)) continue;
    let game;
    try { game = R.readGame(g.pgn); } catch (e) { continue; }
    if (rv.bv !== 2) { R.markLoses(game, rv.recs, rv.evals); rv.bv = 2; } // reviews from before the blunder rule: work out which big drops lost something
    R.reband(rv.recs, k); rv.k = k; sets['rv:' + g.id] = rv;
    if (!g.train) for (const p of R.makePuzzles(game, rv.recs, rv.evals, g.color, g)) if (!S.puzzles[p.id]) { p.e = R.expPts(rv.evals[p.ply].lines[0]); S.puzzles[p.id] = p; added = true; }
  }
  if (added) sets.puzzles = S.puzzles;
  if (Object.keys(sets).length) { endCache.clear(); await store.set(sets); }
  return Object.keys(sets).length > 0;
}
function saveCalib(id, o) {
  if (o && Object.keys(o).some(k => k !== 't')) { o.t = Date.now(); S.calib[id] = o; } else delete S.calib[id];
  S._fit = null; store.set({ calib: S.calib }); touchSync();
  applyBands().then(() => render());
}
// A small tag on games whose chess.com review numbers you copied in (Match chess.com).
const ccTag = id => (Object.keys(S.calib[id] || {}).some(k => k !== 't') ? ' <span class="cctag" title="chess.com’s review numbers copied in for this game">chess.com ✓</span>' : '');
function ccHTML() {
  const { meta, rv } = S.cur;
  if (meta.bot || !rv.colors) return '';
  const o = S.calib[meta.id] || {}, F = ccFit(), has = Object.keys(o).some(k => k !== 't');
  const mine = c => { const n = { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 }; rv.recs.forEach((r, i) => { if (rv.colors[i] === c && r.cls in n) n[r.cls]++; }); return n; };
  const cnt = { w: mine('w'), b: mine('b') }, cell = (key, v, ph) => '<td><input class="ccin" data-cc="' + key + '" inputmode="decimal" value="' + esc(v == null ? '' : v) + '" placeholder="' + ph + '"></td>';
  const row = (label, ours, theirs) => '<tr><td>' + label + '</td><td>' + (ours.w == null ? '–' : ours.w) + '</td>' + theirs.w + '<td>' + (ours.b == null ? '–' : ours.b) + '</td>' + theirs.b + '</tr>';
  const gw = ownRating(meta, rv, 'w'), gb = ownRating(meta, rv, 'b');
  let h = '<details class="card sum cc"' + (S.ccOpen ? ' open' : '') + '><summary>Match chess.com <span class="muted">' + (has ? 'numbers entered for this game' : 'add chess.com’s review to sharpen every estimate') + '</span></summary>' +
    '<p class="muted">Review this game on chess.com, copy its summary (accuracy, game rating and the move counts) and paste it here. Or type the numbers in. Every game you add tunes the estimates for all your games.</p>' +
    '<textarea id="ccPaste" rows="3" placeholder="Paste chess.com’s Game Review summary"></textarea>' +
    '<div class="row"><button class="btn small" data-act="ccRead">Read it</button>' + (has ? '<button class="btn small ghost" data-act="ccSwap">Swap White and Black</button><button class="link" data-act="ccClear">Clear</button>' : '') + '</div>' +
    (S.ccMsg ? '<p><b>' + esc(S.ccMsg) + '</b></p>' : '') +
    '<table class="cct"><tr><th></th><th colspan="2">' + esc(meta.white) + '</th><th colspan="2">' + esc(meta.black) + '</th></tr><tr><th></th><th>Ours</th><th>chess.com</th><th>Ours</th><th>chess.com</th></tr>' +
    row('Accuracy', { w: ownAcc(rv, 'w'), b: ownAcc(rv, 'b') }, { w: cell('aw', o.aw, '%'), b: cell('ab', o.ab, '%') }) +
    row('Game rating', { w: gw && gw.rating, b: gb && gb.rating }, { w: cell('w', o.w, ''), b: cell('b', o.b, '') }) +
    [['brilliant', 'Brilliant'], ['great', 'Great'], ['best', 'Best'], ['excellent', 'Excellent'], ['good', 'Good'], ['book', 'Book'], ['inaccuracy', 'Inaccuracies'], ['mistake', 'Mistakes'], ['miss', 'Misses'], ['blunder', 'Blunders']].map(x => row(x[1], { w: cnt.w[x[0]], b: cnt.b[x[0]] }, { w: cell('cw.' + x[0], (o.cw || {})[x[0]], ''), b: cell('cb.' + x[0], (o.cb || {})[x[0]], '') })).join('') + '</table>';
  const games = Object.keys(S.calib).filter(id => S.reviews[id]).length, e = F.err, bits = [];
  const say = (e, name, f, unit) => (e.now > e.was ? name + ' is left as it was (the entries so far do not agree on a direction)' : name + ' is off by about ' + f(e.now) + unit + ' (it was ' + f(e.was) + ')');
  if (e.acc) bits.push(say(e.acc, 'accuracy', v => v.toFixed(1), ' points'));
  if (e.gr) bits.push(say(e.gr, 'game rating', v => Math.round(v), ''));
  let sum = games ? 'Tuned on ' + games + ' game' + (games === 1 ? '' : 's') + '.' : 'Nothing entered yet.';
  if (bits.length) sum += ' Checked against your entries, ' + bits.join(', and ') + '.';
  sum += F.n.cls >= 3 ? (F.k === 1 ? ' Move ratings already match chess.com’s counts.' : ' Move ratings are now ' + (F.k > 1 ? 'more forgiving' : 'stricter') + ' (bands ×' + F.k.toFixed(2) + ') to match chess.com’s counts.') : ' Move ratings start tuning once 3 sides have move counts (' + F.n.cls + ' so far).';
  return h + '<p class="muted">' + sum + '</p></details>';
}
/* Editing a game you pasted in or played here: which side you were, who the opponent was, both ratings and the date.
   The PGN's own header tags are rewritten to match, so the review, game ratings and lists all use the new details. */
function editHTML(meta) {
  if (!meta.pasted || S.editing !== meta.id) return '';
  const w = meta.color === 'w', mine = w ? meta.wr : meta.br, theirs = w ? meta.br : meta.wr, opt = (v, cur, l) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>';
  return '<div class="card edit"><h3 class="big">Game details</h3><div class="row"><label>I played<select id="edColor">' + opt('w', meta.color, 'White') + opt('b', meta.color, 'Black') + '</select></label>' +
    '<label>Against<select id="edKind">' + opt('person', meta.computer || meta.bot ? 'computer' : 'person', 'A person') + opt('computer', meta.computer || meta.bot ? 'computer' : 'person', 'A computer') + '</select></label></div>' +
    '<div class="row"><label class="grow">Opponent’s name<input id="edOpp" list="botList" value="' + esc(meta.opponent || '') + '" autocomplete="off"></label><label>Their rating<input id="edOppElo" inputmode="numeric" value="' + esc(theirs || '') + '"></label></div>' +
    '<div class="row"><label>My rating<input id="edMyElo" inputmode="numeric" value="' + esc(mine || '') + '"></label><label>Date played<input id="edDate" type="date" value="' + T.dayKey(meta.end || Date.now()) + '"></label></div>' +
    '<div id="edPicks"' + (meta.computer || meta.bot ? '' : ' hidden') + '>' + botPickHTML('edOpp', 'edOppElo', 'edMyElo', 'edDate') + '</div>' +
    '<div class="row"><button class="btn" data-act="edSave">Save</button><button class="btn ghost" data-act="edCancel">Cancel</button></div></div>';
}
async function saveEdit() {
  const m = S.cur && S.cur.meta;
  if (!m || !m.pasted) return;
  const color = $('#edColor').value, w = color === 'w', was = m.color, me = S.settings.user.trim() || (was === 'w' ? m.white : m.black) || 'You';
  const opp = ($('#edKind').value === 'computer' ? canonBot($('#edOpp').value.trim()) : $('#edOpp').value.trim()) || 'Opponent', oe = Math.round(+$('#edOppElo').value) || '', mye = Math.round(+$('#edMyElo').value) || '', d = /^(\d{4})-(\d{2})-(\d{2})$/.exec($('#edDate').value);
  const h = { White: w ? me : opp, Black: w ? opp : me, WhiteElo: String(w ? mye : oe), BlackElo: String(w ? oe : mye) };
  if (d) { h.Date = d[1] + '.' + d[2] + '.' + d[3]; h.UTCDate = h.Date; m.end = new Date(+d[1], +d[2] - 1, +d[3], 12).getTime(); }
  m.pgn = setHeaders(m.pgn, h);
  const res = (/\[Result "([^"]+)"\]/.exec(m.pgn) || [])[1];
  m.result = res === '1/2-1/2' ? 'draw' : res === '1-0' || res === '0-1' ? ((res === '1-0') === w ? 'win' : 'loss') : color !== was && m.result !== 'draw' ? (m.result === 'win' ? 'loss' : 'win') : m.result;
  Object.assign(m, { white: h.White, black: h.Black, wr: w ? mye : oe, br: w ? oe : mye, color, opponent: opp, computer: !m.bot && $('#edKind').value === 'computer', edited: Date.now() });
  const sets = { games: S.games };
  try { S.cur.game = R.readGame(m.pgn); } catch (e) { /* the moves did not change */ }
  const rv = S.reviews[m.id];
  if (color !== was && rv) { // the puzzles were made from the other side's mistakes
    for (const id in S.puzzles) if (S.puzzles[id].game === m.id) delete S.puzzles[id];
    for (const p of R.makePuzzles(S.cur.game, rv.recs, rv.evals, color, m)) { p.e = R.expPts(rv.evals[p.ply].lines[0]); S.puzzles[p.id] = p; }
    sets.puzzles = S.puzzles;
  }
  S.games.sort((a, b) => b.end - a.end); S.editing = ''; S._fit = null; endCache.delete(m.id);
  S.flipped = color === 'b';
  await store.set(sets); touchSync(); render();
}
function gameRatingHTML() {
  const { meta, rv } = S.cur, w = gameRating(meta, rv, 'w'), b = gameRating(meta, rv, 'b');
  if (!w && !b) return '';
  const tile = (c, g, name, elo) => '<div><span class="grname"><span class="dot ' + c + '"></span>' + esc(name) + '</span><b>' + (g ? g.rating : '–') + '</b>' +
    '<span>' + (g ? 'game rating' + (+elo > 0 ? ' · rated ' + esc(elo) + (g.rating !== +elo ? ' (' + (g.rating > +elo ? '+' : '−') + Math.abs(g.rating - +elo) + ')' : '') : '') : 'too few moves to tell') + '</span>' +
    '</div>';
  return '<div class="grate" title="An estimate of the level each side played at in this game: the quality of the moves, pulled halfway toward the player’s real rating.">' + tile('w', w, meta.white, meta.wr) + tile('b', b, meta.black, meta.br) + '</div>';
}
function graphHTML() {
  const { game, rv } = S.cur, n = rv.evals.length, W = 300, H = 56;
  const y = i => { const ev = rv.evals[i].lines[0]; return H - R.whiteShare(ev, wtm(i ? game.plies[i - 1].after : game.start)) * H; };
  const x = i => (n > 1 ? i / (n - 1) : 0) * W;
  let d = 'M0 ' + H;
  for (let i = 0; i < n; i++) d += 'L' + x(i).toFixed(1) + ' ' + y(i).toFixed(1);
  d += 'L' + W + ' ' + H + 'Z';
  const dots = rv.recs.map((r, i) => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(r.cls) ? '<circle class="f-' + r.cls + '" cx="' + x(i + 1).toFixed(1) + '" cy="' + y(i + 1).toFixed(1) + '" r="2.4"/>' : '').join('');
  return '<svg class="graph" id="graph" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Evaluation over the game"><rect width="' + W + '" height="' + H + '" class="gb"/><path d="' + d + '" class="gw"/><line x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '" class="gm"/>' +
    dots + '<line class="gc" x1="' + x(S.ply) + '" x2="' + x(S.ply) + '" y1="0" y2="' + H + '"/></svg>';
}
function commentHTML() {
  const { game, rv } = S.cur;
  if (!S.ply) return '<div class="comment"><span class="muted">Starting position. Press → to step through the game.</span></div>';
  const p = game.plies[S.ply - 1], r = rv.recs[S.ply - 1], ev = rv.evals[S.ply - 1], nx = rv.evals[S.ply];
  const bestSan = r.best ? (R.lineToSan(p.before, [r.best])[0] || {}).san : '';
  const canBest = ev.lines[0] && ev.lines[0].pv && r.best !== p.uci, canNext = nx && nx.lines[0] && nx.lines[0].pv && nx.lines[0].pv.length;
  return '<div class="comment c-' + r.cls + '">' + badge(r.cls) + '<div><b>' + esc(p.san) + ' is ' + (/^[aeiou]/.test(r.cls) ? 'an ' : 'a ') + (r.cls === 'book' ? 'book move' : r.cls === 'forced' ? 'forced move' : r.cls === 'best' ? 'best move' : R.LABEL[r.cls].toLowerCase() + (['brilliant', 'great', 'excellent', 'good'].includes(r.cls) ? ' move' : '')) + '</b>' +
    '<p>' + esc(R.explain(r, p, bestSan)) + '</p><div class="row">' +
    (canBest ? '<button class="btn small" data-act="lineBest">Show the best line</button>' : '') +
    (canNext ? '<button class="btn small ghost" data-act="lineNext">' + (r.loss >= 0.05 ? 'Show how it gets punished' : 'Show what comes next') + '</button>' : '') +
    (['book', 'forced'].includes(r.cls) || S.explain === S.cur.meta.id + ':' + S.ply ? '' : '<button class="btn small ghost" data-act="explain">Explain this move</button>') + '</div>' + whyHTML() + '</div></div>';
}
function reviewHTML() {
  if (!S.cur) return '<p class="empty">Pick a game from the Games tab to review it.</p>';
  const { meta, game, rv } = S.cur;
  let h = '<div class="ghead"><b>' + esc(meta.white) + ' vs ' + esc(meta.black) + (meta.train ? ' <span class="cctag train">training game · hidden</span>' : '') + ccTag(meta.id) + (meta.pasted && S.editing !== meta.id ? ' <button class="link" data-act="edOpen">Edit details</button>' : '') + '</b><span class="muted">' + esc([game.headers.Result, meta.opening, meta.timeClass, when(meta.end)].filter(Boolean).join(' · ')) + '</span></div>' + editHTML(meta) + h2hHTML(meta);
  if (!rv) return h + '<p class="empty">Reviewing… the move ratings appear when Stockfish finishes.</p>' + movesList();
  const cw = R.counts(rv.recs, game.plies, 'w'), cb = R.counts(rv.recs, game.plies, 'b');
  h += graphHTML() + clockHTML() + gameRatingHTML() + commentHTML() + ccHTML() +
    '<details class="card sum"' + (S.sumOpen !== false ? ' open' : '') + '><summary>Move ratings <span class="muted">' + accOf(meta, rv, 'w') + '% vs ' + accOf(meta, rv, 'b') + '% accuracy · depth ' + rv.depth + '</span></summary><table><tr><th></th><th>' + esc(meta.white) + '</th><th>' + esc(meta.black) + '</th></tr>' +
    R.CLASSES.filter(k => cw[k] || cb[k] || k !== 'forced').map(k => '<tr><td><div class="cls">' + badge(k) + '<span><b>' + R.LABEL[k] + '</b><span class="muted mean">' + esc(R.MEANING[k]) + '</span></span></div></td><td>' + cw[k] + '</td><td>' + cb[k] + '</td></tr>').join('') + '</table></details>';
  return h + movesList();
}
function movesList() {
  const { game, rv } = S.cur;
  let h = '<div class="moves" id="moves">';
  for (let i = 0; i < game.plies.length; i += 2) {
    h += '<span class="mn">' + (i / 2 + 1) + '</span>';
    for (const j of [i, i + 1]) {
      const p = game.plies[j];
      h += p ? '<button class="mv' + (S.ply === j + 1 ? ' cur' : '') + '" data-ply="' + (j + 1) + '">' + esc(p.san) + (rv && !['best', 'excellent', 'good', 'book'].includes(rv.recs[j].cls) ? badge(rv.recs[j].cls) : rv && rv.recs[j].cls === 'best' ? '' : '') + '</button>' : '<span></span>';
    }
  }
  return h + '</div>';
}

const themeOf = p => p.th || (p.th = R.themeOf(p));
const ownPuzzles = () => Object.values(S.puzzles).filter(p => !p.made);
// What is still to do: every puzzle not yet solved on the first attempt. Your own games first, least-seen first.
function leftPuzzles(theme) {
  return Object.values(S.puzzles).filter(p => !R.mastered(p) && (!theme || themeOf(p) === theme))
    .sort((a, b) => (a.made ? 1 : 0) - (b.made ? 1 : 0) || (a.seen || 0) - (b.seen || 0) || b.loss - a.loss);
}
function bumpAct(field) {
  const k = T.dayKey(Date.now()), o = S.act[k] || (S.act[k] = {});
  o[field] = (o[field] || 0) + 1;
  const old = T.dayKey(Date.now() - 120 * 864e5);
  for (const d in S.act) if (d < old) delete S.act[d];
  store.set({ act: S.act });
}
async function gradeNow(p, correct) {
  if (S.puzzle && S.puzzle.daily) return gradeDaily(p, correct);
  const g = R.gradePuzzle(S.puzzles[p.id] || p, correct, Date.now());
  if (g.made) { const m = S.settings.made || (S.settings.made = { n: 0, right: 0 }); m.n++; if (correct) m.right++; saveSettings(); }
  if (g.made && correct) delete S.puzzles[g.id]; else S.puzzles[g.id] = g; // a made-up puzzle has done its job once solved
  bumpAct('pz');
  await savePuzzles();
}
function puzzlesHTML() {
  const own = ownPuzzles(), left = own.filter(p => !R.mastered(p)), made = S.settings.made || { n: 0, right: 0 };
  const right = own.reduce((a, p) => a + (p.right || 0), 0) + made.right, tries = own.reduce((a, p) => a + (p.seen || 0), 0) + made.n;
  let h = '<div class="stats pzstats"><div><b>' + left.length + '</b><span>left from your games</span></div><div><b>' + (own.length - left.length) + '</b><span>finished</span></div><div><b>' + (tries ? Math.round(100 * right / tries) + '%' : '–') + '</b><span>right first time (' + tries + ' tries)</span></div></div>';
  const z = S.puzzle, tname = S.pzTheme ? R.THEMES[S.pzTheme].toLowerCase() : '';
  if (!z) {
    h += dailyHTML() + '<h3>From your games</h3>' + themeChips();
    if (S.pzMaking) return h + '<div class="card"><h3 class="big">Making a puzzle…</h3><p>' + (tname ? 'You have finished every “' + esc(tname) + '” puzzle from your games' : 'You have finished every puzzle from your games') + ', so Stockfish is playing out new positions to find one. This can take up to a minute.</p><div class="row"><button class="btn ghost" data-act="pzQuit">Stop</button></div></div>';
    const sel = leftPuzzles(S.pzTheme), mine = sel.filter(p => !p.made).length;
    return h + '<div class="card"><p>Each puzzle is a position where you went wrong. Get it right on the first attempt and it is finished for good. Miss it and it keeps coming back until you do. When a type runs out, Blunder Lab makes up new puzzles of that type.</p>' +
      (S.pzMsg ? '<p><b>' + esc(S.pzMsg) + '</b></p>' : '') +
      '<div class="row"><button class="btn" data-act="pzStart">' + (mine ? 'Start (' + mine + ' left' + (tname ? ', ' + esc(tname) : '') + ')' : 'Start made-up puzzles' + (tname ? ' (' + esc(tname) + ')' : '')) + '</button></div></div>';
  }
  const p = z.p, side = p.color === 'w' ? 'White' : 'Black', defend = p.made && (p.tags || []).some(t => t === 'allowedMate' || t.startsWith('hung'));
  h += '<div class="card pz ' + z.state + '"><div class="lbl">' + (z.daily ? 'Daily puzzle · ' + R.THEMES[p.th] + ' · ' + side + ' to move' : p.made ? 'Made-up puzzle · ' + side + ' to move · ' + p.phase : side + ' to move · vs ' + esc(p.opponent || '?') + ' · ' + esc(when(p.date)) + ' · ' + p.phase) + '</div>';
  if (z.state === 'ask') h += (p.made ? '<h3>' + (defend ? 'Find the move that holds' : 'Find the best move') + '</h3><p>' + (defend ? 'Only one move keeps you out of trouble here.' : 'One move is clearly better than the rest.') + '</p>' :
    '<h3>Find a better move</h3><p>Here you played <b>' + esc(p.played) + '</b>, ' + (/^[aeiou]/.test(p.cls) ? 'an ' : 'a ') + p.cls + '. What should you have played?</p>') + '<div class="row"><button class="btn ghost" data-act="pzShow">Show the answer</button></div>';
  else if (z.state === 'wrong') h += '<h3>Not that one</h3><p>' + esc(z.note || '') + ' Try again, or see the answer.</p><div class="row"><button class="btn ghost" data-act="pzShow">Show the answer</button></div>';
  else h += '<h3>' + (z.state === 'right' ? (z.clean ? 'Correct' : 'Got it') : 'The answer') + '</h3><p>' + esc(z.note || '') + '</p><p class="muted">Theme: ' + R.THEMES[themeOf(p)] + ' · ' + (z.daily ? (z.clean ? 'Right first time.' : 'You can retry it from the daily card.') : z.clean ? 'Right first time, so this one is finished.' : 'It comes back until you get it first time.') + '</p>' +
    altsHTML(z) + '<div class="row"><button class="btn" data-act="pzNext">Next puzzle</button>' + (p.made ? '' : '<button class="btn ghost" data-act="pzGame">Open the game here</button>') + '</div>';
  return h + '</div><div class="row"><button class="link" data-act="pzQuit">Stop practising</button></div>';
}

let genE = null, genTok = 0;
/* Plays games, Stockfish against itself with a careless move now and then, and hands every position with one clearly
   best move to onPuzzle(p). Stops when onPuzzle returns true (that puzzle is returned), when time is up, or on stop(). */
async function genLoop(ms, stop, onPuzzle) {
  if (!genE) genE = Engine.worker(ENGINE);
  await loadOpenings();
  const until = Date.now() + ms, go = () => Date.now() < until && !stop();
  while (go()) {
    const c = new Chess();
    if (openList && openList.length) { try { for (const s of openList[Math.floor(Math.random() * openList.length)][1].split(' ').slice(0, 10)) c.move(s); } catch (e) { /* start from wherever it got to */ } }
    for (let n = 0; n < 70 && !c.isGameOver() && go(); n++) {
      const fen = c.fen(), r = await genE.analyse(fen, { depth: 9, multipv: 2, movetime: 350 }), top = r.lines[0];
      if (!top || !top.pv || !top.pv.length) break;
      let p = R.madePuzzle(fen, r.lines);
      if (p && !S.puzzles[p.id] && !S.daily.list.some(x => x.id === p.id)) {
        p = R.madePuzzle(fen, (await genE.analyse(fen, { depth: 14, multipv: 2, movetime: 1500 })).lines); // look again, deeper, before trusting it
        if (p) { p.date = Date.now(); p.th = R.themeOf(p); if (await onPuzzle(p)) return p; }
      }
      const e = R.expPts(top);
      if (top.mate == null && (e > 0.985 || e < 0.015)) break; // decided with no mate in sight: start another game
      const legal = c.moves({ verbose: true }), slip = Math.random() < 0.3 ? legal[Math.floor(Math.random() * legal.length)] : null, u = top.pv[0];
      try { c.move(slip ? { from: slip.from, to: slip.to, promotion: slip.promotion } : { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined }); } catch (err) { break; }
    }
  }
  return null;
}
// spare made-up puzzles of other types are kept for later, within reason
const bankRoom = p => p.th !== 'other' && Object.values(S.puzzles).filter(x => x.made).length < 120;
async function makePuzzle(theme, ms, stop) {
  let banked = false;
  const p = await genLoop(ms, stop, p => {
    const hit = !theme || p.th === theme;
    if (!hit && dailyTake(p)) return false;
    if (hit || bankRoom(p)) { S.puzzles[p.id] = p; banked = true; }
    return hit;
  });
  if (banked) await store.set({ puzzles: S.puzzles });
  return p;
}

/* ---------- daily puzzles: five made-up ones of every type, new each day ---------- */

const DAILY_N = 5;
let dailyRun = false;
const saveDaily = () => { touchSync(); return store.set({ daily: S.daily }); };
function today() { const k = T.dayKey(Date.now()); if (S.daily.day !== k) S.daily = { day: k, t: Date.now(), list: [], res: {} }; return S.daily; }
const dailyNeed = th => today().list.filter(p => p.th === th).length < DAILY_N;
const dailyFull = () => Object.keys(R.THEMES).every(k => !dailyNeed(k));
function dailyTake(p) {
  if (!dailyNeed(p.th)) return false;
  p.dly = true; S.daily.list.push(p); saveDaily();
  if (S.tab === 'puzzles' && !S.puzzle && !S.pzMaking) renderPanel();
  return true;
}
// Fills today's set in the background: first from spare puzzles already made, then by making new ones.
async function fillDaily() {
  if (dailyRun) return;
  dailyRun = true;
  try {
    today();
    let moved = false;
    for (const p of Object.values(S.puzzles)) { if (!p.made || p.seen) continue; p.th = themeOf(p); if (dailyNeed(p.th)) { delete S.puzzles[p.id]; dailyTake(p); moved = true; } }
    if (moved) await store.set({ puzzles: S.puzzles });
    let banked = false;
    if (!dailyFull()) await genLoop(15 * 60000, () => dailyFull() || document.hidden, p => { if (!dailyTake(p) && bankRoom(p)) { S.puzzles[p.id] = p; banked = true; } return false; });
    if (banked) await store.set({ puzzles: S.puzzles });
  } catch (e) { /* try again next time the app is opened */ }
  dailyRun = false;
  if (S.tab === 'puzzles' && !S.puzzle && !S.pzMaking) renderPanel();
}
async function gradeDaily(p, correct) {
  const d = today(), was = d.res[p.id];
  d.res[p.id] = correct ? (was === 'miss' ? 'fixed' : 'ok') : 'miss';
  if (!was) { const m = S.settings.made || (S.settings.made = { n: 0, right: 0 }); m.n++; if (correct) m.right++; saveSettings(); bumpAct('pz'); }
  if (dailyFull() && d.list.every(x => d.res[x.id])) { const o = S.act[d.day] || (S.act[d.day] = {}); o.daily = 1; store.set({ act: S.act }); }
  await saveDaily();
}
function dailyNext(theme, retry) {
  const d = today(), cur = S.puzzle && S.puzzle.p.id;
  const p = d.list.find(x => x.id !== cur && (!theme || x.th === theme) && (retry ? d.res[x.id] === 'miss' : !d.res[x.id]));
  if (!p) { S.puzzle = null; S.line = null; if (S.cur) S.flipped = S.cur.meta.color === 'b'; render(); return; }
  startPuzzle(p);
  Object.assign(S.puzzle, { daily: true, dTheme: theme, retry: !!retry });
  renderPanel();
}
function dailyHTML() {
  const d = today(), keys = Object.keys(R.THEMES), total = keys.length * DAILY_N, tried = d.list.filter(p => d.res[p.id]).length, todo = d.list.length - tried;
  const ok = d.list.filter(p => d.res[p.id] === 'ok').length, miss = d.list.filter(p => d.res[p.id] === 'miss').length, run = T.streak(S.act, 'daily', 1, Date.now());
  return '<h3>Daily puzzles</h3><div class="card"><p>Five new made-up puzzles of every type, every day.' + (d.list.length < total ? ' ' + d.list.length + ' of ' + total + ' are ready' + (dailyRun ? '; the rest are being made while Blunder Lab is open.' : '.') : '') + '</p><div class="dgrid">' +
    keys.map(k => { const ready = d.list.filter(p => p.th === k), dn = ready.filter(p => d.res[p.id]).length; return '<button data-act="dailyStart" data-v="' + k + '"' + (ready.length > dn ? '' : ' disabled') + '><span>' + R.THEMES[k] + '</span><b>' + (dn >= DAILY_N ? '✓' : dn + '/' + DAILY_N) + '</b></button>'; }).join('') + '</div>' +
    '<div class="row"><button class="btn" data-act="dailyStart" data-v=""' + (todo ? '' : ' disabled') + '>' + (todo ? 'Start today’s puzzles (' + todo + ' to go)' : tried >= total ? 'All done for today' : 'Waiting for more puzzles') + '</button>' +
    (miss ? '<button class="btn ghost" data-act="dailyRetry">Retry the ' + miss + ' I missed</button>' : '') + '</div>' +
    (tried || run ? '<p class="muted">' + (tried ? 'Today: ' + ok + ' right first time of ' + tried + ' tried' : '') + (tried && run ? ' · ' : '') + (run ? run + '-day streak of full sets' : '') + '</p>' : '') + '</div>';
}
function stopMaking() { genTok++; if (S.pzMaking && genE) genE.stop(); S.pzMaking = null; }
async function nextPuzzle() {
  const cur = S.puzzle && S.puzzle.p.id, theme = S.pzTheme, next = leftPuzzles(theme).find(p => p.id !== cur);
  S.pzMsg = '';
  if (next) return startPuzzle(next);
  const tok = ++genTok;
  S.puzzle = null; S.line = null; S.pzMaking = { theme }; if (S.cur) S.flipped = S.cur.meta.color === 'b'; render();
  let p = null;
  try { p = await makePuzzle(theme, 75000, () => tok !== genTok); } catch (e) { /* reported below */ }
  if (tok !== genTok) return;
  S.pzMaking = null;
  if (p) startPuzzle(p);
  else { S.pzMsg = 'No ' + (theme ? '“' + R.THEMES[theme].toLowerCase() + '” ' : '') + 'puzzle turned up this time. Press Start to try again, or pick another type.'; render(); }
}

function insightsHTML() {
  if (!S.games.length) return '<p class="empty">Load your games first.</p>';
  const I = R.insights(S.games, S.reviews), pct = (a, n) => (n ? Math.round(100 * a / n) : 0);
  const accs = S.games.filter(g => S.reviews[g.id]).map(g => accOf(g, S.reviews[g.id], g.color)).filter(x => x != null);
  if (accs.length) I.accuracy = Math.round(accs.reduce((a, b) => a + b, 0) / accs.length * 10) / 10;
  const wld = o => '<span class="wld"><i class="w" style="flex:' + o.win + '"></i><i class="d" style="flex:' + o.draw + '"></i><i class="l" style="flex:' + o.loss + '"></i></span><span class="muted">' + o.win + 'W ' + o.draw + 'D ' + o.loss + 'L</span>';
  let h = '<div class="stats"><div><b>' + I.total.n + '</b><span>games loaded</span></div><div><b>' + pct(I.total.win, I.total.n) + '%</b><span>won</span></div><div><b>' + (I.accuracy != null ? I.accuracy + '%' : '–') + '</b><span>accuracy (' + I.reviewed + ' reviewed)</span></div></div>';
  h += weeklyHTML() + eloHTML() + goalsHTML();
  if (!I.reviewed) h += '<div class="card"><p>Review a few games to unlock advice. The more games reviewed, the better the advice.</p><button class="btn" data-act="batch">Review all</button></div>';
  else {
    h += '<h3>What to work on</h3>' + (I.tips.length ? I.tips.map((t, i) => '<div class="card tip"><b>' + (i + 1) + '. ' + esc(t.title) + '</b><p>' + esc(t.text) + '</p></div>').join('') : '<div class="card"><p>No clear pattern yet. Review more games.</p></div>') +
      (I.reviewed < 5 ? '<p class="muted">Based on only ' + I.reviewed + ' reviewed game' + (I.reviewed === 1 ? '' : 's') + '; treat it as a first hint.</p>' : '') +
      '<h3>Your moves</h3><div class="card">' + ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'].map(k => '<div class="meter">' + badge(k) + '<span>' + R.LABEL[k] + '</span><span class="track"><i class="f-' + k + '" style="width:' + pct(I.classes[k], I.moves) + '%"></i></span><span class="v">' + I.classes[k] + '</span></div>').join('') + '</div>' +
      '<h3>Where the errors happen</h3><div class="card"><table><tr><th>Phase</th><th>Moves</th><th>Big errors</th><th>Per 10 moves</th></tr>' + ['opening', 'middlegame', 'endgame'].map(k => { const p = I.phases[k]; return '<tr><td>' + k.charAt(0).toUpperCase() + k.slice(1) + '</td><td>' + p.moves + '</td><td>' + p.bad + '</td><td>' + (p.moves ? (10 * p.bad / p.moves).toFixed(1) : '–') + '</td></tr>'; }).join('') + '</table>' +
      '<p class="muted">Pieces left hanging: ' + I.tags.hung + ' · free captures passed up: ' + I.tags.missedCapture + ' · mates allowed: ' + I.tags.allowedMate + ' · mates missed: ' + I.tags.missedMate + '</p></div>';
  }
  h += themesHTML() + clockStatsHTML() + openReportHTML();
  h += rivalsHTML();
  h += '<h3>Results</h3><div class="card"><div class="orow"><span>As White</span>' + wld(I.byColor.w) + '</div><div class="orow"><span>As Black</span>' + wld(I.byColor.b) + '</div></div>';
  if (I.openings.length) h += '<h3>Your openings</h3><div class="card">' + I.openings.map(o => '<div class="orow"><span>' + esc(o.name) + '</span>' + wld(o) + '</div>').join('') + '</div>';
  return h;
}

function renderPanel() {
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', String(b.dataset.tab === S.tab)));
  document.body.dataset.view = (S.tab === 'review' && S.cur) || S.puzzle || S.train || S.line ? 'board' : 'list'; // small screens hide the board on list pages
  const p = $('#panel'), keep = p.scrollTop;
  p.innerHTML = S.tab === 'games' ? gamesHTML() : S.tab === 'review' ? reviewHTML() : S.tab === 'puzzles' ? puzzlesHTML() : S.tab === 'trainer' ? trainerHTML() : insightsHTML();
  p.scrollTop = keep;
  const cur = p.querySelector('.mv.cur');
  if (cur) { // keep the current move in view by scrolling the panel only, never the page
    const a = cur.getBoundingClientRect(), b = p.getBoundingClientRect();
    if (a.top < b.top) p.scrollTop -= b.top - a.top + 8; else if (a.bottom > b.bottom) p.scrollTop += a.bottom - b.bottom + 8;
  }
}
function render() { renderStatus(); renderWho(); renderPanel(); startLive(); renderBoard(); renderBar(); renderLines(); }
function moved() { // the position changed, the panel's structure did not
  if (S.tab === 'review' && S.cur) renderPanel();
  startLive(); renderBoard(); renderBar(); renderLines();
}

/* ---------- trainer: sessions on the board ---------- */

let sparE = null, openList = null, openMap = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nameAt = fen => S.book.names[R.bookKey(fen)] || '';
const inBook = fen => { const k = R.bookKey(fen); return !!S.book.names[k] || S.book.set.has(k); };
function myElo() { for (let i = S.hist.length - 1; i >= 0; i--) if (S.hist[i].rated && S.hist[i].r) return S.hist[i].r; return 1200; }
async function loadOpenings() {
  if (openList) return;
  try { openList = await (await fetch('data/openings.json')).json(); } catch (e) { openList = []; }
  openMap = new Map(openList);
}
function pushMove(z, mv) { // mv: SAN or { from, to, promotion }
  const m = z.c.move(mv);
  z.sans.push(m.san); z.last = [m.from, m.to];
  z.node = (z.node && z.node.kids[m.san]) || null;
  const n = nameAt(m.after); if (n) z.opening = n;
  return m;
}
function newSession(mode, color) {
  engines(); if (live) live.stop();
  S.puzzle = null; S.line = null; S.tab = 'trainer'; S.flipped = color === 'b';
  return S.train = { mode, color, c: new Chess(), sans: [], last: null, node: null, opening: '', msg: '', opp: '', fb: null, arrow: null, tried: null, busy: false, done: false };
}
const myTurn = z => !z.done && !z.busy && z.c.turn() === z.color;
const quick = fen => live.analyse(fen, { depth: 12, multipv: 1, movetime: 1200 });
function endTrain(z) {
  z.done = true; z.busy = false; z.arrow = null;
  const mate = z.c.isCheckmate(), won = !z.resigned && mate && z.c.turn() !== z.color, lost = !!z.resigned || (mate && !won);
  z.msg = z.resigned ? 'You resigned.' : won ? 'Checkmate. You won.' : lost ? 'Checkmate. You lost this one.' : 'Draw.';
  const e = z.opt && z.opt.end;
  if (e) {
    const ok = e.goal === 'win' ? won : !lost, p = S.endProg[e.id] || { n: 0, ok: 0 };
    p.n++; if (ok) p.ok++; S.endProg[e.id] = p; store.set({ endProg: S.endProg }); touchSync();
    z.msg += ok ? (e.goal === 'win' ? ' You converted it.' : ' You held it.') : (e.goal === 'win' ? ' This was a winning position: try it again.' : ' This could be held: try it again.');
    z.fb = { cls: ok ? 'best' : 'miss', text: ok ? 'Goal reached.' : 'Goal missed.' };
  }
  if (z.opt && z.opt.bot) { finishBot(z, won, lost); z.opp = z.botMeta ? (z.sans.length >= 10 ? 'The game is saved and being reviewed.' : 'The game is saved on the Games tab.') : ''; }
  render();
}

/* Playing an opponent on the board. By default the replies are drawn from your own games, as often as they really
   came up. opt: { tree, who } to face one scouted player's own moves; { fen, end, strong } to play out an endgame
   against full-strength Stockfish. */
function startSpar(color, sans, opt) {
  const z = newSession('spar', color);
  z.opt = opt = opt || {};
  if (opt.fen) { z.c = new Chess(opt.fen); const p = opt.fen.split(' '); z.from = (+p[5] - 1) * 2 + (p[1] === 'b' ? 1 : 0); }
  z.tree = z.node = opt.fen || opt.bot ? null : opt.tree || T.buildTree(S.hist, color, S.tr.tc);
  try { for (const s of sans || []) pushMove(z, s); } catch (e) { /* a move that no longer fits: start from where it stopped */ }
  z.msg = opt.end || opt.bot ? 'Your move.' : z.sans.length ? 'Your move. Play on from here.' : 'Your move. Play your opening.';
  z.opp = opt.bot ? 'Stockfish is set to about ' + opt.bot.elo + '. No hints and no take-backs. The game is reviewed when it ends.' : opt.end ? (opt.end.goal === 'win' ? 'You were winning here (' + opt.end.score + '). Convert it against Stockfish at full strength.' : 'This was level (' + opt.end.score + '). Hold the draw, or better, against Stockfish at full strength.') :
    opt.who ? 'The replies are ' + opt.who + '’s own moves, as often as they played them.' : 'The replies come from your real opponents, as often as they played them.';
  render();
  if (z.c.turn() !== color) oppMove(z); else if (!opt.bot) z.pre = { fen: z.c.fen(), p: quick(z.c.fen()) };
}
async function oppMove(z) {
  if (z.c.isGameOver()) return endTrain(z);
  z.busy = true; z.msg = 'Your opponent is thinking…'; render();
  const ks = z.node ? T.kids(z.node) : [], who = z.opt.who;
  let mv, note;
  if (ks.length) {
    const tot = ks.reduce((a, k) => a + k.n, 0), k = T.sample(z.node, Math.random()), others = ks.filter(o => o.san !== k.san).slice(0, 3);
    mv = k.san;
    note = (who ? who + ' played ' : 'Your opponents played ') + k.san + ' here in ' + k.n + ' of ' + tot + ' game' + (tot === 1 ? '' : 's') + ' (' + Math.round(100 * k.n / tot) + '%).' +
      (others.length ? ' Also seen: ' + others.map(o => o.san + ' ' + Math.round(100 * o.n / tot) + '%').join(', ') + '.' : '');
    await sleep(500);
  } else {
    const first = !z.engine; z.engine = true;
    let r;
    if (z.opt.strong) r = await live.analyse(z.c.fen(), { depth: 14, multipv: 1, movetime: 900 });
    else {
      const elo = z.opt.bot ? z.opt.bot.elo : myElo();
      // far below Stockfish's weakest setting, an occasional careless move stands in for the errors a player of that rating makes
      const loose = z.opt.bot && elo < 1100 && Math.random() < Math.min(0.2, (1100 - elo) / 3000) ? z.c.moves({ verbose: true }) : [];
      if (loose.length) { const m = loose[Math.floor(Math.random() * loose.length)]; r = { best: m.from + m.to + (m.promotion || '') }; await sleep(500); }
      else r = await weakEngine(elo).analyse(z.c.fen(), { depth: elo >= 1320 ? 12 : Math.max(1, Math.min(6, Math.round((elo - 300) / 170))), movetime: 800 });
    }
    if (!r.best || r.best === '(none)') return endTrain(z);
    mv = { from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best.slice(4, 5) || undefined };
    note = z.opt.strong || z.opt.bot ? '@' : first ? (who ? 'No game of ' + who + '’s reaches this position' : 'None of your games reach this position') + ', so Stockfish plays from here, turned down to roughly your level.' : '@';
  }
  if (S.train !== z) return;
  let m;
  try { m = pushMove(z, mv); } catch (e) { return endTrain(z); }
  z.opp = note === '@' ? 'Stockfish replies ' + m.san + '.' : note;
  if (z.c.isGameOver()) return endTrain(z);
  z.busy = false; z.msg = 'Your move.';
  if (!z.opt.bot) z.pre = { fen: z.c.fen(), p: quick(z.c.fen()) };
  render();
}
async function sparMove(z, from, to, promo) {
  const before = z.c.fen(), nodeBefore = z.node, wasBook = inBook(before);
  let m;
  try { m = pushMove(z, { from, to, promotion: promo }); } catch (e) { renderBoard(); return; }
  if (z.opt.bot) { z.fb = null; z.opp = ''; return oppMove(z); } // a real game: no verdict on each move
  z.busy = true; z.fb = null; z.opp = ''; z.msg = 'Checking your move…'; render();
  const bits = [];
  let cls = 'good';
  try {
    const over = R.terminalScore(m.after);
    const a = z.pre && z.pre.fen === before ? await z.pre.p : await quick(before);
    const b = over ? { lines: [over] } : await quick(m.after);
    if (S.train !== z) return;
    const best = a.lines[0], bu = best && best.pv && best.pv[0], uci = m.from + m.to + (m.promotion || '');
    const loss = !best || bu === uci ? 0 : Math.max(0, R.expPts(best) - (1 - R.expPts(b.lines[0])));
    const bs = bu && bu !== uci ? (R.lineToSan(before, [bu])[0] || {}).san : '';
    cls = loss < 0.02 ? 'best' : loss < 0.05 ? 'good' : loss < 0.1 ? 'inaccuracy' : loss < 0.2 ? 'mistake' : 'blunder';
    bits.push(cls === 'best' ? (bs ? m.san + ' is as good as Stockfish’s first choice, ' + bs + '.' : m.san + ' is Stockfish’s first choice too.') :
      cls === 'good' ? m.san + ' is fine.' + (bs ? ' Stockfish slightly prefers ' + bs + '.' : '') :
      m.san + ' is ' + (cls === 'inaccuracy' ? 'an inaccuracy' : 'a ' + cls) + ': it gives up about ' + Math.round(loss * 100) + '% of your winning chances.' + (bs ? ' Stockfish plays ' + bs + '.' : ''));
  } catch (e) { bits.push('You played ' + m.san + '.'); }
  if (z.opt.who && nodeBefore && nodeBefore.n >= 2) {
    const k = nodeBefore.kids[m.san];
    bits.push(k ? z.opt.who + ' has faced it in ' + k.n + ' of ' + nodeBefore.n + ' games here and scored ' + T.score(k) + '%.' : z.opt.who + ' has not faced this move here before.');
  } else if (nodeBefore && nodeBefore.n >= 2) {
    const mine = nodeBefore.kids[m.san], usual = T.kids(nodeBefore)[0];
    if (mine) bits.push('You have played it in ' + mine.n + ' of your ' + nodeBefore.n + ' games from this position, scoring ' + T.score(mine.node || mine) + '%.');
    else if (usual) bits.push('It is new for you: you usually play ' + usual.san + ' here (' + usual.n + ' of ' + nodeBefore.n + ' games).');
  }
  if (wasBook && !inBook(m.after)) bits.push('This leaves known opening theory.');
  z.fb = { cls, text: bits.join(' ') };
  oppMove(z);
}

/* Opening lessons: learn = follow the arrow; test = play the line from memory. */
function startCourse(mode) {
  const k = S.tr.course, z = newSession(mode, k.side);
  z.name = k.name; z.line = k.line; z.i = 0; z.mine = 0; z.hits = 0;
  render(); courseStep(z);
}
async function courseStep(z) {
  while (z.i < z.line.length && z.c.turn() !== z.color) {
    z.busy = true; await sleep(z.i ? 550 : 250);
    if (S.train !== z) return;
    const m = pushMove(z, z.line[z.i++]);
    z.opp = (z.color === 'w' ? 'Black' : 'White') + ' plays ' + m.san + '. ' + T.explainMove(m);
    render();
  }
  z.busy = false;
  if (z.i >= z.line.length) {
    z.done = true; z.arrow = null;
    z.msg = 'Line complete.' + (z.mode === 'test' ? ' ' + z.hits + ' of ' + z.mine + ' moves right first time.' : ' Now try it from memory.');
    if (z.mode === 'test') { const p = S.opProg[z.name] || { n: 0, clean: 0 }; p.n++; if (z.hits === z.mine) p.clean++; p.last = Date.now(); S.opProg[z.name] = p; store.set({ opProg: S.opProg }); touchSync(); }
    render(); return;
  }
  const w = z.want = new Chess(z.c.fen()).move(z.line[z.i]);
  z.first = true; z.mine++;
  if (z.mode === 'learn') { z.arrow = { from: w.from, to: w.to }; z.msg = 'Play ' + T.movesText([w.san], z.sans.length) + '. ' + T.explainMove(w); }
  else { z.arrow = null; z.msg = 'Your move. What comes next in this line?'; }
  render();
}
function courseMove(z, from, to, promo) {
  const w = z.want;
  if (w && w.from === from && w.to === to) {
    if (z.first) z.hits++;
    pushMove(z, z.line[z.i++]); z.arrow = null; z.tried = null;
    z.fb = { cls: 'best', text: w.san + ' is right.' + (z.mode === 'test' ? ' ' + T.explainMove(w) : '') };
    z.opp = ''; z.busy = true; render();
    return courseStep(z);
  }
  let m;
  try { m = new Chess(z.c.fen()).move({ from, to, promotion: promo }); } catch (e) { renderBoard(); return; }
  z.first = false; z.tried = from + to;
  const nm = nameAt(m.after);
  z.fb = { cls: 'miss', text: z.mode === 'learn' ? m.san + ' is not the move here. Follow the arrow.' :
    m.san + (nm ? ' is a real opening move (' + nm + '), but it is not this line.' : ' is not the move in this line.') + ' Try again.' };
  render();
}
function trainMove(from, to) {
  const z = S.train;
  if (!z || !myTurn(z)) { renderBoard(); return; }
  const p = z.c.get(from), promo = p && p.type === 'p' && /[18]$/.test(to) ? 'q' : undefined;
  if (z.mode === 'spar') sparMove(z, from, to, promo); else courseMove(z, from, to, promo);
}
function openCourse(name, line, side) {
  const sans = line.split(' ');
  S.tr.sub = 'open';
  S.tr.course = { name, line: sans, side: side || (sans.length % 2 ? 'w' : 'b'), idea: ideaFor(name) };
  S.train = null; render();
}

/* ---------- trainer: side panel ---------- */

const wldBar = o => '<span class="wld"><i class="w" style="flex:' + o.w + '"></i><i class="d" style="flex:' + o.d + '"></i><i class="l" style="flex:' + o.l + '"></i></span>';
function lineName(sans) { const c = new Chess(); let nm = ''; try { for (const s of sans) { const m = c.move(s); nm = nameAt(m.after) || nm; } } catch (e) { /* keep what we have */ } return nm; }
function lineRow(l, o) { // o: { act, side, they } for a scouted player's lines
  o = o || {};
  return '<div class="lrow"><div class="lmain"><b>' + esc(lineName(l.sans) || 'Unnamed line') + '</b><span class="muted">' + esc(T.movesText(l.sans)) + '</span>' +
    '<span class="lstat">' + wldBar(l) + '<span class="muted">' + l.n + ' games · ' + (o.they ? 'they score ' : 'you score ') + T.score(l) + '%</span></span></div>' +
    '<button class="btn small ghost" data-act="' + (o.act || 'trFrom') + '"' + (o.side ? ' data-side="' + o.side + '"' : '') + ' data-line="' + esc(l.sans.join(' ')) + '">Play it</button></div>';
}
function trainSessionHTML() {
  if (S.train.mode === 'drill') return drillHTML();
  const z = S.train, side = z.color === 'w' ? 'White' : 'Black', spar = z.mode === 'spar';
  const tone = !z.fb ? '' : ['best', 'good'].includes(z.fb.cls) ? 'right' : z.fb.cls === 'inaccuracy' ? 'shown' : 'wrong';
  let h = '<div class="card pz ' + tone + '"><div class="lbl">' + (spar ? (z.opt.bot ? 'Game against Stockfish ' + z.opt.bot.elo : z.opt.end ? 'Endgame practice' : z.opt.who ? 'Playing ' + esc(z.opt.who) : 'Playing your opponents') : z.mode === 'learn' ? 'Learning the line' : 'Testing the line') + ' · you are ' + side + '</div>' +
    '<h3>' + esc(spar ? (z.opt.end ? (z.opt.end.goal === 'win' ? 'Win this position' : 'Hold this position') : z.opening || 'Starting position') : z.name) + '</h3>' + (!spar && z.opening ? '<p class="muted">You are now in: ' + esc(z.opening) + '</p>' : '') +
    '<p class="trmoves">' + (z.sans.length ? esc(T.movesText(z.sans, z.from || 0)) : '<span class="muted">No moves yet.</span>') + '</p>' +
    (z.fb ? '<p class="fb">' + badge(z.fb.cls) + '<span>' + esc(z.fb.text) + '</span></p>' : '') + (z.opp ? '<p>' + esc(z.opp) + '</p>' : '') + '<p><b>' + esc(z.msg) + '</b></p><div class="row">';
  if (spar && z.opt.bot) h += z.done ? (z.botMeta ? '<button class="btn" data-act="botReview">See the review</button>' : '') + '<button class="btn ghost" data-act="trAgain">Play again</button>' : '<button class="btn ghost" data-act="botResign"' + (z.sans.length && !z.busy ? '' : ' disabled') + '>Resign</button>';
  else if (spar) h += (z.sans.length ? '<button class="btn ghost" data-act="trUndo"' + (z.busy ? ' disabled' : '') + '>Take back</button>' : '') + '<button class="btn ghost" data-act="trAgain">Start again</button>';
  else if (z.done) h += '<button class="btn" data-act="' + (z.mode === 'learn' ? 'trTest' : 'trTest') + '">' + (z.mode === 'learn' ? 'Test me' : 'Test again') + '</button><button class="btn ghost" data-act="trLearn">Show me again</button><button class="btn ghost" data-act="trPlayOn">Play on against my opponents</button>';
  else h += (z.mode === 'test' && !z.arrow ? '<button class="btn ghost" data-act="trShow"' + (myTurn(z) ? '' : ' disabled') + '>Show the move</button>' : '') + '<button class="btn ghost" data-act="' + (z.mode === 'learn' ? 'trLearn' : 'trTest') + '">Start again</button>';
  h += '</div></div>';
  if (spar && z.node && !z.done) {
    const ks = T.kids(z.node), mine = z.c.turn() === z.color;
    if (ks.length) h += '<details class="card sum"><summary>' + (z.opt.who ? (mine ? 'What ' + esc(z.opt.who) + '’s opponents play here' : 'What ' + esc(z.opt.who) + ' plays here') : mine ? 'What you have played here' : 'What opponents play here') + ' <span class="muted">' + z.node.n + ' games reached this position</span></summary><table><tr><th>Move</th><th>Games</th><th>' + (z.opt.who ? 'Their score' : 'Your score') + '</th></tr>' +
      ks.slice(0, 8).map(k => '<tr><td>' + esc(k.san) + '</td><td>' + k.n + '</td><td>' + T.score(k.node) + '%</td></tr>').join('') + '</table></details>';
  }
  return h + '<div class="row"><button class="link" data-act="trStop">' + (spar ? 'Stop playing' : 'Back') + '</button></div>';
}
function courseHTML() {
  const k = S.tr.course, p = S.opProg[k.name];
  const pre = k.name + ':', more = (openList || []).filter(o => o[0].startsWith(pre) || o[0].startsWith(k.name + ',')).slice(0, 40);
  return '<div class="row"><button class="link" data-act="trHome">← All openings</button></div>' +
    '<div class="card"><div class="lbl">You play ' + (k.side === 'w' ? 'White' : 'Black') + ' · ' + Math.ceil(k.line.length / 2) + ' moves</div><h3 class="big">' + esc(k.name) + '</h3><p class="trmoves">' + esc(T.movesText(k.line)) + '</p>' +
    (k.idea ? '<p>' + esc(k.idea) + '</p>' : '') +
    '<div class="row"><button class="btn" data-act="trLearn">Learn it</button><button class="btn ghost" data-act="trTest">Test me</button><button class="btn ghost" data-act="trPlayOn">Play it against my opponents</button><button class="btn ghost" data-act="trSide">Switch to ' + (k.side === 'w' ? 'Black' : 'White') + '</button>' +
    '<button class="btn ghost" data-act="trRep">' + (inRep(k) ? '✓ In my repertoire (remove)' : 'Add to my repertoire') + '</button></div>' +
    (p ? '<p class="muted">Tested ' + p.n + ' time' + (p.n === 1 ? '' : 's') + ', ' + p.clean + ' without a slip.</p>' : '') + '</div>' +
    (more.length ? '<h3>Variations to learn next</h3><div class="card olist">' + more.map(o => openRow(o[0], o[0].slice(k.name.length).replace(/^[:,]\s*/, ''))).join('') + '</div>' : '');
}
const openRow = (name, label, extra) => '<button class="orow2" data-open="' + esc(name) + '"><span>' + (S.opProg[name] && S.opProg[name].clean ? '<i class="tick">✓</i>' : '') + esc(label || name) + '</span>' + (extra || '') + '</button>';
function trainerHTML() {
  if (S.train) return trainSessionHTML();
  const t = S.tr;
  let h = '<div class="seg">' + [['opp', 'My opponents'], ['bot', 'Play a game'], ['scout', 'Scout'], ['open', 'Openings'], ['rep', 'Repertoire'], ['end', 'Endgames'], ['drill', 'Blunder check']].map(x => '<button data-act="trSub" data-v="' + x[0] + '" aria-pressed="' + (t.sub === x[0]) + '">' + x[1] + '</button>').join('') + '</div>';
  if (t.sub === 'bot') return h + botHTML();
  if (t.sub === 'drill') return h + drillIntroHTML();
  if (t.sub === 'scout') return h + scoutHTML();
  if (t.sub === 'rep') return h + repHTML();
  if (t.sub === 'end') return h + endHTML();
  if (t.sub === 'opp') {
    if (!S.hist.length) return h + '<p class="empty">Load your games first. The trainer learns how your opponents play from them.</p>';
    const tcs = [...new Set(S.hist.map(x => x.tc))].filter(Boolean), tree = T.buildTree(S.hist, t.color, t.tc), lines = T.commonLines(tree, 30);
    h += '<div class="card"><div class="row"><label>I play<select id="trColor"><option value="w"' + (t.color === 'w' ? ' selected' : '') + '>White</option><option value="b"' + (t.color === 'b' ? ' selected' : '') + '>Black</option></select></label>' +
      '<label>Games<select id="trTc"><option value="">All</option>' + tcs.map(c => '<option value="' + esc(c) + '"' + (t.tc === c ? ' selected' : '') + '>' + esc(c.charAt(0).toUpperCase() + c.slice(1)) + '</option>').join('') + '</select></label></div>' +
      '<p>Built from ' + tree.n + ' of your games as ' + (t.color === 'w' ? 'White' : 'Black') + '. You play your moves; the replies are the ones your real opponents chose, as often as they chose them. After each move you see how it compares with Stockfish and with what you usually play. When your games run out, Stockfish takes over at about your level.</p>' +
      '<div class="row"><button class="btn" data-act="trSpar"' + (tree.n ? '' : ' disabled') + '>Play against my opponents</button></div></div>';
    if (!lines.length) return h + '<p class="muted">Not enough games with this colour yet to pick out the lines you meet most.</p>';
    const worst = lines.filter(l => l.n >= 4).sort((a, b) => T.score(a) - T.score(b)).slice(0, 3).filter(l => T.score(l) < 50);
    if (worst.length) h += '<h3>Where you score worst</h3>' + worst.map(l => lineRow(l)).join('');
    return h + '<h3>Lines you meet most</h3>' + lines.slice(0, 8).map(l => lineRow(l)).join('');
  }
  if (t.course) return h + courseHTML();
  h += '<div class="card"><label>Find an opening<input id="opq" value="' + esc(t.q) + '" placeholder="e.g. Caro-Kann, London, Najdorf" autocomplete="off" spellcheck="false"></label><div id="opres">' + searchHTML() + '</div></div>';
  const mine = {};
  for (const x of S.hist) { if (!x.op) continue; const k = x.c + x.op, o = mine[k] || (mine[k] = { name: x.op, c: x.c, n: 0, w: 0, d: 0, l: 0 }); o.n++; o[x.res === 'win' ? 'w' : x.res === 'draw' ? 'd' : 'l']++; }
  const top = Object.values(mine).filter(o => o.n >= 2 && openMap && openMap.has(o.name)).sort((a, b) => b.n - a.n).slice(0, 8);
  if (top.length) h += '<h3>What you actually play</h3><div class="card olist">' + top.map(o => '<button class="orow2" data-open="' + esc(o.name) + '" data-side="' + o.c + '"><span><span class="dot ' + o.c + '"></span>' + esc(o.name) + '</span>' + wldBar(o) + '<span class="muted">' + o.n + ' · ' + T.score(o) + '%</span></button>').join('') + '</div>';
  let grp = '';
  CORE.forEach((k, i) => {
    if (k.group !== grp) { h += (grp ? '</div>' : '') + '<h3>' + esc(k.group) + '</h3><div class="card olist">'; grp = k.group; }
    h += '<button class="orow2" data-core="' + i + '"><span>' + (S.opProg[k.name] && S.opProg[k.name].clean ? '<i class="tick">✓</i>' : '') + esc(k.name) + '</span><span class="muted">' + Math.ceil(k.line.split(' ').length / 2) + ' moves</span></button>';
  });
  return h + '</div>';
}
function searchHTML() {
  const q = S.tr.q.trim().toLowerCase();
  if (!q) return '';
  if (!openList) return '<p class="muted">Loading the opening book…</p>';
  const words = q.split(/\s+/), norm = s => s.toLowerCase().replace(/[’']/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hits = openList.filter(o => { const n = norm(o[0]); return words.every(w => n.includes(norm(w))); }).sort((a, b) => a[0].length - b[0].length).slice(0, 25);
  return hits.length ? '<div class="olist">' + hits.map(o => openRow(o[0], o[0], '<span class="muted">' + Math.ceil(o[1].split(' ').length / 2) + ' moves</span>')).join('') + '</div>' : '<p class="muted">No opening with that name.</p>';
}

/* ---------- a full game against the engine ---------- */

let sparElo = null;
function weakEngine(elo) { // Stockfish held back to about this rating
  if (!sparE) sparE = Engine.worker(ENGINE);
  if (sparElo !== elo) {
    sparElo = elo;
    if (elo >= 1320) { sparE.option('UCI_LimitStrength', 'true'); sparE.option('UCI_Elo', Math.min(3190, elo)); }
    else { sparE.option('UCI_LimitStrength', 'false'); sparE.option('Skill Level', 0); }
  }
  return sparE;
}
const botElo = () => Math.max(400, Math.min(3000, Math.round((myElo() + (S.tr.bot ? +S.tr.bot.lvl : 0)) / 50) * 50));
function botHTML() {
  const b = S.tr.bot || (S.tr.bot = { side: 'r', lvl: 0 }), me = myElo(), opt = (v, cur, label) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>';
  const past = S.games.filter(g => g.bot).slice(0, 8);
  return '<div class="card"><p>A normal game from move one against Stockfish, held back to about your level. No hints and no take-backs. When it ends, the game is reviewed like any other and its mistakes become puzzles.</p>' +
    '<div class="row"><label>I play<select id="botSide">' + opt('r', b.side, 'Random') + opt('w', b.side, 'White') + opt('b', b.side, 'Black') + '</select></label>' +
    '<label>Opponent<select id="botLvl">' + [[-200, 'Easier'], [0, 'My level'], [200, 'Harder'], [400, 'Much harder']].map(x => opt(x[0], b.lvl, x[1] + ' (' + Math.max(400, Math.round((me + x[0]) / 50) * 50) + ')')).join('') + '</select></label></div>' +
    '<div class="row"><button class="btn" data-act="botStart">Start the game</button></div></div>' +
    (past.length ? '<h3>Your games against it</h3><div class="games">' + past.map(g => { const rv = S.reviews[g.id]; return '<button class="game" data-game="' + esc(g.id) + '"><span class="res ' + g.result + '">' + g.result.charAt(0).toUpperCase() + '</span><span class="gmain"><b><span class="dot ' + g.color + '"></span>vs ' + esc(g.opponent) + '</b><span class="muted">' + esc([g.opening || 'Unknown opening', when(g.end)].join(' · ')) + '</span></span><span class="gacc">' + (rv ? accOf(g, rv, g.color) + '%' : '<span class="muted">Review</span>') + '</span></button>'; }).join('') + '</div>' : '');
}
function finishBot(z, won, lost) {
  if (z.sans.length < 4 || z.botMeta) return; // nothing worth keeping
  const elo = z.opt.bot.elo, me = S.settings.user.trim() || 'You', bot = 'Stockfish ' + elo, white = z.color === 'w';
  const res = won ? (white ? '1-0' : '0-1') : lost ? (white ? '0-1' : '1-0') : '1/2-1/2', mine = myElo();
  const pgn = '[Event "Blunder Lab game"]\n[White "' + (white ? me : bot) + '"]\n[Black "' + (white ? bot : me) + '"]\n[Result "' + res + '"]\n[WhiteElo "' + (white ? mine : elo) + '"]\n[BlackElo "' + (white ? elo : mine) + '"]\n\n' + T.movesText(z.sans) + ' ' + res + '\n';
  const meta = z.botMeta = { id: 'b' + Date.now().toString(36), pasted: true, bot: true, url: '', pgn, white: white ? me : bot, black: white ? bot : me, wr: white ? mine : elo, br: white ? elo : mine, color: z.color,
    result: won ? 'win' : lost ? 'loss' : 'draw', how: '', opponent: bot, timeClass: 'bot', end: Date.now(), opening: z.opening || '' };
  S.games.unshift(meta); store.set({ games: S.games }); touchSync();
  if (z.sans.length >= 10 && !S.busy) reviewMany([meta], true);
}

/* ---------- blunder check: is this move safe? ---------- */

function drillItems() {
  const mix = a => a.map(x => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  const bad = [], safe = [];
  for (const g of mix(S.games.filter(x => S.reviews[x.id] && S.reviews[x.id].colors)).slice(0, 14)) {
    let game;
    try { game = R.readGame(g.pgn); } catch (e) { continue; }
    const rv = S.reviews[g.id];
    game.plies.forEach((p, i) => {
      const r = rv.recs[i];
      if (!r || p.color !== g.color || i < 10 || r.cls === 'book' || r.cls === 'forced') return;
      const nx = rv.evals[i + 1], reply = nx && nx.lines[0] && nx.lines[0].pv && nx.lines[0].pv[0];
      const it = { p, r, reply, opp: g.opponent, end: g.end };
      if ((r.cls === 'blunder' || r.cls === 'mistake') && r.loss >= 0.15 && reply) { it.bad = true; bad.push(it); }
      else if (['best', 'excellent', 'great', 'good'].includes(r.cls) && r.loss < 0.03) { it.bad = false; safe.push(it); }
    });
  }
  const b = mix(bad).slice(0, 5), caps = mix(safe.filter(x => x.p.captured)).slice(0, 2), s = caps.concat(mix(safe.filter(x => !x.p.captured))).slice(0, Math.max(b.length, 3));
  return mix(b.concat(s));
}
function drillShow(z) {
  const it = z.items[z.i];
  z.c = new Chess(it.p.before); z.color = it.p.color; S.flipped = it.p.color === 'b';
  z.arrow = { from: it.p.from, to: it.p.to }; z.tried = null; z.last = null; z.state = 'ask'; z.busy = true;
  render();
}
function startDrill() {
  const items = drillItems();
  if (items.length < 4) { S.drillMsg = 'There are not enough reviewed games yet. Review a few more and come back.'; renderPanel(); return; }
  const z = newSession('drill', items[0].p.color);
  z.items = items; z.i = 0; z.right = 0; z.run = 0; z.bestRun = 0;
  drillShow(z);
}
function drillAnswer(saysBad) {
  const z = S.train, it = z.items[z.i];
  if (!z || z.state !== 'ask') return;
  z.ok = saysBad === it.bad; z.state = 'shown';
  if (z.ok) { z.right++; z.run++; z.bestRun = Math.max(z.bestRun, z.run); } else z.run = 0;
  try { z.c.move({ from: it.p.from, to: it.p.to, promotion: it.p.promotion || undefined }); z.last = [it.p.from, it.p.to]; } catch (e) { /* keep the position as it was */ }
  z.arrow = null; z.tried = it.bad ? it.reply : null; // the red arrow is the reply that punishes it
  render();
}
function drillNext() {
  const z = S.train;
  if (++z.i >= z.items.length) { z.done = true; z.tried = null; const d = S.settings.drill || (S.settings.drill = { n: 0, right: 0, best: 0 }); d.n += z.items.length; d.right += z.right; d.best = Math.max(d.best, z.bestRun); saveSettings(); render(); }
  else drillShow(z);
}
function drillIntroHTML() {
  const d = S.settings.drill;
  return '<div class="card"><p>Quick-fire positions from your own games. You see a move you actually played and say whether it was <b>safe</b> or a <b>mistake</b>. It trains the one habit that wins the most games at your level: checking a move before you play it.</p>' +
    (S.drillMsg ? '<p><b>' + esc(S.drillMsg) + '</b></p>' : '') + '<div class="row"><button class="btn" data-act="drStart">Start</button></div>' +
    (d && d.n ? '<p class="muted">So far: ' + d.right + ' of ' + d.n + ' right (' + Math.round(100 * d.right / d.n) + '%). Best run: ' + d.best + ' in a row.</p>' : '') + '</div>';
}
function drillHTML() {
  const z = S.train, it = z.items[Math.min(z.i, z.items.length - 1)], side = it.p.color === 'w' ? 'White' : 'Black';
  if (z.done) return '<div class="card pz"><div class="lbl">Blunder check</div><h3>' + z.right + ' of ' + z.items.length + ' right</h3><p>Best run: ' + z.bestRun + ' in a row.</p><div class="row"><button class="btn" data-act="drStart">Go again</button><button class="btn ghost" data-act="trStop">Back</button></div></div>';
  let h = '<div class="card pz ' + (z.state === 'ask' ? '' : z.ok ? 'right' : 'wrong') + '"><div class="lbl">Blunder check · ' + (z.i + 1) + ' of ' + z.items.length + ' · ' + z.right + ' right' + (z.run > 1 ? ' · ' + z.run + ' in a row' : '') + '</div>';
  if (z.state === 'ask') h += '<h3>Is ' + esc(it.p.san) + ' safe?</h3><p>You are ' + side + ' (against ' + esc(it.opp || '?') + ', ' + esc(when(it.end)) + '). The arrow shows the move. Look at what your opponent can do after it.</p>' +
    '<div class="row"><button class="btn" data-act="drSafe">Safe</button><button class="btn ghost" data-act="drBad">Mistake</button></div>';
  else {
    const bs = it.r.best ? (R.lineToSan(it.p.before, [it.r.best])[0] || {}).san : '', rs = it.bad && it.reply ? (R.lineToSan(it.p.after, [it.reply])[0] || {}).san : '';
    h += '<h3>' + (z.ok ? 'Right' : 'Not quite') + ': ' + esc(it.p.san) + (it.bad ? ' was a ' + it.r.cls : ' was fine') + '</h3><p>' + esc(R.explain(it.r, it.p, bs)) + (rs ? ' The red arrow is the reply, ' + esc(rs) + '.' : '') + '</p>' +
      '<div class="row"><button class="btn" data-act="drNext">' + (z.i + 1 >= z.items.length ? 'See the result' : 'Next') + '</button></div>';
  }
  return h + '</div><div class="row"><button class="link" data-act="trStop">Stop</button></div>';
}

/* ---------- head to head, and "explain this move" ---------- */

function h2hHTML(meta) {
  if (meta.bot || meta.pasted || meta.train) return '';
  const H = T.headToHead(S.hist, meta.opponent, meta.id);
  if (!H.n) return '';
  return '<details class="card sum h2h"><summary>You have played ' + esc(meta.opponent) + ' ' + H.n + ' time' + (H.n === 1 ? '' : 's') + ' before <span class="muted">' + H.w + 'W ' + H.d + 'D ' + H.l + 'L</span></summary>' +
    H.games.slice(0, 6).map(x => '<div class="orow"><span><span class="dot ' + x.c + '"></span>' + esc(when(x.end)) + ' · ' + esc(x.op || T.movesText(x.mv.split(' ').slice(0, 4))) + '</span><span></span><span class="' + (x.res === 'win' ? 'up' : x.res === 'loss' ? 'down' : 'muted') + '">' + (x.res === 'win' ? 'Won' : x.res === 'loss' ? 'Lost' : 'Drew') + '</span></div>').join('') + '</details>';
}
function whyHTML() {
  const { meta, game, rv } = S.cur;
  if (S.explain !== meta.id + ':' + S.ply) return '';
  let out = [];
  try { out = T.explainWhy(game.plies[S.ply - 1], rv.recs[S.ply - 1], rv.evals[S.ply - 1], rv.evals[S.ply]); } catch (e) { /* nothing to add */ }
  return out.length ? '<div class="why">' + out.map(s => '<p>' + esc(s) + '</p>').join('') + '</div>' : '';
}

/* ---------- goals, streaks and the opening report card ---------- */

function goalsHTML() {
  const g = S.goals, now = Date.now(), tc = S.eloTc, ser = tc ? T.ratingSeries(S.hist, tc) : [], cur = ser.length ? ser[ser.length - 1].r : 0;
  const today = (S.act[T.dayKey(now)] || {}).pz || 0, wk = S.games.filter(x => S.reviews[x.id] && (S.reviews[x.id].at || 0) > now - 7 * 864e5).length, run = T.streak(S.act, 'pz', g.pz || 1, now);
  const row = (label, id, val, ph, pct, note) => '<div class="goal"><label>' + label + '<input id="' + id + '" inputmode="numeric" value="' + esc(val || '') + '" placeholder="' + ph + '"></label>' +
    '<div><span class="track"><i style="width:' + Math.round(100 * Math.max(0, Math.min(1, pct))) + '%"></i></span><span class="muted">' + note + '</span></div></div>';
  let rn = cur ? 'You are at ' + cur + ' (' + tc + '). Set a target.' : 'Set a target once your games are loaded.', rp = 0;
  if (g.rating && cur) {
    const from = Math.min(g.from || cur, cur), P = T.project(ser, 30);
    rp = cur >= g.rating ? 1 : g.rating > from ? (cur - from) / (g.rating - from) : 0;
    rn = cur >= g.rating ? cur + ' · goal reached. Set the next one.' : cur + ' now · ' + (g.rating - cur) + ' to go' + (P ? (P.proj >= g.rating ? ' · on current form you get there within about 30 games' : ' · current form points to ' + P.proj + ' in 30 games') : '');
  }
  return '<h3>Goals</h3><div class="card">' +
    row('Rating goal' + (tc ? ' (' + tc + ')' : ''), 'goalRating', g.rating, 'e.g. ' + (cur ? Math.ceil((cur + 50) / 50) * 50 : 1000), rp, rn) +
    row('Puzzles a day', 'goalPz', g.pz, 'e.g. 10', g.pz ? today / g.pz : 0, today + ' done today' + (g.pz ? ' of ' + g.pz : '') + ' · ' + (run ? run + '-day streak' : 'no streak yet')) +
    row('Reviews a week', 'goalRv', g.rv, 'e.g. 7', g.rv ? wk / g.rv : 0, wk + ' in the last 7 days' + (g.rv ? ' of ' + g.rv : '')) + '</div>';
}
function openReportHTML() {
  const rows = T.openingReport(S.games, S.reviews);
  if (!rows.length) return '';
  return '<h3>Opening report card</h3><div class="card"><table class="rep"><tr><th>Opening</th><th>Games</th><th>In theory</th><th>First 12</th><th>Grade</th></tr>' +
    rows.map(o => '<tr><td><span class="dot ' + o.c + '"></span>' + esc(o.name) + (o.slip ? '<span class="muted slip">Usually slips on move ' + (Math.floor(o.slip.ply / 2) + 1) + ' with ' + esc(o.slip.san) + (o.slip.n > 1 ? ' (' + o.slip.n + ' games)' : '') + '</span>' : '') + '</td><td>' + o.n + '</td><td>' + o.book.toFixed(1) + ' moves</td><td>' + (o.acc == null ? '–' : o.acc.toFixed(0) + '%') + '</td><td><b class="grade g' + o.grade + '">' + o.grade + '</b></td></tr>').join('') +
    '</table><p class="muted">“In theory” is how many moves the game stayed in known opening lines. “First 12” is your accuracy over your first twelve moves outside the book. Reviewed games only.</p></div>';
}

/* ---------- sync between devices (a private GitHub gist) ---------- */

let gist = null, syncTimer = null, remoteCache = null;
function touchSync() { if (!S.sync.token) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 8000); }
const madeOnly = () => { const o = {}; for (const k in S.puzzles) if (S.puzzles[k].made) o[k] = S.puzzles[k]; return o; }; // made-up puzzles stay on the device that made them
const localState = () => ({ user: { v: S.settings.user, t: S.settings.userT || 0 }, puzzles: (() => { const o = {}; for (const k in S.puzzles) if (!S.puzzles[k].made) o[k] = S.puzzles[k]; return o; })(), goals: S.goals, act: S.act, daily: S.daily, train: S.trainGames, opProg: S.opProg, rep: S.rep, calib: S.calib, endProg: S.endProg, pasted: S.games.filter(g => g.pasted) });
const betterRv = (x, y) => (x.depth || 0) > (y.depth || 0) || ((x.depth || 0) === (y.depth || 0) && (x.at || 0) > (y.at || 0));
async function syncNow() {
  if (!S.sync.token || S.sync.busy) return;
  S.sync.busy = true; S.sync.error = ''; paintSync();
  try {
    if (!gist || gist.token !== S.sync.token) { gist = new Y.Gist(S.sync.token); remoteCache = null; }
    if (!S.sync.gist) { S.sync.gist = await gist.find(); await store.set({ syncGist: S.sync.gist }); }
    const remote = remoteCache = (await gist.read(S.sync.gist)) || remoteCache || {}, out = {}, sets = {};
    // puzzle progress, repertoire and the rest: merge item by item, then store whichever side was behind
    const mine = localState(), merged = Y.mergeState(mine, remote['state.json']);
    if (!Y.same(merged, Y.mergeState(mine, null))) {
      S.puzzles = Object.assign(madeOnly(), merged.puzzles); S.goals = merged.goals; S.act = merged.act; S.daily = merged.daily; S.trainGames = merged.train; S.opProg = merged.opProg; S.rep = merged.rep; S.calib = merged.calib; S.endProg = merged.endProg; S._fit = null;
      if (merged.user.v && (merged.user.t > (S.settings.userT || 0) || !S.settings.user.trim())) { S.settings.user = merged.user.v; S.settings.userT = merged.user.t; sets.settings = S.settings; }
      for (const g of merged.pasted) { const i = S.games.findIndex(x => x.id === g.id); if (i < 0) S.games.push(g); else if ((g.edited || 0) > (S.games[i].edited || 0)) S.games[i] = g; }
      Object.assign(sets, { puzzles: S.puzzles, goals: S.goals, act: S.act, daily: S.daily, trainGames: S.trainGames, opProg: S.opProg, rep: S.rep, calib: S.calib, endProg: S.endProg });
    }
    if (!Y.same(merged, Y.mergeState(remote['state.json'], null))) out['state.json'] = merged;
    // reviews: take the ones this device lacks, send the ones the others lack
    let got = 0;
    for (const name in remote) {
      if (!name.startsWith('rv-')) continue;
      for (const id in remote[name]) {
        const inc = remote[name][id], cur = S.reviews[id];
        if (!inc || !inc.rv || (cur && !betterRv(inc.rv, cur))) continue;
        S.reviews[id] = inc.rv; sets['rv:' + id] = inc.rv; got++;
        if (inc.g && !inc.g.train && !S.games.some(g => g.id === id)) S.games.push(inc.g);
      }
    }
    for (const g of S.games.concat(liveTrain())) {
      const rv = S.reviews[g.id]; if (!rv) continue;
      const name = Y.monthKey(g.end), theirs = (remote[name] || {})[g.id];
      if (theirs && !betterRv(rv, theirs.rv)) continue;
      (out[name] = out[name] || Object.assign({}, remote[name] || {}))[g.id] = { g, rv: Y.slim(rv) };
    }
    // the light game history (rating chart, opening trainer), so a device that cannot read chess.com itself still has it
    const rh = remote['hist.json'] || {}, lower = S.settings.user.trim().toLowerCase();
    if (rh.user === lower && Array.isArray(rh.list)) {
      if (S.histUser !== lower) { S.hist = []; S.histMonths = []; S.histUser = lower; }
      const have = new Map(S.hist.map((x, i) => [x.id, i])), add = rh.list.filter(x => !have.has(x.id));
      let fixed = 0;
      for (const x of rh.list) if (have.has(x.id) && x.opp !== undefined && S.hist[have.get(x.id)].opp === undefined) { S.hist[have.get(x.id)] = x; fixed++; }
      if (add.length || fixed) { S.hist = S.hist.concat(add).sort((a, b) => a.end - b.end); sets.hist = S.hist; sets.histUser = lower; }
    }
    const full = h => h.every(x => x.opp !== undefined);
    if (S.histUser === lower && S.hist.length && (rh.user !== lower || S.hist.length > (rh.list || []).length || (rh.v !== 2 && full(S.hist)))) out['hist.json'] = { user: lower, v: full(S.hist) ? 2 : 1, list: S.hist };
    if (got || sets.puzzles) { S.games.sort((a, b) => b.end - a.end); sets.games = S.games; }
    if (Object.keys(sets).length) await store.set(sets);
    if (Object.keys(out).length) { await gist.write(S.sync.gist, out); Object.assign(remoteCache, out); }
    S.sync.last = Date.now();
    if (Object.keys(sets).length) { await applyBands(); softPanel(); }
  } catch (e) { S.sync.error = e.message; }
  S.sync.busy = false; paintSync();
}
function syncHTML() {
  const y = S.sync;
  if (!y.token) return '<p>Keeps your reviews, puzzle progress, repertoire and settings the same on every device: this computer, your laptop, your iPhone and your iPad. The data goes into a private gist on your own GitHub account.</p>' +
    '<label>GitHub token<input id="syncTok" type="password" autocomplete="off" spellcheck="false" placeholder="paste the token here"></label>' +
    '<div class="row"><button class="btn" data-act="syncOn">Turn on sync</button></div>' +
    '<details class="help"><summary>How to get a token</summary><ol><li>Sign in at github.com.</li><li>Open Settings, then Developer settings, then Personal access tokens, then Tokens (classic).</li><li>Generate new token (classic). Name it Blunder Lab, set “No expiration”, and tick only <b>gist</b>.</li><li>Copy the token and paste it here. Paste the same token on each device.</li></ol></details>';
  return '<p>' + (y.error ? '<b>Sync problem:</b> ' + esc(y.error) : y.busy ? 'Syncing…' : y.last ? 'On. Last synced at ' + new Date(y.last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : 'On. Waiting for the first sync.') + '</p>' +
    '<div class="row"><button class="btn ghost" data-act="syncGo"' + (y.busy ? ' disabled' : '') + '>Sync now</button><button class="btn ghost" data-act="syncOff">Turn off on this device</button></div>';
}
function paintSync() { const el = $('#syncCard'); if (el && !(document.activeElement && document.activeElement.id === 'syncTok')) el.innerHTML = syncHTML(); }

/* ---------- clock graph ---------- */

const mmss = s => (s == null ? '' : s >= 60 ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : (s < 10 ? s.toFixed(1) : Math.round(s)) + 's');
function clockHTML() {
  const { meta, game, rv } = S.cur, tc = R.timeControl(meta.pgn);
  if (!tc || !rv.clocks || !rv.colors || rv.clocks.every(c => c == null)) return '';
  const sp = R.spentTimes(rv.clocks, rv.colors, tc), n = rv.evals.length, W = 300, H = 44, mid = H / 2;
  const known = sp.filter(x => x != null).sort((a, b) => a - b), max = Math.max(5, known[Math.floor(known.length * 0.95)] || 5);
  const x = i => (n > 1 ? i / (n - 1) : 0) * W, bw = Math.max(1, W / Math.max(n - 1, 1) * 0.72);
  let bars = '';
  sp.forEach((t, i) => {
    if (t == null) return;
    const h = Math.max(0.8, Math.min(1, Math.sqrt(t / max)) * (mid - 2)), bad = ['mistake', 'miss', 'blunder'].includes(rv.recs[i].cls), w = rv.colors[i] === 'w';
    bars += '<rect class="' + (bad ? 'f-' + rv.recs[i].cls : w ? 'cw' : 'cb') + '" x="' + (x(i + 1) - bw / 2).toFixed(1) + '" y="' + (w ? mid - h : mid).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
  });
  const i = S.ply - 1, cap = S.ply && sp[i] != null ? esc(game.plies[i].san) + ': ' + mmss(sp[i]) + ' spent, ' + mmss(rv.clocks[i]) + ' left on the clock' : 'Time spent on each move. White above the line, Black below; errors in colour.';
  return '<svg class="clock" id="clock" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Time spent on each move"><rect width="' + W + '" height="' + H + '" class="ckb"/>' + bars +
    '<line x1="0" x2="' + W + '" y1="' + mid + '" y2="' + mid + '" class="gm"/><line class="gc" x1="' + x(S.ply) + '" x2="' + x(S.ply) + '" y1="0" y2="' + H + '"/></svg><div class="clkcap muted">' + cap + '</div>';
}
function clockStatsHTML() {
  const C = R.clockStats(S.games, S.reviews);
  if (C.n < 40) return '';
  const rate = b => (b.moves ? 100 * b.bad / b.moves : 0), row = b => '<tr><td>' + b.label + '</td><td>' + b.moves + '</td><td>' + b.bad + '</td><td>' + (b.moves ? rate(b).toFixed(1) + '%' : '–') + '</td></tr>';
  const all = C.bySpent.reduce((a, b) => a + b.bad, 0) / C.n * 100, fast = C.bySpent[0], low = C.byLeft[0], slow = C.bySpent[3];
  const say = fast.moves >= 15 && rate(fast) > 1.5 * all ? 'You rush: moves played in under 2 seconds go wrong ' + (rate(fast) / Math.max(all, 0.1)).toFixed(1) + ' times as often as your average. Take a breath before you move.' :
    low.moves >= 10 && rate(low) > 1.5 * all ? 'Time trouble costs you: with under 20 seconds left your error rate is ' + (rate(low) / Math.max(all, 0.1)).toFixed(1) + ' times your average. Spend less time early.' :
    slow.moves >= 10 && rate(slow) > 1.5 * all ? 'Your long thinks go wrong more often than your quick moves: the hard positions are where you slip, not the rushed ones.' : 'Your errors are spread evenly: neither rushing nor time trouble stands out.';
  return '<h3>Thinking time and mistakes</h3><div class="card"><p>' + say + '</p><table><tr><th>Time on the move</th><th>Moves</th><th>Big errors</th><th>Rate</th></tr>' + C.bySpent.map(row).join('') +
    '<tr><th>Clock left</th><th></th><th></th><th></th></tr>' + C.byLeft.map(row).join('') + '</table></div>';
}

/* ---------- puzzle themes ---------- */

function themeChips() {
  const cnt = {};
  let tot = 0;
  Object.values(S.puzzles).forEach(p => { if (R.mastered(p) || p.made) return; const t = themeOf(p); cnt[t] = (cnt[t] || 0) + 1; tot++; });
  const lab = n => (n ? '<span class="muted">' + n + '</span>' : '<span class="tick">✓</span>');
  return '<div class="seg chips"><button data-act="pzTheme" data-v="" aria-pressed="' + !S.pzTheme + '">All ' + lab(tot) + '</button>' +
    Object.keys(R.THEMES).map(k => '<button data-act="pzTheme" data-v="' + k + '" aria-pressed="' + (S.pzTheme === k) + '">' + R.THEMES[k] + ' ' + lab(cnt[k] || 0) + '</button>').join('') + '</div>';
}
function themesHTML() {
  const all = ownPuzzles();
  if (all.length < 5) return '';
  const by = {};
  all.forEach(p => { const o = by[themeOf(p)] || (by[themeOf(p)] = { n: 0, seen: 0, right: 0 }); o.n++; o.seen += p.seen || 0; o.right += p.right || 0; });
  const keys = Object.keys(by).sort((a, b) => by[b].n - by[a].n);
  return '<h3>Your mistakes by type</h3><div class="card"><table><tr><th>What you missed</th><th>Times</th><th>Puzzle tries</th><th>Solved</th></tr>' +
    keys.map(k => '<tr><td>' + R.THEMES[k] + '</td><td>' + by[k].n + '</td><td>' + by[k].seen + '</td><td>' + (by[k].seen ? Math.round(100 * by[k].right / by[k].seen) + '%' : '–') + '</td></tr>').join('') +
    '</table><p class="muted">Pick a type on the Puzzles tab to drill only that.</p></div>';
}

/* ---------- weekly report ---------- */

function weekStats(from, to) {
  const hs = S.hist.filter(h => h.end >= from && h.end < to), o = { n: hs.length, w: 0, d: 0, l: 0 };
  hs.forEach(h => { o[h.res === 'win' ? 'w' : h.res === 'draw' ? 'd' : 'l']++; });
  const byTc = {}; hs.forEach(h => { if (h.rated) byTc[h.tc] = (byTc[h.tc] || 0) + 1; });
  o.tc = Object.keys(byTc).sort((a, b) => byTc[b] - byTc[a])[0] || '';
  if (o.tc) { const ser = T.ratingSeries(S.hist, o.tc), inw = ser.filter(h => h.end >= from && h.end < to), before = ser.filter(h => h.end < from).pop(); o.change = inw.length ? inw[inw.length - 1].r - (before ? before.r : inw[0].r) : null; o.rating = inw.length ? inw[inw.length - 1].r : null; }
  const rg = S.games.filter(g => g.end >= from && g.end < to && S.reviews[g.id]), avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  o.reviewed = rg.length; o.games = rg;
  o.acc = avg(rg.map(g => accOf(g, S.reviews[g.id], g.color)).filter(x => x != null));
  o.gr = avg(rg.map(g => gameRating(g, S.reviews[g.id], g.color)).filter(Boolean).map(g => g.rating));
  o.bad = avg(rg.map(g => S.reviews[g.id].recs.filter((r, i) => S.reviews[g.id].colors[i] === g.color && ['mistake', 'miss', 'blunder'].includes(r.cls)).length));
  const th = {}; ownPuzzles().forEach(p => { if (p.date >= from && p.date < to) th[themeOf(p)] = (th[themeOf(p)] || 0) + 1; });
  delete th.other;
  o.theme = Object.keys(th).sort((a, b) => th[b] - th[a])[0] || ''; o.themeN = th[o.theme] || 0;
  return o;
}
function weeklyHTML() {
  const now = Date.now(), wk = 7 * 864e5, a = weekStats(now - wk, now + 1), b = weekStats(now - 2 * wk, now - wk);
  if (!a.n && !b.n) return '';
  const d = (x, y, f, good) => (x == null || y == null ? '' : (() => { const v = x - y; return Math.abs(v) < (f === 1 ? 0.05 : 0.5) ? '<span class="muted">same</span>' : '<span class="' + ((v > 0) === good ? 'up' : 'down') + '">' + (v > 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(f) + '</span>'; })());
  const row = (label, x, y, delta) => '<tr><td>' + label + '</td><td>' + x + '</td><td>' + y + '</td><td>' + delta + '</td></tr>', n = (v, f) => (v == null ? '–' : v.toFixed(f));
  let h = '<h3>This week</h3><div class="card"><table><tr><th></th><th>Last 7 days</th><th>7 before</th><th>Change</th></tr>' +
    row('Games', a.n + ' <span class="muted">' + a.w + 'W ' + a.d + 'D ' + a.l + 'L</span>', b.n + ' <span class="muted">' + b.w + 'W ' + b.d + 'D ' + b.l + 'L</span>', '') +
    row('Score', a.n ? Math.round(100 * (a.w + a.d / 2) / a.n) + '%' : '–', b.n ? Math.round(100 * (b.w + b.d / 2) / b.n) + '%' : '–', d(a.n ? 100 * (a.w + a.d / 2) / a.n : null, b.n ? 100 * (b.w + b.d / 2) / b.n : null, 0, true)) +
    row('Rating' + (a.tc ? ' (' + a.tc + ')' : ''), a.change == null ? '–' : (a.change >= 0 ? '+' : '−') + Math.abs(a.change), b.change == null ? '–' : (b.change >= 0 ? '+' : '−') + Math.abs(b.change), a.rating ? '<span class="muted">now ' + a.rating + '</span>' : '') +
    row('Accuracy', n(a.acc, 1) + (a.acc == null ? '' : '%'), n(b.acc, 1) + (b.acc == null ? '' : '%'), d(a.acc, b.acc, 1, true)) +
    row('Game rating', n(a.gr, 0), n(b.gr, 0), d(a.gr, b.gr, 0, true)) +
    row('Big errors per game', n(a.bad, 1), n(b.bad, 1), d(a.bad, b.bad, 1, false)) + '</table>';
  if (a.theme) h += '<p>Most common miss this week: <b>' + R.THEMES[a.theme].toLowerCase() + '</b> (' + a.themeN + ' times).</p>';
  const tips = a.reviewed ? R.insights(a.games, S.reviews).tips : [];
  if (tips.length) h += '<p><b>Work on:</b></p><ol class="tips">' + tips.map(t => '<li><b>' + esc(t.title) + '.</b> ' + esc(t.text) + '</li>').join('') + '</ol>';
  else if (a.n && !a.reviewed) h += '<p class="muted">None of this week’s games are reviewed yet, so accuracy and advice are missing.</p>';
  return h + '</div>';
}

/* ---------- training games: other players' games that only tune the estimates ---------- */

const liveTrain = () => S.trainGames.filter(g => !g.removed);
const findGame = id => S.games.find(x => x.id === id) || liveTrain().find(x => x.id === id);
async function addTraining(meta) {
  Object.assign(meta, { train: true, edited: Date.now() });
  const i = S.trainGames.findIndex(g => g.id === meta.id);
  if (i >= 0) S.trainGames[i] = meta; else S.trainGames.push(meta);
  await store.set({ trainGames: S.trainGames }); touchSync();
  S.ccOpen = true; S.ccMsg = '';
  openGame(meta);
}
function trainHTML() {
  const has = g => Object.keys(S.calib[g.id] || {}).some(k => k !== 't'), list = liveTrain().sort((a, b) => b.edited - a.edited), done = list.filter(has).length;
  const status = g => (has(g) ? '<span class="cctag">chess.com ✓</span>' : S.reviews[g.id] ? '<span class="muted">needs chess.com’s numbers</span>' : '<span class="muted">not reviewed yet</span>');
  return '<h3>Training games</h3><div class="card"><p>Other players’ games, kept hidden from your lists, puzzles and stats. They only teach accuracy, game rating and move ratings to match chess.com. Review the game on chess.com, add it here, then paste chess.com’s numbers into “Match chess.com”. Players far above and below your rating teach it the most.</p>' +
    '<div class="row"><label class="grow">chess.com game link<input id="tgLink" placeholder="chess.com/game/live/…" autocomplete="off" autocapitalize="off" spellcheck="false"></label><label>One player’s username<input id="tgUser" placeholder="from the game" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn" data-act="tgAdd">Add</button></div>' +
    '<details class="help"><summary>Or paste a PGN</summary><textarea id="tgPgn" rows="4" placeholder="Paste the game’s PGN or move list"></textarea><div class="row"><button class="btn small" data-act="tgPaste">Add</button></div></details>' +
    (list.length ? '<p class="muted">' + list.length + ' training game' + (list.length === 1 ? '' : 's') + ', ' + done + ' with chess.com’s numbers.</p>' + list.map(g => '<div class="lrow"><div class="lmain"><b>' + esc(g.white) + ' <span class="muted">' + esc(g.wr || '') + '</span> vs ' + esc(g.black) + ' <span class="muted">' + esc(g.br || '') + '</span></b><span class="lnote">' + esc([g.v960 ? 'Chess960' : g.timeClass, when(g.end)].filter(Boolean).join(' · ')) + ' · ' + status(g) + '</span></div>' +
      '<div class="lbtns"><button class="btn small ghost" data-act="tgOpen" data-id="' + esc(g.id) + '">Open</button><button class="link" data-act="tgDel" data-id="' + esc(g.id) + '">Remove</button></div></div>').join('') : '') + '</div>';
}

/* ---------- adding one game by its chess.com link ---------- */

// chess.com's bots and the ratings chess.com lists for them. Bots you have played come first, at the rating you gave them.
const BOTS = [['Martin', 250], ['Elani', 400], ['Aron', 700], ['Emir', 1000], ['Maxim', 1000], ['Sven', 1100], ['Azeez', 1100], ['Maria', 1200], ['Nelson', 1300], ['David', 1400], ['Antonio', 1500], ['Isabel', 1600], ['Wally', 1800], ['Li', 2000]];
const canonBot = n => { const b = BOTS.find(x => x[0].toLowerCase() === (n || '').toLowerCase()); return b ? b[0] : n; }; // "antonio" -> "Antonio"
function botChoices() {
  const seen = {}, out = [];
  for (const g of S.games) if (g.computer && g.opponent) { const k = g.opponent.toLowerCase(); if (!(k in seen)) { seen[k] = 1; out.push({ name: g.opponent, elo: +(g.color === 'w' ? g.br : g.wr) || 0, used: true }); } }
  for (const [n, e] of BOTS) if (!(n.toLowerCase() in seen)) out.push({ name: n, elo: e });
  return out;
}
function myRatingChoices() {
  const out = [], last = S.games.find(g => g.computer), r0 = last ? +(last.color === 'w' ? last.wr : last.br) || 0 : 0;
  if (r0) out.push({ v: r0, l: 'last bot game' });
  for (const tc of ['rapid', 'blitz', 'bullet', 'daily']) { const s = T.ratingSeries(S.hist, tc); if (s.length) out.push({ v: s[s.length - 1].r, l: tc }); }
  return out;
}
// Quick picks under the bot fields: bots (with their ratings) and your own current ratings, one tap to fill in.
// Dates to pick from: today, yesterday and the days of your recent bot games.
function dateChoices() {
  const now = Date.now(), out = [{ v: T.dayKey(now), l: 'Today' }, { v: T.dayKey(now - 864e5), l: 'Yesterday' }];
  for (const g of S.games) {
    if (!g.computer || out.length >= 6) continue;
    const v = T.dayKey(g.end);
    if (!out.some(x => x.v === v)) out.push({ v, l: new Date(g.end).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) });
  }
  return out;
}
function botPickHTML(nameId, eloId, myId, dateId) {
  const bots = botChoices(), recent = bots.filter(b => b.used).slice(0, 6), chips = recent.length ? recent : bots.filter(b => ['Martin', 'Emir', 'Nelson', 'Antonio', 'Isabel'].includes(b.name)), mine = myRatingChoices();
  return '<datalist id="botList">' + bots.map(b => '<option value="' + esc(b.name) + '"' + (b.elo ? ' label="' + b.elo + '"' : '') + '></option>').join('') + '</datalist>' +
    '<div class="picks"><span class="muted">' + (recent.length ? 'Bots you have played:' : 'Common bots:') + '</span>' + chips.map(b => '<button class="chip" data-act="pickBot" data-n="' + esc(b.name) + '" data-e="' + (b.elo || '') + '" data-t="' + nameId + ',' + eloId + '">' + esc(b.name) + (b.elo ? ' <span class="muted">' + b.elo + '</span>' : '') + '</button>').join('') + '</div>' +
    (mine.length ? '<div class="picks"><span class="muted">My rating:</span>' + mine.map(m => '<button class="chip" data-act="pickMy" data-e="' + m.v + '" data-t="' + myId + '">' + m.v + ' <span class="muted">' + m.l + '</span></button>').join('') + '</div>' : '') +
    '<div class="picks"><span class="muted">Date:</span>' + dateChoices().map(d => '<button class="chip" data-act="pickMy" data-e="' + d.v + '" data-t="' + dateId + '">' + esc(d.l) + '</button>').join('') + '</div>' +
    '<p class="muted small">Type any bot’s name for the full list. Ratings are the ones chess.com lists; change them if yours shows different.</p>';
}
// Sets PGN header tags, replacing ones already there.
function setHeaders(pgn, h) {
  let s = pgn;
  for (const k in h) { const line = '[' + k + ' "' + String(h[k]).replace(/"/g, "'") + '"]', re = new RegExp('^\\s*\\[' + k + '\\s+"[^"]*"\\]\\s*$', 'm'); s = re.test(s) ? s.replace(re, line) : line + '\n' + (/^\s*\[/.test(s) ? s : '\n' + s); }
  return s;
}
// Shows the bot fields for a game against a computer, filled in from the pasted PGN where it says.
function botPrefill(text) {
  const box = $('#botFields');
  if (!box) return;
  box.hidden = $('#pasteKind').value !== 'computer';
  if (box.hidden || !text) return;
  const tag = k => (new RegExp('\\[' + k + ' "([^"]*)"\\]').exec(text) || [])[1] || '', me = S.settings.user.trim().toLowerCase();
  const wMe = tag('White').toLowerCase() === me, bMe = tag('Black').toLowerCase() === me;
  if (wMe || bMe) {
    $('#pasteColor').value = wMe ? 'w' : 'b';
    if (!$('#botName').value) $('#botName').value = tag(wMe ? 'Black' : 'White');
    if (!$('#botElo').value && /^\d+$/.test(tag(wMe ? 'BlackElo' : 'WhiteElo'))) $('#botElo').value = tag(wMe ? 'BlackElo' : 'WhiteElo');
    if (!$('#myElo').value && /^\d+$/.test(tag(wMe ? 'WhiteElo' : 'BlackElo'))) $('#myElo').value = tag(wMe ? 'WhiteElo' : 'BlackElo');
  }
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(tag('UTCDate') || tag('Date'));
  if (d) $('#gameDate').value = d[1] + '-' + d[2] + '-' + d[3];
}
function addByLink(text) {
  if (/game\/computer\//.test(text || '')) { // chess.com does not publish games against its bots: they come in as a PGN
    S.error = 'chess.com does not share games against its computer bots, so they cannot be found by link. On chess.com, open the game, press Share, choose PGN and copy it, then paste it into “Paste a PGN” here and set Against to “A computer”.';
    renderStatus(); const lb = $('#linkBox'), pb = $('#pasteBox'); if (lb) lb.hidden = true; if (pb) { pb.hidden = false; $('#pasteKind').value = 'computer'; botPrefill(''); $('#pgn').focus(); }
    return;
  }
  const m = /game\/(?:(live|daily)\/)?(\d+)/.exec(text || '') || /^\s*(\d{3,})\s*$/.exec(text || '');
  if (!m) { S.error = 'That does not look like a chess.com game link. It should look like chess.com/game/live/123456789.'; renderStatus(); return; }
  addGameById(m[2] || m[1], m[2] ? m[1] : '');
}
/* Finds one of your games on chess.com by its number, adds it to your list for good and opens it, which reviews it.
   Game numbers grow over time, so it homes in on the right month instead of reading every one. */
async function addGameById(id, kind, opt) {
  opt = opt || {};
  const have = opt.train ? liveTrain().find(g => (g.url || '').endsWith('/' + id)) : S.games.find(g => (g.url || '').endsWith('/' + id));
  if (have) { if (!opt.train && !have.added) { have.added = true; store.set({ games: S.games }); } S.ccOpen = !!opt.train || S.ccOpen; openGame(have); return; }
  const user = (opt.user || S.settings.user).trim();
  if (!user) { S.error = opt.train ? 'Enter the username of one of the two players.' : 'Enter your chess.com username on the Games tab first.'; renderStatus(); return; }
  if (S.busy) { S.error = 'Wait for the current job to finish, then add the game again.'; renderStatus(); return; }
  S.error = ''; S.busy = { text: 'Looking for game ' + id + ' on chess.com', done: 0, total: 1 }; renderStatus();
  let found = null;
  try {
    const base = 'https://api.chess.com/pub/player/' + encodeURIComponent(user.toLowerCase()), all = (await getJSON(base + '/games/archives')).archives || [];
    const num = g => +((/\/(\d+)$/.exec(g.url || '') || [])[1] || 0), tried = new Set();
    const look = async i => {
      tried.add(i); S.busy.done = tried.size; S.busy.total = Math.max(S.busy.total, Math.ceil(Math.log2(all.length + 1)) + 1); renderStatus();
      const gs = ((await getJSON(all[i])).games || []);
      return { f: gs.find(g => (g.url || '').endsWith('/' + id)), ids: gs.filter(g => !kind || (g.url || '').includes('/' + kind + '/')).map(num).filter(Boolean) };
    };
    let lo = 0, hi = all.length - 1;
    while (lo <= hi && !found) {
      const mid = (lo + hi) >> 1, r = await look(mid);
      if (r.f) { found = r.f; break; }
      if (!r.ids.length) break;
      if (+id < Math.min.apply(null, r.ids)) hi = mid - 1; else if (+id > Math.max.apply(null, r.ids)) lo = mid + 1; else break;
    }
    for (let i = all.length - 1; i >= 0 && !found; i--) { // anything left: read month by month, newest first
      if (tried.has(i)) continue;
      S.busy.total = all.length; const r = await look(i); if (r.f) found = r.f;
    }
  } catch (e) { S.busy = null; S.error = e.message; renderStatus(); return; }
  S.busy = null;
  if (!found) { S.error = 'Game ' + id + ' is not among ' + user + '’s games on chess.com. Check the link, and that ' + (opt.train ? user + ' played in it.' : 'it was played on this account.'); renderStatus(); return; }
  if (found.rules && found.rules !== 'chess' && found.rules !== 'chess960') { S.error = 'That game is a chess variant Blunder Lab cannot review (it handles standard chess and Chess960).'; renderStatus(); return; }
  const meta = toMeta(found, user);
  if (!meta) { S.error = 'That game could not be read.'; renderStatus(); return; }
  if (opt.train) return addTraining(Object.assign(meta, { id: 't:' + meta.id, color: 'w' }));
  meta.added = true;
  if (!S.games.some(g => g.id === meta.id)) { S.games.push(meta); S.games.sort((a, b) => b.end - a.end); }
  await store.set({ games: S.games });
  const lb = $('#linkBox'); if (lb) lb.hidden = true;
  openGame(S.games.find(g => g.id === meta.id));
}

/* ---------- opponents you have played more than once ---------- */

function rivals() {
  const by = {};
  for (const h of S.hist) {
    if (!h.opp) continue;
    const k = h.opp.toLowerCase(), o = by[k] || (by[k] = { name: h.opp, n: 0, w: 0, d: 0, l: 0, last: 0 });
    o.n++; o[h.res === 'win' ? 'w' : h.res === 'draw' ? 'd' : 'l']++;
    if (h.end >= o.last) { o.last = h.end; o.name = h.opp; o.rating = h.o || o.rating; }
  }
  return Object.values(by).filter(o => o.n > 1).sort((a, b) => b.n - a.n || b.last - a.last);
}
function rivalsHTML() {
  if (!S.hist.length) return '';
  const list = rivals(), missing = S.hist.some(h => h.opp === undefined);
  if (!list.length) return '<h3>Opponents you have played more than once</h3><div class="card"><p class="muted">' + (missing ? 'Your history is still being read again with opponents’ names. Check back after the next load.' : 'None yet: every opponent so far, you have played only once.') + '</p></div>';
  const games = list.reduce((a, o) => a + o.n, 0), w = list.reduce((a, o) => a + o.w, 0), d = list.reduce((a, o) => a + o.d, 0), l = list.reduce((a, o) => a + o.l, 0);
  const show = S.rivAll ? list : list.slice(0, 15), yr = t => new Date(t).getFullYear() !== new Date().getFullYear();
  return '<h3>Opponents you have played more than once</h3><div class="card"><p>' + list.length + ' opponent' + (list.length === 1 ? '' : 's') + ', ' + games + ' games: ' + w + 'W ' + d + 'D ' + l + 'L against them, out of ' + S.hist.length + ' games in your whole history.</p>' +
    '<table class="riv"><tr><th>Opponent</th><th>Games</th><th>Record</th><th>Score</th><th>Last</th><th></th></tr>' +
    show.map(o => '<tr><td>' + esc(o.name) + (o.rating ? ' <span class="muted">' + o.rating + '</span>' : '') + '</td><td>' + o.n + '</td><td>' + o.w + '-' + o.d + '-' + o.l + '</td><td class="' + (T.score(o) > 50 ? 'up' : T.score(o) < 50 ? 'down' : '') + '">' + T.score(o) + '%</td><td>' +
      new Date(o.last).toLocaleDateString([], yr(o.last) ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' }) + '</td><td><button class="link" data-act="rivScout" data-v="' + esc(o.name) + '">Scout</button></td></tr>').join('') + '</table>' +
    (list.length > 15 ? '<div class="row"><button class="link" data-act="rivAll">' + (S.rivAll ? 'Show the top 15' : 'Show all ' + list.length) + '</button></div>' : '') +
    '<p class="muted">Record is wins-draws-losses, all time controls. Rated and unrated games both count.</p></div>';
}

/* ---------- scouting an opponent ---------- */

async function scoutGo(name) {
  name = name.trim(); if (!name) return;
  S.scout = { user: name, busy: true }; renderPanel();
  try {
    const base = 'https://api.chess.com/pub/player/' + encodeURIComponent(name.toLowerCase());
    const months = ((await getJSON(base + '/games/archives', name)).archives || []).slice(-4).reverse(), hist = [];
    for (const m of months) {
      const d = await getJSON(m, name);
      for (const g of (d.games || []).reverse()) { if ((g.rules && g.rules !== 'chess') || !g.pgn) continue; const h = T.histRecord(g, name, S.book.names); if (h) hist.push(h); }
      if (hist.length >= 300) break;
    }
    if (S.scout && S.scout.user === name) S.scout = { user: name, hist };
  } catch (e) { S.scout = { user: name, error: e.message }; }
  if (S.tab === 'trainer' && !S.train) renderPanel();
}
function scoutHTML() {
  const sc = S.scout;
  let h = '<div class="card"><p>Look up how any chess.com player opens before you face them: what they play, where they score worst, and a board where their own moves answer yours.</p>' +
    '<div class="row"><label class="grow">Their chess.com username<input id="scoutUser" value="' + esc(sc ? sc.user : '') + '" autocomplete="off" spellcheck="false" autocapitalize="off"></label><button class="btn" data-act="scoutGo">Scout</button></div></div>';
  if (!sc) return h;
  if (sc.busy) return h + '<p class="empty">Reading ' + esc(sc.user) + '’s recent games…</p>';
  if (sc.error) return h + '<p class="empty">' + esc(sc.error) + '</p>';
  if (!sc.hist.length) return h + '<p class="empty">' + esc(sc.user) + ' has no recent standard games.</p>';
  const tot = { n: 0, w: 0, d: 0, l: 0 }, last = {};
  sc.hist.forEach(x => { tot.n++; tot[x.res === 'win' ? 'w' : x.res === 'draw' ? 'd' : 'l']++; if (x.rated && x.r && !last[x.tc]) last[x.tc] = x.r; });
  h += '<div class="card"><div class="lbl">' + sc.hist.length + ' recent games</div><h3 class="big">' + esc(sc.user) + '</h3><p>' + Object.keys(last).map(k => k + ' ' + last[k]).join(' · ') + '</p>' +
    '<div class="orow"><span>All games</span>' + wldBar(tot) + '<span class="muted">' + T.score(tot) + '%</span></div>' +
    '<div class="row"><button class="btn" data-act="scPlay" data-side="b">Play them as White</button><button class="btn ghost" data-act="scPlay" data-side="w">Play them as Black</button></div></div>';
  const tw = T.buildTree(sc.hist, 'w', ''), tb = T.buildTree(sc.hist, 'b', '');
  const moveRows = (node, ply) => { const ks = T.kids(node), t = ks.reduce((a, k) => a + k.n, 0); return ks.slice(0, 5).map(k => '<div class="orow"><span>' + esc(T.movesText([k.san], ply)) + ' <span class="muted">' + Math.round(100 * k.n / t) + '% of games</span></span>' + wldBar(k.node) + '<span class="muted">' + T.score(k.node) + '%</span></div>').join(''); };
  if (tw.n) h += '<h3>As White they open with</h3><div class="card">' + moveRows(tw, 0) + '</div>';
  for (const first of T.kids(tb).slice(0, 2)) h += '<h3>As Black against 1.' + esc(first.san) + ' they answer</h3><div class="card">' + moveRows(first.node, 1) + '</div>';
  for (const side of ['w', 'b']) {
    const lines = T.commonLines(side === 'w' ? tw : tb, 30), o = { act: 'scFrom', side, they: true };
    const weak = lines.filter(l => l.n >= 3 && T.score(l) < 50).sort((a, b) => T.score(a) - T.score(b)).slice(0, 3);
    if (weak.length) h += '<h3>Aim for these when they are ' + (side === 'w' ? 'White' : 'Black') + '</h3>' + weak.map(l => lineRow(l, o)).join('');
    if (lines.length) h += '<h3>Their main lines as ' + (side === 'w' ? 'White' : 'Black') + '</h3>' + lines.slice(0, 4).map(l => lineRow(l, o)).join('');
  }
  return h + '<p class="muted">The percentages are ' + esc(sc.user) + '’s own score. “Play it” puts you on the other side of that line.</p>';
}
const scoutSpar = (theirSide, sans) => startSpar(theirSide === 'w' ? 'b' : 'w', sans, { tree: T.buildTree(S.scout.hist, theirSide, ''), who: S.scout.user });

/* ---------- repertoire ---------- */

const inRep = k => S.rep.list.some(r => r.name === k.name && r.side === k.side);
function saveRep() { S.rep.t = Date.now(); store.set({ rep: S.rep }); touchSync(); }
function repHTML() {
  if (!S.rep.list.length) return '<div class="card"><p>Your repertoire is the set of openings you mean to play. Open any opening under <b>Openings</b> and press “Add to my repertoire”. Blunder Lab then checks every game and shows the move where you left your own lines.</p><div class="row"><button class="btn" data-act="trSub" data-v="open">Choose openings</button></div></div>';
  const C = T.repCheck(S.hist, S.rep.list);
  let h = '<h3>Your lines</h3>' + C.lines.map((l, i) => '<div class="lrow"><div class="lmain"><b><span class="dot ' + l.side + '"></span>' + esc(l.name) + '</b><span class="muted">' + esc(T.movesText(l.line)) + '</span>' +
    '<span class="muted lnote">' + (l.kept + l.slips ? 'Followed in ' + l.kept + ' game' + (l.kept === 1 ? '' : 's') + ', left in ' + l.slips : 'Not reached in your games yet') + '</span></div>' +
    '<div class="lbtns"><button class="btn small ghost" data-act="repDrill" data-i="' + i + '">Drill</button><button class="link" data-act="repDel" data-i="' + i + '">Remove</button></div></div>').join('');
  h += '<h3>Where you left your repertoire</h3>';
  if (!C.slips.length) return h + '<p class="muted">No slips found in your loaded games. Either you know your lines, or your opponents left them first.</p>';
  return h + C.slips.slice(0, 15).map(s => '<div class="lrow"><div class="lmain"><b>' + esc(when(s.end)) + ' · ' + esc(s.name) + '</b>' +
    '<span class="lnote">Move ' + (Math.floor(s.ply / 2) + 1) + ': you played <b>' + esc(s.played) + '</b>; your repertoire says <b>' + esc(s.want.join(' or ')) + '</b>.</span></div>' +
    '<div class="lbtns"><button class="btn small ghost" data-act="repDrill" data-i="' + s.idx + '">Practise</button>' + (S.games.some(g => g.id === s.id) ? '<button class="link" data-act="repGame" data-id="' + esc(s.id) + '" data-ply="' + (s.ply + 1) + '">Open game</button>' : '') + '</div></div>').join('') +
    (C.slips.length > 15 ? '<p class="muted">' + (C.slips.length - 15) + ' older slips not shown.</p>' : '');
}

/* ---------- endgame practice ---------- */

const endCache = new Map();
function endList() {
  for (const g of S.games) { const rv = S.reviews[g.id]; if (!rv || endCache.has(g.id)) continue; let e = null; try { e = R.endgameOf(g, rv); } catch (err) { /* skip a game that cannot be read */ } endCache.set(g.id, e); }
  return [...endCache.values()].filter(Boolean).sort((a, b) => (b.failed ? 1 : 0) - (a.failed ? 1 : 0) || b.end - a.end);
}
function endHTML() {
  const list = endList();
  if (!list.length) return '<div class="card"><p>Endgames from your own reviewed games show up here: positions you were winning, or that were level, when the endgame began. You play them out against Stockfish to see if you can finish the job.</p><p class="muted">None yet. Review more games; only games that reached an endgame count.</p></div>';
  const lost = list.filter(e => e.failed).length;
  return '<div class="card"><p>' + list.length + ' endgames from your reviewed games. ' + (lost ? 'In ' + lost + ' of them you let the result slip; those come first.' : 'You got the result you should have in all of them.') + ' Stockfish defends at full strength, so converting here is harder than in the real game.</p></div>' +
    list.slice(0, 30).map(e => { const p = S.endProg[e.id]; return '<div class="lrow"><div class="lmain"><b>' + (e.goal === 'win' ? 'Win this' : 'Hold this') + ' <span class="muted">' + esc(e.score) + '</span></b>' +
      '<span class="lnote">vs ' + esc(e.opponent || '?') + ' · ' + esc(when(e.end)) + ' · in the game you ' + (e.result === 'win' ? 'won' : e.result === 'draw' ? 'drew' : 'lost') + (e.failed ? ' <b class="down">✗</b>' : '') + '</span>' +
      (p ? '<span class="muted lnote">Practised ' + p.n + ' time' + (p.n === 1 ? '' : 's') + ', goal reached ' + p.ok + '</span>' : '') + '</div>' +
      '<button class="btn small ghost" data-act="endPlay" data-id="' + esc(e.id) + '">Play it out</button></div>'; }).join('');
}

/* ---------- actions ---------- */

function go(ply) { if (!S.cur || S.puzzle || S.train) return; S.line = null; S.ply = Math.max(0, Math.min(S.cur.game.plies.length, ply)); moved(); }
function enterLine(base, pv, label, step) {
  const moves = R.lineToSan(base, pv, 16);
  if (!moves.length) return;
  S.line = { base, moves, step: Math.min(step || 1, moves.length), label };
  moved();
}
function exitLine() { S.line = null; moved(); if (S.puzzle || S.train) renderPanel(); }
function nav(k) {
  if (k === 'flip') { S.flipped = !S.flipped; renderWho(); renderBoard(); renderBar(); return; }
  if (S.line) {
    const L = S.line;
    L.step = k === 'prev' ? Math.max(0, L.step - 1) : k === 'next' ? Math.min(L.moves.length, L.step + 1) : k === 'start' ? 0 : L.moves.length;
    moved(); return;
  }
  if (!S.cur || S.puzzle || S.train) return;
  go(k === 'prev' ? S.ply - 1 : k === 'next' ? S.ply + 1 : k === 'start' ? 0 : S.cur.game.plies.length);
}

function startPuzzle(p) {
  engines();
  S.train = null; S.line = null; S.tab = 'puzzles';
  S.puzzle = { p, state: 'ask', first: true, fen: p.fen, last: null };
  S.flipped = p.color === 'b';
  render();
}
function answerText(p) { const l = R.lineToSan(p.fen, p.pv, 6); return l.length ? 'Best is ' + l[0].san + (l.length > 1 ? ', and play might go ' + l.slice(1, 5).map(m => m.san).join(' ') : '') + '.' : ''; }
/* Once a puzzle is over, the engine's three best lines from the puzzle position (and your move's line, if it was a
   different good move), each one playable move by move on the board. Its own engine, so nothing else cuts it short. */
let altE = null;
async function loadAlts(z) {
  if (z.alts) return;
  z.alts = 'wait';
  if (!altE) altE = Engine.worker(ENGINE);
  let lines = [];
  try { lines = (await altE.analyse(z.p.fen, { depth: 16, multipv: 3, movetime: 4000 })).lines.filter(l => l.pv && l.pv.length); } catch (e) { /* show the stored answer below */ }
  if (!lines.length && z.p.pv && z.p.pv.length) lines = [{ pv: z.p.pv }];
  if (z.mine && !lines.some(l => l.pv[0] === z.mine.pv[0])) lines.push(z.mine);
  z.alts = lines;
  if (S.puzzle === z && S.tab === 'puzzles') renderPanel();
}
function altsHTML(z) {
  if (!z.alts || z.alts === 'wait') return '<p class="muted">Working out the other lines from this position…</p>';
  const fen = z.p.fen, parts = fen.split(' '), from = (+parts[5] - 1) * 2 + (parts[1] === 'b' ? 1 : 0), mine = z.mine ? z.mine.pv[0] : z.played;
  return '<h3>Lines from this position</h3>' + z.alts.map((l, i) => {
    const mv = R.lineToSan(fen, l.pv, 12);
    if (!mv.length) return '';
    const t = l.cp != null || l.mate != null ? R.scoreText(l, wtm(fen)) : '', tags = [i === 0 && t ? 'best' : '', l.pv[0] === mine ? 'your move' : ''].filter(Boolean).join(' · ');
    return '<div class="lrow alt"><div class="lmain"><b>' + esc(mv[0].san) + (tags ? ' <span class="muted">' + tags + '</span>' : '') + (t ? ' <span class="ev ' + (/^-|^0-1/.test(t) ? 'neg' : 'pos') + '">' + t + '</span>' : '') + '</b>' +
      '<span class="muted">' + esc(T.movesText(mv.map(m => m.san), from)) + '</span></div><button class="btn small ghost" data-act="pzAlt" data-i="' + i + '">Play it</button></div>';
  }).join('') + '<p class="muted">“Play it” puts the line on the board: step through it with ← → or the buttons under the board.</p>';
}
async function puzzleDone(correct, note) {
  const z = S.puzzle;
  loadAlts(z);
  z.clean = correct && z.first;
  if (z.first) { z.first = false; await gradeNow(z.p, correct); }
  z.state = correct ? 'right' : 'shown'; z.note = note;
  render();
}
async function tryPuzzle(from, to) {
  const z = S.puzzle, p = z.p, c = new Chess(p.fen);
  const piece = c.get(from), promo = piece && piece.type === 'p' && /[18]$/.test(to);
  let uci = from + to + (promo ? 'q' : '');
  const exact = p.answers.find(a => a.slice(0, 4) === from + to);
  if (exact) uci = exact;
  let m;
  try { m = c.move({ from, to, promotion: uci.slice(4) || undefined }); } catch (e) { renderBoard(); return; }
  if (p.answers.includes(uci)) { z.fen = m.after; z.last = [from, to]; z.played = uci; return puzzleDone(true, m.san + ' is right. ' + answerText(p)); }
  // not the engine's first choice: check whether it is about as good before calling it wrong
  z.fen = m.after; z.last = [from, to]; renderBoard();
  const over = R.terminalScore(m.after);
  const res = over ? { lines: [over] } : await live.analyse(m.after, { depth: 12, multipv: 1, movetime: 2500 });
  if (S.puzzle !== z) return;
  const mine = res.lines[0] ? 1 - R.expPts(res.lines[0]) : 0;
  if ((p.e != null ? p.e : 1) - mine < 0.04) { // your own good move gets its line too, scored for you
    const r0 = res.lines[0] || {}, sc = r0.mate != null ? { mate: r0.mate === 0 ? 0 : -r0.mate } : r0.cp != null ? { cp: -r0.cp } : {};
    z.mine = Object.assign({ pv: [uci].concat(r0.pv || []) }, sc);
    return puzzleDone(true, m.san + ' is also strong. ' + answerText(p));
  }
  if (z.first) { z.first = false; await gradeNow(p, false); }
  z.state = 'wrong'; z.tried = uci; z.fen = p.fen; z.last = null;
  z.note = (uci === (R.lineToSan(p.fen, [uci])[0] || {}).uci && m.san === p.played ? m.san + ' is what you played in the game.' : m.san + ' gives up about ' + Math.max(1, Math.round(((p.e != null ? p.e : 1) - mine) * 100)) + '% of your winning chances.');
  render();
}

document.addEventListener('click', async e => {
  const t = e.target;
  const tab = t.closest('#tabs button');
  if (tab) {
    S.tab = tab.dataset.tab;
    let reset = false;
    if (S.tab !== 'puzzles') stopMaking();
    if (S.tab !== 'puzzles' && S.puzzle) { S.puzzle = null; reset = true; }
    if (S.tab !== 'trainer' && S.train) { S.train = null; reset = true; }
    if (reset) { S.line = null; if (S.cur) S.flipped = S.cur.meta.color === 'b'; render(); } else renderPanel();
    if (S.tab === 'trainer' && !openList) loadOpenings().then(() => { if (S.tab === 'trainer' && !S.train) softTrainer(); });
    return;
  }
  const nv = t.closest('[data-nav]'); if (nv) { nav(nv.dataset.nav); return; }
  const lm = t.closest('#lines .lm, #lines .line');
  if (lm && !S.line) { const v = shown(), l = S.live.lines[+lm.dataset.line]; if (l) enterLine(v.fen, l.pv, 'Engine line ' + (+lm.dataset.line + 1) + ' (' + R.scoreText(l, wtm(v.fen)) + ')', +lm.dataset.step || 1); return; }
  if (lm && S.line && lm.dataset.step) { S.line.step = +lm.dataset.step; moved(); return; }
  const mv = t.closest('.mv'); if (mv) { go(+mv.dataset.ply); return; }
  const gm = t.closest('.game'); if (gm) { const m = S.games.find(g => g.id === gm.dataset.game); if (m) openGame(m); return; }
  const gq = t.closest('#graph, #clock');
  if (gq && S.cur && S.cur.rv) { const r = gq.getBoundingClientRect(); go(Math.round((e.clientX - r.left) / r.width * (S.cur.rv.evals.length - 1))); return; }
  const op = t.closest('[data-open]'); if (op) { await loadOpenings(); const l = openMap.get(op.dataset.open); if (l) openCourse(op.dataset.open, l, op.dataset.side); return; }
  const co = t.closest('[data-core]'); if (co) { const k = CORE[+co.dataset.core]; openCourse(k.name, k.line, k.side); return; }
  const a = t.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'load') { S.error = ''; S.busy = { text: 'Loading your games from chess.com', done: 0, total: 1 }; renderStatus(); let fresh = []; try { fresh = await syncGames('full'); } catch (err) { S.error = err.message; } S.busy = null; render(); fresh = fresh.filter(g => !S.reviews[g.id]); if (fresh.length && S.settings.auto !== false) reviewMany(fresh, true); }
  else if (act === 'gcat') { S.gcat = a.dataset.v; renderPanel(); }
  else if (act === 'batch') { const list = S.games.filter(g => !S.reviews[g.id] && (!S.gcat || gcat(g) === S.gcat)); if (list.length && !S.busy) reviewMany(list); }
  else if (act === 'openNotice') { const m = S.games.find(g => g.id === S.notice.id); S.notice = null; if (m) openGame(m); else renderStatus(); }
  else if (act === 'clearNotice') { S.notice = null; renderStatus(); }
  else if (act === 'cancel') { cancelBatch = true; if (bg) bg.stop(); }
  else if (act === 'clearError') { S.error = ''; renderStatus(); }
  else if (act === 'paste') { $('#pasteBox').hidden = !$('#pasteBox').hidden; }
  else if (act === 'addLink') { $('#linkBox').hidden = !$('#linkBox').hidden; if (!$('#linkBox').hidden) $('#gameLink').focus(); }
  else if (act === 'addLinkGo') addByLink($('#gameLink').value);
  else if (act === 'pasteGo') {
    let pgn = R.cleanPgn($('#pgn').value.trim()), color = $('#pasteColor').value;
    let game; try { game = R.readGame(pgn); if (!game.plies.length) throw new Error('empty'); } catch (err) { S.error = 'No moves could be read from that. Paste the game’s PGN, or its move list, from chess.com.'; renderStatus(); return; }
    const bot = $('#pasteKind').value === 'computer';
    if (bot) { // a game against a computer: your name on the side you picked, the bot's on the other, with the ratings and date you entered
      const me = S.settings.user.trim() || 'You', bn = canonBot($('#botName').value.trim()) || 'Computer', be = Math.round(+$('#botElo').value) || '', mine = Math.round(+$('#myElo').value) || '', d = $('#gameDate').value;
      const w = color === 'w', h = { White: w ? me : bn, Black: w ? bn : me, WhiteElo: String(w ? mine : be), BlackElo: String(w ? be : mine) };
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { h.Date = d.replace(/-/g, '.'); h.UTCDate = h.Date; }
      pgn = setHeaders(pgn, h);
      game = R.readGame(pgn);
    }
    const hd = game.headers, me = S.settings.user.trim().toLowerCase(), side = bot ? color : me && (hd.White || '').toLowerCase() === me ? 'w' : me && (hd.Black || '').toLowerCase() === me ? 'b' : color; // your own name in the PGN decides the colour
    const day = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(hd.UTCDate || hd.Date || ''), tm = /^(\d{2}):(\d{2})/.exec(hd.EndTime || hd.UTCTime || '');
    const end = day ? (tm ? Date.UTC(+day[1], +day[2] - 1, +day[3], +tm[1], +tm[2]) : new Date(+day[1], +day[2] - 1, +day[3], 12).getTime()) : Date.now();
    const meta = { id: 'p' + Date.now().toString(36), pasted: true, url: '', pgn, white: hd.White || 'White', black: hd.Black || 'Black', wr: hd.WhiteElo || '', br: hd.BlackElo || '', color: side,
      result: hd.Result === '1/2-1/2' ? 'draw' : (hd.Result === '1-0') === (side === 'w') ? 'win' : 'loss', opponent: side === 'w' ? hd.Black || 'Black' : hd.White || 'White', timeClass: '', end: Math.min(end, Date.now()), opening: game.v960 ? 'Chess960' : '',
      v960: !!game.v960, computer: $('#pasteKind').value === 'computer' };
    if (!game.v960) for (const p of game.plies.slice(0, 40)) { const n = S.book.names[R.bookKey(p.after)]; if (n) meta.opening = n; }
    S.games.unshift(meta); S.games.sort((a, b) => b.end - a.end); await store.set({ games: S.games }); $('#pasteBox').hidden = true; openGame(meta);
  }
  else if (act === 'exitLine') exitLine();
  else if (act === 'lineBest' || act === 'lineNext') {
    const { game, rv } = S.cur, p = game.plies[S.ply - 1], best = act === 'lineBest';
    const ev = rv.evals[best ? S.ply - 1 : S.ply], base = best ? p.before : p.after;
    enterLine(base, ev.lines[0].pv, best ? 'Best line instead of ' + p.san : 'After ' + p.san, 1);
  }
  else if (act === 'pzNext' && S.puzzle && S.puzzle.daily) dailyNext(S.puzzle.dTheme, S.puzzle.retry);
  else if (act === 'pzStart' || act === 'pzNext') nextPuzzle();
  else if (act === 'dailyStart') { stopMaking(); dailyNext(a.dataset.v, false); }
  else if (act === 'dailyRetry') { stopMaking(); dailyNext('', true); }
  else if (act === 'pzShow') puzzleDone(false, answerText(S.puzzle.p));
  else if (act === 'pzLine') enterLine(S.puzzle.p.fen, S.puzzle.p.pv, 'The answer', 1);
  else if (act === 'pzAlt' && S.puzzle && Array.isArray(S.puzzle.alts)) { const z = S.puzzle, l = z.alts[+a.dataset.i], fen = z.p.fen; if (l) { const first = (R.lineToSan(fen, [l.pv[0]])[0] || {}).san || ''; enterLine(fen, l.pv, (l.pv[0] === (z.mine ? z.mine.pv[0] : z.played) ? 'Your move, ' : 'Line ' + (+a.dataset.i + 1) + ', ') + first + (l.cp != null || l.mate != null ? ' (' + R.scoreText(l, wtm(fen)) + ')' : ''), 1); renderPanel(); } }
  else if (act === 'pzQuit') { stopMaking(); S.puzzle = null; S.line = null; if (S.cur) S.flipped = S.cur.meta.color === 'b'; render(); }
  else if (act === 'pzTheme') { stopMaking(); S.pzMsg = ''; S.pzTheme = a.dataset.v; renderPanel(); }
  else if (act === 'syncOn') { const t = ($('#syncTok').value || '').trim(); if (!t) return; S.sync.token = t; S.sync.gist = ''; await store.set({ syncToken: t, syncGist: '' }); paintSync(); syncNow(); }
  else if (act === 'syncGo') syncNow();
  else if (act === 'syncOff') { S.sync.token = ''; S.sync.gist = ''; S.sync.last = 0; S.sync.error = ''; gist = null; await store.set({ syncToken: '', syncGist: '' }); paintSync(); }
  else if (act === 'scoutGo') scoutGo($('#scoutUser').value);
  else if (act === 'rivAll') { S.rivAll = !S.rivAll; renderPanel(); }
  else if (act === 'rivScout') { S.tab = 'trainer'; S.tr.sub = 'scout'; render(); scoutGo(a.dataset.v); }
  else if (act === 'scPlay') scoutSpar(a.dataset.side, []);
  else if (act === 'scFrom') scoutSpar(a.dataset.side, a.dataset.line.split(' '));
  else if (act === 'trRep') { const k = S.tr.course, i = S.rep.list.findIndex(r => r.name === k.name && r.side === k.side); if (i >= 0) S.rep.list.splice(i, 1); else S.rep.list.push({ name: k.name, side: k.side, line: k.line }); saveRep(); renderPanel(); }
  else if (act === 'repDel') { S.rep.list.splice(+a.dataset.i, 1); saveRep(); renderPanel(); }
  else if (act === 'repDrill') { const r = S.rep.list[+a.dataset.i]; if (r) { S.tr.course = { name: r.name, line: r.line, side: r.side, idea: ideaFor(r.name) }; startCourse('test'); } }
  else if (act === 'repGame') { const m = S.games.find(g => g.id === a.dataset.id); if (m) openGame(m, +a.dataset.ply); }
  else if (act === 'endPlay') { const e = endCache.get(a.dataset.id); if (e) startSpar(e.color, [], { fen: e.fen, end: e, strong: true }); }
  else if (act === 'ccRead' && S.cur) {
    const rv0 = S.cur.rv, mv = rv0 && rv0.colors ? { w: rv0.colors.filter(c => c === 'w').length, b: rv0.colors.filter(c => c === 'b').length } : null;
    const P = R.parseReview($('#ccPaste').value, { moves: mv, elo: { w: S.cur.meta.wr, b: S.cur.meta.br } }), id = S.cur.meta.id, o = Object.assign({}, S.calib[id] || {}), got = [];
    if (P.acc) { o.aw = P.acc[0]; o.ab = P.acc[1]; got.push('accuracy'); }
    if (P.gr) { o.w = P.gr[0]; o.b = P.gr[1]; got.push('game rating'); }
    const ks = Object.keys(P.counts);
    if (ks.length) { o.cw = {}; o.cb = {}; ks.forEach(k => { o.cw[k] = P.counts[k][0]; o.cb[k] = P.counts[k][1]; }); got.push(ks.length + ' move count' + (ks.length === 1 ? '' : 's')); }
    S.ccMsg = got.length ? 'Read ' + got.join(', ') + '. The first number of each pair is taken as White: if that is the wrong way round, press Swap.' : 'No numbers found. Copy the whole summary from chess.com’s Game Review (accuracy, game rating and the move counts), or type them into the table.';
    if (got.length) saveCalib(id, o); else renderPanel();
  }
  else if (act === 'ccSwap' && S.cur) { const id = S.cur.meta.id, o = Object.assign({}, S.calib[id] || {}), sw = (a, b) => { const x = o[a]; o[a] = o[b]; o[b] = x; if (o[a] == null) delete o[a]; if (o[b] == null) delete o[b]; }; sw('aw', 'ab'); sw('w', 'b'); sw('cw', 'cb'); S.ccMsg = ''; saveCalib(id, o); }
  else if (act === 'ccClear' && S.cur) { S.ccMsg = ''; saveCalib(S.cur.meta.id, null); }
  else if (act === 'tgAdd') {
    const link = $('#tgLink').value, m = /game\/(?:(live|daily)\/)?(\d+)/.exec(link) || /^\s*(\d{3,})\s*$/.exec(link), u = ($('#tgUser').value || '').trim() || (/[?&]username=([^&#\s]+)/.exec(link) || [])[1] || '';
    if (/game\/computer\//.test(link)) { S.error = 'chess.com does not share games against its bots. Use “Paste a PGN” below instead.'; renderStatus(); }
    else if (!m) { S.error = 'That does not look like a chess.com game link.'; renderStatus(); }
    else addGameById(m[2] || m[1], m[2] ? m[1] : '', { train: true, user: decodeURIComponent(u) });
  }
  else if (act === 'tgPaste') {
    const pgn = R.cleanPgn($('#tgPgn').value.trim());
    let game; try { game = R.readGame(pgn); if (!game.plies.length) throw new Error('empty'); } catch (err) { S.error = 'No moves could be read from that.'; renderStatus(); return; }
    const hd = game.headers, day = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(hd.UTCDate || hd.Date || ''), res = hd.Result;
    let opening = game.v960 ? 'Chess960' : '';
    if (!game.v960) for (const p of game.plies.slice(0, 40)) { const n = S.book.names[R.bookKey(p.after)]; if (n) opening = n; }
    addTraining({ id: 't:p' + Date.now().toString(36), url: '', pgn, white: hd.White || 'White', black: hd.Black || 'Black', wr: hd.WhiteElo || '', br: hd.BlackElo || '', color: 'w',
      result: res === '1/2-1/2' ? 'draw' : res === '1-0' ? 'win' : 'loss', opponent: hd.Black || 'Black', timeClass: '', end: day ? new Date(+day[1], +day[2] - 1, +day[3], 12).getTime() : Date.now(), opening, v960: !!game.v960 });
  }
  else if (act === 'tgOpen') { const g = findGame(a.dataset.id); if (g) { S.ccOpen = true; openGame(g); } }
  else if (act === 'tgDel') {
    const id = a.dataset.id, i = S.trainGames.findIndex(g => g.id === id);
    if (i >= 0) {
      S.trainGames[i] = { id, removed: true, edited: Date.now() }; delete S.reviews[id];
      if (store.remove) store.remove('rv:' + id);
      if (S.calib[id]) { S.calib[id] = { t: Date.now() }; store.set({ calib: S.calib }); } // an emptied entry, so the removal reaches the other devices too
      S._fit = null; if (S.cur && S.cur.meta.id === id) S.cur = null;
      await store.set({ trainGames: S.trainGames }); touchSync(); applyBands().then(() => renderPanel());
    }
  }
  else if (act === 'pickBot') { const [n, e] = a.dataset.t.split(','); $('#' + n).value = a.dataset.n; if (a.dataset.e) $('#' + e).value = a.dataset.e; }
  else if (act === 'pickMy') { $('#' + a.dataset.t).value = a.dataset.e; }
  else if (act === 'edOpen') { S.editing = S.cur.meta.id; renderPanel(); }
  else if (act === 'edCancel') { S.editing = ''; renderPanel(); }
  else if (act === 'edSave') saveEdit();
  else if (act === 'explain') { S.explain = S.cur.meta.id + ':' + S.ply; renderPanel(); }
  else if (act === 'botStart') { const b = S.tr.bot || { side: 'r' }; startSpar(b.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : b.side, [], { bot: { elo: botElo() } }); }
  else if (act === 'botResign') { const z = S.train; if (z && !z.done && !z.busy) { z.resigned = true; endTrain(z); } }
  else if (act === 'botReview') { const m = S.train && S.train.botMeta; if (m) openGame(m); }
  else if (act === 'drStart') { S.drillMsg = ''; startDrill(); }
  else if (act === 'drSafe' || act === 'drBad') drillAnswer(act === 'drBad');
  else if (act === 'drNext') drillNext();
  else if (act === 'eloTc') { S.eloTc = a.dataset.v; renderPanel(); }
  else if (act === 'eloAll') { S.eloAll = !S.eloAll; renderPanel(); }
  else if (act === 'trSub') { S.tr.sub = a.dataset.v; renderPanel(); }
  else if (act === 'trHome') { S.tr.course = null; renderPanel(); }
  else if (act === 'trSide') { S.tr.course.side = S.tr.course.side === 'w' ? 'b' : 'w'; renderPanel(); }
  else if (act === 'trSpar') startSpar(S.tr.color);
  else if (act === 'trFrom') startSpar(S.tr.color, a.dataset.line.split(' '));
  else if (act === 'trAgain') startSpar(S.train.color, [], S.train.opt);
  else if (act === 'trUndo') { const z = S.train; if (!z.busy) startSpar(z.color, z.sans.slice(0, z.sans.length - (z.c.turn() === z.color && !z.done ? 2 : 1)), z.opt); }
  else if (act === 'trLearn' || act === 'trTest') startCourse(act === 'trLearn' ? 'learn' : 'test');
  else if (act === 'trPlayOn') startSpar(S.tr.course.side, S.tr.course.line);
  else if (act === 'trShow') { const z = S.train; if (z && z.want && myTurn(z)) { z.first = false; z.arrow = { from: z.want.from, to: z.want.to }; z.msg = 'The move is ' + z.want.san + '. ' + T.explainMove(z.want); z.fb = null; z.tried = null; render(); } }
  else if (act === 'trStop') { S.train = null; S.line = null; if (S.cur) S.flipped = S.cur.meta.color === 'b'; render(); }
  else if (act === 'pzGame') { const p = S.puzzle.p, m = S.games.find(g => g.id === p.game); if (m) openGame(m, p.ply + 1); else { S.error = 'That game is no longer in your list.'; renderStatus(); } }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'user') { S.settings.user = t.value.trim(); S.settings.userT = Date.now(); saveSettings(); touchSync(); }
  else if (t.dataset && t.dataset.cc && S.cur) {
    const id = S.cur.meta.id, o = Object.assign({}, S.calib[id] || {}), key = t.dataset.cc, v = +String(t.value).replace(',', '.').replace('%', '');
    const [k1, k2] = key.split('.'), ok = t.value.trim() !== '' && isFinite(v) && (k2 ? v >= 0 && v <= 300 : /^a/.test(key) ? v >= 0 && v <= 100 : v >= 100 && v <= 3500);
    const val = k2 ? Math.round(v) : /^a/.test(key) ? Math.round(v * 10) / 10 : Math.round(v);
    if (k2) { const m = Object.assign({}, o[k1] || {}); if (ok) m[k2] = val; else delete m[k2]; if (Object.keys(m).length) o[k1] = m; else delete o[k1]; }
    else if (ok) o[key] = val; else delete o[key];
    S.ccMsg = ''; saveCalib(id, o);
  }
  else if (t.id === 'depth') { S.settings.depth = t.value; saveSettings(); }
  else if (t.id === 'pasteKind') botPrefill($('#pgn').value);
  else if (t.id === 'edKind') { const p = $('#edPicks'); if (p) p.hidden = t.value !== 'computer'; }
  else if (t.id === 'autoOn') { S.settings.auto = t.checked; saveSettings(); }
  else if (t.id === 'botSide' || t.id === 'botLvl') { (S.tr.bot || (S.tr.bot = { side: 'r', lvl: 0 }))[t.id === 'botSide' ? 'side' : 'lvl'] = t.value; }
  else if (t.id === 'goalRating' || t.id === 'goalPz' || t.id === 'goalRv') {
    const v = Math.max(0, Math.round(+t.value) || 0), k = t.id === 'goalRating' ? 'rating' : t.id === 'goalPz' ? 'pz' : 'rv';
    if (v) S.goals[k] = v; else delete S.goals[k];
    if (k === 'rating') { const ser = T.ratingSeries(S.hist, S.eloTc); S.goals.from = ser.length ? ser[ser.length - 1].r : 0; }
    S.goals.t = Date.now(); store.set({ goals: S.goals }); touchSync(); renderPanel();
  }
  else if (t.id === 'trColor') { S.tr.color = t.value; renderPanel(); }
  else if (t.id === 'trTc') { S.tr.tc = t.value; renderPanel(); }
  if (t.tagName === 'SELECT' || t.type === 'checkbox') t.blur(); // so the arrow keys go back to stepping through moves
});
document.addEventListener('input', e => {
  if (e.target.id === 'botName' || e.target.id === 'edOpp') { // a known bot's name fills in its rating
    const b = botChoices().find(x => x.name.toLowerCase() === e.target.value.trim().toLowerCase()), el = $(e.target.id === 'botName' ? '#botElo' : '#edOppElo');
    if (b && b.elo && el && (e.target.id === 'botName' || ($('#edKind') || {}).value === 'computer')) el.value = b.elo;
  } if (e.target.id === 'pgn' && $('#pasteKind')) { const ev = (/\[Event "([^"]*)"\]/.exec(e.target.value) || [])[1] || ''; if (/computer|bot/i.test(ev)) $('#pasteKind').value = 'computer'; botPrefill(e.target.value); } if (e.target.id === 'opq') { S.tr.q = e.target.value; $('#opres').innerHTML = searchHTML(); } });
for (const ev of ['pointermove', 'pointerdown']) document.addEventListener(ev, e => { if (e.target.closest && e.target.closest('#eloPlot')) eloHover(e); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'gameLink') addByLink(e.target.value); else if (e.key === 'Enter' && e.target.id === 'scoutUser') scoutGo(e.target.value); else if (e.key === 'Enter' && ((e.target.dataset && e.target.dataset.cal) || /^goal/.test(e.target.id))) e.target.blur(); });
function softTrainer() { const a = document.activeElement; if (a && a.id === 'opq') $('#opres').innerHTML = searchHTML(); else renderPanel(); }
document.addEventListener('toggle', e => { const c = e.target.classList; if (!c) return; if (c.contains('cc')) S.ccOpen = e.target.open; else if (c.contains('sum')) S.sumOpen = e.target.open; }, true);
document.addEventListener('keydown', e => {
  const el = e.target, typing = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox'); // only real typing keeps the arrow keys
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el.tagName === 'SELECT') el.blur();
  const k = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'start', ArrowDown: 'end', f: 'flip', F: 'flip' }[e.key];
  if (k) { e.preventDefault(); nav(k); }
  else if (e.key === 'Escape' && S.line) exitLine();
});

/* ---------- start ---------- */

(async function () {
  board = new Board($('#board'), {
    dests: sq => { try { return new Chess(shown().fen).moves({ square: sq, verbose: true }).map(m => m.to); } catch (e) { return []; } },
    onMove: (from, to) => { if (S.line) return; if (S.puzzle) tryPuzzle(from, to); else if (S.train) trainMove(from, to); }
  });
  let sx = 0, sy = 0;
  $('#board').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#board').addEventListener('touchend', e => { // swipe across the board to step through moves, when no piece is being moved
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dy) < 40 && !board.view.movable) nav(dx < 0 ? 'next' : 'prev');
  }, { passive: true });
  document.documentElement.classList.toggle('web', !isExt);
  if (!isExt && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* works without it, just not offline */ }); // keeps the app usable with no connection
  await loadAll();
  await applyBands(); // bands may have been learned on another device
  const want = /#game=(\d+)/.exec(location.hash);
  render();
  // every start: pick up whatever was played since last time, on any device
  let fresh = [];
  S.busy = { text: S.hist.length ? 'Checking chess.com for new games' : 'Loading your games from chess.com (your whole history, first time only)', done: 0, total: 1 }; renderStatus();
  const offline = !isExt && navigator.onLine === false;
  if (offline) S.error = 'You are offline. Puzzles, the trainer and saved reviews still work.';
  else try { fresh = await syncGames('full'); } catch (err) { if (!S.games.length || want) S.error = err.message; }
  S.busy = null; render();
  fresh = fresh.filter(g => !S.reviews[g.id]);
  if (fresh.length && S.settings.auto !== false && !want) reviewMany(fresh, true);
  setInterval(autoSync, 60000);
  (S.sync.token ? syncNow() : Promise.resolve()).then(() => setTimeout(fillDaily, 3000)); // after the first sync, so a set another device already made is used
  setInterval(syncNow, 180000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { autoSync(); syncNow(); fillDaily(); } });
  if (isExt && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener((msg, from, reply) => { if (msg && msg.type === 'blunderlab-ping') { reply({ open: true }); autoSync(); } });
  if (want) addGameById(want[1]);
})();
