# Changelog

所有历史版本的完整变更记录。当前版本见 README 顶部徽章。

## 未发布 · 逐页核对：8 个图表实例只有 3 个会被 resize（2026-09-30）

用户要求"认真核对每一个页面显示"。先写了 `scripts/page-audit.mjs` 把 7 个标签页 × 8 个彩种的接口逐个打一遍（数据层确认干净：无空响应、无空字段），然后转向**渲染层** —— 数据有、但页面画不出来，是这类工具最坏的 bug。

**找到的真问题：图表 0 宽**

ECharts 在 `display:none` 的容器上 `init` 出来量到的是 **0 宽**，之后必须 `resize()` 才会按可见宽度重排。分析页与审计页的图是在页面加载时（对应标签页还没显示）就画好的，所以切页时必须补一次 resize。

原实现是手写三个 `if`：

```js
if (b.dataset.t === 'a' && window.__chart) setTimeout(() => window.__chart.resize(), 0);
if (b.dataset.t === 'a' && window.__chart2) ...   // 只有这三个
```

而全站有 **8 个** `echarts.init`。漏掉的 5 个：

| 实例 | 位置 | 症状 |
|---|---|---|
| `__btchart` | 分析页分年柱图 | 打开分析页看不到「分年稳定性」图 |
| `__revchart` | 审计页复盘图 | 空白 |
| `__cbtchart` | 审计页冷门度回看图 | 空白 |
| `__syncchart` | 审计页同步时序图 | 空白 |
| `__g_chart` / `__g_chart4` | v0.15.5 新增按位图 | **数字型彩种分析页仍然空白** |

最后一条是 v0.15.5 自己踩的：数字型彩种改走 `drawGroupedChart` 生成新实例，而 resize 名单还在 resize 旧的 `__chart` —— 加了图没补名单，症状与修之前一模一样。

**改法**：新增 `__charts` 登记表 + `regChart(key, el)` + `resizeCharts()` + `disposeChart(key)`，8 个实例全部改走登记表，切页时统一 `setTimeout(resizeCharts, 0)`（不再只限 `'a'` 页）。`disposeChart` 会 `dispose()` 后 `delete __charts[key]` —— 否则 `regChart` 会把已销毁的实例当成可用实例返回；审计页那两块"点加载就重建容器"原本靠 `window.__x.dispose()` 清理，改登记表后不清理就是泄漏。

**顺带修的**

- `renderNums` 里快乐8 分支自己拼 `class="ball"`（没有 `balls()` 给的尾空格），与其余 7 个彩种标记不一致 → 统一走 `balls()`
- 新增 `scripts/page-audit.mjs`（逐页 × 8 彩种巡检脚本，不进 CI，作为排查工具留用）
- 分析页两段统计文字抽成纯函数 `analyzePoolText()` / `analyzeDigitText()`，让渲染层可测

**测试**

- 新增 `worker/test/page-render.test.mjs`（7 项）：用 `analyzeAll` + `SPECS` 现场造出与线上同构的响应（字段名一律取自 `SPECS.fMain`/`fAux`，不手写），喂进前端真正的渲染函数，断言 —— 8 个彩种历史页每行都渲染出号码球（且主号码个数正确）、号码池型 12 个统计标签逐个后面都有值且无 `undefined`/`NaN`、数字型每一位都渲染出热/冷/高频、`form` 只在 3 位型出现、数字型文字**不含**号码池专属字段（v0.15.5 事故的原始形态）、来源横幅 4 种情况、胆拖单导出文本 8 个彩种都带免责声明与注数
- `worker/test/frontend.test.mjs` 增 2 项：`echarts.init` 只允许出现在 `regChart` 内、切页必须调 `resizeCharts`、不允许再出现按名字逐个 resize 的旧写法；`disposeChart` 必须同时删登记项
- 两组新测试都做过变异测试验证断言有效（数字型串用号码池字段 → 挂 2 项；`renderNums` 丢 `digits` 分支 → 挂 1 项；切页改回逐个 resize → 挂 1 项；绕过登记表裸 init → 挂 1 项）
- **194 → 203 项离线全过**

## 未发布 · 分析页：4 个数字型彩种几乎是空白的（2026-09-30）

用户报"分析页只有双色球有图表数据"。实测确认，并顺带扫出同类问题。

**根因是两个叠加的前端缺陷**（后端数据其实一直是齐的）

1. `loadAnalyze` 先把按位冷热写进 `#stats`，紧接着号码池那版整体 `innerHTML = ...` 把它**整个抹掉**
2. 先把按位频次图画进 `#chart`，紧接着又用空的 `an.freq`（数字型没有号码池）覆盖同一个 `#chart`，`setOption(..., true)` 把图**擦成空白**

结果是 4 个数字型彩种（福彩3D / 排列3 / 排列5 / 七星彩）拿到的是：一张空白图 + 一排空标签（热号/奇偶比/平均AC/质合比/区间分布 全是 undefined）。而后端 `analyzeDigits` 其实**一直**返回 `perPos[i].freq`、`perPos[i].omission`、`perPos[i].oddRatio` —— 数据在，只是没人渲染它。

**改法**

- 拆出 `analyzeDigit()` 独立的数字型渲染路径：按位分组柱图（各位置数字频次）+ 逐位冷热/高频/最深遗漏文本 + 形态（组三/组六/豹子）+ 平均和值/大数个数
- 新增 `drawGroupedChart()` 多系列绘图。`drawChart` 只能画单系列，硬套就得一个位一张图，反而看不出"十位比个位热"这类位间结构
- 数字型补一张"各位置当前遗漏"图（用既有的 `perPos[i].omission.cur`）替代号码维度的遗漏走势
- `insertAdjacentHTML` 逐块追加，全函数只赋值一次 `#stats` —— 覆盖式赋值是这次事故的直接成因

**顺带扫出的同类静默空白**

- `/api/trend?kind=<数字型>` 返回 `rows: []`，前端照画一张空图。现改为直说"数字型无号码池，故不提供号码维度的逐期遗漏走势"
- 形态转移对数字型返回 `note:"该彩种不支持形态转移"`，但前端 `if (an.shape && an.shape.sum)` 静默跳过 → 现在把 note 显示出来。`smallRoute` 的 analyze 改为一律带上 `shape`（号码池型有内容，数字型带 note）
- **mock 占位被当真数据渲染**：`getDraws` 三源全挂时返回一条编造的单期，`count=1` 而 `freq` 仍是满池 33 个键 —— 一张"看起来正常"的频次图，实际是假的（本次排查时线上就撞到过一次 `ssq count=1`）。新增 `sourceBanner()`：mock 时红框警告"当前不是真实开奖数据"，单源时标注"未经第二源交叉校验"。这与"单源却报一致"是同一类问题 —— 让假数据自己开口
- `dlt` 与小彩种的 analyze 之前不带 `sources`，横幅无从判断；现补上真实来源（小彩种上游是 `datachart.500.com`，降级读 D1 时标 `d1`）

**测试**

