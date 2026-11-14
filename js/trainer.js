// Blunder Lab trainer logic: your game history as an opening tree, move explanations, rating projection.
// Pure functions only (no page, no engine), so the same code runs in tests.
import { Chess } from './chess.js';
import { outcome, bookKey } from './review.js';

/* ---------- game history ---------- */

// The first `max` SAN moves of a PGN, without parsing the whole game.
export function pgnSans(pgn, max) {
  if (/\[(SetUp|FEN) "/.test(pgn)) return []; // not from the normal starting position
  const body = pgn.replace(/^\s*\[[^\n]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\$\d+/g, ' ');
  const out = [];
  for (let t of body.split(/\s+/)) {
    t = t.replace(/^\d+\.+/, '');
    if (!t || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// A small record of one chess.com game: enough for the rating chart and the opening tree.
export function histRecord(g, user, names) {
  const me = user.toLowerCase(), black = ((g.black && g.black.username) || '').toLowerCase() === me;
  const mine = black ? g.black : g.white, opp = black ? g.white : g.black;
  if (!mine || !opp) return null;
  const c = new Chess(), ok = [];
  let op = '';
  for (const s of pgnSans(g.pgn || '', 24)) {
    let m;
    try { m = c.move(s); } catch (e) { break; }
    if (!m) break;
    ok.push(m.san);
    const n = names && names[bookKey(m.after)];
    if (n) op = n;
  }
  return { id: String(g.uuid || g.url), end: (g.end_time || 0) * 1000, tc: g.time_class || '', c: black ? 'b' : 'w', res: outcome(mine.result),
    r: mine.rating || 0, o: opp.rating || 0, rated: g.rated !== false, mv: ok.join(' '), op };
}

/* ---------- opening tree of your own games ---------- */

const mk = () => ({ n: 0, w: 0, d: 0, l: 0, kids: {} });
const bump = (n, h) => { n.n++; n[h.res === 'win' ? 'w' : h.res === 'draw' ? 'd' : 'l']++; };
// Every game you played with `color` (and time class tc, if given), merged move by move. w/d/l are your results.
export function buildTree(hist, color, tc) {
  const root = mk();
  for (const h of hist) {
    if (h.c !== color || (tc && h.tc !== tc) || !h.mv) continue;
    let node = root;
    bump(node, h);
    for (const s of h.mv.split(' ')) { node = node.kids[s] || (node.kids[s] = mk()); bump(node, h); }
  }
  return root;
}
export const score = n => (n && n.n ? Math.round(100 * (n.w + n.d / 2) / n.n) : 0);
export const kids = node => Object.keys(node.kids).map(s => ({ san: s, node: node.kids[s], n: node.kids[s].n })).sort((a, b) => b.n - a.n);
export function walk(root, sans) { let n = root; for (const s of sans) { n = n && n.kids[s]; if (!n) return null; } return n; }
// Pick the next move the way your opponents did: in proportion to how often each was played. rnd is 0..1.
export function sample(node, rnd) {
  const ks = kids(node), tot = ks.reduce((a, k) => a + k.n, 0);
  let x = rnd * tot;
  for (const k of ks) { x -= k.n; if (x < 0) return k; }
  return ks[ks.length - 1] || null;
}
// The lines that come up most: the branches of the tree that still hold a fair share of your games.
export function commonLines(root, limit) {
  const thr = Math.max(3, Math.ceil(root.n * 0.04)), out = [];
  (function go(node, sans) {
    const big = sans.length < 14 ? kids(node).filter(k => k.n >= thr) : [];
    if (!big.length) { if (sans.length >= 2) out.push({ sans, n: node.n, w: node.w, d: node.d, l: node.l }); return; }
    for (const k of big) go(k.node, sans.concat(k.san));
  })(root, []);
  return out.sort((a, b) => b.n - a.n).slice(0, limit || 8);
}
// "1.e4 c5 2.Nf3"
export function movesText(sans, from) {
  let h = '';
  sans.forEach((s, i) => { const k = i + (from || 0); h += (k % 2 === 0 ? (k / 2 + 1) + '.' : i === 0 ? ((k + 1) / 2) + '…' : '') + s + ' '; });
  return h.trim();
}

/* ---------- what a move does, in plain words ---------- */

const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// m: a chess.js verbose move.
export function explainMove(m) {
  const home = m.color === 'w' ? '1' : '8', bits = [];
  if (m.san.startsWith('O-O-O')) bits.push('Castles long: the king goes to the queenside and the rook lands on the d-file');
  else if (m.san.startsWith('O-O')) bits.push('Castles: the king gets safe and the rook joins the game');
  else if (m.captured) bits.push((m.piece === 'p' ? 'The pawn takes' : 'The ' + PIECE[m.piece] + ' takes') + ' the ' + PIECE[m.captured] + ' on ' + m.to);
  else if (m.piece === 'p') {
    if (/^[de][45]$/.test(m.to)) bits.push('Puts a pawn in the centre and opens lines for the pieces');
    else if (/^[cf][45]$/.test(m.to)) bits.push('Fights for the centre from the side');
    else if (/^[bg][36]$/.test(m.to)) bits.push('Makes room to put the bishop on the long diagonal');
    else if (/^[ah][36]$/.test(m.to)) bits.push('A small safety move that keeps enemy pieces off ' + (m.to[0] === 'a' ? 'b' : 'g') + (m.color === 'w' ? '4' : '5'));
    else if (/^[de][36]$/.test(m.to)) bits.push('Supports the centre and lets the bishop out');
    else if (/^c[36]$/.test(m.to)) bits.push('Supports a pawn push to d' + (m.color === 'w' ? '4' : '5'));
    else bits.push('Gains space with the ' + m.to[0] + '-pawn');
  } else if (m.piece === 'n' || m.piece === 'b') {
    const first = m.from[1] === home;
    if (m.piece === 'b' && /^[bg][27]$/.test(m.to)) bits.push('Puts the bishop on the long diagonal');
    else if (m.piece === 'n' && first && /^[cf][36]$/.test(m.to)) bits.push('Develops the knight to its best square, eyeing the centre');
    else bits.push((first ? 'Develops the ' : 'Moves the ') + PIECE[m.piece] + ' to ' + m.to);
  } else if (m.piece === 'q') bits.push('Brings the queen to ' + m.to);
  else if (m.piece === 'r') bits.push('Puts the rook on the ' + m.to[0] + '-file');
  else bits.push('Moves the king to ' + m.to);
  // does the piece that moved now attack something worth attacking?
  try {
    const c = new Chess(m.after), opp = m.color === 'w' ? 'b' : 'w';
    let hit = null;
    for (const row of c.board()) for (const p of row) {
      if (!p || p.color !== opp || p.type === 'k' || p.type === 'p') continue;
      if (!c.attackers(p.square, m.color).includes(m.to)) continue;
      const loose = !c.attackers(p.square, opp).length;
      if ((VAL[p.type] > VAL[m.piece] || loose) && (!hit || VAL[p.type] > VAL[hit.type])) hit = p;
    }
    if (hit) bits.push('attacks the ' + PIECE[hit.type] + ' on ' + hit.square);
  } catch (e) { /* explanation only */ }
  return bits.join(', and ') + (m.san.endsWith('+') ? ', with check.' : '.');
}

/* ---------- rating ---------- */

export const ratingSeries = (hist, tc) => hist.filter(h => h.rated && h.tc === tc && h.r > 0).sort((a, b) => a.end - b.end);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const perfFrom = (avgOpp, s) => avgOpp - 400 * Math.log10(1 / clamp(s, 0.08, 0.92) - 1);
/* Where the rating is heading. Takes the last 30 rated games: the results against the opponents' ratings give a
   performance rating (the level you are playing at); the rating then drifts toward it game by game, the way Elo does.
   Returns null with fewer than 8 games. */
export function project(series, ahead) {
  if (series.length < 8) return null;
  const rec = series.slice(-30), cur = series[series.length - 1].r, n = rec.length;
  const w = rec.filter(h => h.res === 'win').length, d = rec.filter(h => h.res === 'draw').length, l = n - w - d;
  const s = (w + d / 2) / n, avgOpp = rec.reduce((a, h) => a + (h.o || h.r), 0) / n;
  const se = Math.sqrt(Math.max(s * (1 - s), 0.05) / n);
  const perf = perfFrom(avgOpp, s), lo = perfFrom(avgOpp, s - se), hi = perfFrom(avgOpp, s + se);
  const steps = [];
  for (let i = 1; i < rec.length; i++) { const x = Math.abs(rec[i].r - rec[i - 1].r); if (x > 0 && x < 60) steps.push(x); }
  const k = clamp(steps.length >= 4 ? 2 * steps.reduce((a, b) => a + b, 0) / steps.length : 16, 8, 40);
  const sim = target => { const path = [cur]; let r = cur; for (let i = 0; i < (ahead || 30); i++) { r += k * (1 / (1 + Math.pow(10, (r - target) / 400)) - 0.5); path.push(r); } return path; };
  const path = sim(perf), pathLo = sim(lo), pathHi = sim(hi), R = Math.round;
  return { cur, games: n, w, d, l, avgOpp: R(avgOpp), perf: R(perf), k: R(k), ahead: ahead || 30,
    path, pathLo, pathHi, proj: R(path[path.length - 1]), projLo: R(pathLo[pathLo.length - 1]), projHi: R(pathHi[pathHi.length - 1]) };
}

/* ---------- repertoire: did you play what you meant to play? ---------- */

/* rep: [{ name, side: 'w' | 'b', line: [san] }]. Walks every game against the lines for that colour.
   A slip is the first move of yours that differs from every repertoire line the game was still following.
   Returns { lines: [{ ...rep, kept, slips }], slips: [{ id, end, ply, played, want: [san], name, idx, op }] } (newest first). */
export function repCheck(hist, rep) {
  const lines = rep.map(r => Object.assign({}, r, { kept: 0, slips: 0 })), slips = [];
  for (const h of hist) {
    if (!h.mv) continue;
    const sans = h.mv.split(' ');
    let cand = lines.map((l, idx) => idx).filter(idx => lines[idx].side === h.c), i = 0, slipped = false;
    for (; i < sans.length && cand.length; i++) {
      const active = cand.filter(idx => lines[idx].line.length > i);
      if (!active.length) break; // the line ran out: you knew it to the end
      const next = active.filter(idx => lines[idx].line[i] === sans[i]);
      if ((i % 2 === 0) === (h.c === 'w') && !next.length) {
        const idx = active[0];
        if (i >= 1 || h.c === 'w') { slips.push({ id: h.id, end: h.end, ply: i, played: sans[i], want: [...new Set(active.map(k => lines[k].line[i]))], name: lines[idx].name, idx, op: h.op }); lines[idx].slips++; }
        slipped = true; break;
      }
      if (!next.length) break; // the opponent went their own way
      cand = next;
    }
    if (!slipped && i >= 2 && cand.length) lines[cand[0]].kept++;
  }
  return { lines, slips: slips.sort((a, b) => b.end - a.end) };
}
