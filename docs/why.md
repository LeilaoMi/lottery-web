# why · 关键设计决策的为什么

这份文档回答的不是「怎么用」（见 README），也不是「数从哪来」（见 research / randomness），
而是**当初为什么做成这个样子**——每条都对应一次真实踩坑或一次可证伪的取舍，不是事后美化。

读法：短条目可当决策清单扫；带日期的条目能顺着 CHANGELOG 追回当时的上下文。

## 1. 为什么零 npm 运行时依赖？

Cloudflare Worker 打包时会把依赖打进 bundle。多一个依赖就多一条供应链、一次体积膨胀、
一次「升级把线上弄挂」的可能。本站取数、统计、验奖全部自写（`net.js` / `lib.mjs` / `small.js`），
测试只用 Node 内置 `node --test`。代价是自己维护正态近似、蒙特卡洛、超时 fetch——
可复现性优先于省几行代码。

## 2. 为什么读接口公开免鉴权，只有写和 admin 要 token？

开奖与统计是公开数据；复盘命中率、审计结果、冷门度回看按「可证伪结论必须可被外人查」的原则
公开才有意义。写操作（收藏、触发同步、触发对账）会改库或打上游，必须 `API_TOKEN`，
且不设置时 fail-closed（一律 401）——**默认拒绝好过默认放行**。

## 3. 为什么复盘要先快照再对账，而不是事后补算？

事后补算等于「拿现在的策略去解释过去的号」——未来函数。`predlog` 在开奖前落 `payload`，
开奖后只做 `hit` 对账，这样 `/api/review` 的命中率是**当时说出口的预测**，
不是回放优化后的幻觉。CI 有独立 `review` job，不靠 Worker 里免费层会静默丢的 `waitUntil`。

## 4. 为什么冷门度只发双色球，别的彩种不是「还没做」？

冷门度的全部价值来自「浮动奖要按中奖注数分奖」。固定奖玩法（快乐8 / 3D / 排列3 / 排列5）
中了就是固定金额、无人与你分，coldness 对期望值的影响**严格为 0**——属「不该做」。
大乐透拟合过、目标样本外也复现了，但预注册的固定奖级安慰剂全灭（大乐透没有任何一档奖金
只依赖后区），按规则 `keep=[]` 不发布。详见 [coldness-dlt-2026-09.md](coldness-dlt-2026-09.md)。

## 5. 为什么系数要进 CI 对账，而不是只写在注释里？

`coldness.js` 里的 1.174 / 1.074 / … 若没有 `scripts/coldness/ssq-fit.mjs`，就是
「一组没人能重跑的神秘常量」。月度 `randomness.yml` 重拟合 + 样本外 + 安慰剂；
每次 push 的 `sync.yml` 跑 `check-sync.mjs` 离线比对线上常量 ↔ 拟合产物 ↔ 站内回看——
手改了系数却没重跑拟合，CI 直接红。

## 6. 为什么 skip ≠ pass（审计语义）？

`/api/audit` 里 `skip` = 没部署 / 没跑过 / 表不存在，**不是**「已验证无问题」。
overall 计算 `fail > warn > skip > pass`：只要有 skip 就绝不算整体 pass。
否则「D1 没配」会显示成绿色的「一切正常」——把「没能力检查」伪装成「检查通过」。

## 7. 为什么追号日期按开奖日历推算还要挂免责说明？

D1 里没有官方休市公告表，日期只能按彩种开奖日（`calc.js: DRAW_DAYS`）投影，
春节等休市无法覆盖。所以响应带 `calendarNote`，日历渲染兜底显示
「不含春节等休市，以官方公告为准」——**宁可功能弱一点，也不给错日期让人按错的追号买**。

## 8. 为什么 SW 的离线队列用单调序号排序？

首版用 `Date.now() + 随机后缀` 做队列 key，同一毫秒内顺序抖动导致收藏写入可能乱序。
改为 `lq=${pad15(now)}-${pad8(++seq)}` 单调递增：时间戳防重放、序号保 FIFO，
flush 时严格按 `lq` 升序回放。

## 9. 为什么 `ui.js` 是构建产物、测试前必须 `build:ui`？

前端唯一事实源是 `frontend/index.html`；Worker 内联的是打包产物 `worker/src/ui.js`（gitignore）。
干净检出若不先 `node scripts/build-ui.mjs`，`review.test` 等经 `index.js` 依赖 `ui.js` 的测试
会 `ERR_MODULE_NOT_FOUND`——CI 的测试步骤已固定先 build 再 test。改前端后本地同理。

## 10. 为什么 D1 迁移要版本化，而不是只留一份 schema.sql？

只有一份 schema 时，「线上已有的表」和「仓库里的定义」会静默分叉：谁改了列、谁没跑，
事后对不上。现在 `db/migrations/00NN_*.sql` 是事实源，`db/schema.sql` = 按序拼接的
bootstrap 快照；`unit.test.mjs` 锁死两者一致。已发布迁移文件禁止改内容，改动只许新增。

## 11. 为什么金额宁缺毋假（`amount: null`）？

浮动奖、本站未逐字段校验过的奖级一律返回 `null` 并写明原因，渲染成「—（见公告）」。
给一个猜的税额 / 猜的奖金，用户会从此不信工具的任何输出——**错的数字比没有数字更糟**。

## 12. 为什么推送做在 Actions 而不是 Worker 的 `waitUntil`？

免费层 `ctx.waitUntil` 会静默丢任务（复盘闭环曾因此停摆五天而 CI 全绿）。
推送失败必须看得见：`sync.yml` 的 `notify` job `needs: [sync, review]` + `!cancelled()`，
上游 job 失败时标题变 ❌ 照样发。告警通路只在出事时才有价值。

---

相关：[research.md](research.md)（假设对账）· [CHANGELOG.md](CHANGELOG.md)（每版动机）·
[../README.md](../README.md) 设计原则（更短的清单版）。
