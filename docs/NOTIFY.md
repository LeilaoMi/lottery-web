# 开奖订阅推送（可选，默认关闭）

**结论先行**：这个功能**默认不发任何东西**。没配 `secrets.NOTIFY_WEBHOOK_URL` 时，`sync.yml` 的 `notify` job 只打印一行「推送保持关闭」就退出——不给 fork 本项目的人制造一个莫名报警的机器人。

推送做在 **GitHub Actions** 而不是 Worker 里，理由不是省事：Workers 免费版单请求 CPU 10ms、没有可靠的定时器（本项目的复盘闭环曾经因为依赖 `ctx.waitUntil` 自 fetch 而静默死亡五天，CI 还全绿），而推送失败必须「看得见」——Actions 的 job 状态、日志、重跑是现成的。

## 开启

Settings → Secrets and variables → Actions：

| 名称 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `NOTIFY_WEBHOOK_URL` | Secret | 是 | 你在目标群里拿到的 incoming webhook 地址。**不配就等于关闭** |
| `NOTIFY_FORMAT` | Variable | 否 | `dingtalk`（默认给 `generic`）· `feishu` · `slack` · `telegram` · `generic` |
| `NOTIFY_CHAT_ID` | Secret | Telegram 必填 | Bot API 要 `chat_id`，它不在 webhook URL 里 |
| `WORKER_URL` | Secret | 是（已有） | 播报数据从这里读，读接口不需要 token |

`NOTIFY_FORMAT` 未设时按 `generic` 发：`{"title","text","markdown"}`，自己接的 HTTP 服务照这个形状取就行。各家形状如下（`scripts/notify.mjs` 的 `buildPayload`）：

| format | body |
|---|---|
| `dingtalk` | `{"msgtype":"markdown","markdown":{"title","text"}}` |
| `feishu` | `{"msg_type":"text","content":{"text"}}` |
| `slack` | `{"text"}` |
| `telegram` | `{"chat_id","text","parse_mode":"HTML","disable_web_page_preview":true}` |
| `generic` | `{"title","text","markdown"}` |

## 什么时候会发

只在**定时同步**（开奖日晚上，按 `sync.yml` 顶部的 cron）和**手动 `workflow_dispatch`** 之后发。代码 push 不发——否则每提交一次就往群里塞一条播报。想连 push 一起发，改 `notify` job 的 `if` 条件里的事件名判断即可。

`needs: [sync, review]` 用的是 `!cancelled()`：**job 失败时也发**，标题变成「❌ lottery-web 运行异常」并列出哪个 job 挂了。告警通路的价值恰恰在出问题的时候，只报喜的监控不如没有。

## 一条播报长这样

```markdown
## 🎰 lottery-web 开奖播报 · 2026-09-09

### 今日开奖
- 大乐透 **26103**：03 16 17 32 35 + 02 12
- 排列5 **2026242**：2 4 4 8 2

### 复盘闭环
- 福彩3D：快照至 2026243｜已对账 无
- 快乐8：快照至 2026243｜已对账 2026241

### ⚠️ 数据新鲜度
- 七星彩 最新一期 26103（2026-09-06）距今 3 天

> 推送只播报开奖与自检状态。任何推荐/冷门度都不改变中奖概率，期望回报为负。
```

「今日开奖」只列 `/api/meta` 里 `days === 0` 的彩种（也就是当天真开了的），不会为了凑内容把三天前的号也播报一遍；想让手动触发时看到全部彩种最新一期，设 `vars.NOTIFY_ALWAYS = 1`。

## 本地试发一次

```bash
export NOTIFY_WEBHOOK_URL="https://.../hook"
export NOTIFY_FORMAT="dingtalk"
export WORKER_URL="https://你的worker.example"
node scripts/notify.mjs '{"sync":"success","review":"success"}'
```

打印 `{"sent":true,...}` 才算发出去了。HTTP 非 2xx、以及钉钉/飞书那种「HTTP 200 但 body 里 `errcode != 0`」的业务失败，都会让脚本抛错并让 job 变红——静默失败的通知等于没有通知。

## 排错

- **钉钉 `errcode: 310000`（sign not match / keywords not in content）**：本脚本**不实现加签**（各家签名细节不同，硬编码容易做错）。在机器人安全设置里改用「自定义关键词」（例如关键词设 `lottery-web`，正文里本来就有）或 IP 段白名单；确实需要加签的话，在 `send()` 之前给 URL 补上 `timestamp`/`sign` 查询参数。
- **飞书返回业务错误且提示与签名相关**：同上，飞书机器人的「签名校验」本脚本也不实现，关掉签名或改用关键词。脚本会把这种 200 响应的 body 原样带进报错信息，照着排查即可。
- **Telegram 400 Bad Request**：`chat_id` 没配，或 Bot API 的 URL 形如 `https://api.telegram.org/bot<TOKEN>/sendMessage`（Token 在 URL 里，配到 Secret 里就别再出现在别处）。
- **推送发出去了但内容空**：多半是那天确实没开奖（看「今日开奖」段的说明），或 `WORKER_URL` 指到了一个还没同步过数据的新库。

## 没做的事

- **不内置任何家的签名算法**，理由同上——宁可不发，也不发一条半对半错的。
- **不做失败重试**：Actions 本身能重跑，且重跑历史可查；在脚本里再叠一层重试只会让「到底发没发」更难判断。
- **作者自己的部署没开这个功能**：它是为「需要的人能自己接上」而做的，仓库里不含任何地址或令牌。
