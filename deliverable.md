# 月之日 · Moonsun（零猜测区域环推理） · 交付卡

> 本文件由 `003_辅助能力/audit/script/gen_deliverable.py` 从本仓 README、package.json 与 `git ls-files` 生成，**不要手改**；改源后重跑，`--check` 必须逐字节一致。
> 读数取自本仓 `git ls-files` 与 package.json，均不含本文件自身；这里不写提交号，所以 `--check` 比的是内容，不是时间。

## 一句话

浏览器原生的 Moonsun（月さん / Nikoli "Moon-or-Sun"）：无构建步骤、无打包器，棋盘、区域粗边、

- 仓名：`z-biz-game-moonsun-cos`　组别：E · 生成艺术与交互视觉
- 技术栈：Electron + Canvas

## 怎么跑

```sh
npm start    # node server.cjs
```

README 的快速开始：

```sh
npm start            # 零依赖静态服务 → http://127.0.0.1:5276/
# 两种 URL 形态都 serve（本地开发与 Pages 子路径一致，server.cjs 自己就是这条承诺的实现）：
#   http://127.0.0.1:5276/
#   http://127.0.0.1:5276/z-biz-game-moonsun-cos/
```

## 怎么验

| 层 | 命令 |
| --- | --- |
| 整仓门禁 | `bash tools/verify.sh` |
| 本地单入口 | `bash tools/ci.sh` |
| 单元/规则测试 | `npm test` |
| npm verify | `npm run verify` |
| 文档腿 | `node tools/doctest.mjs` |

## 规模

| 指标 | 读数 |
| --- | ---: |
| 跟踪文件 | 46 |
| 应用代码 | 2,753 行（JS 2,422 / CSS 196 / HTML 135） |
| 测试/工具文件 | 14 个 |
| 依赖 | `dependencies` 0 / `devDependencies` 0 |
| 位图资产（不含 shots） | 6 个 / 271 KB |

## 目录

```
.github .gitignore DESIGN.md LICENSE README.md css icons index.html js manifest.webmanifest package.json server.cjs sw.js tools
```

## 已知边界

README 没有单列“未实现/限制”小节；以 README 正文与仓内闸为准。

## 证据

- 重跑：在 lead 仓根执行 `python3 003_辅助能力/audit/script/gen_deliverable.py ../z-biz-game-moonsun-cos --check`，应与本文件逐字节一致。
- 漂了就重跑并复核读数变化：新增文件、改 README 的边界小节、加/删闸都会让它变，这些变化本身就是要看的内容。
