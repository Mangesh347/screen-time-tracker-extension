// Screen Time Tracker — Chart.js helpers (smooth in-place updates, no harsh redraw)

const CHARTS = new Map();

/** Chart skin tokens read from CSS vars (Material vs Editorial). */
const chartSkin = {
  stroke: 2.5,
  point: 3.5,
  tension: 0.35,
  grid: '#e8eaed',
};

/** Soft Chart.js updates: morph data only — never destroy/recreate. */
function chartSoftUpdate(chart, mutator) {
  if (!chart) return false;
  try {
    mutator(chart);
    chart.update(prefersReduced() ? 'none' : {
      duration: motionDur(480),
      easing: 'easeInOutQuart',
    });
    return true;
  } catch {
    return false;
  }
}

/** Prefer soft update whenever an instance already exists (data refresh, not remount). */
function shouldSoft(id, softFlag) {
  return softFlag || CHARTS.has(id);
}

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function prefersReduced() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function motionDur(ms) {
  return prefersReduced() ? 0 : ms;
}

function themeDefaults() {
  if (typeof Chart === 'undefined') return;
  const t2 = cssVar('--t2', '#5f6368');
  const t3 = cssVar('--t3', '#80868b');
  const c2 = cssVar('--c2', '#ffffff');
  const c4 = cssVar('--c4', '#e8eaed');
  const gridRaw = cssVar('--chart-grid', c4);
  chartSkin.stroke = parseFloat(cssVar('--chart-stroke', '2.5')) || 2.5;
  chartSkin.point = parseFloat(cssVar('--chart-point', '3.5')) || 3.5;
  chartSkin.tension = parseFloat(cssVar('--chart-tension', '0.35')) || 0.35;
  chartSkin.grid = gridRaw === 'transparent' ? 'transparent' : gridRaw;
  Chart.defaults.color = t3;
  Chart.defaults.borderColor = chartSkin.grid === 'transparent' ? 'rgba(0,0,0,0)' : c4;
  Chart.defaults.font.family = "var(--font-ui), system-ui, sans-serif";
  Chart.defaults.font.size = 10;
  Chart.defaults.animation = {
    duration: motionDur(520),
    easing: 'easeOutCubic',
  };
  Chart.defaults.animations = {
    colors: { type: 'color', duration: motionDur(400), easing: 'easeOutCubic' },
    numbers: {
      type: 'number',
      properties: ['x', 'y', 'base', 'width', 'height', 'radius'],
      duration: motionDur(520),
      easing: 'easeOutCubic',
    },
  };
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = c2;
  Chart.defaults.plugins.tooltip.borderColor = c4;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = cssVar('--t1', '#202124');
  Chart.defaults.plugins.tooltip.bodyColor = t2;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = parseFloat(cssVar('--radius-sm', '14')) || 14;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.animation = { duration: motionDur(120) };
}

function destroy(id) {
  const c = CHARTS.get(id);
  if (c) { c.destroy(); CHARTS.delete(id); }
}

function getCtx(elOrId) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return null;
  let canvas = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    el.querySelectorAll('canvas').forEach(c => c.remove());
    el.appendChild(canvas);
  }
  return canvas.getContext('2d');
}

function primaryGradient(ctx, h) {
  const primary = cssVar('--m3-primary', '#6750a4');
  const editorial = typeof document !== 'undefined'
    && document.documentElement?.getAttribute('data-visual') === 'editorial';
  const minimal = typeof document !== 'undefined'
    && document.documentElement?.getAttribute('data-visual') === 'minimal';
  if (editorial || minimal) {
    // Flat fill — no soft fade
    return primary.length === 7 ? primary + (minimal ? '44' : '55') : primary;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h || 140);
  g.addColorStop(0, primary.length === 7 ? primary + '99' : primary);
  g.addColorStop(0.55, primary.length === 7 ? primary + '33' : primary);
  g.addColorStop(1, primary.length === 7 ? primary + '08' : 'transparent');
  return g;
}

function softMode(_mode) {
  if (prefersReduced()) return 'none';
  return 'none';
}

function lineDataset(extra = {}) {
  return {
    tension: chartSkin.tension,
    cubicInterpolationMode: 'monotone',
    borderWidth: chartSkin.stroke,
    pointRadius: chartSkin.point,
    pointHoverRadius: chartSkin.point + 1.5,
    borderCapStyle: 'round',
    borderJoinStyle: 'round',
    ...extra,
  };
}

function enterAnim({ soft = false, stagger = 16 } = {}) {
  return {
    duration: motionDur(soft ? 480 : 720),
    easing: 'easeOutCubic',
    delay: ctx => (prefersReduced() ? 0 : Math.min((ctx?.dataIndex || 0) * stagger, 240)),
  };
}

function yGrow() {
  return {
    y: {
      type: 'number',
      easing: 'easeOutCubic',
      duration: motionDur(640),
      from: ctx => {
        try {
          return ctx.chart.scales.y.getPixelForValue(ctx.chart.scales.y.min ?? 0);
        } catch {
          return undefined;
        }
      },
    },
  };
}

function ensureShell(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.classList.add('chart-shell');
  el.classList.remove('anim-wave', 'chart-wave');
  el.querySelectorAll('.chart-wave-flow').forEach(n => n.remove());
}

export function renderAreaChart(containerId, daily, { fmt, soft = false } = {}) {
  themeDefaults();
  ensureShell(containerId);
  const labels = (daily || []).map(d => d.date.slice(5));
  const data = (daily || []).map(d => Math.round((d.time || 0) / 60));
  const primary = cssVar('--m3-primary', '#6750a4');
  const existing = CHARTS.get(containerId);
  const useSoft = shouldSoft(containerId, soft);

  if (existing && useSoft && daily?.length) {
    chartSoftUpdate(existing, c => {
      c.data.labels = labels;
      c.data.datasets[0].data = data;
      c.data.datasets[0].borderColor = primary;
      c.data.datasets[0].pointBackgroundColor = primary;
      Object.assign(c.data.datasets[0], lineDataset({
        borderColor: primary,
        pointBackgroundColor: primary,
        pointRadius: daily.length > 14 ? 0 : chartSkin.point,
      }));
      try {
        c.data.datasets[0].backgroundColor = primaryGradient(c.ctx, 160);
      } catch {}
    });
    return existing;
  }

  if (existing && useSoft && !daily?.length) {
    // Keep chart mounted; zero data without destroy
    chartSoftUpdate(existing, c => {
      c.data.labels = labels;
      c.data.datasets[0].data = data;
    });
    return existing;
  }

  destroy(containerId);
  const ctx = getCtx(containerId);
  ensureShell(containerId);
  if (!ctx || !daily?.length) {
    const el = document.getElementById(containerId);
    if (el) {
      ensureShell(containerId);
      const empty = el.querySelector('.empty') || document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No data';
      if (!empty.parentNode) el.appendChild(empty);
    }
    return null;
  }
  elClearEmpty(containerId);
  const t3 = cssVar('--t3', '#80868b');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: primary,
        backgroundColor: primaryGradient(ctx, 160),
        fill: true,
        ...lineDataset({
          pointRadius: daily.length > 14 ? 0 : 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: primary,
          pointBorderColor: cssVar('--c2', '#fff'),
          pointBorderWidth: 2,
        }),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: enterAnim({ soft: false }),
      // First paint only — soft refreshes use chartSoftUpdate (no yGrow from zero)
      animations: yGrow(),
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: t3 } },
        y: {
          beginAtZero: true,
          grid: { color: chartSkin.grid === 'transparent' ? 'rgba(0,0,0,0)' : chartSkin.grid, display: chartSkin.grid !== 'transparent' },
          ticks: {
            color: t3,
            callback: v => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`),
          },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: c => ` ${fmt ? fmt(c.raw * 60) : c.raw + 'm'}`,
          },
        },
      },
    },
  });
  CHARTS.set(containerId, chart);
  return chart;
}

function elClearEmpty(containerId) {
  const el = document.getElementById(containerId);
  el?.querySelectorAll(':scope > .empty, :scope > .prem-empty').forEach(n => n.remove());
}

export function renderBarChart(containerId, daily, { fmt, soft = false } = {}) {
  themeDefaults();
  ensureShell(containerId);
  const primary = cssVar('--m3-primary', '#6750a4');
  const secondary = cssVar('--m3-secondary', primary);
  const max = Math.max(...(daily || []).map(d => d.time), 1);
  const labels = (daily || []).map(d => d.date.slice(5));
  const data = (daily || []).map(d => Math.round(d.time / 60));
  const colors = (daily || []).map((d, i) => {
    const a = 0.35 + (d.time / max) * 0.65;
    const hex = i === daily.length - 1 ? secondary : primary;
    return hex.length === 7 ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex;
  });
  const existing = CHARTS.get(containerId);
  if (existing && shouldSoft(containerId, soft)) {
    chartSoftUpdate(existing, c => {
      c.data.labels = labels;
      c.data.datasets[0].data = data;
      c.data.datasets[0].backgroundColor = colors;
    });
    return existing;
  }
  destroy(containerId);
  const ctx = getCtx(containerId);
  ensureShell(containerId);
  if (!ctx || !daily?.length) {
    const el = document.getElementById(containerId);
    if (el && !el.querySelector('.empty')) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No data';
      el.appendChild(empty);
    }
    return null;
  }
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 14,
        borderSkipped: false,
        maxBarThickness: 28,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: enterAnim({ soft, stagger: 28 }),
      animations: yGrow(),
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: {
          beginAtZero: true,
          grid: { color: chartSkin.grid === 'transparent' ? 'rgba(0,0,0,0)' : chartSkin.grid, display: chartSkin.grid !== 'transparent' },
          ticks: { callback: v => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`) },
        },
      },
      plugins: {
        tooltip: { callbacks: { label: c => ` ${fmt ? fmt(c.raw * 60) : c.raw + 'm'}` } },
      },
    },
  });
  CHARTS.set(containerId, chart);
  return chart;
}

