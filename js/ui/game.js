// 一局的状态机：盘面 = 题面（区域 + 符号），玩家的手 = 每格一个「形状」。
//
// 为什么按格存形状而不是按边存：这道题的引擎模型就是 per-cell 的 4 bit 链接掩码
// （js/engine/rules.js），UI 用同一个模型，判胜就能直接把整个数组交给 checks()——
// 中间不需要一层「边数组 → 掩码」的翻译。那层翻译正是画面对、判定错的地方。
//
// 三个可区分的读数必须存得下也画得出：没动过（UNDRAWN）、钉成不在环上（OFF）、
// 在环上的六种形状（PAIRS）。少了 UNDWRN 那一档，「擦掉」和「擦成留空」在盘上就长一个样。
import { checks, pop, bit, UP, RIGHT, DOWN, LEFT, OPP, DR, DC, PAIRS } from '../engine/rules.js';

export const UNDRAWN = -1;
export const OFF = 0;
// 点击一格就是在这条环里往前滚一格：留空 → 不在环上 → 直横 → 直竖 … 六种拐/直都轮完再回到没画。
export const SHAPE_CYCLE = [UNDRAWN, OFF, ...PAIRS];
export const SHAPE_NAME = {
  [UNDRAWN]: '没画', [OFF]: '不在环上',
  [bit(UP) | bit(DOWN)]: '竖穿', [bit(LEFT) | bit(RIGHT)]: '横穿',
  [bit(UP) | bit(RIGHT)]: '上右拐', [bit(RIGHT) | bit(DOWN)]: '右下拐',
  [bit(DOWN) | bit(LEFT)]: '下左拐', [bit(LEFT) | bit(UP)]: '左上拐',
};
export const DIR_NAME = { [UP]: '上', [RIGHT]: '右', [DOWN]: '下', [LEFT]: '左' };

export class Game {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.rows = puzzle.rows;
    this.cols = puzzle.cols;
    this.n = this.rows * this.cols;
    this.room = puzzle.room;
    this.sym = puzzle.sym;
    this.st = new Int16Array(this.n).fill(UNDRAWN);
    this.cursor = 0;
    this.moves = [];
    this.status = 'playing';
    this.hints = 0;
  }

  id = (r, c) => r * this.cols + c;
  rc = (i) => [(i / this.cols) | 0, i % this.cols];

  shapeAt(i) { return this.st[i]; }

  // 交给引擎的那份掩码：没画 = 这一格不在环上。玩家还没落笔的格和钉成留空的格，
  // 对判胜来说同值（都没线经过），区别只在画面上（见 render/board.js 的取样位）。
  plain() {
    const m = new Int16Array(this.n);
    for (let i = 0; i < this.n; i++) m[i] = this.st[i] === UNDRAWN ? 0 : this.st[i];
    return m;
  }

  violations() { return checks(this.puzzle, this.plain()); }

  // 环没闭合之前不评判区域：一个只画了一半的环去数「每个区穿两次」必然全是红的，
  // 那种红会把真正接不通的地方淹没。所以线头（度数 1、单边不对称）在场时只报线头。
  report() {
    const v = this.violations();
    const stubs = v.filter((x) => x.level === 'warn');
    return stubs.length ? stubs : v;
  }

  badCells() { return new Set(this.report().flatMap((x) => x.cells)); }

  stubs() {
    const out = [];
    const m = this.plain();
    for (let i = 0; i < this.n; i++) {
      for (let d = 0; d < 4; d++) {
        if (!((m[i] >> d) & 1)) continue;
        const j = this.nb(i, d);
        if (j < 0 || !((m[j] >> OPP[d]) & 1)) out.push([i, d]);
      }
    }
    return out;
  }

  nb(i, d) {
    const rr = ((i / this.cols) | 0) + DR[d], cc = (i % this.cols) + DC[d];
    if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) return -1;
    return rr * this.cols + cc;
  }

  get drawnCells() { let k = 0; for (let i = 0; i < this.n; i++) if (pop(this.plain()[i]) === 2) k++; return k; }
  get markedCells() { let k = 0; for (let i = 0; i < this.n; i++) if (this.st[i] === OFF) k++; return k; }
  get touchedCells() { let k = 0; for (let i = 0; i < this.n; i++) if (this.st[i] !== UNDRAWN) k++; return k; }
  get roomCount() { return this.room.flat().reduce((a, k) => Math.max(a, k + 1), 0); }
  get clueCount() { return this.sym.flat().filter((v) => v !== '.').length; }

  write(i, shape, { record = true } = {}) {
    if (i < 0 || i >= this.n) return false;
    if (this.st[i] === shape) return false;
    if (record) this.moves.push({ i, from: this.st[i], to: shape });
    this.st[i] = shape;
    return true;                  // 状态归 main.js 的 afterMove() 写：判胜只有一处入口
  }

  cycle(i, step = 1) {
    const at = SHAPE_CYCLE.indexOf(this.st[i]);
    const k = (at + step + SHAPE_CYCLE.length) % SHAPE_CYCLE.length;
    return this.write(i, SHAPE_CYCLE[k]);
  }

  undo() {
    const m = this.moves.pop();
    if (!m) return null;
    this.st[m.i] = m.from;
    this.cursor = m.i;
    return m;
  }

  clearMarks() {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.st[i] !== UNDRAWN) { this.moves.push({ i, from: this.st[i], to: UNDRAWN }); this.st[i] = UNDRAWN; k++; }
    return k;
  }

  wonNow() {
    const v = this.violations();
    return v.length === 0 && this.drawnCells > 0;
  }

  // 存档只需要 seed：同一个 seed 由引擎重画同一张盘，笔迹才是这里唯一要存的东西。
  snapshot() {
    return { st: Array.from(this.st), cursor: this.cursor, moves: this.moves.length, history: this.moves.slice(-64) };
  }

  restore(snap) {
    if (!snap || !Array.isArray(snap.st) || snap.st.length !== this.n) return false;
    for (let i = 0; i < this.n; i++) this.st[i] = snap.st[i];
    this.cursor = snap.cursor >= 0 && snap.cursor < this.n ? snap.cursor : 0;
    this.moves = Array.isArray(snap.moves) ? snap.moves.slice() : [];
    this.status = this.wonNow() ? 'won' : 'playing';
    return true;
  }
}
