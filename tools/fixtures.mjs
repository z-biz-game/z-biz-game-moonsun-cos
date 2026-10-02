// 题面与逐字规则文本 —— 闸和文档都从这里读，不在两处各抄一遍。
//
// 两个独立出版方（同一家 EN+JA 只算一个源，所以这里刻意选了不同机构）：
//   源 1  Nikoli（规则页的英文原文，例题的 gif 也来自这一页）
//   源 2  Cross+A（cross-plus-a.com/puzzles.htm 的 #Moonsun 段，另一家机构自己的措辞）
//
// 两家在**同一处**留了同一个歧义：区域里"要么走全部月亮、要么走全部太阳"，
// 对一个只标了一种符号的区域来说，"另一种符号一格都没走"是**空真**还是**必须出现**？
// 这就是 strict/literal 两条读法。歧义不靠讨论定，靠官方例题的解数定：
// 同一张盘，STRICT 读法数出 1 个解，LITERAL 读法数出 3 个解，而 Nikoli 印的解答只有那一个
// ⇒ 本仓采 STRICT，并且 tools/engine-test.mjs 的 A2 把这个 1/3 钉成等式（改了条款或计数器就红）。
// 官方解答本身也是逐格抄下来的（下面 officialLoop），A1 拿它对账三条：计数器的那个解、
// 铅笔推出来的那个解、以及这里抄的那一个，必须逐格相同。

export const SOURCES = [
  {
    who: 'Nikoli（规则页 · 英文）',
    url: 'https://www.nikoli.co.jp/en/puzzles/moon_or_sun/',
    text: [
      'Draw a line to make a single loop.',
      'Lines pass through the centers of cells, horizontally, vertically, or turning. The loop never crosses itself, branches off, or goes through the same cell twice.',
      'A rectangle, bordered by bold lines, is called a “room”. The loop goes through each room only one time. Once the loop leaves a room, it cannot return to enter this room.',
      'In each room, the loop goes through all of the moon cells or all of the sun cells. The loop cannot pass through both moon cells and sun cells in one room.',
      'After the loop goes through the moons in one room it has to go through all the suns in the next room it enters and visa versa.',
    ],
  },
  {
    who: 'Cross+A（另一家机构的规则页 · 英文）',
    url: 'https://www.cross-plus-a.com/puzzles.htm#Moonsun',
    text: [
      'Moonsun ("Moon or Sun") is a logic puzzle invented by Nikoli. A rectangular or square grid is divided into regions. A grid contains black and white circles in some cells. The aim is to draw a single non-intersecting loop. The loop must cross borders of each region exactly twice. In a region the loop must visit either all cells with black circles or all cells with white circles. Regions with visited black circles must alternate with regions, where white circles were visited.',
    ],
  },
];

// 两条读法：strict=true 要求那个符号在区域里**真的出现**（空真不算）。
// prep() 默认走 strict；bd.strictLabel === false 是 literal，只用来给 A2 数差异。
export const OFFICIAL_URL = 'https://www.nikoli.co.jp/en/puzzles/moon_or_sun/';

// ── 官方 5×5 例题（Nikoli 该页的图 01／解答 03，逐格抄）──────────────────────
// 区域号 + 符号（'M' 月／'S' 日／'.' 空格）+ 题面印刷的那条环。
// 环用每格引出的方向字母写：U/D/L/R，'DR' = 这一格向下和向右各引一条线。
export const official = {
  rows: 5, cols: 5,
  room: [[0, 0, 1, 2, 2],
         [0, 1, 1, 2, 2],
         [3, 3, 4, 4, 5],
         [3, 3, 4, 5, 5],
         [3, 3, 3, 3, 3]],
  sym: [['.', 'M', '.', 'S', 'S'],
        ['M', 'M', 'S', '.', '.'],
        ['.', 'M', 'M', '.', '.'],
        ['.', 'S', '.', 'S', 'M'],
        ['M', '.', '.', '.', '.']],
};

export const officialLoop = [
  'DR', 'LR', 'DL', 'DR', 'DL',
  'DU', '', 'DU', 'DU', 'DU',
  'DU', '', 'RU', 'LU', 'DU',
  'RU', 'DL', '', '', 'DU',
  '', 'RU', 'LR', 'LR', 'LU',
];

// 抄件自己得先合法，否则"三条对账"里有一条是循环论证（A1' 单独断言它）。
export function officialMaskOf(mod) {
  const { UP, RIGHT, DOWN, LEFT } = mod;
  const D = { U: UP, R: RIGHT, D: DOWN, L: LEFT };
  return officialLoop.map(s => [...s].reduce((a, ch) => a | (1 << D[ch]), 0));
}
