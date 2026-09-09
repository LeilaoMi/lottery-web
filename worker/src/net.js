// 所有外部数据源请求都必须带超时。
// 起因是实测：`/api/ssq/latest` 在缓存未命中时会挂 20–30 秒（本机连跑三次：25s 超时 / 22.2s 成功 / 2.4s 命中缓存），
// 而境内站点（cwl.gov.cn、datachart.500.com、data.17500.cn）从 CF 边缘 PoP 出去偶尔根本不回包 —— 没有超时的
// fetch 就把用户的请求一起拖死。多源设计本来就允许一条腿失败（另一条继续，再退 D1 缓存），
// 所以「快速失败并按设计降级」永远好过「慢慢挂着直到平台把请求掐掉」。
//
// 两个档位：
//   UPSTREAM_MS  —— 常规取数（最新一期 / 历史页 / 小彩种接口），响应体几十 KB，8 秒还不回来就是没戏
//   BULK_MS      —— 全量文本文件（17500 的 *_asc.txt，约 0.5MB，回测与备源要用），宁可多等一会儿也别轻易降级
export const UPSTREAM_MS = 8000;
export const BULK_MS = 20000;

// 与原生 fetch 同签名，只多一个可选的毫秒数；超时抛 TimeoutError，调用方的 catch 已经能处理
export function fetchT(url, opts = {}, ms = UPSTREAM_MS) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}
