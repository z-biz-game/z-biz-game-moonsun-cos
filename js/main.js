// 接线：DOM、指针、键盘、时钟、存档，以及验收 harness 驱动的 window.moonsun 那层门面。
//
// 两条规矩贯穿这个文件：
//   1) 判胜不在这里。这一层只调 engine 的 checks()/solve()，把结论念出来；自己没有任何记分板，
//      所以「画面好看但引擎没同意」的那种赢法在这里不可能发生。
//   2) 提示也不在这里发明规则。它问的是铅笔（js/engine/pencil.js 的具名规则求解器）：
//      铅笔推出的结论玩家还没做，就pulse那一格并把话说一半——说「看这里、这格一定（不）在环上」，
//      不说「画成这个形状」。铅笔推不动时它就说推不动，不会替玩家猜，也不会去翻答案。
import { makePuzzle, toView } from './engine/generate.js';
import { TIERS, ELIMINATED, eliminatedLine, SIZES, parseSize, CAP_WORK } from './engine/tiers.js';
import { checks, countSolutions, pop, bit, UP, RIGHT, DOWN, LEFT, OPP, CLAUSE_TEXT, PAIRS } from './engine/rules.js';
import { solve, RULE_TEXT, RULE_ORDER } from './engine/pencil.js';
import { Game, SHAPE_CYCLE, SHAPE_NAME, UNDRAWN, OFF } from './ui/game.js';
import { BoardView } from './render/board.js';
import { Store } from './store.js';
import { Palette, Space, applyThemeVars, setReduceMotion, prefersReducedMotion } from './theme.js';

const VERSION = '1.0.0';

applyThemeVars();

const $ = (sel) => document.querySelector(sel);
const canvas = $('#board');
const view = new BoardView(canvas);

let puzzle = null;
let game = null;
let elapsedMs = 0;
let timer = null;
let pulse = null;
let pencil = null;          // 这一盘的铅笔推导结果（第一次按提示时算，之后复用）
let busy = false;
let said = null;            // 状态行上下一句要念的话（提示／作废），见 paintStatus
const say = (m) => { said = m; $('#state-line').textContent = m; };

// ── 面板文案：规则表从引擎拿，不在 HTML 里另抄一份 ──────────────────────────
// README 的条款表和这里读的是同一张 CLAUSE_TEXT/RULE_TEXT，doctest 逐条对账；
// 页面上手抄一份副本的话，改引擎不会让页面变红，那才是真的说谎。
function fillClauseLists() {
  const codes = ['degree', 'asym', 'disjoint', 'edge', 'cross', 'symbol', 'alternation'];
  $('#clause-list').replaceChildren(...codes.map((c) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = { degree: '每格两条线', asym: '两头都要接上', disjoint: '一条不许分段', edge: '不许出盘', cross: '每区穿两次', symbol: '区域的符号', alternation: '月日交替' }[c];
    li.append(b, document.createTextNode('：' + CLAUSE_TEXT[c]));
    return li;
  }));
  $('#rule-list').replaceChildren(...RULE_ORDER.map((name) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${name}</b>：${RULE_TEXT[name]}`;
    return li;
  }));
  $('#size-note').replaceChildren(...ELIMINATED.map((e) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${e.rows}×${e.cols}</b>：${eliminatedLine(e).replace(/^\d+×\d+：/, '')}`;
    return li;
  }));
  $('#shape-legend').replaceChildren(...SHAPE_CYCLE.map((v, k) => {
    const span = document.createElement('span');
    span.className = 'chip mono';
    span.textContent = `${k === 0 ? '⌫/空格' : k}: ${SHAPE_NAME[v]}`;
    return span;
  }));
  const sel = $('#size-select');
  sel.replaceChildren(...TIERS.map((t) => {
    const o = document.createElement('option');
    o.value = t.key;
    o.textContent = t.label;
    return o;
  }));
}

// ── 渲染 ──────────────────────────────────────────────────────────────────
function relayout() {
  if (!game) return;
  const wrap = $('#board-wrap');
  const w = Math.max(240, wrap.clientWidth || 320);
  const h = Math.max(240, Math.min(w, (window.innerHeight || 600) - 260));
  view.resize(game, w, h);
}