export function renderDoughnut(containerId, cats, total, { catColor, fmt, legendId, soft = false } = {}) {
  themeDefaults();
  const wrap = document.getElementById(containerId);
  if (!wrap) return null;
  ensureShell(containerId);
  if (!cats?.length || !total) {
    wrap.querySelectorAll('canvas, .donut-center-label, .empty').forEach(n => n.remove());
    if (legendId) document.getElementById(legendId).innerHTML = '';
    destroy(containerId);
    return null;
  }
  const slice = cats.slice(0, 7);
  const existing = CHARTS.get(containerId);
  if (existing && shouldSoft(containerId, soft) && wrap.querySelector('canvas')) {
    chartSoftUpdate(existing, c => {
      c.data.labels = slice.map(x => x.category);
      c.data.datasets[0].data = slice.map(x => x.time);
      c.data.datasets[0].backgroundColor = slice.map(x => catColor ? catColor(x.category) : cssVar('--m3-primary', '#6750a4'));
    });
    const cv = document.getElementById(containerId + '-cv');
    if (cv && fmt) cv.textContent = fmt(total);
    if (legendId) {
      const leg = document.getElementById(legendId);
      if (leg) {
        leg.innerHTML = slice.map(c => `
          <div class="leg-item">
            <div class="leg-dot" style="background:${catColor(c.category)}"></div>
            <span class="leg-name">${c.category}</span>
            <span class="leg-val" style="color:${catColor(c.category)}">${Math.round((c.time / total) * 100)}%</span>
          </div>`).join('');
      }
    }
    return existing;
  }
  destroy(containerId);
  wrap.querySelectorAll('canvas, .donut-center-label, .chart-wave-flow').forEach(n => n.remove());
  const canvas = document.createElement('canvas');
  const center = document.createElement('div');
  center.className = 'donut-center-label';
  center.innerHTML = `<div class="v" id="${containerId}-cv"></div><div class="k">total</div>`;
  wrap.appendChild(canvas);
  wrap.appendChild(center);
  ensureShell(containerId);
  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: slice.map(c => c.category),
      datasets: [{
        data: slice.map(c => c.time),
        backgroundColor: slice.map(c => catColor ? catColor(c.category) : cssVar('--m3-primary', '#6750a4')),
        borderWidth: document.documentElement?.getAttribute('data-visual') === 'editorial' ? 3 : 0,
        borderColor: cssVar('--c2', '#ffffff'),
        hoverOffset: document.documentElement?.getAttribute('data-visual') === 'editorial' ? 4 : 8,
        borderRadius: document.documentElement?.getAttribute('data-visual') === 'editorial' ? 12 : 6,
        spacing: document.documentElement?.getAttribute('data-visual') === 'editorial' ? 4 : 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '68%',
      animation: {
        animateRotate: true,
        animateScale: true,
        duration: motionDur(soft ? 520 : 920),
        easing: 'easeInOutQuart',
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: c => ` ${c.label}: ${fmt ? fmt(c.raw) : c.raw + 's'} (${Math.round((c.raw / total) * 100)}%)`,
          },
        },
      },
    },
  });
  const cv = document.getElementById(containerId + '-cv');
  if (cv && fmt) cv.textContent = fmt(total);
  if (legendId) {
    const leg = document.getElementById(legendId);
    if (leg) {
      leg.innerHTML = slice.map(c => `
        <div class="leg-item">
          <div class="leg-dot" style="background:${catColor(c.category)}"></div>
          <span class="leg-name">${c.category}</span>
          <span class="leg-val" style="color:${catColor(c.category)}">${Math.round((c.time / total) * 100)}%</span>
        </div>`).join('');
    }
  }
  CHARTS.set(containerId, chart);
  return chart;
}

export function renderCompareBars(containerId, aLabel, aVal, bLabel, bVal, { fmt, soft = false } = {}) {
  themeDefaults();
  ensureShell(containerId);
  const primary = cssVar('--m3-primary', '#6750a4');
  const secondary = cssVar('--m3-secondary', cssVar('--purple', '#c45c7a'));
  const data = [Math.round(aVal / 60), Math.round(bVal / 60)];
  const existing = CHARTS.get(containerId);
  if (existing && shouldSoft(containerId, soft)) {
    chartSoftUpdate(existing, c => {
      c.data.labels = [aLabel, bLabel];
      c.data.datasets[0].data = data;
      c.data.datasets[0].backgroundColor = [primary, secondary];
    });
    return existing;
  }
  destroy(containerId);
  const ctx = getCtx(containerId);
  ensureShell(containerId);
  if (!ctx) return null;
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [aLabel, bLabel],
      datasets: [{
        data,
        backgroundColor: [primary, secondary],
        borderRadius: 14,
        borderSkipped: false,
        maxBarThickness: 48,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: enterAnim({ soft, stagger: 90 }),
      scales: {
        x: { beginAtZero: true, grid: { color: chartSkin.grid === 'transparent' ? 'rgba(0,0,0,0)' : chartSkin.grid, display: chartSkin.grid !== 'transparent' }, ticks: { callback: v => `${v}m` } },
        y: { grid: { display: false } },
      },
      plugins: {
        tooltip: { callbacks: { label: c => ` ${fmt ? fmt(c.raw * 60) : c.raw + 'm'}` } },
      },
    },
  });
  CHARTS.set(containerId, chart);
  return chart;
}

