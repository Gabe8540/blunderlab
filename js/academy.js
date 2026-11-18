// Blunder Lab course: a path from the basics to the endgame, plus endless visualization and notation drills.
// The lessons are written for Blunder Lab. The positions are standard ones that every endgame and tactics text uses.
import { Chess } from './chess.js';

/* Stages follow rating. The course starts at the stage that fits your rating, and the earlier ones stay open to review. */
export const STAGES = [
  { n: 1, name: 'Foundations', range: 'up to 800', max: 800 },
  { n: 2, name: 'Stop losing pieces', range: '800 to 1200', max: 1200 },
  { n: 3, name: 'Win the won games', range: '1200 to 1600', max: 1600 },
  { n: 4, name: 'Think like a stronger player', range: '1600 and up', max: 9999 }
];
export const stageFor = elo => (STAGES.find(s => elo < s.max) || STAGES[3]).n;
export const AREAS = { notation: 'Notation', visual: 'Visualization', opening: 'Opening', middlegame: 'Middlegame', tactics: 'Tactics', endgame: 'Endgame' };

// Exercises: play (a position against Stockfish, goal win or draw), puzzles (a theme), viz / nota (drills),
// and links into other trainer pages: open (openings), drill (blunder check), end (your endgames), opp, bot.
export const LESSONS = [
  // ---- stage 1
  { id: 'n1', stage: 1, area: 'notation', title: 'Reading the board',
    text: ['Every square has a name: a letter for the column (a to h, left to right from White’s side) and a number for the row (1 to 8, counting up from White’s side). White’s queen starts on d1, Black’s on d8. The light square is always on your right in the corner.',
      'Piece letters: K king, Q queen, R rook, B bishop, N knight (K is taken by the king). Pawns get no letter at all: a pawn moving to e4 is just “e4”.'],
    key: ['Files are letters, ranks are numbers: e4 means column e, row 4', 'White starts on ranks 1 and 2, Black on 7 and 8', 'N is the knight; a pawn move is only the square'],
    do: [{ t: 'nota', label: 'Name the squares (start at level 1)' }], read: 'Bobby Fischer Teaches Chess (Fischer, Margulies and Mosenfelder)' },
  { id: 'n2', stage: 1, area: 'notation', title: 'Writing moves',
    text: ['A move is the piece letter plus the square it lands on: Nf3, Bc4, Qd1. A capture adds x: Bxf7. A pawn capture names the file it came from: exd5. Check adds +, checkmate adds #.',
      'Castling is O-O on the king’s side and O-O-O on the queen’s side. A pawn reaching the end adds what it becomes: e8=Q. When two of the same piece could reach a square, add the file (or rank) it came from: Nbd2, R1e2.'],
    key: ['x for captures, + for check, # for mate', 'Pawn captures start with the file: exd5', 'O-O short castle, O-O-O long castle', 'Two knights can reach d2? Write Nbd2 or Nfd2'],
    do: [{ t: 'nota', label: 'Read and write moves' }], read: 'Logical Chess: Move by Move (Chernev)' },
  { id: 'v1', stage: 1, area: 'visual', title: 'Seeing without the board',
    text: ['Strong players calculate by moving pieces in their head. You build that the same way you build anything: short and often. Start with two or three moves, picture each one landing, and say the square to yourself.',
      'Tricks that help: name every square a piece passes through, keep track of the last piece that moved, and notice which pieces are attacked after each move.'],
    key: ['A few minutes a day beats one long session', 'Say each move and its square in your head', 'Watch what each move attacks, not just where it lands'],
    do: [{ t: 'viz', label: 'Visualization drill' }], read: 'Chess Visualization Course (Bukhman)' },
  { id: 'o1', stage: 1, area: 'opening', title: 'The three opening jobs',
    text: ['Every good opening does three things: puts pawns in the centre (e4, d4, or their Black versions), brings the knights and bishops out towards the centre, and castles the king to safety. Most early disasters at your level come from skipping one of these.',
      'Avoid moving the same piece twice before the others are out, bringing the queen out early where it can be chased, and grabbing pawns on the edge while your king still sits in the middle.'],
    key: ['Centre pawns, then knights and bishops, then castle', 'Knights before bishops is a good default', 'Do not chase pawns with your queen in the first ten moves'],
    do: [{ t: 'open', label: 'Learn one White and one Black opening' }, { t: 'opp', label: 'Play your openings against your real opponents' }], read: 'Logical Chess: Move by Move (Chernev)' },
  { id: 't1', stage: 1, area: 'tactics', title: 'Free pieces and the safety check',
    text: ['Most games under 1000 are decided by a piece left where it can be taken for nothing. Before every move, ask two questions: what did my opponent’s last move attack, and after my move, what can they capture?',
      'Count attackers and defenders. If a piece is attacked more times than it is defended, or attacked by something worth less, it is in danger.'],
    key: ['After each opponent move: what does it attack?', 'Before each of your moves: what can they take now?', 'Attacked by a pawn or minor piece? Worth checking twice'],
    do: [{ t: 'puzzles', theme: 'hanging', label: 'Take the free piece' }, { t: 'drill', label: 'Blunder check on your own moves' }], read: 'Bobby Fischer Teaches Chess' },
  { id: 'e1', stage: 1, area: 'endgame', title: 'Mate with king and queen',
    text: ['The queen alone can’t mate; the king has to help. Use the queen to box the enemy king into a smaller and smaller area, a knight’s move away, then walk your own king up and deliver mate on the edge.',
      'Danger: stalemate. When the enemy king has only a few squares left, check that it still has a legal move before you play a quiet queen move.'],
    key: ['Shrink the box with the queen', 'Bring your king close', 'Look for stalemate before every quiet move'],
    do: [{ t: 'play', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', side: 'w', goal: 'win', label: 'Checkmate with king and queen' }], read: 'Chess Fundamentals (Capablanca), free and public domain' },
  { id: 'e2', stage: 1, area: 'endgame', title: 'Mate with king and rook',
    text: ['The rook cuts the enemy king off along a line. Your king walks towards it, and when the two kings face each other with one square between them, a rook check on the edge pushes it back a row. Repeat until it is on the last row, then mate.',
      'When it is not the right moment for a check, make a waiting move with the rook along the same line, keeping the cut-off.'],
    key: ['The rook makes a fence; the king pushes', 'Check when the kings face each other', 'A waiting rook move keeps the fence'],
    do: [{ t: 'play', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', side: 'w', goal: 'win', label: 'Checkmate with king and rook' }], read: 'Chess Fundamentals (Capablanca)' },
  { id: 'e3', stage: 1, area: 'endgame', title: 'The rule of the square',
    text: ['Can a king catch a runaway pawn? Draw a square from the pawn to its promotion square. If the king can step into that square on its move, it catches the pawn; if not, the pawn queens.',
      'A pawn on its starting row can move two squares, so count it as if it already stood one square higher.'],
    key: ['Draw the square from pawn to queening square', 'King inside on its move: caught', 'Pawn on its first row: add one'],
    do: [{ t: 'play', fen: '8/8/8/P3k3/8/8/8/7K b - - 0 1', side: 'b', goal: 'draw', label: 'Catch the a-pawn (you are Black)' }], read: 'Silman’s Complete Endgame Course (Silman)' },
  // ---- stage 2
  { id: 't2', stage: 2, area: 'tactics', title: 'Forks',
    text: ['A fork is one piece attacking two at once. The knight is the master of forks because it jumps and its attacks are hard to see. Queens and pawns fork a lot too.',
      'Look for enemy pieces that are a knight’s jump from the same square, and for unprotected pieces: two loose pieces are a fork waiting to happen.'],
    key: ['Two targets, one attacker', 'Loose pieces invite forks', 'A check plus an attack is the strongest fork'],
    do: [{ t: 'puzzles', theme: 'fork', label: 'Fork puzzles' }], read: 'Winning Chess Tactics (Seirawan)' },
  { id: 't3', stage: 2, area: 'tactics', title: 'Pins and skewers',
    text: ['A pin attacks a piece that can’t move without exposing something more valuable behind it. A skewer is the reverse: the valuable piece is in front, it moves, and the one behind falls.',
      'Bishops, rooks and queens make pins and skewers. Kings and queens lined up on a file or diagonal are the classic target.'],
    key: ['Pin: the more valuable piece is behind', 'Skewer: the more valuable piece is in front', 'Watch lines between your king, queen and their long pieces'],
    do: [{ t: 'puzzles', theme: 'pin', label: 'Pin puzzles' }, { t: 'puzzles', theme: 'skewer', label: 'Skewer puzzles' }], read: 'Winning Chess Tactics (Seirawan)' },
  { id: 't4', stage: 2, area: 'tactics', title: 'Back-rank mate',
    text: ['A castled king behind three unmoved pawns has no escape square. A rook or queen landing on the back row is then mate. Many games at every level end this way.',
      'Defend by giving the king air (a pawn move like h3 when you have time) and by keeping a rook or queen guarding your back row.'],
    key: ['No escape square plus an open back row = danger', 'Make luft with h3 or g3 when calm', 'Check their back row every time you have a rook'],
    do: [{ t: 'puzzles', theme: 'backrank', label: 'Back-rank puzzles' }], read: 'Winning Chess Tactics (Seirawan)' },
  { id: 'e4', stage: 2, area: 'endgame', title: 'Opposition and key squares',
    text: ['With only kings and a pawn left, the result depends on the kings. When the kings face each other with one square between them, the side that does not have to move has the opposition: the other must step aside.',
      'For a pawn on its own half of the board, the three squares two rows in front of it are the key squares. Get your king there and you win whoever is to move. So in these endings, bring the king first and push the pawn later.'],
    key: ['King first, pawn later', 'Kings facing, one square apart: the side not to move wins the standoff', 'Key squares: two rows in front of the pawn'],
    do: [{ t: 'play', fen: '8/4k3/8/4K3/4P3/8/8/8 b - - 0 1', side: 'w', goal: 'win', label: 'Win it (Black moves first)' },
      { t: 'play', fen: '8/4k3/8/4K3/4P3/8/8/8 w - - 0 1', side: 'b', goal: 'draw', label: 'Hold it as Black (White moves first)' }], read: 'Silman’s Complete Endgame Course' },
  { id: 'e5', stage: 2, area: 'endgame', title: 'The rook pawn exception',
    text: ['A pawn on the a- or h-file is the weakest pawn to try to win with. If the defending king reaches the corner in front of it, there is no way to drive it out: the attacker runs into stalemate or the king just shuffles.',
      'So as the defender, run for the corner. As the attacker, keep the enemy king out of it.'],
    key: ['Defending king in the corner: draw', 'Stalemate is the defender’s friend here'],
    do: [{ t: 'play', fen: 'k7/8/8/P1K5/8/8/8/8 w - - 0 1', side: 'b', goal: 'draw', label: 'Hold the draw as Black' }], read: 'Silman’s Complete Endgame Course' },
  { id: 'm1', stage: 2, area: 'middlegame', title: 'Find a plan',
    text: ['After the opening, ask three questions. Which of my pieces is worst, and where would it be better? What is the weakest thing in their camp (a loose pawn, a bad bishop, a weak square)? Where are the open files for my rooks?',
      'A modest plan carried out beats random moves. Improve your worst piece, put rooks on open files, and aim your pieces at the side of the board where you are stronger.'],
    key: ['Improve your worst piece', 'Rooks belong on open files', 'Attack where you have more pieces'],
    do: [{ t: 'puzzles', theme: 'other', label: 'Quiet best moves' }, { t: 'bot', label: 'Play a game and use the three questions' }], read: 'How to Reassess Your Chess (Silman)' },
  // ---- stage 3
  { id: 't5', stage: 3, area: 'tactics', title: 'Forcing moves first',
    text: ['When you look for a tactic, look at checks first, then captures, then threats. Forcing moves limit your opponent’s replies, so you can calculate them deeply.',
      'Do the same for your opponent before every move: which checks, captures and threats will they have after it?'],
    key: ['Checks, captures, threats, in that order', 'Forcing lines are calculable; quiet ones are not', 'Run the same scan for your opponent'],
    do: [{ t: 'puzzles', theme: 'mate', label: 'Checkmate puzzles' }, { t: 'puzzles', theme: 'capture', label: 'Winning captures' }, { t: 'viz', label: 'Visualization, longer lines' }], read: 'The Art of Attack in Chess (Vuković)' },
  { id: 'e6', stage: 3, area: 'endgame', title: 'Building a bridge',
    text: ['The most important rook ending: your pawn is on the seventh row with your king in front of it, and the enemy king is cut off on a file. The winning idea is to bring your rook to the fourth row, then walk the king out and use the rook to block the checks: a bridge.',
      'Remember the order: cut the king off with a check on the file, rook to the fourth row, king out, rook interposes.'],
    key: ['Cut the enemy king off first', 'Rook to the fourth row', 'King steps out, rook blocks the checks'],
    do: [{ t: 'play', fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1', side: 'w', goal: 'win', label: 'Win with the bridge' }], read: 'Silman’s Complete Endgame Course' },
  { id: 'e7', stage: 3, area: 'endgame', title: 'The third-row defence',
    text: ['The most important rook ending for the defender: their king and pawn are coming, your king is in front of the pawn. Keep your rook on your third row so their king can’t step up. When the pawn advances to that row, the king loses its shelter: swing your rook to the far end and check from behind.',
      'Passive defence on the back row loses; the third row draws.'],
    key: ['King in front of the pawn', 'Rook on the third row until the pawn moves up', 'Then check from far away, from behind'],
    do: [{ t: 'play', fen: '4k3/7R/r7/4PK2/8/8/8/8 b - - 0 1', side: 'b', goal: 'draw', label: 'Hold the rook ending as Black' }], read: 'Silman’s Complete Endgame Course' },
  { id: 'e8', stage: 3, area: 'endgame', title: 'The outside passed pawn',
    text: ['A passed pawn far from the other pawns is a decoy. The enemy king has to run over to stop it, and while it is away your king eats the pawns on the other side.',
      'Rooks belong behind passed pawns, yours or theirs: behind your own pawn the rook gains power as the pawn advances.'],
    key: ['Use the far pawn to drag their king away', 'Your king takes what is left behind', 'Rooks behind passed pawns'],
    do: [{ t: 'play', fen: '8/6pp/8/3k4/P7/4K3/6PP/8 w - - 0 1', side: 'w', goal: 'win', label: 'Win with the outside pawn' }, { t: 'end', label: 'Your own endgames' }], read: 'Chess Fundamentals (Capablanca)' },
  { id: 'm2', stage: 3, area: 'middlegame', title: 'Good and bad pieces',
    text: ['A bishop blocked by its own pawns on its colour is a bad bishop. A knight on a protected square in the enemy half that no pawn can chase away is an outpost, and often worth more than a rook there.',
      'Trade your bad pieces for their good ones. Put your pawns on the opposite colour of your bishop.'],
    key: ['Bishop behind its own pawns: bad', 'Knight on a protected advanced square: great', 'Trade your worst piece for their best'],
    do: [{ t: 'bot', label: 'Play a game: find an outpost for a knight' }], read: 'My System (Nimzowitsch)' },
  // ---- stage 4
  { id: 'e9', stage: 4, area: 'endgame', title: 'Queen against a pawn',
    text: ['A pawn one step from queening, supported by its king, against a lone queen. Against a centre or knight pawn the queen wins: check or pin so the king has to stand in front of its pawn, then use that tempo to bring your own king one step closer. Repeat.',
      'Against a rook pawn or bishop pawn it is often a draw, because of stalemate tricks.'],
    key: ['Force the king in front of its pawn', 'Each time, your king steps closer', 'Rook and bishop pawns: watch for stalemate'],
    do: [{ t: 'play', fen: '8/8/8/8/8/8/3pk3/Q6K w - - 0 1', side: 'w', goal: 'win', label: 'Beat the pawn with the queen' }], read: 'Silman’s Complete Endgame Course' },
  { id: 'e10', stage: 4, area: 'endgame', title: 'The wrong bishop',
    text: ['A bishop and a rook pawn can’t win if the bishop does not control the queening square and the defending king reaches the corner. The king simply shuffles in the corner.',
      'Before you trade into this ending as the stronger side, check the colour of the corner.'],
    key: ['Bishop not on the corner’s colour + rook pawn = draw', 'The defender runs to the corner'],
    do: [{ t: 'play', fen: '7k/8/6K1/7P/8/8/8/5B2 w - - 0 1', side: 'b', goal: 'draw', label: 'Hold the corner as Black' }], read: 'Silman’s Complete Endgame Course' },
  { id: 'm3', stage: 4, area: 'middlegame', title: 'Calculating candidate moves',
    text: ['Before you move, list two or three candidate moves. Calculate each one in turn, to a quiet position, and compare the results. Do not jump back and forth between lines.',
      'This is where visualization pays off: the clearer you see the board in your head, the further you can go.'],
    key: ['List the candidates first', 'One line at a time, to the end', 'Compare the final positions, then choose'],
    do: [{ t: 'viz', label: 'Visualization, longest lines' }, { t: 'puzzles', theme: 'other', label: 'Quiet best moves' }], read: 'Think Like a Grandmaster (Kotov)' }
];

/* ---------- notation drills ---------- */
const FILES = 'abcdefgh';
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
export const randSquare = () => FILES[rnd(8)] + (1 + rnd(8));
// Level: 1 name squares (White's view) · 2 tap squares · 3 as Black · 4 no coordinates · 5 read moves · 6 write moves · 7+ everything mixed
export function notaKind(lvl) {
  const k = lvl <= 1 ? ['name'] : lvl === 2 ? ['name', 'tap'] : lvl <= 4 ? ['name', 'tap'] : lvl === 5 ? ['read', 'tap'] : lvl === 6 ? ['write', 'read'] : ['write', 'read', 'tap', 'name'];
  return { kind: pick(k), black: lvl >= 3 && Math.random() < 0.5, nocoord: lvl >= 4 };
}
export function squareOptions(sq) {
  const near = new Set([sq]);
  const f = FILES.indexOf(sq[0]), r = +sq[1];
  const cand = [[f + 1, r], [f - 1, r], [f, r + 1], [f, r - 1], [7 - f, r], [f, 9 - r], [7 - f, 9 - r]].filter(([x, y]) => x >= 0 && x < 8 && y >= 1 && y <= 8).map(([x, y]) => FILES[x] + y);
  while (near.size < 4 && cand.length) near.add(cand.splice(rnd(cand.length), 1)[0]);
  while (near.size < 4) near.add(randSquare());
  return [...near].sort(() => Math.random() - 0.5);
}
// Wrong ways to write a move, to choose against the right one
export function sanOptions(m, fen) {
  const s = m.san, out = new Set([s]), P = { n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
  const tries = [];
  if (m.piece === 'p') {
    if (m.captured) { tries.push(s.replace(/^[a-h]x/, ''), 'P' + s, s.replace(/^([a-h])x/, '$1')); }
    else tries.push('P' + s, m.from + m.to);
  } else {
    const L = P[m.piece];
    tries.push(s.replace(/^[KQRBN]/, L.toLowerCase()));
    tries.push(s.replace(/^[KQRBN]/, L === 'N' ? 'K' : L === 'B' ? 'N' : 'B'));
    if (m.captured) tries.push(s.replace('x', '')); else tries.push(s.replace(/([a-h][1-8])([+#=].*)?$/, 'x$1$2'));
    tries.push(L + m.from + m.to);
  }
  if (/[+#]$/.test(s)) tries.push(s.replace(/[+#]$/, '')); else tries.push(s + '+');
  if (s === 'O-O') tries.push('O-O-O', 'Kg1', '0-0-0');
  if (s === 'O-O-O') tries.push('O-O', 'Kc1', 'O-O-O+');
  for (const t of tries.sort(() => Math.random() - 0.5)) { if (t && t !== s) out.add(t); if (out.size >= 4) break; }
  while (out.size < 4) out.add(s.replace(/[1-8]/, d => String(((+d) % 8) + 1)) + (out.size === 2 ? '' : '+'));
  return [...out].sort(() => Math.random() - 0.5);
}

/* ---------- visualization drills ---------- */
// Level: plies to read in your head, and how the start is shown.
export const vizPlies = lvl => Math.min(14, lvl + 1);
export const vizShowSecs = lvl => (lvl >= 9 ? 8 : 0); // from level 9 the diagram disappears on its own
export const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
// A start position and the moves to read, from one of your games (or a quick random game when there are none)
export function vizItem(games, lvl) {
  const n = vizPlies(lvl);
  for (let tries = 0; tries < 20 && games.length; tries++) {
    const g = pick(games);
    let c;
    try { c = new Chess(); c.loadPgn(g.pgn); } catch (e) { continue; }
    const h = c.history({ verbose: true });
    if (h.length < n + 8) continue;
    const at = 6 + rnd(h.length - n - 6), start = h[at].after, seq = h.slice(at + 1, at + 1 + n);
    return item(start, seq, g);
  }
  const c = new Chess(); // no games: a few sensible random moves from the start
  for (let i = 0; i < 8; i++) { const ms = c.moves(); c.move(pick(ms)); }
  const start = c.fen(), seq = [];
  for (let i = 0; i < n && !c.isGameOver(); i++) { const m = c.move(pick(c.moves())); seq.push(m); }
  return item(start, seq, null);
}
function item(start, seq, g) {
  const c = new Chess(start);
  for (const m of seq) c.move(m.san);
  const end = c.fen(), moved = [...new Set(seq.map(m => m.to))].filter(sq => c.get(sq)), ask = [];
  // where did it go: a piece that moved during the line
  const t = pick(moved.length ? moved : [seq[seq.length - 1].to]), p = c.get(t);
  let from = t; // follow the piece back to where it stood at the start of the line
  for (let i = seq.length - 1; i >= 0; i--) if (seq[i].to === from) from = seq[i].from;
  if (p) ask.push({ q: 'The ' + (p.color === 'w' ? 'white' : 'black') + ' ' + NAMES[p.type] + ' that started on ' + from + ': which square is it on now? Tap it.', type: 'tap', answer: t, piece: p });
  // what is on a square now
  const occ = [];
  for (const row of c.board()) for (const x of row) if (x) occ.push(x);
  const froms = seq.map(m => m.from).filter(q => q !== t), others = occ.map(o => o.square).filter(q => q !== t);
  const sq = Math.random() < 0.5 && froms.length ? pick(froms) : pick(others.length ? others : [t]), x = c.get(sq); // a square the line emptied, or any other piece
  ask.push({ q: 'What is on ' + sq + ' now?', type: 'what', answer: x ? x.color + x.type : 'empty', sq });
  return { start, seq, end, ask, game: g ? { id: g.id, opp: g.opponent } : null };
}
export const pieceLabel = k => (k === 'empty' ? 'Nothing' : (k[0] === 'w' ? 'White ' : 'Black ') + NAMES[k[1]]);
