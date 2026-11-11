import fs from "node:fs";
import { configFile } from "./store.mjs";
import { ask } from "./gateway.mjs";
import { loadDetector, generateChallenges } from "./lmfpd/index.js";

// 数值指纹：lm-detector（MIT，https://github.com/Ikaleio/lm-detector）那套做法——
// 让它「随机数 300 个 1..355 的整数」，真人模型生成的数字串有自己的统计纹理，
// 参考库里几百个型号各采过一遍，就能算出「这条回答更像谁」。
// 和自述的区别：它不看模型怎么自称，也改不了，只能靠真的换了模型才变。

const DATA_FILE = "lmfpd-data.bin";
const SAMPLES = 3;

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
  const challenges = generateChallenges(SAMPLES);
  const samples = await Promise.all(
    challenges.map(function (challenge) {
      return sample(model, challenge, o);
    })
  );
  const outputs = samples
    .filter(function (one) {
      return String(one.text || "").trim();
    })
    .map(function (one) {
      return { text: one.text, expected_count: one.expected };
    });
  if (!outputs.length) {
    return {
      id: "numfp",
      ok: false,
      model,
      ms: Date.now() - started,
      error: "三个样本都是空的，这次没得分",
      samples: samples.map(function (one, index) {
        return { index: index + 1, expected: one.expected, chars: one.chars, accepted: false, ms: one.ms, status: one.status, error: one.error };
      })
    };
  }
  let analysis;
  try {
    // strict：样本不够时直接说不确定，而不是给个「部分排名」骗自己。
    analysis = detector.analyze(outputs, { strict: outputs.length < SAMPLES });
  } catch (error) {
    return { id: "numfp", ok: false, model, ms: Date.now() - started, error: String((error && error.message) || error), samples: [] };
  }
  const diagnostics = (analysis && analysis.diagnostics) || [];
  return {
    id: "numfp",
    ok: analysis.decision === "scored",
    model,
    ms: Date.now() - started,
    decision: analysis.decision,
    decisionLabel: label(analysis.decision),
    prediction: analysis.prediction || "",
    predictionName: analysis.prediction_name || analysis.prediction || "",
    probability: typeof analysis.probability === "number" ? analysis.probability : null,
    probabilityStatus: analysis.probability_status || "",
    family: analysis.family_prediction || "",
    familyName: analysis.family_prediction_name || "",
    rankingScore: typeof analysis.ranking_score === "number" ? analysis.ranking_score : null,
    used: analysis.used_outputs || 0,
    builtAt: detector.builtAt,
    method: analysis.method || "",
    evidence: analysis.evidence || null,
    results: (analysis.results || []).slice(0, 8).map(function (row) {
      return {
        model: row.model,
        name: row.display_name || row.model,
        family: row.family || "",
        familyName: row.family_name || "",
        probability: typeof row.probability === "number" ? row.probability : null
      };
    }),
    samples: samples.map(function (one, index) {
      const diag = diagnostics[index] || {};
      return {
        index: index + 1,
        expected: one.expected,
        chars: one.chars,
        parsed: diag.parsed_numbers || 0,
        accepted: !!diag.accepted,
        ms: one.ms,
        retried: one.retried,
        status: one.status,
        error: one.error || ""
      };
    })
  };
}
