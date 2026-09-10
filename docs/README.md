# 文档索引

> 主入口是仓库根的 [README.md](../README.md)（功能、部署、API、设计原则都在那儿）。
> 本文件只回答一件事：**这些文档各自负责什么，哪些是自动产物、改它是没用的。**

## 按问题找文档

| 你的问题 | 文件 | 性质 |
|---|---|---|
| 这站能干什么、怎么装起来 | [../README.md](../README.md) | 手写 |
| 发布前 / 自建部署要检查什么、CI 各能力要配哪些 secrets | [PUBLISH.md](PUBLISH.md) | 手写 |
| 版本改了什么、为什么这么改 | [CHANGELOG.md](CHANGELOG.md) | 手写（每版一条） |
| 「冷热 / 遗漏 / 回补」这些说法有没有依据 | [research.md](research.md) §3 假设对账 | 手写（数据变了要更新） |
| 双色球随机性深检的完整读数 | [randomness-2026-09.md](randomness-2026-09.md) | 手工存档（当期基线） |
| 本月双色球审计 | [randomness-latest.md](randomness-latest.md) | **自动产物**，由 `scripts/randomness/analyze.mjs` 覆写，勿手改 |
| 本月 8 彩种扩展审计 | [randomness-multi-latest.md](randomness-multi-latest.md) | **自动产物**，同上 |
| 冷门度系数重拟合与线上常量对账 | [coldness-latest.md](coldness-latest.md) | **自动产物**，由 `scripts/coldness/ssq-fit.mjs` 覆写 |
| 大乐透冷门度为什么最终没发布 | [coldness-dlt-2026-09.md](coldness-dlt-2026-09.md) | 手写（负结果留档） |
| D1 备份怎么开、恢复姿势、为什么默认不含 `favs` | [BACKUP.md](BACKUP.md) | 手写 |
| 开奖推送怎么开、五家 webhook 格式、排错 | [NOTIFY.md](NOTIFY.md) | 手写 |
| 统计脚本怎么单独跑 | [../scripts/randomness/README.md](../scripts/randomness/README.md) · [../scripts/coldness/README.md](../scripts/coldness/README.md) | 手写 |

## 自动产物有一条共同规矩

`*-latest.md` 三个文件是脚本产物（本地跑一次就会覆写，`.github/workflows/randomness.yml` 每月跑一次并把报告存成
artifact 归档 180 天）。**workflow 不会自动把产物 commit 回仓库**，所以检出里看到的是上一次运行后手工提交的那份——
判断它新不新，看文件顶部的「生成时间」和仓库对 `docs/*-latest.md` 的最近一次提交，不要只看措辞。
提交进仓库只为让**离线检出也能复现结论**。手改没有意义，下一次运行就覆盖。真正的"闸门"不在文件里，而在
`.github/workflows/randomness.yml`：安慰剂显著、验收未过、彩种掉队都会让 CI 直接红。所以想知道"这份结论
现在还可不可信"，去看 Actions 里 `randomness` 最近一次运行的日期与绿/红，而不是只看这份 markdown 的措辞。

## 阅读顺序建议

1. [../README.md](../README.md) 的「统计诚实性」——先知道这个项目认为什么才算证据；
2. [research.md](research.md) §3——早期假设怎么被 3501 期数据逐个否掉，只剩投注侧一个方向；
3. [randomness-2026-09.md](randomness-2026-09.md) 或最新的 `randomness-latest.md`——完整读数；
4. [coldness-dlt-2026-09.md](coldness-dlt-2026-09.md)——一个"看起来复现了但按规则不发"的例子；
5. 要动手部署再回 [PUBLISH.md](PUBLISH.md)。
