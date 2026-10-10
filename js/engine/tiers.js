// 尺寸菜单 = 量出来的，不是挑出来的。
//
// 判据 1 的预算（一次穷举求解 ≤ CAP_WORK 个节点）是出货的硬线：每一档都要在**出题**里
// 反复跑到它，所以菜单能开多大由计数器的代价决定。下面每档的 work 是 15 张盘的节点读数
// （tools/balance.mjs 的 B5 把这批 seed 的读数钉成等式，改了生成器或计数器就会红）；
// ms 只卡上界（B1、B5b），因为换一台机器它就变，而节点数不会。
//
// 被淘汰的档不是"暂时没做"，是这一版计数器买不起。它们的读数同样写在树里（samples/ship/
// nodesMed/nodesMax/fails），B6 每次都在当前这棵树上重量一遍——页面下面那句理由是由这些
// 字段**拼出来的**，所以一个没人验过的数字不可能只活在文案里。
import { CAP_WORK } from './rules.js';

export const TIERS = [
  { key: '5x5', rows: 5, cols: 5, label: '5×5 入门', work: { med: 4490, p95: 22896 }, budgetMs: 4000 },
  { key: '6x6', rows: 6, cols: 6, label: '6×6 标准', work: { med: 50000, p95: 187983 }, budgetMs: 8000 },
  { key: '7x7', rows: 7, cols: 7, label: '7×7 进阶', work: { med: 125573, p95: 1801534 }, budgetMs: 16000 },
];

export const ELIMINATED = [
  {
    key: '8x8', rows: 8, cols: 8, samples: 5, ship: 3,
    nodesMed: 1101971, nodesMax: 1379562,
    fails: ['not unique (6)', 'pencil stalls on the dug board'],
    why: '点一次「换一局」要连着退货才拿得到一张盘，而每一张都是在浏览器主线程上跑一次两百万节点的穷举。',
  },
  {
    key: '10x10', rows: 10, cols: 10, samples: 5, ship: 5,
    nodesMed: 1649604, nodesMax: 1946473,
    fails: [],
    why: '出货率不是问题，问题是有一张已经贴到预算线上：再深一点计数器就只能返回「没证完」，而那句谎判据 1 不允许说。',
  },
];

const fmt = n => n.toLocaleString('en-US');
const pct = n => `${Math.round((100 * n) / CAP_WORK)}%`;

// 选尺寸页上印的那一句：全部字段都来自上面那张表，也就是 B6 每次重量一遍的那张表。
export function eliminatedLine(e) {
  const back = e.fails.length ? `退货 ${e.fails.join('／')}` : '无退货';
  return `${e.rows}×${e.cols}：单试 ${e.samples} 张出货 ${e.ship} 张 · 唯一性计数节点中位 ${fmt(e.nodesMed)}（预算 ${fmt(CAP_WORK)} 的 ${pct(e.nodesMed)}）· `
    + `最坏 ${fmt(e.nodesMax)}（${pct(e.nodesMax)}）· ${back} · ${e.why}`;
}

export const SIZES = TIERS.map((t) => t.key);

export function parseSize(key) {
  const t = TIERS.find((x) => x.key === key) || TIERS[0];
  return t;
}

export { CAP_WORK };
