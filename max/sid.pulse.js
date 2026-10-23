// sid.pulse.js – pulse width widget for v8ui (Max 9), the SidStation editor.
//
// Several periods (default 3) of the pulse wave as a step function. The SID chip gives
// low output from the start of the period until the phase accumulator reaches PW, then high until
// the end of the period. The value (OSC_PWM_START 0..127) is the position of the rising edge in
// the FIRST period, and only that edge can be dragged (absolute, the dot follows the mouse). Verified on hardware:
// 0 = constant level, silent; 1 = thin pulse; 64 = square; 127 = thin
// pulse (not silent). 0 is drawn as a completely filled period with a flat top line: the output
// is high all the time, hence the silence.
//
// PWM_ADD (0..127) is added to the pulse width every update cycle. It is a
// rate, and is illustrated by the edge in period k lying at
// start + k·add·addScale, clamped to the thinnest pulse: the next pulse gets slightly
// narrower. (The SID's 12-bit register actually wraps around, but that makes the picture
// incomprehensible.) The scale is exaggerated on purpose: in reality many
// periods pass per update cycle.
//
// In:  start n        sets and outputs
//      set start n    sets silently (from live.*);  set add n   likewise
//      add n          sets Add silently (owned by the panel's dial, not output)
//      bang           outputs start
//      steps n        number of positions per period (128 for SidStation)
//      periods n      number of drawn periods (default 3)
//      addscale f     shift per period in positions per Add unit (default 0.25)
//      labels 0|1     text line
//      color bg|grid|fill|line|handle|text r g b a
// Out: "start n" on outlet 0, only on change or bang.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const cfg = {
  steps: 128, periods: 3, addScale: 0.25, labels: 1, pad: 8, handle: 5,
  colors: {
    bg: UI.bg, grid: UI.grid, fill: UI.fill,
    line: UI.line, ghost: [0.4, 0.75, 1, 0.55], handle: [1, 1, 1, 1], text: UI.text,
  },
};
let start = 64;
let addv = 0;
let dragging = false;

// The edge's position (in positions) in period k; 0 = no edge, constant level.
// No wrap: the SID register does wrap around, but as an illustration the
// picture should always read "narrower, narrower", so the edge stops at the thinnest pulse.
function edge(k) {
  if (k === 0) return start;
  return Math.min(cfg.steps - 1, Math.round(start + k * addv * cfg.addScale));
}

function geom() {
  const size = mgraphics.size;
  const w = size[0], h = size[1], pad = cfg.pad;
  const top = pad, bottom = h - pad - (cfg.labels ? 14 : 0);
  const u = (w - 2 * pad) / (cfg.steps * cfg.periods);   // one position
  const pw = cfg.steps * u;                              // one period
  const x0 = pad, x1 = w - pad;
  const xs = x0 + start * u;                             // dragbar flank (period 1)
  const edges = [];
  for (let k = 0; k < cfg.periods; k++) edges.push(edge(k));
  return { w, h, pad, top, bottom, u, pw, x0, x1, xs, edges };
}

function clamp(v) { return Math.max(0, Math.min(cfg.steps - 1, Math.round(v))); }

