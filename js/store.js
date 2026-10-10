// 存档：localStorage 里只有一份，写的是 seed + 笔迹 + 时钟，不写盘面对。
//
// 为什么不写盘面对：seed → 盘是引擎里的决定论映射，重画一次就能拿到同一张盘；把 49 个格子
// 抄进存档只会多出一条「存档和引擎画的不是一张盘」的失败路径。
//
// 但恢复之前必须对一次账：存档记着 sizeKey/seed，恢复要用它们重画盘，再拿重画出来的盘和
// 存档里的指纹（尺寸 + 区域编号 + 符号行）比。对不上就是版本漂了或 seed 变了——作废存档、
// 开新局，并把这事说给玩家听，不能沉默地拿旧笔迹盖在新盘上（那是一张不可能的盘）。
const KEY = 'moonsun.save.v1';
const FIELDS = ['sizeKey', 'seed', 'st', 'cursor', 'moves', 'moveCount', 'elapsedMs', 'fingerprint', 'savedAt', 'version', 'won'];

function fingerprintOf(p) {
  return [p.rows, p.cols, p.room.flat().join(''), p.sym.flat().join('')].join('|');
}

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (obj.version !== 1) return null;
    for (const f of FIELDS) if (!(f in obj)) return null;
    if (!Array.isArray(obj.st)) return null;
    return obj;
  } catch {
    return null;      // 坏 JSON 不算存档，也不能把页面崩掉
  }
}

export const Store = {
  data: null,

  pendingResume() {
    this.data = readRaw();
    if (!this.data) return null;
    return this.data;
  },

  // 只有指纹对得上才把笔迹搬回去；返回 false 时调用方必须作废存档并开新局。
  resume(puzzle) {
    const d = this.data;
    if (!d) return null;
    if (d.seed !== puzzle.seed || d.sizeKey !== puzzle.sizeKey) return null;
    if (d.fingerprint !== fingerprintOf(puzzle)) return null;
    if (d.st.length !== puzzle.rows * puzzle.cols) return null;
    return d;
  },

  save(puzzle, game, elapsedMs, won) {
    this.data = {
      version: 1,
      sizeKey: puzzle.sizeKey,
      seed: puzzle.seed,
      st: Array.from(game.st),
      cursor: game.cursor,
      // 撤销栈要跟着存：只存笔迹不存栈，刷新之后「撤销」会把人钉在原地。
      moves: game.moves.slice(-200),
      moveCount: game.moves.length,
      elapsedMs,
      fingerprint: fingerprintOf(puzzle),
      savedAt: Date.now(),
      won,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      return false;   // 隐私模式／配额满：存档是锦上添花，不是玩法的一部分
    }
    return true;
  },

  clear() {
    this.data = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 读不出来就同样当作没有 */
    }
  },
};
