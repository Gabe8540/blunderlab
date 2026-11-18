// Talks UCI to a Stockfish worker. One search at a time; later requests wait their turn.
export class Engine {
  // port: { post(cmd), listen(fn) } - a Worker in the page, an adapter in tests
  constructor(port) {
    this.port = port; this.queue = Promise.resolve(); this.cur = null; this.ready = null;
    port.listen(line => this.onLine(String(line)));
  }
  static worker(url) {
    const w = new Worker(url);
    return new Engine({ post: c => w.postMessage(c), listen: fn => { w.onmessage = e => fn(e.data); }, kill: () => w.terminate() });
  }
  init() {
    if (!this.ready) this.ready = new Promise(res => { this.onReady = res; this.port.post('uci'); this.port.post('isready'); });
    return this.ready;
  }
  onLine(line) {
    if (line === 'readyok' && this.onReady) { this.onReady(); this.onReady = null; return; }
    const c = this.cur;
    if (!c) return;
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const m = /\bdepth (\d+)\b.*?\bmultipv (\d+)\b.*?\bscore (cp|mate) (-?\d+)(?: (upperbound|lowerbound))?\b.*?\bpv (.+)$/.exec(line);
      if (!m || m[5]) return; // bounds are not real scores yet
      const l = { depth: +m[1], pv: m[6].trim().split(/\s+/) };
      if (m[3] === 'cp') l.cp = +m[4]; else l.mate = +m[4];
      c.lines[+m[2] - 1] = l;
      if (c.onInfo) c.onInfo(c.lines.filter(Boolean));
    } else if (line.startsWith('bestmove')) {
      this.cur = null;
      c.done({ lines: c.lines.filter(Boolean), best: line.split(' ')[1] });
    }
  }
  // Search one position. Scores are for the side to move. opts: { depth, multipv, movetime, onInfo, skip }
  analyse(fen, opts) {
    opts = opts || {};
    const run = () => this.init().then(() => opts.skip && opts.skip() ? { lines: [], best: null, skipped: true } : new Promise(done => { // skip: the request went stale while waiting
      this.cur = { lines: [], onInfo: opts.onInfo, done };
      if (this.mpv !== (opts.multipv || 1)) { this.mpv = opts.multipv || 1; this.port.post('setoption name MultiPV value ' + this.mpv); }
      this.port.post('position fen ' + fen);
      this.port.post('go depth ' + (opts.depth || 12) + (opts.movetime ? ' movetime ' + opts.movetime : ''));
    }));
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }
  stop() { if (this.cur) this.port.post('stop'); }
  // Set a UCI option, in turn with the searches.
  option(name, value) { this.queue = this.queue.then(() => this.init()).then(() => { this.port.post('setoption name ' + name + ' value ' + value); }).catch(() => {}); }
  newGame() { this.queue = this.queue.then(() => { this.port.post('ucinewgame'); }); }
}

// Analyse every position of a game. onStep(done, total). Returns evals[] (one per position, final one included).
export async function analyseGame(engine, game, helpers, opts, onStep, cancelled) {
  const fens = [game.start].concat(game.plies.map(p => p.after)), evals = [];
  const efens = [game.estart || game.start].concat(game.plies.map(p => p.eafter || p.after)); // Chess960: with its castling rights
  engine.newGame();
  for (let i = 0; i < fens.length; i++) {
    if (cancelled && cancelled()) return null;
    const over = helpers.terminalScore(fens[i]);
    if (over) evals.push({ lines: [over], legal: 0 });
    else {
      const r = await engine.analyse(efens[i], { depth: opts.depth, multipv: 2, movetime: opts.movetime });
      evals.push({ lines: r.lines.map(l => { const o = { pv: l.pv.slice(0, 10) }; if (l.mate != null) o.mate = l.mate; else o.cp = l.cp; return o; }), legal: helpers.legalCount(fens[i]) });
    }
    if (onStep) onStep(i + 1, fens.length);
  }
  return evals;
}