- 新增 `worker/test/analyze-contract.test.mjs`（6 项）：8 个彩种的 analyze 字段契约。号码池型必须给齐 `freq`（键数 = 池大小）/`hot`/`cold`/`oddRatio`/`avgAC`/`road012`/`zoneDist`/`omission`，且 `avgAC` 不得超过 `C(n,2)-(n-1)` 的理论上限（越界即 `acValue` 算错）；数字型必须每位给 `freq`/`omission`/`oddRatio`，`form` 只对 3 位型非 null 且三类形态之和 = 期数；数字型 `shapeTrans` 必须带 note；8 个彩种不得抛错。**用变异测试验证过断言不是空数据上假绿**（删掉 `avgAC` 立刻被抓）
- 新增 `worker/test/frontend.test.mjs`（3 项）：抽出每个内联 `<script>` 块做 `node --check`。**它当场抓到我写的一处括号不配对** —— 那在浏览器里会让整个 script 块不执行，页面看着正常、点什么都不动
- `npm test` 与 CI 的测试清单原本逐个列文件，新测试会被静默漏掉 → 改为 glob `test/*.test.mjs`
- 联网测试 `live.test.mjs` 刻意重命名为 `live.network.mjs`：改 glob 后它会被错误拉进离线套件，不改名则离线环境必挂。改名让它在结构上无法混入
- **185 → 194 项离线全过**（+12 项联网测试在 `npm run test:live`）

**未修（有意保留）**：冷门度仍只有双色球有拟合系数（`COLD_KINDS`），需要 ssq-fit 那份 3501 期真实一等奖注数数据；接口返回 `supported:false` + 说明，前端显示"暂不可用"，是诚实标注而非静默空白。

## 未发布 · 给交叉校验换一个够得着的对等源（2026-09-30）

上一节把"单源应答"从 pass 降级成 warn 是对的，但那只是让绿灯消失；真正的修复是**让交叉校验重新跑得起来**。

**问题**：`getDraws` 的快源层是 `500 + cwl`，而 cwl（`www.cwl.gov.cn`）是境内站、从 CF 边缘出口实测长期不通（线上近 30 次同步一次都没应答过）。于是快层常年只剩 1 个源 → 无从比较 → `sync_health` 只能判 warn，「双源交叉校验」这套设计事实上从未运行。

**三条依据（都实测过）**

1. **17500 从 CF 边缘可达** —— 线上那 5 次回退都成功拉到 100 期（`sources:["17500"], fetched:100`）。它只是慢（0.5MB 全量文件，`BULK_MS=20s`），没被墙
2. **500 与 17500 数据一致** —— 实测最近 30 期：**一致 30 / 冲突 0 / 缺期 0**，期号（`normCode` 归一后都是 7 位）与日期都能对齐
3. **这条路已经被验证过一次** —— dlt 现在就是 `fetchDLT(500) × fetch17500DLT(17500)` 做 30 期交叉校验，一直跑得好好的

**改法**：交叉校验放到 `adminSync`（唯一的写路径），不放 `getDraws`（读路径）。理由是交叉校验的目的是"别让坏数据进 D1"，而 `adminSync` 是唯一写入口；读路径不必为此每次多拉 0.5MB，页面首屏延迟不受影响。

- `adminSync` 的 ssq 段新增对等源 `fetch17500(100)`，与快源做 `crossCheck(live, peer, 30)`，冲突期号照旧拒绝落库
- 两处守卫：`live` 本身就是 17500 兜底时**不能自己跟自己校**；`live` 是 mock 占位时同样跳过
- 一致性口径随之升级：对等源比对真跑过时，"一致" = **最近 30 期逐期比对全同**（比"只看最新一期"强得多）；没跑成才退回快层结论并保留原因
- 审计与前端同步面板的口径说明同步改成"对等源 17500 与快源最近 30 期逐期比对"

**cwl 保留在快源层**：万一 CF 到境内的出口恢复、或它不再拦海外 IP，就白捡一个第三方源；拉不到只是浪费一次 8s 超时内的失败，这个代价之前就一直在付。

**测试** `crossCheck` 改为导出并新增 `worker/test/crosscheck.test.mjs`（6 项）：40 组随机数据 × 2 种窗口与暴力逐期比对**逐项相同**、红/蓝球任一不同即冲突、对端缺期不算冲突（缺期不是矛盾，把它当矛盾才是事故）、窗外期号不参与、号型不同型不得互判、期号归一是调用方前置条件。**178 → 184 项全过**（166 worker + 13 统计内核 + 5 推送）

## 未发布 · 复盘：交叉校验绿灯是空的（2026-09-30）

复核 v0.15.0/0.15.1 之后的线上数据，发现同步健康这块「绿灯」没有证据支撑。围绕同一条原则修：**宁可显式说"不知道"，也不让指标显示成绿的**。

- **单源应答不再算「一致」** — `_consistent` 收紧为「≥2 个源对同一期号真的比过并且一致」。只有一个源时记 `crosscheck_skipped_single_source` 并判 **warn**（不是 fail：源挂掉是环境事实，不该把整页染红，但必须明说没校验）
  - 起因：线上 `/api/sync-log?limit=30` 实测 —— `sources` 只有 `500`（25 次）或只有 `17500`（5 次），**`cwl` 一次都没出现过**，而 30/30 全判 `pass`、审计写「一致 50/50」。真实比对次数是 **0**
  - 上一轮把"单源保持 true"标成待定项（"没发现矛盾 ≠ 校验通过，但也不凭空判红"）。线上数据给出了答案：这个选择产生了"绿灯是空的"这个结果
  - cwl 接口本身是好的：本机直连 HTTP 200，`code=2026113 red=03,04,20,24,29,30 blue=11`，与 500 拿到的完全一致 ⇒ 是**境内站从 CF 出口不通**（`net.js` 注释已记录过这一类），不是接口失效也不是解析错
