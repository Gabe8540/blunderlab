// Blunder Lab review logic: turns engine output into move classifications, accuracy, puzzles and insights.
// Pure functions only (no page, no engine), so the same code runs in tests.
import { Chess } from './chess.js';

export const CLASSES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'forced'];
export const LABEL = { brilliant: 'Brilliant', great: 'Great', best: 'Best', excellent: 'Excellent', good: 'Good', book: 'Book',
  inaccuracy: 'Inaccuracy', mistake: 'Mistake', miss: 'Miss', blunder: 'Blunder', forced: 'Forced' };
// What each rating means, in a line, for the legend and for tooltips.
export const MEANING = {
  brilliant: 'The best move, and a hard one to find: usually a sound sacrifice.',
  great: 'The only good move in the position, or one that turned the game.',
  best: 'The engine’s first choice.',
  excellent: 'Nearly as good as the best move.',
  good: 'A reasonable move, a little short of the best.',
  book: 'A known opening move.',
  inaccuracy: 'A weaker move that gives a little away.',
  mistake: 'A bad move that makes your position clearly worse straight away.',
  miss: 'A missed chance: a tactic, or a chance to punish your opponent’s error.',
  blunder: 'A very bad move that also loses material or the game.',
  forced: 'The only legal move.'
};
export const SYMBOL = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '≡', inaccuracy: '?!', mistake: '?', miss: '×', blunder: '??', forced: '→' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const bookKey = fen => fen.split(' ').slice(0, 3).join(' ');

// Expected points (0..1) for the side to move, from an engine score { cp } or { mate }.
export function expPts(score) {
  if (!score) return 0.5;
  if (score.mate != null) return score.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.00368208 * score.cp));
}
const flip = s => (s.mate != null ? { mate: -s.mate } : { cp: -s.cp });
// A score from White's point of view, as text: "+0.31", "-1.20", "M3", "-M2".
export function scoreText(score, whiteToMove) {
  if (!score) return '';
  if (score.mate === 0) return whiteToMove ? '0-1' : '1-0'; // the side to move is checkmated
  const s = whiteToMove ? score : flip(score);
  if (s.mate != null) return (s.mate < 0 ? '-M' : 'M') + Math.abs(s.mate);
  return (s.cp >= 0 ? '+' : '') + (s.cp / 100).toFixed(2);
}
// White's share of the eval bar, 0..1.
export const whiteShare = (score, whiteToMove) => { const e = expPts(score); return whiteToMove ? e : 1 - e; };

/* ---------- reading a game ---------- */

// PGN -> { headers, plies: [{ san, uci, from, to, piece, color, captured, promotion, before, after, clock }], start, result }
export function readGame(pgn) {
  const c = new Chess();
  c.loadPgn(pgn);
  const headers = c.header ? c.header() : (c.getHeaders ? c.getHeaders() : {});
  const clocks = {};
  for (const x of c.getComments()) { const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(x.comment || ''); if (m) clocks[x.fen] = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]); }
  const plies = c.history({ verbose: true }).map(m => ({ san: m.san, uci: m.from + m.to + (m.promotion || ''), from: m.from, to: m.to, piece: m.piece, color: m.color,
    captured: m.captured || null, promotion: m.promotion || null, before: m.before, after: m.after, clock: clocks[m.after] != null ? clocks[m.after] : null }));
  return { headers, plies, start: plies.length ? plies[0].before : c.fen() };
}

// How a finished position scores for the side to move, without an engine: mated = lost, otherwise drawn.
export function terminalScore(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { mate: 0, over: 'mate' };
  if (c.isGameOver()) return { cp: 0, over: 'draw' };
  return null;
}
export const legalCount = fen => new Chess(fen).moves().length;

// UCI moves -> SAN, as far as they are legal from this position.
export function lineToSan(fen, uciMoves, max) {
  const c = new Chess(fen), out = [];
  for (const u of (uciMoves || []).slice(0, max || 99)) {
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined }); } catch (e) { break; }
    if (!m) break;
    out.push({ san: m.san, uci: u, from: m.from, to: m.to, fen: m.after, color: m.color });
  }
  return out;
}

/* ---------- classification ---------- */

