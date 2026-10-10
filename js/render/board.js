// Canvas renderer. It reads the Game's engine state and paints; it decides nothing —
// no clause is "satisfied" here, no cell is judged wrong here — so the picture cannot
// disagree with the clause table that the win check and the hints both use.
//
// Layout lives here too (cell size from the container, board origin, DPR) because the
// sampling helpers below have to answer with the *same* numbers draw() used. Those two
// drifting apart is how a board renders correctly while the pixel gate measures air.
import { Palette, Board, Radius } from '../theme.js';
import { OFF, UNDRAWN } from '../ui/game.js';
import { pop, DR, DC, UP, RIGHT, DOWN, LEFT } from '../engine/rules.js';

export function layoutFor(rows, cols, availW, availH) {
  const pad = Board.pad;
  const size = Math.max(0, Math.min((availW - pad * 2) / cols, (availH - pad * 2) / rows));
  const cell = Math.max(Board.cellMin, Math.min(Board.cellMax, Math.floor(size)));
  return { cell, boardW: cell * cols, boardH: cell * rows, pad };
}

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = { cell: 0, x: 0, y: 0, w: 0, h: 0, dpr: 1 };
  }

  // The backing buffer is sized in device pixels while every draw call stays in CSS
  // pixels: one setTransform at the top keeps the strokes crisp on a Retina display
  // without doubling every constant in this file.
  resize(game, availW, availH) {
    const l = layoutFor(game.rows, game.cols, availW, availH);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const size = { w: l.boardW + l.pad * 2, h: l.boardH + l.pad * 2 };
    this.canvas.style.width = `${size.w}px`;
    this.canvas.style.height = `${size.h}px`;
    this.canvas.width = Math.round(size.w * dpr);
    this.canvas.height = Math.round(size.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geo = { cell: l.cell, x: l.pad, y: l.pad, w: size.w, h: size.h, dpr };
    this.game = game;
    return this.geo;
  }

  rectOf(i) {
    const { cell, x, y } = this.geo;
    const c = i % this.game.cols, r = (i / this.game.cols) | 0;
    return { x: c * cell + x, y: r * cell + y, size: cell, cx: c * cell + x + cell / 2, cy: r * cell + y + cell / 2 };
  }

  hitCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, x, y } = this.geo;
    const g = this.game;
    if (!cell || !g) return -1;
    const px = clientX - rect.left - x, py = clientY - rect.top - y;
    if (px < 0 || py < 0) return -1;
    const c = Math.floor(px / cell), r = Math.floor(py / cell);
    if (r < 0 || c < 0 || c >= g.cols || r >= g.rows) return -1;
    return r * g.cols + c;
  }

  // ── 取样位 ───────────────────────────────────────────────────────────────
  // These are the coordinates tools/scenarios.js paints its probes at. Each one is a
  // place where a *known, small* set of tokens can appear, and draw() must never put a
  // different token there — that pairing is the whole reason the pixel assertions can
  // fail when the picture is wrong.
  point(i, kind, d = null) {
    const { cell } = this.geo;
    const r = this.rectOf(i);
    if (kind === 'center') return { x: r.cx, y: r.cy };
    // 符号位的圆心与它的垫底半径是有不等式管着的：垫底那块是**盘底色**，一旦它的半径加上
    // 偏移越过 0.5 格，它就会啃掉邻居格的网格线/区域粗边——门禁在边上取样时量到的就是盘底，
    // 而玩家看到的是"边界在符号旁边断了一截"。0.22 + 1.35×0.19 = 0.4765 < 0.5。
    if (kind === 'symbol') return { x: r.cx + cell * 0.22, y: r.cy + cell * 0.22 };
    if (kind === 'off') return { x: r.cx - cell * 0.28, y: r.cy - cell * 0.28 };
    if (kind === 'frame') return { x: r.cx + cell * 0.38, y: r.cy - cell * 0.38 };
    if (kind === 'stroke') return { x: r.cx + cell * 0.4 * DC[d], y: r.cy + cell * 0.4 * DR[d] };
    if (kind === 'cap') return { x: r.cx + cell * 0.68 * DC[d], y: r.cy + cell * 0.68 * DR[d] };
    if (kind === 'border') {
      // 环跨过共享边就在这一边的**中点**：strokeShape 用的也是这个点，所以相邻两格各自的
      // 短线在同一点接上，不会在边界上拧出一个折角。
      return { x: r.cx + cell * 0.5 * DC[d], y: r.cy + cell * 0.5 * DR[d] };
    }
    if (kind === 'dash') {
      // 区域粗边的取样位：同一条边上，但沿边挪开 0.30 格。环带的半宽只有 0.08 格，
      // 所以这个点上只可能是网格线、区域粗边、违规红，绝不可能是环线。
      // 沿边方向是 d 的垂线，所以位移落在 DC 还是 DR 上要按 d 的轴向分派——写反一次
      // 就会把取样点挪进格子里（那里既没有粗边也没有网格线，量到的永远是盘底）。
      const along = (d === UP || d === DOWN) ? 'x' : 'y';
      return {
        x: r.cx + cell * (along === 'x' ? 0.3 : 0.5 * DC[d]),
        y: r.cy + cell * (along === 'x' ? 0.5 * DR[d] : 0.3),
      };
    }
    throw new Error('unknown sample kind: ' + kind);
  }

  draw(game, { pulse = null } = {}) {
    this.game = game;
    const { ctx, geo } = this;
    const { cell } = geo;
    const st = game.st;
    const plain = game.plain();
    const bad = game.badCells();
    ctx.clearRect(0, 0, geo.w, geo.h);
    roundRect(ctx, 0, 0, geo.w, geo.h, Radius.card);
    ctx.fillStyle = Palette.surface;
    ctx.fill();

    for (let i = 0; i < game.n; i++) {
      const r = this.rectOf(i);
      ctx.fillStyle = Palette.field;
      ctx.fillRect(r.x, r.y, cell, cell);
    }

    ctx.strokeStyle = Palette.gridLine;
    ctx.lineWidth = Math.max(1, cell * Board.borderThin);
    for (let c = 0; c <= game.cols; c++) line(ctx, geo.x + c * cell, geo.y, geo.x + c * cell, geo.y + game.rows * cell);
    for (let r = 0; r <= game.rows; r++) line(ctx, geo.x, geo.y + r * cell, geo.x + game.cols * cell, geo.y + r * cell);

    // 区域粗边：只在「两侧不同区」或「盘外」的共享边上画。它是这道题的骨架，比环线先画，
    // 环线在穿越处压过它——所以门禁量区域边时取样点沿边挪开，绕开环带。
    ctx.strokeStyle = Palette.roomBorder;
    ctx.lineWidth = Math.max(2, cell * Board.borderRoom);
    ctx.lineCap = 'butt';
    for (let i = 0; i < game.n; i++) {
      const rr = (i / game.cols) | 0, cc = i % game.cols;
      for (let d = 0; d < 4; d++) {
        const nr = rr + DR[d], nc = cc + DC[d];
        const inside = nr >= 0 && nr < game.rows && nc >= 0 && nc < game.cols;
        if (inside && game.room[nr][nc] === game.room[rr][cc]) continue;
        // 盘外那一圈不需要另一支笔：外沿就是「这一边没有邻居格」的那条边，point('border')
        // 给出的正是它自己的边中点，和内部跨区边完全同构。分成两个方法就是两处各自漂的轴向
        // 判断——它俩一旦漂开，玩家看到的边界和门禁量到的就不是同一条线。
        this.strokeBorder(ctx, i, d);
      }
    }

    for (let i = 0; i < game.n; i++) if (pop(st[i] === UNDRAWN ? 0 : st[i]) > 0) this.strokeShape(ctx, i, plain[i], bad.has(i));

    for (let i = 0; i < game.n; i++) {
      const s = game.sym[(i / game.cols) | 0][i % game.cols];
      if (s !== 'M' && s !== 'S') continue;
      this.strokeSymbol(ctx, i, s);
    }

    ctx.fillStyle = Palette.offMark;
    for (let i = 0; i < game.n; i++) {
      if (st[i] !== OFF) continue;
      const p = this.point(i, 'off');
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, cell * Board.offR), 0, Math.PI * 2);
      ctx.fill();
    }

    if (game.cursor >= 0 && game.cursor < game.n) {
      const r = this.rectOf(game.cursor);
      ctx.strokeStyle = Palette.cursor;
      ctx.lineWidth = Math.max(2, cell * 0.05);
      ctx.setLineDash([Math.max(4, cell * 0.2), Math.max(3, cell * 0.14)]);
      const k = cell * 0.12;
      roundRect(ctx, r.x + k, r.y + k, cell - k * 2, cell - k * 2, Radius.cell);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // What a hint just named — the only place the UI is allowed to say "look here".
    if (pulse && pulse.cell != null) {
      const r = this.rectOf(pulse.cell);
      ctx.strokeStyle = pulse.color || Palette.hint;
      ctx.lineWidth = Math.max(2.5, cell * 0.09);
      roundRect(ctx, r.x + 2, r.y + 2, cell - 4, cell - 4, Radius.cell);
      ctx.stroke();
    }
  }

  strokeBorder(ctx, i, d) {
    const p = this.point(i, 'border', d);
    const { cell } = this.geo;
    // 整条共享边都描上粗边：区域边界是这道题的骨架，它必须读成一条连续的墙，
    // 而不是边界中点旁边的一段短划。沿边方向同样是 d 的垂线。
    const vertical = d === LEFT || d === RIGHT;
    const half = cell / 2;
    ctx.lineWidth = Math.max(2, cell * Board.borderRoom);
    ctx.beginPath();
    if (vertical) { ctx.moveTo(p.x, p.y - half); ctx.lineTo(p.x, p.y + half); }
    else { ctx.moveTo(p.x - half, p.y); ctx.lineTo(p.x + half, p.y); }
    ctx.stroke();
  }

  strokeShape(ctx, i, mask, isBad) {
    const { cell } = this.geo;
    const w = Math.max(3, cell * Board.loopWidth);
    ctx.strokeStyle = isBad ? Palette.error : Palette.loop;
    ctx.lineCap = 'round';
    for (let d = 0; d < 4; d++) {
      if (!((mask >> d) & 1)) continue;
      const e = this.point(i, 'border', d);
      const r = this.rectOf(i);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(r.cx, r.cy);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // 度数 1 的那一头：点在线头上，读作「这里还欠一条」，不是「画错了」。
    if (pop(mask) === 1) {
      for (let d = 0; d < 4; d++) {
        if (!((mask >> d) & 1)) continue;
        const p = this.point(i, 'cap', d);
        ctx.fillStyle = Palette.cap;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2.5, cell * Board.capR), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  strokeSymbol(ctx, i, s) {
    const { cell } = this.geo;
    const p = this.point(i, 'symbol');
    const rad = Math.max(3, cell * Board.symbolR);
    // 先在符号位垫一块盘底色，环线才读成「从符号背后穿过」而不是糊在符号上。
    // 半径与偏移受上面那条不等式管着（越过 0.5 格就会啃掉边界线）。
    ctx.fillStyle = Palette.field;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s === 'M' ? Palette.moon : Palette.sun;
    ctx.strokeStyle = s === 'M' ? Palette.moon : Palette.sun;
    ctx.lineWidth = Math.max(1.5, cell * Board.symbolR * 0.24);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad * 0.62, 0, Math.PI * 2);
    ctx.fill();
    if (s === 'M') {
      // 月牙：拿盘底色啃掉右上那一口，所以形状本身也读得出来，不只靠颜色。
      // 用 destination-out 会把垫底那块连卡片一起擦穿（透出的是页面背景而不是 field），
      // 那样「月亮」和「这里有个洞」在像素上就分不开。
      // 啃的口必须**够不到圆心的取样位**：offset 0.42 时缺口内壁离圆心只有 0.014×rad，
      // 那一个像素是被抗锯齿糊成半色的——门禁读到的"月亮"于是有四颗是糊的。现在内壁在
      // 0.778−0.55 = 0.228×rad 之外，缺口又仍与圆盘相交（0.778 < 0.62+0.55），形状照样是月牙。
      ctx.fillStyle = Palette.field;
      ctx.beginPath();
      ctx.arc(p.x + rad * 0.55, p.y - rad * 0.55, rad * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI / 4) * k;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * rad * 0.85, p.y + Math.sin(a) * rad * 0.85);
        ctx.lineTo(p.x + Math.cos(a) * rad * 1.2, p.y + Math.sin(a) * rad * 1.2);
        ctx.stroke();
      }
    }
  }
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