- **暴露交叉校验覆盖度** — `/api/sync-log` 每行加 `sourceCount`，summary 加 `crossChecked`（真比对过几批）/ `singleSource`（只有单一源几批）/ `sourceMix`（实际出现过哪些源组合）；`adminSync` 的 ssq 结果加 `sourceCount` 与 `crossCheckSkipped`。不暴露这些，`sources:["500"]` 与 `["500","cwl"]` 的行看起来一样是绿的
- **审计措辞对齐证据强度** — `sync_health` 的 detail 从"一致 N/M"改成"双源比对覆盖 X/M 批；其中 K 批只有单一源应答"，并注明**逐批「一致」= 两源最新一期号码相同，不是 30 期逐期比对**（`crossCheck` 确实比 30 期，但那个结果只用于丢弃冲突期号、不进健康度）
- **`/api/ssq/history` 与 `/trend` 的来源元数据改走响应头** — 旧 `withMeta()` 把 `_sources` 挂在**数组**上，而 `JSON.stringify` 只序列化数组索引，自定义属性整条蒸发。线上实测：`/api/ssq/latest`（对象）有 `sources`/`consistent`，这两个数组端点**从来没有**——代码看起来在暴露数据来源，实际从未暴露过。现改用 `X-Sources` / `X-Consistent` 头（数组改包成对象会破坏前端），并删掉那处死代码
- **推荐结果带口径说明 `caliber`** — 6 套策略并非同一窗口的统计：热号/冷号/副区走 `analyzeAll` 的全量历史，胆码走 `danList` 的 `win` 窗口（`/api/dan?win=` 可调），杀号走全部可用历史。所以「均衡」本身就是"全量热号 + 全量冷号 + win 窗口胆码"的混合，note 已写实；前端在预测页显式展示这段口径
- **note 改名保持后向兼容** — `crosscheck_latest_issue_mismatch` 并入 `crosscheck_skipped_*`。分级器**同时认新旧两个名**：D1 里 v0.15.0/0.15.1 写下的历史行还带旧名，只认新前缀会把它们从 warn 误判成 fail（等于用一次改名制造假红）
- **测试 173 → 178 项全过**；新增用例锁住：交叉校验覆盖度暴露、单源判 warn、旧 note 名仍判 warn、数组端点的头元数据、推荐 `caliber` 与降级不摊数组
- **CI：落库前先确认线上版本**（由本次改动本身暴露出来的时序缺陷）— `sync` 排在 `deploy` 之后仅十几秒，而 Worker 是**边缘多 PoP**，`deploy` 的健康检查只证明了"某一个 PoP"已收敛，`sync` 的请求完全可能落到仍在跑旧代码的 PoP。实测 v0.15.2 那次：deploy 门禁已见 `0.15.2`，`sync` 却在 08:56:02 写下一行 `consistent=true` / `note` 为空（旧语义：单源也算"一致"，比真值宽松），静默把 `sync_health` 染绿且无任何迹象表明它来自旧代码。现 `sync` job 前置版本门禁，不收敛就退避重试、仍不收敛则**中止而不是用旧代码写 sync_log**（`review` 是 `needs: sync`，被连带覆盖）
  - 线上验证：修好后同一接口立即从 `grade=pass / crossChecked=0` 变成 `grade=warn / singleSource`，`/api/audit` 的 `overall` 也从 `pass` 变成 `warn` —— 绿灯消失，但那是它本来的样子
  - 改版本号时**六处**要一起改：README 徽章、`worker/package.json`、`/health` 兜底常量、`wrangler.toml`、`sync.yml` 的 deploy 门禁、`sync.yml` 的落库前门禁

## v0.15.0 · 缺陷排查与修复两轮（2026-09-30）

一并发布下面那份「15 项改进清单」（2026-09-24 起一直挂在未发布）。本轮只写第一轮之后的增量。

第一轮全量排查出 11 项缺陷并修复；第二轮独立复核又查出 6 项（含我自己引入的 3 项）一并修掉。全部围绕一条原则：**宁可显式说"不知道"，也不让指标显示成绿的**。

- 版本 `0.14.0 → 0.15.0`（README 徽章、`worker/package.json`、`/health` 兜底常量、`wrangler.toml` 四处同步）
- **测试 137 → 171 项全过**（153 worker + 13 统计内核 + 5 推送）

### 正确性 / 安全

- **收藏鉴权 fail-closed** — `favsRoute` 原写成 `env.API_TOKEN && ...`，未配 token 时 GET/POST/DELETE 全部放行；配合 `Access-Control-Allow-Origin: *` 等于把收藏表对任意站点开放。改走 `requireAuth`（未配 token 一律 401）
- **mock 占位数据不再落 D1** — `saveSSQ` 跳过 `src=mock`；三源全挂时的 `2025091` 是读路径占位，落库会让假期号进事实源（history/对账/验奖都会命中）
- **七星彩第 7 位号池 0-14** — `fetchSmall` 原按 0-9 卡，第 7 位 ≥10 的行整行丢弃（那约 9% 的实际开奖既进不了 history 也进不了验奖）。`verify-batch.js` 与 `scripts/randomness/` 早已按 0-14 建模，此处是漏改
- **数字型逐位号池** — 新增 `posPool` / `posBaseline` / `digitBaseline`，替掉 5 处硬编码 10 格：第 7 位的频次/遗漏少算 9%、杀号永远杀不到 10-14、随机基准只在 0-9 里抽（复盘与回测基线跟着一起错）
- **注数计算器不再静默出错** — 直选单值 `pos=2` 原按"全 1"算成 1 注（应 8 注）、`pos=5&group=6` 原算成 `C(1,3)=0` 注且 formula 还写"1×1×1（组六）"自相矛盾、排列5/七星彩原也接受 `group`。现在位数不符与无组选玩法都明确 400
- **`nextIssue` 跨年回 001** — 纯 +1 在 12 月底会算出 `2026366` 这种当年不存在的期号，快照入库后永远查不到开奖，`checked` 停在 0，该期从未被复盘。改用开奖日历判定是否跨年（休市只会推迟首期日期，不改变"新年第一期 = 001"）
- **样本不足门槛** — 0~4 期时"高频/最冷/胆码"全是并列后按号池顺序取第一个，实际等于"取号池里最小的几个号"却标着"高频号"。`recommendAll` 及 `/kill /dan /ticket /kill-calibrated /kill-tune` 一律不给号并写明原因

### 诚实性

- **同步健康改三态** — 旧 `consistent` 一个 int 混着表达两件事。新增 `pass` / `warn` / `fail`：号码冲突（`crosscheck_dropped_N` / `mock`）= fail；两源期号不同步或只剩 17500 静态文件 = warn。每期新开奖后 cwl 必然比 500 慢一拍，把它算 fail 会让红点天天出现等于没有红点。**未知原因的 `consistent=0` 一律 fail**——不往好的方向猜
- **空快照不入库** — 样本不足时 `reviewJob` 原本仍写 `{"picks":[],"dan":[],"kill":[]}`，开奖后被标 `checked=1`，而 `reviewRoute` 的 `a.checked++` 无条件计数 → "对账期数"+1 而三个分母一个不加
- **qxc 规则文案** — `LOTS` / README 仍写"7 位 0-9"，与修好的 0-14 号池自相矛盾，而 `LOTS` 经 `/api/meta` 对外暴露
- **杀号口径未对齐这件事写进 note** — 回测杀号窗口封顶 100 期、线上 `killList` 用全量。实测主区 10 个公式只读 `draws[0..1]`（封顶对被杀号集合零影响），属 CPU 约束而非正确性问题，已在 `backtest.note` 显式标注，不假装已对齐

### 口径与性能

- **回测热/冷改全量历史** — 旧 `backtest` 喂 `hist.slice(0, win)`，而线上 `analyzeAll` 的 freq 吃**全部**期数（`win` 只截断 road/odd/tail），"线上给什么、回测验什么"原本是假的。现统一为全量；胆码仍按 `win` 窗口（`danList` 是显式窗口的，不能跟着改）
- **新增滚动统计 `rollingOffsets` / `rollingRange`** — 预扫一次出现位置表，每点只查表。已与 `freqStats` 对拍 399,120 个 `freq/cur/avg/max` 值**零差异**（含"同期不重复"的真实开奖口径）
- **回测测试点数封顶 60 → 40** — 快乐8（号池 80、每期 20 号、10 个杀号公式各扫全池）在 650 期深历史下 60 点需 12.7ms，顶穿免费版 10ms 额度；40 点时最差 6.5ms。默认 `periods=20` 不受影响
- **killList 去浪费（输出逐字节不变）** — `reasons`/`raw` 按需分配、`byFormula` 免排序与免全池扫描、`poolOf`/`zonesOf` 记忆化、`backtestDigit` 的 `killList` 提出逐位循环（原先七星彩每点白算 7 遍）。隔离差分 720 组 killList + 208 组 backtest/calibrate/thresholdTune 全等
- **修一个既有的跨时刻 flaky 测试** — `audit：数据陈旧` 断言写死"6 天"，而审计锚点是北京中午、测试数据按 UTC 造，UTC 凌晨跑必然少 1 天。改为断言阈值意图

