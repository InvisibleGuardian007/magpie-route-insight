(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var theme = params.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);

  var WINDOWS = [["1h", "1 小时"], ["6h", "6 小时"], ["today", "今天"], ["24h", "24 小时"], ["7d", "7 天"]];
  var MODE_NAME = { credit: "积分", balance: "余额", window: "额度" };
  // 强度显示文案：网关能记到真实 effort 时用它，记不到就按思考 token 派生
  var EFFORT_NAME = {
    none: "无",
    minimal: "极低",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "很高",
    max: "最大",
    ultra: "极高"
  };
  var TABS = [
    ["byProvider", "供应商"],
    ["byModel", "模型"],
    ["byEffort", "强度"],
    ["byAgent", "Agent"],
    ["byStop", "停止"],
    ["byReq", "分组"]
  ];
  var SELECTS = [
    ["provider", "供应商"],
    ["model", "模型"],
    ["effort", "推理强度"],
    ["agent", "Agent"]
  ];

  // 缓存用小图标（Segoe UI 里没有合适的单字符，用 SVG 保证各字体下一致）
  var ICONS = {
    bolt:
      '<svg class="ic-svg" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M7.1 1 2.5 6.7h2.6L5 11l4.6-5.8H7.1z" fill="currentColor"/></svg>',
    clock:
      '<svg class="ic-svg" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M6 3.5V6l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    cache:
      '<svg class="ic-svg" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><ellipse cx="6" cy="2.9" rx="4.1" ry="1.7" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M1.9 2.9v3.1c0 .95 1.85 1.7 4.1 1.7s4.1-.75 4.1-1.7V2.9" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M1.9 6.05v3.05c0 .95 1.85 1.7 4.1 1.7s4.1-.75 4.1-1.7V6.05" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
  };

  var st = {
    window: params.get("window") || "today",
    provider: [],
    model: [],
    effort: [],
    agent: [],
    status: "",
    q: "",
    limit: 400,
    paused: false,
    data: null,
    tab: "byProvider",
    view: ["lab", "providers"].indexOf(params.get("view")) >= 0 ? params.get("view") : "board",
    prov: { at: "", cards: null, error: "" },
    open: "",
    search: {},
    lab: { models: null, tests: { family: true, pelican: true }, result: null, running: false, error: "" }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtInt(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + "K";
    return String(Math.round(v));
  }

  function fmtCount(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }

  function fmtMs(ms) {
    var v = Number(ms) || 0;
    if (!v) return "—";
    if (v >= 10000) return (v / 1000).toFixed(1) + "s";
    if (v >= 1000) return (v / 1000).toFixed(2) + "s";
    return Math.round(v) + "ms";
  }

  function fmtCredits(v) {
    var n = Number(v) || 0;
    if (!n) return "0";
    if (n >= 1000) return (n / 1000).toFixed(2) + "K";
    if (n >= 10) return n.toFixed(1);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(3);
  }

  function fmtPct(rate, digits) {
    var n = Number(rate) || 0;
    return (n * 100).toFixed(digits === undefined ? 1 : digits) + "%";
  }

  function ttftTone(ms) {
    var v = Number(ms) || 0;
    if (!v) return "dim";
    if (v <= 5000) return "good";
    if (v <= 15000) return "warn";
    return "bad";
  }

  // 速度按 tok/s 上色：越快越绿，慢到 25 以下就是红。总时长同理。
  function speedTone(v) {
    var n = Number(v) || 0;
    if (!n) return "dim";
    if (n >= 60) return "good";
    if (n >= 25) return "warn";
    return "bad";
  }

  function msTone(ms) {
    var v = Number(ms) || 0;
    if (!v) return "dim";
    if (v <= 8000) return "good";
    if (v <= 22000) return "warn";
    return "bad";
  }

  function hitTone(rate) {
    var v = Number(rate) || 0;
    if (v >= 0.8) return "good";
    if (v >= 0.5) return "warn";
    return "bad";
  }

  function hueFor(text) {
    var hash = 0;
    var s = String(text || "");
    for (var i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) % 100000;
    return hash % 360;
  }

  function nameOf(id) {
    var names = (st.data && st.data.names) || {};
    return names[id] || id;
  }

  function bar(ratio, tone) {
    var v = Math.max(0, Math.min(1, Number(ratio) || 0));
    return '<span class="bar" data-v="' + v.toFixed(3) + '" data-tone="' + tone + '"><i></i></span>';
  }

  function paintDynamic(root) {
    var nodes = root.querySelectorAll("[data-v]");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      node.style.setProperty("--v", node.getAttribute("data-v"));
      var tone = node.getAttribute("data-tone");
      var colour =
        tone === "good" ? "var(--green)" : tone === "warn" ? "var(--amber)" : tone === "bad" ? "var(--red)" : "var(--blue)";
      node.style.setProperty("--tone", colour);
    }
    var pills = root.querySelectorAll("[data-hue]");
    for (var j = 0; j < pills.length; j += 1) {
      pills[j].style.setProperty("--h", pills[j].getAttribute("data-hue"));
    }
  }

  /* ---------------- 筛选控件 ---------------- */

  function buildWindowSeg() {
    var seg = el("seg");
    seg.innerHTML = "";
    WINDOWS.forEach(function (pair) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[1];
      button.setAttribute("data-window", pair[0]);
      if (pair[0] === st.window) button.className = "on";
      button.addEventListener("click", function () {
        st.window = pair[0];
        buildWindowSeg();
        load();
      });
      seg.appendChild(button);
    });
  }

  function buildStatusSeg() {
    var seg = el("statusSeg");
    var options = [["", "全部"], ["ok", "成功"], ["fail", "失败"]];
    seg.innerHTML = "";
    options.forEach(function (pair) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[1];
      if (pair[0] === st.status) button.className = "on";
      button.addEventListener("click", function () {
        st.status = pair[0];
        buildStatusSeg();
        load();
      });
      seg.appendChild(button);
    });
  }

  function itemsFor(key) {
    var data = st.data;
    if (!data || !data.facets) return [];
    if (key === "provider") {
      return data.facets.providers.map(function (item) {
        return { value: item.key, label: nameOf(item.key), sub: item.key, n: item.n };
      });
    }
    if (key === "model") {
      var merged = {};
      data.facets.models.forEach(function (item) {
        var parts = String(item.key).split("/");
        var model = parts.slice(1).join("/") || item.key;
        var slot = merged[model] || (merged[model] = { value: model, label: model, sub: parts[0], n: 0 });
        slot.n += item.n;
      });
      return Object.keys(merged)
        .map(function (k) {
          return merged[k];
        })
        .sort(function (a, b) {
          return b.n - a.n;
        });
    }
    if (key === "effort") {
      return (data.facets.efforts || []).map(function (item) {
        return { value: item.key, label: item.key, n: item.n };
      });
    }
    return (data.facets.agents || []).map(function (item) {
      return { value: item.key, label: item.key, n: item.n };
    });
  }

  function selected(key) {
    return st[key] || [];
  }

  function syncButton(key) {
    var wrap = document.querySelector('.ms[data-key="' + key + '"]');
    if (!wrap) return;
    var list = selected(key);
    var button = wrap.querySelector(".ms-btn");
    var label = button.querySelector(".ms-label");
    var count = button.querySelector(".ms-count");
    var base = SELECTS.filter(function (pair) {
      return pair[0] === key;
    })[0][1];
    if (!list.length) {
      label.textContent = base;
      count.hidden = true;
      wrap.classList.remove("active");
      return;
    }
    wrap.classList.add("active");
    if (list.length === 1) {
      label.textContent = key === "provider" ? nameOf(list[0]) : list[0];
      count.hidden = true;
      return;
    }
    label.textContent = base;
    count.hidden = false;
    count.textContent = String(list.length);
  }

  function fillList(key) {
    var wrap = document.querySelector('.ms[data-key="' + key + '"]');
    if (!wrap) return;
    var needle = String(st.search[key] || "").toLowerCase();
    var items = itemsFor(key).filter(function (item) {
      if (!needle) return true;
      return (item.label + " " + (item.sub || "")).toLowerCase().indexOf(needle) >= 0;
    });
    var list = wrap.querySelector(".ms-list");
    if (!items.length) {
      list.innerHTML = '<div class="empty">没有匹配项</div>';
    } else {
      var chosen = selected(key);
      list.innerHTML = items
        .map(function (item) {
          var on = chosen.indexOf(item.value) >= 0 ? " on" : "";
          return (
            '<button type="button" class="ms-item' +
            on +
            '" data-value="' +
            esc(item.value) +
            '"><span class="tick"></span><span class="txt">' +
            esc(item.label) +
            (item.sub && item.sub !== item.label ? ' <span class="dim">' + esc(item.sub) + "</span>" : "") +
            '</span><span class="cnt">' +
            fmtCount(item.n) +
            "</span></button>"
          );
        })
        .join("");
    }
    syncButton(key);
  }

  function createSelect(key, label) {
    var wrap = document.createElement("div");
    wrap.className = "ms";
    wrap.setAttribute("data-key", key);
    wrap.innerHTML =
      '<button type="button" class="ms-btn"><span class="ms-label">' +
      label +
      '</span><span class="ms-count" hidden></span><i class="ms-caret"></i></button>' +
      '<div class="ms-panel" hidden><input class="ms-q" type="search" placeholder="搜索…" />' +
      '<div class="ms-tools"><button type="button" data-act="all">全选</button>' +
      '<button type="button" data-act="none">清空</button></div><div class="ms-list"></div></div>';
    var button = wrap.querySelector(".ms-btn");
    var panel = wrap.querySelector(".ms-panel");
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var opening = panel.hidden;
      closePanels();
      panel.hidden = !opening;
      if (opening) {
        fillList(key);
        wrap.querySelector(".ms-q").focus();
      }
    });
    wrap.querySelector(".ms-q").addEventListener("input", function (event) {
      st.search[key] = event.target.value;
      fillList(key);
    });
    panel.addEventListener("click", function (event) {
      event.stopPropagation();
      var act = event.target.getAttribute ? event.target.getAttribute("data-act") : null;
      if (act) {
        var values = itemsFor(key).map(function (item) {
          return item.value;
        });
        st[key] = act === "all" ? values : [];
        fillList(key);
        load();
        return;
      }
      var row = event.target.closest ? event.target.closest(".ms-item") : null;
      if (!row) return;
      var value = row.getAttribute("data-value");
      var list = selected(key).slice();
      var at = list.indexOf(value);
      if (at >= 0) list.splice(at, 1);
      else list.push(value);
      st[key] = list;
      fillList(key);
      load();
    });
    return wrap;
  }

  function closePanels() {
    var panels = document.querySelectorAll(".ms-panel");
    for (var i = 0; i < panels.length; i += 1) panels[i].hidden = true;
  }

  function buildSelects() {
    var host = el("filters");
    var search = el("q");
    SELECTS.forEach(function (pair) {
      host.insertBefore(createSelect(pair[0], pair[1]), search);
    });
  }

  /* ---------------- 渲染 ---------------- */

  function kpi(cls, key, value, detail, rawKey) {
    return (
      '<div class="kpi ' +
      cls +
      '"><div class="k">' +
      (rawKey ? key : esc(key)) +
      '</div><div class="v">' +
      value +
      '</div><div class="d">' +
      detail +
      "</div></div>"
    );
  }

  function renderKpis(data) {
    var k = data.kpi;
    var modes = k.modes || { credit: { rows: 0, credits: 0 }, balance: { rows: 0, credits: 0 }, window: { rows: 0, credits: 0 } };
    var cards = [
      kpi("info", "⇄ 请求 / 尝试", fmtCount(k.requests), fmtCount(k.attempts) + " 次 · 重试 " + fmtCount(k.retried)),
      kpi(
        k.failRate > 0.1 ? "bad" : k.failRate > 0.03 ? "warn" : "good",
        "✓ 成功率",
        fmtPct(1 - k.failRate),
        "失败 " + fmtCount(k.fail)
      ),
      kpi(ttftTone(k.ttftP50), "⚡ 首字 P50", fmtMs(k.ttftP50), "均 " + fmtMs(k.ttftAvg) + " · 慢 " + fmtMs(k.ttftMax)),
      kpi(ttftTone(k.ttftP90), "⚡ 首字 P90", fmtMs(k.ttftP90), "思考 " + fmtMs(k.thinkP50)),
      kpi("info", "⏱ 总时长 P90", fmtMs(k.msP90), "均 " + fmtMs(k.msAvg)),
      kpi(
        hitTone(k.hitRate),
        ICONS.cache + " 缓存命中",
        fmtPct(k.hitRate, 0),
        "读 " + fmtInt(k.cacheRead) + " · 写 " + fmtInt(k.cacheWrite),
        true
      ),
      kpi("", "⇅ 入 → 出", fmtInt(k.inp) + " → " + fmtInt(k.out), fmtInt(k.speed) + " tok/s · 推理 " + fmtInt(k.reasoning)),
      kpi(
        "info",
        "◎ 积分合计",
        fmtCredits(modes.credit.credits),
        "余额 " + fmtCount(modes.balance.rows) + " 次 · 额度 " + fmtCount(modes.window.rows) + " 次"
      )
    ];
    el("kpis").innerHTML = cards.join("");
  }

  function sparkline(values, opts) {
    var width = 240;
    var height = 54;
    var pad = 2;
    var max = Math.max.apply(null, values.concat([1]));
    var step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : width;
    var points = values.map(function (value, index) {
      var x = pad + index * step;
      var y = height - pad - (Math.max(0, value) / max) * (height - pad * 2);
      return [x, y];
    });
    if (opts && opts.bars) {
      var barWidth = Math.max(1.5, step - 1.4);
      var rects = points
        .map(function (point) {
          var h = height - pad - point[1];
          return (
            '<rect x="' +
            point[0].toFixed(1) +
            '" y="' +
            point[1].toFixed(1) +
            '" width="' +
            barWidth.toFixed(1) +
            '" height="' +
            Math.max(1, h).toFixed(1) +
            '" rx="1.5" fill="' +
            (opts.colour || "var(--blue)") +
            '" opacity="0.75" />'
          );
        })
        .join("");
      return '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none">' + rects + "</svg>";
    }
    var path = points
      .map(function (point, index) {
        return (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1);
      })
      .join(" ");
    return (
      '<svg viewBox="0 0 ' +
      width +
      " " +
      height +
      '" preserveAspectRatio="none"><path d="' +
      path +
      '" fill="none" stroke="' +
      (opts && opts.colour ? opts.colour : "var(--cyan)") +
      '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg>'
    );
  }

  function renderCharts(data) {
    var points = data.series || [];
    var n = points.map(function (p) {
      return p.n;
    });
    var fails = points.map(function (p) {
      return p.fail;
    });
    var ttft = points.map(function (p) {
      return p.ttft;
    });
    var cache = points.map(function (p) {
      return p.cacheRead;
    });
    var out = points.map(function (p) {
      return p.out;
    });
    var sum = function (list) {
      return list.reduce(function (a, b) {
        return a + b;
      }, 0);
    };
    var cards = [
      ['⇄ 请求 <b>' + fmtCount(sum(n)) + "</b>", sparkline(n, { bars: true, colour: "var(--blue)" })],
      [
        '⚠ 失败 <b class="bad">' + fmtCount(sum(fails)) + "</b>",
        sparkline(fails, { bars: true, colour: "var(--red)" })
      ],
      ['⚡ 首字均值 <b>' + fmtMs(sum(ttft) / (ttft.length || 1)) + "</b>", sparkline(ttft, { colour: "var(--amber)" })],
      ['▤ 缓存读取 <b>' + fmtInt(sum(cache)) + "</b>", sparkline(cache, { bars: true, colour: "var(--green)" })],
      ['⇢ 输出 tokens <b>' + fmtInt(sum(out)) + "</b>", sparkline(out, { bars: true, colour: "var(--purple)" })]
    ];
    el("charts").innerHTML = cards
      .map(function (pair) {
        return '<div class="chart"><div class="ct">' + pair[0] + "</div>" + pair[1] + "</div>";
      })
      .join("");
  }

  // 一格两行：↓入 ↑出 / 缓存读 (命中率)
  function tokenCell(row) {
    var tone = hitTone(row.hitRate);
    var hit = row.hitRate ? fmtPct(row.hitRate, 1) : "—";
    return (
      '<td class="num tk-cell">' +
      '<span class="tk"><i class="ic in">↓</i>' +
      fmtInt(row.inp) +
      '<i class="ic out">↑</i>' +
      fmtInt(row.out) +
      "</span>" +
      '<span class="tk sub"><i class="ic">' +
      ICONS.cache +
      "</i>" +
      fmtInt(row.cacheRead) +
      '<em class="' +
      tone +
      '">(' +
      hit +
      ")</em></span></td>"
    );
  }

  // 强度格：优先真实 effort；deepseek 这类链路 magpie 不写 effort，只留下思考 token 数，
  // 于是按「本次筛选内的思考量分位」派生一个相对强度（低/中/高/极高），数字原样附在后面。
  // 派生值一律用虚线边框 + title 说明来源，绝不冒充官方 effort。
  function effortCell(row, tier) {
    var eff = String(row.effort || "").toLowerCase();
    if (eff) {
      return (
        '<span class="pill effort-' +
        esc(eff) +
        '" title="网关记录的推理强度：' +
        esc(eff) +
        '">' +
        esc(EFFORT_NAME[eff] || eff) +
        "</span>"
      );
    }
    var think = Number(row.reasoning) || 0;
    if (think > 0 && tier) {
      return (
        '<span class="pill eff-derived on t-' +
        esc(tier.cls) +
        '" title="网关没记 effort，这里按思考 token 的排名派生：' +
        fmtCount(think) +
        " tokens（本窗口 P50 " +
        fmtCount(tier.band.p50) +
        " / P75 " +
        fmtCount(tier.band.p75) +
        " / P90 " +
        fmtCount(tier.band.p90) +
        '）→ 低 &lt; 中 &lt; 高 &lt; 极高，是相对值不是官方档位">' +
        esc(tier.name) +
        "<b>" +
        fmtInt(think) +
        "</b></span>"
      );
    }
    if (think > 0) {
      return '<span class="pill eff-derived on">思考<b>' + fmtInt(think) + "</b></span>";
    }
    return (
      '<span class="pill eff-derived" title="网关没记 effort，本次请求也没有思考 token">无思考</span>'
    );
  }

  // 思考量分位：拿当前这批行自己比，比一个固定的死阈值更能反映「这次算多还是少」。
  function thinkTiers(rows) {
    var values = rows
      .map(function (row) {
        return Number(row.reasoning) || 0;
      })
      .filter(function (value) {
        return value > 0;
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (!values.length) return null;
    function at(p) {
      var i = Math.round(p * (values.length - 1));
      return values[Math.min(values.length - 1, Math.max(0, i))];
    }
    var band = { p50: at(0.5), p75: at(0.75), p90: at(0.9) };
    return function tier(think) {
      var name = "低";
      var cls = "low";
      if (values.length > 3) {
        if (think > band.p90) {
          name = "极高";
          cls = "max";
        } else if (think > band.p75) {
          name = "高";
          cls = "high";
        } else if (think > band.p50) {
          name = "中";
          cls = "mid";
        }
      }
      return { name: name, cls: cls, band: band };
    };
  }

  function renderRows(data) {
    var rows = data.rows || [];
    var tierOf = thinkTiers(rows);
    if (!rows.length) {
      el("rows").innerHTML = '<tr><td colspan="11"><div class="empty">这个筛选组合下没有请求</div></td></tr>';
    } else {
      el("rows").innerHTML = rows
        .map(function (row) {
          var ttft = row.ttft ? fmtMs(row.ttft) : "—";
          var tone = ttftTone(row.ttft);
          var mode = row.mode || "credit";
          var money =
            mode === "window"
              ? '<span class="dim">额度</span>'
              : fmtCredits(row.credits) + '<span class="tag ' + mode + '">' + MODE_NAME[mode] + "</span>";
          var when = String(row.t || "").replace("T", " ").slice(5, 19);
          return (
            "<tr>" +
            '<td class="time">' +
            esc(when) +
            "</td>" +
            '<td><span class="pill" data-hue="' +
            hueFor(row.provider) +
            '" title="' +
            esc(row.provider) +
            '">' +
            esc(nameOf(row.provider)) +
            "</span></td>" +
            '<td class="model" title="' +
            esc(row.asked ? "请求 " + row.asked + " → 实际 " + row.model : row.model) +
            '">' +
            esc(row.model) +
            "</td>" +
            '<td>' +
            effortCell(row, tierOf ? tierOf(Number(row.reasoning) || 0) : null) +
            "</td>" +
            '<td class="agent">' +
            esc(row.agent || "—") +
            "</td>" +
            '<td><span class="status' +
            (row.status === 200 ? "" : " fail") +
            '"><span class="dot ' +
            (row.status === 200 ? "ok" : "fail") +
            '"></span>' +
            esc(row.status) +
            "</span></td>" +
            '<td class="num ' +
            tone +
            '">' +
            ttft +
            "</td>" +
            tokenCell(row) +
            '<td class="num ' +
            speedTone(row.speed) +
            '" title="输出速度 ' +
            (row.speed ? fmtInt(row.speed) + " tok/s" : "无") +
            '（≥60 绿 / 25–60 黄 / <25 红）">' +
            (row.speed ? ICONS.bolt + fmtInt(row.speed) : '<span class="dim">—</span>') +
            "</td>" +
            '<td class="num ' +
            msTone(row.ms) +
            '" title="总耗时（≤8s 绿 / 8–22s 黄 / >22s 红）">' +
            (row.ms ? ICONS.clock + fmtMs(row.ms) : '<span class="dim">—</span>') +
            "</td>" +
            '<td class="num">' +
            money +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }
    el("rowinfo").textContent =
      "显示最近 " + fmtCount(rows.length) + " 条 / 匹配 " + fmtCount(data.kpi.attempts) + " 次尝试";
    paintDynamic(el("rows"));
  }

  function renderTabs() {
    el("tabs").innerHTML = TABS.map(function (pair) {
      return (
        '<button type="button" data-tab="' +
        pair[0] +
        '" class="' +
        (pair[0] === st.tab ? "on" : "") +
        '">' +
        esc(pair[1]) +
        "</button>"
      );
    }).join("");
  }

  function renderGroups(data) {
    renderTabs();
    var rows = data[st.tab] || [];
    if (!rows.length) {
      el("groups").innerHTML = '<tr><td colspan="7"><div class="empty">没有数据</div></td></tr>';
      return;
    }
    el("groups").innerHTML = rows
      .map(function (row) {
        var isProvider = st.tab === "byProvider";
        var label = isProvider ? nameOf(row.key) : row.key;
        var mode = row.mode || "credit";
        return (
          "<tr>" +
          '<td class="gname" title="' + esc(label) + '">' +
          (isProvider
            ? '<span class="pill" data-hue="' + hueFor(row.key) + '">' + esc(label) + "</span>"
            : '<span class="ell">' + esc(label) + "</span>") +
          "</td>" +
          '<td class="num">' +
          fmtCount(row.n) +
          "</td>" +
          '<td class="num ' +
          (row.fail ? "bad" : "dim") +
          '">' +
          (row.fail ? fmtCount(row.fail) : "0") +
          "</td>" +
          '<td class="num ' +
          ttftTone(row.ttftP50) +
          '">' +
          fmtMs(row.ttftP50) +
          "</td>" +
          '<td class="num ' +
          hitTone(row.hitRate) +
          '">' +
          fmtPct(row.hitRate, 0) +
          "</td>" +
          '<td class="num">' +
          (row.speed ? fmtInt(row.speed) : "—") +
          "</td>" +
          '<td class="num">' +
          (mode === "window" ? '<span class="tag window">额度</span>' : fmtCredits(row.credits)) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    paintDynamic(el("groups"));
  }

  function renderBilling(data) {
    var billing = data.billing || { providers: {}, order: [] };
    var spend = {};
    (data.byProvider || []).forEach(function (row) {
      spend[row.key] = row;
    });
    var groups = { balance: [], window: [], credit: [] };
    (billing.order || []).forEach(function (id) {
      var item = billing.providers[id];
      if (!item) return;
      groups[item.mode] = groups[item.mode] || [];
      groups[item.mode].push({ item: item, spend: spend[id] });
    });
    (data.byProvider || []).forEach(function (row) {
      if (billing.providers[row.key]) return;
      groups.credit.push({ item: { id: row.key, name: nameOf(row.key), mode: "credit", balanceText: "", windows: [] }, spend: row });
    });

    var columns = [];
    columns.push({
      title: "余额（$）",
      hint: "供应商按余额扣费，余额来自它们自己的接口",
      rows: groups.balance || []
    });
    columns.push({ title: "额度（窗口）", hint: "订阅额度，按窗口剩余", rows: groups.window || [] });
    columns.push({ title: "积分（credits）", hint: "没有余额或额度的供应商，按网关积分算", rows: groups.credit || [] });

    el("billing").innerHTML = columns
      .map(function (column) {
        var body;
        if (!column.rows.length) {
          body = '<div class="empty">近窗口没有这类请求</div>';
        } else {
          body = column.rows
            .map(function (entry) {
              var item = entry.item;
              var row = entry.spend;
              var right = "";
              if (item.mode === "balance") {
                var value = item.balance;
                var cls = value === null || value === undefined ? "dim" : value <= 0 ? "bad" : value < 1 ? "warn" : "good";
                right = '<span class="bv ' + cls + '">' + esc(item.balanceText || "—") + "</span>";
              } else if (item.mode === "window") {
                right = '<span class="bv dim">' + fmtCount(row ? row.n : 0) + " 次</span>";
              } else {
                right = '<span class="bv cyan">' + fmtCredits(row ? row.credits : 0) + "</span>";
              }
              var sub = [];
              if (row) {
                sub.push(fmtCount(row.n) + " 次");
                sub.push("首字 " + fmtMs(row.ttftP50));
                sub.push("失败 " + fmtCount(row.fail));
              } else {
                sub.push("近窗口无请求");
              }
              if (item.keys > 1) sub.push(item.keys + " 把 key");
              if (item.ageSec !== null && item.ageSec !== undefined) sub.push(fmtMs(item.ageSec * 1000) + " 前读取");
              var windows = "";
              (item.windows || []).forEach(function (window) {
                var used = Math.max(0, Math.min(1, window.used > 1 ? window.used / 100 : window.used));
                windows +=
                  '<div class="win"><div class="wl"><span>' +
                  esc(window.name) +
                  "</span><span>" +
                  fmtPct(used, 0) +
                  "</span></div>" +
                  bar(used, used >= 0.9 ? "bad" : used >= 0.7 ? "warn" : "good") +
                  "</div>";
              });
              return (
                '<div class="bill-row"><span class="bn" title="' +
                esc(item.id || item.name) +
                '">' +
                esc(item.name) +
                "</span>" +
                right +
                '<span class="bs">' +
                esc(sub.join(" · ")) +
                "</span>" +
                windows +
                "</div>"
              );
            })
            .join("");
        }
        return (
          '<div class="bill-col"><h3>' +
          esc(column.title) +
          "</h3>" +
          '<div class="hint">' +
          esc(column.hint) +
          "</div>" +
          body +
          "</div>"
        );
      })
      .join("");
    el("billingat").textContent = billing.at ? "快照 " + String(billing.at).slice(11, 19) : "";
    paintDynamic(el("billing"));
  }

  function renderMeta(data) {
    var src = data.source || {};
    var routing = src.routing || {};
    el("src").innerHTML =
      "<b>" +
      fmtCount(src.rows) +
      "</b> 行日志 · 读于 " +
      esc(String(src.scannedAt || "").slice(11, 19) || "—") +
      (routing.file ? " · 路由 " + esc(routing.file) : "");
    el("updated").textContent = "更新于 " + String(data.at || "").slice(11, 19);
    SELECTS.forEach(function (pair) {
      fillList(pair[0]);
    });
  }

  function render(data) {
    st.data = data;
    renderKpis(data);
    renderCharts(data);
    renderRows(data);
    renderGroups(data);
    renderBilling(data);
    renderMeta(data);
  }

  /* ---------------- 取数 ---------------- */

  var busy = false;

  function query() {
    var search = new URLSearchParams();
    search.set("window", st.window);
    search.set("limit", String(st.limit));
    if (st.provider.length) search.set("provider", st.provider.join(","));
    if (st.model.length) search.set("model", st.model.join(","));
    if (st.effort.length) search.set("effort", st.effort.join(","));
    if (st.agent.length) search.set("agent", st.agent.join(","));
    if (st.status) search.set("status", st.status);
    if (st.q) search.set("q", st.q);
    return search.toString();
  }

  function load() {
    if (busy) return;
    busy = true;
    fetch("/api/state?" + query(), { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        busy = false;
        if (!data || !data.ok) {
          el("src").textContent = "读取失败：" + ((data && data.error) || "未知错误");
          return;
        }
        render(data);
      })
      .catch(function (error) {
        busy = false;
        el("src").textContent = "服务没有响应：" + String((error && error.message) || error);
      });
  }

  /* ---------------- 交互 ---------------- */

  function watch() {
    el("pause").addEventListener("click", function () {
      st.paused = !st.paused;
      el("pause").textContent = st.paused ? "继续" : "暂停";
      el("pause").className = st.paused ? "ghost on" : "ghost";
    });
    el("refresh").addEventListener("click", function () {
      load();
    });
    el("clear").addEventListener("click", function () {
      st.provider = [];
      st.model = [];
      st.effort = [];
      st.agent = [];
      st.status = "";
      st.q = "";
      el("q").value = "";
      buildStatusSeg();
      SELECTS.forEach(function (pair) {
        fillList(pair[0]);
      });
      load();
    });
    var typing = 0;
    el("q").addEventListener("input", function (event) {
      st.q = event.target.value;
      clearTimeout(typing);
      typing = setTimeout(load, 260);
    });
    el("tabs").addEventListener("click", function (event) {
      var tab = event.target.getAttribute ? event.target.getAttribute("data-tab") : null;
      if (!tab) return;
      st.tab = tab;
      if (st.data) renderGroups(st.data);
    });
    document.addEventListener("click", function (event) {
      var target = event.target;
      var foldBtn = target && target.closest ? target.closest("[data-fold]") : null;
      if (foldBtn) {
        toggleFold(foldBtn.getAttribute("data-fold"));
        return;
      }
      // 整条标题栏都能点：省得去瞄一个小三角
      var head = target && target.closest ? target.closest(".card-head") : null;
      if (head) {
        var card = head.parentNode;
        var inTabs = target.closest ? target.closest(".tabs") : null;
        if (!inTabs && card && card.getAttribute && card.getAttribute("data-foldable") === "1") {
          toggleFold(card.id);
          return;
        }
      }
      var box = target && target.getAttribute ? target.getAttribute("data-test-box") : null;
      if (box) {
        st.lab.tests[box] = !!target.checked;
        renderLabChecks();
        return;
      }
      closePanels();
    });
    el("foldTop").addEventListener("click", function () {
      toggleFold("__top");
    });
    el("labRun").addEventListener("click", function () {
      runLab();
    });
    setInterval(function () {
      if (!st.paused) load();
    }, 2000);
    setInterval(function () {
      if (!st.paused && st.view === "providers") loadProviders();
    }, 8000);
  }

  /* ---------------- 折叠 ---------------- */

  var FOLD_KEY = "route-insight-fold";

  function readFold() {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function writeFold(map) {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(map));
    } catch (error) {
      // 存不了就只影响本次记忆。
    }
  }

  function applyFold() {
    var map = readFold();
    ["cardRequests", "cardGroups", "cardBilling", "providersView", "labHistBox"].forEach(function (id) {
      var node = el(id);
      if (!node) return;
      var on = !!map[id];
      if (on) node.classList.add("collapsed");
      else node.classList.remove("collapsed");
      var button = node.querySelector(".fold");
      if (button) {
        var chev = button.querySelector(".chev");
        var label = button.querySelector(".flabel");
        if (chev) chev.textContent = on ? "▸" : "▾";
        if (label) label.textContent = on ? "展开" : "收起";
        button.setAttribute("aria-expanded", on ? "false" : "true");
        button.title = on ? "点击展开这张卡片" : "点击收起这张卡片";
      }
    });
    var page = el("page");
    var top = !!map.__top;
    if (page) {
      if (top) page.classList.add("hide-top");
      else page.classList.remove("hide-top");
    }
    var topBtn = el("foldTop");
    if (topBtn) topBtn.textContent = top ? "展开指标" : "收起指标";
  }

  function toggleFold(id) {
    var map = readFold();
    map[id] = !map[id];
    writeFold(map);
    applyFold();
  }

  /* ---------------- 供应商状态（照 magpie 渠道卡片） ---------------- */

  function provState(card) {
    if (card.off) return { cls: "bad", text: "已停用" };
    if (!card.n) return { cls: "", text: "没流量" };
    var rate = Number(card.availability);
    if (!isFinite(rate)) return { cls: "", text: "没流量" };
    if (rate < 0.85) return { cls: "bad", text: "错误" };
    if (rate < 0.98 || (card.idleMs !== null && card.idleMs > 6 * 3600000)) return { cls: "warn", text: "告警" };
    return { cls: "ok", text: "正常" };
  }

  function ago(ms) {
    var v = Number(ms) || 0;
    if (!v) return "—";
    if (v < 60000) return "刚刚";
    if (v < 3600000) return Math.round(v / 60000) + " 分钟前";
    if (v < 86400000) return Math.round(v / 3600000) + " 小时前";
    return Math.round(v / 86400000) + " 天前";
  }

  function provCard(card) {
    var state = provState(card);
    var rate = Number(card.availability);
    var rateTone = !isFinite(rate) ? "dim" : rate >= 0.98 ? "good" : rate >= 0.85 ? "warn" : "bad";
    var bars = (card.last60 || [])
      .map(function (item) {
        var cls = item.status === 200 ? (item.ttft > 20000 ? "warn" : "ok") : "bad";
        return '<i class="' + cls + '" title="' + esc((item.model || "") + " · " + item.status + " · " + fmtMs(item.ttft)) + '"></i>';
      })
      .join("");
    var icon = card.icon
      ? '<img src="' + esc(card.icon) + '" alt="" loading="lazy" onerror="this.style.display=&quot;none&quot;" />'
      : '<span class="noic">' + esc(String(card.name || "?").slice(0, 1)) + "</span>";
    var models = (card.models || []).length ? card.models.join(" / ") : "（近 7 天没跑过）";
    return (
      '<article class="prov">' +
      '<div class="prov-top"><span class="prov-ic">' + icon + "</span>" +
      '<span class="prov-name"><b>' + esc(card.name || card.id) + "</b><em>" +
      esc((card.endpoint || "本地/未填地址") + (card.off ? " · 已停用" : "")) + "</em></span>" +
      '<span class="prov-st ' + state.cls + '">' + esc(state.text) + "</span></div>" +
      '<div class="prov-boxes">' +
      '<div class="prov-box"><div class="k">' + ICONS.bolt + "首字 P50</div><div class=\"v\">" +
      (card.ttftP50 ? fmtMs(card.ttftP50) : "—") + "</div></div>" +
      '<div class="prov-box"><div class="k">' + ICONS.clock + "上次成功</div><div class=\"v\">" +
      (card.idleMs === null || card.idleMs === undefined ? "—" : ago(card.idleMs)) + "</div></div>" +
      "</div>" +
      '<div class="prov-avail"><span class="k">可用性 · 7 天</span><span class="v ' + rateTone + '">' +
      (isFinite(rate) ? (rate * 100).toFixed(2) + "%" : "—") +
      '</span><span class="sub">近 ' + fmtCount(card.n) + " 次 · 失败 " + fmtCount(card.fail) + "</span></div>" +
      '<div class="prov-strip">' + bars + "</div>" +
      '<div class="prov-strip-foot"><span>PAST</span><span>NOW</span></div>' +
      '<div class="prov-foot"><span>均速 <b>' + (card.speed ? fmtInt(card.speed) + " tok/s" : "—") + "</b></span>" +
      '<span class="sep">·</span><span>积分 <b>' + fmtCredits(card.credits) + "</b></span>" +
      '<span class="sep">·</span><span>主要模型 <b>' + esc(models) + "</b></span></div>" +
      "</article>"
    );
  }

  function renderProviders(payload) {
    var grid = el("provCards");
    if (!grid) return;
    var cards = (payload && payload.providers) || [];
    if (payload && payload.error) {
      grid.innerHTML = '<div class="empty">读取供应商失败：' + esc(payload.error) + "</div>";
      return;
    }
    if (!cards.filter(function (c) { return c.n; }).length) {
      grid.innerHTML = '<div class="empty">近 7 天没有任何请求，先发几条消息再看</div>';
      return;
    }
    grid.innerHTML = cards.map(provCard).join("");
    var at = el("provAt");
    if (at) at.textContent = payload && payload.at ? "更新于 " + String(payload.at).replace("T", " ").slice(5, 19) : "";
    var meta = el("provMeta");
    if (meta) {
      var live = cards.filter(function (c) { return c.n; }).length;
      meta.textContent = "近 7 天 · " + live + " 家在用 / 共 " + cards.length + " 家";
    }
    paintDynamic(grid);
  }

  function loadProviders() {
    return fetch("/api/providers", { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        st.prov.cards = data;
        renderProviders(data);
      })
      .catch(function (error) {
        renderProviders({ error: String((error && error.message) || error) });
      });
  }

  /* ---------------- 智商检测（指纹家族 + 鹈鹕） ---------------- */

  var LAB_TESTS = [
    ["family", "指纹家族", "自述 / 系统提示泄漏 / 知识截止"],
    ["pelican", "一键画鹈鹕", "骑自行车的鹈鹕 SVG"]
  ];

  function buildViewSeg() {
    var seg = el("viewSeg");
    var views = [["board", "看板"], ["providers", "供应商"], ["lab", "指纹"]];
    seg.innerHTML = "";
    views.forEach(function (pair) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[1];
      if (pair[0] === st.view) button.className = "on";
      button.addEventListener("click", function () {
        st.view = pair[0];
        if (pair[0] === "lab" && !st.lab.models) loadLabModels();
        if (pair[0] === "lab") {
          loadLabHistory();
          if (!st.lab.last) loadLabResult();
        }
        if (pair[0] === "providers") loadProviders();
        buildViewSeg();
        showView();
      });
      seg.appendChild(button);
    });
  }

  function showView() {
    var page = el("page");
    page.classList.toggle("lab-mode", st.view === "lab");
    page.classList.toggle("prov-mode", st.view === "providers");
    el("labView").hidden = st.view !== "lab";
    el("providersView").hidden = st.view !== "providers";
  }

  function renderLabChecks() {
    el("labTests").innerHTML = LAB_TESTS.map(function (item) {
      var on = st.lab.tests[item[0]];
      return (
        '<label class="lab-check' +
        (on ? " on" : "") +
        '" data-test="' +
        item[0] +
        '"><input type="checkbox" data-test-box="' +
        item[0] +
        '"' +
        (on ? " checked" : "") +
        ' /><span class="box"></span><span class="txt"><b>' +
        esc(item[1]) +
        "</b><em>" +
        esc(item[2]) +
        "</em></span></label>"
      );
    }).join("");
    var count = LAB_TESTS.filter(function (item) {
      return st.lab.tests[item[0]];
    }).length;
    // 指纹家族固定 2 次（自述 + 泄漏探针）；鹈鹕 1 次，没画出来会自动重试，最多 2 次。
    var low = st.lab.tests.family ? 2 : 0;
    var high = low + (st.lab.tests.pelican ? 2 : 0);
    var cost = low === high ? low + " 次" : low + "–" + high + " 次";
    // 不是每次检测都扣积分：走额度窗口的线路 credits 一直是 0，具体看结果卡里的计费说明。
    el("labCost").textContent = count ? "预计 " + cost + "请求 · 是否扣积分看结果卡" : "至少选一项";
    el("labRun").disabled = !count || st.lab.running;
  }

  function loadLabModels() {
    el("labModel").innerHTML = '<option value="">读取模型…</option>';
    return fetch("/api/lab/models", { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        var models = (data && data.models) || [];
        st.lab.models = models;
        if (!models.length) {
          el("labModel").innerHTML = '<option value="">没有可用模型</option>';
          return;
        }
        // 同一个模型可能挂在好几家线路下，平铺成一列根本分不清是哪个 —— 按供应商分组，
        // 选项文字只留「模型 · 家族」，供应商名由 optgroup 承担。
        var order = [];
        var buckets = {};
        models.forEach(function (item) {
          var key = item.provider || (item.kind === "group" ? "分组" : "其他");
          if (!buckets[key]) {
            buckets[key] = [];
            order.push(key);
          }
          buckets[key].push(item);
        });
        el("labModel").innerHTML = order
          .map(function (key) {
            var rows = buckets[key]
              .map(function (item) {
                var label = item.model + (item.family ? " · " + item.family : "") + (item.kind === "group" ? "（分组）" : "");
                return '<option value="' + esc(item.value) + '">' + esc(label) + "</option>";
              })
              .join("");
            return '<optgroup label="' + esc(key + " · " + buckets[key].length + " 个") + '">' + rows + "</optgroup>";
          })
          .join("");
      })
      .catch(function (error) {
        el("labModel").innerHTML = '<option value="">读取失败</option>';
        st.lab.error = String((error && error.message) || error);
      });
  }

  function signalRows(signals) {
    return (signals || [])
      .map(function (item) {
        return (
          '<div class="sig ' +
          esc(item.tone || "") +
          '"><span class="sig-name">' +
          esc(item.name) +
          '</span><span class="sig-value">' +
          esc(item.value) +
          "</span>" +
          (item.note ? '<span class="sig-note">' + esc(item.note) + "</span>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  function labSkeleton(tests, model) {
    return tests
      .map(function (id) {
        var name = id === "pelican" ? "一键画鹈鹕" : "指纹家族";
        return (
          '<div class="lab-card"><div class="lab-card-head"><h3>' +
          esc(name) +
          '</h3><span class="meta">' +
          esc(model) +
          ' · 检测中<em class="dots">…</em></span></div><div class="lab-wait"><span class="spin"></span>正在请求网关</div></div>'
        );
      })
      .join("");
  }

  function nowStamp() {
    var d = new Date();
    function p(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // 检测到底花没花积分：magpie 的计费方式有三种（积分 / 余额 / 额度窗口），
  // 走额度窗口的请求 credits 是 0，所以不能一律写「会花积分」。
  function costText(cost) {
    if (!cost || !cost.requests) return "";
    var parts = ["本次 " + cost.requests + " 次请求"];
    var modes = cost.modes || {};
    if (Number(cost.credits) > 0) parts.push("花费 " + fmtCredits(cost.credits) + " 积分");
    else if (modes.window) parts.push("计入额度窗口，不扣积分");
    else if (modes.balance) parts.push("按余额计费");
    else parts.push("这次没扣积分");
    if (cost.fail) parts.push("失败 " + cost.fail + " 次");
    return parts.join(" · ");
  }

  function costShort(cost) {
    if (!cost || !cost.requests) return "—";
    var modes = cost.modes || {};
    var tail = Number(cost.credits) > 0 ? fmtCredits(cost.credits) + " 积分" : modes.window ? "额度" : modes.balance ? "余额" : "免费";
    return cost.requests + " 次 · " + tail;
  }

  function renderLabResult(payload) {
    var box = el("labResults");
    if (!payload) {
      box.innerHTML = '<div class="empty">' + esc(st.lab.error || "还没有检测结果") + "</div>";
      return;
    }
    var results = payload.results || {};
    var family = results.family;
    var pelican = results.pelican;
    if (!family && !pelican) {
      box.innerHTML = '<div class="empty">没有结果</div>';
      return;
    }
    var served = (family && family.served) || (pelican && pelican.served) || payload.model;
    var at = nowStamp();
    var totalMs = (Number(family && family.ms) || 0) + (Number(pelican && pelican.ms) || 0);
    var famName = family && family.family ? family.family : family && family.ranking && family.ranking[0] ? family.ranking[0].name : "";

    // 鹈鹕图：白底，跟 magpie 的降智检测卡一个样子，下面是四行小字。
    var shot = "";
    if (pelican) {
      var raw = pelican.raw || "";
      var figure = pelican.svg
        ? '<div class="lab-shot">' + pelican.svg + "</div>"
        : '<div class="lab-shot empty-box">没有拿到 &lt;svg&gt;：' + esc(String(raw).slice(0, 200)) + "</div>";
      shot = figure +
        '<div class="lab-shot-meta">' +
        "<span><b>模型</b>" + esc(served) + "</span>" +
        "<span><b>时间</b>" + esc(at.slice(5)) + "</span>" +
        "<span><b>强度</b>" + esc(famName || "—") + "</span>" +
        "<span><b>耗时</b>" + fmtMs(pelican.ms) + "</span>" +
        "</div>";
    }

    var fp = "";
    if (family) {
      var ranked = (family.ranking || [])
        .slice(0, 8)
        .map(function (item, k) {
          var pct = Math.max(0, Math.min(1, Number(item.prob) || 0)) * 100;
          return (
            '<div class="rk-row' + (k === 0 ? " top" : "") + '"><span class="rk-n">' + (k + 1) + "</span>" +
            '<span class="rk-name">' + esc(item.name) + (item.route ? '<em class="rk-tag">路由</em>' : "") + "</span>" +
            '<span class="rk-p">' + pct.toFixed(1) + "%</span>" +
            '<span class="rk-bar"><i style="width:' + Math.max(1.5, pct).toFixed(2) + '%"></i></span></div>'
          );
        })
        .join("");
      var rankBlock = ranked
        ? '<div class="rk"><div class="rk-head"><span>候选排名</span><span class="rk-col">概率</span></div>' + ranked + "</div>"
        : "";
      fp = '<div class="lab-fp"><h4>指纹信息<span class="sub">' + esc(family.footnote || "") + "</span></h4>" +
        (family.verdict ? '<div class="lab-verdict">' + esc(family.verdict) + "</div>" : "") +
        rankBlock +
        '<div class="signals">' + signalRows(family.signals) + "</div>" +
        (family.error ? '<div class="lab-err">' + esc(family.error) + "</div>" : "") +
        '<details class="lab-raw"><summary>原始回答</summary><pre>' +
        esc((family.raw && (family.raw.identity || "") + "\n---\n" + (family.raw.guard || "")) || "") +
        "</pre></details></div>";
    }

    var rawPelican = pelican && !family
      ? '<div class="lab-fp"><details class="lab-raw"><summary>原始回答</summary><pre>' + esc(pelican.raw || "") + "</pre></details></div>"
      : "";

    box.innerHTML =
      '<div class="lab-card"><div class="lab-card-head"><h3>' + esc(served) + "</h3>" +
      '<span class="meta">' + esc(costText(payload.cost) || "本次检测") +
      '</span><span class="spacer"></span><span class="meta">' + (totalMs ? "合计 " + fmtMs(totalMs) : "") + "</span></div>" +
      shot + fp + rawPelican + "</div>";
    var svgs = box.querySelectorAll(".lab-shot svg");
    for (var k = 0; k < svgs.length; k += 1) {
      svgs[k].removeAttribute("width");
      svgs[k].removeAttribute("height");
    }
  }

  function renderLabHistory(payload) {
    var box = el("labHistory");
    if (!box) return;
    var items = (payload && payload.items) || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty">还没有检测记录</div>';
      return;
    }
    box.innerHTML = items
      .map(function (item) {
        var fam = (item.family && item.family.top) || "—";
        var prob = item.family && item.family.prob !== undefined && item.family.prob !== null
          ? (Number(item.family.prob) * 100).toFixed(1) + "%"
          : "—";
        var pel = item.pelican && item.pelican.ok ? '<span class="r ok">出图</span>' : '<span class="r bad">没出图</span>';
        var when = String(item.at || "").replace("T", " ").slice(5, 16);
        var cls = item.stored ? "hist-row has" : "hist-row";
        var tip = item.stored ? "点开看这次的完整结果" : "这次的结果没留在本地（只保留最近 6 次）";
        return (
          '<div class="' + cls + '" data-at="' + esc(item.at || "") + '" title="' + esc(tip) + '"><span class="t">' + esc(when) + "</span>" +
          '<span class="m" title="' + esc(item.model) + '">' + esc(item.served || item.model) + "</span>" +
          '<span class="f">' + esc(fam) + " · " + prob + "</span>" +
          '<span class="c">' + esc(costShort(item.cost)) + "</span>" +
          pel +
          "</div>"
        );
      })
      .join("");
    var meta = el("labHistMeta");
    if (meta) meta.textContent = "最近 " + items.length + " 次 · 花不花积分看最后一列";
  }

  function loadLabHistory() {
    return fetch("/api/lab/history", { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        renderLabHistory(data);
        if (!labHistoryBound) {
          labHistoryBound = true;
          var box = el("labHistory");
          if (box) {
            box.addEventListener("click", function (event) {
              var row = event.target && event.target.closest ? event.target.closest(".hist-row.has") : null;
              if (!row) return;
              loadLabResult(row.getAttribute("data-at"));
            });
          }
        }
      })
      .catch(function () {
        renderLabHistory({ items: [] });
      });
  }

  var labHistoryBound = false;

  function loadLabResult(at) {
    var url = "/api/lab/last" + (at ? "?at=" + encodeURIComponent(at) : "");
    return fetch(url, { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data && data.ok && data.item) {
          st.lab.error = "";
          st.lab.last = data.item;
          renderLabResult(data.item);
          var card = el("cardLab");
          if (card && card.scrollIntoView) card.scrollIntoView({ block: "nearest" });
        }
      })
      .catch(function () {});
  }
  function runLab() {
    if (st.lab.running) return;
    var model = el("labModel").value;
    var tests = LAB_TESTS.filter(function (item) {
      return st.lab.tests[item[0]];
    }).map(function (item) {
      return item[0];
    });
    if (!model) {
      st.lab.error = "先选一个模型";
      renderLabResult(null);
      return;
    }
    if (!tests.length) {
      st.lab.error = "至少选一项检测";
      renderLabResult(null);
      return;
    }
    st.lab.running = true;
    st.lab.error = "";
    el("labRun").textContent = "检测中…";
    renderLabChecks();
    el("labResults").innerHTML = labSkeleton(tests, model);
    fetch("/api/lab/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: model, tests: tests })
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        st.lab.running = false;
        el("labRun").textContent = "开始检测";
        renderLabChecks();
        if (!data || (!data.results && !data.ok)) {
          st.lab.error = (data && data.error) || "检测失败";
          renderLabResult(null);
          return;
        }
        st.lab.result = data;
        renderLabResult(data);
        loadLabHistory();
      })
      .catch(function (error) {
        st.lab.running = false;
        el("labRun").textContent = "开始检测";
        renderLabChecks();
        st.lab.error = "请求失败：" + String((error && error.message) || error);
        renderLabResult(null);
      });
  }

  // 页面加载时记下构建号；ui/ 任何文件一改，服务端构建号就变，5 秒内自己刷新。
  // 之前改完样式，插件窗口里还是旧页面，很容易误判成「没生效」。
  var buildSeen = "";
  function watchBuild() {
    function tick() {
      fetch("/_route-insight/build", { cache: "no-store" })
        .then(function (res) {
          return res.json();
        })
        .then(function (info) {
          if (!info || !info.id) return;
          var chip = el("build");
          if (!buildSeen) {
            buildSeen = info.id;
            if (chip) chip.textContent = (info.version ? "v" + info.version + " · " : "") + info.id;
            return;
          }
          if (info.id !== buildSeen) {
            buildSeen = info.id;
            if (chip) chip.textContent = "新版本已就绪，正在刷新…";
            setTimeout(function () {
              location.reload();
            }, 400);
          }
        })
        .catch(function () {
          // 取不到就算了，下一轮再说
        });
    }
    tick();
    setInterval(tick, 5000);
  }

  function boot() {
    var title = (document.documentElement.lang || "").indexOf("zh") === 0 ? "路由洞察" : "Route insight";
    if (params.get("lang") && String(params.get("lang")).toLowerCase().indexOf("zh") !== 0) {
      title = "Route insight";
    }
    el("title").textContent = title;
    document.title = title;
    buildWindowSeg();
    buildViewSeg();
    buildStatusSeg();
    buildSelects();
    renderLabChecks();
    showView();
    applyFold();
    watchBuild();
    if (st.view === "lab") {
      loadLabModels();
      loadLabHistory();
      loadLabResult();
    }
    if (st.view === "providers") loadProviders();
    watch();
    load();
  }

  boot();
})();