// Material the mover leaves up for grabs after the move (0 when nothing is really hanging).
function offered(after, color) {
  const c = new Chess(after), opp = color === 'w' ? 'b' : 'w';
  let worst = 0;
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== color || p.type === 'p' || p.type === 'k') continue;
    const att = c.attackers(p.square, opp);
    if (!att.length) continue;
    const v = VALUE[p.type], cheapest = Math.min(...att.map(s => VALUE[c.get(s).type] || 10));
    const loss = c.attackers(p.square, color).length ? v - cheapest : v;
    if (loss > worst) worst = loss;
  }
  return worst;
}

export function phaseOf(fen, ply) {
  let pts = 0;
  for (const ch of fen.split(' ')[0]) { const v = VALUE[ch.toLowerCase()]; if (v > 1) pts += v; }
  if (pts <= 26) return 'endgame';
  return ply < 24 ? 'opening' : 'middlegame';
}

/* game: from readGame. evals[i]: engine result for the position before ply i (and one more for the final position):
   { lines: [{ cp | mate, pv: [uci] }, ...] } with scores for the side to move. book: { names, set }.
   Returns one record per ply. Thresholds are chess.com's published expected-points table. */
export function classify(game, evals, book, k) {
  k = k || 1; // scales the good / inaccuracy / mistake / blunder bands (see bandOf)
  const out = [];
  let inBook = true;
  game.plies.forEach((p, i) => {
    const ev = evals[i] || { lines: [] }, next = evals[i + 1] || { lines: [] };
    const best = ev.lines[0], second = ev.lines[1];
    const r = { cls: 'good', loss: 0, best: best && best.pv ? best.pv[0] : null, score: best ? pick(best) : null, tags: [], phase: phaseOf(p.before, i) };
    out.push(r);
    const eBest = expPts(best), eAfter = next.lines[0] ? 1 - expPts(next.lines[0]) : eBest;
    const isBest = !!best && best.pv && best.pv[0] === p.uci;
    r.loss = isBest ? 0 : Math.max(0, eBest - eAfter);
    r.eBest = eBest; r.eAfter = eAfter;
    r.after = next.lines[0] ? pick(next.lines[0]) : null;

    const key = bookKey(p.after);
    if (inBook && book && (book.names[key] || book.set.has(key))) { r.cls = 'book'; if (book.names[key]) r.opening = book.names[key]; return; }
    inBook = false;
    if (ev.legal === 1) { r.cls = 'forced'; return; }
    if (!best) return;

    const prev = out[i - 1];
    // what went wrong, in plain terms
    if (next.lines[0] && next.lines[0].mate > 0 && !(best.mate < 0)) r.tags.push('allowedMate');
    if (best.mate > 0 && !isBest && !(next.lines[0] && next.lines[0].mate <= 0)) r.tags.push('missedMate');
    if (r.loss >= 0.1) {
      const reply = next.lines[0] && next.lines[0].pv && next.lines[0].pv[0];
      if (reply) { const t = new Chess(p.after).get(reply.slice(2, 4)); if (t && t.color === p.color && VALUE[t.type] >= 3) r.tags.push('hung:' + t.type); }
      const bm = best.pv && best.pv[0];
      if (bm && !isBest) { const t = new Chess(p.before).get(bm.slice(2, 4)); if (t && t.color !== p.color && VALUE[t.type] >= 3) r.tags.push('missedCapture:' + t.type); }
    }

    if (r.loss < 0.02) {
      const gave = offered(p.after, p.color) - (p.captured ? VALUE[p.captured] : 0);
      const lostAlready = offered(p.before, p.color); // leaving something hanging that was already hanging is not a sacrifice
      if (gave >= 2 && gave > lostAlready - 1 && !p.promotion && eAfter >= 0.5 && eBest < 0.97 && !(second && expPts(second) >= 0.9)) { r.cls = 'brilliant'; return; }
      if (isBest && second && eBest - expPts(second) >= 0.15 && eBest > 0.3 && expPts(second) < 0.85 &&
          !(prev && game.plies[i - 1].captured && game.plies[i - 1].to === p.to)) { r.cls = 'great'; return; } // a plain recapture is not "great"
      r.cls = isBest ? 'best' : 'excellent';
      return;
    }
    if (r.loss < 0.05 * k) { r.cls = 'good'; return; }
    if (r.loss < 0.1 * k) { r.cls = 'inaccuracy'; return; }
    // failed to punish the opponent's error (or a winning shot), without ending up clearly worse
    const gift = prev && (prev.cls === 'mistake' || prev.cls === 'blunder' || prev.cls === 'miss');
    if ((gift || r.tags.includes('missedMate')) && eAfter >= 0.4 && eBest >= 0.6) { r.cls = 'miss'; return; }
    r.lose = losesSomething(p, next);
    r.cls = bandOf(r.loss, k, r.lose);
  });
  return out;
}
const pick = l => (l.mate != null ? { mate: l.mate } : { cp: l.cp });