export function renderSparkline(containerId, values, color, { soft = false } = {}) {
  themeDefaults();
  const stroke = color || cssVar('--m3-primary', '#6750a4');
  const data = values || [];
  const existing = CHARTS.get(containerId);
  if (existing && shouldSoft(containerId, soft)) {
    chartSoftUpdate(existing, c => {
      c.data.labels = data.map((_, i) => i);
      c.data.datasets[0].data = data;
      c.data.datasets[0].borderColor = stroke;
    });
    return existing;
  }
  destroy(containerId);
  const ctx = getCtx(containerId);
  ensureShell(containerId);
  if (!ctx || !data.length) return null;
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data,
        borderColor: stroke,
        backgroundColor: 'transparent',
        ...lineDataset({
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.65,
        }),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: enterAnim({ soft, stagger: 14 }),
      // Soft morph only — avoid yGrow from zero on refresh
      animations: soft ? undefined : yGrow(),
      plugins: { tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
  CHARTS.set(containerId, chart);
  return chart;
}

/**
 * Petal / polar category chart (Material You radial petals).
 * values: [{ label, value, max?, color? }] — interactive when onSelect provided.
 */
export function renderPetalChart(containerId, values = [], { soft = false, onSelect = null, total = 0, fmt: fmtFn = null } = {}) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return null;
  const id = typeof containerId === 'string' ? containerId : el.id;
  ensureShell(id);
  const items = (values || []).filter(v => v && v.label).slice(0, 8);
  if (!items.length) {
    if (soft && el.querySelector('.petal-chart')) return el; // keep last petals on soft empty blip
    el.querySelectorAll(':scope > .petal-chart, :scope > .empty, :scope > .petal-detail, :scope > .chart-wave-flow').forEach(n => n.remove());
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.cssText = 'height:100%;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:12px';
    empty.textContent = 'No category data yet';
    el.appendChild(empty);
    ensureShell(id);
    return null;
  }
  const max = Math.max(...items.map(v => Number(v.max) || Number(v.value) || 0), 1);
  const sum = total || items.reduce((s, v) => s + (Number(v.value) || 0), 0) || 1;
  const n = items.length;
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 108;
  const innerR = 18;
  const gap = 0.08;
  const sweep = (Math.PI * 2) / n - gap;
  const primary = cssVar('--m3-primary', '#6750a4');

  function petalPath(start, end, rOuter, rInner) {
    const mid = (start + end) / 2;
    const bulge = rOuter * 0.92;
    const x0 = cx + Math.cos(start) * rInner;
    const y0 = cy + Math.sin(start) * rInner;
    const x1 = cx + Math.cos(start) * bulge;
    const y1 = cy + Math.sin(start) * bulge;
    const xm = cx + Math.cos(mid) * rOuter;
    const ym = cy + Math.sin(mid) * rOuter;
    const x2 = cx + Math.cos(end) * bulge;
    const y2 = cy + Math.sin(end) * bulge;
    const x3 = cx + Math.cos(end) * rInner;
    const y3 = cy + Math.sin(end) * rInner;
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} Q${x1.toFixed(1)} ${y1.toFixed(1)} ${xm.toFixed(1)} ${ym.toFixed(1)} Q${x2.toFixed(1)} ${y2.toFixed(1)} ${x3.toFixed(1)} ${y3.toFixed(1)} Z`;
  }

  function buildPetalMeta(item, i) {
    const start = -Math.PI / 2 + i * ((Math.PI * 2) / n) + gap / 2;
    const end = start + sweep;
    const ratio = Math.max(0.08, Math.min(1, (Number(item.value) || 0) / max));
    const r = innerR + (outerR - innerR) * ratio;
    const mid = (start + end) / 2;
    const lx = cx + Math.cos(mid) * (outerR + 22);
    const ly = cy + Math.sin(mid) * (outerR + 22);
    const base = petalPath(start, end, outerR, innerR);
    const fill = petalPath(start, end, r, innerR);
    const mins = Math.round((Number(item.value) || 0) / 60);
    const pct = Math.round(((Number(item.value) || 0) / sum) * 100);
    const fillCol = item.color || primary;
    const tip = `${item.label}: ${mins}m · ${pct}%`;
    return { start, end, base, fill, lx, ly, mins, pct, fillCol, tip, label: item.label };
  }

  const metas = items.map(buildPetalMeta);
  el._petalOnSelect = onSelect;
  el._petalItems = items;
  el._petalSum = sum;
  el._petalFmt = fmtFn;

  const existingChart = el.querySelector('.petal-chart');
  if ((soft || existingChart) && existingChart && metas.length === existingChart.querySelectorAll('.petal-hit').length) {
    existingChart.querySelectorAll('.petal-hit').forEach((g, i) => {
      const m = metas[i];
      if (!m) return;
      g.setAttribute('data-cat', String(m.label).replace(/"/g, ''));
      g.setAttribute('aria-label', m.tip);
      const title = g.querySelector('title');
      if (title) title.textContent = m.tip;
      const base = g.querySelector('.petal-base');
      const fill = g.querySelector('.petal-fill');
      if (base) base.setAttribute('d', m.base);
      if (fill) {
        fill.setAttribute('d', m.fill);
        fill.setAttribute('fill', m.fillCol);
      }
      const texts = g.querySelectorAll('text');
      if (texts[0]) {
        texts[0].setAttribute('x', m.lx.toFixed(1));
        texts[0].setAttribute('y', m.ly.toFixed(1));
        texts[0].textContent = String(m.mins);
      }
      if (texts[1]) {
        texts[1].setAttribute('x', m.lx.toFixed(1));
        texts[1].setAttribute('y', (m.ly + 12).toFixed(1));
        texts[1].textContent = String(m.label).slice(0, 10);
      }
    });
    return el;
  }

  const petals = metas.map((m, i) => `
      <g class="petal-hit" data-cat="${String(m.label).replace(/"/g, '')}" data-i="${i}" tabindex="0" role="button" aria-label="${m.tip}">
        <title>${m.tip}</title>
        <path class="petal-base" d="${m.base}" fill="var(--m3-surface-container-high, var(--c3))" opacity=".9"/>
        <path class="petal-fill" d="${m.fill}" fill="${m.fillCol}" opacity=".88" style="--i:${i};animation-delay:${i * 55}ms;transition:d .7s cubic-bezier(.05,.7,.1,1),opacity .2s"/>
        <text x="${m.lx.toFixed(1)}" y="${m.ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
          fill="var(--t1)" font-size="10" font-weight="700">${m.mins}</text>
        <text x="${m.lx.toFixed(1)}" y="${(m.ly + 12).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
          fill="var(--t3)" font-size="8" font-weight="600">${String(m.label).slice(0, 10)}</text>
      </g>`).join('');

  const html = `<div class="petal-chart petal-premium ${soft ? 'is-soft' : ''}" style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;min-height:260px;gap:8px">
    <svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" style="max-width:300px;max-height:300px" aria-label="Category petal chart">
      ${petals}
      <path d="M${cx - 12} ${cy} C${cx - 12} ${cy - 10} ${cx - 6} ${cy - 14} ${cx} ${cy - 14} C${cx + 8} ${cy - 14} ${cx + 14} ${cy - 8} ${cx + 14} ${cy} C${cx + 14} ${cy + 9} ${cx + 7} ${cy + 14} ${cx} ${cy + 14} C${cx - 8} ${cy + 14} ${cx - 12} ${cy + 8} ${cx - 12} ${cy}Z" fill="var(--c2)" stroke="var(--m3-primary)" stroke-width="2"/>
    </svg>
    <div class="petal-detail" id="${id}-detail" aria-live="polite">Hover a petal · click to filter sites</div>
  </div>`;
  el.querySelectorAll(':scope > .petal-chart, :scope > .empty, :scope > .chart-wave-flow').forEach(n => n.remove());
  el.insertAdjacentHTML('beforeend', html);
  const detail = el.querySelector('.petal-detail');
  if (!el.dataset.petalBound) {
    el.dataset.petalBound = '1';
    el.addEventListener('mouseenter', e => {
      const g = e.target.closest?.('.petal-hit');
      if (!g || !el.contains(g)) return;
      const cat = g.getAttribute('data-cat');
      const item = (el._petalItems || []).find(x => String(x.label) === cat);
      const d = el.querySelector('.petal-detail');
      if (!item || !d) return;
      const pct = Math.round(((Number(item.value) || 0) / (el._petalSum || 1)) * 100);
      const t = el._petalFmt ? el._petalFmt(item.value) : `${Math.round((item.value || 0) / 60)}m`;
      d.textContent = `${cat} · ${t} · ${pct}% of period`;
    }, true);
    el.addEventListener('focusin', e => {
      const g = e.target.closest?.('.petal-hit');
      if (!g || !el.contains(g)) return;
      g.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    el.addEventListener('click', e => {
      const g = e.target.closest?.('.petal-hit');
      if (!g || !el.contains(g)) return;
      const cat = g.getAttribute('data-cat');
      const item = (el._petalItems || []).find(x => String(x.label) === cat);
      if (typeof el._petalOnSelect === 'function') el._petalOnSelect(cat, item);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = e.target.closest?.('.petal-hit');
      if (!g || !el.contains(g)) return;
      e.preventDefault();
      g.click();
    });
  }
  void detail;
  ensureShell(id);
  return el;
}

/** Bento metric tiles — optional delta + count-up target */
export function renderBentoMetrics(containerId, tiles = []) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;
  el.className = 'bento-grid bento-premium';
  el.innerHTML = tiles.map((t, i) => {
    const tone = t.tone || (i % 3 === 0 ? 'primary' : i % 3 === 1 ? 'secondary' : 'tertiary');
    const delta = t.deltaLabel
      ? `<div class="bento-delta ${t.deltaTone || ''}">${t.deltaLabel}</div>`
      : '';
    return `<div class="bento-tile tone-${tone}" style="--i:${i}">
      <div class="bento-val" data-count-target="${t.countTarget != null ? t.countTarget : ''}">${String(t.value ?? '—')}</div>
      <div class="bento-lbl">${String(t.label || '')}</div>
      ${delta}
    </div>`;
  }).join('');
}

/** Habit progress — Done count per day (smooth reveal, no wavy ribbon) */
export function renderHabitDoneChart(containerId, series, { soft = false } = {}) {
  themeDefaults();
  const labels = series?.labels || [];
  const data = series?.data || [];
  const maxY = Math.max(1, series?.maxY || 10);
  const primary = cssVar('--m3-primary', '#6750a4');
  const existing = CHARTS.get(containerId);
  const host = document.getElementById(containerId);
  if (host?.tagName === 'CANVAS') {
    host.parentElement?.classList.add('chart-shell');
    host.parentElement?.classList.remove('anim-wave', 'chart-wave');
  } else {
    ensureShell(containerId);
  }

  if (existing && shouldSoft(containerId, soft)) {
    chartSoftUpdate(existing, c => {
      c.data.labels = labels;
      c.data.datasets[0].data = data;
      c.data.datasets[0].borderColor = primary;
      c.data.datasets[0].pointBackgroundColor = primary;
      c.options.scales.y.max = maxY;
    });
    return existing;
  }

  destroy(containerId);
  const ctx = getCtx(containerId);
  if (!ctx) return null;
  const t3 = cssVar('--t3', '#80868b');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Done',
        data,
        borderColor: primary,
        backgroundColor: primary + '22',
        fill: false,
        ...lineDataset({
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: primary,
          pointBorderColor: cssVar('--c2', '#fff'),
          pointBorderWidth: 2,
          tension: 0.3,
        }),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: enterAnim({ soft, stagger: 18 }),
      animations: soft ? undefined : yGrow(),
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12, color: t3 } },
        y: {
          min: 0,
          max: maxY,
          ticks: { stepSize: 1, color: t3 },
          grid: { color: chartSkin.grid === 'transparent' ? 'rgba(0,0,0,0)' : chartSkin.grid, display: chartSkin.grid !== 'transparent' },
          title: { display: true, text: 'Done', color: t3, font: { size: 10, weight: '600' } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` Done: ${c.raw}` } },
      },
    },
  });
  CHARTS.set(containerId, chart);
  return chart;
}

function emptyState(el, title, sub) {
  if (!el) return;
  el.innerHTML = `<div class="prem-empty" role="status">
    <div class="prem-empty-orb" aria-hidden="true"></div>
    <div class="prem-empty-title">${title}</div>
    <div class="prem-empty-sub">${sub || 'Keep browsing — charts unlock with real activity.'}</div>
  </div>`;
}

/** Smooth open path through activity samples (quadratic midpoints). */
function smoothWavePath(pts, w, h, padY = 2) {
  const n = pts.length;
  if (!n) return '';
  const step = w / Math.max(1, n - 1);
  const yAt = (i) => {
    const v = pts[Math.max(0, Math.min(n - 1, i))];
    return h - padY - v * (h - padY * 2);
  };
  if (n === 1) return `M0 ${yAt(0).toFixed(1)} L${w} ${yAt(0).toFixed(1)}`;
  let d = `M0 ${yAt(0).toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = i * step;
    const x1 = (i + 1) * step;
    const y0 = yAt(i);
    const y1 = yAt(i + 1);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += ` Q${x0.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    if (i === n - 2) d += ` Q${x1.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

/** Inline SVG mini waveform for Top Sites rows — smooth curves + thin baseline + subtle flow */
export function renderMiniWaveform(values = [], { color = null, width = 72, height = 22 } = {}) {
  const pts = (values || []).map(v => Math.max(0, Math.min(1, Number(v) || 0)));
  if (!pts.length) {
    return `<svg class="mini-wave" width="${width}" height="${height}" aria-hidden="true">
      <line class="mini-wave-baseline" x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}"/>
    </svg>`;
  }
  const w = width;
  const h = height;
  const path = smoothWavePath(pts, w, h);
  const midY = (h / 2).toFixed(1);
  const area = `${path} L${w} ${h} L0 ${h} Z`;
  const stroke = color || cssVar('--m3-primary', '#6750a4');
  const flow = prefersReduced() ? '' : ' mini-wave-flow';
  const draw = prefersReduced() ? '' : ' mini-wave-path';
  return `<svg class="mini-wave${flow}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line class="mini-wave-baseline" x1="0" y1="${midY}" x2="${w}" y2="${midY}"/>
    <path d="${area}" fill="${stroke}" opacity=".16"/>
    <path class="mini-wave-stroke${draw}" d="${path}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Closed / open wavy circle path (sinusoidal radius). */
export function wavyCirclePath(cx, cy, r, { amp = 5, waves = 7, phase = 0, steps = 96, start = 0, end = Math.PI * 2, close = true } = {}) {
  const span = end - start;
  if (span <= 0) return '';
  const full = Math.abs(span - Math.PI * 2) < 1e-6;
  // Full loops: sample 0..n-1 then close with Z so first/last meet (no open seam).
  const n = Math.max(8, Math.round(steps * (span / (Math.PI * 2))));
  const samples = close && full ? n : n + 1;
  let d = '';
  for (let i = 0; i < samples; i++) {
    const t = start + (i / n) * span;
    const rr = r + amp * Math.sin(waves * t + phase);
    const x = cx + Math.cos(t) * rr;
    const y = cy + Math.sin(t) * rr;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  if (close && full) d += 'Z';
  return d;
}

/**
 * Categories — one wavy circle, continuous motion, category colors.
 * Replaces Overview doughnut only (call site: dash-pie).
 */
export function renderWavyCategoryCircle(containerId, cats, total, { catColor, fmt, legendId, soft = false } = {}) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return null;

  if (!cats?.length || !total) {
    destroy(containerId);
    wrap.querySelectorAll('canvas, .donut-center-label, .cat-wavy-orb, .empty, .prem-empty').forEach(n => n.remove());
    if (legendId) {
      const leg = document.getElementById(legendId);
      if (leg) leg.innerHTML = '';
    }
    emptyState(wrap, 'No categories yet', 'Category colors appear as you browse.');
    return null;
  }

  const slice = cats.slice(0, 7);
  const colorOf = (c) => (catColor ? catColor(c.category) : cssVar('--m3-primary', '#6750a4'));
  const cx = 70; const cy = 70; const r = 50; const amp = 6; const waves = 8;
  let angle = -Math.PI / 2;
  const segs = slice.map((c) => {
    const frac = Math.max(0.02, c.time / total);
    const sweep = frac * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const d = wavyCirclePath(cx, cy, r, { amp, waves, phase: 0, steps: 96, start, end, close: false });
    return { d, color: colorOf(c), category: c.category, time: c.time, frac };
  });

  const existingOrb = wrap.querySelector('.cat-wavy-orb');
  // Soft: keep spinning <g> alive — only swap path `d` / stroke / center text
  if ((soft || existingOrb) && existingOrb && !existingOrb.classList.contains('prem-empty')) {
    const spin = existingOrb.querySelector('.cat-wavy-spin');
    if (spin) {
      const paths = [...spin.querySelectorAll('path.cat-wavy-seg')];
      segs.forEach((s, i) => {
        if (paths[i]) {
          paths[i].setAttribute('d', s.d);
          paths[i].setAttribute('stroke', s.color);
        } else {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('class', 'cat-wavy-seg');
          p.setAttribute('d', s.d);
          p.setAttribute('fill', 'none');
          p.setAttribute('stroke', s.color);
          p.setAttribute('stroke-width', '11');
          p.setAttribute('stroke-linecap', 'round');
          p.setAttribute('stroke-linejoin', 'round');
          spin.appendChild(p);
        }
      });
      paths.slice(segs.length).forEach(p => p.remove());
    }
    const cv = document.getElementById(`${containerId}-cv`);
    if (cv && fmt) cv.textContent = fmt(total);
    if (legendId) {
      const leg = document.getElementById(legendId);
      if (leg) {
        leg.innerHTML = slice.map(c => `
          <div class="leg-item">
            <div class="leg-dot" style="background:${colorOf(c)}"></div>
            <span class="leg-name">${c.category}</span>
            <span class="leg-val" style="color:${colorOf(c)}">${Math.round((c.time / total) * 100)}%</span>
          </div>`).join('');
      }
    }
    return wrap;
  }

  destroy(containerId);
  wrap.querySelectorAll('canvas, .donut-center-label, .cat-wavy-orb, .empty, .prem-empty').forEach(n => n.remove());
  const reduced = prefersReduced();
  wrap.innerHTML = `<div class="cat-wavy-orb${reduced ? ' is-static' : ''}" role="img" aria-label="Category mix">
    <svg viewBox="0 0 140 140" width="140" height="140">
      <g class="cat-wavy-spin">
        ${segs.map(s => `<path class="cat-wavy-seg" d="${s.d}" fill="none" stroke="${s.color}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
      </g>
    </svg>
    <div class="cat-wavy-center">
      <div class="v" id="${containerId}-cv">${fmt ? fmt(total) : ''}</div>
      <div class="k">total</div>
    </div>
  </div>`;

  if (legendId) {
    const leg = document.getElementById(legendId);
    if (leg) {
      leg.innerHTML = slice.map(c => `
        <div class="leg-item">
          <div class="leg-dot" style="background:${colorOf(c)}"></div>
          <span class="leg-name">${c.category}</span>
          <span class="leg-val" style="color:${colorOf(c)}">${Math.round((c.time / total) * 100)}%</span>
        </div>`).join('');
    }
  }
  return wrap;
}

/**
 * Focus score — fully closed wavy ring (same amp/waves/r/stroke as Categories),
 * continuous motion, colored by focus energy. Score progress lives in #drg-num /
 * wavy meter — ring itself stays a continuous closed stroke (no dasharray gap).
 * Mounts inside #dash-focus-ring (Overview only).
 */
export function renderFocusWavyThin(containerId, score = 50, color = null) {
  const host = document.getElementById(containerId);
  if (!host) return null;
  const col = color || cssVar('--m3-primary', '#6750a4');
  const cx = 70; const cy = 70; const r = 50; const amp = 6; const waves = 8;
  const ring = wavyCirclePath(cx, cy, r, { amp, waves, phase: 0, steps: 128, close: true });
  const reduced = prefersReduced();
  const center = host.querySelector('.ring-center');
  const existing = host.querySelector('.focus-wavy-svg');
  // Soft: keep SVG + CSS animation; only update path d + color
  if (existing) {
    const path = existing.querySelector('.focus-wavy-ring');
    if (path) path.setAttribute('d', ring);
    existing.classList.toggle('is-static', reduced);
  } else {
    const svgHtml = `<svg class="focus-wavy-svg${reduced ? ' is-static' : ''}" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
      <path class="focus-wavy-ring" id="drg-fill" d="${ring}" fill="none" stroke="currentColor" stroke-width="11"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    host.insertAdjacentHTML('afterbegin', svgHtml);
  }
  if (center) host.appendChild(center);
  host.style.setProperty('--focus-energy', col);
  host.style.color = col;
  host.classList.add('is-live');
  return host;
}

/** Multi-layer area wave: total / focus / social / entertainment with toggles */
export function renderMultiLayerWave(containerId, layers = [], { fmt, soft = false } = {}) {
  themeDefaults();
  const host = document.getElementById(containerId);
  if (!host) return null;
  ensureShell(containerId);

  const series = [
    { key: 'total', label: 'Total', color: cssVar('--m3-primary', '#6750a4'), on: true },
    { key: 'focus', label: 'Focus', color: '#6366F1', on: true },
    { key: 'social', label: 'Social', color: '#E11D74', on: true },
    { key: 'entertainment', label: 'Play', color: '#F59E0B', on: false },
  ];

  if (!layers?.length) {
    if (soft && host.querySelector('.ml-wave-toolbar') && !host.querySelector('.prem-empty')) {
      return host; // keep last trend on soft empty blip
    }
    destroy(`${containerId}-ml-wrap`);
    emptyState(host, 'No trend yet', 'Daily layers appear after a day of browsing.');
    return null;
  }

  const labels = layers.map(d => String(d.date || '').slice(5));
  const wrapId = `${containerId}-ml-wrap`;
  host._mlLayers = layers;
  host._mlFmt = fmt;

  const existingTb = host.querySelector('.ml-wave-toolbar');
  const existingWrap = document.getElementById(wrapId);
  const canSoft = (soft || CHARTS.has(wrapId)) && existingTb && existingWrap && !host.querySelector('.prem-empty');

  function readToggleState() {
    existingTb?.querySelectorAll('.ml-tog').forEach(b => {
      const s = series.find(x => x.key === b.dataset.key);
      if (s) s.on = b.classList.contains('on');
    });
  }

  function buildDatasets() {
    return series.filter(s => s.on).map(s => {
      const col = s.color;
      const src = host._mlLayers || layers;
      return {
        label: s.label,
        data: src.map(d => Math.round((d[s.key] || 0) / 60)),
        borderColor: col,
        backgroundColor: col.length === 7 ? col + '33' : col,
        fill: true,
        ...lineDataset({
          borderWidth: s.key === 'total' ? 2.4 : 1.8,
          pointRadius: src.length > 14 ? 0 : 2.5,
          pointHoverRadius: 5,
          pointBackgroundColor: col,
          tension: 0.42,
        }),
      };
    });
  }

  function paint({ remount = false } = {}) {
    const src = host._mlLayers || layers;
    const nextLabels = src.map(d => String(d.date || '').slice(5));
    const datasets = buildDatasets();
    const existing = CHARTS.get(wrapId);
    if (existing && !remount) {
      chartSoftUpdate(existing, c => {
        c.data.labels = nextLabels;
        c.data.datasets = datasets;
      });
      return;
    }
    destroy(wrapId);
    const ctx = getCtx(wrapId);
    if (!ctx) return;
    const t3 = cssVar('--t3', '#80868b');
    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels: nextLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: enterAnim({ soft: true }),
        // No yGrow on soft morph — prevents restart-from-zero
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: t3 } },
          y: {
            beginAtZero: true,
            stacked: false,
            grid: { color: chartSkin.grid === 'transparent' ? 'rgba(0,0,0,0)' : chartSkin.grid, display: chartSkin.grid !== 'transparent' },
            ticks: { color: t3, callback: v => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`) },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: c => ` ${c.dataset.label}: ${host._mlFmt ? host._mlFmt(c.raw * 60) : c.raw + 'm'}`,
            },
          },
        },
      },
    });
    CHARTS.set(wrapId, chart);
  }

  if (canSoft) {
    readToggleState();
    paint({ remount: false });
    return existingWrap;
  }

  host.innerHTML = `<div class="ml-wave-toolbar" id="${wrapId}-tb"></div><div class="chart-shell" id="${wrapId}" style="height:200px"></div>`;
  const tb = document.getElementById(`${wrapId}-tb`);
  const canvasHost = document.getElementById(wrapId);

  if (tb) {
    tb.innerHTML = series.map(s => `
      <button type="button" class="ml-tog ${s.on ? 'on' : ''}" data-key="${s.key}" style="--tog:${s.color}">
        <span class="ml-dot"></span>${s.label}
      </button>`).join('');
    tb.onclick = e => {
      const b = e.target.closest('.ml-tog');
      if (!b) return;
      const s = series.find(x => x.key === b.dataset.key);
      if (!s) return;
      const onCount = series.filter(x => x.on).length;
      if (s.on && onCount <= 1) return;
      s.on = !s.on;
      b.classList.toggle('on', s.on);
      paint({ remount: false });
    };
  }
  paint({ remount: true });
  return canvasHost;
}

