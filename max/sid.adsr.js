// sid.adsr.js – ADSR widget for v8ui (Max 9), the SidStation editor.
//
// Geometry: the peak always at the top with x = attack, the decay
// point at x = decay and y = sustain, sustain has a fixed length, release x =
// release time. Every step equally wide so that each position is equally easy to hit.
// Box width = maxA + maxD + sustainlen + maxR steps.
//
// In:  attack n | decay n | sustain n | release n   (sets and outputs)
//      set attack n [decay n …]                     (sets silently, from live.*)
//      bang                                         (outputs all four)
//      steps n      number of steps per time segment (16 osc, 128 filter)
//      levels n     number of sustain levels (16 osc, 128 filter)
//      sustainlen n sustain length in steps
//      times attack 2 8 16 …   display table in ms (also decay, release)
//      labels 0|1   show the text line
//      units <x> [<y>]  unit in the corners: x bottom right (s), y top left (Hz for the filter)
//      depth n      (filter) envelope depth 0..levels-1: scales the curve's height above the baseline
//      invert 0|1   (filter) the curve goes down from the baseline instead of up
//      base n       (filter) baseline = cutoff 0..levels-1; without base it sits at the bottom (or the top when inverted)
//      (all three also as "set depth n" etc.; without depth the curve is drawn as before over the full height)
//      gate 0|1     (osc) the SidStation's Gate: software gate at the sustain level instead of the SID envelope (manual p. 24) –
//                   the curve is drawn as a gate (up at note on, down at note off), only the level can be dragged (also "set gate n")
//      color bg|grid|fill|line|handle|text|peak|sus|base r g b a
// Out: "attack 5" etc. on outlet 0, only on change or bang.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const NAMES = ["attack", "decay", "sustain", "release"];
const cfg = {
  steps: 16, levels: 16, sustainLen: 6, labels: 1, pad: 8, handle: 5,
  times: { attack: null, decay: null, release: null },
  mod: { depth: null, invert: 0, base: null },
  gate: 0,
  units: { x: "", y: "" },
  colors: {
    bg: UI.bg, grid: UI.grid, fill: UI.fill,
    line: UI.line, handle: [1, 1, 1, 1], text: UI.text,
    // same palette as sid.filtcurve.js so that the points relate to the curves there:
    peak: UI.peak, sus: UI.sus, base: [1, 1, 1, 0.5],
  },
};
const val = { attack: 0, decay: 0, sustain: 0, release: 0 };
let drag = null;

// --- geometry -------------------------------------------------------------