// Accuracy 0..100 for one side, from how many winning chances each move gave away.
export function accuracy(recs, plies, color) {
  const mine = recs.filter((r, i) => plies[i].color === color);
  if (!mine.length) return null;
  const per = mine.map(r => Math.max(0, Math.min(100, 103.1668 * Math.exp(-4.354 * r.loss) - 3.1669)));
  return Math.round(per.reduce((a, b) => a + b, 0) / per.length * 10) / 10;
}
export function counts(recs, plies, color) {
  const c = {};
  CLASSES.forEach(k => { c[k] = 0; });
  recs.forEach((r, i) => { if (plies[i].color === color) c[r.cls]++; });
  return c;
}

const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
// One sentence about a move, for the review panel.
export function explain(rec, ply, bestSan) {
  const pct = Math.round(rec.loss * 100);
  const tag = t => rec.tags.find(x => x.startsWith(t));
  const bits = [];
  if (tag('allowedMate')) bits.push('It lets the opponent force checkmate.');
  else if (tag('hung')) bits.push('It leaves your ' + PIECE[tag('hung').split(':')[1]] + ' to be taken.');
  if (tag('missedMate')) bits.push('There was a forced checkmate.');
  else if (tag('missedCapture')) bits.push('You could have won a ' + PIECE[tag('missedCapture').split(':')[1]] + '.');
  const better = bestSan && rec.loss > 0 ? ' Best was ' + bestSan + '.' : '';
  switch (rec.cls) {
    case 'book': return 'A known opening move' + (rec.opening ? ': ' + rec.opening + '.' : '.');
    case 'forced': return 'The only legal move.';
    case 'brilliant': return 'A sound sacrifice, and the strongest idea here.';
    case 'great': return 'The one move that holds the position together. Everything else was clearly worse.';
    case 'best': return 'The engine’s top choice.';
    case 'excellent': return 'Nearly as good as the top choice.' + better;
    case 'good': return 'A solid move.' + better;
    case 'inaccuracy': return 'A little loose: about ' + pct + '% of your winning chances.' + better;
    case 'miss': return ['A missed chance.'].concat(bits).join(' ') + better;
    case 'mistake': return ['A mistake: about ' + pct + '% of your winning chances.'].concat(bits).join(' ') + better;
    case 'blunder': return ['A blunder: about ' + pct + '% of your winning chances.'].concat(bits).join(' ') + better;
  }
  return '';
}

/* ---------- puzzles from your own mistakes ---------- */

// Every mistake, miss or blunder by `color` becomes "find the better move" from the position before it.
export function makePuzzles(game, recs, evals, color, meta) {
  const out = [];
  game.plies.forEach((p, i) => {
    const r = recs[i], ev = evals[i];
    if (p.color !== color || !r || !['mistake', 'miss', 'blunder'].includes(r.cls) || !ev || !ev.lines[0] || !ev.lines[0].pv || !ev.lines[0].pv.length) return;
    const top = ev.lines[0], eTop = expPts(top);
    const ok = ev.lines.filter(l => l.pv && l.pv[0] && eTop - expPts(l) < 0.03).map(l => l.pv[0]); // every move about as good as the best one
    out.push({ id: meta.id + ':' + i, game: meta.id, ply: i, fen: p.before, color, played: p.san, cls: r.cls, loss: Math.round(r.loss * 100) / 100,
      answers: ok, pv: top.pv.slice(0, 8), tags: r.tags, opponent: meta.opponent || '', date: meta.end || 0, phase: r.phase, box: 0, due: 0, seen: 0, right: 0 });
  });
  return out;
}
// Spaced repetition: a solved puzzle comes back after 1, 3, 7, 16, 35 days; a failed one comes back today.
const STEPS = [0, 1, 3, 7, 16, 35];
export function gradePuzzle(p, correct, now) {
  const box = correct ? Math.min((p.box || 0) + 1, STEPS.length - 1) : 0;
  return Object.assign({}, p, { box, due: now + STEPS[box] * 864e5, seen: (p.seen || 0) + 1, right: (p.right || 0) + (correct ? 1 : 0) });
}

