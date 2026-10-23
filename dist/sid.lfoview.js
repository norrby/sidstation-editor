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


// sid.lfoview.js – v8ui: the LFO's waveform over time (same spirit as the filter's response curve and the gate curve).
// The model is read from OS 1.10 R33 (waveform engine $917D–$9295, control logic $909B), in updates ("ticks", Sync
// Speed, normally 100 Hz) and output −1..1 (OS: $E000..$2000):
//   Tri/Saw: the phase increases by inc(speed) per tick, inc = 4 + 8b for b = 127 − speed < 32, otherwise 260 + 36(b − 32);
//            Tri = 32768/inc ticks per period, Saw = 16384/inc. Ramp = Saw without sync; with Sync (on/off) ONE rise to
//            the top which then stays. Pulse: toggles every speed+1 ticks. Rand: new value every speed+1 ticks.
//            Flat: constant max. S/H: the value is held for S/H ticks.
//   Fade In ($8FF9): the counter is cleared at note on and grows by 16 per tick until its high byte reaches Fade In; the output is
//            scaled by counter/(Fade In·256) → linear ramp over 16·Fade In ticks, independent of Speed (Fade 127 ≈ 20 s at 100 Hz).
//            OS quirk: while the ratio is 0 (the first Fade/16 ticks) the scaling is skipped – briefly full output first.
//   The box fits the whole fade; if the periods get too dense the wave is drawn as a band (min–max per pixel). Ruler in seconds below.
// Depth = amplitude, > 0 = (v + 1)/2 (an offset, not rectification), then Inv = mirroring (> 0 + Inv = 0..−1). The ghost curve shows the shape at full Depth.
// The frequency is written in the corner at the update rate the synth reports (06 settings via Pull, "rate <Hz>"; 100 until then).
// In:  set type n | speed n | depth n | invert 0|1 | abovezero 0|1 | samphold n | fadein n | notesync 0|1 | offsync 0|1
// Out: nothing (picture only).
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 0;

const st = { type: 0, speed: 40, depth: 0, invert: 0, abovezero: 0, samphold: 0, fadein: 0, notesync: 1, offsync: 0 };
const colors = { bg: UI.bg, grid: UI.grid, ghost: [0.6, 1, 0.6, 0.25], line: UI.lfo, text: UI.text };
const PAD = 4;
let tickHz = 100;                                   // the synth's update rate (sid.load.js sends "rate" after Pull)

// Random values for Rand: fixed (the same picture every time).
const RAND = [0.62, -0.35, 0.9, -0.8, 0.15, -0.55, 0.4, -0.1, 0.75, -0.95, 0.3, -0.45];
function inc() { const b = 127 - st.speed; return b < 32 ? 4 + 8 * b : 260 + 36 * (b - 32); }
const oneShot = () => st.type === 2 && (st.notesync || st.offsync);
// The length in ticks of one period (Ramp with sync: the rise; Rand: one value).
function cycle() {
  switch (st.type) {
    case 0: return 32768 / inc();
    case 1: case 2: return 16384 / inc();
    case 3: return 2 * (st.speed + 1);
    case 4: return st.speed + 1;
    default: return 100;
  }
}
const fadeTicks = () => 16 * st.fadein;
// How many ticks the box shows: two periods (Rand eight values, Flat 1 s), but at least the whole fade + a quarter. Dense periods
// with a long fade are explained by the ruler (preferred over two periods without a ruler).
function windowTicks() {
  const base = st.type === 4 ? 8 * cycle() : st.type === 5 ? 100 : 2 * cycle();
  return st.fadein > 0 ? Math.max(base, fadeTicks() * 1.25) : base;
}
// The fade's scale factor at tick n (0..1), with the OS quirk: ratio 0 → no scaling.
function fadeGain(n) {
  if (st.fadein <= 0 || n >= fadeTicks()) return 1;
  const counter = 16 * (Math.floor(n) + 1), q = Math.floor(counter / st.fadein);
  return q === 0 ? 1 : q / 256;
}
// The basic shape at tick n in −1..1.
function wave(n) {
  const c = cycle(), f = (n / c) - Math.floor(n / c);
  switch (st.type) {
    case 0: return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;                    // Tri (starts at the bottom after retrig)
    case 1: return 2 * f - 1;                                          // Saw
    case 2: return oneShot() ? Math.min(1, 2 * n / c - 1) : 2 * f - 1;  // Ramp: one rise with sync, otherwise Saw
    case 3: return f < 0.5 ? 1 : -1;                                   // Pulse
    case 4: return RAND[Math.floor(n / c) % RAND.length];              // Rand
    default: return 1;                                                 // Flat: constant max
  }
}
// The value at t (0..1 across the box). full: ignore Depth/Fade (the ghost curve).
function shape(t, full) {
  let n = t * windowTicks();
  if (st.samphold > 0) n = Math.floor(n / st.samphold) * st.samphold;   // S/H: hold for S/H ticks
  let v = wave(n);
  if (st.abovezero) v = (v + 1) / 2;                                  // > 0 BEFORE Inv as in the OS ($8FD8: (v + max) / 2, then Inv $8FE8):
  if (st.invert) v = -v;                                              // > 0 + Inv gives 0..−1, i.e. "below zero"
  if (full) return v;
  return v * (st.depth / 127) * fadeGain(t * windowTicks()) || 0;      // || 0: never −0
}
// Text in the corner: frequency at the update rate (Ramp with sync: rise time; Flat: nothing).
function rateText() {
  if (st.type === 5) return "";
  const sec = cycle() / tickHz;
  if (oneShot()) return "rise " + fmt(sec) + " s";
  if (st.type === 4) return fmt(tickHz / cycle()) + " steps/s";
  return sec > 10 ? fmt(sec) + " s/cycle" : fmt(1 / sec) + " Hz";     // below 0.1 Hz: the period ("0.01" was easily misread as 0.1)
}
const fmt = (x) => (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2));

