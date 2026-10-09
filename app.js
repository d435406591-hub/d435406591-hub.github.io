/* =====================================================================
   Coffee Brewing Lab · app.js
   核心：统一冲煮参数计算器（正向+反向）+ SCA 控制图 + 趋势图 + 实验记录
   约定：1 g 咖啡粉吸水 2 g（ABS）
   ===================================================================== */
'use strict';

/* ---------------- 基础工具 ---------------- */
const ABS = 2;                       // 每克粉吸水量
const EY_CORR = 0.963;               // 控制图体积口径校正：落点/分区判定时 萃取率 ÷ EY_CORR（计算器自身数值不变）
const IDEAL_TDS = [1.15, 1.45];      // 理想浓度区间 %
const IDEAL_EY = [18, 22];           // 理想萃取率区间 %

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/** 读取数值：可传选择器字符串（'#id'）或表单元素；空值/非法值返回 NaN */
function num(el) {
  if (el == null) return NaN;
  let raw;
  if (typeof el === 'string') {
    let node = null;
    try { node = document.querySelector(el); } catch (e) { node = null; }
    raw = node ? node.value : el;         // 传选择器 → 取其 value；传纯数字串 → 直接解析
  } else {
    raw = el.value;
  }
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : NaN;
}
function fmt(v, d = 2) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d);
}
function trim(v, d = 1) {
  if (!Number.isFinite(v)) return '—';
  let s = v.toFixed(d);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function ratioText(r) {
  if (!Number.isFinite(r) || r <= 0) return '—';
  const n = Math.abs(r - Math.round(r)) < 0.05 ? Math.round(r) : +r.toFixed(1);
  return '1:' + n;
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- 计算引擎（供首页快速体检复用） ---------------- */
function fromTDS(powder, water, tds, realBeverage) {
  const absorbed = powder * ABS;
  const beverage = Number.isFinite(realBeverage) && realBeverage > 0 ? realBeverage : water - absorbed;
  const solubles = beverage * tds / 100;
  const ey = powder > 0 ? solubles / powder * 100 : NaN;
  return {
    powder, water, tds, absorbed, beverage, solubles, ey,
    ratio: powder > 0 ? water / powder : NaN,
    realAbsorbed: Number.isFinite(realBeverage) && realBeverage > 0 ? powder > 0 ? (water - realBeverage) / powder : NaN : NaN,
    ok: beverage > 0
  };
}

/* ---------------- 目标杯判断 ---------------- */
const ZONES = {
  hi_lo:   { name: '高浓度 · 低萃取', en: 'Strong & Underextracted', cls: 'z-hi-lo',
             desc: '浓度高但萃取不足，典型的「又浓又空」。可能是粉太多、水太少或研磨偏粗。常见感受：浓、强、干涩、发苦但不甜。建议：加大水量、磨细一点，或延长萃取。' },
  hi_mid:  { name: '偏高浓度 · 强度区', en: 'Strong', cls: 'z-hi-mid',
             desc: '浓度偏高、萃取率正常，属于「浓而完整」的一杯。适合喜浓口味；若觉得压舌，可把粉水比放大半档。' },
  hi_hi:   { name: '高浓度 · 过萃', en: 'Strong & Overextracted', cls: 'z-hi-hi',
             desc: '又浓又过度萃取，苦涩、干涩、尾韵发木的概率高。建议：磨粗、降水温、缩短时间，或加大水量。' },
  mid_lo:  { name: '浓度正常 · 萃取不足', en: 'Underextracted', cls: 'z-mid-lo',
             desc: '浓度没问题，但风味没出来，偏酸、单薄、甜感弱。建议：升温、磨细或延长萃取，而不是加减水。' },
  ideal:   { name: '理想区域', en: 'IDEAL', cls: 'z-ideal',
             desc: 'TDS 约 1.15–1.45%、萃取率约 18–22%，酸甜苦较平衡。记下这组参数作为基准，之后每次只改一个变量。' },
  mid_hi:  { name: '浓度正常 · 过萃', en: 'Overextracted', cls: 'z-mid-hi',
             desc: '萃取率偏高，容易出现苦、涩、杂味。建议：磨粗一档、降 2–3 ℃、或缩短总时间。' },
  lo_lo:   { name: '偏淡 · 萃取不足', en: 'Weak & Underextracted', cls: 'z-lo-lo',
             desc: '水太多且没萃够，杯感稀、酸、水感重。两个问题一起解决：先缩水量，再加萃取（升温/磨细）。' },
  lo_mid:  { name: '偏淡 · 萃取正常', en: 'Weak', cls: 'z-mid-lo',
             desc: '萃取率达标但被水稀释了，风味清但不够有力。建议：缩小粉水比（少水或加粉）即可，别动研磨。' },
  lo_hi:   { name: '偏淡 · 高萃取', en: 'Weak & Overextracted', cls: 'z-lo-hi',
             desc: '水多、萃得多，得到的是一杯「淡而苦」的咖啡。建议：缩水量 + 降萃取（磨粗或降温）同时调整。' }
};
function zoneOf(tds, ey) {
  if (!Number.isFinite(tds) || !Number.isFinite(ey)) return null;
  const level = (v, [a, b]) => (v < a ? 'lo' : v > b ? 'hi' : 'mid');
  const t = level(tds, IDEAL_TDS), e = level(ey, IDEAL_EY);
  if (t === 'hi' && e === 'lo') return ZONES.hi_lo;
  if (t === 'hi' && e === 'mid') return ZONES.hi_mid;
  if (t === 'hi' && e === 'hi') return ZONES.hi_hi;
  if (t === 'mid' && e === 'lo') return ZONES.mid_lo;
  if (t === 'mid' && e === 'mid') return ZONES.ideal;
  if (t === 'mid' && e === 'hi') return ZONES.mid_hi;
  if (t === 'lo' && e === 'lo') return ZONES.lo_lo;
  if (t === 'lo' && e === 'mid') return ZONES.lo_mid;
  return ZONES.lo_hi;
}
function judgeHTML(tds, ey) {
  const z = zoneOf(tds, ey);
  if (!z) return '';
  return `<div class="judge ${z.cls}">
    <h4>目标杯判断：${z.name} <span class="tiny">${z.en}</span></h4>
    <p>${z.desc}</p>
  </div>`;
}

/* ---------------- SVG 图表工具 ---------------- */
const C = {
  ink: '#2a211b', ink2: '#584a3e', muted: '#8d7d70', grid: '#ece4d9', grid2: '#f4eee6',
  brand: '#6b4a2f', brand2: '#a9714b', dot: '#b3452f', ideal: '#cfe4f2', idealLine: '#79aed3',
  teal: '#17706e', blue: '#3b7ea1', axis: '#c9bcae'
};
function niceStep(raw) {
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  let n;
  if (f <= 1) n = 1; else if (f <= 2) n = 2; else if (f <= 2.5) n = 2.5; else if (f <= 5) n = 5; else n = 10;
  return n * Math.pow(10, exp);
}
function ticks(min, max, count = 6) {
  const step = niceStep((max - min) / count);
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(8));
  return out;
}
function domain(vals, padRate = 0.14) {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return [0, 1];
  let a = Math.min(...v), b = Math.max(...v);
  if (a === b) { const d = Math.abs(a) * 0.1 || 1; return [a - d, b + d]; }
  const p = (b - a) * padRate;
  return [a - p, b + p];
}
function linreg(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0), sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const d = n * sxx - sx * sx;
  if (Math.abs(d) < 1e-12) return null;
  const k = (n * sxy - sx * sy) / d, b = (sy - k * sx) / n;
  const my = sy / n;
  const sst = pts.reduce((s, p) => s + Math.pow(p.y - my, 2), 0);
  const sse = pts.reduce((s, p) => s + Math.pow(p.y - (k * p.x + b), 2), 0);
  const r2 = sst > 1e-12 ? 1 - sse / sst : 1;
  return { k, b, r2 };
}

/**
 * 通用散点/趋势图
 * points: [{x, y, tip}]
 */