/* ---------- insights ---------- */

const DRAWS = new Set(['stalemate', 'agreed', 'repetition', 'insufficient', '50move', 'timevsinsufficient']);
export const outcome = code => (code === 'win' ? 'win' : DRAWS.has(code) ? 'draw' : 'loss');

/* games: [{ id, color, result: 'win'|'loss'|'draw', opening, timeClass }], reviews: { id: { recs, plies meta } } */
export function insights(games, reviews) {
  const rec = () => ({ n: 0, win: 0, draw: 0, loss: 0 });
  const add = (o, g) => { o.n++; o[g.result]++; };
  const total = rec(), byColor = { w: rec(), b: rec() }, openings = {};
  for (const g of games) {
    add(total, g); add(byColor[g.color], g);
    const k = (g.color === 'w' ? 'White: ' : 'Black: ') + (g.opening || 'Unknown opening').split(':')[0];
    add(openings[k] = openings[k] || rec(), g);
  }
  const phases = { opening: { moves: 0, bad: 0, loss: 0 }, middlegame: { moves: 0, bad: 0, loss: 0 }, endgame: { moves: 0, bad: 0, loss: 0 } };
  const tags = { hung: 0, missedCapture: 0, allowedMate: 0, missedMate: 0 }, classes = {};
  CLASSES.forEach(k => { classes[k] = 0; });
  let reviewed = 0, accSum = 0, lowClock = 0, lowClockBad = 0, moves = 0;
  for (const g of games) {
    const rv = reviews[g.id];
    if (!rv) continue;
    reviewed++; accSum += rv.acc[g.color] || 0;
    rv.recs.forEach((r, i) => {
      if (rv.colors[i] !== g.color) return;
      moves++; classes[r.cls]++;
      const bad = r.cls === 'mistake' || r.cls === 'blunder' || r.cls === 'miss';
      const ph = phases[r.phase] || phases.middlegame;
      ph.moves++; ph.loss += r.loss; if (bad) ph.bad++;
      if (bad) r.tags.forEach(t => { const k = t.split(':')[0]; if (k in tags) tags[k]++; });
      const clk = rv.clocks ? rv.clocks[i] : null;
      if (clk != null && clk < 30) { lowClock++; if (bad) lowClockBad++; }
    });
  }
  const bad = classes.mistake + classes.blunder + classes.miss;
  const tips = [];
  if (reviewed) {
    if (tags.hung >= Math.max(2, bad * 0.25)) tips.push({ title: 'Stop leaving pieces to be taken', text: tags.hung + ' of your ' + bad + ' big errors left a piece hanging. Before every move, ask: what can they capture now?' });
    if (tags.missedCapture >= Math.max(2, bad * 0.2)) tips.push({ title: 'Take the free pieces', text: 'You passed up ' + tags.missedCapture + ' free or winning captures. Before you move, look at every capture you have.' });
    if (tags.allowedMate + tags.missedMate >= 2) tips.push({ title: 'Check for checkmates', text: 'Mates were missed or allowed ' + (tags.allowedMate + tags.missedMate) + ' times. Look at every check, yours and theirs, before moving.' });
    const worst = Object.keys(phases).filter(k => phases[k].moves >= 10).sort((a, b) => phases[b].loss / phases[b].moves - phases[a].loss / phases[a].moves)[0];
    if (worst) tips.push({ title: 'Your weakest phase is the ' + worst, text: 'You give away the most there: ' + phases[worst].bad + ' big errors in ' + phases[worst].moves + ' moves.' });
    if (lowClock >= 8 && lowClockBad / lowClock > 2 * bad / Math.max(moves, 1)) tips.push({ title: 'Time trouble hurts', text: lowClockBad + ' big errors came with under 30 seconds left. Spend less time early in the game.' });
  }
  const openList = Object.keys(openings).map(k => Object.assign({ name: k }, openings[k])).filter(o => o.n >= 2).sort((a, b) => b.n - a.n).slice(0, 10);
  return { total, byColor, openings: openList, phases, tags, classes, reviewed, moves, bad, accuracy: reviewed ? Math.round(accSum / reviewed * 10) / 10 : null, tips: tips.slice(0, 3) };
}

