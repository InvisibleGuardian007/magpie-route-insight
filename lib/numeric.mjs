import fs from "node:fs";
import { configFile } from "./store.mjs";
import { ask } from "./gateway.mjs";
import { loadDetector, generateChallenges } from "./lmfpd/index.js";

// 数值指纹：lm-detector（MIT，https://github.com/Ikaleio/lm-detector）那套做法——
// 让它「随机数 300 个 1..355 的整数」，真人模型生成的数字串有自己的统计纹理，
// 参考库里几百个型号各采过一遍，就能算出「这条回答更像谁」。
// 和自述的区别：它不看模型怎么自称，也改不了，只能靠真的换了模型才变。

const DATA_FILE = "lmfpd-data.bin";
// 采样方式：参考库那套 SDK 一次只吃 1–3 个样本（count 上限 3，strict 又要求 3/3 都成功），
// 所以「多采几个样本」只能拆回合：每回合 3 个「数数」挑战，跑两回合再按型号把概率平均。
// 3 个样本只够「有排名」，前两名经常咬在一起（实测 80.5% vs 19.0% 就是 3 个样本的样子）；
// 两回合平均后方差收窄，同样的钱换来更硬的结论。
export const ROUND = 3;
export const ROUNDS = 2;
export const SAMPLES = ROUND * ROUNDS;

let detectorPromise = null;