function scatterSVG(o) {
  const W = 560, H = 350, m = { l: 62, r: 22, t: 30, b: 52 };
  const [xMin, xMax] = o.xDomain, [yMin, yMax] = o.yDomain;
  const px = x => m.l + (x - xMin) / (xMax - xMin) * (W - m.l - m.r);
  const py = y => H - m.b - (y - yMin) / (yMax - yMin) * (H - m.t - m.b);
  const fX = o.fmtX || (v => trim(v, 1)), fY = o.fmtY || (v => trim(v, 2));
  const pts = (o.points || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria || 'chart'}">`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;

  // y 网格 + 刻度
  ticks(yMin, yMax, 5).forEach(v => {
    const y = py(v);
    s += `<line x1="${m.l}" y1="${y.toFixed(1)}" x2="${W - m.r}" y2="${y.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${m.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11.5" fill="${C.muted}">${fY(v)}</text>`;
  });
  // x 网格 + 刻度
  ticks(xMin, xMax, 6).forEach(v => {
    const x = px(v);
    s += `<line x1="${x.toFixed(1)}" y1="${m.t}" x2="${x.toFixed(1)}" y2="${H - m.b}" stroke="${C.grid2}" stroke-width="1"/>`;
    s += `<text x="${x.toFixed(1)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11.5" fill="${C.muted}">${fX(v)}</text>`;
  });
  // 轴
  s += `<line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="${C.axis}" stroke-width="1.2"/>`;
  s += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="${C.axis}" stroke-width="1.2"/>`;
  // 轴标题
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 12}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.ink2}">${o.xLabel}</text>`;
  s += `<text transform="translate(16 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="600" fill="${C.ink2}">${o.yLabel}</text>`;

  // 理想区间底纹（可选）
  if (o.band) {
    const y1 = py(clamp(o.band[1], yMin, yMax)), y2 = py(clamp(o.band[0], yMin, yMax));
    s += `<rect x="${m.l}" y="${y1.toFixed(1)}" width="${(W - m.l - m.r).toFixed(1)}" height="${Math.max(0, y2 - y1).toFixed(1)}" fill="${C.ideal}" opacity=".55"/>`;
    if (y2 - y1 > 18) {
      s += `<text x="${W - m.r - 7}" y="${(y1 + 14).toFixed(1)}" text-anchor="end" font-size="11" fill="${C.blue}">理想区间 ${fY(o.band[0])}–${fY(o.band[1])}</text>`;
    }
  }
  if (o.vband) {
    const x1 = px(clamp(o.vband[0], xMin, xMax)), x2 = px(clamp(o.vband[1], xMin, xMax));
    s += `<rect x="${x1.toFixed(1)}" y="${m.t}" width="${Math.max(0, x2 - x1).toFixed(1)}" height="${(H - m.t - m.b).toFixed(1)}" fill="${C.ideal}" opacity=".45"/>`;
  }

  // 趋势线
  if (pts.length >= 3) {
    const r = linreg(pts);
    if (r) {
      const xs = pts.map(p => p.x), x1 = Math.min(...xs), x2 = Math.max(...xs);
      const y1 = clamp(r.k * x1 + r.b, yMin, yMax), y2 = clamp(r.k * x2 + r.b, yMin, yMax);
      s += `<line x1="${px(x1).toFixed(1)}" y1="${py(y1).toFixed(1)}" x2="${px(x2).toFixed(1)}" y2="${py(y2).toFixed(1)}" stroke="${C.brand2}" stroke-width="2" stroke-dasharray="7 5" opacity=".8"/>`;
      s += `<text x="${m.l + 8}" y="${m.t + 15}" font-size="11.5" fill="${C.brand2}">趋势 R²=${r.r2.toFixed(3)}　${r.k >= 0 ? '+' : ''}${r.k.toFixed(2)} / 单位</text>`;
    }
  }
  // 数据点
  pts.forEach(p => {
    const x = px(p.x), y = py(p.y);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.6" fill="${p.color || C.dot}" stroke="#fff" stroke-width="1.8" data-tip="${String(p.tip || '').replace(/"/g, '&quot;')}" style="cursor:pointer">`;
    s += `<title>${p.tip || ''}</title></circle>`;
    if (p.label) s += `<text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle" font-size="11" fill="${C.ink2}">${p.label}</text>`;
  });
  if (!pts.length) {
    s += `<text x="${W / 2}" y="${(H - m.b) / 2}" text-anchor="middle" font-size="13" fill="${C.muted}">暂无数据点，先记录实验或取消隐藏</text>`;
  }
  s += '</svg>';
  return s;
}