/** Activity River — horizontal day intensity stream from heatmap hours */
export function renderActivityRiver(containerId, hourSeries = [], { fmt, soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const vals = hourSeries || [];
  const max = Math.max(...vals, 0);
  const existing = el.querySelector('.act-river');
  if (!max) {
    if (soft && existing) return el;
    emptyState(el, 'Quiet river', 'Hourly activity will flow here once tracking warms up.');
    return null;
  }
  const w = 640;
  const h = 96;
  const mid = h / 2;
  let d = `M0 ${mid}`;
  const pts = vals.map((v, i) => {
    const x = (i / 23) * w;
    const amp = (v / max) * (h * 0.42);
    return { x, amp, v, i };
  });
  for (const p of pts) d += ` L${p.x.toFixed(1)} ${(mid - p.amp).toFixed(1)}`;
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    d += ` L${p.x.toFixed(1)} ${(mid + p.amp * 0.72).toFixed(1)}`;
  }
  d += ' Z';
  const strokeD = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${(mid - p.amp).toFixed(1)}`).join(' ');
  const tipText = `Peak ${vals.indexOf(max)}:00 · ${fmt ? fmt(max) : Math.round(max / 60) + 'm'}`;

  if ((soft || existing) && existing) {
    const fill = existing.querySelector('.river-fill');
    const stroke = existing.querySelector('.river-stroke');
    const tip = existing.querySelector('.act-river-tip');
    if (fill) fill.setAttribute('d', d);
    if (stroke) stroke.setAttribute('d', strokeD);
    if (tip) tip.textContent = tipText;
    return el;
  }

  const ticks = [0, 6, 12, 18, 23].map(h0 => {
    const x = (h0 / 23) * w;
    return `<text x="${x}" y="${h - 2}" text-anchor="middle" fill="var(--t3)" font-size="9">${h0}</text>`;
  }).join('');
  el.innerHTML = `<div class="act-river" role="img" aria-label="Activity river by hour">
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--m3-primary)" stop-opacity=".35"/>
          <stop offset="50%" stop-color="var(--m3-secondary, var(--m3-primary))" stop-opacity=".75"/>
          <stop offset="100%" stop-color="var(--m3-primary)" stop-opacity=".4"/>
        </linearGradient>
      </defs>
      <path class="river-fill" d="${d}" fill="url(#riverGrad)"/>
      <path class="river-stroke" d="${strokeD}"
        fill="none" stroke="var(--m3-primary)" stroke-width="1.5" opacity=".7"/>
      ${ticks}
    </svg>
    <div class="act-river-tip" aria-hidden="true">${tipText}</div>
  </div>`;
  return el;
}

/** Focus vs Distraction interactive balance */
export function renderFocusBalance(containerId, { focus = 0, distract = 0, other = 0, fmt, soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const sum = focus + distract + other;
  const existing = el.querySelector('.focus-bal');
  if (!sum) {
    if (soft && existing) return el;
    emptyState(el, 'Balance pending', 'Focus and distraction shares appear with category data.');
    return null;
  }
  const fPct = Math.round((focus / sum) * 100);
  const dPct = Math.round((distract / sum) * 100);
  const oPct = Math.max(0, 100 - fPct - dPct);

  if ((soft || existing) && existing) {
    const fBar = existing.querySelector('.focus-bal-focus');
    const oBar = existing.querySelector('.focus-bal-other');
    const dBar = existing.querySelector('.focus-bal-distract');
    const meter = existing.querySelector('.focus-bal-meter');
    if (fBar) {
      fBar.style.flex = String(Math.max(0.06, focus));
      fBar.title = `Focus ${fmt ? fmt(focus) : focus}`;
    }
    if (oBar) {
      oBar.style.flex = String(Math.max(0.02, other));
      oBar.title = `Other ${fmt ? fmt(other) : other}`;
    }
    if (dBar) {
      dBar.style.flex = String(Math.max(0.06, distract));
      dBar.title = `Distraction ${fmt ? fmt(distract) : distract}`;
    }
    if (meter) meter.setAttribute('aria-label', `Focus ${fPct} percent, distraction ${dPct} percent`);
    existing.querySelectorAll('.focus-bal-chip').forEach(btn => {
      const show = btn.dataset.show;
      if (show === 'focus') btn.innerHTML = `<span class="dot focus"></span>Focus ${fPct}% · ${fmt ? fmt(focus) : ''}`;
      else if (show === 'distract') btn.innerHTML = `<span class="dot distract"></span>Distract ${dPct}% · ${fmt ? fmt(distract) : ''}`;
      else if (show === 'both') btn.innerHTML = `<span class="dot both"></span>All · other ${oPct}%`;
    });
    return el;
  }

  el.innerHTML = `<div class="focus-bal" data-mode="both">
    <div class="focus-bal-meter" role="img" aria-label="Focus ${fPct} percent, distraction ${dPct} percent">
      <div class="focus-bal-focus" style="flex:${Math.max(0.06, focus)}" title="Focus ${fmt ? fmt(focus) : focus}"></div>
      <div class="focus-bal-other" style="flex:${Math.max(0.02, other)}" title="Other ${fmt ? fmt(other) : other}"></div>
      <div class="focus-bal-distract" style="flex:${Math.max(0.06, distract)}" title="Distraction ${fmt ? fmt(distract) : distract}"></div>
    </div>
    <div class="focus-bal-stats">
      <button type="button" class="focus-bal-chip on" data-show="focus"><span class="dot focus"></span>Focus ${fPct}% · ${fmt ? fmt(focus) : ''}</button>
      <button type="button" class="focus-bal-chip" data-show="distract"><span class="dot distract"></span>Distract ${dPct}% · ${fmt ? fmt(distract) : ''}</button>
      <button type="button" class="focus-bal-chip" data-show="both"><span class="dot both"></span>All · other ${oPct}%</button>
    </div>
  </div>`;
  const root = el.querySelector('.focus-bal');
  el.querySelectorAll('.focus-bal-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.focus-bal-chip').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      root.dataset.mode = btn.dataset.show;
    });
  });
  return el;
}

/** 24h circular Usage Rhythm */
export function renderUsageRhythm(containerId, hourSeries = [], { fmt, soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const vals = hourSeries || [];
  const max = Math.max(...vals, 0);
  const existing = el.querySelector('.usage-rhythm');
  if (!max) {
    if (soft && existing) return el;
    emptyState(el, 'No rhythm yet', 'Your 24-hour circle fills as hourly activity accumulates.');
    return null;
  }
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r0 = 48;
  const r1 = 92;
  const wedgesMeta = vals.map((v, h) => {
    const a0 = -Math.PI / 2 + (h / 24) * Math.PI * 2;
    const a1 = -Math.PI / 2 + ((h + 1) / 24) * Math.PI * 2;
    const ratio = 0.15 + 0.85 * (v / max);
    const r = r0 + (r1 - r0) * ratio;
    const x0 = cx + Math.cos(a0) * r0;
    const y0 = cy + Math.sin(a0) * r0;
    const x1 = cx + Math.cos(a0) * r;
    const y1 = cy + Math.sin(a0) * r;
    const x2 = cx + Math.cos(a1) * r;
    const y2 = cy + Math.sin(a1) * r;
    const x3 = cx + Math.cos(a1) * r0;
    const y3 = cy + Math.sin(a1) * r0;
    const large = 0;
    const op = 0.25 + 0.75 * (v / max);
    const tip = `${h}:00 · ${fmt ? fmt(v) : Math.round(v / 60) + 'm'}`;
    const d = `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} A${r0} ${r0} 0 ${large} 0 ${x0.toFixed(1)} ${y0.toFixed(1)} Z`;
    return { d, op, tip, h };
  });
  const now = new Date().getHours();
  const peak = vals.indexOf(max);

  if ((soft || existing) && existing) {
    const paths = existing.querySelectorAll('.rhythm-wedge');
    wedgesMeta.forEach((m, i) => {
      const p = paths[i];
      if (!p) return;
      p.setAttribute('d', m.d);
      p.setAttribute('opacity', m.op.toFixed(2));
      const t = p.querySelector('title');
      if (t) t.textContent = m.tip;
    });
    const texts = existing.querySelectorAll('svg > text');
    if (texts[0]) texts[0].textContent = `${peak}:00`;
    const nowDot = existing.querySelector('svg > circle:last-of-type');
    if (nowDot && nowDot.getAttribute('r') === '3.5') {
      nowDot.setAttribute('cx', String(cx + Math.cos(-Math.PI / 2 + (now / 24) * Math.PI * 2) * (r1 + 6)));
      nowDot.setAttribute('cy', String(cy + Math.sin(-Math.PI / 2 + (now / 24) * Math.PI * 2) * (r1 + 6)));
    }
    return el;
  }

  const wedges = wedgesMeta.map(m =>
    `<path class="rhythm-wedge" data-h="${m.h}" d="${m.d}" fill="var(--m3-primary)" opacity="${m.op.toFixed(2)}"><title>${m.tip}</title></path>`
  ).join('');
  el.innerHTML = `<div class="usage-rhythm">
    <svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:240px;margin:0 auto;display:block" aria-label="24 hour usage rhythm">
      <circle cx="${cx}" cy="${cy}" r="${r0 - 6}" fill="var(--c2)" stroke="var(--c4)" stroke-width="1"/>
      ${wedges}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--t1)" font-size="13" font-weight="700">${peak}:00</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="var(--t3)" font-size="9">peak</text>
      <circle cx="${cx + Math.cos(-Math.PI / 2 + (now / 24) * Math.PI * 2) * (r1 + 6)}"
        cy="${cy + Math.sin(-Math.PI / 2 + (now / 24) * Math.PI * 2) * (r1 + 6)}" r="3.5" fill="var(--m3-secondary, var(--m3-primary))"/>
    </svg>
  </div>`;
  return el;
}

/** Simplified Activity Flow: Period → Category → Site */
export function renderActivityFlow(containerId, { total, catBreakdown = [], topSites = [], fmt, soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const existing = el.querySelector('.act-flow');
  if (!total || !catBreakdown.length) {
    if (soft && existing) return el;
    emptyState(el, 'Flow idle', 'Category → site flow draws once usage lands.');
    return null;
  }
  // Structure often changes with filters — soft keeps SVG mounted and replaces inner markup only when needed
  if (soft && existing) {
    // Recompute into a fragment then swap svg contents to avoid wiping CSS on outer shell
    const tmp = document.createElement('div');
    // fall through to build via shared helper by temporarily using hard path into tmp
    const built = buildActivityFlowSvg({ total, catBreakdown, topSites, fmt });
    const svg = existing.querySelector('svg');
    if (svg && built) {
      svg.innerHTML = built;
      return el;
    }
  }
  el.innerHTML = `<div class="act-flow" style="overflow-x:auto">
    <svg viewBox="0 0 680 220" width="100%" height="220" aria-label="Activity flow from time to category to site">
      ${buildActivityFlowSvg({ total, catBreakdown, topSites, fmt })}
    </svg>
  </div>`;
  return el;
}

function buildActivityFlowSvg({ total, catBreakdown = [], topSites = [], fmt }) {
  const cats = catBreakdown.slice(0, 5);
  const sites = topSites.slice(0, 6);
  const h = 220;
  const colX = [40, 280, 520];
  const catH = (h - 24) / Math.max(cats.length, 1);
  const siteH = (h - 24) / Math.max(sites.length, 1);

  function node(x, y, label, sub, color) {
    return `<g class="flow-node">
      <rect x="${x - 70}" y="${y - 16}" width="140" height="32" rx="16" fill="${color}" opacity=".15" stroke="${color}" stroke-width="1"/>
      <text x="${x}" y="${y - 2}" text-anchor="middle" fill="var(--t1)" font-size="10" font-weight="700">${label}</text>
      <text x="${x}" y="${y + 11}" text-anchor="middle" fill="var(--t3)" font-size="8">${sub}</text>
    </g>`;
  }

  const periodY = h / 2;
  let paths = '';
  cats.forEach((c, i) => {
    const y = 20 + i * catH + catH / 2;
    const t = (c.time / total);
    const op = 0.12 + t * 0.55;
    const col = c.color || cssVar('--m3-primary', '#6750a4');
    paths += `<path d="M${colX[0] + 70} ${periodY} C${colX[0] + 160} ${periodY}, ${colX[1] - 160} ${y}, ${colX[1] - 70} ${y}"
      fill="none" stroke="${col}" stroke-width="${Math.max(2, t * 28)}" opacity="${op}" class="flow-link"/>`;
  });
  sites.forEach((s, i) => {
    const y = 20 + i * siteH + siteH / 2;
    const cat = cats.find(c => c.category === s.category) || cats[0];
    const cy = cat ? 20 + cats.indexOf(cat) * catH + catH / 2 : periodY;
    const col = cat?.color || cssVar('--m3-primary', '#6750a4');
    const t = s.totalTime / total;
    paths += `<path d="M${colX[1] + 70} ${cy} C${colX[1] + 150} ${cy}, ${colX[2] - 150} ${y}, ${colX[2] - 70} ${y}"
      fill="none" stroke="${col}" stroke-width="${Math.max(1.5, t * 22)}" opacity="${0.1 + t * 0.5}" class="flow-link"/>`;
  });

  const nodes =
    node(colX[0], periodY, 'Time', fmt ? fmt(total) : '', cssVar('--m3-primary', '#6750a4')) +
    cats.map((c, i) => node(colX[1], 20 + i * catH + catH / 2, String(c.category).slice(0, 12), fmt ? fmt(c.time) : '', c.color || cssVar('--m3-primary', '#6750a4'))).join('') +
    sites.map((s, i) => node(colX[2], 20 + i * siteH + siteH / 2, String(s.domain).slice(0, 14), fmt ? fmt(s.totalTime) : '', cssVar('--m3-primary', '#6750a4'))).join('');

  return paths + nodes;
}

/** Session DNA — category segment stream from visit-weighted slices */
export function renderSessionDNA(containerId, segments = [], { fmt, soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const top = (segments || []).slice(0, 18);
  const existing = el.querySelector('.session-dna');
  if (!top.length) {
    if (soft && existing) return el;
    emptyState(el, 'No session DNA', 'Visit-weighted segments appear after site activity.');
    return null;
  }
  const total = top.reduce((s, x) => s + (x.time || 0), 0) || 1;
  const bars = top.map((s, i) => {
    const w = Math.max(2.5, (s.time / total) * 100);
    const col = s.color || cssVar('--m3-primary', '#6750a4');
    return `<div class="dna-seg" style="width:${w}%;background:${col};--i:${i}" title="${s.domain} · ${fmt ? fmt(s.time) : ''} · ${s.visits || 1} visits"></div>`;
  }).join('');
  const legend = top.slice(0, 5).map(s => `<span><i style="background:${s.color || 'var(--m3-primary)'}"></i>${String(s.domain).slice(0, 16)}</span>`).join('');
  if ((soft || existing) && existing) {
    const stream = existing.querySelector('.dna-stream');
    const leg = existing.querySelector('.dna-legend');
    if (stream) stream.innerHTML = bars;
    if (leg) leg.innerHTML = legend;
    return el;
  }
  el.innerHTML = `<div class="session-dna">
    <div class="dna-stream" role="img" aria-label="Session DNA stream">${bars}</div>
    <div class="dna-legend">${legend}</div>
  </div>`;
  return el;
}

/** Site switching velocity viz */
export function renderSwitchAnalytics(containerId, stats, { fmt, soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const existing = el.querySelector('.switch-ana');
  if (!stats || !stats.switches) {
    if (soft && existing) return el;
    emptyState(el, 'No switches yet', 'Average session and switch velocity unlock with visits.');
    return null;
  }
  const vel = Math.min(1, (stats.velocity || 0) / 40);
  const needles = 48;
  if ((soft || existing) && existing) {
    existing.querySelectorAll('.sw-tick').forEach((tick, i) => {
      tick.classList.toggle('on', i / needles <= vel);
    });
    const vals = existing.querySelectorAll('.sw-val');
    if (vals[0]) vals[0].textContent = fmt ? fmt(stats.avgSession) : Math.round(stats.avgSession / 60) + 'm';
    if (vals[1]) vals[1].textContent = String(Math.round(stats.switches));
    if (vals[2]) vals[2].textContent = (stats.velocity || 0).toFixed(1);
    return el;
  }
  const ticks = Array.from({ length: needles }, (_, i) => {
    const on = i / needles <= vel;
    const rot = -90 + (i / (needles - 1)) * 180;
    return `<span class="sw-tick ${on ? 'on' : ''}" style="--r:${rot}deg"></span>`;
  }).join('');
  el.innerHTML = `<div class="switch-ana">
    <div class="sw-gauge" aria-hidden="true">${ticks}</div>
    <div class="sw-metrics">
      <div><div class="sw-val">${fmt ? fmt(stats.avgSession) : Math.round(stats.avgSession / 60) + 'm'}</div><div class="sw-key">Avg session</div></div>
      <div><div class="sw-val">${Math.round(stats.switches)}</div><div class="sw-key">Switches</div></div>
      <div><div class="sw-val">${(stats.velocity || 0).toFixed(1)}</div><div class="sw-key">Per active hour</div></div>
    </div>
  </div>`;
  return el;
}

/** Focus Windows timeline */
export function renderFocusWindows(containerId, windows = [], { soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const existing = el.querySelector('.focus-windows');
  if (!windows.length) {
    if (soft && existing) return el;
    emptyState(el, 'No focus windows', 'High-intensity hour clusters show up after a patterned day.');
    return null;
  }
  const blocks = windows.map((w, i) => {
    const left = (w.start / 24) * 100;
    const width = Math.max(2, ((w.end - w.start) / 24) * 100);
    return `<div class="fw-block kind-${w.kind}" style="left:${left}%;width:${width}%;--i:${i}" title="${w.label} · ${w.kind}">
      <span>${w.label}</span>
    </div>`;
  }).join('');
  if ((soft || existing) && existing) {
    const rail = existing.querySelector('.fw-rail');
    if (rail) rail.innerHTML = blocks;
    return el;
  }
  el.innerHTML = `<div class="focus-windows">
    <div class="fw-rail">${blocks}</div>
    <div class="fw-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
  </div>`;
  return el;
}

/** Digital Fingerprint — flower/radial (not radar) */
export function renderDigitalFingerprint(containerId, axes = [], { soft = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const items = (axes || []).filter(a => a && a.key);
  const existing = el.querySelector('.fingerprint');
  if (!items.length || items.every(a => !(a.value > 0))) {
    if (soft && existing) return el;
    emptyState(el, 'Fingerprint forming', 'Your distinctive usage shape appears with more history.');
    return null;
  }
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const n = items.length;
  const petals = items.map((a, i) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const len = 28 + Math.max(0.08, Math.min(1, a.value)) * 78;
    const x = cx + Math.cos(ang) * len;
    const y = cy + Math.sin(ang) * len;
    const lx = cx + Math.cos(ang) * (len + 18);
    const ly = cy + Math.sin(ang) * (len + 18);
    const ortho = ang + Math.PI / 2;
    const spread = 10 + a.value * 14;
    const x1 = cx + Math.cos(ang) * 22 + Math.cos(ortho) * spread * 0.2;
    const y1 = cy + Math.sin(ang) * 22 + Math.sin(ortho) * spread * 0.2;
    const xb = x + Math.cos(ortho) * spread;
    const yb = y + Math.sin(ortho) * spread;
    const xc = x - Math.cos(ortho) * spread;
    const yc = y - Math.sin(ortho) * spread;
    const x2 = cx + Math.cos(ang) * 22 - Math.cos(ortho) * spread * 0.2;
    const y2 = cy + Math.sin(ang) * 22 - Math.sin(ortho) * spread * 0.2;
    return `<g class="fp-petal" style="--i:${i}">
      <path d="M${cx} ${cy} Q${x1.toFixed(1)} ${y1.toFixed(1)} ${xb.toFixed(1)} ${yb.toFixed(1)} Q${x.toFixed(1)} ${y.toFixed(1)} ${xc.toFixed(1)} ${yc.toFixed(1)} Q${x2.toFixed(1)} ${y2.toFixed(1)} ${cx} ${cy}"
        fill="var(--m3-primary)" opacity="${0.22 + a.value * 0.45}"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="var(--t2)" font-size="9" font-weight="600">${a.key}</text>
    </g>`;
  }).join('');

  if ((soft || existing) && existing && existing.querySelectorAll('.fp-petal').length === items.length) {
    const svg = existing.querySelector('svg');
    if (svg) {
      // Keep center circles; replace only petals
      svg.querySelectorAll('.fp-petal').forEach(n => n.remove());
      svg.insertAdjacentHTML('beforeend', petals);
    }
    return el;
  }

  el.innerHTML = `<div class="fingerprint">
    <svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:280px;margin:0 auto;display:block" aria-label="Digital fingerprint">
      <circle cx="${cx}" cy="${cy}" r="16" fill="var(--m3-primary-container)"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="var(--m3-primary)"/>
      ${petals}
    </svg>
  </div>`;
  return el;
}

/** Digital Pulse living wave */
export function renderDigitalPulse(containerId, intensity = 0.4) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  const p = Math.max(0.08, Math.min(1, intensity));
  const existing = el.querySelector('.digital-pulse');
  if (existing) {
    existing.style.setProperty('--pulse', String(p));
    const path = existing.querySelector('.pulse-path');
    if (path) {
      path.setAttribute('stroke-width', String(1.2 + p));
      path.setAttribute('d', `M0 20 Q40 ${20 - 12 * p} 80 20 T160 20 T240 20 T320 20 T400 20 T480 20 T560 20 T600 20`);
    }
    return el;
  }
  el.innerHTML = `<div class="digital-pulse" style="--pulse:${p}" aria-hidden="true">
    <svg viewBox="0 0 600 40" preserveAspectRatio="none" width="100%" height="40">
      <path class="pulse-path" d="M0 20 Q40 ${20 - 12 * p} 80 20 T160 20 T240 20 T320 20 T400 20 T480 20 T560 20 T600 20"
        fill="none" stroke="var(--m3-primary)" stroke-width="${1.2 + p}" stroke-linecap="round"/>
    </svg>
  </div>`;
  return el;
}

export function destroyAllCharts() {
  for (const id of [...CHARTS.keys()]) destroy(id);
}

// ── Crown SVG (used by duel) ──────────────────────────────────────────────────
function tvydCrownSvg() {
  return `<svg class="tvyd-crown-svg" width="22" height="18" viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
    <polyline points="1,15 4,5 9.5,10.5 11,2 12.5,10.5 18,5 21,15"/>
    <line x1="1" y1="17" x2="21" y2="17"/>
    <circle cx="4" cy="5" r="1" fill="currentColor" stroke="none"/>
    <circle cx="11" cy="2" r="1" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="5" r="1" fill="currentColor" stroke="none"/>
  </svg>`;
}

/**
 * Today vs Yesterday Duel — premium "dueling fuel tank" comparison viz.
 * Animates on first mount; soft-updates via CSS custom-property transitions.
 * todayMs / yesterdayMs are in SECONDS (same unit as the rest of the dashboard).
 */
export function renderTodayVsYesterdayDuel(containerId, todaySec, yesterdaySec, { fmt, soft = false } = {}) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return null;

  const todayVal  = Math.max(0, todaySec  || 0);
  const yestVal   = Math.max(0, yesterdaySec || 0);
  const max       = Math.max(todayVal, yestVal, 1);
  const todayRatio = todayVal  / max;
  const yestRatio  = yestVal   / max;
  // Clamp to at least 4% so even zero shows a tiny sliver
  const todayFill = Math.max(0.04, todayRatio);
  const yestFill  = Math.max(0.04, yestRatio);

  const primary   = cssVar('--m3-primary',   '#6750a4');
  const secondary = cssVar('--m3-secondary', '#625b71');
  const todayWins = todayVal >= yestVal;
  const noData    = !todayVal && !yestVal;
  const hasYest   = yestVal > 0;

  // ── Battle copy ────────────────────────────────────────────────────────────
  function duelCopy() {
    if (noData)    return 'No screen time logged yet — start browsing!';
    if (!hasYest)  return 'Yesterday was quiet — or it\'s your first day';
    const diff = Math.abs(todayVal - yestVal);
    const pct  = Math.round((diff / yestVal) * 100);
    if (pct < 4)   return 'Neck and neck — epic tie!';
    if (todayWins) return pct > 60 ? `Today is crushing it — ${pct}% more!` : `Today is ahead — ${pct}% more`;
    return pct > 60 ? `Yesterday went wilder — ${pct}% more!` : `Yesterday had the crown — ${pct}% more`;
  }

  function diffBadge() {
    if (!hasYest && !todayVal) return '';
    if (!hasYest) return 'New!';
    const diff = todayVal - yestVal;
    if (diff === 0) return '=';
    const pct = Math.round((Math.abs(diff) / yestVal) * 100);
    return diff > 0 ? `+${pct}%` : `\u2212${pct}%`;
  }

  const diffClass = todayWins && !noData ? 'is-up' : (!todayWins && hasYest) ? 'is-down' : 'is-tie';
  const todayLabel = fmt ? fmt(todayVal) : Math.round(todayVal / 60) + 'm';
  const yestLabel  = fmt ? fmt(yestVal)  : Math.round(yestVal  / 60) + 'm';
  const reduced    = prefersReduced();

  // ── Soft-update path: morph existing mount ─────────────────────────────────
  const existing = el.querySelector('.tvyd-duel');
  if (soft && existing) {
    existing.style.setProperty('--tvyd-t', String(todayFill));
    existing.style.setProperty('--tvyd-y', String(yestFill));
    const copyEl    = existing.querySelector('.tvyd-copy');
    const todayEl   = existing.querySelector('[data-tvyd="today"]');
    const yestEl    = existing.querySelector('[data-tvyd="yest"]');
    const diffEl    = existing.querySelector('.tvyd-diff');
    const crownT    = existing.querySelector('.tvyd-crown-t');
    const crownY    = existing.querySelector('.tvyd-crown-y');
    const emptyHint = existing.querySelector('.tvyd-empty-hint');
    if (copyEl)  copyEl.textContent = duelCopy();
    if (todayEl) todayEl.textContent = todayLabel;
    if (yestEl)  yestEl.textContent  = yestLabel;
    if (diffEl) {
      diffEl.textContent  = diffBadge();
      diffEl.className    = `tvyd-diff ${diffClass}`;
    }
    if (crownT) crownT.dataset.on = (!noData && todayWins)  ? '1' : '0';
    if (crownY) crownY.dataset.on = (!noData && !todayWins && hasYest) ? '1' : '0';
    if (emptyHint) emptyHint.hidden = hasYest || noData;
    return el;
  }

  // ── Full mount ──────────────────────────────────────────────────────────────
  el.innerHTML = `