### 测试

- 新增 `worker/test/regress.test.mjs`（40 项）：收藏鉴权 / mock 落库 / 七星彩号池 / 注数计算器 / 样本门槛 / 跨年期号 / qxc 文案 / 空快照 / 同步三态 / 滚动统计等价 / 点数封顶
- **补上 CI 漏掉的新测试文件** — `sync.yml` 的 test 步骤是写死文件列表的，不含 `regress.test.mjs`，等于这 40 项在 CI 里从不运行；已加入
- **173 项全过**（155 worker + 13 统计内核 + 5 推送）；README 徽章 `137 → 173`

### 修掉 v0.15.0 首次部署带出的两个线上回归

首次 push 触发 CI 自动部署后，逐端点核对线上响应时才发现的（都是本轮改动引入或暴露的）：

- **`/api/{fc3d,pl3,pl5,qlc,qxc,kl8}/latest` 与 `/history` 返回验奖响应** — 给 `/kill /dan` 加样本门槛时把 `if (act === "kill" || …)` 写成了独立 `if`，没接成 `else if`，于是自成一条链：`latest`/`history` 在前面设好的 `res` 被末尾的 `else`（验奖）覆盖。线上表现是 `/api/qxc/latest` 返回 `{"hit":false,"note":"期号不存在"}`，预测页头部整块空白。**能溜上线是因为当时没有任何测试碰过 `smallRoute`**，且冒烟只查 `/api/ssq/latest`（走的是 `ssqRoute`）
- **降级路径把数组摊成对象**（既有 bug，被上面那个测试逼出来）— `smallRoute` 降级时 `json({ ...(await res.json()), degraded: true })`，对象展开把数组变成 `{"0":…}`，于是上游 17500 一挂，`/api/*/history` 与 `/api/*/trend` 的前端拿到的就不是数组（历史页与走势折线空白）。现在数组原样返回，降级痕迹改走 `X-Degraded` 响应头（JSON 数组带不了同级字段；前端实测从未读过 `degraded`）

配套的门禁修复：

- **部署后健康检查改为校验版本号** — 原来只断言 HTTP 200，而旧代码也照样 200：v0.15.0 那次部署日志里 `/health` 返回的就是 `0.14.0`（收敛前的旧边缘节点），门禁却当场判过。这正是该门禁要防的"以为在推、其实没推上去"。现在比对 `/health` 的 `version` 与 `EXPECT_VERSION`（与 `wrangler.toml` 同步维护）
- **线上冒烟补 2 个端点** — `qxc-latest` / `fc3d-history`，覆盖走 `smallRoute` 的那 6 个彩种，并断言 `history` 仍是数组
- **新增 `worker/test/small-route.test.mjs`** — 逐个 act 断言"返回的是它自己的形状"（`latest` 不能混进验奖的 `hit`/`note`，`history` 必须是数组），并覆盖降级路径与样本门槛的边界


### 同版本发布的「15 项改进清单」（2026-09-24 起累积，本次一并转正）
按用户给出的 15 项总表顺序推进（任务 1–8 见前序会话记录；本轮完成 9–15）：

- **任务 9 分享图片卡片** — `shareCardLines` / `drawShareCard` / `shareCard`：canvas 导出胆拖/纯推荐布局，免责声明强制入图；Web Share 优先回退下载 PNG
- **任务 10 追号开奖日历** — `calc.js` 增 `DRAW_DAYS` / `isDrawDay` / `chaseDrawDates`；`chase>1` 时 `calcBet` 给 `plan[].date` + `chase.dates` + `calendarNote`（不含休市，以官方公告为准）；前端按月铺格
- **任务 11 站内审计 `/api/audit` + 站内审计页** — 5 项检查（新鲜度 / 复盘闭环 / 同步健康 / 冷门度回看 / 免责）；`overall = fail > warn > skip > pass`（有 skip 绝不算 pass）；前端徽章着色，`skip` 灰字绝不渲染成绿
- **任务 12 CI 冷门度系数对账** — 新增 `scripts/coldness/check-sync.mjs`（离线快检：线上常量 ↔ `out/ssq.json` ↔ `coldness-backtest.js` ↔ docs `COLDNESS: PASS`）；挂进 `sync.yml` push 路径；与月度联网重拟合（`ssq-fit.mjs`）分工
- **任务 13 D1 迁移版本化** — `db/migrations/0001_baseline.sql` 为事实源，`db/schema.sql` = 按序拼接的 bootstrap；`unit.test`「D1 迁移版本化」3 项锁死编号连续 / schema≡拼接 / 6 表齐全；CI 增 `node:sqlite` 真执行冒烟（Node&lt;22.5 如实 skip）
- **任务 14 `docs/why.md`** — 12 条关键设计决策的为什么（零依赖 / 鉴权 / 先快照再对账 / 冷门度只发 ssq / skip≠pass / 迁移版本化 / 金额宁缺毋假…）；挂进 README 文档地图与 `docs/README.md`
- **任务 15 全量验证** — `build-ui` + 10 个测试文件 **137 项全过**（+3 迁移测试）；`check-sync.mjs` EXIT=0；README 徽章 `110 → 137`；`worker/package.json` 的 `test` 补上遗漏的 `sw-queue.test.mjs`，新增 `test:cold` 快检脚本
- 顺带：README API 速览补 `/api/sync-log` / `/api/audit` / `/api/coldness/backtest`，`/api/calc` 注明追号日期投影；目录结构补 `db/migrations/`

## v0.14.0 · 大乐透奖级版本化（2026-09-18）

- **新增：大乐透按开奖日期选择规则版本** — 2019-02-20 第19019期为界：此前 6 奖级（一二三等浮动），此后 9 奖级（一二等浮动），13 个中奖条件两版相同（`small.js: prizeDLTOld / prizeDLTFor / dltFixedAmount`，`prizeDLT` 保持现行映射不变）
- **验奖与中奖计算器给固定奖金额** — `scoreTicket` 大乐透分支 + `/api/dlt/verify` + `/api/prize`（新增可选 `date=` 参数）按版本取常量；浮动奖仍为 null 并注明以官方公告为准
- **更正旧文档里的错误日期** — v0.13.0 条目与 `AMOUNT_NOTE.dlt` 曾写"固定奖在 2026-02-02 换过规则"，实为 2019-02-20 第19019期（官方公告+新规则首期开奖 19019 实证），已连带上条一起改对
- **测试 110 项全过**（worker 93：unit 37 / predict 26 / coldness 8 / review 5 / verify-batch 9 / ui-render 5 / net 3；统计内核 12；推送 5）
- 版本 `0.13.1 → 0.14.0`（README 徽章、`worker/package.json`、`/health` 兜底常量、`wrangler.toml` 四处同步）