/* ---------- game rating: the level each side played at in this one game ---------- */

// Accuracy on the moves a player had to find (0..100) against the rating that usually produces it.
const LEVELS = [[35, 100], [50, 300], [60, 500], [67, 700], [72, 900], [76, 1100], [79.5, 1300], [82.5, 1500], [85, 1700], [87.5, 1900],
  [90, 2100], [92, 2300], [94, 2500], [95.5, 2700], [97, 2900], [98.5, 3100], [100, 3300]];
/* Chess.com does not publish how it works out its game rating. This follows what is known about it: the quality of
   the moves sets a level, and that level is pulled toward the player's real rating. Book moves and forced moves are
   left out (they say nothing about skill), and blunders weigh more than a plain average would let them.
   Returns { rating, acc } or null when there are too few moves to judge. */
export function gameRating(recs, colors, color, elo) {
  const per = [];
  recs.forEach((r, i) => { if (colors[i] === color && r.cls !== 'book' && r.cls !== 'forced') per.push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-4.354 * r.loss) - 3.1669))); });
  if (per.length < 6) return null;
  const mean = per.reduce((a, b) => a + b, 0) / per.length, harm = per.length / per.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  const acc = (mean + harm) / 2;
  let i = 1;
  while (i < LEVELS.length - 1 && acc > LEVELS[i][0]) i++;
  const a = LEVELS[i - 1], b = LEVELS[i], raw = a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, (acc - a[0]) / (b[0] - a[0])));
  const known = +elo > 0, est = known ? 0.5 * raw + 0.5 * +elo : raw;
  return { rating: Math.max(100, Math.min(3300, Math.round(est / 50) * 50)), acc: Math.round(acc * 10) / 10, anchored: known };
}

/* ---------- tactic themes: what kind of chance each mistake was ---------- */

export const THEMES = { mate: 'Checkmate', backrank: 'Back-rank mate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', hanging: 'Free piece',
  capture: 'Winning capture', allowedMate: 'Walked into mate', hung: 'Left a piece hanging', other: 'Quiet best move' };
const TV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
DIRS.q = DIRS.b.concat(DIRS.r);
// The theme of a puzzle (see makePuzzles): looks at the best move and at what the played move allowed.
export function themeOf(p) {
  const tags = p.tags || [];
  let c, m;
  try { c = new Chess(p.fen); m = c.move({ from: p.pv[0].slice(0, 2), to: p.pv[0].slice(2, 4), promotion: p.pv[0].slice(4, 5) || undefined }); } catch (e) { return 'other'; }
  const opp = m.color === 'w' ? 'b' : 'w';
  if (tags.includes('missedMate') || c.isCheckmate()) {
    try {
      const t = new Chess(p.fen); let last = null;
      for (const u of p.pv) { last = t.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined }); if (t.isCheckmate()) break; }
      if (t.isCheckmate() && last && (last.piece === 'r' || last.piece === 'q')) {
        const home = last.color === 'w' ? '8' : '1';
        let k = null; for (const row of t.board()) for (const x of row) if (x && x.type === 'k' && x.color !== last.color) k = x.square;
        if (k && k[1] === home && last.to[1] === home) return 'backrank';
      }
    } catch (e) { /* fall through to plain mate */ }
    return 'mate';
  }
  // fork: the piece that moved now attacks two things that matter
  let hits = 0;
  for (const row of c.board()) for (const x of row) {
    if (!x || x.color !== opp || x.type === 'p') continue;
    if (!c.attackers(x.square, m.color).includes(m.to)) continue;
    if (x.type === 'k' || TV[x.type] > TV[m.piece] || !c.attackers(x.square, opp).length) hits++;
  }
  if (hits >= 2) return 'fork';
  // pin and skewer: a line piece looks through one enemy piece at another
  if (DIRS[m.piece]) {
    const f0 = m.to.charCodeAt(0) - 97, r0 = +m.to[1] - 1;
    for (const [df, dr] of DIRS[m.piece]) {
      let f = f0 + df, r = r0 + dr, first = null;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const x = c.get(String.fromCharCode(97 + f) + (r + 1));
        if (x) {
          if (x.color !== opp) break;
          if (!first) first = x;
          else { if (TV[x.type] > TV[first.type] && first.type !== 'p') return 'pin'; if (TV[first.type] > TV[x.type] && TV[first.type] > TV[m.piece] && x.type !== 'p') return 'skewer'; break; }
        }
        f += df; r += dr;
      }
    }
  }
  if (m.captured && m.captured !== 'p') {
    if (!c.attackers(m.to, opp).length) return 'hanging';
    if (TV[m.captured] > TV[m.piece]) return 'capture';
  }
  if (tags.includes('allowedMate')) return 'allowedMate';
  if (tags.some(t => t.startsWith('hung'))) return 'hung';
  if (m.captured && !c.attackers(m.to, opp).length) return 'hanging';
  return 'other';
}