/* ---------------- SCA 冲煮控制图 ---------------- */
function controlChartSVG(dots, opts) {
  const W = 680, H = 540, m = { l: 74, r: 84, t: 54, b: 60 };
  const xMin = 14, xMax = 26, yMin = 0.80, yMax = 1.80;
  const IW = W - m.l - m.r, IH = H - m.t - m.b;
  const px = x => m.l + (x - xMin) / (xMax - xMin) * IW;
  const py = y => H - m.b - (y - yMin) / (yMax - yMin) * IH;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Coffee Brewing Control Chart">`;
  s += `<defs>
    <pattern id="ccgrid" width="7" height="7" patternUnits="userSpaceOnUse">
      <path d="M7 0H0V7" fill="none" stroke="#a9cbe4" stroke-width=".6" opacity=".75"/>
    </pattern>
    <clipPath id="ccclip"><rect x="${m.l}" y="${m.t}" width="${IW}" height="${IH}"/></clipPath>
  </defs>`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;

  // 细网格
  for (let e = xMin; e <= xMax + 1e-9; e += 1) {
    s += `<line x1="${px(e).toFixed(1)}" y1="${m.t}" x2="${px(e).toFixed(1)}" y2="${H - m.b}" stroke="${C.grid2}" stroke-width="1"/>`;
  }
  for (let t = yMin; t <= yMax + 1e-9; t += 0.05) {
    s += `<line x1="${m.l}" y1="${py(t).toFixed(1)}" x2="${W - m.r}" y2="${py(t).toFixed(1)}" stroke="${C.grid2}" stroke-width="1"/>`;
  }

  // 浓度偏高区域（参考图右上蓝色细网格块）
  s += `<rect x="${px(18).toFixed(1)}" y="${py(1.80).toFixed(1)}" width="${(px(22) - px(18)).toFixed(1)}" height="${(py(1.45) - py(1.80)).toFixed(1)}" fill="url(#ccgrid)"/>`;

  // 理想区域
  s += `<rect x="${px(18).toFixed(1)}" y="${py(1.45).toFixed(1)}" width="${(px(22) - px(18)).toFixed(1)}" height="${(py(1.15) - py(1.45)).toFixed(1)}" fill="${C.ideal}" opacity=".92"/>`;

  // 分区虚线
  [18, 22].forEach(e => {
    s += `<line x1="${px(e).toFixed(1)}" y1="${m.t}" x2="${px(e).toFixed(1)}" y2="${H - m.b}" stroke="${C.ink2}" stroke-width="1.1" stroke-dasharray="5 4" opacity=".75"/>`;
  });
  [1.15, 1.45].forEach(t => {
    s += `<line x1="${m.l}" y1="${py(t).toFixed(1)}" x2="${W - m.r}" y2="${py(t).toFixed(1)}" stroke="${C.ink2}" stroke-width="1.1" stroke-dasharray="5 4" opacity=".75"/>`;
  });
  s += `<rect x="${px(18).toFixed(1)}" y="${py(1.45).toFixed(1)}" width="${(px(22) - px(18)).toFixed(1)}" height="${(py(1.15) - py(1.45)).toFixed(1)}" fill="none" stroke="${C.blue}" stroke-width="2.4"/>`;

  // 粉水比对角线：TDS = EY / (R - 2)
  s += `<g clip-path="url(#ccclip)">`;
  for (let R = 12; R <= 22; R++) {
    const e1 = Math.max(xMin, yMin * (R - 2));
    const e2 = Math.min(xMax, yMax * (R - 2));
    if (e2 - e1 < 0.15) continue;
    const y1 = e1 / (R - 2), y2 = e2 / (R - 2);
    s += `<line x1="${px(e1).toFixed(1)}" y1="${py(y1).toFixed(1)}" x2="${px(e2).toFixed(1)}" y2="${py(y2).toFixed(1)}" stroke="${C.idealLine}" stroke-width="1.15" opacity=".9"/>`;
  }
  s += `</g>`;
  // 比例标签
  s += `<g font-size="11" fill="${C.blue}" font-weight="600">`;
  for (let R = 12; R <= 22; R++) {
    const eTop = yMax * (R - 2);
    if (eTop <= xMax && eTop >= xMin) {
      s += `<text x="${px(eTop).toFixed(1)}" y="${m.t - 7}" text-anchor="middle">1:${R}</text>`;
    } else if (eTop > xMax) {
      const t = xMax / (R - 2);
      if (t >= yMin && t <= yMax) s += `<text x="${W - m.r + 7}" y="${(py(t) + 3.5).toFixed(1)}" text-anchor="start">1:${R}</text>`;
    }
  }
  s += `</g>`;

  // 九分区标签
  const zones = [
    [16, 1.63, 'Strong &<tspan x="X" dy="12">Underextracted</tspan>', '高浓·低萃'],
    [20, 1.63, 'Strong', '偏高浓度·强度区'],
    [24, 1.63, 'Strong &<tspan x="X" dy="12">Overextracted</tspan>', '高浓·过萃'],
    [16, 1.30, 'Underextracted', '萃取不足'],
    [20, 1.30, 'IDEAL', '理想区域'],
    [24, 1.30, 'Overextracted', '过萃'],
    [16, 0.975, 'Weak &<tspan x="X" dy="12">Underextracted</tspan>', '淡·低萃'],
    [20, 0.975, 'Weak', '偏淡'],
    [24, 0.975, 'Weak &<tspan x="X" dy="12">Overextracted</tspan>', '淡·过萃']
  ];
  s += `<g text-anchor="middle">`;
  zones.forEach(([ex, ty, en, cn]) => {
    const x = px(ex).toFixed(1), y = (py(ty) - 6).toFixed(1);
    const en2 = en.replace(/X/g, x);
    s += `<text x="${x}" y="${y}" font-size="11.5" fill="${C.ink2}">${en2}</text>`;
    s += `<text x="${x}" y="${(parseFloat(y) + (en.indexOf('tspan') >= 0 ? 26 : 14)).toFixed(1)}" font-size="12" font-weight="700" fill="${C.brand}">${cn}</text>`;
  });
  s += `</g>`;

  // 坐标轴
  s += `<line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="${C.axis}" stroke-width="1.3"/>`;
  s += `<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="${C.axis}" stroke-width="1.3"/>`;
  s += `<g font-size="11.5" fill="${C.muted}">`;
  for (let e = xMin; e <= xMax + 1e-9; e += 1) {
    s += `<text x="${px(e).toFixed(1)}" y="${H - m.b + 15}" text-anchor="middle">${e}%</text>`;
  }
  for (let t = yMin; t <= yMax + 1e-9; t += 0.05) {
    s += `<text x="${m.l - 8}" y="${(py(t) + 3.5).toFixed(1)}" text-anchor="end">${t.toFixed(2)}%</text>`;
  }
  s += `</g>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 16}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${C.ink}">Extraction – Solubles Yield　萃取率 (%)</text>`;
  s += `<text transform="translate(16 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" font-weight="700" fill="${C.ink}">Strength – Solubles Concentration　TDS (%)</text>`;
  s += `<text x="${m.l}" y="26" font-size="13" font-weight="700" fill="${C.brand}">Coffee Brewing Control Chart</text>`;
  s += `<text x="${W - m.r}" y="26" text-anchor="end" font-size="11" fill="${C.muted}">对角线 = 粉水比 · 按「粉吸水 2 g/g」绘制</text>`;

  // 互动命中区（完全透明，只在 hover/tap 时高亮）：9 个分区 + 粉水比斜线
  if (opts && opts.interactive) {
    s += `<g class="cc-hits">`;
    const EB = { lo: [xMin, 18], mid: [18, 22], hi: [22, xMax] };
    const TB = { lo: [yMin, 1.15], mid: [1.15, 1.45], hi: [1.45, yMax] };
    ['hi', 'mid', 'lo'].forEach(t => ['lo', 'mid', 'hi'].forEach(e => {
      const x1 = px(EB[e][0]), x2 = px(EB[e][1]);
      const y1 = py(TB[t][1]), y2 = py(TB[t][0]);
      const key = (t === 'mid' && e === 'mid') ? 'ideal' : (t + '_' + e);
      s += `<rect class="zone-hit" data-zone="${key}" x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${(x2 - x1).toFixed(1)}" height="${(y2 - y1).toFixed(1)}" fill="#fff" fill-opacity="0" pointer-events="all"/>`;
    }));
    s += `<g clip-path="url(#ccclip)">`;
    for (let R = 12; R <= 22; R++) {
      const e1 = Math.max(xMin, yMin * (R - 2));
      const e2 = Math.min(xMax, yMax * (R - 2));
      if (e2 - e1 < 0.15) continue;
      const y1 = e1 / (R - 2), y2 = e2 / (R - 2);
      s += `<line class="diag-hit" data-ratio="${R}" x1="${px(e1).toFixed(1)}" y1="${py(y1).toFixed(1)}" x2="${px(e2).toFixed(1)}" y2="${py(y2).toFixed(1)}" stroke="#000" stroke-opacity="0" stroke-width="7" pointer-events="stroke"/>`;
    }
    s += `</g></g>`;
  }

  // 数据点
  (dots || []).filter(d => Number.isFinite(d.ey) && Number.isFinite(d.tds)).forEach(d => {
    const ec = d.ey / EY_CORR;
    const x = px(clamp(ec, xMin, xMax)), y = py(clamp(d.tds, yMin, yMax));
    const isSelf = d.self;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isSelf ? 7 : 5}" fill="${isSelf ? C.dot : C.teal}" stroke="#fff" stroke-width="2" data-tip="${String(d.tip || '').replace(/"/g, '&quot;')}" style="cursor:pointer">`;
    s += `<title>${d.tip || ''}</title></circle>`;
    if (d.label) s += `<text x="${(x + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="11.5" font-weight="700" fill="${isSelf ? C.dot : C.teal}">${d.label}</text>`;
  });

  s += '</svg>';
  return s;
}

/* ---------------- 实验记录数据 ---------------- */
const STORE_KEY = 'coffee-lab-records-v2';
// 升级存储键：旧键 v1 可能残留早期测试/内置数据，不再读取并顺手清掉，保证记录区从空白开始
try { localStorage.removeItem('coffee-lab-records-v1'); } catch (e) {}

let records = [];
let editingId = null;
let storageOK = true;

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    // 过滤掉旧版本存进来的 seed 记录：内置数据不再作为实验记录展示
    records = raw ? (JSON.parse(raw) || []).filter(r => !r.seed) : [];
  } catch (e) {
    // 某些浏览器在 file:// 下禁用 localStorage —— 退化为内存模式，功能照常
    storageOK = false;
    records = [];
    setTimeout(() => toast('当前环境不允许本地存储，记录只保留在本次打开期间；用网址访问可长期保存。', 5200), 800);
  }
}
function saveRecords() {
  if (!storageOK) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(records)); }
  catch (e) { storageOK = false; toast('保存失败：浏览器存储不可用'); }
}
const numOrNull = v => (Number.isFinite(v) ? v : null);
const val = v => (v === null || v === undefined || Number.isNaN(v) ? '' : v);

function recordDerived(r) {
  const p = r.powder, w = r.water;
  const beverage = Number.isFinite(r.beverage) && r.beverage > 0 ? r.beverage : (Number.isFinite(p) && Number.isFinite(w) ? w - p * ABS : NaN);
  const ratio = (Number.isFinite(p) && Number.isFinite(w) && p > 0) ? w / p : NaN;
  const solubles = (Number.isFinite(beverage) && Number.isFinite(r.tds)) ? beverage * r.tds / 100 : NaN;
  const eyCalc = (Number.isFinite(solubles) && Number.isFinite(p) && p > 0) ? solubles / p * 100 : NaN;
  const tdsCalc = (Number.isFinite(solubles) && Number.isFinite(beverage) && beverage > 0) ? solubles / beverage * 100 : NaN;
  return { beverage, ratio, solubles, eyCalc, tdsCalc };
}

/* ---------------- 导航 ---------------- */
const VIEWS = ['home', 'calc', 'records', 'charts', 'knowledge', 'control'];
function show(view, push = true) {
  if (!VIEWS.includes(view)) view = 'home';
  VIEWS.forEach(v => {
    const el = $('#view-' + v);
    if (el) el.classList.toggle('active', v === view);
  });
  $$('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  if (push && location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'charts') renderCharts();
  if (view === 'records') renderRecords();
}
document.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]');
  if (n) { e.preventDefault(); show(n.dataset.nav); }
  const t = e.target.closest('[data-tip]');
  if (t) {
    const tip = $('#chartTip') || (() => { const d = document.createElement('div'); d.id = 'chartTip'; d.className = 'chart-tip'; document.body.appendChild(d); return d; })();
    tip.textContent = t.getAttribute('data-tip');
    tip.hidden = false;
    const rect = t.getBoundingClientRect();
    tip.style.left = clamp(rect.left + rect.width / 2 - 110, 8, innerWidth - 228) + 'px';
    tip.style.top = clamp(rect.top - 8 - tip.offsetHeight, 8, innerHeight - 60) + 'px';
    clearTimeout(tip._tm);
    tip._tm = setTimeout(() => { tip.hidden = true; }, 4000);
  }
});
window.addEventListener('hashchange', () => show((location.hash || '#home').slice(1), false));

/* =====================================================================
   统一冲煮参数计算器（合并：计算器 + 反向 + 粉水比）
   字段：powder, water, ratio, tds, ey, liquid, substance, temp, grind, time
   说明：temp / grind / time 仅作实验记录参数，绝不参与浓度/萃取率计算。
   ===================================================================== */