function render() {
  if (!game) return;
  view.draw(game, { pulse: pulse && Date.now() < pulse.until ? pulse : null });
  paintStatus();
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function paintStatus() {
  const g = game;
  const v = g.report();
  const stubs = g.stubs().length;
  $('#stat-seed').textContent = `seed ${g.puzzle.seed} · ${g.puzzle.attempts > 1 ? `${g.puzzle.attempts} 试` : '一发'}`;
  $('#stat-time').textContent = fmtTime(elapsedMs);
  $('#stat-rooms').textContent = g.roomCount;
  $('#stat-clues').textContent = `${g.clueCount}/${g.n}`;
  $('#stat-drawn').textContent = g.drawnCells;
  $('#stat-off').textContent = g.markedCells;
  $('#stat-open').textContent = g.n - g.touchedCells;
  $('#stat-stubs').textContent = stubs;
  $('#stat-bad').textContent = v.filter((x) => x.level === 'error').length;
  $('#stat-moves').textContent = g.moves.length;
  // 「引擎说」只数 error 级：一格没画的空盘在 report() 里有一条 warn（还没画），把它念成
  // 「1 处不合」等于开局就告诉玩家你错了。warn 归线头那一格念。
  const errs = v.filter((x) => x.level === 'error').length;
  $('#stat-verify').textContent = g.status === 'won' ? '合法' : errs ? `${errs} 处不合` : '还差线索';
  const line = $('#state-line');
  // 「提示」和「存档作废」那两句话是 render() 之前的任何一次落笔都不会再说一遍的：
  // 直接写 textContent 会被这里的状态行覆盖，那等于提示只有画面上的一个框、没有解释。
  // 所以把它们交给 say()，由状态行的唯一写者在本帧念完之后擦掉。
  if (busy) line.textContent = '出题中：引擎正在铺环、切区域、挖线索，并用两道判据验这一张盘…';
  else if (said) { line.textContent = said; said = null; }
  else if (g.status === 'won') line.textContent = `成了。一条闭合的环，每个区域穿两次，沿环月·日交替——${fmtTime(elapsedMs)}，${g.moves.length} 步。`;
  else if (!v.length) line.textContent = '环闭合了；每一个区域都要被穿两次，沿环月·日交替。';
  else {
    const c = v[0].cells.length ? v[0].cells[0] : -1;
    const at = c >= 0 ? `（第 ${(c / g.cols | 0) + 1} 行第 ${c % g.cols + 1} 格起）` : '';
    line.textContent = `${{ degree: '这一格的线不是两条', asym: '这头和那头没接上', disjoint: '环还没连成一圈', empty: '还没画' }[v[0].code] || CLAUSE_TEXT[v[0].code]}${at}`;
  }
  $('#sr-cell').textContent = `光标在第 ${(game.cursor / g.cols | 0) + 1} 行第 ${game.cursor % g.cols + 1} 格，形状 ${SHAPE_NAME[game.st[game.cursor]]}`;
}

// ── 新局 ──────────────────────────────────────────────────────────────────
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

function mintSeed() {
  // 默认 seed 不能是按日期算的：那等于界面在说谎——同一个 seed 该画同一张盘，
  // 而「今天的 seed」每过一天就换一批玩家拿不到的东西。
  return (Math.random() * 0x7fffffff) | 0;
}

async function newGame({ sizeKey = null, seed = null, resumeFrom = null } = {}) {
  busy = true;
  const cur = $('#size-select').value;
  const key = sizeKey || (SIZES.includes(cur) ? cur : TIERS[0].key);
  $('#size-select').value = key;
  $('#state-line').textContent = '出题中：引擎正在铺环、切区域、挖线索，并用两道判据验这一张盘…';
  const useSeed = seed == null ? mintSeed() : seed >>> 0;
  const p = await makePuzzle(key, useSeed, { tick: yieldFrame });
  if (p.fail) {
    busy = false;
    $('#state-line').textContent = `出题失败：${p.fail}。换一档尺寸或再按一次换一局。`;
    return null;
  }
  puzzle = p;
  game = new Game(p);
  pencil = null;
  pulse = null;
  elapsedMs = 0;
  let resumed = null;
  if (resumeFrom) {
    resumed = Store.resume(p);
    if (resumed && !game.restore(resumed)) resumed = null;
  }
  // 时钟同样是存下来的东西：续局之后从 00:00 重新数，等于界面在说一局两小时的棋只走了两秒。
  if (resumed) elapsedMs = typeof resumed.elapsedMs === 'number' ? resumed.elapsedMs : 0;
  if (!resumed && resumeFrom) {
    say('存档里的盘面和引擎重画出来的对不上，已作废存档、开了一局新的。');
    Store.clear();
  }
  busy = false;
  relayout();
  render();
  hideVeil();
  persist();
  return game;
}

function persist() {
  if (game && puzzle) Store.save(puzzle, game, elapsedMs, game.status === 'won');
}

// ── 判胜：只问引擎 ─────────────────────────────────────────────────────────
// 落子之后唯一的判胜入口：Game 自己不改状态，状态只在这里由引擎的结论写。
function afterMove() {
  if (!game) return false;
  const won = game.violations().length === 0 && game.drawnCells > 0;
  if (won) {
    stopTimer();
    $('#win-meta').textContent = `${puzzle.sizeKey} · ${game.roomCount} 个区域 · ${game.clueCount} 条线索 · ${game.drawnCells} 格在环上 · ${fmtTime(elapsedMs)} · ${game.moves.length} 步 · hints ${game.hints}`;
    $('#win-veil').hidden = false;
    if (!prefersReducedMotion()) canvas.classList.add('won');
  } else {
    game.status = 'playing';
    hideVeil();
    canvas.classList.remove('won');
  }
  return won;
}

function hideVeil() {
  $('#win-veil').hidden = true;
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (game && game.status !== 'won') {
      elapsedMs += 250;
      $('#stat-time').textContent = fmtTime(elapsedMs);
    }
  }, 250);
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ── 提示：问铅笔要下一条被迫的结论 ──────────────────────────────────────────
function hint() {
  if (!game || game.status === 'won') return;
  if (!pencil) pencil = solve(toView(puzzle));
  if (!pencil.done) {
    pulse = { cell: null, until: 0, color: Palette.error };
    say('铅笔（具名规则）在这盘上推不动了，剩下的要靠猜——这种局不该出现在出货里（判据 2）。');
    render();
    return;
  }
  const plain = game.plain();
  let cell = -1, why = '';
  for (let i = 0; i < game.n; i++) {
    if (plain[i] === pencil.mask[i]) continue;
    if (game.st[i] === UNDRAWN && pop(pencil.mask[i]) === 0) continue;   // 没画的空格不算「做错」
    cell = i;
    why = pop(pencil.mask[i]) === 2 ? '环一定经过这一格：看它接进来的两条线该往哪两头。' : '环一定不经过这一格：把它钉成留空。';
    break;
  }
  if (cell < 0) {
    say('铅笔的每一步你都已经落笔了——那就只剩把它接起来。');
    return;
  }
  game.hints++;
  game.cursor = cell;
  pulse = { cell, until: Date.now() + 1800, color: Palette.hint };
  say(`看第 ${(cell / game.cols | 0) + 1} 行第 ${(cell % game.cols) + 1} 格：${why}`);
  render();
}