/* ---------- clocks ---------- */

// "600+5" -> { base: 600, inc: 5 }. Daily games ("1/86400") and missing headers give null.
export function timeControl(pgn) {
  const m = /\[TimeControl "(\d+)(?:\+(\d+))?"\]/.exec(pgn || '');
  return m ? { base: +m[1], inc: +(m[2] || 0) } : null;
}
// Seconds spent on each ply (null where unknown), from the clock left after each move.
export function spentTimes(clocks, colors, tc) {
  const last = {}, out = [];
  (clocks || []).forEach((clk, i) => {
    const c = colors[i], prev = last[c] != null ? last[c] : tc ? tc.base : null;
    out.push(clk == null || prev == null ? null : Math.max(0, Math.round((prev - clk + (tc ? tc.inc : 0)) * 10) / 10));
    if (clk != null) last[c] = clk;
  });
  return out;
}
// How often your big errors come at each thinking time and each amount of clock left.
export function clockStats(games, reviews) {
  const mk = labels => labels.map(l => ({ label: l, moves: 0, bad: 0 }));
  const bySpent = mk(['Under 2 seconds', '2 to 10 seconds', '10 to 30 seconds', 'Over 30 seconds']), byLeft = mk(['Under 20 seconds left', '20 to 60 seconds left', 'Over a minute left']);
  let n = 0;
  for (const g of games) {
    const rv = reviews[g.id], tc = timeControl(g.pgn);
    if (!rv || !tc || !rv.clocks || !rv.colors) continue;
    const sp = spentTimes(rv.clocks, rv.colors, tc);
    rv.recs.forEach((r, i) => {
      if (rv.colors[i] !== g.color || sp[i] == null || r.cls === 'book' || r.cls === 'forced') return;
      const bad = r.cls === 'mistake' || r.cls === 'blunder' || r.cls === 'miss', left = rv.clocks[i];
      const a = bySpent[sp[i] < 2 ? 0 : sp[i] < 10 ? 1 : sp[i] < 30 ? 2 : 3], b = byLeft[left < 20 ? 0 : left < 60 ? 1 : 2];
      a.moves++; b.moves++; n++; if (bad) { a.bad++; b.bad++; }
    });
  }
  return { n, bySpent, byLeft };
}

/* ---------- endgames from your own games ---------- */

// The position where the endgame began in a reviewed game, if it was one worth practising: clearly winning, or level.
export function endgameOf(meta, rv) {
  const i = rv.recs.findIndex(r => r.phase === 'endgame');
  if (i < 0 || rv.recs.length - i < 8) return null;
  let game;
  try { game = readGame(meta.pgn); } catch (e) { return null; }
  const p = game.plies[i], ev = rv.evals[i] && rv.evals[i].lines[0];
  if (!p || !ev) return null;
  const mine = p.color === meta.color ? expPts(ev) : 1 - expPts(ev);
  const goal = mine >= 0.8 ? 'win' : mine >= 0.35 && mine <= 0.65 ? 'draw' : null;
  if (!goal) return null;
  return { id: meta.id, fen: p.before, color: meta.color, goal, result: meta.result, opponent: meta.opponent, end: meta.end, ply: i,
    score: scoreText(ev, p.color === 'w'), failed: goal === 'win' ? meta.result !== 'win' : meta.result === 'loss' };
}