const U_IDS = ['u-powder', 'u-water', 'u-tds', 'u-ey', 'u-ratio', 'u-temp', 'u-grind', 'u-time', 'u-seg'];
const U_CORE = ['powder', 'water', 'ratio', 'tds', 'ey'];
const CORE_ID = { powder: 'u-powder', water: 'u-water', ratio: 'u-ratio', tds: 'u-tds', ey: 'u-ey' };

/* 「用户真正填过的字段」集合。自动推导回填的值不算 given，
   否则改一个输入后，别的字段会拿上一次的旧推导值当已知，导致结果不一致。 */
const givenSet = new Set();
function markGiven(id, on) { if (on) givenSet.add(id); else givenSet.delete(id); }

/* 总注水量「锁定」状态：一旦由「粉量+浓度+萃取率」推导出来，就视为"已注水"而锁定，
   之后用户改浓度/萃取率时它保持不变、只重算另一个；用户手动改/清空水量才解除锁定。 */
let waterLocked = false;
/* 最近一次编辑的核心字段：确认时据此决定重算哪一个，避免无编辑的重复确认误改数值。 */
let pendingEdit = null;

function getU() {
  const o = {};
  U_IDS.forEach(id => { o[id.slice(2)] = num('#' + id); });
  return o;
}
/** 采集「仅用户填过的核心字段」作为求解输入，其余置 NaN 交给求解器推导。 */
function getGiven() {
  const o = {};
  U_CORE.forEach(k => {
    const el = document.getElementById(CORE_ID[k]);
    const v = el ? el.value.trim() : '';
    o[k] = (givenSet.has(CORE_ID[k]) && v !== '' && Number.isFinite(Number(v))) ? Number(v) : NaN;
  });
  o.temp = num('#u-temp'); o.grind = num('#u-grind'); o.time = num('#u-time'); o.seg = num('#u-seg');

  const wScreen = num('#u-water');
  if (waterLocked && Number.isFinite(wScreen)) {
    // 总注水量已锁定（已注水）：它不再被反推；编辑浓度/萃取率时只重算另一个，水量保持不变。
    o.water = wScreen;
    if (pendingEdit === 'u-tds' || pendingEdit === 'u-powder') o.ey = NaN;   // 重算萃取率
    else if (pendingEdit === 'u-ey') o.tds = NaN;                            // 重算浓度
    // 其它情况（无编辑 / 编辑非核心字段）不强制，保持已算结果
  } else {
    // 计划模式：总注水量为空时，才由「粉量 + 浓度 + 萃取率」推导（浓度/萃取率优先级高于水量）。
    if (Number.isFinite(o.powder) && Number.isFinite(o.tds) && Number.isFinite(o.ey)) {
      o.water = NaN; o.ratio = NaN;
    }
  }
  return o;
}
/* 各字段显示精度（小数位） */
const DP = { powder: 1, water: 1, ratio: 1, tds: 2, ey: 2 };
/** 把求解结果写回表单（跳过正在编辑的字段，避免光标跳动）。
 *  可推导的字段自动填入并标记 .solved（绿色高亮＝自动算出）；算不出的清空。 */
function setU(id, v) {
  const el = document.getElementById(id);
  if (!el || el === document.activeElement) return;
  const ok = Number.isFinite(v);
  const s = ok ? trim(v, DP[id.slice(2)] ?? 2) : '';
  if (el.value !== s) el.value = s;
  el.classList.toggle('solved', ok);
}
/** 推导值（只读）写回：填入但不标绿，保持「推导」灰底样式 */
function setDerived(id, v) {
  const el = document.getElementById(id);
  if (!el || el === document.activeElement) return;
  const s = Number.isFinite(v) ? trim(v, DP[id.slice(2)] ?? 2) : '';
  if (el.value !== s) el.value = s;
}

/**
 * 定点迭代求解：已知任意组合 → 推出其余。
 * 仅 powder/water/ratio/tds/ey/liquid/substance 参与；temp/grind/time 原样透传。
 */
function solveU(o) {
  let P = o.powder, W = o.water, R = o.ratio, T = o.tds, E = o.ey, L = o.liquid, S = o.substance;
  const given = {};
  U_CORE.forEach(k => { if (Number.isFinite(o[k])) given[k] = o[k]; });

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    if (Number.isFinite(P) && Number.isFinite(W) && !Number.isFinite(L)) { L = W - P * ABS; changed = true; }
    if (Number.isFinite(P) && Number.isFinite(L) && !Number.isFinite(W)) { W = L + P * ABS; changed = true; }
    if (Number.isFinite(P) && Number.isFinite(R) && R > 0 && !Number.isFinite(W)) { W = P * R; changed = true; }
    if (Number.isFinite(W) && Number.isFinite(R) && R > 0 && !Number.isFinite(P)) { P = W / R; changed = true; }
    if (Number.isFinite(P) && Number.isFinite(W) && P > 0 && !Number.isFinite(R)) { R = W / P; changed = true; }
    if (Number.isFinite(L) && Number.isFinite(T) && T > 0 && !Number.isFinite(S)) { S = L * T / 100; changed = true; }
    if (Number.isFinite(P) && Number.isFinite(E) && E > 0 && !Number.isFinite(S)) { S = P * E / 100; changed = true; }
    if (Number.isFinite(S) && Number.isFinite(L) && L > 0 && !Number.isFinite(T)) { T = S / L * 100; changed = true; }
    if (Number.isFinite(S) && Number.isFinite(P) && P > 0 && !Number.isFinite(E)) { E = S / P * 100; changed = true; }
    if (Number.isFinite(S) && Number.isFinite(T) && T > 0 && !Number.isFinite(L)) { L = S * 100 / T; changed = true; }
    if (Number.isFinite(S) && Number.isFinite(E) && E > 0 && !Number.isFinite(P)) { P = S * 100 / E; changed = true; }
    if (!changed) break;
  }

  const absorbed = Number.isFinite(P) ? P * ABS : NaN;
  const realAbsorbed = (Number.isFinite(P) && Number.isFinite(W) && Number.isFinite(L)) ? (W - L) / P : NaN;
  const plRatio = (Number.isFinite(P) && Number.isFinite(L)) ? L / P : NaN;
  const recover = (Number.isFinite(W) && Number.isFinite(L) && W > 0) ? L / W * 100 : NaN;
  return { powder: P, water: W, ratio: R, tds: T, ey: E, liquid: L, substance: S,
           absorbed, realAbsorbed, plRatio, recover, temp: o.temp, grind: o.grind, time: o.time, given };
}

/** 清空上一次的推导结果（默认不动用户填过的字段），让界面回到「只显示已知」的状态。
 *  includeGiven=true 时连已知字段一起清空（用于「清除」按钮）。 */
