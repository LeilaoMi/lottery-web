# progress · lottery-web v0.5.0 收尾完成

## 部署
- Version `5bd8985d-94e0-4710-a900-9f7a964665d2`，61.20 KiB / gzip 17.87 KiB
- workers.dev 200，cp.leilaomi.cc.cd/* 路由已绑定（zone leilaomi.cc.cd）
- D1 `lottery` APAC（NRT），5 表，102 KB

## 线上实测证据（2026-09-08）
```
GET /health                  -> {"status":"ok","version":"0.5.0","lotteries":[8种]}
GET /api/ssq/latest          -> 2026103 04,11,20,27,28,30 + 15  sources=[500,cwl] consistent=true
GET /api/dlt/latest          -> 26102 前01,03,07,27,28 后06,07
GET /api/qlc/latest          -> 2026103 01,08,20,21,23,26,30 特别29
GET /api/kl8/latest          -> 2026240 20 个号
GET /api/ssq/analyze?win=30  -> 均和99 平均AC7.47 质合47:133 012路65/63/52 连号0.8 重号1.13
```

### 修复项验证
| 项 | 验证 |
|---|---|
| 验奖归一化 | `verify?code=26103&red=4,11,20,27,28,30&blue=15` → hitRed=6, prize=一等（修复前为 0） |
| 期号归一化 | 5 位 `26103` 与 7 位 `2026103` 均可验奖；`latest` 返回 `2026103` 且 `consistent=true` |
| 大乐透验奖 | `front=1,3,7,27,28&back=6,7` → hitFront=5 hitBack=2 prize=一等 |
| 七乐彩验奖 | 7 基本号 + 特别号 → hitMain=7 hitSpecial=true prize=一等 |
| CORS 预检 | `OPTIONS /api/favs` → 204 + Allow-Methods/Allow-Headers |
| 旋转矩阵 | `n=12&pick=6&hit=4` → 53 注，guaranteed=true，uncovered=0 |
| minHit 生效 | `hit=3`→totalT=120/10 注；`hit=4`→totalT=210/23 注 |
| admin/sync 鉴权 | 未设 API_TOKEN 时正确返回 401（fail-closed） |
| 静态资源 | /manifest.json 406B、/sw.js 1175B、/icon.svg 255B，均 200 |
| 首页 | 16486 B，8 彩种齐全，含 manifest 与 SW 注册 |

### D1 落库（此前 dlt_draws / small_draws 建表但零数据）
```
draws        100 行   (ssq)
dlt_draws     60 行   (dlt)      <- 本次首次写入
small_draws  360 行   (6 种 × 60) <- 本次首次写入
sync_log       1 行   sources=500,cwl fetched=100 inserted=100 consistent=1
  fc3d/kl8/pl3/pl5 = 2026240，qlc = 2026103，qxc = 26103
```

## 测试
- `npm test`：34 passed / 0 failed（离线，含 17500 列解析与期号归一化回归）
- `npm run test:live`：12 passed / 0 failed（6 小彩种 + 双色球双源交叉 + 大乐透双源交叉，全部一致）

## 已知待办
- 未设 `API_TOKEN`，接口完全公开，`/api/favs` 任何人可读。建议 `wrangler secret put API_TOKEN` 后前端填入同一 Token
- Actions 定时落库需在仓库 Secrets 配 `WORKER_URL` / `API_TOKEN`，否则 sync 作业会失败告警
- 旋转矩阵为贪心构造，注数约为理论下界的 1.5 倍（12/6/4：53 注 vs 下界 33），非最优