## v0.13.1 · 公开仓库卫生与文档重构（2026-09-10）

站点是公开仓库，README 是外人第一眼看到的东西。这一轮不改功能，只把「只对本机/本账号有意义的内容」清出去，并把说明重排成能顺着读下来的结构。

- **内部工作记录移出仓库** — `progress.md`、`docs/continue-2026-09-10.md`、`docs/continue-2026-09-11.md` 移到仓库外的本地笔记目录（文件保留，只是不再被追踪），`.gitignore` 补 `progress.md` 与 `docs/continue-*.md`。这三份里全是本机绝对路径、本地代理端口、自建域名——对读者零价值，对自己是泄露面
- **源码里不再写死任何人的站点地址** — `scripts/randomness/fetch-multi.mjs` 的号码交叉校验目标原来硬编码为作者的生产域名，fork 的人跑这个脚本等于在打别人的站。改为 `--api-base=` / `LOTTERY_API_BASE`（本地）与 `vars.PUBLIC_API_BASE`（CI 注入）。**没配时不静默放水**：交叉校验被显式跳过并在 `verify.json` 记 `skipped`，多彩种报告写「未执行」，最后那道「8 彩种 VERIFIED」闸门如实失败。三条分支都实测过：未配置 → `skipped`、地址不通 → `err`、指向真实部署 → `100/100 VERIFIED`
- **前端与模板清理** — 输入框占位符原来是一个「看着像真子域」的示例地址，改成明确的 `lottery-web.你的子域.workers.dev`；删掉 33 个编辑器注入的 `data-page-node-id` 噪声属性（无任何代码引用，删后 89 项 worker 测试全过）；退役 `worker/wrangler.example.toml`（与 `wrangler.toml` 职责重复、版本号停在 0.11.0、示例域名还带着作者的内网命名习惯），部署模板只留一份
- **文档重构** — README 重写：新增「它是什么」（一句话说清这个项目与同类站的差别）、mermaid 架构图、文档地图、按问题找文档；`docs/README.md` 新建为文档索引，并明确标出**哪些 `*-latest.md` 是脚本产物**（workflow 只归档 artifact、不自动 commit 回仓库，所以新鲜度看生成时间与 Actions 运行记录，不看措辞）
- **`docs/research.md` 从草稿改成对账表** — 原来是调研速记，里面「避前 1 期红 / 蓝冷回补 / 蓝球七维加权」等铁律已被 v0.12 的 3501 期实证逐条否定，却仍留在仓库里当"策略依据"读。现在每条假设都配上当时的检验量与现在的处理（删掉 / 降级为纯展示 / 只保留投注侧的冷门度），并显式写明「它存在的意义是记录我们错在哪」
- **修文档里的两处错** — ① `PUBLISH.md` / `wrangler.toml` 注释里的部署命令路径写法不一致，统一成实测可跑的 `cd worker && npm run build:ui && npx --yes wrangler deploy --config wrangler.local.toml`；② 建表命令补 `--remote`：实测不加时 wrangler 打印 `Resource location: local`，表只建在本机 miniflare 里，部署后的站点照样没有表
- **发布前自检多一条可执行检查** — `docs/PUBLISH.md` 增加一轮个人信息扫描（本机绝对路径 / 本地代理端口 / 自建域名 / 邮箱 / 真实子域），仓库当前结果：除测试里连 `127.0.0.1` 临时 server 的正常用例外，命中 0
- 版本 `0.13.0 → 0.13.1`（前端占位符改动需要重新部署），README 徽章、`worker/package.json`、`/health` 兜底常量、`wrangler.toml` 四处同步

## v0.13.0 · 自用顺手 + 可运维（2026-09-10）

方向来自用户一句话：「我虽然不用推送，但这个项目开源后可能其他人需要，给用这项目的人配齐」。三件事按「先把自己每天真会用的做完」排序：批量验奖 → D1 备份 → 开奖推送。顺序执行，一次做完，部署与推送另行确认。

