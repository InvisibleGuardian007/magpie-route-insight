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

// ---- 智商检测：从模型回答里抠文档、洗脚本、把家族落到具体型号 ----
const { TESTS, extractHtml, sanitizeHtml, rankModels } = await import("./lib/lab.mjs");
assert.equal(TESTS.length, 3, "numeric fingerprint / fingerprint / html animation");
assert.deepEqual(TESTS.map((one) => one.id), ["numfp", "family", "anim"]);

const whole = "<!DOCTYPE html><html><body><p>x</p></body></html>";
assert.equal(extractHtml("前言\n" + whole + "\n后记"), whole, "整份文档原样取出来");
const bare = extractHtml("给你：<svg viewBox='0 0 10 10'><circle r='4'/></svg>");
assert.ok(bare && bare.indexOf("<!DOCTYPE html>") === 0 && bare.indexOf("<svg") > 0, "只回 SVG 时套一个能跑动画的壳");
assert.ok(bare.indexOf("max-width") > 0, "壳里有 svg{max-width:100%}");
const cut = extractHtml("<!DOCTYPE html><html><head><style>@keyframes s{}</style></head><body><svg></svg>");
assert.ok(cut.endsWith("</body></html>"), "被截断的文档自己补收尾");
assert.equal((cut.match(/<!DOCTYPE/gi) || []).length, 1, "不会嵌成两层 html");
assert.equal(extractHtml("我不会画"), "");

const dirty =
  "<html><head><link rel=stylesheet href='https://x/y.css'><style>@import 'https://x/z.css'; @keyframes s{}</style></head>" +
  "<body onload='steal()'><script>fetch('https://evil')</script><iframe src='https://evil'></iframe>" +
  "<a href='https://evil'>go</a><img src='data:image/png;base64,AA'><style></style></body></html>";
const clean = sanitizeHtml(dirty);
assert.ok(clean.indexOf("<script") < 0, "脚本剥掉");
assert.ok(clean.indexOf("<iframe") < 0, "iframe 剥掉");
assert.ok(clean.indexOf("onload") < 0, "内联事件剥掉");
assert.ok(clean.indexOf("https://x/y.css") < 0 && clean.indexOf("@import") < 0, "外部样式和 @import 剥掉");
assert.ok(clean.indexOf("data:image/png") > 0, "data: 图片留着");
assert.ok(clean.indexOf("@keyframes") > 0, "关键帧留着，动画才能跑");

// 参考库落地：分组不进排名，同名型号并成一行，路由中的型号排前面
const scored = [
  { id: "deepseek", name: "深度求索 / DeepSeek", score: 3.1, route: false },
  { id: "openai", name: "OpenAI / GPT", score: 2.4, route: false }
];
const library = [
  { id: "group/in-common-use", provider: "auto", model: "group/in-common-use", group: true, family: "openai", familyName: "OpenAI", levels: [] },
  { id: "a/ds-flash", provider: "auto", model: "deepseek-v4.1-flash", group: false, family: "deepseek", familyName: "深度求索", levels: ["low", "high"] },
  { id: "b/ds-flash", provider: "wb-proxy-cn", model: "deepseek-v4.1-flash", group: false, family: "deepseek", familyName: "深度求索", levels: ["low", "high"] },
  { id: "a/gpt-6-sol", provider: "auto", model: "gpt-6-sol", group: false, family: "openai", familyName: "OpenAI", levels: ["high"] }
];
const ranked = rankModels(scored, { library, haystack: "我是 deepseek-v4.1-flash", served: "auto/deepseek-v4.1-flash" });
assert.equal(ranked.length, 2, "分组不占排名位，两个具体型号各一行");
assert.equal(ranked[0].name, "deepseek-v4.1-flash", "自述命中又正好是这次路由的型号排第一");
assert.equal(ranked[0].providers.length, 2, "同名型号在多个供应商下并成一行");
assert.equal(ranked[0].route, true);
assert.deepEqual(ranked[0].levels, ["low", "high"], "候选带着自己的强度档位");
const sum = ranked.reduce((acc, one) => acc + one.prob, 0);
assert.ok(Math.abs(sum - 1) < 1e-9, "概率在候选之间归一化");
const fallback = rankModels(scored, { library: [] });
assert.equal(fallback.length, scored.length, "参考库拿不到就退回家族级");
assert.equal(fallback[0].name, "深度求索 / DeepSeek", "退回家族级时名字还是家族的");

const lab = await import("./lib/lab.mjs");
assert.ok(/鹈鹕骑自行车/.test(lab.ANIM_PROMPT), "默认提示词就是鹈鹕骑车那句");
assert.equal(lab.TESTS.filter((one) => one.id === "pelican").length, 0, "界面已经撤掉一键画鹈鹕");

// ---- 数值指纹：挑战是「1..355 里挑 N 个数」，解析只收最长那段 ----
// 离线跑，不碰参考库（3.6 MB 数据要联网下，回归测试不该依赖网络）。
const lmfpd = await import("./lib/lmfpd/index.js");
const challenges = lmfpd.generateChallenges(3);
assert.equal(challenges.length, 3, "给三个挑战");
assert.ok(
  challenges.every((one) => /^probe-\d/.test(one.id) && Number(one.expected_count) >= 100 && String(one.prompt).length > 80),
  "每个挑战都有 id / expected_count / 一段足够长的提示词"
);
assert.ok(
  challenges.every((one) => String(one.prompt).indexOf(String(one.expected_count)) >= 0),
  "提示词里写明了要挑几个数"
);
const nums = lmfpd.parseNumbers("1, 2, 3, 4, 5, " + [16, 53, 90, 127, 164, 201, 238, 275, 312, 349].join(", "));
assert.equal(nums.length, 15, "连着的 1..5 和后面一串都收进来（长段优先）");
assert.equal(nums[0], 1, "从第一个数开始收");
assert.ok(nums.every((n) => n >= 1 && n <= 355), "只收 1..355");
assert.equal(lmfpd.parseNumbers("没有数字").length, 0, "没有数字就空数组");

console.log("route-insight: 52 assertions passed");