<div class="tvyd-duel${reduced ? ' is-reduced' : ''}"
  style="--tvyd-t:${todayFill};--tvyd-y:${yestFill};--tvyd-primary:${primary};--tvyd-yest-col:${secondary}"
  role="img" aria-label="${duelCopy()}">

  <div class="tvyd-copy" aria-live="polite">${duelCopy()}</div>

  <div class="tvyd-arena" aria-hidden="true">

    <div class="tvyd-fighter is-today">
      <div class="tvyd-crown tvyd-crown-t" data-on="${(!noData && todayWins) ? '1' : '0'}" aria-hidden="true">
        ${tvydCrownSvg()}
      </div>
      <div class="tvyd-tank">
        <div class="tvyd-fill tvyd-fill-today">
          <div class="tvyd-wave-cap"></div>
        </div>
      </div>
      <div class="tvyd-name">Today</div>
      <div class="tvyd-val is-today" data-tvyd="today">${todayLabel}</div>
    </div>

    <div class="tvyd-mid">
      <div class="tvyd-vs-badge">VS</div>
      <div class="tvyd-diff ${diffClass}">${diffBadge()}</div>
    </div>

    <div class="tvyd-fighter is-yest">
      <div class="tvyd-crown tvyd-crown-y" data-on="${(!noData && !todayWins && hasYest) ? '1' : '0'}" aria-hidden="true">
        ${tvydCrownSvg()}
      </div>
      <div class="tvyd-tank">
        <div class="tvyd-fill tvyd-fill-yest">
          <div class="tvyd-wave-cap"></div>
        </div>
      </div>
      <div class="tvyd-name">Yesterday</div>
      <div class="tvyd-val is-yest" data-tvyd="yest">${yestLabel}</div>
    </div>

  </div>

  <div class="tvyd-empty-hint"${hasYest || noData ? ' hidden' : ''}>First day here! Come back tomorrow to see the battle.</div>
</div>`;
  return el;
}
