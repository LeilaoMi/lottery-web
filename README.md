# lottery-web · 自用彩票网页端 v0.2.0

双色球+大乐透，500主+cwl官+17500备，双源比对，CF Workers自用。

## 线上
- 主：https://lottery-web.horjane.workers.dev/ （已通，/health 200）
- 子域：https://cp.leilaomi.cc.cd/ （DNS已建，待权威同步）

## 接口
- GET /health {status,version,lotteries}
- GET /api/meta
- SSQ: /api/ssq/latest|history?limit=|trend?win=|analyze?win=|recommend|verify?code=&red=&blue=
- DLT: /api/dlt/latest|history|analyze|verify?code=&front=&back=

## 本地
```bash
cd worker
pnpm dlx wrangler dev
```

## Secrets名（不写值）
- CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
- DATA_SOURCE_OFFICIAL / DATA_SOURCE_PUBLIC（可选直连覆盖） / API_TOKEN（可选鉴权）

## 结构
```
worker/src/index.js 路由+缓存
worker/src/ssq.js 500/cwl/17500+校验+多窗+蓝7维+6策略+结构分+走势遗漏+验奖
worker/src/dlt.js 500+17500备+分析+验奖
db/schema.sql draws+dlt_draws+sync_log
frontend/index.html 已内联进Worker /，另存独立版
```

## 证据 2026-09-07
- /health 0.2.0，/latest SSQ 26103双源一致，DLT 26101，trend遗漏表，recommend6注带分
