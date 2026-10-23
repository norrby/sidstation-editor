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


// ui.js – the palette shared by the editor's widgets, bundled in front of every v8ui script (build/build-station.js). Named for what
// a colour means, so the widgets agree: one blue for curves, relative pitch and sync, one yellow for the envelope's peak, …
const UI = {
  bg: [0.16, 0.16, 0.16, 1],          // a widget's own background (graphs, the table, the note picker)
  grid: [1, 1, 1, 0.08],              // grid lines and ruler ticks
  text: [1, 1, 1, 0.75],              // labels and values
  line: [0.4, 0.75, 1, 1],            // curves, relative pitch, sync
  fill: [0.4, 0.75, 1, 0.22],         // the area under a curve
  peak: [1, 0.78, 0.3, 1],            // the envelope's peak and depth, the playhead
  sus: [1, 0.5, 0.75, 1],             // the sustain level
  lfo: [0.6, 1, 0.6, 1],              // LFO movement
  lit: [1, 0.6, 0.2, 1],              // lit in the overview and the name display, ring
  loop: [0.55, 0.9, 0.45, 1],         // Loop (the table, the loop button)
  dark: [0.1, 0.1, 0.1, 1],           // text on a lit button
  warn: [1, 0.3, 0.25, 1],            // a warning (NO REPLY in the name display)
  btnOn: [1, 0.678, 0.337, 1],        // a lit live.text, sampled (255 173 86)
  btnOff: [0.2, 0.2, 0.2, 1],         // an unlit button
  btnEdge: [0.07, 0.07, 0.07, 1],     // a live.text's border, and the label on a lit one (sampled)
};

// A button drawn like a live.text, filling the whole v8ui (w x h): filled, a 1 px dark border, the label centred in Live's font.
// o: { label, on, lit (the colour when on, default btnOn), unlit (when off, default btnOff), border (default true), dim }. The label
// is dark on a lit button and light on an unlit one; dim greys the fill and label like a disabled live.text (not the border).
// A button with an icon instead of a label draws the background here and the icon itself (sid.loopbtn.js).
UI.button = function (g, w, h, o) {
  const dim = (c) => (o.dim ? [c[0], c[1], c[2], c[3] * 0.4] : c);
  g.set_source_rgba(dim(o.on ? o.lit || UI.btnOn : o.unlit || UI.btnOff)); g.rectangle(0, 0, w, h); g.fill();
  if (o.border !== false) { g.set_source_rgba(UI.btnEdge); g.set_line_width(1); g.rectangle(0.5, 0.5, w - 1, h - 1); g.stroke(); }
  if (!o.label) return;
  g.select_font_face("Ableton Sans Medium"); g.set_font_size(9.5);
  let tw = o.label.length * 5; try { tw = g.text_measure(o.label)[0]; } catch (e) {}
  g.set_source_rgba(dim(o.on ? UI.btnEdge : UI.text)); g.move_to((w - tw) / 2, h / 2 + 3.5); g.show_text(o.label);
};

if (typeof module !== "undefined" && module.exports) module.exports = { UI };


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
