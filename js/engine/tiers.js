// 尺寸菜单 = 量出来的，不是挑出来的。
//
// 判据 1 的预算（一次穷举求解 ≤ CAP_WORK 个节点）是出货的硬线：每一档都要在**出题**里
// 反复跑到它，所以菜单能开多大由计数器的代价决定。下面每档的 work 是 15 张盘的节点读数
// （tools/balance.mjs B3 把这批 seed 的读数逐张钉成等式，改了生成器或计数器就会红）；
// ms 只作观测（B4 只卡上界），因为换一台机器它就变，而节点数不会。
//
// 被淘汰的档不是"暂时没做"，是这一版计数器买不起：8×8 的中位读数已经压到预算线上，
// 10×10 的中位数直接越线。把它们留在菜单里＝点下去要么转要么骗人，
// 所以它们从菜单里删掉，理由印在选尺寸的那页上（玩家看得见为什么只有三档）。
import { CAP_WORK } from './rules.js';

export const TIERS = [
  { key: '5x5', rows: 5, cols: 5, label: '5×5 入门', work: { med: 3391, p95: 27189 }, budgetMs: 4000 },
  { key: '6x6', rows: 6, cols: 6, label: '6×6 标准', work: { med: 31798, p95: 1077813 }, budgetMs: 8000 },
  { key: '7x7', rows: 7, cols: 7, label: '7×7 进阶', work: { med: 157453, p95: 1900477 }, budgetMs: 16000 },
];

export const ELIMINATED = [
  { key: '8x8', rows: 8, cols: 8, reason: '计数器中位 1,833,670 节点／盘，已经贴着 2,000,000 的预算线：中位就在线上的尺寸不能放进菜单。' },
  { key: '10x10', rows: 10, cols: 10, reason: '计数器中位 1,994,355 节点／盘，等于预算线；随机画环在 10×10 上还要多次重试，出题代价不可控。' },
];

export const SIZES = TIERS.map((t) => t.key);

export function parseSize(key) {
  const t = TIERS.find((x) => x.key === key) || TIERS[0];
  return t;
}

export { CAP_WORK };