// The ruler's step: 1, 2 or 5 × 10^n so that the box gets 3–6 ticks (the ruler under the graph shows
// how many seconds long the window is).
function rulerStep(total) {
  const raw = total / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const RULER_H = 11;
function paint() {
  const W = mgraphics.size[0], H = mgraphics.size[1] - RULER_H;     // the curve above the ruler
  mgraphics.set_source_rgba(colors.bg); mgraphics.rectangle(0, 0, W, H + RULER_H); mgraphics.fill();
  const y0 = !st.abovezero ? H / 2 : st.invert ? PAD : H - PAD, amp = st.abovezero ? H - 2 * PAD : H / 2 - PAD;   // the zero line at the bottom (> 0), at the top (> 0 + Inv)
  mgraphics.set_source_rgba(colors.grid); mgraphics.set_line_width(1);
  mgraphics.move_to(0, y0); mgraphics.line_to(W, y0); mgraphics.stroke();               // the zero line
  const SUB = 8;                                                      // sub-samples per pixel: dense periods become a band
  const trace = (full) => {
    for (let x = 0; x <= W; x++) {
      let lo = Infinity, hi = -Infinity, first = 0;
      for (let k = 0; k < SUB; k++) { const v = shape(Math.min(1, (x + k / SUB) / W), full); if (k === 0) first = v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const y = y0 - first * amp;
      if (x === 0) mgraphics.move_to(x, y); else mgraphics.line_to(x, y);
      if (hi - lo > 0.05) { mgraphics.move_to(x, y0 - lo * amp); mgraphics.line_to(x, y0 - hi * amp); mgraphics.move_to(x, y); }
    }
    mgraphics.stroke();
  };
  mgraphics.set_source_rgba(colors.ghost); mgraphics.set_line_width(1); trace(true);
  mgraphics.set_source_rgba(colors.line); mgraphics.set_line_width(1.5); trace(false);
  const txt = rateText() + (st.fadein > 0 ? "  fade " + fmt(fadeTicks() / tickHz) + " s" : "");
  mgraphics.set_font_size(8);
  if (txt) {                                                           // dark plate behind the text so the curve does not show through
    const w = mgraphics.text_measure(txt)[0];
    mgraphics.set_source_rgba(colors.bg[0], colors.bg[1], colors.bg[2], 0.85); mgraphics.rectangle(W - w - 6, 0, w + 6, 12); mgraphics.fill();
    mgraphics.set_source_rgba(colors.text); mgraphics.move_to(W - w - 3, 9); mgraphics.show_text(txt);
  }
  // the ruler: seconds at the update rate, ticks down from the top edge, labels to the right of the ticks
  const total = windowTicks() / tickHz, step = rulerStep(total);
  mgraphics.set_source_rgba(colors.grid); mgraphics.move_to(0, H + 0.5); mgraphics.line_to(W, H + 0.5); mgraphics.stroke();
  mgraphics.set_font_size(7);
  for (let k = 0; k * step <= total + 1e-9; k++) {
    const x = Math.round(k * step / total * W) + 0.5;
    mgraphics.set_source_rgba(colors.grid); mgraphics.move_to(x, H); mgraphics.line_to(x, H + 3); mgraphics.stroke();
    const label = +(k * step).toPrecision(3) + (k === 0 ? " s" : "");
    const lw = mgraphics.text_measure(label)[0];
    if (x + 2 + lw <= W) { mgraphics.set_source_rgba(colors.text); mgraphics.move_to(x + 2, H + RULER_H - 2); mgraphics.show_text(label); }
  }
}

function set() { const a = arrayfromargs(arguments); setp(a[0], a[1]); }
function setp(k, v) {
  if (!(k in st)) { sidlog("lfoview", "unknown", k); return; }
  v = Number(v);
  if (!Number.isFinite(v)) return;
  st[k] = v; mgraphics.redraw();
}
function anything() { setp(messagename, arrayfromargs(arguments)[0]); }
function rate(hz) { const r = Number(hz); if (r >= 10 && r <= 400) { tickHz = r; mgraphics.redraw(); } }
function onresize() { mgraphics.redraw(); }

set = sidguard("lfoview", set); rate = sidguard("lfoview", rate); anything = sidguard("lfoview", anything);

sidlog("lfoview", "loaded");