function clearDerived(includeGiven) {
  U_CORE.forEach(k => {
    const id = CORE_ID[k];
    if (!includeGiven && givenSet.has(id)) return;
    if (id === 'u-water' && waterLocked) return;   // 锁定的总注水量不随其它输入被擦除
    const el = document.getElementById(id);
    if (!el || el === document.activeElement) return;
    el.value = '';
    el.classList.remove('solved');
  });
  ['u-plratio'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  $('#u-judge').innerHTML = '';
  $('#calc-control').innerHTML = controlChartSVG([]);
  const w = $('#u-warn'); if (w) w.hidden = true;
}
/** 状态行：只反映「当前已知什么」，不做任何推导。 */
function updateModeTag() {
  const el = $('#u-mode');
  if (!el) return;
  const NAMES = { powder: '粉量', water: '注水量', ratio: '粉水比', tds: 'TDS', ey: '萃取率' };
  const known = U_CORE.filter(k => givenSet.has(CORE_ID[k])).map(k => NAMES[k]);
  if (!known.length) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.className = 'mode-tag';
  el.textContent = '已知：' + known.join('、') + '　→　点「确认」推导其余数值';
}

function calcView() {
  const o = getGiven();
  pendingEdit = null;   // 已消费本次编辑意图
  const r = solveU(o);
  // 总注水量若被算出来（非用户手填），标记为锁定：之后改浓度/萃取率不再反推水量
  waterLocked = Number.isFinite(r.water) && !givenSet.has('u-water');
  const warn = $('#u-warn');
  const modeEl = $('#u-mode');
  const coreMap = CORE_ID;

  // 边界 / 一致性检查
  let warnMsg = '', warnCls = '';
  const insufficient = !(r.powder > 0 && (r.water > 0 || r.ratio > 0) && (r.tds > 0 || r.ey > 0 || r.substance > 0));
  if (r.powder > 0 && r.water > 0 && r.water <= r.powder * ABS && !(r.liquid > 0)) {
    warnCls = 'bad';
    warnMsg = `总注水量 ${trim(r.water, 1)} g 不大于粉量吸水 ${trim(r.powder * ABS, 1)} g（${trim(r.powder, 1)} g 粉 × 2），按公式咖啡液量为 ${fmt(r.water - r.powder * ABS, 1)} g，无法得出有意义的结果。请加大注水量，或填入实测咖啡液量。`;
  } else if (Number.isFinite(r.realAbsorbed) && Math.abs(r.realAbsorbed - ABS) > 0.06) {
    warnCls = 'ok';
    warnMsg = `按实测液量 ${trim(r.liquid, 1)} g 反推：本次吸水量约 ${fmt(r.realAbsorbed, 2)} g/g（默认公式为 2.00 g/g），液量与咖啡物质按实测值计算。`;
  } else if (r.powder > 0 && r.water > 0 && r.ratio > 0 && Math.abs(r.water / r.powder - r.ratio) > 0.06) {
    warnCls = 'ok';
    warnMsg = `你填的粉水比 1:${trim(r.ratio, 1)} 与「注水量 ÷ 粉量」算出的 1:${trim(r.water / r.powder, 1)} 不一致，已按注水量与粉量重新计算。`;
  }
  if (warnMsg) { warn.hidden = false; warn.className = 'alert ' + warnCls; warn.innerHTML = warnMsg; }
  else warn.hidden = true;

  // 不足：清空所有推导值，提示需补充
  if (insufficient) {
    modeEl.hidden = true; modeEl.textContent = '';
    toast('已知条件不足，暂时推不出结果');
    Object.keys(coreMap).forEach(k => { const el = document.getElementById(coreMap[k]); if (el) el.classList.remove('solved'); });
    ['u-plratio'].forEach(id => { const el = document.getElementById(id); if (el) { el.value = ''; el.classList.remove('solved'); } });
    $('#u-judge').innerHTML = '';
    $('#calc-control').innerHTML = controlChartSVG([]);
    return;
  }

  // 已知 / 自动推算 状态行
  const names = { powder: '粉量', water: '注水量', ratio: '粉水比', tds: 'TDS', ey: '萃取率' };
  const known = U_CORE.filter(k => r.given[k] !== undefined).map(k => names[k]);
  const derived = U_CORE.filter(k => r.given[k] === undefined && Number.isFinite(r[k])).map(k => names[k]);
  modeEl.className = 'mode-tag';
  modeEl.textContent = '已知：' + (known.length ? known.join('、') : '—') + '　→　已推导：' + (derived.length ? derived.join('、') : '（暂不足）');

  // 写回：核心字段里「用户填的」保持不动，「可推导的」自动填入并标绿
  Object.keys(coreMap).forEach(k => {
    const el = document.getElementById(coreMap[k]);
    if (!el) return;
    if (r.given[k] !== undefined) el.classList.remove('solved');
    else setU(coreMap[k], r[k]);
  });
  // 推导值（只读）就地显示
  const plEl = document.getElementById('u-plratio');
  if (plEl && plEl !== document.activeElement) {
    const txt = Number.isFinite(r.plRatio) ? ratioText(r.plRatio) : '';
    if (plEl.value !== txt) plEl.value = txt;
  }
  const p = r.powder, w = r.water, t = r.tds, e = r.ey;
  $('#u-judge').innerHTML = judgeHTML(t, e / EY_CORR);
  $('#calc-control').innerHTML = controlChartSVG([{
    ey: e, tds: t, self: true, label: '本次',
    tip: `${trim(p, 1)}g 粉 / ${Number.isFinite(w) ? trim(w, 1) : '?'}g 水｜TDS ${Number.isFinite(t) ? trim(t, 2) + '%' : '—'}｜萃取率 ${Number.isFinite(e) ? fmt(e, 2) + '%' : '—'}（图上 ${Number.isFinite(e) ? fmt(e / EY_CORR, 2) + '%' : '—'}）｜粉水比 ${ratioText(r.ratio)}`
  }]);
}

U_IDS.forEach(id => {
  const el = $('#' + id);
  if (!el) return;
  // 输入时只记录「这个字段是用户填的」，不推导；改了已知值就把上一次的推导结果清掉
  el.addEventListener('input', () => {
    const v = el.value.trim();
    markGiven(id, v !== '' && Number.isFinite(Number(v)));
    if (id === 'u-water') waterLocked = false;   // 手动改/清空水量 → 解除锁定（回到计划模式）
    pendingEdit = id;
    clearDerived();
    updateModeTag();
  });
});
$('#u-calc').addEventListener('click', () => calcView());
$('#u-reset').addEventListener('click', () => {
  U_IDS.forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
  givenSet.clear();
  waterLocked = false; pendingEdit = null;
  clearDerived(true);
  updateModeTag();
  toast('已清除全部数值');
});
$('#u-save').addEventListener('click', () => {
  const o = getU();
  const r = solveU(o);
  if (!(r.powder > 0 && r.water > 0)) { toast('至少需要填写咖啡粉量与总注水量'); return; }
  if (!(r.tds > 0 || r.ey > 0)) { toast('请至少填写 TDS 或萃取率之一，再保存'); return; }
  openModal(null, {
    powder: r.powder, water: r.water,
    temp: Number.isFinite(r.temp) ? r.temp : null,
    grind: Number.isFinite(r.grind) ? r.grind : null,
    time: Number.isFinite(r.time) ? r.time : null,
    seg: Number.isFinite(r.seg) ? r.seg : null,
    tds: Number.isFinite(r.tds) ? +r.tds.toFixed(2) : null,
    ey: Number.isFinite(r.ey) ? +r.ey.toFixed(2) : null,
    beverage: Number.isFinite(r.liquid) ? +r.liquid.toFixed(1) : null,
    substance: Number.isFinite(r.substance) ? +r.substance.toFixed(2) : null
  });
});

/* ---------------- 实验记录渲染 ---------------- */
function passFilter(r, f) {
  if (f.kw) {
    const hay = [r.bean, r.sensory, r.note, r.conclusion, r.roast, r.waterType, r.stirStyle].join(' ').toLowerCase();
    if (!hay.includes(f.kw)) return false;
  }
  const inRange = (v, a, b) => {
    if (!Number.isFinite(v)) return !(Number.isFinite(a) || Number.isFinite(b));
    if (Number.isFinite(a) && v < a) return false;
    if (Number.isFinite(b) && v > b) return false;
    return true;
  };
  const d = recordDerived(r);
  if (!inRange(r.temp, f.tempMin, f.tempMax)) return false;
  if (!inRange(d.ratio, f.ratioMin, f.ratioMax)) return false;
  if (!inRange(r.grind, f.grindMin, f.grindMax)) return false;
  if (f.water && r.waterType !== f.water) return false;
  if (f.time) {
    if (!Number.isFinite(r.time)) return false;
    if (f.time === 'lt3' && !(r.time < 3)) return false;
    if (f.time === '3to4' && !(r.time >= 3 && r.time <= 4)) return false;
    if (f.time === 'gt4' && !(r.time > 4)) return false;
  }
  return true;
}
function renderRecords() {
  compareSet = compareSet.filter(id => records.some(x => x.id === id));
  const f = {
    kw: ($('#f-kw').value || '').trim().toLowerCase(),
    tempMin: num('#f-temp-min'), tempMax: num('#f-temp-max'),
    ratioMin: num('#f-ratio-min'), ratioMax: num('#f-ratio-max'),
    grindMin: num('#f-grind-min'), grindMax: num('#f-grind-max'),
    water: $('#f-water').value, time: $('#f-time').value, sort: $('#f-sort').value
  };
  let list = records.filter(r => passFilter(r, f));
  const s = f.sort;
  list.sort((a, b) => {
    if (s === 'date-asc') return String(a.date || '').localeCompare(String(b.date || ''));
    if (s === 'ey-desc') return (b.ey || -1) - (a.ey || -1);
    if (s === 'tds-desc') return (b.tds || -1) - (a.tds || -1);
    if (s === 'temp-desc') return (b.temp || -1) - (a.temp || -1);
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  $('#rec-count').textContent = `共 ${records.length} 条，当前显示 ${list.length} 条`;
  const box = $('#rec-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty">没有符合条件的记录。${records.length ? '试试重置筛选条件。' : '点「+ 新增记录」开始，或到「冲煮参数计算器」算完点「保存为实验记录」带过来。'}</div>`;
    return;
  }
  box.className = 'rec-wrap';
  box.innerHTML = list.map(r => {
    const d = recordDerived(r);
    const z = zoneOf(r.tds, r.ey / EY_CORR);
    const tags = [
      r.temp ? `🌡 ${trim(r.temp, 1)}℃` : '', r.time ? `⏱ ${trim(r.time, 2)} min` : '',
      Number.isFinite(r.grind) ? `⚙ 研磨 ${trim(r.grind, 1)}` : '', Number.isFinite(r.seg) ? `🥤 ${trim(r.seg, 0)} 段` : '', d.ratio ? `💧 ${ratioText(d.ratio)}` : '',
      r.waterType ? `🚰 ${r.waterType}` : '', r.stir === 'yes' ? `🥄 搅拌${r.stirCount ? ' ×' + r.stirCount : ''}` : '',
      r.roast ? `🔥 ${r.roast}` : ''
    ].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    return `<article class="rec">
      <div class="rec-top">
        <b>${r.bean || '未命名实验'}</b>
        <span class="rec-date">${r.date || ''}</span>
      </div>
      <div class="rec-nums">
        <div><span>粉 / 水</span><b>${trim(r.powder, 1)}/${trim(r.water, 0)}</b></div>
        <div><span>液量</span><b>${fmt(d.beverage, 0)}</b></div>
        <div><span>TDS</span><b>${Number.isFinite(r.tds) ? trim(r.tds, 2) : '—'}</b></div>
        <div><span>萃取率</span><b>${Number.isFinite(r.ey) ? trim(r.ey, 1) : '—'}</b></div>
      </div>
      <div class="rec-tags">${tags}</div>
      ${z ? `<div class="rec-tags"><span class="tag tds">${z.name}</span></div>` : ''}
      ${r.sensory ? `<p class="rec-sensory">「${r.sensory}」</p>` : ''}
      ${r.conclusion ? `<p class="tiny">结论：${r.conclusion}</p>` : ''}
      ${r.note ? `<p class="tiny">备注：${r.note}</p>` : ''}
      <div class="rec-acts">
        <button class="link-btn" data-edit="${r.id}">编辑</button>
        <button class="link-btn" data-copy="${r.id}">复制为新实验</button>
        <button class="link-btn${compareSet.includes(r.id) ? ' on' : ''}" data-cmp="${r.id}">${compareSet.includes(r.id) ? '取消对比' : '对比'}</button>
        <button class="link-btn del" data-del="${r.id}">删除</button>
      </div>
    </article>`;
  }).join('');
  renderCompare();
}
$('#rec-list').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'), cp = e.target.closest('[data-copy]'), dl = e.target.closest('[data-del]'), cm = e.target.closest('[data-cmp]');
  if (ed) openModal(ed.dataset.edit);
  else if (cm) toggleCompare(cm.dataset.cmp);
  else if (cp) {
    const r = records.find(x => x.id === cp.dataset.copy);
    if (r) openModal(null, Object.assign({}, r, { id: null, date: new Date().toISOString().slice(0, 10) }));
  } else if (dl) {
    const r = records.find(x => x.id === dl.dataset.del);
    if (r && confirm(`删除「${r.bean || '这条记录'}」？删除后无法恢复。`)) {
      records = records.filter(x => x.id !== r.id);
      saveRecords(); renderRecords(); renderCharts(); toast('已删除');
    }
  }
});
$$('#view-records .filters input, #view-records .filters select').forEach(el => {
  el.addEventListener('input', renderRecords);
  el.addEventListener('change', renderRecords);
});
$('#f-reset').addEventListener('click', () => {
  ['#f-kw', '#f-temp-min', '#f-temp-max', '#f-ratio-min', '#f-ratio-max', '#f-grind-min', '#f-grind-max'].forEach(i => $(i).value = '');
  $('#f-water').value = ''; $('#f-time').value = ''; $('#f-sort').value = 'date-desc';
  renderRecords();
});
$('#rec-add').addEventListener('click', () => openModal(null));
$('#rec-export').addEventListener('click', openExport);
$('#rec-paste').addEventListener('click', () => {
  $('#io-import-text').value = '';
  $('#io-import-modal').hidden = false;
  document.body.style.overflow = 'hidden';
});
$('#rec-import').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const parsed = JSON.parse(fr.result);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const r = mergeImported(arr);
      saveRecords(); renderRecords(); renderCharts();
      toast(`已导入：新增 ${r.added} 条、更新 ${r.updated} 条`);
    } catch (err) { toast('导入失败：文件格式不正确'); }
  };
  fr.readAsText(file);
  e.target.value = '';
});
$('#io-copy').addEventListener('click', () => copyText($('#io-export-text').value));
$('#io-download').addEventListener('click', () => {
  const blob = new Blob([$('#io-export-text').value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `coffee-lab-records-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已尝试下载文件');
});
$('#io-import-go').addEventListener('click', () => {
  const raw = ($('#io-import-text').value || '').trim();
  if (!raw) { toast('请先粘贴 JSON 文本'); return; }
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const r = mergeImported(arr);
    saveRecords(); renderRecords(); renderCharts();
    $('#io-import-modal').hidden = true;
    $('#io-import-text').value = '';
    document.body.style.overflow = '';
    toast(`已导入：新增 ${r.added} 条、更新 ${r.updated} 条`);
  } catch (e) { toast('导入失败：不是合法的 JSON'); }
});
// 关闭两个 IO 弹窗
['#io-export-modal', '#io-import-modal'].forEach(sel => {
  $(sel).querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => {
    $(sel).hidden = true; document.body.style.overflow = '';
  }));
});
function openExport() {
  $('#io-export-text').value = JSON.stringify(records, null, 2);
  $('#io-export-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
// 导出 Excel 可读表格：纯前端零依赖，生成带 UTF-8 BOM 的 .csv（Excel 直接打开、中文不乱码）
function toCSV() {
  const cols = [
    ['date', '日期'], ['bean', '豆名'], ['roast', '烘焙度'], ['powder', '粉量(g)'], ['water', '注水量(g)'],
    ['temp', '水温(℃)'], ['time', '时间(min)'], ['grind', '研磨度'], ['seg', '段数'],
    ['first', '第一段水量(g)'], ['firstTime', '第一段用时(s)'], ['stir', '搅拌'], ['stirCount', '搅拌次数'], ['stirStyle', '搅拌方式'],
    ['waterType', '水质'], ['tds', 'TDS(%)'], ['ey', '萃取率(%)'], ['ratio', '粉水比'], ['beverage', '实测液量(g)'], ['substance', '咖啡物质(g)'],
    ['sensory', '感官'], ['conclusion', '结论'], ['note', '备注']
  ];
  const esc = v => { if (v === null || v === undefined) v = ''; v = String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [cols.map(c => c[1]).join(',')];
  records.forEach(r => {
    const d = recordDerived(r);
    lines.push(cols.map(([k]) => {
      if (k === 'ratio') return Number.isFinite(d.ratio) ? ratioText(d.ratio) : '';
      if (k === 'beverage') return Number.isFinite(r.beverage) ? fmt(r.beverage, 0) : (Number.isFinite(d.beverage) ? fmt(d.beverage, 0) : '');
      return r[k];
    }).map(esc).join(','));
  });
  return '﻿' + lines.join('\r\n');
}
$('#rec-excel').addEventListener('click', () => {
  if (!records.length) { toast('当前没有记录'); return; }
  const blob = new Blob([toCSV()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `coffee-lab-records-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出 Excel 表格（.csv，Excel 可直接打开）');
});
// 按 id 合并导入：同 id 更新、新 id 追加，避免重复导入产生副本
function mergeImported(arr) {
  if (!Array.isArray(arr)) throw new Error('格式应为 JSON 数组');
  const byId = new Map(records.map(r => [r.id, r]));
  let added = 0, updated = 0;
  arr.forEach(x => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return;
    const clean = Object.assign({}, x); delete clean.seed;
    let id = clean.id;
    if (id && byId.has(id)) {
      byId.set(id, Object.assign({}, byId.get(id), clean, { id })); updated++;
    } else {
      if (!id || typeof id !== 'string') id = 'imp-' + Math.random().toString(36).slice(2, 9);
      while (byId.has(id)) id = 'imp-' + Math.random().toString(36).slice(2, 9);
      byId.set(id, Object.assign({}, clean, { id })); added++;
    }
  });
  records = Array.from(byId.values());
  return { added, updated };
}
async function copyText(str) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(str);
      toast('已复制，可粘到微信「文件传输助手」');
      return;
    }
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = str; ta.style.position = 'fixed'; ta.style.top = '-9999px';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); toast('已复制'); }
  catch (e) { toast('复制失败，请手动长按文本框全选复制'); }
  document.body.removeChild(ta);
}
$('#rec-clear').addEventListener('click', () => {
  if (!records.length) { toast('当前没有记录'); return; }
  if (!confirm(`清空全部 ${records.length} 条记录？建议先导出 JSON 备份。此操作不可恢复。`)) return;
  records = []; saveRecords(); renderRecords(); renderCharts(); toast('已清空');
});