// ── 输入 ──────────────────────────────────────────────────────────────────
function writeCell(i, step) {
  if (i < 0 || !game || game.status === 'won') return;
  game.cursor = i;
  if (step === 0) return;
  if (step > 0) game.cycle(i, 1);
  else game.cycle(i, -1);
  afterMove();
  render();
  persist();
}

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.focus();
  const i = view.hitCell(ev.clientX, ev.clientY);
  writeCell(i, ev.button === 2 || ev.button === 1 ? -1 : 1);
});
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

const KEYS = {
  ArrowUp: [UP], ArrowRight: [RIGHT], ArrowDown: [DOWN], ArrowLeft: [LEFT],
};

window.addEventListener('keydown', (ev) => {
  if (!game) return;
  const k = ev.key;
  if (KEYS[k]) {
    ev.preventDefault();
    const d = KEYS[k][0];
    game.cursor = game.nb(game.cursor, d);
    if (game.cursor < 0) game.cursor = 0;
    render();
    return;
  }
  if (k === ' ' || k === 'Enter') { ev.preventDefault(); writeCell(game.cursor, 1); return; }
  if (k === 'Backspace' || k === 'Delete') {
    ev.preventDefault();
    if (game.status !== 'won') { game.write(game.cursor, UNDRAWN); render(); persist(); }
    return;
  }
  if (/^[0-6]$/.test(k)) {
    ev.preventDefault();
    game.write(game.cursor, SHAPE_CYCLE[Number(k) + 1]);
    afterMove();
    render();
    persist();
    return;
  }
  const lk = k.toLowerCase();
  if (lk === 'h') { hint(); return; }
  if (lk === 'z') { game.undo(); afterMove(); render(); persist(); return; }
  if (lk === 'c') { game.clearMarks(); hideVeil(); afterMove(); render(); persist(); return; }
  if (lk === 'n') { newGame({ seed: mintSeed() }); return; }
});

