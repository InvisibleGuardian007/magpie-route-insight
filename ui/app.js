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
    coin:
      '<svg class="ic-svg" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/></svg>',
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
    prov: { at: "", cards: null, error: "", icons: {} },
    open: "",
    search: {},
    lab: {
      models: null,
      model: "",
      // 三项默认都勾上：数值指纹看统计纹理、协议审计看服务端记账、动画看画的像不像；
      // 提示词留空 = 用服务端给的默认那句。
      tests: { numfp: true, relay: true, anim: true },
      effort: { audit: "", draw: "" },
      prompt: "",
      promptDefault: "",
      library: null,
      numeric: null,
      result: null,
      running: false,
      error: ""
    }
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

  // magpie 自己的供应商头像（插件已经 /icons/<hash>.<ext> 代理过，页面 CSP img-src 只放行同源）。
  function iconFor(id) {
    var map = (st.prov && st.prov.icons) || null;
    return (map && map[id]) || "";
  }

  function provTag(id, cls) {
    var name = nameOf(id);
    var icon = iconFor(id);
    var face = icon
      ? '<img class="pv-ic" src="' + esc(icon) + '" alt="" loading="lazy" />'
      : '<span class="pv-ic ph">' + esc(String(name || "?").slice(0, 1)) + "</span>";
    return (
      '<span class="pv' + (cls ? " " + cls : "") + '" data-hue="' + hueFor(id) + '" title="' + esc(id) + '">' +
      face + "<b>" + esc(name) + "</b></span>"
    );
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
          // 计费按「实际扣了什么」显示：走额度窗口的是 0 积分，就该写额度/免费，不能一律当积分。
          var credits = Number(row.credits) || 0;
          var money =
            mode === "window"
              ? '<span class="money quota">额度</span>'
              : credits > 0
                ? '<span class="money">' + ICONS.coin + fmtCredits(credits) + "</span>"
                : '<span class="money free">免费</span>';
          var when = String(row.t || "").replace("T", " ").slice(5, 19);
          return (
            "<tr>" +
            '<td class="time">' +
            esc(when) +
            "</td>" +
            '<td class="prov">' + provTag(row.provider) + "</td>" +
            '<td class="model" title="' +
            esc(row.asked ? "请求 " + row.asked + " → 实际 " + row.model : row.model) +
            '">' +
            "<b>" + esc(row.model) + "</b>" +
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
            tokenCell(row) +
            '<td class="num ' +
            tone +
            '">' +
            ttft +
            "</td>" +
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
          (isProvider ? provTag(row.key, "tiny") : '<span class="ell">' + esc(label) + "</span>") +
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

  function load(retry) {
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
        // 插件热重载时服务会断几百毫秒到一两秒。先自己重连两次，别立刻甩一脸红字；
        // 真断了才报错，人工点「刷新」也不会因为重连计时器卡住。
        var tries = retry || 0;
        if (tries < 2) {
          el("src").textContent = "重连中… " + String((error && error.message) || error);
          setTimeout(function () {
            load(tries + 1);
          }, 900);
          return;
        }
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
      var head = target && target.closest ? target.closest(".card-head, .res-head") : null;
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
  // localStorage 只是"记住上次"的顺手存档，不是状态本身。
  // magpie 把插件页装在一个不带 allow-same-origin 的 iframe 里（origin 为 null），
  // 在那里 window.localStorage 一碰就抛 SecurityError —— 以前读写都走它，
  // 于是点一下：写失败、回头再读还是空，折叠立刻被撤销，表现就是"点了没反应"。
  // 现在以内存里的 foldMap 为准，localStorage 能写就写，纯属锦上添花。
  var foldMap = null;

  function readFold() {
    if (foldMap) return foldMap;
    foldMap = {};
    try {
      var raw = window.localStorage && window.localStorage.getItem(FOLD_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") foldMap = parsed;
    } catch (error) {
      // 沙箱里没有存储权限：这次会话记不住，但折叠照样能用。
    }
    return foldMap;
  }

  function writeFold(map) {
    foldMap = map;
    try {
      window.localStorage.setItem(FOLD_KEY, JSON.stringify(map));
    } catch (error) {
      // 同上：存不了不影响本次。
    }
  }

  function applyFold() {
    var map = readFold();
    // 不写死 id 清单：页面上每个 [data-fold] 按钮都算一个可折叠块。
    // 检测结果卡每次跑完都会重绘，写死清单就会漏掉它们（点了没反应就是这么来的）。
    var buttons = document.querySelectorAll("[data-fold]");
    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      var id = button.getAttribute("data-fold");
      if (id === "__top") continue;
      var node = el(id);
      if (!node) continue;
      var on = !!map[id];
      if (on) node.classList.add("collapsed");
      else node.classList.remove("collapsed");
      var chev = button.querySelector(".chev");
      var label = button.querySelector(".flabel");
      if (chev) chev.textContent = on ? "▸" : "▾";
      if (label) label.textContent = on ? "展开" : "收起";
      button.setAttribute("aria-expanded", on ? "false" : "true");
      button.title = on ? "点击展开这张卡片" : "点击收起这张卡片";
    }
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
        // 顺带把 id → 头像 存下来，看板表格里也能贴上供应商头像。
        st.prov.icons = {};
        ((data && data.providers) || []).forEach(function (card) {
          if (card && card.id && card.icon) st.prov.icons[card.id] = card.icon;
        });
        renderProviders(data);
      })
      .catch(function (error) {
        renderProviders({ error: String((error && error.message) || error) });
      });
  }

  /* ---------------- 智商检测（数值指纹 + 协议审计 + HTML 动画） ---------------- */

  var LAB_TESTS = [
    ["numfp", "数值指纹", "6 次「数 300 个随机数」（两回合）→ 参考库落到具体型号"],
    ["relay", "协议审计", "7 次协议探针：回声 / usage / 函数调用 / JSON / 流式"],
    ["anim", "HTML 动画", "完整 HTML：会动的鹈鹕骑车（提示词可改）"]
  ];
  // 强度档位：文本探针一条线，画图一条线，各选各的。
  var EFF_SLOTS = [
    ["labEffFam", "audit"],
    ["labEffDraw", "draw"]
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
          refreshNumericStatus();
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
    // 数值指纹 5 次数数挑战（空答会各自重试一次，故上限 10）；
    // 协议审计固定 7 次（3 回声 + 函数调用 + JSON + 非流式 + 流式）；
    // 画图 1 次，没画全会自动重试，最多 2 次。
    var low = 0;
    var high = 0;
    if (st.lab.tests.numfp) {
      low += 5;
      high += 10;
    }
    if (st.lab.tests.relay) {
      low += 7;
      high += 7;
    }
    if (st.lab.tests.anim) {
      low += 1;
      high += 2;
    }
    var cost = low === high ? low + " 次" : low + "–" + high + " 次";
    // 不是每次检测都扣积分：走额度窗口的线路 credits 一直是 0，具体看结果卡里的计费说明。
    el("labCost").textContent = count ? "预计 " + cost + "请求 · 是否扣积分看结果卡" : "至少选一项";
    el("labRun").disabled = !count || st.lab.running;
    fillLabEfforts();
  }

  // 强度下拉：档位来自网关 /v1/models 里这个型号的 reasoning_levels，
  // 没声明就只剩「默认档」一项，此时后端不会带 reasoning_effort。
  function labModelItem() {
    var hit = null;
    (st.lab.models || []).forEach(function (one) {
      if (one.value === st.lab.model) hit = one;
    });
    return hit;
  }

  function fillLabEfforts() {
    var item = labModelItem();
    var levels = (item && item.levels) || [];
    EFF_SLOTS.forEach(function (pair) {
      var box = el(pair[0]);
      if (!box) return;
      var cur = st.lab.effort[pair[1]] || "";
      var opts = ['<option value="">默认档</option>'].concat(
        levels.map(function (lv) {
          return '<option value="' + esc(lv) + '">' + esc(lv) + "</option>";
        })
      );
      box.innerHTML = opts.join("");
      box.value = levels.indexOf(cur) >= 0 ? cur : "";
      st.lab.effort[pair[1]] = box.value;
      box.disabled = !levels.length;
    });
    var note = el("labEffNote");
    if (note) {
      note.textContent = !item
        ? ""
        : levels.length
          ? esc(item.model) + " 支持 " + levels.join(" / ")
          : esc(item.model) + " 没声明强度档，只能走默认";
    }
  }

  // 参考库状态：第一次要下约 3.6 MB，进「指纹」页就先预热，别等点了「开始检测」才等下载。
  var numStatusAsked = false;
  function refreshNumericStatus() {
    var note = el("labNumNote");
    if (!note || numStatusAsked) return;
    numStatusAsked = true;
    note.textContent = "数值指纹参考库：检查中…";
    note.className = "lab-eff-note";
    fetch("/api/lab/numeric", { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        st.lab.numeric = data || null;
        if (data && data.ready) {
          note.textContent =
            "数值指纹参考库 " +
            String(data.builtAt || "").slice(0, 10) +
            " · " +
            ((Number(data.dataBytes) || 0) / 1048576).toFixed(1) +
            " MB";
          note.className = "lab-eff-note";
        } else {
          note.textContent = "数值指纹参考库没就绪" + (data && data.error ? "：" + String(data.error).slice(0, 60) : "");
          note.className = "lab-eff-note custom";
        }
      })
      .catch(function () {
        numStatusAsked = false;
        note.textContent = "数值指纹参考库状态读不到";
      });
  }

  // 检测 id → 用哪条强度线
  function labEffort() {
    return {
      // 数值指纹和协议审计共用「文本强度」那条线：两条都是纯文本短回答。
      numfp: st.lab.effort.audit || "",
      relay: st.lab.effort.audit || "",
      anim: st.lab.effort.draw || "",
      pelican: st.lab.effort.draw || ""
    };
  }

  function bindEfforts() {
    EFF_SLOTS.forEach(function (pair) {
      var box = el(pair[0]);
      if (!box) return;
      box.addEventListener("change", function () {
        st.lab.effort[pair[1]] = box.value;
      });
    });
  }

  var PROMPT_KEY = "route-insight-lab-prompt";

  // 画图提示词：输入框留空就用服务端的默认那句，改过的记在 localStorage。
  function fillLabPrompt() {
    var box = el("labPrompt");
    if (!box) return;
    if (!st.lab.prompt) {
      try {
        st.lab.prompt = window.localStorage.getItem(PROMPT_KEY) || "";
      } catch (error) {
        st.lab.prompt = "";
      }
    }
    if (document.activeElement !== box) box.value = st.lab.prompt;
    var hint = el("labPromptHint");
    var custom = !!st.lab.prompt.trim();
    if (box) box.placeholder = st.lab.promptDefault || "留空 = 用默认提示词";
    if (hint) {
      hint.textContent = custom
        ? "自定义 · " + st.lab.prompt.trim().length + " 字"
        : "默认 · 留空就用这句";
      hint.className = "lab-eff-note" + (custom ? " custom" : "");
    }
    var reset = el("labPromptReset");
    if (reset) reset.disabled = !custom;
  }

  function bindLabPrompt() {
    var box = el("labPrompt");
    if (box) {
      box.addEventListener("input", function () {
        st.lab.prompt = box.value;
        try {
          if (st.lab.prompt.trim()) window.localStorage.setItem(PROMPT_KEY, st.lab.prompt);
          else window.localStorage.removeItem(PROMPT_KEY);
        } catch (error) {}
        fillLabPrompt();
      });
    }
    var reset = el("labPromptReset");
    if (reset) {
      reset.addEventListener("click", function () {
        st.lab.prompt = "";
        try {
          window.localStorage.removeItem(PROMPT_KEY);
        } catch (error) {}
        if (box) box.value = "";
        fillLabPrompt();
      });
    }
  }

  // 模型选择器：原生 <select> 塞不下供应商头像，也没有搜索，所以自己画一个。
  // 触发器 = 头像 + 模型名 + 家族；面板 = 搜索 + 按供应商分组 + 每行「家族 / 次数」。
  var pickFlat = [];
  var pickQuery = "";

  function iconMarkup(item, cls) {
    if (item && item.icon) return '<img class="' + cls + '" src="' + esc(item.icon) + '" alt="" loading="lazy">';
    var letter = item && item.kind === "group" ? "◇" : String((item && item.provider) || "?").slice(0, 1).toUpperCase();
    return '<span class="' + cls + ' ph">' + esc(letter) + "</span>";
  }

  function pickProviderName(item) {
    if (item.kind === "group") return "网关分组";
    return item.providerName || item.provider || "其他";
  }

  function pickFace() {
    var list = st.lab.models || [];
    var item = null;
    list.forEach(function (one) {
      if (one.value === st.lab.model) item = one;
    });
    var ico = el("labPickIco");
    if (ico) ico.innerHTML = item ? iconMarkup(item, "pick-ico") : '<span class="pick-ico ph">◇</span>';
    el("labPickName").textContent = item ? item.model : list.length ? "选一个模型…" : "没有可用模型";
    var bits = [];
    if (item) {
      bits.push(pickProviderName(item));
      if (item.family && item.kind !== "group") bits.push(item.family);
    }
    el("labPickFam").textContent = bits.join(" · ");
  }

  function renderPick() {
    var box = el("labPickList");
    if (!box) return;
    var q = pickQuery.trim().toLowerCase();
    var order = [];
    var buckets = {};
    (st.lab.models || []).forEach(function (item) {
      var key = pickProviderName(item);
      var hay = (item.model + " " + key + " " + (item.family || "")).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      if (!buckets[key]) {
        buckets[key] = [];
        order.push(key);
      }
      buckets[key].push(item);
    });
    pickFlat = [];
    if (!order.length) {
      box.innerHTML = '<div class="pick-empty">没有匹配的模型</div>';
      return;
    }
    box.innerHTML = order
      .map(function (key) {
        var head =
          '<div class="pick-grp">' +
          iconMarkup(buckets[key][0], "pick-gico") +
          '<span class="pick-gname">' +
          esc(key) +
          '</span><span class="n">' +
          buckets[key].length +
          " 个</span></div>";
        var rows = buckets[key]
          .map(function (item) {
            var k = pickFlat.push(item) - 1;
            return (
              '<button class="pick-row' +
              (item.value === st.lab.model ? " on" : "") +
              '" type="button" role="option" data-k="' +
              k +
              '"><span class="pk-name">' +
              esc(item.model) +
              (item.kind === "group" ? '<em class="pk-kind">GROUP</em>' : "") +
              "</span>" +
              (item.family && item.kind !== "group" ? '<em class="pk-fam">' + esc(item.family) + "</em>" : "") +
              '<span class="pk-n">' + (item.n || 0) + " 次</span>" +
              '<span class="pk-check">✓</span></button>'
            );
          })
          .join("");
        return head + rows;
      })
      .join("");
  }

  function pickChoose(value) {
    st.lab.model = value;
    pickFace();
    renderPick();
    fillLabEfforts();
  }

  function bindPick() {
    var btn = el("labPickBtn");
    var pop = el("labPickPop");
    var input = el("labPickQ");
    var list = el("labPickList");
    if (!btn || !pop || !list) return;

    function close() {
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    function open() {
      if (!(st.lab.models || []).length) return;
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      pickQuery = "";
      if (input) input.value = "";
      renderPick();
      if (input) input.focus();
    }
    function step(delta) {
      var rows = [].slice.call(list.querySelectorAll(".pick-row"));
      if (!rows.length) return;
      var at = -1;
      rows.forEach(function (row, k) {
        if (row.className.indexOf("act") >= 0) at = k;
      });
      at = Math.min(rows.length - 1, Math.max(0, at + delta));
      rows.forEach(function (row, k) {
        row.className = row.className.replace(/\s*act\b/g, "") + (k === at ? " act" : "");
      });
      if (rows[at].scrollIntoView) rows[at].scrollIntoView({ block: "nearest" });
    }

    btn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (pop.hidden) open();
      else close();
    });
    if (input) {
      input.addEventListener("input", function () {
        pickQuery = input.value;
        renderPick();
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          step(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          var row = list.querySelector(".pick-row.act") || list.querySelector(".pick-row.on");
          if (row) {
            pickChoose(pickFlat[Number(row.getAttribute("data-k"))].value);
            close();
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      });
    }
    list.addEventListener("click", function (event) {
      var row = event.target && event.target.closest ? event.target.closest(".pick-row") : null;
      if (!row) return;
      var item = pickFlat[Number(row.getAttribute("data-k"))];
      if (!item) return;
      pickChoose(item.value);
      close();
    });
    document.addEventListener("click", function (event) {
      if (pop.hidden) return;
      if (pop.contains(event.target) || btn.contains(event.target)) return;
      close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !pop.hidden) close();
    });
  }

  function loadLabModels() {
    el("labPickName").textContent = "读取模型…";
    return fetch("/api/lab/models", { cache: "no-store" })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        var models = (data && data.models) || [];
        st.lab.models = models;
        st.lab.library = (data && data.library) || null;
        st.lab.promptDefault = (data && data.prompts && data.prompts.anim) || "";
        fillLabPrompt();
        if (!models.length) {
          pickFace();
          fillLabEfforts();
          return;
        }
        var keep = models.some(function (item) {
          return item.value === st.lab.model;
        });
        if (!keep) st.lab.model = models[0].value;
        pickFace();
        renderPick();
        fillLabEfforts();
      })
      .catch(function (error) {
        st.lab.models = [];
        st.lab.error = String((error && error.message) || error);
        pickFace();
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
        var name =
          id === "numfp"
            ? "数值指纹"
            : id === "relay"
              ? "协议审计"
              : id === "pelican"
                ? "一键画鹈鹕"
                : id === "anim"
                  ? "HTML 动画"
                  : "检测";
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

  function foldBtn(id) {
    return '<button class="fold" type="button" data-fold="' + id + '" aria-expanded="true">' +
      '<span class="chev">▾</span><span class="flabel">收起</span></button>';
  }

  /* ---------------- 两条证据互相校验 ----------------
     数值指纹看的是「数数的纹理」，协议审计看的是「服务端怎么记账」。前者能被系统提示词
     糊弄（让人家自称 gpt 很容易），后者模型自己改不了，两边一起看才站得住。 */
  function normModel(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/^.*\//, "")          // wb-proxy-cn/deepseek-v4.1-flash → deepseek-v4.1-flash
      .replace(/[-_.]?\d{4}$/, "")   // deepseek-v4.1-flash-1017 → deepseek-v4.1-flash
      .replace(/[^a-z0-9]/g, "");
  }

  function sameModel(a, b) {
    var x = normModel(a);
    var y = normModel(b);
    if (!x || !y) return false;
    return x === y || x.indexOf(y) === 0 || y.indexOf(x) === 0;
  }

  function crossCheck(num, relay, requested) {
    var want = requested || "";
    var got = num && num.ok ? num.predictionName || num.prediction || "" : "";
    var p = num && num.probability !== null && num.probability !== undefined ? Number(num.probability) : null;
    var pct = function (v) { return v === null ? "—" : (v * 100).toFixed(1) + "%"; };
    var auditBad = !!(relay && relay.verdict !== "clean");
    var auditNote = relay ? "协议审计 " + relay.score + "/100（" + relay.verdictLabel + "）" : "";
    if (!got) {
      if (!relay) return "";
      return '<div class="lab-xcheck ' + (auditBad ? "bad" : "dim") + '"><b>只有协议层证据</b><span>' +
        esc(auditNote) + (auditBad
          ? "，" + relay.findings.length + " 处疑点见下面的清单。这次没测出模型身份。"
          : "。接口本身像真的，但这次没测出模型身份。") + "</span></div>";
    }
    if (!want || sameModel(got, want)) {
      return '<div class="lab-xcheck ' + (auditBad ? "bad" : "ok") + '"><b>' +
        (auditBad ? "身份对得上，链路有疑点" : "两条证据一致") + '</b><span>数数纹理像 <em>' + esc(got) + "</em>（" + esc(pct(p)) +
        "），与请求的型号一致" + (relay ? "；" + esc(auditNote) : "") + "。</span></div>";
    }
    if (p !== null && p >= 0.6) {
      return '<div class="lab-xcheck bad"><b>身份对不上</b><span>请求的是 <em>' + esc(want) + "</em>，数数纹理却更像 <em>" +
        esc(got) + "</em>（" + esc(pct(p)) + "）——这条路由大概率不是你在页面上选的那个型号" +
        (relay ? "；" + esc(auditNote) : "") + "。</span></div>";
    }
    return '<div class="lab-xcheck dim"><b>数值指纹不够确定</b><span>请求 <em>' + esc(want) + "</em>，数数更像 <em>" + esc(got) +
      "</em>，但概率只有 " + esc(pct(p)) + "，别当定论" + (relay ? "；" + esc(auditNote) : "") + "。</span></div>";
  }

  function renderLabResult(payload) {
    var box = el("labResults");
    if (!payload) {
      box.innerHTML = '<div class="empty">' + esc(st.lab.error || "还没有检测结果") + "</div>";
      return;
    }
    var results = payload.results || {};
    var family = results.family; // 老结果里还有「自述」，新检测不再产生
    var relay = results.relay;
    var pelican = results.pelican;
    var anim = results.anim;
    var num = results.numfp;
    if (!family && !relay && !pelican && !anim && !num) {
      box.innerHTML = '<div class="empty">没有结果</div>';
      return;
    }
    var served =
      (relay && relay.model) || (family && family.served) || (anim && anim.served) || (pelican && pelican.served) || (num && num.model) || payload.model;
    var at = nowStamp();
    var totalMs =
      (Number(relay && relay.ms) || 0) +
      (Number(family && family.ms) || 0) +
      (Number(anim && anim.ms) || 0) +
      (Number(pelican && pelican.ms) || 0) +
      (Number(num && num.ms) || 0);
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
      // 排的是网关清单里的具体型号（deepseek-v4.1-flash 这种），不是泛泛的家族名。
      var ranked = (family.ranking || [])
        .slice(0, 8)
        .map(function (item, k) {
          var pct = Math.max(0, Math.min(1, Number(item.prob) || 0)) * 100;
          var sub = [item.family || "", item.providers && item.providers.length > 1 ? item.providers.length + " 个供应商" : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            '<div class="rk-row' + (k === 0 ? " top" : "") + '"><span class="rk-n">' + (k + 1) + "</span>" +
            '<span class="rk-name">' + esc(item.name) + (item.route ? '<em class="rk-tag">路由</em>' : "") +
            (sub ? '<em class="rk-sub">' + esc(sub) + "</em>" : "") + "</span>" +
            '<span class="rk-p">' + pct.toFixed(1) + "%</span>" +
            '<span class="rk-bar"><i data-p="' + (Math.max(0.7, pct) / 100).toFixed(4) + '"></i></span></div>'
          );
        })
        .join("");
      var lib = family.library || st.lab.library || null;
      var libNote = lib && lib.count
        ? "参考库：网关清单里 " + lib.count + " 个具体型号 · " + (lib.providers || 0) + " 个供应商 · 归到 " +
          (lib.families || 0) + " 个家族" + (lib.at ? " · 清单取自 " + String(lib.at).slice(5, 16).replace("T", " ") : "")
        : "参考库没读到（网关 /v1/models 不通），只能按家族粗略排";
      var rankBlock = ranked
        ? '<div class="rk"><div class="rk-head"><span>候选排名 · 具体型号</span><span class="rk-col">概率</span></div>' +
          ranked + '<div class="rk-foot">' + esc(libNote) + "</div></div>"
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

    var rawPelican = pelican && !family && !anim && !num
      ? '<div class="lab-fp"><details class="lab-raw"><summary>原始回答</summary><pre>' + esc(pelican.raw || "") + "</pre></details></div>"
      : "";

    // 数值指纹：它怎么自称都不算数，只看「数数」的统计纹理跟参考库里谁最像。
    var numBlock = "";
    if (num) {
      var numRows = (num.results || [])
        .slice(0, 8)
        .map(function (item, i) {
          var pct = Math.max(0, Math.min(1, Number(item.probability) || 0)) * 100;
          var sub = [item.familyName || item.family || ""].filter(Boolean).join(" · ");
          return (
            '<div class="rk-row' + (i === 0 ? " top" : "") + '"><span class="rk-n">' + (i + 1) + "</span>" +
            '<span class="rk-name">' + esc(item.name) + (sub ? '<em class="rk-sub">' + esc(sub) + "</em>" : "") + "</span>" +
            '<span class="rk-p">' + pct.toFixed(1) + "%</span>" +
            '<span class="rk-bar"><i data-p="' + (Math.max(0.7, pct) / 100).toFixed(4) + '"></i></span></div>'
          );
        })
        .join("");
      var probText =
        num.probability === null || num.probability === undefined
          ? "—"
          : (Number(num.probability) * 100).toFixed(1) + "%";
      var badgeTone = num.ok ? "ok" : num.decision === "not_model" ? "warn" : "bad";
      var numTop = num.ok
        ? '<b class="num-name">' + esc(num.predictionName || num.prediction) + "</b>" +
          '<span class="num-p">' + probText + "</span>" +
          (num.familyName ? '<em class="num-fam">' + esc(num.familyName) + "</em>" : "")
        : '<b class="num-name">' + esc((num.evidence && num.evidence.label) || num.decisionLabel || "没得分") + "</b>";
      var sampleRows = (num.samples || [])
        .map(function (one) {
          return (
            "<tr><td>" + (one.round || 1) + "</td><td>" + one.index + "</td><td>" + (one.expected || 0) + "</td><td>" +
            (one.parsed || 0) + "</td><td>" + fmtMs(one.ms) + "</td><td>" +
            (one.accepted ? '<span class="r ok">收下</span>' : '<span class="r bad">没用</span>') +
            (one.retried ? '<em class="num-retry">重试</em>' : "") + "</td></tr>"
          );
        })
        .join("");
      var numFoot = [
        num.builtAt ? "参考库 " + String(num.builtAt).slice(0, 10) : "",
        num.method || "",
        num.used ? num.used + " / " + (num.probabilityStatus === "merged" ? "6 个样本（两回合）" : "3 个样本") + "入算" : "",
        num.margin !== null && num.margin !== undefined ? "与第二名差 " + (Number(num.margin) * 100).toFixed(1) + " 个百分点" : ""
      ]
        .filter(Boolean)
        .join(" · ");
      numBlock =
        '<div class="lab-num" id="resNum" data-foldable="1">' +
        '<div class="res-head"><h4>数值指纹<span class="sub">6 次「数数」挑战（两回合）· 看数字串的统计纹理，不看它怎么自称</span></h4>' +
        foldBtn("resNum") + "</div>" +
        '<div class="res-body">' +
        '<div class="num-top"><span class="num-badge ' + badgeTone + '">' + esc(num.decisionLabel || "") + "</span>" +
        numTop + "</div>" +
        (numRows
          ? '<div class="rk"><div class="rk-head"><span>参考库排名 · 具体型号</span><span class="rk-col">概率</span></div>' + numRows + "</div>"
          : "") +
        (sampleRows
          ? '<table class="num-samples"><thead><tr><th>回合</th><th>#</th><th>要的数</th><th>解析到</th><th>用时</th><th>结果</th></tr></thead><tbody>' +
            sampleRows + "</tbody></table>"
          : "") +
        (num.evidence && num.evidence.reason && !num.ok
          ? '<div class="lab-verdict">' + esc(num.evidence.reason) + "</div>"
          : "") +
        (numFoot ? '<div class="rk-foot">' + esc(numFoot) + "</div>" : "") +
        (num.error ? '<div class="lab-err">' + esc(num.error) + "</div>" : "") +
        "</div></div>";
    }

    // 协议审计：不猜身份，只查「这条路是不是真的按 OpenAI 协议在干活」。
    var relayBlock = "";
    if (relay) {
      var rlChecks = (relay.checks || [])
        .map(function (check) {
          var w = Number(check.weight) || 1;
          var tone = check.pass ? "ok" : check.score >= w * 0.5 ? "warn" : "bad";
          var frac = Math.max(0.02, Math.min(1, (Number(check.score) || 0) / w));
          return (
            '<div class="rl-row"><span class="rl-name">' + esc(check.name) + "</span>" +
            '<span class="rl-bar"><i data-p="' + frac.toFixed(4) + '"></i></span>' +
            '<span class="rl-score ' + tone + '">' + (Number(check.score) || 0) + "<em>/" + w + "</em></span>" +
            '<span class="rl-detail">' + esc(check.detail) + "</span></div>"
          );
        })
        .join("");
      var rlFinds = (relay.findings || [])
        .map(function (item) {
          return '<li class="' + (item.level === "critical" ? "bad" : "warn") + '">' + esc(item.text) + "</li>";
        })
        .join("");
      var rlTone = relay.verdict === "clean" ? "ok" : relay.verdict === "suspicious" ? "warn" : "bad";
      var rlKeys = (relay.usageKeys || []).join("、");
      relayBlock =
        '<div class="lab-relay" id="resRelay" data-foldable="1">' +
        '<div class="res-head"><h4>协议审计<span class="sub">回声一致性 / usage 记账 / 函数调用 / 结构化输出 / 流式一致性 · 7 次探针</span></h4>' +
        foldBtn("resRelay") + "</div>" +
        '<div class="res-body">' +
        '<div class="rl-top"><span class="rl-badge ' + rlTone + '">' + esc(relay.verdictLabel || "") + "</span>" +
        '<b class="rl-total">' + (Number(relay.score) || 0) + "<em>/100</em></b>" +
        '<span class="rl-keys">usage 字段：' + (rlKeys ? esc(rlKeys) : "一个都没给") + "</span></div>" +
        '<div class="rl-checks">' + rlChecks + "</div>" +
        (rlFinds ? '<ul class="rl-findings">' + rlFinds + "</ul>" : '<div class="rl-clean">这一批没发现疑点。</div>') +
        '<div class="rk-foot">' + esc(relay.footnote || "") + "</div>" +
        (relay.error ? '<div class="lab-err">' + esc(relay.error) + "</div>" : "") +
        "</div></div>";
    }

    // HTML 动画：产物是整份文档，只有放进 iframe 才会真的动起来（内联进主页面会被外层 CSP 挡住）。
    var animBlock = "";
    if (anim) {
      var artUrl = anim.htmlId ? "/api/lab/art/" + anim.htmlId + ".html" : "";
      var feat = anim.features || {};
      var rows = [
        ["完整度", feat.bytes ? (Number(feat.bytes) / 1024).toFixed(1) + " KB" : "—"],
        ["图元", (feat.elements || 0) + " 个"],
        ["动起来", (feat.animations || 0) + " 处 · 关键帧 " + (feat.keyframes || 0)],
        ["颜色", (feat.colours || 0) + " 种"],
        ["耗时", fmtMs(anim.ms)]
      ]
        .map(function (pair) {
          return "<span><b>" + esc(pair[0]) + "</b>" + esc(pair[1]) + "</span>";
        })
        .join("");
      var animBody = artUrl
        ? '<div class="lab-anim"><iframe title="模型交回来的 HTML 动画" src="' +
          esc(artUrl) +
          '" sandbox="" referrerpolicy="no-referrer" loading="lazy"></iframe>' +
          '<div class="lab-anim-bar"><span class="meta">' + esc(anim.served || served) + "</span>" +
          (anim.retried ? '<span class="meta">重试过一次</span>' : "") +
          '<span class="spacer"></span><button class="mini" type="button" data-anim="big">放大</button>' +
          '<a class="mini" href="' + esc(artUrl) + '" target="_blank" rel="noreferrer">新窗口</a></div></div>'
        : '<div class="lab-anim empty-box">没拿到完整 HTML：' +
          esc(String(anim.error || anim.raw || "").slice(0, 200)) + "</div>";
      animBlock =
        '<div class="lab-anim-wrap" id="resAnim" data-foldable="1">' +
        '<div class="res-head"><h4>HTML 动画' +
        (anim.custom ? '<em class="lab-tag" title="这次用的是你写的提示词">自定义提示词</em>' : "") +
        '<span class="sub">CSS 关键帧 + SVG · 脚本和外部资源已剥掉</span></h4>' +
        foldBtn("resAnim") + "</div>" +
        '<div class="res-body">' + animBody +
        '<div class="lab-shot-meta">' + rows + "</div>" +
        '<div class="signals">' + signalRows(anim.signals) + "</div>" +
        (anim.error ? '<div class="lab-err">' + esc(anim.error) + "</div>" : "") +
        (anim.prompt
          ? '<details class="lab-raw"><summary>这次用的提示词</summary><pre>' + esc(anim.prompt) + "</pre></details>"
          : "") +
        '<details class="lab-raw"><summary>原始回答</summary><pre>' +
        esc(String(anim.raw || "").slice(0, 20000)) +
        "</pre></details></div></div>";
    }

    // 用户要的是一张卡：上面是模型画出来的鹈鹕，下面直接跟它的指纹信息。
    var iqBody =
      (shot ? '<div class="iq-pic">' + shot + "</div>" : "") +
      (fp ? '<div class="iq-fp">' + fp + "</div>" : "") +
      rawPelican;
    var iqHeadNote = shot && fp ? "上面是它画出来的鹈鹕，下面是它对不上号的指纹" : shot ? "模型画出来的鹈鹕" : "自述型指纹（不做数，只看路由）";
    var iqBlock = iqBody
      ? '<div class="lab-iq" id="resIq" data-foldable="1">' +
        '<div class="res-head"><h4>智商检测<span class="sub">' + esc(iqHeadNote) + "</span></h4>" +
        foldBtn("resIq") + "</div>" +
        '<div class="res-body">' + iqBody + "</div></div>"
      : "";

    var xc = crossCheck(num, relay, payload.model || st.lab.model);
    box.innerHTML =
      '<div class="lab-card"><div class="lab-card-head"><h3>' + esc(served) + "</h3>" +
      '<span class="meta">' + esc(costText(payload.cost) || "本次检测") +
      '</span><span class="spacer"></span><span class="meta">' + (totalMs ? "合计 " + fmtMs(totalMs) : "") + "</span></div>" +
      xc + numBlock + relayBlock + animBlock + iqBlock + "</div>";
    var svgs = box.querySelectorAll(".lab-shot svg");
    for (var k = 0; k < svgs.length; k += 1) {
      svgs[k].removeAttribute("width");
      svgs[k].removeAttribute("height");
    }
    // 候选排名的条：页面 CSP 是 style-src 'self'（没有 unsafe-inline），
    // HTML 里写的 style="width:…" 会被浏览器整条丢掉、条子就变满格；
    // 只有走 CSSOM 赋值才生效，所以长度在这里补上。
    var bars = box.querySelectorAll(".rk-bar i, .rl-bar i");
    for (var b = 0; b < bars.length; b += 1) {
      bars[b].style.transform = "scaleX(" + (bars[b].getAttribute("data-p") || "0") + ")";
    }
    // 动画画布：默认 320px 高，点「放大」铺到 72vh，再点还原。
    var animBox = box.querySelector(".lab-anim");
    if (animBox) {
      var animBtn = animBox.querySelector('[data-anim="big"]');
      if (animBtn) {
        animBtn.addEventListener("click", function () {
          var wrap = animBox.parentNode;
          var big = wrap.className.indexOf("big") >= 0;
          wrap.className = big ? wrap.className.replace(/\s*big\b/g, "") : wrap.className + " big";
          animBtn.textContent = big ? "放大" : "还原";
        });
      }
    }
    // 结果卡是刚重绘出来的，折叠态要在这里再套一次，不然上次展开/收起的记录会丢。
    applyFold();
    // 画布：默认压到一屏放得下，点一下放到大图，再点还原。
    var shotBox = box.querySelector(".lab-shot");
    if (shotBox) {
      shotBox.addEventListener("click", function () {
        shotBox.className = shotBox.className.indexOf("big") >= 0
          ? shotBox.className.replace(/\s*big\b/g, "")
          : shotBox.className + " big";
      });
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
        var numTop = (item.numfp && item.numfp.ok && item.numfp.top) || "";
        var numProb = item.numfp && item.numfp.prob !== undefined && item.numfp.prob !== null
          ? (Number(item.numfp.prob) * 100).toFixed(1) + "%"
          : "—";
        var audit = item.relay || null;
        var fam = numTop || (item.family && item.family.top) || (audit ? "协议审计" : "—");
        var prob = numTop
          ? numProb
          : item.family && item.family.prob !== undefined && item.family.prob !== null
            ? (Number(item.family.prob) * 100).toFixed(1) + "%"
            : audit
              ? (audit.label || "") + " " + (Number(audit.score) || 0)
              : "—";
        var bits = [];
        // 「冒充」的硬信号换成了：请求的型号 ≠ 数值指纹认出的型号。自述那一路已经删掉——
        // 它被后端钉死的系统提示词一改就骗过去了，留着只会误导。
        var clash = !!(numTop && item.model && !sameModel(numTop, item.model));
        // 数值指纹的「型号 · 概率」已经在上面那列了，徽章里不再重复一次。
        if (item.numfp && !item.numfp.ok) bits.push('<span class="r bad">数值没得分</span>');
        if (audit) {
          bits.push(
            '<span class="r ' + (audit.verdict === "clean" ? "ok" : audit.verdict === "suspicious" ? "warn" : "bad") +
              '" title="协议审计 ' + (Number(audit.score) || 0) + '/100：回声、usage 记账、函数调用、结构化输出、流式一致性">审计 ' +
              (Number(audit.score) || 0) + "</span>"
          );
        }
        if (item.anim) bits.push(item.anim.ok ? '<span class="r ok">动画</span>' : '<span class="r bad">没动画</span>');
        if (item.pelican) bits.push(item.pelican.ok ? '<span class="r ok">出图</span>' : '<span class="r bad">没出图</span>');
        if (clash) {
          var why =
            "请求的是 " + item.model + "，数值指纹认出的是 " + item.numfp.top + "（" +
            (Number(item.numfp.prob) * 100).toFixed(1) + "%）——这条路由大概率不是你要的型号";
          bits.unshift('<span class="r bad" title="' + esc(why) + '">对不上</span>');
        }
        var pel = bits.join("") || '<span class="r">—</span>';
        var when = String(item.at || "").replace("T", " ").slice(5, 16);
        var cls = item.stored ? "hist-row has" : "hist-row";
        var tip = item.stored ? "点开看这次的完整结果" : "这次的结果没留在本地（只保留最近 6 次）";
        return (
          '<div class="' + cls + '" data-at="' + esc(item.at || "") + '" title="' + esc(tip) + '"><span class="t">' + esc(when) + "</span>" +
          '<span class="m" title="' + esc(item.model) + '">' + esc(item.served || item.model) + "</span>" +
          '<span class="f">' + esc(fam) + " · " + prob + "</span>" +
          '<span class="c">' + esc(costShort(item.cost)) + "</span>" +
          '<span class="rb">' + pel + "</span>" +
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
    var model = st.lab.model;
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
      body: JSON.stringify({ model: model, tests: tests, effort: labEffort(), prompt: st.lab.prompt })
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
    bindPick();
    bindEfforts();
    bindLabPrompt();
    showView();
    applyFold();
    watchBuild();
    if (st.view === "lab") {
      loadLabModels();
      loadLabHistory();
      loadLabResult();
    }
    if (st.view === "providers") loadProviders();
    // 看板表格里的供应商头像来自这份清单，所以不管在哪个视图都先拉一次。
    else loadProviders();
    watch();
    load();
  }

  boot();
})();