function geom() {
  const size = mgraphics.size;
  const w = size[0], h = size[1], pad = cfg.pad;
  const top = pad, bottom = h - pad - (cfg.labels ? 14 : 0);
  const maxS = cfg.steps - 1;
  const u = (w - 2 * pad) / (3 * maxS + cfg.sustainLen);
  const hgt = bottom - top;
  const x0 = pad;
  const x1 = x0 + val.attack * u;
  const x2 = x1 + val.decay * u;
  const x3 = x2 + cfg.sustainLen * u;
  const x4 = x3 + val.release * u;
  // Gate: the plateau has a fixed width (60 % of the area) – the gate is open as long as the key is held; A/D/R are unused and must
  // not set the width (otherwise two panels with the same values were drawn with different widths).
  const xg = x0 + 0.6 * (w - 2 * pad);
  // Baseline yB, direction sign (-1 = up on screen) and amplitude amp; without depth the full height from the bottom.
  const lv = Math.max(1, cfg.levels - 1), m = cfg.mod;
  let yB = bottom, sign = -1, amp = hgt;
  if (m.depth !== null) {
    sign = m.invert ? 1 : -1;
    yB = m.base === null ? (m.invert ? top : bottom) : bottom - (m.base / lv) * hgt;
    amp = (m.depth / lv) * hgt;
  }
  const cl = (y) => Math.max(top, Math.min(bottom, y));          // cutoff clamps at 0 and 127
  const yP = cl(yB + sign * amp), yS = cl(yB + sign * amp * (val.sustain / lv));
  return { w, h, pad, top, bottom, maxS, u, hgt, lv, x0, x1, x2, x3, x4, xg, yB, yP, yS, sign, amp };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

function fmt(name, v) {
  const t = cfg.times[name];
  if (!t || v >= t.length) return String(v);
  const ms = t[v];
  if (ms < 1000) return ms + " ms";
  const s = ms / 1000;
  return (Number.isInteger(s) ? s : s.toFixed(1)) + " s";
}

// --- drawing --------------------------------------------------------------

function paint() {
  const g = geom();
  const c = cfg.colors;
  mgraphics.set_source_rgba(c.bg);
  mgraphics.rectangle(0, 0, g.w, g.h);
  mgraphics.fill();

  // Grid in both directions: one line per step in x, per sustain level in y.
  // Skipped when the resolution is high (the filter, 128 steps) – it only gets cluttered then.
  mgraphics.set_source_rgba(c.grid);
  mgraphics.set_line_width(1);
  if (cfg.steps <= 32) {
    for (let i = 0; i <= 3 * g.maxS + cfg.sustainLen; i++) {
      const x = Math.round(g.x0 + i * g.u) + 0.5;
      mgraphics.move_to(x, g.top); mgraphics.line_to(x, g.bottom);
    }
    mgraphics.stroke();
  }
  if (cfg.levels <= 32) {
    const x1 = Math.round(g.x0 + (3 * g.maxS + cfg.sustainLen) * g.u) + 0.5;
    for (let i = 0; i < cfg.levels; i++) {
      const y = Math.round(g.bottom - (i / (cfg.levels - 1)) * g.hgt) + 0.5;
      mgraphics.move_to(g.x0 + 0.5, y); mgraphics.line_to(x1, y);
    }
    mgraphics.stroke();
  }

  if (cfg.mod.depth !== null && cfg.mod.base !== null) {         // baseline = cutoff (if it is fed in)
    const t = c.text; mgraphics.set_source_rgba([t[0], t[1], t[2], 0.35]);
    mgraphics.set_line_width(1);
    const y = Math.round(g.yB) + 0.5;
    mgraphics.move_to(g.x0, y); mgraphics.line_to(g.w - g.pad, y);
    mgraphics.stroke();
    // the value at the line's right end so that you can see what it is ("cutoff is not shown in the envelope picture")
    const label = "Cut " + cfg.mod.base;
    mgraphics.set_source_rgba([t[0], t[1], t[2], 0.6]);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(9);
    const tw = mgraphics.text_measure(label)[0];
    mgraphics.move_to(g.w - g.pad - tw, y < g.top + 12 ? y + 10 : y - 3);
    mgraphics.show_text(label);
  }

  const curve = cfg.gate ? () => {                                 // gate: straight up to the sustain level, straight down at note off
    mgraphics.move_to(g.x0, g.yB);
    mgraphics.line_to(g.x0, g.yS);
    mgraphics.line_to(g.xg, g.yS);
    mgraphics.line_to(g.xg, g.yB);
  } : () => {
    mgraphics.move_to(g.x0, g.yB);
    mgraphics.line_to(g.x1, g.yP);
    mgraphics.line_to(g.x2, g.yS);
    mgraphics.line_to(g.x3, g.yS);
    mgraphics.line_to(g.x4, g.yB);
  };
  mgraphics.set_source_rgba(c.fill);
  curve(); mgraphics.close_path(); mgraphics.fill();
  mgraphics.set_source_rgba(c.line);
  mgraphics.set_line_width(1.5);
  curve(); mgraphics.stroke();

  // guide lines (dashed) at the peak, sustain and end levels, in the filter graph's colours; the points too
  mgraphics.set_line_width(1);
  const dashed = (y, col) => {
    mgraphics.set_source_rgba(col);
    const yy = Math.round(y) + 0.5, xEnd = g.w - g.pad;
    for (let x = g.x0; x < xEnd; x += 7) { mgraphics.move_to(x, yy); mgraphics.line_to(Math.min(xEnd, x + 4), yy); }
    mgraphics.stroke();
  };
  dashed(g.yB, c.base);
  if (!cfg.gate && Math.abs(g.yP - g.yB) > 1) dashed(g.yP, [c.peak[0], c.peak[1], c.peak[2], 0.6]);
  if (Math.abs(g.yS - g.yB) > 1 && (cfg.gate || Math.abs(g.yS - g.yP) > 1)) dashed(g.yS, [c.sus[0], c.sus[1], c.sus[2], 0.6]);
  const handles = cfg.gate ? [[(g.x0 + g.xg) / 2, g.yS, c.sus]] : [[g.x1, g.yP, c.peak], [g.x2, g.yS, c.sus], [g.x4, g.yB, c.handle]];
  for (const [x, y, col] of handles) {
    mgraphics.set_source_rgba(col);
    mgraphics.ellipse(x - cfg.handle, y - cfg.handle, 2 * cfg.handle, 2 * cfg.handle);
    mgraphics.fill();
  }
  if (cfg.gate) {                                                        // mark the mode: "gate" top left (where the filter has its unit)
    mgraphics.set_source_rgba([c.sus[0], c.sus[1], c.sus[2], 0.9]);
    mgraphics.select_font_face("Arial"); mgraphics.set_font_size(8);
    mgraphics.move_to(g.x0 + 2, g.top + 9); mgraphics.show_text("gate");
    const kt = "key held", kw = mgraphics.text_measure(kt)[0];                 // the length = the key press, not a value
    mgraphics.move_to((g.x0 + g.xg) / 2 - kw / 2, g.bottom - 3); mgraphics.show_text(kt);
  }

  if (cfg.units.x || cfg.units.y) {
    mgraphics.set_source_rgba([c.text[0], c.text[1], c.text[2], 0.6]);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(8);
    const tw = (s) => { try { return mgraphics.text_measure(s)[0]; } catch (e) { return s.length * 4.5; } };
    if (cfg.units.x) { mgraphics.move_to(g.w - g.pad - tw(cfg.units.x) - 2, g.bottom - 2); mgraphics.show_text(cfg.units.x); }
    if (cfg.units.y) { mgraphics.move_to(g.x0 + 2, g.top + 9); mgraphics.show_text(cfg.units.y); }   // top left like dB in the filter graph
  }

  if (cfg.labels) {
    mgraphics.set_source_rgba(c.text);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(10);
    const s = "A " + fmt("attack", val.attack) + "   D " + fmt("decay", val.decay) +
      "   S " + val.sustain + "   R " + fmt("release", val.release);
    mgraphics.move_to(g.pad, g.h - 4);
    mgraphics.show_text(s);
  }
}

// --- mouse ------------------------------------------------------------------

function onclick(x, y) {
  const g = geom();
  if (cfg.gate) { drag = "gatelevel"; ondrag(x, y, 1); return; }      // only the level means anything
  const r = cfg.handle * 2.5;
  const near = (px, py) => Math.hypot(x - px, y - py) <= r;
  if (near(g.x2, g.yS)) drag = "decay";
  else if (near(g.x1, g.yP)) drag = "attack";
  else if (near(g.x4, g.yB)) drag = "release";
  else if (x < g.x1) drag = "attack";
  else if (x < g.x3) drag = "decay";
  else drag = "release";
  ondrag(x, y, 1);
}

function ondrag(x, y, but) {
  if (!but) { drag = null; return; }
  if (!drag) return;
  const g = geom();
  if (drag === "attack") {
    apply("attack", clamp((x - g.x0) / g.u, 0, g.maxS));
  } else if (drag === "decay") {
    apply("decay", clamp((x - g.x1) / g.u, 0, g.maxS));
    if (g.amp > 0) apply("sustain", clamp(((y - g.yB) / (g.sign * g.amp)) * g.lv, 0, g.lv));   // relative to the baseline and the depth
  } else if (drag === "release") {
    apply("release", clamp((x - g.x3) / g.u, 0, g.maxS));
  } else if (drag === "gatelevel") {
    if (g.amp > 0) apply("sustain", clamp(((y - g.yB) / (g.sign * g.amp)) * g.lv, 0, g.lv));
  }
}

function apply(name, v, silent) {
  const max = name === "sustain" ? cfg.levels - 1 : cfg.steps - 1;
  const raw = Number(v);
  v = clamp(raw, 0, max);
  const outside = raw < 0 || raw > max;          // invalid input: answer anyway so that the sender gets synced
  if (val[name] === v && !outside) return;
  val[name] = v;
  if (!silent || outside) outlet(0, name, v);
  mgraphics.redraw();
}

// --- messages ----------------------------------------------------------

function attack(v) { apply("attack", v); }
function decay(v) { apply("decay", v); }
function sustain(v) { apply("sustain", v); }
function release(v) { apply("release", v); }

function setMod(name, v) {
  v = Number(v);
  if (!Number.isFinite(v)) return;
  cfg.mod[name] = name === "invert" ? (v ? 1 : 0) : Math.max(0, Math.min(cfg.levels - 1, Math.round(v)));
  mgraphics.redraw();
}
function gate(v) { cfg.gate = Number(v) ? 1 : 0; mgraphics.redraw(); }
function depth(v) { setMod("depth", v); }
function invert(v) { setMod("invert", v); }
function base(v) { setMod("base", v); }

function set() {
  const a = arrayfromargs(arguments);
  for (let i = 0; i + 1 < a.length; i += 2) {
    if (NAMES.indexOf(a[i]) >= 0) apply(a[i], a[i + 1], true);
    else if (a[i] in cfg.mod) setMod(a[i], a[i + 1]);
    else if (a[i] === "gate") gate(a[i + 1]);
  }
}

function bang() { for (const n of NAMES) outlet(0, n, val[n]); mgraphics.redraw(); }

function steps(n) { cfg.steps = Math.max(2, n | 0); for (const k of ["attack", "decay", "release"]) apply(k, val[k], true); mgraphics.redraw(); }
function levels(n) { cfg.levels = Math.max(2, n | 0); apply("sustain", val.sustain, true); mgraphics.redraw(); }
function sustainlen(n) { cfg.sustainLen = Math.max(1, n | 0); mgraphics.redraw(); }
function labels(on) { cfg.labels = on ? 1 : 0; mgraphics.redraw(); }
function units(x, y) { cfg.units = { x: x === undefined ? "" : String(x), y: y === undefined ? "" : String(y) }; mgraphics.redraw(); }

function times() {
  const a = arrayfromargs(arguments);
  const name = a.shift();
  if (!(name in cfg.times)) { post("sid.adsr: times expects attack|decay|release\n"); return; }
  cfg.times[name] = a.length ? a.map(Number) : null;
  mgraphics.redraw();
}

function color() {
  const a = arrayfromargs(arguments);
  const name = a.shift();
  if (!(name in cfg.colors) || a.length < 3) { post("sid.adsr: color <bg|grid|fill|line|handle|text> r g b [a]\n"); return; }
  cfg.colors[name] = [a[0], a[1], a[2], a.length > 3 ? a[3] : 1].map(Number);
  mgraphics.redraw();
}

function onresize() { mgraphics.redraw(); }

function anything() { post("sid.adsr: unknown message " + messagename + "\n"); }

// Error capture to logs/max.log (lib/maxlog.js is bundled in by the build script).
paint = sidguard("adsr", paint); onclick = sidguard("adsr", onclick); ondrag = sidguard("adsr", ondrag); set = sidguard("adsr", set);
