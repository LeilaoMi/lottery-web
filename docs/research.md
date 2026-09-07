# research · 全量吸收（2026-09-07）

调查：github search `lottery tool ssq` 4条 + `双色球 彩票` 99条 + `lottery web vercel trend` 0条，clone 8库深读。

## 双源定稿（Workers可用）
1. 主：`https://datachart.500.com/ssq/history/newinc/history.php?limit=N` HTML表格，正则`<tr>/<td>`，字段期号+红6+蓝+日期+奖池/销量。cwl被WAF 403后的替代，`Lucasyao1985/lottery-skills v6.3`实证。
2. 官：`https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100&pageNo=1&pageSize=100&systemType=PC`，必须先GET `https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/`拿cookie+UA+Referer，否则result空，`longgeyyds/ssq-fusion`实证。Workers里直试，失败即 fallback。
3. 备：`http://data.17500.cn/ssq_asc.txt`（及dlt/pl3/pl5/7lc/7xc/kl8），极简txt，实测易429，需缓存+退避。
4. 体彩：`https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85` DLT，`gameNo=35` PL3类，`Lucasyao1985`+`Konata9`确认。

## 校验（强制）
- SSQ期号7位YYYYNNN（兼容500的5位短号，原样保留比对），红6 01-33无重复排序，蓝01-16。任一失败丢弃，不用模拟。
- DLT前5/35+后2/12，期号5位YYNNN。
- 双源都有才比对，不一致标consistent:false+conflict双方，不覆盖。

## 分析吸收
- 多窗口10/20/30/50并行（lottery-skills）
- 红6策略：稳健热号/进取遗漏狙击/均衡/冷热z-score加权/区间覆盖/随机基准（ssq-fusion strategies.md，源MilkyDragon/Lucasyao1985/LeeX852）
- 结构分：和值P20-80 +3，奇偶常见+2，大小常见+2，三区全覆盖+2，跨度近均值+1
- 铁律：避前1期红，蓝冷回补，不追全连号/全顺子/全同尾
- 蓝独立7维：遗漏0.25+热度0.20+奇偶0.15+区间0.10+振幅0.10+回归0.10，贝叶斯后乘（5期重复×0.7，全缺×1.05）
- 复盘：新开奖自动对上期预测算红中数/蓝中否/奖等，累计最高/均值
- 风控：Konata要求必须风险提示“随机/娱乐/不保证”，无真实数据不推荐

## 前端吸收（sinyu1012）
- Tabs：最新预测/图表分析/历史回溯，mobile底 nav，loading屏
- 图：红频/蓝频/奇偶/和值走势/分区+ECharts，history表+accuracy卡
- vercel.json头：/data no-cache，nosniff/DENY/XSS

## License合规
- MIT可复用逻辑自写：sinyu1012，oahzxd/lottoery，BEWINDOWEB/lotterygrabber，longgeyyds/ssq-fusion，Konata9，zxz0119
- Apache-2.0：TheMelody/LotteryTrend，保留声明
- 无License只借思路不抄码：zepen/predict（1029★），piggyone/chromosphere，wushidiguo/hello-lottery（OCR）
- OCR单列：hello-lottery扫码查奖，自用二期再说

## 落到lottery-web
- worker/src/ssq.js：fetch500/fetchCWL/fetch17500+normalize+validate+analysis+blue引擎+recommend
- worker/src/index.js：只路由/health/latest/history/analyze/recommend
- db/schema.sql：draws+sync_log
- frontend/index.html：单文件先跑通mock，真源后切