/* ---------- puzzles: done for good, and made-up ones ---------- */

// A puzzle is finished once it was solved on the first attempt, the last time it was shown.
export const mastered = p => (p.box || 0) >= 1;
export { offered };
/* A made-up puzzle from any position, given the engine's two best lines (scores for the side to move), or null when
   the position has no clear single answer. Either a winning shot, or the only move that avoids a mate or saves a piece. */
export function madePuzzle(fen, lines) {
  const top = lines[0], sec = lines[1];
  if (!top || !sec || !top.pv || !top.pv.length) return null;
  const color = fen.split(' ')[1], eTop = expPts(top), eSec = expPts(sec), gap = eTop - eSec, tags = [];
  const mate = top.mate > 0 && top.mate <= 4 && !(sec.mate > 0); // a short forced mate that only one move starts
  if (!mate && (gap < 0.2 || eTop < 0.3)) return null;
  if (mate) tags.push('missedMate');
  else if (eTop >= 0.55) { if (eSec >= 0.9) return null; }
  else {
    if (gap < 0.25) return null;
    if (sec.mate != null && sec.mate < 0) tags.push('allowedMate');
    else if (offered(fen, color) >= 2) tags.push('hung:x');
    else return null;
  }
  const parts = fen.split(' ');
  return { id: 'gen:' + parts[0] + parts[1], made: true, game: '', ply: 0, fen, color, played: '', cls: '', loss: Math.round(gap * 100) / 100, answers: [top.pv[0]], pv: top.pv.slice(0, 8), tags,
    opponent: '', date: 0, phase: phaseOf(fen, (+parts[5] || 1) * 2), box: 0, due: 0, seen: 0, right: 0, e: eTop };
}

/* ---------- matching chess.com's numbers ---------- */

const BAND = ['good', 'inaccuracy', 'mistake', 'blunder'];
// The rating for a move that gave away `loss` of the winning chances. k scales the bands: above 1 is more forgiving.
// A big drop is a blunder only when it also loses material or the game (lose); otherwise it counts as a mistake.
export const bandOf = (loss, k, lose) => (loss < 0.05 * k ? 'good' : loss < 0.1 * k ? 'inaccuracy' : loss < 0.2 * k || lose === false ? 'mistake' : 'blunder');
function sideMat(fen, color) {
  let s = 0;
  for (const ch of fen.split(' ')[0]) { const v = VALUE[ch.toLowerCase()]; if (v) s += (ch === ch.toUpperCase()) === (color === 'w') ? v : -v; }
  return s;
}
/* Does the move p lose material or the game? next: the engine's result for the position after it (scores for the
   opponent). True when the opponent can force mate, the game is all but lost, a win or draw was thrown away to a
   finished game, or the engine's best reply line wins a pawn or more from you, counted once any exchange is over. */
export function losesSomething(p, next) {
  const r0 = next && next.lines && next.lines[0];
  if (!r0) return true;
  if (r0.over) return r0.over !== 'mate'; // a stalemate or other draw out of a better position counts; mating them does not lose
  if (r0.mate != null && r0.mate > 0) return true;
  if (1 - expPts(r0) <= 0.15) return true;
  const c = new Chess(p.after), before = sideMat(p.before, p.color);
  let n = 0, last = null;
  for (const u of r0.pv || []) {
    if ((n >= 6 && !(last && last.captured)) || n >= 10) break;
    try { last = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined }); } catch (e) { break; }
    n++;
  }
  return before - sideMat(c.fen(), p.color) >= 1;
}
// Sets r.lose on every move of a stored review that dropped enough to be a candidate blunder.
export function markLoses(game, recs, evals) { recs.forEach((r, i) => { r.lose = r.loss >= 0.1 && game.plies[i] ? losesSomething(game.plies[i], evals[i + 1]) : false; }); }
// Re-rates stored moves with new bands. Brilliant, great, best, excellent, book, forced and miss are left as they are.
export function reband(recs, k) {
  let n = 0;
  for (const r of recs) if (BAND.includes(r.cls)) { const c = bandOf(r.loss, k, r.lose); if (c !== r.cls) { r.cls = c; n++; } }
  return n;
}
// One side's inaccuracies, mistakes and blunders (misses counted as blunders) as they would be with bands k.
export function errCounts(recs, colors, color, k) {
  const o = { inaccuracy: 0, mistake: 0, blunder: 0 };
  recs.forEach((r, i) => { if (colors[i] !== color) return; const c = BAND.includes(r.cls) ? bandOf(r.loss, k, r.lose) : r.cls; if (c === 'miss') o.blunder++; else if (c in o) o[c]++; });
  return o;
}
/* A mapping from our number to chess.com's, learned from pairs [ours, theirs]. With a few pairs it is a shift by the
   average difference, held back toward no change; from four pairs on it blends in a straight-line fit. */
