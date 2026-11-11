import assertLib from "node:assert/strict";
import fs from "node:fs";

// 断言数自己数，别在最后写死一个数字（以前写死 52、57，改完就忘了跟着改）。
let asserts = 0;
const assert = new Proxy(assertLib, {
  get(target, key) {
    const value = target[key];
    if (typeof value !== "function") return value;
    return function (...args) {
      asserts += 1;
      return value.apply(target, args);
    };
  }
});
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

// ---- 智商检测：从模型回答里抠文档、洗脚本；三项检测各自的面目 ----
const { TESTS, ANIM_PROMPT, extractHtml, sanitizeHtml } = await import("./lib/lab.mjs");
assert.equal(TESTS.length, 3, "数值指纹 / 协议审计 / HTML 动画");
assert.deepEqual(TESTS.map((one) => one.id), ["numfp", "relay", "anim"]);
assert.equal(TESTS.filter((one) => one.id === "family").length, 0, "自述那项已经从 TESTS 里拿掉");

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

// ---- 协议审计：五项权重必须凑满 100，否则那个分数就没有意义 ----
const relayMod = await import("./lib/relay.mjs");
assert.equal(typeof relayMod.runRelay, "function", "runRelay 是个函数");
const weights = relayMod.RELAY_WEIGHTS;
assert.deepEqual(Object.keys(weights), ["echo", "usage", "tools", "json", "stream"], "五项探针各有名字");
assert.equal(Object.keys(weights).reduce((acc, key) => acc + weights[key], 0), 100, "权重合计 100");

// ---- 数值指纹：样本从 3 提到 5，另有「与第二名的差距」 ----
const numeric = await import("./lib/numeric.mjs");
assert.equal(numeric.ROUND, 3, "参考库 SDK 一回合最多 3 个样本");
assert.equal(numeric.SAMPLES, 6, "两回合共 6 个样本");
assert.equal(numeric.topMargin([{ probability: 0.8 }, { probability: 0.15 }]).toFixed(2), "0.65", "前两名之差");
assert.equal(numeric.topMargin([{ probability: 0.5 }]), null, "只有一个候选就没有差距可言");
assert.equal(numeric.topMargin([]), null, "空排名也不炸");

assert.ok(/鹈鹕骑自行车/.test(ANIM_PROMPT), "默认提示词就是鹈鹕骑车那句");
assert.equal(TESTS.filter((one) => one.id === "pelican").length, 0, "界面已经撤掉一键画鹈鹕");

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

// ---- 协议审计：拿假网关跑一遍，官方形状与 Claude 形状必须分得开 ----
// 全程不联网：把 globalThis.fetch 换掉，按请求体回一份「照抄官方协议」的响应。
const { runRelay } = relayMod;
const realFetch = globalThis.fetch;
let fakeMode = "official";
const usageOfficial = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 0 } };
const usageClaude = { input_tokens: 100, output_tokens: 20 };
function fakeChat(text, extra, usage) {
  return {
    ok: true,
    text: async () =>
      JSON.stringify({
        model: "test/model",
        choices: [{ message: Object.assign({ role: "assistant", content: text }, extra || {}), finish_reason: "stop" }],
        usage
      })
  };
}
function fakeStream(text, usage) {
  const lines = [];
  for (const ch of text) lines.push("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] }));
  lines.push("data: " + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage }));
  lines.push("data: [DONE]");
  return { ok: true, text: async () => lines.join("\n\n") };
}
globalThis.fetch = async function (url, init) {
  const body = JSON.parse(init.body);
  const usage = fakeMode === "claude" ? usageClaude : usageOfficial;
  if (body.stream) return fakeStream("veridrop stream check", usage);
  if (body.tools) {
    return fakeChat(null, {
      tool_calls: [{ id: "call_abc", type: "function", function: { name: "get_current_weather", arguments: JSON.stringify({ city: "Paris", unit: "celsius" }) } }]
    }, usage);
  }
  if (body.response_format) return fakeChat(JSON.stringify({ ok: true, nonce: "openai-detector" }), null, usage);
  const ask = String(body.messages[0].content || "");
  return fakeChat(ask.indexOf("418") >= 0 ? "HTTP 418 means the server is a teapot." : "veridrop stream check", null, usage);
};
try {
  const good = await runRelay("test/model", {});
  assert.equal(good.score, 100, "照抄官方协议的链路拿满分（各项折算后合计 100）");
  assert.equal(good.verdict, "clean");
  assert.equal(good.findings.filter((one) => one.level === "critical").length, 0);
  fakeMode = "claude";
  const bad = await runRelay("test/model", {});
  assert.equal(bad.verdict, "tampered", "只有 input_tokens/output_tokens 的 usage 直接判 tampered");
  assert.ok(bad.findings.some((one) => one.level === "critical"), "并且给一条 critical 疑点");
  assert.ok(bad.score < good.score, "分数确实掉下来了");
} finally {
  globalThis.fetch = realFetch;
}

