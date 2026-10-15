// Habit Tracker — grid (checklist × 31) + radial rings + progress line + summary
import { renderHabitDoneChart } from './charts.js';
import { escapeHtml } from './utils.js';

function habitPalette() {
  const g = n => {
    try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
    catch { return ''; }
  };
  return [
    g('--m3-primary') || '#6750A4',
    g('--m3-secondary') || '#B3261E',
    g('--green') || '#386A20',
    g('--cyan') || '#006A6A',
    g('--yellow') || '#D4A017',
    g('--pink') || '#E85D4C',
    g('--purple') || '#6750A4',
    g('--t2') || '#5B5B7A',
  ];
}
const MAX_HABITS = 8;
const $ = id => document.getElementById(id);
const esc = escapeHtml;

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function daysInMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function uid() {
  return 'h' + Math.random().toString(36).slice(2, 9);
}

/** Empty board — user adds their own habits */
const EMPTY_BOARD = () => ({
  habits: [],
  marks: {},
  targets: {},
});

let board = EMPTY_BOARD();
let saveTimer = null;
let wired = false;
let focusNewHabit = false;

async function loadBoard() {
  const { habitBoard } = await chrome.storage.local.get(['habitBoard']);
  if (habitBoard && typeof habitBoard === 'object') {
    // migrate old daily[] shape → habits[]
    const habits = Array.isArray(habitBoard.habits)
      ? habitBoard.habits
      : Array.isArray(habitBoard.daily)
        ? habitBoard.daily.map(h => ({ id: h.id, name: h.name || '' }))
        : [];
    board = {
      habits: habits.slice(0, MAX_HABITS),
      marks: habitBoard.marks && typeof habitBoard.marks === 'object' ? habitBoard.marks : {},
      targets: habitBoard.targets && typeof habitBoard.targets === 'object' ? habitBoard.targets : {},
    };
  } else {
    board = EMPTY_BOARD();
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ habitBoard: board }), 180);
}