// 参考库约 3.6 MB，第一次要下载（走 https://lm.ikale.io/data/，镜像 cdn.jsdmirror.com），
// 之后落在 ~/.config/magpie/lmfpd-data.bin，加载是即时的。
export function loadFingerprinter() {
  if (!detectorPromise) {
    detectorPromise = loadDetector({ cache: configFile(DATA_FILE) }).catch(function (error) {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

// 状态查询：界面要显示「参考库是哪天的」。
export async function fingerprinterStatus() {
  try {
    const detector = await loadFingerprinter();
    return { ready: true, builtAt: detector.builtAt, dataBytes: sizeOf(configFile(DATA_FILE)) };
  } catch (error) {
    return { ready: false, error: String((error && error.message) || error) };
  }
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch (error) {
    return 0;
  }
}

// 第一名与第二名的概率差：差得越开，这个结论越经得起看；咬在一起（<5%）就该提醒「别当定论」。
export function topMargin(rows) {
  const list = (rows || []).filter(function (row) {
    return typeof row.probability === "number";
  });
  if (list.length < 2) return null;
  return Math.max(0, list[0].probability - list[1].probability);
}

function label(decision) {
  if (decision === "scored") return "有排名";
  if (decision === "not_model") return "不像模型回答";
  if (decision === "unscorable") return "样本不够";
  return decision || "未知";
}

// 一个样本 = 一次「数数」挑战。空答要重试一次：网关那头常是「思考把预算吃光」，
// 所以这里不设 max_tokens（见 gateway.mjs 的说明）。
async function sample(model, challenge, opts) {
  const started = Date.now();
  let call = await ask(model, challenge.prompt, { effort: opts.effort, maxTokens: 0, timeoutMs: 240000 });
  let retried = false;
  if (!call.ok || !call.text.trim()) {
    retried = true;
    call = await ask(model, challenge.prompt, { effort: opts.effort, maxTokens: 0, timeoutMs: 240000 });
  }
  return {
    expected: challenge.expected_count,
    text: call.text,
    chars: String(call.text || "").length,
    ms: Date.now() - started,
    status: call.status,
    served: call.served,
    retried: retried,
    error: call.error
  };
}

// 两回合的概率按型号平均，再归一化：回合之间参考库是同一套，平均不会引入偏差，
// 但「哪一回合运气好」这种偶然因素会被摊平。
function mergeAnalyses(analyses) {
  const table = new Map();
  let scored = 0;
  analyses.forEach(function (analysis) {
    if (!analysis || analysis.decision !== "scored" || !Array.isArray(analysis.results)) return;
    scored += 1;
    analysis.results.forEach(function (row) {
      const key = row.model || row.display_name;
      if (!key) return;
      const cur = table.get(key) || {
        model: row.model,
        name: row.display_name || row.model,
        family: row.family || "",
        familyName: row.family_name || "",
        sum: 0,
        n: 0
      };
      cur.sum += typeof row.probability === "number" ? row.probability : 0;
      cur.n += 1;
      table.set(key, cur);
    });
  });
  if (!scored) return null;
  const rows = Array.from(table.values()).map(function (row) {
    return {
      model: row.model,
      name: row.name,
      family: row.family,
      familyName: row.familyName,
      probability: row.sum / row.n
    };
  });
  const total = rows.reduce(function (sum, row) { return sum + row.probability; }, 0);
  rows.forEach(function (row) {
    row.probability = total > 0 ? row.probability / total : 0;
  });
  rows.sort(function (a, b) { return b.probability - a.probability; });
  return { rounds: scored, rows };
}

export async function runNumeric(model, opts) {
  const o = opts || {};
  const started = Date.now();
  let detector;
  try {
    detector = await loadFingerprinter();
  } catch (error) {
    return {
      id: "numfp",
      ok: false,
      model,
      ms: Date.now() - started,
      error: "参考库没下下来：" + String((error && error.message) || error),
      samples: []
    };
  }

  const batches = [];
  for (let round = 0; round < ROUNDS; round += 1) batches.push(generateChallenges(ROUND));
  const jobs = [];
  batches.forEach(function (challenges, round) {
    challenges.forEach(function (challenge, index) {
      jobs.push({ round, index, challenge });
    });
  });
  const results = await Promise.all(
    jobs.map(function (job) {
      return sample(model, job.challenge, o);
    })
  );
  jobs.forEach(function (job, i) {
    job.sample = results[i];
  });

  const analyses = [];
  const roundOutputs = batches.map(function () { return []; });
  const roundJobIds = batches.map(function () { return []; });
  jobs.forEach(function (job, i) {
    const text = String(job.sample.text || "");
    if (text.trim()) {
      roundOutputs[job.round].push({ text, expected_count: job.challenge.expected_count });
      roundJobIds[job.round].push(i);
    }
  });
  roundOutputs.forEach(function (outputs, round) {
    if (!outputs.length) {
      analyses.push({ decision: "empty" });
      return;
    }
    let analysis;
    try {
      // strict：这一回合凑不满 3 个就别给「部分排名」，免得把噪声当结论。
      analysis = detector.analyze(outputs, { strict: outputs.length < ROUND });
    } catch (error) {
      analysis = { decision: "error", error: String((error && error.message) || error) };
    }
    analyses.push(analysis);
    // 诊断按「这一回合收下的样本顺序」给回来的，据此回填每个样本解出多少个数、有没有被采纳。
    const diagnostics = analysis.diagnostics || [];
    roundJobIds[round].forEach(function (jobId, k) {
      const diag = diagnostics[k] || {};
      jobs[jobId].parsed = diag.parsed_numbers || 0;
      jobs[jobId].accepted = !!diag.accepted;
    });
  });

  const used = roundOutputs.reduce(function (sum, outputs) { return sum + outputs.length; }, 0);
  const samplesOut = jobs
    .map(function (job) {
      return {
        round: job.round + 1,
        index: job.index + 1,
        expected: job.challenge.expected_count,
        chars: job.sample.chars,
        parsed: job.parsed || 0,
        accepted: !!job.accepted,
        ms: job.sample.ms,
        retried: job.sample.retried,
        status: job.sample.status,
        error: job.sample.error,
        verdict: ""
      };
    });

  if (!used) {
    return {
      id: "numfp",
      ok: false,
      model,
      ms: Date.now() - started,
      error: "样本全是空的，这次没得分",
      samples: samplesOut
    };
  }

  const merged = mergeAnalyses(analyses);
  const first = analyses.find(function (analysis) {
    return analysis && analysis.decision;
  }) || {};

  // 回合里的判定回填到样本行：界面用来看「这几次答得像样吗」。
  const verdictsByRound = analyses.map(function (analysis) {
    return (analysis && analysis.decision) || "";
  });
  samplesOut.forEach(function (row) {
    row.verdict = verdictsByRound[row.round - 1] || "";
  });

  if (!merged) {
    const why = first.error || (first.decision === "not_model" ? "回答不像模型在数数" : "样本不够判不了");
    return {
      id: "numfp",
      ok: false,
      model,
      ms: Date.now() - started,
      decision: first.decision || "unscorable",
      decisionLabel: label(first.decision),
      error: why,
      used,
      builtAt: detector.builtAt,
      method: first.method || "",
      samples: samplesOut
    };
  }

  const rows = merged.rows;
  const top = rows[0] || {};
  const usedRounds = merged.rounds;
  return {
    id: "numfp",
    ok: true,
    model,
    ms: Date.now() - started,
    decision: "scored",
    decisionLabel: label("scored") + (usedRounds > 1 ? "（" + usedRounds + " 回合合并）" : ""),
    prediction: top.model || "",
    predictionName: top.name || top.model || "",
    probability: typeof top.probability === "number" ? top.probability : null,
    probabilityStatus: usedRounds > 1 ? "merged" : "single",
    family: top.family || "",
    familyName: top.familyName || "",
    rankingScore: null,
    used,
    builtAt: detector.builtAt,
    method: first.method || "",
    evidence: first.evidence || null,
    margin: topMargin(rows),
    results: rows.slice(0, 8),
    samples: samplesOut,
    error: ""
  };
}
