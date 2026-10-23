// layout.js – layout engine for the SidStation device: panels in a row (Osc1, arrows, Osc2, …, filter).
// Plain JS: tested in node and bundled into the v8 script max/sid.layout.js. All sizes in px.
//
// layout = { panels: [panel…], backs: [varname…] }
//   panel (kind "voice"): { id, kind, colW, gap, pad, items, sub: [osc, env] }  the voice: a column (items) followed
//                         by the sub-panels that are expanded; items with frame:true get rect [0,y,width,h]; a frame item
//                         with bg (see voiceShape) also gets a "shape" message: the tongues from its fold rows to the panels
//   panel (kind "osc"):   { id, kind, fullW, compactW, shift, items }  gone (no width) when show 0
//   panel (kind "env"):   { id, kind, owner, width, items }  visible when the owner has env 1 (independent of show)
//   panel (kind "table"): { id, kind, owner, width, items }  visible when the owner has table 1 (default 0)
//   panel (kind "fixed"): { id, kind, width, items }
//   item: { name, rect:[x,y,w,h] relative to the panel's left edge, when:"pulse" | ["pulse","pwlfo"] (shown
//          only when all the flags in the panel's state are ≠ 0), shift:true (moved panel.shift to the left when the pulse group is hidden),
//          compact:[rect] (alternative rect then) }
// The column with number/fold buttons/Active/Sync/Ring/Filter is its own fixed panel that is always visible.
// state = { [panel.id]: { show: 0|1, pulse: 0|1, env: 0|1 } }
// compute() gives absolute rects (null = out of the presentation) and the device width;
// messages() turns that into thispatcher scripts, only what changed since prev.

const LAYOUT_GAP = 6;

function pulseVisible(waveIndex) { return waveIndex === 2 || waveIndex === 3; }   // Pulse, Mixed

// state (optional): items with of/when are shown only while every flag in state[of] is ≠ 0 (e.g. the table's "OFF").
const shownBy = (it, state) => !it.of || [].concat(it.when).every((f) => ((state && state[it.of]) || {})[f] !== 0);
function placePanel(panel, st, state) {
  const out = [];
  if (panel.kind !== "osc") { for (const it of panel.items) out.push([it.name, shownBy(it, state) ? it.rect : null]); return { width: panel.width, out }; }
  const pulse = st.pulse !== 0;
  for (const it of panel.items) {
    const flags = Array.isArray(it.when) ? it.when : it.when ? [it.when] : [];
    if (flags.some((f) => st[f] === 0)) { out.push([it.name, null]); continue; }
    let r = it.rect;
    if (!pulse && it.compact) r = it.compact;
    else if (!pulse && it.shift) r = [r[0] - panel.shift, r[1], r[2], r[3]];
    out.push([it.name, r]);
  }
  return { width: pulse ? panel.fullW : panel.compactW, out };
}

function subHidden(sub, state) {
  const st = (state && state[sub.id]) || {};
  if (sub.kind === "osc") return st.show === 0 || !!st.fold;
  if (sub.kind === "env") return ((state && state[sub.owner]) || {}).env === 0;
  if (sub.kind === "table") return ((state && state[sub.owner]) || {}).table !== 1;
  return false;
}

function placeVoice(panel, state) {
  const out = [], pos = [];
  for (const it of panel.items) if (!it.frame) out.push([it.name, shownBy(it, state) ? it.rect : null]);   // e.g. the tbl label's dimmer
  let ix = panel.colW + panel.gap, any = false;
  for (const sub of panel.sub) {
    if (subHidden(sub, state)) { for (const it of sub.items) out.push([it.name, null]); pos.push(null); continue; }
    const { width, out: so } = placePanel(sub, (state && state[sub.id]) || {}, state);
    for (const [name, r] of so) out.push([name, r ? [r[0] + ix, r[1], r[2], r[3]] : null]);
    pos.push([ix, width]);
    ix += width + panel.gap; any = true;
  }
  const total = (any ? ix - panel.gap : panel.colW) + panel.pad;
  const shapes = [];
  for (const it of panel.items) if (it.frame) {
    out.push([it.name, [0, it.rect[1], total, it.rect[3]]]);
    if (it.bg) shapes.push([it.name, voiceShape(panel, it.bg, pos, state)]);
  }
  return { width: total, out, shapes };
}
// The voice background (sid.voicebg.js): one number list for "shape". Coordinates relative to the voice's left edge and the
// widget's top. bg = { mode: 0 mono | 1 colour, frame: [y0, y1], inner: [y0, y1], rows: [{ x, y, h, subs: [sub index…] }] }:
// each row is a fold button + label in the column; it is open when one of its sub-panels is visible, and its tongue
// leads to the first visible one of them (target = index in the list of visible sub-panels). row.c: colour index (default: by row).
// row.dim = { of, flag }: the row is drawn dashed while that flag is set (the table with Speed 0).
// [mode, bodyX, frameY0, frameY1, innerY0, innerY1, nrows, (open, x, y, h, target, colour, dim) × nrows, nvisible, (x, w) × nvisible]
function voiceShape(panel, bg, pos, state) {
  const vis = [], visIndex = pos.map((p) => (p ? vis.push(p) - 1 : -1));
  const r = [bg.mode || 0, panel.colW + panel.gap - 4, bg.frame[0], bg.frame[1], bg.inner[0], bg.inner[1], bg.rows.length];
  for (const row of bg.rows) {
    const t = row.subs.find((i) => pos[i]);
    const dim = row.dim && ((state && state[row.dim.of]) || {})[row.dim.flag] ? 1 : 0;
    r.push(t === undefined ? 0 : 1, row.x, row.y, row.h, t === undefined ? -1 : visIndex[t], row.c === undefined ? -1 : row.c, dim);
  }
  r.push(vis.length);
  for (const [x, w] of vis) r.push(x, w);
  return r;
}