- **新增：`POST /api/verify-batch` 批量验奖** — 一沓票贴进来一次验多期（≤200 注 × ≤10 期，`mult` 倍数计入注数与成本）。`worker/src/verify-batch.js` 是零依赖纯函数，**奖级判定全部复用** `small.js` / `calc.js` 里既有函数：另写一套验奖规则迟早分叉，分叉的表现就是「工具说中了、彩票站说没中」。前端在「验奖·矩阵」页给卡片（每行一注、期号留空＝最近一期、坏行只报**粘贴时的原始行号**不吞其余票），并新增 `apiPost()`
- **金额宁缺毋假** — `FIXED` 只收录本站校验过的固定奖（双色球三~六等、3D/排列3 的直选/组选、快乐8 查表）；双色球一二等奖（浮动奖）、七乐彩/排列5/七星彩（未逐字段校验）一律 `amount: null` 并逐条写明原因。【更正：本条旧版曾写"大乐透固定奖在 2026-02-02 换过规则"，实为 2019-02-20 第19019期启用新规则（6 奖级→9 奖级），v0.14.0 起大乐透固定奖已按版本给出】渲染层把它画成「—（见公告）」并给「另有 N 注中的是本站未给金额的奖级」告警——**错的金额比没有金额更糟**，用户从此不信它的任何输出
- **新增：前后端契约测试 `worker/test/ui-render.test.mjs`（4 项）** — 前端内联脚本无法 import，用 `node:vm` + 最小 DOM 桩把整段脚本灌进去取 `renderVerifyBatch` 引用，喂**真后端**的响应做断言。存在的理由是 `esc(undefined)` 渲染成空串：后端字段改名在页面上是**静默消失**而不是报错。两类变异都验证过会变红——① 把 null 保护改成 `w.amount || 0` → 2 项红；② `summary.amountKnown` 改成 `amountXKnown` → 1 项红。还原后全绿，产物 `ui.js` 重构建后 md5 不变
- **新增：路由层 HTTP 契约（verify-batch 测试第 9 项）** — 实测到 `tickets` 传字符串会让 `verifyBatch` 抛 `TypeError: (tickets || []).map is not a function`（路由不拦就是没有说明的 500），故在**取数之前**用 `Array.isArray` 拦成 400：取数要打外部源（墙钟 1–4s），空请求不该白跑一次。同时覆盖 405（带可照抄的用法示例）、坏 JSON、未知彩种（返回 8 个可选值）、缺期号
- **新增：`.github/workflows/backup.yml` 每日 D1 备份（默认不跑）** — 不配 3 个 secrets 就打印跳过并给出说明，fork 不会莫名多一个红叉。跑起来时：`wrangler d1 export --remote` → **真还原一次**到临时 sqlite 并逐表报行数 → 推 R2（配了 `vars.R2_BUCKET`）或 Actions 产物（90 天）。两处实测结论写进 `docs/BACKUP.md`：① 导出 SQL 的 `CREATE TABLE` 不带 `IF NOT EXISTS`，往已有同名表的库再导一次直接 `table draws already exists` → 恢复只能是「导进新库」或 `--no-schema` 只灌数据；② **`wrangler d1 export` 会把带 `X-Amz-Signature` 的预签名 R2 链接打到 stdout，1 小时内谁拿到都能下载整库**，而公开仓库的 Actions 日志人人可读 → 输出重定向后过滤掉那一行再打印
- **新增：开奖订阅推送（默认关闭，`sync.yml` 的 `notify` job + `scripts/notify.mjs`）** — provider 无关：`dingtalk` / `feishu` / `slack` / `telegram` / `generic` 五种 body 形状，全部配置来自 secrets/vars，仓库不含任何地址或令牌。做在 Actions 而不是 Worker，是因为免费层的 `ctx.waitUntil` 会静默丢（v0.12 刚为「闭环死了五天而 CI 全绿」付过学费），而推送失败必须看得见。`needs: [sync, review]` + `if: !cancelled()` → **job 失败时标题变 ❌ 照样发**；只在 `schedule` / `workflow_dispatch` 后触发，否则每次代码 push 都会往群里塞一条。`send()` 在 HTTP 非 2xx 以及「200 但 body 里 `errcode != 0`」两种情况下都抛错；测试用**本地真 http server** 收一次并核对收到的字节。刻意**不实现各家加签**（细节不同、硬编码容易做错，宁可不发也不发半对的），`docs/NOTIFY.md` 给出改用关键词/白名单的替代
- **更正 CHANGELOG 自己** — v0.12 条目里「系数由 3412 期拟合」是错的：3412 是绝对刻度的分母，参与拟合的是 3250 期（旧 70% = 2275 期）。这条本来只被 `scripts/coldness/ssq-fit.mjs` 的对账闸门抓出来写在下面一条里，现在把出错的原句也改对
- **修复：所有上游请求都没有超时，境内站点一挂就把用户请求拖死** — 本轮 push 的 CI 冒烟红在第三个端点（`/api/ssq/latest` curl 30s 超时），本机连跑三次实测 **25s 超时 / 22.2s 成功 / 2.4s 命中缓存**：`fetch500` / `fetchCWL`（两步）/ `fetch17500` / `fetchSmall` / 自定义源共 8 处 `fetch` 全都没有超时，而 cwl.gov.cn、datachart.500.com、data.17500.cn 从 CF 边缘 PoP 访问偶尔根本不回包。新增 `worker/src/net.js` 的 `fetchT`，两档——常规取数 8s、17500 全量文本（约 0.5MB，回测要用）20s；超时抛 `TimeoutError`，正好被既有的 `.catch` 接住并按多源设计降级（**快速失败好过慢慢挂着**）。`net.test.mjs` 用「永不 `res.end()`」的本地 server 验证超时真的生效
- 测试 **106 项全过** = 89 worker（unit 34 / predict 26 / coldness 8 / review 5 / verify-batch 9 / ui-render 4 / net 3）+ 12 统计内核 + 5 推送；`worker/package.json`、`sync.yml` 测试步骤与 README 里的项数都按逐文件实测输出对齐（数字会随文件增加而过期，所以这次每个文件单独数过再写）
- **未做（以及为什么不做）**：① 复式/胆拖在批量入口里的自动展开（前端已有独立入口，展开后仍是注列表，不该在验奖里再造一套出票逻辑）；② 中奖个税——本站没有逐条核对过官方计税口径（门槛、按条还是按票合计），不确定就不算，给一个错的税额比不给更糟；③ 票面图片识别（能力边界，不是遗漏）。备份侧同样刻意不做增量备份与备份加密，理由写在 `docs/BACKUP.md` 末节
- **模板不再自带作者的自定义域名 route** — `worker/wrangler.toml` 的 `routes` 改成默认注释的中性示例：fork 的人不持有那个 zone，直接部署会失败；而 routes 是**同步语义**（配置里没有的 route 会在部署时被解绑），所以不能靠"删掉"解决。作者自己的部署走 gitignore 的 `wrangler.local.toml`（那份保留 route），模板改动不影响线上域名
- **修掉一条跑不通的部署命令** — README / PUBLISH 原文 `npm --prefix worker run deploy -- --config worker/wrangler.local.toml`：npm 会在**包目录里**执行脚本（临时 package.json 探针实测 `process.cwd()` 落在 prefix 目录），于是它去找根本不存在的 `worker/worker/wrangler.local.toml`。改为 `cd worker && npm run build:ui && npx --yes wrangler deploy --config wrangler.local.toml`，并用 `--dry-run` 实跑验证（正确解析 config 与 D1 绑定后才写进文档）

## v0.12.0 · 复盘闭环复活 + 冷门度模型 + 诚实性收敛（2026-09-10）

本轮由一次全量实证审计驱动：把双色球 2003→2026 共 **3501 期**真实开奖（含各奖级中奖注数、销量、奖池，与官方接口逐字段核对一致）跑了一遍统计检验，据此修死链路、改口径、并只保留统计上站得住的新功能。