function monthLabel() {
  return new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function atMaxHabits() {
  return (board.habits || []).length >= MAX_HABITS;
}

function syncAddControls() {
  const full = atMaxHabits();
  document.querySelectorAll('.hb-add-habit').forEach(btn => {
    btn.disabled = full;
    btn.setAttribute('aria-disabled', full ? 'true' : 'false');
    if (full) btn.title = '8 habit max';
    else btn.removeAttribute('title');
  });
  const hint = $('hb-max-hint');
  if (hint) hint.classList.toggle('show', full);
  const tip = $('hb-grid-tip');
  if (tip) tip.hidden = !(board.habits || []).length;
  const progSub = $('hb-progress-sub');
  if (progSub) {
    progSub.textContent = (board.habits || []).length
      ? 'Habits done each day this month'
      : 'Add a habit to see daily progress.';
  }
  const radSub = $('hb-radial-sub');
  if (radSub) {
    radSub.textContent = (board.habits || []).length
      ? 'Each ring is a habit · tap a day to mark'
      : 'Add habits to fill the rings.';
  }
}

function addHabit() {
  if (atMaxHabits()) {
    syncAddControls();
    return;
  }
  board.habits.push({ id: uid(), name: '' });
  persist();
  focusNewHabit = true;
  renderAll();
}

function toggleMark(hid, day) {
  const mk = monthKey();
  if (!board.marks[mk]) board.marks[mk] = {};
  if (!board.marks[mk][hid]) board.marks[mk][hid] = {};
  board.marks[mk][hid][day] = !board.marks[mk][hid][day];
  if (!board.marks[mk][hid][day]) delete board.marks[mk][hid][day];
  persist();
  renderAll();
}

function daysDone(hid) {
  const marks = board.marks[monthKey()]?.[hid] || {};
  return Object.values(marks).filter(Boolean).length;
}

function donePerDay() {
  const n = daysInMonth();
  const marks = board.marks[monthKey()] || {};
  const habits = board.habits || [];
  const out = [];
  for (let d = 1; d <= n; d++) {
    let c = 0;
    habits.forEach(h => {
      if (marks[h.id]?.[d]) c += 1;
    });
    out.push(c);
  }
  return out;
}

/** —— Layout 1: Habit × day grid —— */
function renderGrid() {
  const wrap = $('hb-grid');
  if (!wrap) return;
  const n = daysInMonth();
  const mk = monthKey();
  const marks = board.marks[mk] || {};
  const habits = board.habits || [];

  if (!habits.length) {
    wrap.innerHTML = `<div class="hb-empty">
      <div class="m3-blob hb-empty-blob" aria-hidden="true"></div>
      <p>No habits yet</p>
      <span>Add one to start checking days off this month.</span>
      <button type="button" class="btn primary hb-add-habit" data-hb-add>Add habit</button>
    </div>`;
    return;
  }

  let html = '<div class="hb-grid-table"><div class="hb-g-row head"><div class="hb-g-lab">Habit</div>';
  for (let d = 1; d <= n; d++) html += `<div class="hb-g-cell head">${d}</div>`;
  html += '</div>';

  const COLORS = habitPalette();
  habits.forEach((h, hi) => {
    const col = COLORS[hi % COLORS.length];
    html += `<div class="hb-g-row"><div class="hb-g-lab" title="${esc(h.name || 'Untitled')}">${esc(h.name || 'Untitled')}</div>`;
    for (let d = 1; d <= n; d++) {
      const on = !!(marks[h.id] && marks[h.id][d]);
      html += `<button type="button" class="hb-g-cell ${on ? 'on' : ''}" data-hid="${esc(h.id)}" data-day="${d}" style="--c:${col}" aria-pressed="${on}" aria-label="${esc(h.name || 'Untitled')} day ${d}"></button>`;
    }
    html += '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.hb-g-cell[data-hid]').forEach(btn => {
    btn.addEventListener('click', () => toggleMark(btn.dataset.hid, +btn.dataset.day));
  });
}

/** —— Layout 2: Radial rings (scalloped center) —— */
function renderRadial() {
  const host = $('hb-ring');
  const list = $('hb-daily-list');
  if (!host || !list) return;
  const nDays = daysInMonth();
  const habits = board.habits || [];
  const mk = monthKey();
  const marks = board.marks[mk] || {};
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 132;
  const ringW = Math.min(13, (outer - 36) / Math.max(habits.length || 1, 1));

  // habit name fields
  if (!habits.length) {
    list.innerHTML = `<div class="hb-empty-inline">
      <span>Name up to ${MAX_HABITS} daily habits.</span>
      <button type="button" class="btn primary hb-add-habit" data-hb-add>Add habit</button>
    </div>`;
  } else {
    list.innerHTML = habits.map((h, i) => `
    <div class="hb-row">
      <span class="hb-swatch scallop" style="background:${habitPalette()[i % 8]}"></span>
      <span class="hb-num">${i + 1}</span>
      <input class="task-inp hb-name" data-id="${esc(h.id)}" value="${esc(h.name)}" maxlength="28" placeholder="e.g. Drink water" aria-label="Name this habit"/>
      <button type="button" class="hb-x" data-del="${esc(h.id)}" title="Remove habit" aria-label="Remove habit">×</button>
    </div>`).join('');
  }

  list.querySelectorAll('.hb-name').forEach(inp => {
    inp.addEventListener('change', () => {
      const h = board.habits.find(x => x.id === inp.dataset.id);
      if (h) {
        h.name = inp.value.trim();
        persist();
        renderGrid();
        renderSummary();
        renderProgress();
      }
    });
    inp.addEventListener('blur', () => {
      const h = board.habits.find(x => x.id === inp.dataset.id);
      if (!h) return;
      const trimmed = inp.value.trim();
      if (!trimmed) {
        h.name = '';
        inp.value = '';
        persist();
        renderGrid();
      }
    });
  });
  list.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', () => {
      board.habits = board.habits.filter(x => x.id !== b.dataset.del);
      delete board.targets[b.dataset.del];
      persist();
      renderAll();
    });
  });

  if (!habits.length) {
    host.innerHTML = `<div class="hb-empty hb-empty-ring">
      <div class="m3-blob hb-empty-blob" aria-hidden="true"></div>
      <p>No rings yet</p>
      <span>Add habits to fill the rings.</span>
      <button type="button" class="btn primary hb-add-habit" data-hb-add>Add habit</button>
    </div>`;
    return;
  }

  let svg = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" class="hb-ring-svg" aria-label="Daily habit rings">`;
  for (let d = 1; d <= nDays; d++) {
    const a = -Math.PI / 2 + ((d - 1) / nDays) * Math.PI * 2;
    const r = outer + 16;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" class="hb-day-num">${d}</text>`;
  }

  const COLORS = habitPalette();
  habits.forEach((h, hi) => {
    const r = outer - hi * (ringW + 3) - ringW / 2;
    const col = COLORS[hi % COLORS.length];
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--c4)" stroke-width="${ringW}" opacity=".5"/>`;
    for (let d = 1; d <= nDays; d++) {
      const a0 = -Math.PI / 2 + ((d - 1) / nDays) * Math.PI * 2;
      const a1 = -Math.PI / 2 + (d / nDays) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      const on = !!(marks[h.id] && marks[h.id][d]);
      const x = cx + Math.cos(mid) * r;
      const y = cy + Math.sin(mid) * r;
      const rr = Math.max(3.4, ringW * 0.4);
      svg += `<circle class="hb-dot scallop-dot ${on ? 'on' : ''}" data-hid="${esc(h.id)}" data-day="${d}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr}" fill="${on ? col : 'var(--c3)'}" stroke="${col}" stroke-width="${on ? 0 : 1.15}"/>`;
    }
  });

  // scalloped organic center blob
  svg += `<path class="hb-center-blob" d="M${cx - 22} ${cy} C${cx - 22} ${cy - 18} ${cx - 12} ${cy - 24} ${cx} ${cy - 24} C${cx + 14} ${cy - 24} ${cx + 24} ${cy - 14} ${cx + 24} ${cy} C${cx + 24} ${cy + 16} ${cx + 12} ${cy + 24} ${cx} ${cy + 24} C${cx - 14} ${cy + 24} ${cx - 22} ${cy + 14} ${cx - 22} ${cy}Z" fill="var(--m3-primary-container)" stroke="var(--m3-primary)" stroke-width="2"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--m3-primary)" font-size="9" font-weight="700">Month of</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="var(--t1)" font-size="10" font-weight="700">${esc(new Date().toLocaleString(undefined, { month: 'short' }))}</text></svg>`;
  host.innerHTML = svg;

  host.querySelectorAll('.hb-dot').forEach(dot => {
    dot.addEventListener('click', () => toggleMark(dot.dataset.hid, +dot.dataset.day));
  });
}

