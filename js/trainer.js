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
  const tc = g.rules === 'chess960' ? (g.time_class === 'daily' ? 'daily960' : 'chess960') : g.time_class || ''; // Chess960 has ratings of its own
  return { id: String(g.uuid || g.url), end: (g.end_time || 0) * 1000, tc, c: black ? 'b' : 'w', res: outcome(mine.result),
    r: mine.rating || 0, o: opp.rating || 0, rated: g.rated !== false, mv: ok.join(' '), op, opp: opp.username || '',
    how: (outcome(mine.result) === 'win' ? opp.result : mine.result) || '', len: gameLen(g.pgn || '') };
}
function gameLen(pgn) { // full moves played
  const body = pgn.replace(/^\s*\[[^\n]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ');
  let n = 0;
  for (const m of body.matchAll(/(\d+)\.(?!\.)/g)) n = Math.max(n, +m[1]);
  return n;
}

/* Insights from every game in the history (chess.com games), not only the reviewed ones. Each finding needs enough
   games behind it to mean something; they come ranked by how big the gap is and how many games back it. */
const HOW = { checkmated: 'checkmate', resigned: 'resignation', timeout: 'time', abandoned: 'abandoned', agreed: 'agreement',
  repetition: 'repetition', stalemate: 'stalemate', insufficient: 'insufficient material', timevsinsufficient: 'time vs no mating material', '50move': '50-move rule' };
export function historyInsights(hist, now) {
  now = now || Date.now();
  const L = hist.filter(h => h.res && h.end).slice().sort((a, b) => a.end - b.end);
  const box = () => ({ n: 0, win: 0, draw: 0, loss: 0, exp: 0, en: 0 });
  const add = (b, h) => {
    b.n++; b[h.res]++;
    if (h.r && h.o) { b.exp += 1 / (1 + Math.pow(10, (h.o - h.r) / 400)); b.en++; }
    return b;
  };
  const sc = b => (b.n ? (b.win + b.draw / 2) / b.n : 0), pc = x => Math.round(100 * x);
  const bump = (m, k, h) => add(m[k] || (m[k] = box()), h);
  const out = { total: box(), color: { w: box(), b: box() }, tc: {}, gap: {}, winHow: {}, lossHow: {}, drawHow: {}, tod: {}, day: {}, after: {}, sess: {}, len: {}, op: {}, first: {}, recent: box(), before: box(), streak: { win: 0, loss: 0, cur: 0, curRes: '' }, findings: [] };
  let run = 0, runRes = '', prev = null, inSess = 0;
  for (const h of L) {
    add(out.total, h); add(out.color[h.c] || (out.color[h.c] = box()), h); bump(out.tc, h.tc || 'other', h);
    if (h.r && h.o) bump(out.gap, h.o - h.r >= 100 ? 'higher' : h.r - h.o >= 100 ? 'lower' : 'even', h);
    if (h.how) (h.res === 'win' ? out.winHow : h.res === 'loss' ? out.lossHow : out.drawHow)[h.how] = ((h.res === 'win' ? out.winHow : h.res === 'loss' ? out.lossHow : out.drawHow)[h.how] || 0) + 1;
    const d = new Date(h.end), hr = d.getHours();
    bump(out.tod, hr < 6 ? 'night' : hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening', h);
    bump(out.day, d.getDay(), h);
    const gap = prev ? h.end - prev.end : Infinity;
    if (gap < 60 * 60e3) bump(out.after, prev.res, h); // the next game, played within the hour
    inSess = gap < 45 * 60e3 ? inSess + 1 : 1;
    bump(out.sess, inSess <= 3 ? 'early' : 'late', h);
    if (h.len) bump(out.len, h.len < 25 ? 'short' : h.len <= 40 ? 'medium' : 'long', h);
    if (h.op && !/960/.test(h.tc)) bump(out.op, h.c + '|' + h.op.split(':')[0].trim(), h);
    if (h.c === 'w' && h.mv && !/960/.test(h.tc)) bump(out.first, h.mv.split(' ')[0], h);
    add(now - h.end < 30 * 864e5 ? out.recent : now - h.end < 90 * 864e5 ? out.before : box(), h);
    if (h.res === runRes) run++; else { run = 1; runRes = h.res; }
    if (h.res === 'win') out.streak.win = Math.max(out.streak.win, run);
    if (h.res === 'loss') out.streak.loss = Math.max(out.streak.loss, run);
    prev = h;
  }
  out.streak.cur = run; out.streak.curRes = runRes;
  out.score = sc; out.pc = pc; out.HOW = HOW;
  const F = out.findings, f = (w, title, text) => F.push({ w, title, text });
  const strength = (diff, n) => Math.abs(diff) * Math.sqrt(n);
  // colour
  const W = out.color.w, B = out.color.b;
  if (W.n >= 20 && B.n >= 20 && Math.abs(sc(W) - sc(B)) >= 0.07) {
    const weak = sc(W) < sc(B) ? 'White' : 'Black';
    f(strength(sc(W) - sc(B), Math.min(W.n, B.n)), 'You are weaker with ' + weak, 'You score ' + pc(sc(W)) + '% as White and ' + pc(sc(B)) + '% as Black. Most of the gap is in the first moves: look at your openings with ' + weak + ' first.');
  }
  // time
  const losses = out.total.loss, wins = out.total.win, lt = out.lossHow.timeout || 0, wt = out.winHow.timeout || 0;
  if (losses >= 10 && lt / losses >= 0.25) f(lt / losses * Math.sqrt(losses) * 1.2, 'The clock costs you games', pc(lt / losses) + '% of your losses (' + lt + ' of ' + losses + ') are on time. Play the opening faster and save your thinking for the critical moments.');
  if (wins >= 10 && wt / wins >= 0.25) f(wt / wins * Math.sqrt(wins) * 0.8, 'You win a lot on time', pc(wt / wins) + '% of your wins come on the clock. That works, but at slower time controls you would need to win on the board.');
  const lm = out.lossHow.checkmated || 0;
  if (losses >= 15 && lm / losses >= 0.35) f(lm / losses * Math.sqrt(losses), 'You get checkmated often', pc(lm / losses) + '% of your losses end in checkmate rather than resignation. Before every move, check what checks your opponent has.');
  const ab = out.lossHow.abandoned || 0;
  if (ab >= 3 && ab / Math.max(1, losses) >= 0.05) f(ab / losses * Math.sqrt(losses), 'Games you left', ab + ' losses came from leaving the game. Those are free points given away.');
  // tilt and sessions
  const aw = out.after.win, al = out.after.loss;
  if (aw && al && aw.n >= 15 && al.n >= 15 && sc(aw) - sc(al) >= 0.07) f(strength(sc(aw) - sc(al), Math.min(aw.n, al.n)) * 1.1, 'Losses carry over', 'Right after a loss you score ' + pc(sc(al)) + '% in the next game, against ' + pc(sc(aw)) + '% right after a win. Take a few minutes off after a loss before the next game.');
  const se = out.sess.early, sl = out.sess.late;
  if (se && sl && se.n >= 20 && sl.n >= 20 && Math.abs(sc(se) - sc(sl)) >= 0.06) f(strength(sc(se) - sc(sl), Math.min(se.n, sl.n)), sc(sl) < sc(se) ? 'Long sessions hurt' : 'You warm up', sc(sl) < sc(se) ? 'You score ' + pc(sc(se)) + '% in the first three games of a sitting and ' + pc(sc(sl)) + '% after that. Stop after three or four games.' : 'You score ' + pc(sc(sl)) + '% from the fourth game of a sitting on, against ' + pc(sc(se)) + '% in the first three. A puzzle or two before playing may help.');
  // time of day
  const tods = Object.entries(out.tod).filter(([, b]) => b.n >= 15).sort((a, b) => sc(b[1]) - sc(a[1]));
  if (tods.length >= 2 && sc(tods[0][1]) - sc(tods[tods.length - 1][1]) >= 0.1) { const [bk, bb] = tods[0], [wk, wb] = tods[tods.length - 1]; f(strength(sc(bb) - sc(wb), Math.min(bb.n, wb.n)) * 0.8, 'Your best time to play', 'You score ' + pc(sc(bb)) + '% in the ' + bk + ' and ' + pc(sc(wb)) + '% in the ' + wk + '. Play rated games when you are sharpest.'); }
  // rating gap
  const lo = out.gap.lower, hi = out.gap.higher;
  if (lo && lo.en >= 15 && lo.exp / lo.en - sc(lo) >= 0.06) f(strength(lo.exp / lo.en - sc(lo), lo.n), 'Points dropped to lower-rated players', 'Against players 100+ below you, you score ' + pc(sc(lo)) + '% where the ratings say ' + pc(lo.exp / lo.en) + '%. Take them seriously: most of those losses are one careless move.');
  if (hi && hi.en >= 15 && sc(hi) - hi.exp / hi.en >= 0.06) f(strength(sc(hi) - hi.exp / hi.en, hi.n) * 0.7, 'You play up to stronger players', 'Against players 100+ above you, you score ' + pc(sc(hi)) + '% where the ratings say ' + pc(hi.exp / hi.en) + '%.');
  // openings
  const ops = Object.entries(out.op).filter(([, b]) => b.n >= 8);
  const worst = ops.slice().sort((a, b) => sc(a[1]) - sc(b[1]))[0], best = ops.slice().sort((a, b) => sc(b[1]) - sc(a[1]))[0];
  const opName = k => k.split('|')[1] + ' as ' + (k[0] === 'w' ? 'White' : 'Black');
  if (worst && sc(worst[1]) <= sc(out.total) - 0.1) f(strength(sc(out.total) - sc(worst[1]), worst[1].n), 'Your problem opening', opName(worst[0]) + ': ' + pc(sc(worst[1])) + '% over ' + worst[1].n + ' games, against ' + pc(sc(out.total)) + '% overall. Drill it in the Trainer or steer away from it.');
  if (best && best !== worst && sc(best[1]) >= sc(out.total) + 0.1) f(strength(sc(best[1]) - sc(out.total), best[1].n) * 0.6, 'Your best opening', opName(best[0]) + ': ' + pc(sc(best[1])) + '% over ' + best[1].n + ' games. Aim for it when you can.');
  // length
  const sh = out.len.short, lg = out.len.long;
  if (sh && sh.n >= 15 && sc(sh) <= sc(out.total) - 0.08) f(strength(sc(out.total) - sc(sh), sh.n), 'Early collapses', 'In games over before move 25 you score ' + pc(sc(sh)) + '%. Short losses usually mean an opening trap or a piece left hanging: the Blunder check drill targets this.');
  if (lg && lg.n >= 15 && sc(lg) <= sc(out.total) - 0.08) f(strength(sc(out.total) - sc(lg), lg.n), 'Long games slip away', 'In games past move 40 you score ' + pc(sc(lg)) + '%. Practise endgames in the Trainer, and keep time for the late part of the game.');
  // trend
  const rc = out.recent, bf = out.before;
  if (rc.n >= 10 && bf.n >= 10 && Math.abs(sc(rc) - sc(bf)) >= 0.07) f(strength(sc(rc) - sc(bf), Math.min(rc.n, bf.n)) * 0.7, sc(rc) > sc(bf) ? 'You are on an upswing' : 'A recent dip', 'Last 30 days: ' + pc(sc(rc)) + '% over ' + rc.n + ' games, against ' + pc(sc(bf)) + '% in the two months before.');
  // time controls
  const tcs = Object.entries(out.tc).filter(([, b]) => b.n >= 20).sort((a, b) => sc(b[1]) - sc(a[1]));
  if (tcs.length >= 2 && sc(tcs[0][1]) - sc(tcs[tcs.length - 1][1]) >= 0.08) f(strength(sc(tcs[0][1]) - sc(tcs[tcs.length - 1][1]), Math.min(tcs[0][1].n, tcs[tcs.length - 1][1].n)) * 0.6, 'Your best time control', 'You score ' + pc(sc(tcs[0][1])) + '% in ' + tcs[0][0] + ' and ' + pc(sc(tcs[tcs.length - 1][1])) + '% in ' + tcs[tcs.length - 1][0] + '.');
  F.sort((a, b) => b.w - a.w);
  return out;
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

/* ---------- head to head ---------- */

// Your earlier games against one opponent, newest first. hist records carry opp (their username).
export function headToHead(hist, name, exceptId) {
  const who = (name || '').toLowerCase(), games = who ? hist.filter(h => h.id !== exceptId && (h.opp || '').toLowerCase() === who).sort((a, b) => b.end - a.end) : [];
  const o = { n: games.length, w: 0, d: 0, l: 0, games };
  games.forEach(h => { o[h.res === 'win' ? 'w' : h.res === 'draw' ? 'd' : 'l']++; });
  return o;
}

/* ---------- why a move was wrong, in words ---------- */

function material(fen, color) {
  let s = 0;
  for (const ch of fen.split(' ')[0]) { const v = VAL[ch.toLowerCase()]; if (v) s += (ch === ch.toUpperCase()) === (color === 'w') ? v : -v; }
  return s;
}
// Plays a line far enough to see what it wins: about six plies, then on to the end of any exchange still going.
function follow(fen, ucis) {
  const c = new Chess(fen), moves = [];
  for (const u of ucis || []) {
    if (moves.length >= 6 && !moves[moves.length - 1].captured) break;
    if (moves.length >= 10) break;
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined }); } catch (e) { break; }
    moves.push(m);
  }
  return { moves, fen: c.fen(), mate: c.isCheckmate() };
}
const worth = d => (d >= 8.5 ? 'a queen' : d >= 4.5 ? 'a rook' : d >= 2.5 ? 'a piece' : d >= 1.5 ? 'two pawns' : 'a pawn');
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
/* p: the ply played (readGame), r: its record (classify), ev / nx: engine results before and after it.
   Returns sentences: what the best move does and wins, then what the played move allows and costs. */
export function explainWhy(p, r, ev, nx) {
  const out = [], me = p.color, base = material(p.before, me), best = ev && ev.lines && ev.lines[0], after = nx && nx.lines && nx.lines[0];
  const from = (+p.before.split(' ')[5] - 1) * 2 + (me === 'b' ? 1 : 0);
  if (best && best.pv && best.pv[0] && best.pv[0] !== p.uci) {
    const L = follow(p.before, best.pv), m0 = L.moves[0];
    if (m0) {
      let s = 'The best move was ' + m0.san + '. ' + explainMove(m0);
      const d = material(L.fen, me) - base, line = movesText(L.moves.map(m => m.san), from);
      if (best.mate > 0) s += ' It forces checkmate in ' + best.mate + (L.moves.length > 1 ? ': ' + line + '.' : '.');
      else if (d >= 1) s += ' After ' + line + ' you come out ' + worth(d) + ' ahead.';
      else if (L.moves.length > 1) s += ' Play could go ' + line + ', and you ' + (r.eBest >= 0.7 ? 'are clearly better.' : r.eBest >= 0.45 ? 'keep a healthy position.' : 'limit the damage.');
      out.push(s);
    }
  } else out.push(p.san + ' was the engine’s first choice, so there was nothing better.');
  if (r.loss >= 0.05 && after && after.pv && after.pv.length) {
    const L = follow(p.after, after.pv), m0 = L.moves[0];
    if (m0) {
      let s = 'Your move ' + p.san + ' allows ' + m0.san + ': ' + lower(explainMove(m0));
      const d = base - material(L.fen, me), line = movesText([p.san].concat(L.moves.map(m => m.san)), from);
      if (after.mate > 0) s += ' Your opponent then has a forced checkmate in ' + after.mate + '.';
      else if (d >= 1) s += ' After ' + line + ' you end up ' + worth(d) + ' down.';
      else s += ' Nothing drops at once, but after ' + line + ' your position is worse: about ' + Math.round(r.loss * 100) + '% of your winning chances are gone.';
      out.push(s);
    }
  }
  if (r.tags && r.tags.some(t => t.startsWith('hung'))) out.push('Habit to build: before letting go of a piece, check what your opponent can capture next.');
  else if (r.tags && r.tags.some(t => t.startsWith('missedCapture') || t === 'missedMate')) out.push('Habit to build: look at every check and every capture you have before choosing a quiet move.');
  return out;
}

/* ---------- opening report card ---------- */

/* One row per opening family and colour, from reviewed games: how long you stay in known theory, how accurate your
   first 12 moves are, and the move where you most often go wrong first. */
export function openingReport(games, reviews) {
  const by = {};
  for (const g of games) {
    const rv = reviews[g.id];
    if (!rv || !rv.colors || g.bot || g.v960 || !g.opening) continue;
    const key = g.color + (g.opening.split(':')[0]), o = by[key] || (by[key] = { name: g.opening.split(':')[0], c: g.color, n: 0, win: 0, book: 0, accSum: 0, accN: 0, slips: {} });
    o.n++; if (g.result === 'win') o.win++;
    let book = 0; while (book < rv.recs.length && rv.recs[book].cls === 'book') book++;
    o.book += book;
    let first = -1;
    rv.recs.forEach((r, i) => {
      if (i >= 24 || rv.colors[i] !== g.color || r.cls === 'book') return;
      o.accSum += Math.max(0, Math.min(100, 103.1668 * Math.exp(-4.354 * r.loss) - 3.1669)); o.accN++;
      if (first < 0 && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(r.cls)) first = i;
    });
    if (first >= 0) { const san = pgnSans(g.pgn, first + 1)[first] || '?', k = first + ' ' + san, s = o.slips[k] || (o.slips[k] = { ply: first, san, n: 0 }); s.n++; }
  }
  return Object.values(by).map(o => {
    const acc = o.accN ? o.accSum / o.accN : null, slip = Object.values(o.slips).sort((a, b) => b.n - a.n || a.ply - b.ply)[0] || null;
    return { name: o.name, c: o.c, n: o.n, win: o.win, book: o.book / o.n / 2, acc, grade: acc == null ? '–' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 70 ? 'C' : acc >= 60 ? 'D' : 'F', slip };
  }).sort((a, b) => b.n - a.n).slice(0, 10);
}

/* ---------- goals: daily activity and streaks ---------- */

export const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// Days in a row, ending today (or yesterday, if today is not done yet), on which act[day][field] reached `need`.
export function streak(act, field, need, now) {
  let n = 0, t = now;
  const ok = k => ((act[k] || {})[field] || 0) >= Math.max(1, need || 1);
  if (!ok(dayKey(t))) t -= 864e5;
  while (ok(dayKey(t))) { n++; t -= 864e5; }
  return n;
}