export function fitLine(pairs) {
  const n = pairs.length;
  if (!n) return x => x;
  const d = pairs.reduce((a, p) => a + p[1] - p[0], 0) / n, off = x => x + d * n / (n + 2);
  if (n < 4) return off;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n, my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); }
  if (sxx < 1e-6) return off;
  const b = Math.max(0.5, Math.min(1.5, sxy / sxx)), a = my - b * mx, w = (n - 3) / (n + 3);
  return x => w * (a + b * x) + (1 - w) * off(x);
}
const CC_LABEL = { accuracy: 'acc', 'game rating': 'gr', brilliant: 'brilliant', brilliants: 'brilliant', great: 'great', greats: 'great', best: 'best', excellent: 'excellent',
  good: 'good', book: 'book', inaccuracy: 'inaccuracy', inaccuracies: 'inaccuracy', mistake: 'mistake', mistakes: 'mistake', miss: 'miss', misses: 'miss', missed: 'miss', blunder: 'blunder', blunders: 'blunder' };
/* Reads the summary copied from chess.com's Game Review: accuracy, game rating and the move counts, for White then Black.
   Works whether the numbers sit after each label ("Mistake 2 1") or around it ("2 Mistake 1").
   Returns { acc: [w, b], gr: [w, b], counts: { class: [w, b] }, found } with whatever it could find. */
export function parseReview(text) {
  // a number counts only if it stood alone, so "(912)" next to a name, or a name ending in digits, never does
  const raw = String(text || '').replace(/[|•·:,]/g, ' ').split(/\s+/).filter(Boolean), tok = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].toLowerCase().replace(/[^a-z0-9.%]/g, ''), n = raw[i + 1] ? raw[i + 1].toLowerCase().replace(/[^a-z]/g, '') : '';
    if (!t) continue; // badges such as !! or ??
    if (t === 'game' && n === 'rating') { tok.push({ t: 'game rating' }); i++; }
    else if ((t === 'great' || t === 'best') && /^moves?$/.test(n)) { tok.push({ t }); i++; }
    else tok.push({ t: t.replace(/%$/, ''), n: /^\d+(\.\d+)?%?$/.test(raw[i]) ? +raw[i].replace('%', '') : null });
  }
  const num = i => i >= 0 && i < tok.length && tok[i].n != null && !used.has(i), used = new Set(), out = { counts: {}, found: 0 };
  tok.forEach((x, i) => {
    const key = CC_LABEL[x.t];
    if (!key || (key === 'acc' && out.acc) || (key === 'gr' && out.gr) || out.counts[key]) return;
    const fits = v => (key === 'acc' ? v.every(y => y >= 0 && y <= 100) : key === 'gr' ? v.every(y => y >= 100 && y <= 3500 && y % 1 === 0) : v.every(y => y <= 300 && y % 1 === 0));
    for (const pair of [[i - 1, i + 1], [i + 1, i + 2]]) {
      if (!pair.every(num)) continue;
      const v = pair.map(j => tok[j].n);
      if (!fits(v)) continue;
      pair.forEach(j => used.add(j));
      if (key === 'acc') out.acc = v; else if (key === 'gr') out.gr = v; else out.counts[key] = v;
      out.found++;
      break;
    }
  });
  return out;
}