/** —— Progress line (Done / day) —— */
function renderProgress() {
  const n = daysInMonth();
  const labels = Array.from({ length: n }, (_, i) => String(i + 1));
  const data = donePerDay();
  const maxY = Math.max(10, (board.habits || []).length || 1);
  renderHabitDoneChart('hb-progress-chart', { labels, data, maxY }, { soft: true });
}

/** —— Summary: Target / Days achieved —— */
function renderSummary() {
  const el = $('hb-summary');
  if (!el) return;
  const habits = board.habits || [];
  if (!habits.length) {
    el.innerHTML = `<div class="hb-empty-inline">
      <span>Set a target for each habit.</span>
      <button type="button" class="btn primary hb-add-habit" data-hb-add>Add habit</button>
    </div>`;
    return;
  }
  el.innerHTML = `
    <div class="hb-sum-table">
      <div class="hb-sum-row head">
        <div class="hb-sum-lab"></div>
        ${habits.map((h, i) => `<div class="hb-sum-cell" title="${esc(h.name || 'Untitled')}">H${i + 1}</div>`).join('')}
      </div>
      <div class="hb-sum-row">
        <div class="hb-sum-lab">Target goals</div>
        ${habits.map(h => `
          <div class="hb-sum-cell">
            <input type="number" class="hb-target" data-id="${esc(h.id)}" min="0" max="31" value="${board.targets[h.id] ?? ''}" placeholder="—" aria-label="Target days for ${esc(h.name || 'habit')}"/>
          </div>`).join('')}
      </div>
      <div class="hb-sum-row">
        <div class="hb-sum-lab">Days achieved</div>
        ${habits.map(h => {
          const done = daysDone(h.id);
          const tgt = Number(board.targets[h.id]) || 0;
          const ok = tgt > 0 && done >= tgt;
          return `<div class="hb-sum-cell done ${ok ? 'hit' : ''}">${done}</div>`;
        }).join('')}
      </div>
    </div>`;

  el.querySelectorAll('.hb-target').forEach(inp => {
    inp.addEventListener('change', () => {
      const v = Math.max(0, Math.min(31, parseInt(inp.value, 10) || 0));
      if (v) board.targets[inp.dataset.id] = v;
      else delete board.targets[inp.dataset.id];
      persist();
      renderSummary();
    });
  });
}

function renderAll() {
  if ($('hb-month-lbl')) $('hb-month-lbl').textContent = monthLabel();
  renderGrid();
  renderRadial();
  renderProgress();
  renderSummary();
  syncAddControls();

  if (focusNewHabit) {
    focusNewHabit = false;
    const inputs = document.querySelectorAll('#hb-daily-list .hb-name');
    const last = inputs[inputs.length - 1];
    if (last) {
      last.focus();
      last.select?.();
    }
  }
}

export async function renderHabitBoard() {
  await loadBoard();
  renderAll();
}

export function wireHabitBoard() {
  if (wired) return;
  wired = true;
  // Top + card Add buttons + empty-state CTAs (event delegation)
  document.getElementById('section-habits')?.addEventListener('click', e => {
    const btn = e.target.closest('.hb-add-habit');
    if (!btn || !document.getElementById('section-habits')?.contains(btn)) return;
    e.preventDefault();
    addHabit();
  });
}
