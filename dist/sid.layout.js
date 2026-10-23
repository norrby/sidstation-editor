// maxlog.js – shared log for all v8/v8ui scripts (bundled in by the build scripts).
// Everything goes to the Max console. For troubleshooting it can also go to a file – loading, arming, refused messages and,
// above all, exceptions caught in message handlers (sidguard) – but only when the log folder exists, since Max cannot create
// folders: create ~/Library/Logs/SidStation (macOS) to get max.log there. (Windows: not checked yet.)
//   sidlog(tag, ...parts)      write one line (post + file)
//   sidguard(tag, fn)          return fn wrapped in a try/catch that logs errors
const SIDLOG_FILE = "~/Library/Logs/SidStation/max.log";

function sidlog(tag) {
  const parts = Array.prototype.slice.call(arguments, 1).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)));
  const line = (function (d) { return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? "0" : "") + n; }).join(":"); })(new Date()) + " [" + tag + "] " + parts.join(" ");
  try { post(line + "\n"); } catch (e) {}
  try {
    if (typeof File === "undefined") return;
    const f = new File(SIDLOG_FILE, "write", "TEXT");
    if (f.isopen) { f.position = f.eof; f.writestring(line + "\n"); f.close(); }
  } catch (e) {}
}

function sidguard(tag, fn) {
  return function () {
    try { return fn.apply(this, arguments); }
    catch (e) {
      const where = e && e.stack ? " | " + String(e.stack).split("\n").slice(0, 2).join(" ") : "";
      sidlog(tag, "ERROR in " + (fn.name || "?") + "(" + Array.prototype.slice.call(arguments).join(" ") + "): " + (e && e.message || e) + where);
    }
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { sidlog, sidguard };


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


const LAYOUTS = {"SidStation":{"panels":[{"id":"map","kind":"fixed","width":298,"items":[{"name":"mapinnerframe","rect":[74,7,220,155]},{"name":"mapframe","rect":[0,0,298,169],"bg":{"mode":2,"frame":[3,166],"inner":[7,162],"rows":[{"x":3,"y":8,"h":96,"subs":[0],"c":4}],"subs":[[74,220]]}},{"name":"map","rect":[68,3,230,163]},{"name":"name","rect":[78,10,144,26]},{"name":"nameedit","rect":null},{"name":"c_poly","rect":[8,10,60,18]},{"name":"c_legato","rect":[8,32,60,18],"of":"o1","when":"glide"},{"name":"c_legatodim","rect":[8,32,60,18],"of":"o1","when":"noglide"},{"name":"c_hcut","rect":[16,54,44,48]},{"name":"c_sendall","rect":[8,133,60,15]},{"name":"c_fetch","rect":[8,116,60,15]},{"name":"c_store","rect":[8,150,60,15]}]},{"id":"v1","kind":"voice","colW":60,"gap":10,"pad":8,"items":[{"name":"o1_voiceframe","rect":[0,0,68,169],"frame":true,"bg":{"mode":1,"frame":[3,166],"inner":[7,162],"rows":[{"x":22,"y":10,"h":18,"subs":[0]},{"x":22,"y":32,"h":18,"subs":[1]},{"x":22,"y":54,"h":18,"subs":[2],"dim":{"of":"o1","flag":"tbloff"}}]}},{"name":"o1_digit","rect":[8,10,14,18]},{"name":"o1_title","rect":[44,11,24,15]},{"name":"o1_foldbtn","rect":[24,10,18,18]},{"name":"o1_envfoldbtn","rect":[24,32,18,18]},{"name":"o1_envlabel","rect":[44,33,24,15]},{"name":"o1_active","rect":[8,78,52,18],"of":"o1","when":"single"},{"name":"o1_activepoly","rect":[8,78,52,18],"of":"o1","when":"poly"},{"name":"o1_sync","rect":[8,101,52,18]},{"name":"o1_ring","rect":[8,124,52,18]},{"name":"o1_tblfoldbtn","rect":[24,54,18,18]},{"name":"o1_tbllabel","rect":[44,55,24,15]},{"name":"f_route1","rect":[8,147,52,18]},{"name":"o1_tbldimframe","rect":[44,55,24,15],"of":"o1","when":"tbloff"}],"sub":[{"id":"o1","kind":"osc","fullW":470,"compactW":270,"shift":200,"items":[{"name":"o1_oscframe","rect":[0,7,470,155],"compact":[0,7,270,155]},{"name":"o1_osctitle","rect":[8,10,100,15]},{"name":"o1_wavetitle","rect":[8,22,252,13],"compact":[8,22,40,13]},{"name":"o1_tonetitle","rect":[274,22,188,13],"shift":true},{"name":"o1_viblabel","rect":[418,80,48,15],"shift":true},{"name":"o1_wave","rect":[8,38,40,122]},{"name":"o1_pulse","rect":[56,38,204,70],"when":"pulse"},{"name":"o1_pwstart","rect":[56,110,44,48],"when":"pulse"},{"name":"o1_pwadd","rect":[104,110,44,48],"when":"pulse"},{"name":"o1_pwlfodepth","rect":[152,110,44,48],"when":"pulse"},{"name":"o1_pwsync","rect":[204,118,52,18],"when":"pulse"},{"name":"o1_pwlfo","rect":[204,140,52,18],"when":["pulse","pwlfo"]},{"name":"o1_transpose","rect":[274,38,44,48],"shift":true},{"name":"o1_detune","rect":[322,38,44,48],"shift":true},{"name":"o1_porta","rect":[370,38,44,48],"shift":true},{"name":"o1_arp","rect":[274,84,44,48],"shift":true},{"name":"o1_vibdepth","rect":[322,84,44,48],"shift":true},{"name":"o1_delay","rect":[370,84,44,48],"shift":true},{"name":"o1_pbrange","rect":[418,54,44,18],"shift":true},{"name":"o1_viblfo","rect":[418,96,44,18],"shift":true},{"name":"o1_pblabel","rect":[418,38,48,15],"shift":true},{"name":"o1_trackmode","rect":[274,134,92,18],"shift":true},{"name":"o1_notepick","rect":[370,134,44,18],"shift":true}]},{"id":"e1","kind":"env","owner":"o1","width":240,"items":[{"name":"o1_envframe","rect":[0,7,240,155]},{"name":"o1_envtitle","rect":[8,10,100,15]},{"name":"o1_envsection","rect":[8,22,224,13]},{"name":"o1_adsr","rect":[8,38,224,62]},{"name":"o1_gate","rect":[188,9,44,18]},{"name":"o1_attack","rect":[8,106,44,48]},{"name":"o1_decay","rect":[56,106,44,48]},{"name":"o1_sustain","rect":[104,106,44,48]},{"name":"o1_release","rect":[152,106,44,48]}]},{"id":"t1","kind":"table","owner":"o1","width":642,"items":[{"name":"o1_tableframe","rect":[0,7,642,155]},{"name":"o1_tabletitle","rect":[8,10,44,15]},{"name":"o1_table","rect":[58,10,576,148]},{"name":"o1_tableoff","rect":[8,88,44,15],"of":"o1","when":"tbloff"},{"name":"o1_tableloop","rect":[8,106,44,18]},{"name":"o1_tableclear","rect":[8,130,44,15]},{"name":"o1_tablespeed","rect":[8,38,44,48]}]}]},{"id":"v2","kind":"voice","colW":60,"gap":10,"pad":8,"items":[{"name":"o2_voiceframe","rect":[0,0,68,169],"frame":true,"bg":{"mode":1,"frame":[3,166],"inner":[7,162],"rows":[{"x":22,"y":10,"h":18,"subs":[0]},{"x":22,"y":32,"h":18,"subs":[1]},{"x":22,"y":54,"h":18,"subs":[2],"dim":{"of":"o2","flag":"tbloff"}}]}},{"name":"o2_digit","rect":[8,10,14,18]},{"name":"o2_title","rect":[44,11,24,15]},{"name":"o2_foldbtn","rect":[24,10,18,18]},{"name":"o2_envfoldbtn","rect":[24,32,18,18]},{"name":"o2_envlabel","rect":[44,33,24,15]},{"name":"o2_active","rect":[8,78,52,18]},{"name":"o2_sync","rect":[8,101,52,18]},{"name":"o2_ring","rect":[8,124,52,18]},{"name":"o2_tblfoldbtn","rect":[24,54,18,18]},{"name":"o2_tbllabel","rect":[44,55,24,15]},{"name":"f_route2","rect":[8,147,52,18]},{"name":"o2_tbldimframe","rect":[44,55,24,15],"of":"o2","when":"tbloff"}],"sub":[{"id":"o2","kind":"osc","fullW":470,"compactW":270,"shift":200,"items":[{"name":"o2_oscframe","rect":[0,7,470,155],"compact":[0,7,270,155]},{"name":"o2_osctitle","rect":[8,10,100,15]},{"name":"o2_wavetitle","rect":[8,22,252,13],"compact":[8,22,40,13]},{"name":"o2_tonetitle","rect":[274,22,188,13],"shift":true},{"name":"o2_viblabel","rect":[418,80,48,15],"shift":true},{"name":"o2_wave","rect":[8,38,40,122]},{"name":"o2_pulse","rect":[56,38,204,70],"when":"pulse"},{"name":"o2_pwstart","rect":[56,110,44,48],"when":"pulse"},{"name":"o2_pwadd","rect":[104,110,44,48],"when":"pulse"},{"name":"o2_pwlfodepth","rect":[152,110,44,48],"when":"pulse"},{"name":"o2_pwsync","rect":[204,118,52,18],"when":"pulse"},{"name":"o2_pwlfo","rect":[204,140,52,18],"when":["pulse","pwlfo"]},{"name":"o2_transpose","rect":[274,38,44,48],"shift":true},{"name":"o2_detune","rect":[322,38,44,48],"shift":true},{"name":"o2_porta","rect":[370,38,44,48],"shift":true},{"name":"o2_arp","rect":[274,84,44,48],"shift":true},{"name":"o2_vibdepth","rect":[322,84,44,48],"shift":true},{"name":"o2_delay","rect":[370,84,44,48],"shift":true},{"name":"o2_pbrange","rect":[418,54,44,18],"shift":true},{"name":"o2_viblfo","rect":[418,96,44,18],"shift":true},{"name":"o2_pblabel","rect":[418,38,48,15],"shift":true},{"name":"o2_trackmode","rect":[274,134,92,18],"shift":true},{"name":"o2_notepick","rect":[370,134,44,18],"shift":true}]},{"id":"e2","kind":"env","owner":"o2","width":240,"items":[{"name":"o2_envframe","rect":[0,7,240,155]},{"name":"o2_envtitle","rect":[8,10,100,15]},{"name":"o2_envsection","rect":[8,22,224,13]},{"name":"o2_adsr","rect":[8,38,224,62]},{"name":"o2_gate","rect":[188,9,44,18]},{"name":"o2_attack","rect":[8,106,44,48]},{"name":"o2_decay","rect":[56,106,44,48]},{"name":"o2_sustain","rect":[104,106,44,48]},{"name":"o2_release","rect":[152,106,44,48]}]},{"id":"t2","kind":"table","owner":"o2","width":642,"items":[{"name":"o2_tableframe","rect":[0,7,642,155]},{"name":"o2_tabletitle","rect":[8,10,44,15]},{"name":"o2_table","rect":[58,10,576,148]},{"name":"o2_tableoff","rect":[8,88,44,15],"of":"o2","when":"tbloff"},{"name":"o2_tableloop","rect":[8,106,44,18]},{"name":"o2_tableclear","rect":[8,130,44,15]},{"name":"o2_tablespeed","rect":[8,38,44,48]}]}]},{"id":"v3","kind":"voice","colW":60,"gap":10,"pad":8,"items":[{"name":"o3_voiceframe","rect":[0,0,68,169],"frame":true,"bg":{"mode":1,"frame":[3,166],"inner":[7,162],"rows":[{"x":22,"y":10,"h":18,"subs":[0]},{"x":22,"y":32,"h":18,"subs":[1]},{"x":22,"y":54,"h":18,"subs":[2],"dim":{"of":"o3","flag":"tbloff"}}]}},{"name":"o3_digit","rect":[8,10,14,18]},{"name":"o3_title","rect":[44,11,24,15]},{"name":"o3_foldbtn","rect":[24,10,18,18]},{"name":"o3_envfoldbtn","rect":[24,32,18,18]},{"name":"o3_envlabel","rect":[44,33,24,15]},{"name":"o3_active","rect":null},{"name":"o3_activebtn","rect":[8,78,52,18]},{"name":"o3_sync","rect":[8,101,52,18]},{"name":"o3_ring","rect":[8,124,52,18]},{"name":"o3_tblfoldbtn","rect":[24,54,18,18]},{"name":"o3_tbllabel","rect":[44,55,24,15]},{"name":"f_route3","rect":[8,147,52,18]},{"name":"o3_tbldimframe","rect":[44,55,24,15],"of":"o3","when":"tbloff"}],"sub":[{"id":"o3","kind":"osc","fullW":470,"compactW":270,"shift":200,"items":[{"name":"o3_oscframe","rect":[0,7,470,155],"compact":[0,7,270,155]},{"name":"o3_osctitle","rect":[8,10,100,15]},{"name":"o3_wavetitle","rect":[8,22,252,13],"compact":[8,22,40,13]},{"name":"o3_tonetitle","rect":[274,22,188,13],"shift":true},{"name":"o3_viblabel","rect":[418,80,48,15],"shift":true},{"name":"o3_wave","rect":[8,38,40,122]},{"name":"o3_pulse","rect":[56,38,204,70],"when":"pulse"},{"name":"o3_pwstart","rect":[56,110,44,48],"when":"pulse"},{"name":"o3_pwadd","rect":[104,110,44,48],"when":"pulse"},{"name":"o3_pwlfodepth","rect":[152,110,44,48],"when":"pulse"},{"name":"o3_pwsync","rect":[204,118,52,18],"when":"pulse"},{"name":"o3_pwlfo","rect":[204,140,52,18],"when":["pulse","pwlfo"]},{"name":"o3_transpose","rect":[274,38,44,48],"shift":true},{"name":"o3_detune","rect":[322,38,44,48],"shift":true},{"name":"o3_porta","rect":[370,38,44,48],"shift":true},{"name":"o3_arp","rect":[274,84,44,48],"shift":true},{"name":"o3_vibdepth","rect":[322,84,44,48],"shift":true},{"name":"o3_delay","rect":[370,84,44,48],"shift":true},{"name":"o3_pbrange","rect":[418,54,44,18],"shift":true},{"name":"o3_viblfo","rect":[418,96,44,18],"shift":true},{"name":"o3_pblabel","rect":[418,38,48,15],"shift":true},{"name":"o3_trackmode","rect":[274,134,92,18],"shift":true},{"name":"o3_notepick","rect":[370,134,44,18],"shift":true}]},{"id":"e3","kind":"env","owner":"o3","width":240,"items":[{"name":"o3_envframe","rect":[0,7,240,155]},{"name":"o3_envtitle","rect":[8,10,100,15]},{"name":"o3_envsection","rect":[8,22,224,13]},{"name":"o3_adsr","rect":[8,38,224,62]},{"name":"o3_gate","rect":[188,9,44,18]},{"name":"o3_attack","rect":[8,106,44,48]},{"name":"o3_decay","rect":[56,106,44,48]},{"name":"o3_sustain","rect":[104,106,44,48]},{"name":"o3_release","rect":[152,106,44,48]}]},{"id":"t3","kind":"table","owner":"o3","width":642,"items":[{"name":"o3_tableframe","rect":[0,7,642,155]},{"name":"o3_tabletitle","rect":[8,10,44,15]},{"name":"o3_table","rect":[58,10,576,148]},{"name":"o3_tableoff","rect":[8,88,44,15],"of":"o3","when":"tbloff"},{"name":"o3_tableloop","rect":[8,106,44,18]},{"name":"o3_tableclear","rect":[8,130,44,15]},{"name":"o3_tablespeed","rect":[8,38,44,48]}]}]},{"id":"vf","kind":"voice","colW":60,"gap":10,"pad":8,"items":[{"name":"f_voiceframe","rect":[0,0,68,169],"frame":true,"bg":{"mode":1,"frame":[3,166],"inner":[7,162],"rows":[{"x":14,"y":10,"h":18,"subs":[0]},{"x":14,"y":32,"h":18,"subs":[1]}]}},{"name":"f_fold","rect":[16,10,18,18]},{"name":"f_label","rect":[36,11,34,15]},{"name":"f_envfold","rect":[16,32,18,18]},{"name":"f_envlabel","rect":[36,33,34,15]}],"sub":[{"id":"f","kind":"osc","fullW":340,"compactW":340,"shift":0,"items":[{"name":"f_frame","rect":[0,7,340,155]},{"name":"f_title","rect":[8,10,100,15]},{"name":"f_section","rect":[8,22,224,13]},{"name":"f_curve","rect":[8,38,224,62]},{"name":"f_legend","rect":[288,38,44,62]},{"name":"f_typelabel","rect":[238,38,44,13]},{"name":"f_lfolabel","rect":[238,76,44,13]},{"name":"f_cutoff","rect":[8,106,44,48]},{"name":"f_res","rect":[56,106,44,48]},{"name":"f_lfodepth","rect":[104,106,44,48]},{"name":"f_wheel","rect":[152,106,44,48]},{"name":"f_flfo","rect":[238,90,44,18]},{"name":"f_ftype","rect":[238,52,44,18]},{"name":"f_wrap","rect":[238,114,44,18]}]},{"id":"fe","kind":"env","owner":"f","width":290,"items":[{"name":"f_envframe","rect":[0,7,290,155]},{"name":"f_envtitle","rect":[8,10,120,15]},{"name":"f_envsection","rect":[8,22,224,13]},{"name":"f_adsr","rect":[8,38,224,62]},{"name":"f_depthlabel","rect":[234,24,44,13]},{"name":"f_depthslider","rect":[234,38,24,76]},{"name":"f_fattack","rect":[8,106,44,48]},{"name":"f_fdecay","rect":[56,106,44,48]},{"name":"f_fsustain","rect":[104,106,44,48]},{"name":"f_frelease","rect":[152,106,44,48]},{"name":"f_invert","rect":[234,120,44,18]}]}]},{"id":"vl","kind":"voice","colW":60,"gap":10,"pad":8,"items":[{"name":"l_voiceframe","rect":[0,0,68,169],"frame":true,"bg":{"mode":1,"frame":[3,166],"inner":[7,162],"rows":[{"x":14,"y":10,"h":18,"subs":[0],"c":3},{"x":14,"y":32,"h":18,"subs":[1],"c":3},{"x":14,"y":54,"h":18,"subs":[2],"c":3},{"x":14,"y":76,"h":18,"subs":[3],"c":3}]}},{"name":"l_fold1","rect":[16,10,18,18]},{"name":"l_label1","rect":[36,11,34,15]},{"name":"l_fold2","rect":[16,32,18,18]},{"name":"l_label2","rect":[36,33,34,15]},{"name":"l_fold3","rect":[16,54,18,18]},{"name":"l_label3","rect":[36,55,34,15]},{"name":"l_fold4","rect":[16,76,18,18]},{"name":"l_label4","rect":[36,77,34,15]}],"sub":[{"id":"l1","kind":"osc","fullW":482,"compactW":482,"shift":0,"items":[{"name":"l1_frame","rect":[0,7,482,155]},{"name":"l1_title","rect":[8,10,100,15]},{"name":"l1_wavesec","rect":[8,22,192,13]},{"name":"l1_optsec","rect":[206,22,72,13]},{"name":"l1_shapesec","rect":[206,80,72,13]},{"name":"l1_addsec","rect":[284,22,44,13]},{"name":"l1_lacesec","rect":[332,22,44,13]},{"name":"l1_ctrlsec","rect":[382,22,92,13]},{"name":"l1_view","rect":[8,38,192,44]},{"name":"l1_type","rect":[8,86,192,16]},{"name":"l1_speed","rect":[8,106,44,48]},{"name":"l1_depth","rect":[56,106,44,48]},{"name":"l1_fadein","rect":[104,106,44,48]},{"name":"l1_samphold","rect":[152,106,44,48]},{"name":"l1_notesync","rect":[206,38,72,18]},{"name":"l1_invert","rect":[206,96,72,18]},{"name":"l1_abovezero","rect":[206,116,72,18]},{"name":"l1_offsync","rect":[206,58,72,18]},{"name":"l1_addlfo","rect":[284,38,44,18]},{"name":"l1_adddepth","rect":[284,62,44,48]},{"name":"l1_lacewith","rect":[332,38,44,18]},{"name":"l1_lace","rect":[332,62,44,48]},{"name":"l1_source","rect":[382,38,92,18]},{"name":"l1_dest","rect":[382,62,92,18]},{"name":"l1_ctrlval","rect":[382,106,44,48]}]},{"id":"l2","kind":"osc","fullW":482,"compactW":482,"shift":0,"items":[{"name":"l2_frame","rect":[0,7,482,155]},{"name":"l2_title","rect":[8,10,100,15]},{"name":"l2_wavesec","rect":[8,22,192,13]},{"name":"l2_optsec","rect":[206,22,72,13]},{"name":"l2_shapesec","rect":[206,80,72,13]},{"name":"l2_addsec","rect":[284,22,44,13]},{"name":"l2_lacesec","rect":[332,22,44,13]},{"name":"l2_ctrlsec","rect":[382,22,92,13]},{"name":"l2_view","rect":[8,38,192,44]},{"name":"l2_type","rect":[8,86,192,16]},{"name":"l2_speed","rect":[8,106,44,48]},{"name":"l2_depth","rect":[56,106,44,48]},{"name":"l2_fadein","rect":[104,106,44,48]},{"name":"l2_samphold","rect":[152,106,44,48]},{"name":"l2_notesync","rect":[206,38,72,18]},{"name":"l2_invert","rect":[206,96,72,18]},{"name":"l2_abovezero","rect":[206,116,72,18]},{"name":"l2_offsync","rect":[206,58,72,18]},{"name":"l2_addlfo","rect":[284,38,44,18]},{"name":"l2_adddepth","rect":[284,62,44,48]},{"name":"l2_lacewith","rect":[332,38,44,18]},{"name":"l2_lace","rect":[332,62,44,48]},{"name":"l2_source","rect":[382,38,92,18]},{"name":"l2_dest","rect":[382,62,92,18]},{"name":"l2_ctrlval","rect":[382,106,44,48]}],"initShow":0},{"id":"l3","kind":"osc","fullW":482,"compactW":482,"shift":0,"items":[{"name":"l3_frame","rect":[0,7,482,155]},{"name":"l3_title","rect":[8,10,100,15]},{"name":"l3_wavesec","rect":[8,22,192,13]},{"name":"l3_optsec","rect":[206,22,72,13]},{"name":"l3_shapesec","rect":[206,80,72,13]},{"name":"l3_addsec","rect":[284,22,44,13]},{"name":"l3_lacesec","rect":[332,22,44,13]},{"name":"l3_ctrlsec","rect":[382,22,92,13]},{"name":"l3_view","rect":[8,38,192,44]},{"name":"l3_type","rect":[8,86,192,16]},{"name":"l3_speed","rect":[8,106,44,48]},{"name":"l3_depth","rect":[56,106,44,48]},{"name":"l3_fadein","rect":[104,106,44,48]},{"name":"l3_samphold","rect":[152,106,44,48]},{"name":"l3_notesync","rect":[206,38,72,18]},{"name":"l3_invert","rect":[206,96,72,18]},{"name":"l3_abovezero","rect":[206,116,72,18]},{"name":"l3_offsync","rect":[206,58,72,18]},{"name":"l3_addlfo","rect":[284,38,44,18]},{"name":"l3_adddepth","rect":[284,62,44,48]},{"name":"l3_lacewith","rect":[332,38,44,18]},{"name":"l3_lace","rect":[332,62,44,48]},{"name":"l3_source","rect":[382,38,92,18]},{"name":"l3_dest","rect":[382,62,92,18]},{"name":"l3_ctrlval","rect":[382,106,44,48]}],"initShow":0},{"id":"l4","kind":"osc","fullW":482,"compactW":482,"shift":0,"items":[{"name":"l4_frame","rect":[0,7,482,155]},{"name":"l4_title","rect":[8,10,100,15]},{"name":"l4_wavesec","rect":[8,22,192,13]},{"name":"l4_optsec","rect":[206,22,72,13]},{"name":"l4_shapesec","rect":[206,80,72,13]},{"name":"l4_addsec","rect":[284,22,44,13]},{"name":"l4_lacesec","rect":[332,22,44,13]},{"name":"l4_ctrlsec","rect":[382,22,92,13]},{"name":"l4_view","rect":[8,38,192,44]},{"name":"l4_type","rect":[8,86,192,16]},{"name":"l4_speed","rect":[8,106,44,48]},{"name":"l4_depth","rect":[56,106,44,48]},{"name":"l4_fadein","rect":[104,106,44,48]},{"name":"l4_samphold","rect":[152,106,44,48]},{"name":"l4_notesync","rect":[206,38,72,18]},{"name":"l4_invert","rect":[206,96,72,18]},{"name":"l4_abovezero","rect":[206,116,72,18]},{"name":"l4_offsync","rect":[206,58,72,18]},{"name":"l4_addlfo","rect":[284,38,44,18]},{"name":"l4_adddepth","rect":[284,62,44,48]},{"name":"l4_lacewith","rect":[332,38,44,18]},{"name":"l4_lace","rect":[332,62,44,48]},{"name":"l4_source","rect":[382,38,92,18]},{"name":"l4_dest","rect":[382,62,92,18]},{"name":"l4_ctrlval","rect":[382,106,44,48]}],"initShow":0}]}],"backs":["mapinnerframe","l4_frame","l3_frame","l2_frame","l1_frame","f_frame","f_envframe","o3_oscframe","o3_envframe","o2_oscframe","o2_envframe","o1_oscframe","o1_envframe","o3_tableframe","o2_tableframe","o1_tableframe","mapframe","l_voiceframe","f_voiceframe","o3_voiceframe","o2_voiceframe","o1_voiceframe"],"fronts":["name"]}};


// sid.layout.js – v8: owns every presentation rect in the device. Built together with lib/maxlog.js,
// lib/layout.js and LAYOUTS (generated by build/build-station.js) into dist/sid.layout.js.
//   [v8 sid.layout.js <devicename>]  outlet 0 -> [thispatcher], outlet 1 -> [deferlow] -> [live.thisdevice]
// In:  wave <n> <index>   waveform on osc n (the pulse group shows for Pulse/Mixed)
//      pwlfo <n> <depth>  PW LFO depth on osc n (the LFO selector only shows when the depth > 0)
//      show <n> <0|1>     expand/collapse osc n (collapsed = only number and fold button)
//      env <n> <0|1>      show/hide the envelope panel for osc n
//      table <n> <0|1>    show/hide the waveform table panel for osc n (collapsed by default)
//      tblspeed <n> <v>   Table Speed of osc n (0 = table off: its row dashed, the label dimmed)
//      fold <n> <0|1>     like show, inverted
//      lfosel <0..3>      the LFO selector (live.tab "LFO Select"): only that LFO's sub-panel shows
//      lfoshow <0|1>      the LFO section's fold button: 0 = only the column
//      bang               send the whole layout (on load)

inlets = 1;
outlets = 2;

const devname = jsarguments.length > 1 ? String(jsarguments[1]) : "SidStation";
const layout = LAYOUTS[devname];
const state = layout ? initialState(layout) : {};
let prev = null;

function send(msg) {
  const atoms = msg.split(" ").map((a) => (/^-?\d+$/.test(a) ? Number(a) : a));
  outlet.apply(null, [0].concat(atoms));
}

function relayout(all) {
  if (!layout) { sidlog("layout", "unknown layout", devname); return; }
  const r = compute(layout, state);
  const msgs = messages(r.ops, all ? null : prev, layout.backs, layout.fronts);
  if (all) { prev = {}; for (const o of r.ops) if (o.shape) prev[o.name + "#shape"] = o.shape.join(" "); else prev[o.name] = o.rect ? o.rect.join(" ") : "hidden"; }
  for (const m of msgs) send(m);
  if (msgs.length || all) outlet(1, "setwidth", r.width);
}

function pwlfo(n, depth) { const s = state["o" + n]; if (!s) return; s.pwlfo = Number(depth) > 0 ? 1 : 0; relayout(false); }
function wave(n, idx) { const s = state["o" + n]; if (!s) return; s.pulse = pulseVisible(idx | 0) ? 1 : 0; relayout(false); }
function fold(n, v) { const s = state["o" + n]; if (!s) return; s.fold = v ? 1 : 0; sidlog("layout", "fold", n, s.fold); relayout(false); }
// n: osc number (-> "o<n>") or a panel id such as "f" (the filter)
function key(n) { return typeof n === "number" ? "o" + n : String(n); }
function env(n, v) { const s = state[key(n)]; if (!s) return; s.env = v ? 1 : 0; sidlog("layout", "env", n, s.env); relayout(false); }
function table(n, v) { const s = state[key(n)]; if (!s) return; s.table = v ? 1 : 0; sidlog("layout", "table", n, s.table); relayout(false); }
// tblspeed <n> <speed>: Table Speed of osc n; 0 = the table is off -> its fold row is drawn dashed and the "tbl" label dimmed
function tblspeed(n, v) { const s = state["o" + n]; if (!s) return; s.tbloff = Number(v) > 0 ? 0 : 1; relayout(false); }
// poly <v>: Poly mode swaps osc 1's Active for its always-on stand-in (o1_activepoly)
function poly(v) { const s = state.o1; if (!s) return; s.poly = v ? 1 : 0; s.single = 1 - s.poly; sidlog("layout", "poly", s.poly); relayout(false); }
// glide <v>: some oscillator has Portamento > 0; without it Legato does nothing and its greyed stand-in is shown (c_legatodim)
function glide(v) { const s = state.o1; if (!s) return; s.glide = v ? 1 : 0; s.noglide = 1 - s.glide; sidlog("layout", "glide", s.glide); relayout(false); }
function show(n, v) { const s = state[key(n)]; if (!s) return; s.show = v ? 1 : 0; sidlog("layout", "show", n, s.show); relayout(false); }
function lfosel(i) { selectLfo(state, (i | 0) + 1); sidlog("layout", "lfo", (i | 0) + 1); relayout(false); }
function lfoshow(v) { for (let n = 1; n <= 4; n++) if (state["l" + n]) state["l" + n].fold = v ? 0 : 1; sidlog("layout", "lfoshow", v ? 1 : 0); relayout(false); }
function bang() { relayout(true); sidlog("layout", devname, "laid out, width", compute(layout, state).width); }

wave = sidguard("layout", wave); pwlfo = sidguard("layout", pwlfo); fold = sidguard("layout", fold); show = sidguard("layout", show); env = sidguard("layout", env); table = sidguard("layout", table); bang = sidguard("layout", bang); lfosel = sidguard("layout", lfosel); lfoshow = sidguard("layout", lfoshow); tblspeed = sidguard("layout", tblspeed); poly = sidguard("layout", poly); glide = sidguard("layout", glide);
sidlog("layout", "loaded", devname, layout ? "" : "(unknown layout)");