// Initial state: everything expanded except sub-panels with initShow 0 (LFO 2–4: only the selected LFO is visible).
function initialState(layout) {
  const state = {};
  for (const p of layout.panels) {
    state[p.id] = { show: 1, pulse: 1, env: 1, pwlfo: 0, table: 0 };
    for (const s of p.sub || []) state[s.id] = { show: s.initShow === 0 ? 0 : 1, pulse: 1, env: 1, pwlfo: 0, tbloff: 1, poly: 0, single: 1, glide: 1, noglide: 0 };   // tbloff: Table Speed 0 (its initial value); poly/single: Poly off
  }
  return state;
}
// The LFO selector: sub-panels l1..l4 – only number k is visible (1..4).
function selectLfo(state, k) { for (let n = 1; n <= 4; n++) if (state["l" + n]) state["l" + n].show = n === k ? 1 : 0; }

function compute(layout, state) {
  let x = 0;
  const ops = [];
  for (const p of layout.panels) {
    const st = (state && state[p.id]) || {};
    if (subHidden(p, state)) { for (const it of p.items) ops.push({ name: it.name, rect: null }); continue; }
    const placed = p.kind === "voice" ? placeVoice(p, state) : placePanel(p, st, state);
    const { width, out } = placed;
    // a fixed panel's background (the overview's tongue): its sub-panels are static, bg.subs = [[x, w]…]
    const shapes = placed.shapes || p.items.filter((it) => it.bg && it.bg.subs).map((it) => [it.name, voiceShape({ colW: 4, gap: 0 }, it.bg, it.bg.subs, state)]);
    for (const [name, r] of out) ops.push({ name, rect: r ? [r[0] + x, r[1], r[2], r[3]] : null });
    for (const [name, shape] of shapes || []) ops.push({ name, shape });
    x += width + LAYOUT_GAP;
  }
  return { ops, width: x };
}

// prev: {name: "x y w h" | "hidden"} updated in place; null = send everything. backs: sendtoback in order, fronts: bringtofront last.
function messages(ops, prev, backs, fronts) {
  const msgs = [];
  const shapes = [];
  for (const o of ops) {
    if (o.shape) {                                                       // after the rects, so the widget has its new size
      const k = o.shape.join(" "), pk = o.name + "#shape";
      if (!prev || prev[pk] !== k) { if (prev) prev[pk] = k; shapes.push("script send " + o.name + " shape " + k); }
      continue;
    }
    const key = o.rect ? o.rect.join(" ") : "hidden";
    if (prev && prev[o.name] === key) continue;
    if (prev) prev[o.name] = key;
    if (!o.rect) msgs.push("script sendbox " + o.name + " presentation 0");
    else msgs.push("script sendbox " + o.name + " presentation 1", "script sendbox " + o.name + " presentation_rect " + key);
  }
  const moved = msgs.length;
  msgs.push(...shapes);
  if (moved) for (const b of backs || []) msgs.push("script sendtoback " + b);
  if (moved) for (const f of fronts || []) msgs.push("script bringtofront " + f);   // e.g. the name field on top of the overview
  return msgs;
}

if (typeof module !== "undefined" && module.exports) module.exports = { LAYOUT_GAP, pulseVisible, placePanel, placeVoice, voiceShape, initialState, selectLfo, compute, messages };