- **修复：数字型彩种永久无法对账（P0）** — v0.11 只修好了号码池型。`recommendDigits` 的 picks 字段是 `digits`/`number`，而快照与对账都读 `x.main`，导致 fc3d / pl3 / pl5 / qxc 四个数字彩种的快照里 `picks` 只剩 `name`+`aux`（线上实测），**永久丢号、永不可对账**。现按彩种 `type` 分叉存储与对账；数字型严格**逐位比对**（第 i 位只对第 i 位）——若退化成"该数字是否出现在开奖号里"，3D 的 123 会被判成与 321 全中，命中率虚高数倍
- **修复：复盘闭环停摆与空断言共谋** — `reviewJob` 只被 `adminSync` 的 `ctx.waitUntil` 自 fetch 触发（免费层会静默丢弃），实际状态是全库 8 条快照全部 `checked=0`、五天后仍无一例对账；而 `smoke` 对 `/api/review` 的断言是 `typeof j.summary === 'object'`——`summary` 为 `{}` 也通过。于是 CI 全绿、闭环已死。现新增独立 `review` job 显式 POST `/api/admin/review-job`，并对每日开奖彩种加「最新快照距今 ≤2 天且已有对账记录」不变式
- **新增：`/api/coldness` 冷门度（唯一被样本外验证支持的收益项）** — 系数由 3250 期**真实一等奖中奖注数**（按销量归一；3412 是绝对刻度的分母，不是拟合样本）按时间顺序拟合，旧 70%（2275 期）拟合、新 30%（975 期）样本外检验：五分位最热/最冷 = **1.506 倍**（p=6.2e-10）；安慰剂对照（蓝球特征打在不含蓝的二等奖上）= **1.006 / 0.993** 干净归零；连号特征样本外反号（0.992→1.028）**已剔除**，不因样本内好看而保留。定性说明写进响应：只影响中奖后与多少人分奖，**不改变中奖概率**，期望回报仍为负
- **止血：校准权重是展示用途** — 带 `weights` 的 `killList` 仅出现在 `/api/kill-calibrated`，而用户真正看到的推荐（`predict.js:396`）与胆拖单（`predict.js:747`）调的都是**无权重**版本。UI 文案改为「回测校准权重 · 展示参考」并明确不参与出票。未擅自接通权重：那会改变实际下注号码，而权重无统计依据
- **收敛：徽章加样本门槛** — 回测「有效 / √显著」在 `tested < 100` 时降级为「样本不足，无法判断」；`/api/review` 的 `summary` 新增 `reliable` 与 `note`，并在无任何已对账样本时返回 `meta.hint`，把「没能力判断」与「已验证无效果」区分开
- **入库：随机性检验 `scripts/randomness/`** — 独立可跑的 4 组检验（均匀性 / 独立性 / 稳定性 / 投注侧偏好），含 `.github/workflows/randomness.yml` 月度运行与**安慰剂显著即构建失败**的门禁；结论存档于 `docs/randomness-2026-09.md`
- **关键统计陷阱（写进代码注释防复发）** — 号频 χ² 的零分布均值是 **27 而非 df=32**（每期 6 个号互斥造成负相关），用解析 df=32 会把真实 p=0.021 误判成 p=0.069
- 测试 **73 项**全过（unit + predict 60 项，新增 coldness 8 项：方向、单调、边界、输入校验、免责声明纪律、连号剔除锁；新增 `review.test.mjs` 5 项：复盘闭环端到端）。这 5 项做过**变异测试**：单独把 `danHit` 改回下标遮蔽的错写，恰好只有对应用例变红（`pass 4 / fail 1`），还原后 73 全绿——确认它是真守卫，不是装饰；版本 0.12.0
- **随机性审计推广到 8 个彩种** — `fetch-multi.mjs` + `lib-kinds.mjs` + `analyze.mjs --all`（各 2063–8750 期），报告 `docs/randomness-multi-latest.md`。零分布期望一律现算 `池 × (1 − 开出数/池)`，不复用双色球的 27。跨族 Bonferroni（116 个检验，α=4.31e-4）后剩下的两条「显著」都被**证伪而非采纳**：大乐透前区 χ²=89.1 是 2007–2014 源数据回填缺陷（分半相关 r=−0.26、2015+ 重测 p=0.89），七星彩第 7 位非均匀是**规则本身**（0–9 约 9%、10–14 约 1.8%），拿 df=14 检验属模型误设。`--all` 现在跑不全即非零退出，并新增覆盖闸门——「8 彩种没问题」和「8 彩种没跑成」不能长一个样
- **冷门度系数变成可复现、可月度重验的东西** — 新增 `scripts/coldness/ssq-fit.mjs`：重拟合 → 样本外验证 → 安慰剂 → **与 `worker/src/coldness.js` 线上常量对账**（抓源码里的 `m:` 与冷热名单逐条比），闸门为五分位比 ≤1.2 / 已上线特征样本外反号 / 安慰剂破 / 常量脱节 → `COLDNESS: FAIL` + 退出码 1，挂进 `randomness.yml` 月度作业。它上线第一次跑就抓到两处文档说谎：`coldness.js` 头注写的「旧 70%（2437 期）」实为 **2275 期**，README 写的「系数来自 3412 期」里 3412 只是**绝对刻度**的分母（进入拟合的是 3250 期）；另外把 `avgFirstWinners` 的无条件均值 8.27 与拟合样本内的条件均值 8.68 分开算——拿后者当刻度会把 `estWinners` 系统性高估 4.7%。闸门同样做过变异测试（把安慰剂目标改成一等奖口径 → 2 项失败、退出码 1；把系数抹平成 1 → 6 项失败）
- **大乐透冷门度：负结果按负结果存档，不发布** — 2921 期（只用 2015+，2015 前按回填缺陷排除）拟合后，目标样本外确实复现（五分位 1.30×、MW p=0.007），但预注册的固定奖级安慰剂对**所有**候选特征全灭，`keep=[]`。方法学死结记进了文档与代码注释：**大乐透没有任何一档奖金只依赖后区**（三等奖=前区5中+后区0中），前区被超买时其邻域(4中5)同样被超买 → 这份数据分不清「混淆」与「真实邻域人气」。双色球能用二等奖当对照，只因它恰好不看蓝球。留档 `docs/coldness-dlt-2026-09.md` + `scripts/coldness/dlt-fit.mjs`（与姊妹解析 2921/2921 期号码一致）；**刻意不进月度 CI**——它缺的是集合外人气代理数据，不是时间，挂成每月红灯只会训练人忽略红灯
- **数据基线入库** — `scripts/randomness/data/*.json`（8 彩种全量解析结果）进仓库，原始 txt（约 4MB）用 `.gitignore` 排除；这样文档里的每个统计数字都能离线重跑，而不是依赖某个已经拉不到数的公网文件

- **上线后真实 CI 又抓出三处（本地全都测不出来）**：① `review.test.mjs` 经 `index.js` 依赖 gitignore 的 `ui.js` → 干净检出必 `ERR_MODULE_NOT_FOUND`，CI 测试前先 `build-ui`；② 复盘健康断言用错了命题（`latestChecked` 非空 ≠ 健康；"最新快照指向还没开的那一期"是常态），改为「有没有逾期未对账的期」+「全库至少一条已对账」，并用变异测试验证它会红；③ `cwl.gov.cn` 的 WAF 挡机房 IP（runner 拿 403），"未过官方交叉校验就不出结论"会让月度作业永远红 → 改为区分「源不可达」与「数据不一致」，前者降级为与仓库基线回归比对（重叠历史任一字段变了仍硬失败），并把降级状态印进报告第 0 节
- **修复：大乐透在新鲜度保险丝里是隐身的**：500 解析器 `date` 恒为空（`dlt.js:15`），空日期写进 D1 后 `/api/meta` 的 `stale[]` 直接漏掉 dlt（实测 7 个彩种），它的停摆不会亮黄条，分年 eras / 开奖日统计也失去依据。改为用本就要取来做交叉校验的 17500 备源按期号回填日期（不多花一次请求）。线上复验：`stale[]` 覆盖 8 个彩种，`dlt_draws.draw_date` 已写入（26103 → 2026-09-09）

## v0.11.0 · 工程韧性与使用体验（2026-09-08）