/* ---- 型号名比对（0.13.6） ----
   用户 m07537：请求 tk1688/gpt-6.1-sol、数数纹理认成 gpt-6-astra/6.1-sol，说这种情况算对上了。
   函数住在 ui/app.js（浏览器脚本，不能 import），这里把标了 MODEL-NAME 的那一段抠出来单跑。 */
{
  const src = fs.readFileSync(new URL("./ui/app.js", import.meta.url), "utf8");
  const a = src.indexOf("/* MODEL-NAME-START");
  const b = src.indexOf("/* MODEL-NAME-END */");
  assert.ok(a > 0 && b > a, "ui/app.js 里要留 MODEL-NAME 标记段，测试靠它取函数");
  const m = new Function(src.slice(a, b) + "\nreturn { normModel: normModel, modelCore: modelCore, sameModel: sameModel };")();
  assert.equal(m.normModel("wb-proxy-cn/deepseek-v4.1-flash-1017"), "deepseekv41flash", "归一化去掉供应商前缀和四位日期尾");
  assert.equal(m.modelCore("gpt-6-astra/6.1-sol"), "61sol", "型号主干取最后一段并去掉厂名前缀");
  assert.ok(m.sameModel("tk1688/gpt-6.1-sol", "gpt-6-astra/6.1-sol"), "同一型号的另一条线路算对上（用户举的例子）");
  assert.ok(m.sameModel("wb-proxy-cn/deepseek-v4.1-flash", "deepseek-v4.1-flash-1017"), "带 -1017 尾也算对上");
  assert.ok(m.sameModel("gpt-6.1-sol", "gpt-6.1-sol"), "同名当然算对上");
  assert.ok(!m.sameModel("gpt-6-luna", "gpt-6.1-sol"), "6-luna 和 6.1-sol 不能混为一谈");
  assert.ok(!m.sameModel("deepseek-v4.1-flash", "gpt-6-luna"), "跨家族不能算对上");
  assert.ok(!m.sameModel("", "gpt-6.1-sol"), "空名字不算对上");
}

/* ---- 超时要说人话（0.13.5） ----
   以前 AbortController 掐断只会留一句 "This operation was aborted."，
   用户看到截图里那行字，既不知道是自己网络还是等太久。现在 ask() 会把秒数写进错误。 */
{
  const { ask } = await import("./lib/gateway.mjs");
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = function (url, init) {
    return new Promise(function (_resolve, reject) {
      init.signal.addEventListener("abort", function () {
        reject(new Error("This operation was aborted"));
      });
    });
  };
  try {
    const slow = await ask("test/model", "写一份 HTML", { timeoutMs: 80 });
    assert.equal(slow.ok, false, "超时的请求不算成功");
    assert.equal(slow.timeout, true, "并且打上 timeout 标记，界面才知道该提示什么");
    assert.equal(slow.timeoutMs, 80, "把预算原样带回去");
    assert.match(slow.error, /秒还没返回完/, "错误里要写清等了多少秒，不能只留英文 abort 原文");
  } finally {
    globalThis.fetch = realFetch2;
  }
}

console.log("route-insight: " + asserts + " assertions passed");