/* ---------------- 实验对比 ---------------- */
const CMP_MAX = 3;
let compareSet = [];
function toggleCompare(id) {
  const i = compareSet.indexOf(id);
  if (i >= 0) compareSet.splice(i, 1);
  else {
    if (compareSet.length >= CMP_MAX) { toast(`最多同时对比 ${CMP_MAX} 条`); return; }
    compareSet.push(id);
  }
  renderRecords();
}
function renderCompare() {
  const box = $('#cmp-panel');
  if (!box) return;
  const picked = compareSet.map(id => records.find(r => r.id === id)).filter(Boolean);
  if (!picked.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  if (picked.length < 2) {
    box.innerHTML = `<div class="cmp-hint">已选 1 条，再选 1 条即可对比（最多 ${CMP_MAX} 条）。</div>`;
    return;
  }
  const rows = [
    ['日期', r => r.date || '—'],
    ['咖啡豆', r => r.bean || '—'],
    ['烘焙度', r => r.roast || '—'],
    ['粉量 (g)', r => Number.isFinite(r.powder) ? trim(r.powder, 1) : '—'],
    ['注水量 (g)', r => Number.isFinite(r.water) ? trim(r.water, 0) : '—'],
    ['粉水比', r => ratioText(recordDerived(r).ratio)],
    ['水温 (℃)', r => Number.isFinite(r.temp) ? trim(r.temp, 1) : '—'],
    ['研磨度', r => Number.isFinite(r.grind) ? trim(r.grind, 1) : '—'],
    ['时间 (min)', r => Number.isFinite(r.time) ? trim(r.time, 2) : '—'],
    ['TDS (%)', r => Number.isFinite(r.tds) ? trim(r.tds, 2) : '—'],
    ['萃取率 (%)', r => Number.isFinite(r.ey) ? trim(r.ey, 1) : '—'],
    ['液量 (g)', r => fmt(recordDerived(r).beverage, 0)],
    ['咖啡物质 (g)', r => fmt(recordDerived(r).solubles, 2)],
    ['判定', r => (zoneOf(r.tds, r.ey) || {}).name || '—']
  ];
  const head = picked.map(r => `<th>${r.bean || '未命名'}<i>${r.date || ''}</i></th>`).join('');
  const body = rows.map(([label, fn]) =>
    `<tr><th>${label}</th>${picked.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`).join('');
  box.innerHTML = `
    <div class="cmp-head"><b>实验对比（${picked.length} 条）</b><button class="link-btn" id="cmp-clear">清除对比</button></div>
    <div class="table-scroll"><table class="tbl cmp"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  const cl = $('#cmp-clear');
  if (cl) cl.addEventListener('click', () => { compareSet = []; renderRecords(); });
}

/* ---------------- 记录编辑弹窗 ---------------- */
const MODAL_FIELDS = [
  ['date', 'm-date'], ['bean', 'm-bean'], ['roast', 'm-roast'],
  ['powder', 'm-powder'], ['water', 'm-water'], ['temp', 'm-temp'],
  ['time', 'm-time'], ['grind', 'm-grind'], ['seg', 'm-seg'],
  ['first', 'm-first'], ['firstTime', 'm-firsttime'],
  ['stir', 'm-stir'], ['stirCount', 'm-stircount'], ['stirStyle', 'm-stirstyle'],
  ['waterType', 'm-watertype'], ['tds', 'm-tds'], ['ey', 'm-ey'], ['beverage', 'm-beverage'], ['substance', 'm-substance'],
  ['sensory', 'm-sensory'], ['conclusion', 'm-conclusion'], ['note', 'm-note']
];
const FIELD_EL = Object.fromEntries(MODAL_FIELDS.map(([k, id]) => [k, '#' + id]));

function openModal(id, preset) {
  editingId = id;
  const r = id ? records.find(x => x.id === id) : Object.assign({ date: new Date().toISOString().slice(0, 10) }, preset || {});
  if (!r) return;
  MODAL_FIELDS.forEach(([k, elId]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const v = r[k];
    el.value = (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)))
      ? (k === 'stir' ? 'no' : '') : v;
  });
  $('#modal-title').textContent = id ? '编辑实验记录' : '新增实验记录';
  $('#m-delete').hidden = !id;
  modalRecalc();
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true;
  document.body.style.overflow = '';
  editingId = null;
}
function modalRecalc() {
  const p = num('#m-powder'), w = num('#m-water'), tds = num('#m-tds'), ey = num('#m-ey'), bevIn = num('#m-beverage');
  const box = $('#m-recalc');
  const has = Number.isFinite(p) && p > 0 && Number.isFinite(w) && w > 0;
  if (!has) { box.innerHTML = '填入「咖啡粉量 + 总注水量」后，这里会显示公式回算结果。'; return; }
  const d = recordDerived({ powder: p, water: w, tds: Number.isFinite(tds) ? tds : NaN, ey: Number.isFinite(ey) ? ey : NaN, beverage: bevIn });
  const parts = [];
  parts.push(`公式液量 <b>${fmt(w - p * ABS, 1)} g</b>（${trim(p, 1)} g 粉 × 2 g 吸水）`);
  if (Number.isFinite(bevIn) && bevIn > 0) parts.push(`实测液量 <b>${fmt(bevIn, 1)} g</b> → 实际吸水 <b>${fmt((w - bevIn) / p, 2)} g/g</b>`);
  if (Number.isFinite(tds)) {
    parts.push(`按 TDS ${trim(tds, 2)}% 回算萃取率 <b>${fmt(d.eyCalc, 2)}%</b>${Number.isFinite(ey) ? `（你记录的是 ${trim(ey, 1)}%）` : ''}`);
  }
  if (Number.isFinite(ey) && !Number.isFinite(tds)) {
    const sol = p * ey / 100;
    const bev = Number.isFinite(bevIn) && bevIn > 0 ? bevIn : w - p * ABS;
    parts.push(`按萃取率 ${trim(ey, 1)}% 回算 TDS <b>${fmt(bev > 0 ? sol / bev * 100 : NaN, 2)}%</b>`);
  }
  if (Number.isFinite(d.solubles)) parts.push(`咖啡物质 <b>${fmt(d.solubles, 2)} g</b>（液量 × TDS%）`);
  const z = zoneOf(Number.isFinite(tds) ? tds : d.tdsCalc, (Number.isFinite(ey) ? ey : d.eyCalc) / EY_CORR);
  if (z) parts.push(`判定：<b>${z.name}</b>`);
  box.innerHTML = parts.join('<br>');
}
['m-powder', 'm-water', 'm-tds', 'm-ey', 'm-beverage'].forEach(id => $('#' + id).addEventListener('input', modalRecalc));
$$('#modal [data-close]').forEach(el => el.addEventListener('click', closeModal));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) closeModal();
  else if (!$('#io-export-modal').hidden) { $('#io-export-modal').hidden = true; document.body.style.overflow = ''; }
  else if (!$('#io-import-modal').hidden) { $('#io-import-modal').hidden = true; document.body.style.overflow = ''; }
});
$('#m-save').addEventListener('click', () => {
  const o = {};
  MODAL_FIELDS.forEach(([k, elId]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (k === 'stir') { o[k] = el.value; return; }
    if (el.type === 'number') { const v = parseFloat(el.value); o[k] = Number.isFinite(v) ? v : NaN; }
    else o[k] = el.value.trim();
  });
  if (!(o.powder > 0) || !(o.water > 0)) { toast('至少需要填写咖啡粉量与总注水量'); return; }
  o.seed = false;
  if (editingId) {
    const i = records.findIndex(x => x.id === editingId);
    records[i] = Object.assign({}, records[i], o, { id: editingId });
    toast('已更新');
  } else {
    o.id = 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    records.push(o);
    toast('已保存');
  }
  saveRecords(); closeModal(); renderRecords(); renderCharts();
});
$('#m-delete').addEventListener('click', () => {
  const r = records.find(x => x.id === editingId);
  if (!r) return;
  if (!confirm('删除这条记录？删除后无法恢复。')) return;
  records = records.filter(x => x.id !== editingId);
  saveRecords(); closeModal(); renderRecords(); renderCharts(); toast('已删除');
});

/* ---------------- 图表渲染 ---------------- */
function chartData() {
  // 只用自己的实验记录——内置数据已完全移到「咖啡知识」，分析与记录里都不再出现
  return records.map(r => {
    const d = recordDerived(r);
    return {
      seed: !!r.seed,
      label: r.bean || r.conclusion || '未命名实验',
      tag: `${r.date || ''}｜${trim(r.powder, 1)}g 粉 / ${trim(r.water, 0)}g 水`,
      temp: r.temp, time: r.time, grind: r.grind, ratio: d.ratio, tds: r.tds, ey: r.ey
    };
  });
}
function renderCharts() {
  const data = chartData();
  const ce = $('#chart-empty');
  if (ce) ce.hidden = records.length > 0;
  const mk = (sel, xKey, yKey, xLabel, yLabel, opts = {}) => {
    const pts = data.filter(d => Number.isFinite(d[xKey]) && Number.isFinite(d[yKey])).map(d => ({
      x: d[xKey], y: d[yKey],
      color: d.seed ? C.teal : C.dot,
      tip: `${d.label}　${d.seed ? '内置数据' : '我的记录'}　${d.tag}\nTDS ${Number.isFinite(d.tds) ? trim(d.tds, 2) + '%' : '—'}｜萃取率 ${Number.isFinite(d.ey) ? trim(d.ey, 2) + '%' : '—'}\n${(zoneOf(d.tds, d.ey) || {}).name || ''}`
    }));
    const el2 = $(sel);
    if (!el2) return;
    el2.innerHTML = scatterSVG({
      points: pts,
      xDomain: opts.xDomain || domain(pts.map(p => p.x)),
      yDomain: opts.yDomain || domain(pts.map(p => p.y), 0.18),
      xLabel, yLabel,
      fmtX: opts.fmtX, fmtY: opts.fmtY,
      band: opts.band, vband: opts.vband,
      aria: xLabel + ' vs ' + yLabel
    });
  };
  const f1 = v => trim(v, 0) + '℃';
  const f2 = v => trim(v, 2) + '%';
  mk('#ch1', 'temp', 'ey', '水温 (℃)', '萃取率 (%)', { fmtX: f1, fmtY: f2, band: IDEAL_EY });
  mk('#ch2', 'temp', 'tds', '水温 (℃)', 'TDS (%)', { fmtX: f1, fmtY: f2, band: IDEAL_TDS });
  mk('#ch3', 'ratio', 'tds', '粉水比（1:N 的 N）', 'TDS (%)', { fmtX: v => trim(v, 0), fmtY: f2, band: IDEAL_TDS });
  mk('#ch4', 'ratio', 'ey', '粉水比（1:N 的 N）', '萃取率 (%)', { fmtX: v => trim(v, 0), fmtY: f2, band: IDEAL_EY });
  mk('#ch5', 'grind', 'ey', '研磨度（数值越小越细）', '萃取率 (%)', { fmtX: v => trim(v, 0), fmtY: f2, band: IDEAL_EY });
  mk('#ch8', 'grind', 'tds', '研磨度（数值越小越细）', 'TDS (%)', { fmtX: v => trim(v, 0), fmtY: f2, band: IDEAL_TDS });
  mk('#ch6', 'time', 'ey', '冲煮时间 (分钟)', '萃取率 (%)', { fmtX: v => trim(v, 1), fmtY: f2, band: IDEAL_EY });
  const dots = data.filter(d => Number.isFinite(d.ey) && Number.isFinite(d.tds)).map(d => ({
    ey: d.ey, tds: d.tds, self: false,
    tip: `${d.label}　${d.seed ? '内置数据' : '我的记录'}　${d.tag}\nTDS ${trim(d.tds, 2)}%｜萃取率 ${trim(d.ey, 2)}%（图上 ${trim(d.ey / EY_CORR, 2)}%）\n${(zoneOf(d.tds, d.ey / EY_CORR) || {}).name || ''}`
  }));
  $('#ch7').innerHTML = controlChartSVG(dots);
}

/* ---------------- 冲煮控制图（独立互动页） ---------------- */
const ZONE_ADVICE = {
  hi_lo: {
    do: '加大水量（粉水比放大 1–2 档，例如 1:12 → 1:14），再把研磨调细一档（或延长萃取）。',
    why: '水少所以浓，研磨偏粗 / 时间偏短所以没萃够。加水把浓度拉下来、磨细把萃取率补上去，两个问题要一起解决。'
  },
  hi_mid: {
    do: '只加大水量（粉水比放大半档到一档），研磨、水温、时间都不要动。',
    why: '萃取率本来就落在合适区间，浓只是因为水少。加水直接把浓度拉回理想带，落点顺着斜线往左下走。'
  },
  hi_hi: {
    do: '加大水量，同时把研磨调粗一档（或降温 2–3 ℃、缩短时间）。',
    why: '加水只降浓度，却会让萃取率更容易往上跑；必须同时调粗研磨把萃取率压回来——两件事方向不同，要分别修正。'
  },
  mid_lo: {
    do: '研磨调细一档 / 升温 2–3 ℃ / 延长萃取时间，先选一个试。不要靠加水或减水。',
    why: '浓度已经对了，问题只在「没萃够」。这三招都在不改比例的前提下提高萃取率，落点会沿对角线往右上移动。'
  },
  ideal: {
    do: '别动。把这组参数记下来当基准；之后每次只改一个变量——先研磨，再水温，最后才动比例。',
    why: '浓度与萃取率都落在理想带，酸甜苦通常最平衡。一次只改一项，你才知道是哪一项在起作用。'
  },
  mid_hi: {
    do: '研磨调粗一档 / 降温 2–3 ℃ / 缩短总时间，先选一个试。',
    why: '浓度没问题，是萃取过头了。降低萃取率让落点沿对角线往左下回到框内。'
  },
  lo_lo: {
    do: '先把水量收紧（粉水比收紧 1–2 档），再把研磨调细一档。',
    why: '这是最难的一角：水太多导致淡、研磨太粗导致没萃够。缩水提浓度、磨细提萃取——两步都做才出得来。'
  },
  lo_mid: {
    do: '只缩小水量（少水或加粉），研磨别动。',
    why: '萃取率已经达标，纯粹是被水稀释了。收紧比例浓度就上来；此时若再去磨细，萃取率反而会超标。'
  },
  lo_hi: {
    do: '缩小水量，同时把研磨调粗一档（或降温、缩短时间）。',
    why: '水多又萃过了头。缩水把浓度提上来、磨粗把过高的萃取率压回去——两个问题方向相反，要分别处理。'
  }
};

function zonePanelHTML(key) {
  const z = ZONES[key];
  if (!z) return '';
  const parts = z.desc.split('建议：');
  const main = parts[0];
  const A = ZONE_ADVICE[key] || {};
  const advice = A.do || (parts[1] || '');
  const why = A.why || '';
  return `<div class="judge ${z.cls}">
      <h4>${z.name}<span class="cc-en">${z.en}</span></h4>
      <p>${main}</p>
      <p class="cc-do"><b>怎么调：</b>${advice}</p>
      ${why ? `<p class="cc-why"><b>为什么：</b>${why}</p>` : ''}
    </div>`;
}
function ratioPanelHTML(R) {
  return `<div class="judge">
      <h4>粉水比 1:${R}<span class="cc-en">Brew Ratio</span></h4>
      <p>这条斜线上的每一个点，粉水比都是 1:${R}——1 g 粉对 ${R} g 水。</p>
      <p class="cc-do"><b>怎么用：</b>沿这条线往右上走＝同比例下萃取更多；换到更平缓的一条线＝水加多了，浓度随之下降。</p>
    </div>`;
}
function renderControlPage() {
  const el = $('#cc-chart'), panel = $('#cc-info');
  if (!el || !panel) return;
  el.innerHTML = controlChartSVG([], { interactive: true });
  const DEF = '<div class="judge cc-hint"><h4>把鼠标移到图上</h4>'
    + '<p>移到任意一块区域，这里会立刻显示它的含义和该往哪调；移到斜线上，会告诉你是几比几的粉水比。手机直接点一下。</p></div>';
  let pinned = null;
  const show = html => { panel.innerHTML = html; };
  el.querySelectorAll('.zone-hit').forEach(r => {
    const html = zonePanelHTML(r.getAttribute('data-zone'));
    r.addEventListener('mouseenter', () => show(html));
    r.addEventListener('click', () => { pinned = html; show(html); });
  });
  el.querySelectorAll('.diag-hit').forEach(l => {
    const html = ratioPanelHTML(l.getAttribute('data-ratio'));
    l.addEventListener('mouseenter', () => show(html));
    l.addEventListener('click', () => { pinned = html; show(html); });
  });
  el.addEventListener('mouseleave', () => show(pinned || DEF));
  show(DEF);
}

/* ---------------- 启动 ---------------- */
loadRecords();
// 初始「已知」= 页面上带默认值的核心字段（其余留空，交给求解器推导）
U_CORE.forEach(k => { const el = $('#' + CORE_ID[k]); if (el && el.value.trim() !== '' && Number.isFinite(Number(el.value))) givenSet.add(CORE_ID[k]); });
// 首屏不自动计算：只显示「已知什么」，等用户点「确认」再推导
$('#calc-control').innerHTML = controlChartSVG([]);
updateModeTag();
renderRecords();
renderCharts();
renderControlPage();
show((location.hash || '#home').slice(1), false);