- **CI 部署冒烟**：`sync.yml` 新增 `smoke` job——push / 定时同步后对线上 5 端点（health / meta / ssq-latest / dlt-predict / review）断言 HTTP 200 + 关键字段。首跑即抓出断言与端点契约不符（dlt 断言误打无 picks 的 analyze 端点），修正后全绿——冒烟从第一分钟就证明了自己的价值
- **dlt 交叉校验**：大乐透补齐与双色球同标准的落库防护——500 与 17500 最近 30 期逐期比对（`crossCheck` 助手两处复用，`drawPair` 归一各彩种号型字段），不一致期号拒绝写 D1，sync 响应带 `crosscheck` 报告
- **数据新鲜度保险丝**：`/api/meta` 附带 `stale[]`（各彩种 D1 最新一期距今天数，10 分钟内存缓存）；前端任一彩种 ≥4 天在顶部亮黄条「数据可能过期（同步任务停摆？）」
- **复盘显著性**：`/api/review` 聚合输出挂二项检验 `p` 值（`pickP/danP/killP`，对照随机单号基线，n<20 为 null）；前端复盘卡片直接显示「显著/不显著」
- **阈值寻优**：新端点 `/api/kill-tune`（前端「杀号阈值寻优」按钮）——5 个分位（20%~40%）× 旧 70% 拟合 / 新 30% 验证共 10 次回测，输出 `gap` 与诚实判据。线上实测（双色球）：gap=0.018 → 判定「阈值不敏感/过拟合，默认 30% 即可」——工具给出的第一句话就是「别调」
- **deep 取数缓存**：`drawsDeep` 加 isolate 级内存缓存（TTL 30 分钟，key 带 kind+最新期号，新开奖自动失效）；kill-calibrated / kill-tune 共用 `stashCache` 三级缓存写回
- **今日日报页**：新 tab——今日开奖日历（8 彩种红/灰标）、破纪录遗漏预警（`/api/records`：当前遗漏 ≥ 历史纪录标红、≥80% 标橙）、上期对账、下期快照
- **复盘与分年可视化**：回测分年稳定性柱图（热号/杀号命中率 × 随机基线参考线）、复盘卡片「实际 vs 随机基线」对比小图（ECharts）
- **复盘快照修复（封版审计）**：快照此前误用 `analyzeAll`（其返回结构无 picks/dan 字段）导致推荐与定胆恒空，仅 kill 有效；改走 `recommendAll` 同源输出，取数窗口同步扩到 60 期。线上闭环验证 8/8 彩种 picks 非空
- 测试 60 项全过（新增 killThreshold 分位参数化 / thresholdTune 结构与方向锁 2 组）

## v0.10.0 · 统计诚实性 + 预测记忆闭环 + 数据可靠性（2026-09-08）

- **统计显著性检验**：`/api/backtest` 三策略与杀号（含逐公式）全部输出二项检验 `p` 值（正态近似，双侧）；样本 <20 返回 `null`，`p<0.05` 前端标「显著」——杜绝把噪音当规律
- **校准外推检验（holdout）**：`/api/kill-calibrated?holdout=0.3`——权重只用旧 70% 数据拟合，在新 30% 上分别回测「加权 vs 未加权」杀号命中率。新段上校准仍更准才算真有效
- **calibrate 样本量保护（审计修复）**：killed<10 的公式不参与加权；killed≥10 按样本量线性收缩到满强度
- **加权杀号可回测（审计修复）**：`backtest` 接受 `weights` 并传入 killList——「线上给什么、回测验什么」补齐
- **分年稳定性**：`/api/backtest` 输出 `eras[]`（按 date/期号前缀分年）
- **主区形态转移矩阵**：`/api/analyze` 号码池型新增 `shape`——和值档位/奇偶/大小/012路 一阶转移 + 拉普拉斯平滑，输出「上期形态 → 下期 Top3」
- **预测复盘闭环**：新表 `predlog`（UNIQUE(kind,code)），同步任务自动快照下一期推荐 → 开奖后自动对账；`/api/review` 公开查询滚动命中率与明细
- **多源交叉校验（双色球）**：对 500/cwl 两源最近 30 期逐期比对，不一致的期号拒绝落库
- **数据去重（审计修复）**：所有取数出口按 `code` 去重并透传元属性
- **空数据防御（审计修复）**：`mainOf/auxOf` 对 null 入参静默返回空数组
- 测试 58 项全过

## v0.9.0 · 回测 600 期 + 走势图 + 缓存三级化（2026-09-08）

- **回测拉到 600 期跨度**：`drawsDeep`（17500 全量 650 期）；免费版 CPU 限 10ms → 跨度 >60 期自动步长抽样（实测点数封顶 ≈60），返回 `tested/stride`
- **遗漏走势图**：统一入口 `/api/trend?kind=`，前端 ECharts 折线（默认当前遗漏最深 4 个号，可自选 ≤8 个，带缩放条）
- **胆拖单一键保存/导出**：保存到收藏（写入 D1）/ 复制文本 / 导出 TXT
- **同步后自动预热校准缓存**：`/api/admin/sync` 完成后自 fetch 8 个彩种的校准端点（独立请求 CPU 独立）
- **freqStats 性能重写**：当前遗漏由 `lastSeen` O(1) 推导（语义等价），600 期基准 ssq/kl8 33→25ms

## v0.8.0 · 校准杀号 + 胆拖单 + 转移矩阵（2026-09-08）

- **校准杀号 `/api/kill-calibrated`**：10 类杀号公式带稳定 key，回测逐公式统计真实命中率，生成 [0.2, 2] 动态权重——无效公式自动降权
- **胆拖投注单 `/api/ticket`**（ssq/dlt/qlc）：胆 = 校准评分最高 D 个（剔除杀号），拖 = 次高 T 个，直接输出注数与金额
- **蓝球/后区转移矩阵**：`analyze` 输出 `auxTransition`（转移频次 Top6，无样本时 fallback 全窗口高频）
- **推荐带形态指标**：`picks[]` 新增 `sum`/`span`；`predict?filter=1` 形态过滤
- **小彩种遗漏走势** `/api/{qlc|kl8}/trend`
- 修正：零权重公式仍进 reasons、胆拖缺省拖数被钳位成 1、转移字典被常量遮蔽恒为空
- 测试 53 项

## v0.7.0 · 历史回测引擎（2026-09-08）

- **回测引擎 `/api/backtest`**：逐期用「当期之前」的数据预测再与真实开奖比对（杜绝未来函数），输出真实命中率 vs 随机基线与「有效 / 无信息」结论
- 小彩种样本 60 → 150 期
- 修正：回测循环方向写反（测了最旧几期、历史窗口为空）
- 测试 46 项（新增「恒定开奖 100% 命中」确定性校验）

## v0.6.0 · 统一预测引擎（2026-09-08）

- **`worker/src/predict.js`**：8 彩种共用同一套分析 / 杀号 / 定胆 / 推荐，返回结构完全一致
- **杀号**（10 类公式加权投票）、**定胆**（频率 + 遗漏回归 + 邻号 + 重号）
- **6 套策略**：稳健·热号 / 进取·遗漏 / 均衡 / 区间覆盖 / 杀号缩水 / 随机基准，均带结构分
- **注数与金额计算器** `/api/calc`、**中奖计算器** `/api/prize`
- 数字型按位分析（`perPos`），组三 / 组六 / 豹子形态统计
- 修正：快乐8 结构分基准、七乐彩特别号去重、抽样去重顺序
- 测试 44 项

## v0.5.0 · 数据正确性大修（2026-09-08）

- 修复：双色球 17500 备源日期列错位（双源失败时静默返回 2003 年数据）、期号 5/7 位不统一、验奖未归一化号码、缺 CORS 预检、大乐透奖级错误、旋转矩阵 `minHit` 从未参与计算
- 新增：旋转矩阵覆盖设计贪心构造 + 覆盖校验、大乐透/小彩种落库、小彩种验奖与 D1 降级、AC/012路/质合/尾数/连号/重号统计、PWA + Service Worker
- GitHub Actions：单元测试 + 真实落库
- 测试 34 项 + 12 项真实数据源测试
