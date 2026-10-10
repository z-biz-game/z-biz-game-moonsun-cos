// 颜色、间距、动效的唯一来源。样式表通过 applyThemeVars() 读这些值，canvas 读的是同一批对象，
// 所以改一个令牌不可能只改到一边。
//
// 下面几组是**被门禁量过的**取样色：tools/scenarios.js 在四个不同的位置取像素——
//   格心（没画 / 你画的环）、符号位（月亮 / 太阳 / 没符号）、留空点位（钉成不在环上 / 没动过）、
//   区域边界（细网格线 / 区域粗边 / 违规红边）。
// 每个位置上的几种可能必须两两拉开 ≥25 的逐通道距离，否则「画错了」和「还没画」能在像素上
// 互相冒充。距离矩阵由那条腿当场算并打印——注释里不写数字，因为下一次改色它就漂。
export const Palette = {
  bgTop: '#070A14',
  bgBottom: '#141A2C',
  surface: '#111624',
  surfaceLift: '#1A2036',
  ink: '#F2F5FB',
  inkDim: 'rgba(242,245,251,0.62)',
  inkFaint: 'rgba(242,245,251,0.34)',
  // css 的描边色。它是被样式表用 `var(--line)` 引用着的令牌：名字没在 Palette 里，
  // 整条 border 简写就废掉，卡片会没有边——core 腿逐条数过样式表里的 var()。
  line: '#2A3142',
  accent: '#4CD9B0',
  info: '#7BB8FF',
  success: '#3DDC91',
  error: '#FF4D5E',
  warn: '#FFB03D',
  focus: 'rgba(123,184,255,0.16)',

  // 盘面（网格里面那一层）。它故意取中性偏冷的深色而不是藏蓝：太阳色 #FFB03D 的蓝道只有 61，
  // 盘底的蓝再高一点就会在 B 通道上和太阳贴脸，那正是「画了太阳」读成「什么都没画」的那种事故。
  field: '#171A22',
  gridLine: '#2A2E3A',
  // 区域边界：整张盘的骨架，必须比细网格线亮一档，玩家第一眼要能数出有几个区。
  roomBorder: '#8A93A8',

  // 你画的环。薄荷绿而不是琥珀：琥珀和太阳同族，玩家会把「画了一段环」看成「这里有个线索」。
  loop: '#4CD9B0',
  // 还没接上的线头：淡紫点一下，读作「这头还欠一条」。它与环(薄荷)、违规(红)在同一批取样位上
  // 会互相冒充吗——cap #C8B4FF 对 loop 相距 (124,37,79)、对 error 相距 (55,103,161)，每通道都 ≥25。
  cap: '#C8B4FF',
  // 钉成「不在环上」的点：它只和盘底同位（钉成留空的格不会有环线经过），所以只需与 field 拉开。
  offMark: '#9AA3B2',
  // 光标与提示：都画在格的 0.38 偏移框上（那里绝不会有环带经过），两者互距 (132,73,39)。
  cursor: '#7BB8FF',
  hint: '#FF6FD8',
  moon: '#7B5CFF',
  sun: '#FFB03D',
};

export const Space = { page: 20, card: 16, inner: 12, gutter: 10 };
export const Radius = { card: 18, button: 12, chip: 8, cell: 4 };

export const Font = {
  mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif",
};

export const Motion = {
  tap: 150,
  base: 220,
  line: 260,
  win: 900,
  spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
  ease: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
};

// 几何令牌同样是**门禁按它取样**的数：draw() 和 tools/scenarios.js 读同一批分数，
// 所以取样点不可能跑出被画的东西之外。
export const Board = {
  cellMin: 30,
  cellMax: 74,
  pad: 14,
  loopWidth: 0.16,      // 环线粗（按 cell 的分数）
  borderThin: 0.028,    // 细网格线
  borderRoom: 0.085,    // 区域粗边
  symbolR: 0.19,        // 符号半径：画在格心偏右下，环线从它背后穿过
  offR: 0.075,          // 留空点半径
  capR: 0.06,
  badWidth: 0.075,
};

export function applyThemeVars() {
  const root = document.documentElement.style;
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  for (const [k, v] of Object.entries(Palette)) root.setProperty('--' + kebab(k), v);
  for (const [k, v] of Object.entries(Space)) root.setProperty('--space-' + k, v + 'px');
  for (const [k, v] of Object.entries(Radius)) root.setProperty('--radius-' + k, v + 'px');
  for (const [k, v] of Object.entries(Motion)) {
    if (typeof v === 'number') root.setProperty('--dur-' + kebab(k), v + 'ms');
    else root.setProperty('--ease-' + kebab(k), v);
  }
  root.setProperty('--font-mono', Font.mono);
  root.setProperty('--font-sans', Font.sans);
}

let motionReduced = false;
export function setReduceMotion(v) {
  motionReduced = !!v;
}
export const systemPrefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const prefersReducedMotion = () => motionReduced || systemPrefersReducedMotion();