function paint() {
  const g = geom();
  const c = cfg.colors;
  mgraphics.set_source_rgba(c.bg);
  mgraphics.rectangle(0, 0, g.w, g.h);
  mgraphics.fill();

  mgraphics.set_line_width(1.5);
  for (let k = 0; k < cfg.periods; k++) {
    const px0 = g.x0 + k * g.pw, px1 = px0 + g.pw;
    const e = g.edges[k];
    mgraphics.set_source_rgba(k === 0 ? c.line : c.ghost);
    if (e === 0) {
      // constant high level for the whole period: completely filled, top line only, no edges
      mgraphics.set_source_rgba(c.fill);
      mgraphics.rectangle(px0, g.top, px1 - px0, g.bottom - g.top);
      mgraphics.fill();
      mgraphics.set_source_rgba(k === 0 ? c.line : c.ghost);
      mgraphics.move_to(px0, g.top);
      mgraphics.line_to(px1, g.top);
      mgraphics.stroke();
      continue;
    }
    const xe = px0 + e * g.u;
    mgraphics.set_source_rgba(c.fill);
    mgraphics.rectangle(xe, g.top, px1 - xe, g.bottom - g.top);
    mgraphics.fill();
    mgraphics.set_source_rgba(k === 0 ? c.line : c.ghost);
    mgraphics.move_to(px0, g.bottom);
    mgraphics.line_to(xe, g.bottom);
    mgraphics.line_to(xe, g.top);
    mgraphics.line_to(px1, g.top);
    mgraphics.line_to(px1, g.bottom);
    mgraphics.stroke();
  }

  mgraphics.set_source_rgba(c.handle);
  mgraphics.ellipse(g.xs - cfg.handle, (g.top + g.bottom) / 2 - cfg.handle, 2 * cfg.handle, 2 * cfg.handle);
  mgraphics.fill();

  if (cfg.labels) {
    mgraphics.set_source_rgba(c.text);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(10);
    mgraphics.move_to(g.pad, g.h - 4);
    mgraphics.show_text(label());
  }
}

function label() {
  const addTxt = addv > 0 ? "  Add " + addv : "";
  if (start === 0) return "PW 0  quiet" + addTxt;
  const high = Math.round(100 * (1 - start / cfg.steps));
  return "PW " + start + "  " + high + " %" + addTxt;
}

// Absolute drag: the dot follows the mouse. The first period is narrow, so the pixels give
// jumps of a few steps; exact values are set with the PW dial in the panel.
function onclick(x, y) {
  const g = geom();
  if (x > g.x0 + g.pw + cfg.handle) return;        // only the first period is dragged
  dragging = true;
  ondrag(x, y, 1);
}

function ondrag(x, y, but) {
  if (!but) { dragging = false; return; }
  if (!dragging) return;
  const g = geom();
  apply(clamp((x - g.x0) / g.u));
}

function apply(v, silent) {
  const raw = Number(v);
  v = clamp(raw);
  const outside = raw < 0 || raw > cfg.steps - 1;
  if (start === v && !outside) return;
  start = v;
  if (!silent || outside) outlet(0, "start", v);
  mgraphics.redraw();
}

function add(v) { addv = clamp(v); mgraphics.redraw(); }

function set() {
  const a = arrayfromargs(arguments);
  for (let i = 0; i + 1 < a.length; i += 2) {
    if (a[i] === "start") apply(a[i + 1], true);
    else if (a[i] === "add") add(a[i + 1]);
  }
}
function bang() { outlet(0, "start", start); mgraphics.redraw(); }
function steps(n) { cfg.steps = Math.max(2, n | 0); apply(start, true); add(addv); mgraphics.redraw(); }
function periods(n) { cfg.periods = Math.max(1, n | 0); mgraphics.redraw(); }
function addscale(f) { cfg.addScale = Math.max(0, Number(f)); mgraphics.redraw(); }
function labels(on) { cfg.labels = on ? 1 : 0; mgraphics.redraw(); }
function color() {
  const a = arrayfromargs(arguments);
  const name = a.shift();
  if (!(name in cfg.colors) || a.length < 3) { post("sid.pulse: color <name> r g b [a]\n"); return; }
  cfg.colors[name] = [a[0], a[1], a[2], a.length > 3 ? a[3] : 1].map(Number);
  mgraphics.redraw();
}
function onresize() { mgraphics.redraw(); }
function anything() { post("sid.pulse: unknown message " + messagename + "\n"); }

function pw(v) { apply(v); }   // alias for start

// Error capture to logs/max.log (lib/maxlog.js is bundled in by the build script).
paint = sidguard("pulse", paint); onclick = sidguard("pulse", onclick); ondrag = sidguard("pulse", ondrag); set = sidguard("pulse", set);
