// A plain chess board: draws a position, last move, arrows and a move badge; reports clicks and drags as moves.
const FILES = 'abcdefgh';
export class Board {
  constructor(el, opts) {
    this.el = el; this.opts = opts || {}; this.sel = null; this.view = {};
    el.classList.add('board');
    el.addEventListener('click', e => this.onClick(e));
    el.addEventListener('dragstart', e => { const s = e.target.closest('.sq'); if (!s || !this.canPick(s.dataset.sq)) { e.preventDefault(); return; } this.pick(s.dataset.sq); e.dataTransfer.setData('text/plain', s.dataset.sq); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', e => { if (this.sel) e.preventDefault(); });
    el.addEventListener('drop', e => { const s = e.target.closest('.sq'); e.preventDefault(); if (s && this.sel) this.tryMove(this.sel, s.dataset.sq); });
  }
  // view: { fen, flipped, last: [from, to], arrows: [{ from, to, kind }], badge: { sq, cls, text }, movable: 'w' | 'b' | null }
  // Only what changed is touched: the squares and pieces stay in place between moves, so nothing flashes on phones.
  render(view) {
    this.view = view; this.sel = null;
    const rows = view.fen.split(' ')[0].split('/'), at = {};
    rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { at[FILES[f] + (8 - r)] = ch; f++; } } });
    this.at = at;
    if (!this.sqs || this.flip !== !!view.flipped) this.build(!!view.flipped);
    this.el.classList.toggle('nocoord', !!view.nocoord); this.el.classList.toggle('tapping', !!view.tap);
    for (const sq in this.sqs) {
      const el = this.sqs[sq], p = at[sq], f = FILES.indexOf(sq[0]), r = +sq[1];
      const cls = 'sq ' + ((f + r) % 2 ? 'dark' : 'light') + (view.last && view.last.includes(sq) ? ' last' : '') + (view.marks && view.marks[sq] ? ' mk-' + view.marks[sq] : '');
      if (el.className !== cls) el.className = cls;
      const kind = p ? (p === p.toUpperCase() ? 'w' : 'b') + p.toUpperCase() : '';
      let pc = el.querySelector('.pc');
      if (!kind) { if (pc) pc.remove(); }
      else {
        if (!pc) { pc = document.createElement('i'); pc.setAttribute('role', 'img'); el.appendChild(pc); }
        const pcls = 'pc p-' + kind;
        if (pc.className !== pcls) { pc.className = pcls; pc.setAttribute('aria-label', p); }
        const d = String(!!view.movable);
        if (pc.getAttribute('draggable') !== d) pc.setAttribute('draggable', d);
      }
      let bd = el.querySelector('.badge');
      const want = view.badge && view.badge.sq === sq ? view.badge : null;
      if (!want) { if (bd) bd.remove(); }
      else {
        if (!bd) { bd = document.createElement('b'); el.appendChild(bd); }
        bd.className = 'badge c-' + want.cls; if (bd.textContent !== want.text) bd.textContent = want.text;
      }
    }
    const c = sq => { const f = FILES.indexOf(sq[0]), r = +sq[1]; return [(view.flipped ? 7 - f : f) + 0.5, (view.flipped ? r - 1 : 8 - r) + 0.5]; };
    const lines = (view.arrows || []).map(a => { const p = c(a.from), q = c(a.to), dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1, k = (len - 0.32) / len;
      return '<line class="arrow a-' + a.kind + '" x1="' + p[0] + '" y1="' + p[1] + '" x2="' + (p[0] + dx * k) + '" y2="' + (p[1] + dy * k) + '" marker-end="url(#ah-' + a.kind + ')"/>'; }).join('');
    if (this.arrowG.dataset.k !== lines) { this.arrowG.innerHTML = lines; this.arrowG.dataset.k = lines; }
  }
  build(flipped) {
    this.flip = flipped; this.sqs = {};
    let h = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const f = flipped ? 7 - x : x, r = flipped ? y + 1 : 8 - y, sq = FILES[f] + r;
      h += '<div class="sq" data-sq="' + sq + '">' + (x === 0 ? '<i class="rank">' + r + '</i>' : '') + (y === 7 ? '<i class="file">' + FILES[f] + '</i>' : '') + '</div>';
    }
    h += '<svg class="arrows" viewBox="0 0 8 8" aria-hidden="true"><defs>' + ['best', 'line', 'bad'].map(k => '<marker id="ah-' + k + '" viewBox="0 0 4 4" refX="2.2" refY="2" markerWidth="2.6" markerHeight="2.6" orient="auto"><path class="ah a-' + k + '" d="M0 0L4 2L0 4z"/></marker>').join('') + '</defs><g></g></svg>';
    this.el.innerHTML = h;
    this.el.querySelectorAll('.sq').forEach(s => { this.sqs[s.dataset.sq] = s; });
    this.arrowG = this.el.querySelector('svg.arrows g');
  }
  canPick(sq) { const p = this.at[sq], m = this.view.movable; return !!p && !!m && (p === p.toUpperCase() ? 'w' : 'b') === m; }
  pick(sq) {
    this.sel = sq;
    const dests = this.opts.dests ? this.opts.dests(sq) : [];
    this.el.querySelectorAll('.sq').forEach(s => { s.classList.toggle('sel', s.dataset.sq === sq); s.classList.toggle('dest', dests.includes(s.dataset.sq)); });
  }
  tryMove(from, to) { this.sel = null; if (from !== to && this.opts.onMove) this.opts.onMove(from, to); else this.render(this.view); }
  onClick(e) {
    const s = e.target.closest('.sq');
    if (s && this.view.tap && this.opts.onTap) { this.opts.onTap(s.dataset.sq); return; } // drills: a tap names a square
    if (!s || !this.view.movable) return;
    const sq = s.dataset.sq;
    if (this.sel && this.sel !== sq && !this.canPick(sq)) this.tryMove(this.sel, sq);
    else if (this.sel && this.sel !== sq && s.classList.contains('dest')) this.tryMove(this.sel, sq);
    else if (this.canPick(sq)) this.pick(sq);
    else { this.sel = null; this.render(this.view); }
  }
}