$('#btn-new').addEventListener('click', () => newGame({ seed: mintSeed() }));
$('#btn-again').addEventListener('click', () => newGame({ seed: mintSeed() }));
$('#btn-close-veil').addEventListener('click', hideVeil);
$('#btn-hint').addEventListener('click', () => hint());
$('#btn-undo').addEventListener('click', () => { if (game) { game.undo(); afterMove(); render(); persist(); } });
$('#btn-clear').addEventListener('click', () => { if (game) { game.clearMarks(); afterMove(); render(); persist(); } });
$('#btn-motion').addEventListener('click', (ev) => {
  const next = !prefersReducedMotion();
  setReduceMotion(next);
  // css 那一头也要收到话：只改 JS 标志的话，canvas 不抖了、按钮却还在缩。
  document.documentElement.classList.toggle('reduce-motion', next);
  ev.currentTarget.setAttribute('aria-pressed', String(next));
  ev.currentTarget.textContent = next ? '动效 简' : '动效 全';
  render();
});
$('#btn-reset').addEventListener('click', async () => {
  Store.clear();
  await newGame({ seed: mintSeed() });
});
$('#size-select').addEventListener('change', async () => {
  Store.clear();
  await newGame({ sizeKey: $('#size-select').value, seed: mintSeed() });
});
window.addEventListener('resize', () => { relayout(); render(); });
window.addEventListener('pagehide', persist);

// ── 门面 ──────────────────────────────────────────────────────────────────
window.moonsun = {
  version: VERSION,
  state: 'booting',
  engine: {
    makePuzzle, toView, parseSize, TIERS, SIZES, ELIMINATED, CAP_WORK,
    solve, countSolutions, checks, pop, bit, OPP, PAIRS, CLAUSE_TEXT, RULE_TEXT, RULE_ORDER,
    UP, RIGHT, DOWN, LEFT, UNDRAWN, OFF, SHAPE_CYCLE, SHAPE_NAME,
  },
  view,
  get game() { return game; },
  get puzzle() { return puzzle; },
  get won() { return !!game && game.status === 'won'; },
  get elapsed() { return elapsedMs; },
  hint,
  newGame,
  mintSeed,
  afterMove,
  render,
  relayout,
  hideVeil,
  writeCell,
  store: Store,
  palette: Palette,
  space: Space,
};

// ── 启动 ──────────────────────────────────────────────────────────────────
(async function boot() {
  fillClauseLists();
  startTimer();
  const pending = Store.pendingResume();
  if (pending) await newGame({ sizeKey: pending.sizeKey, seed: pending.seed, resumeFrom: pending });
  else await newGame({});
  window.moonsun.state = 'ready';
})();
