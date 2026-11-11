import assert from "node:assert/strict";
import { compact } from "./lib/store.mjs";
import { filterRows, pct, sinceFor, summarize } from "./lib/stats.mjs";

const base = { t: "2026-11-11T14:41:28.5683992+08:00", route_id: 1, agent: "dsh", provider: "wb-proxy-cn", model: "deepseek-v4.1-flash", req: "group/auto", served: "deepseek-v4.1-flash", in: 1000, cache_read: 9000, cache_write: 0, out: 500, reasoning: 100, ms: 10000, ttft_ms: 2000, first_reasoning_ms: 1800, sent_ms: 300, masking_ms: 200, flow_ms: 4000, status: 200, credits: 0.5 };

const row = compact(base);
assert.ok(row, "compact keeps a well formed row");
assert.equal(row.cr, 9000);
assert.equal(row.inp, 1000);
assert.equal(row.ttft, 2000);
assert.equal(typeof row.e, "number");

assert.equal(compact({ agent: "x" }), null, "rows without a time are dropped");
assert.equal(compact({ t: "not a date", agent: "x" }), null);

const failed = compact({ ...base, route_id: 2, status: 524, ms: 6000, ttft_ms: 0 });
const retried = compact({ ...base, route_id: 2, status: 200, ttft_ms: 3000 });
const rows = [row, failed, retried];

// 一行一次尝试；同一 route_id 的两次尝试算一次请求、一次改道。
const report = summarize(rows, { since: Date.parse(base.t) - 60000, until: Date.parse(base.t) + 60000, window: "today" });
assert.equal(report.kpi.attempts, 3);
assert.equal(report.kpi.requests, 2);
assert.equal(report.kpi.fail, 1);
assert.equal(report.kpi.retried, 1);
// 失败那次没有首字，不进分位数；剩下 2000 和 3000 两个值，最近秩取上界。
assert.equal(report.kpi.ttftP50, 3000, "failed attempts without ttft stay out of the percentiles");
assert.equal(report.kpi.cacheRead, 27000);
assert.equal(report.kpi.hitRate, 0.9, "hit rate is cache read over all input tokens");
assert.equal(report.byProvider.length, 1);
assert.equal(report.byProvider[0].n, 3);
assert.equal(report.rows.length, 3);
assert.equal(report.rows[0].stop, "");

const scoped = filterRows(rows, { since: 0, until: Date.parse(base.t) + 60000, provider: "wb-proxy-cn", status: "fail" });
assert.equal(scoped.length, 1);
assert.equal(filterRows(rows, { since: 0, until: Date.parse(base.t) + 60000, model: "deepseek-v4.1-flash" }).length, 3);
assert.equal(filterRows(rows, { since: 0, until: Date.parse(base.t) + 60000, agent: "nope" }).length, 0);
assert.equal(filterRows(rows, { since: 0, until: Date.parse(base.t) + 60000, text: "524" }).length, 0);
assert.equal(filterRows(rows, { since: 0, until: Date.parse(base.t) + 60000, text: "deepseek" }).length, 3);

assert.equal(pct([], 50), 0);
assert.equal(pct([10, 20, 30], 50), 20);
assert.equal(pct([10, 20, 30], 90), 30);

const today = sinceFor("today", Date.parse("2026-11-11T14:41:28+08:00"));
assert.equal(new Date(today).getHours(), 0, "today starts at local midnight");
assert.ok(sinceFor("1h", 1e12) < 1e12);

// ---- 多选筛选、推理强度、计费方式、路由对齐 ----
const withEffort = rows.map((item, index) =>
  index === 0 ? { ...item, effort: "high", mode: "balance" } : { ...item, effort: "max", mode: "window" }
);
assert.equal(filterRows(withEffort, { since: 0, until: 1e15, provider: "wb-proxy-cn,huanling" }).length, 3);
assert.equal(filterRows(withEffort, { since: 0, until: 1e15, provider: "huanling" }).length, 0);
assert.equal(filterRows(withEffort, { since: 0, until: 1e15, effort: "high" }).length, 1);
assert.equal(filterRows(withEffort, { since: 0, until: 1e15, effort: "high,max" }).length, 3);
assert.equal(filterRows(withEffort, { since: 0, until: 1e15, effort: "(无)" }).length, 0);

const split = summarize(withEffort, { since: 0, until: 1e15, window: "today" });
assert.equal(split.byEffort.length, 2, "each effort gets its own row");
assert.equal(split.kpi.modes.window.rows, 2, "window billed attempts are counted apart from credits");
assert.equal(split.kpi.modes.balance.rows, 1);
assert.equal(split.byProvider[0].mode, "balance", "provider keeps its billing mode");

// ---- billing: 有窗口算额度，有余额算余额，都没有算积分 ----
import os from "node:os";
import path from "node:path";
import fsTmp from "node:fs";

const tmp = fsTmp.mkdtempSync(path.join(os.tmpdir(), "route-insight-"));
process.env.MAGPIE_CONFIG_DIR = tmp;
const { readBilling, modeOf } = await import("./lib/billing.mjs");
fsTmp.writeFileSync(
  path.join(tmp, "quotas.json"),
  JSON.stringify({
    "codex/a@b": { at: "2026-11-11T15:01:09+08:00", quota: { provider: "codex", windows: [{ name: "5 小时", used: 0.4 }, { name: "7 天", used: 1 }] } },
    "huanling/balance 1": { at: "2026-11-11T14:59:57+08:00", quota: { provider: "huanling", name: "幻灵AI", balance: "$13.09" } },
    "huanling/balance 2": { at: "2026-11-11T14:59:57+08:00", quota: { provider: "huanling", name: "幻灵AI", balance: "$2.01" } }
  })
);
const billing = readBilling(Date.parse("2026-11-11T15:02:00+08:00"));
assert.equal(billing.providers.huanling.balance, 15.1, "same vendor keeps one summed balance");
assert.equal(billing.providers.huanling.balanceText, "$15.10");
assert.equal(modeOf(billing, "huanling"), "balance");
assert.equal(modeOf(billing, "codex"), "window");
assert.equal(modeOf(billing, "wb-proxy-cn"), "credit", "vendors without quota data fall back to credits");
assert.equal(billing.providers.codex.windows.length, 2);

// ---- routing: 用 responseId 把推理强度接回用量行 ----
const { RoutingIndex, routingFileFor } = await import("./lib/routing.mjs");
fsTmp.mkdirSync(path.join(tmp, "routing"), { recursive: true });
const when = Date.parse("2026-11-11T14:41:28+08:00");
fsTmp.writeFileSync(
  routingFileFor(when),
  JSON.stringify({ time: "2026-11-11T14:41:28.568+08:00", responseId: "resp-1", effort: "max", model: "group/auto", served: "wb-proxy-cn/deepseek-v4.1-flash", rule: { name: "最难的功能" }, usage: [{ provider: "wb-proxy-cn", model: "deepseek-v4.1-flash" }] }) + "\n"
);
const index = new RoutingIndex();
const linked = index.decorate([{ ...withEffort[0], responseId: "resp-1" }], when + 1000);
assert.equal(linked[0].effort, "max");
assert.equal(linked[0].rule, "最难的功能");
assert.equal(linked[0].asked, "group/auto");
assert.equal(index.decorate([{ ...withEffort[1], responseId: "missing" }], when)[0].effort, "max", "unknown responses keep their own fields");
fsTmp.rmSync(tmp, { recursive: true, force: true });

console.log("route-insight: 27 assertions passed");