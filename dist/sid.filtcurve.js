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


// sid.filtcurve.js – v8ui: the filter's frequency response. Frequency logarithmic on x (nominally about 30 Hz – 15 kHz, 9 octaves,
// cutoff 0..127 linear along the axis), level in dB on y. Two-pole state-variable filter like the SID: LP, BP, HP
// and their sums (the type menu Lowp/Band/L/B/High/L/H/B/H/All = bitmask 1..7). Resonance 0..15 becomes Q and
// gives a peak at cutoff. Everything in the frequency domain: Env depth and LFO depth show as the stretch along
// the frequency axis that cutoff will travel (the envelope one way, downwards with Inv; the LFO both ways).
// The axes are ungraduated but have units (Hz, dB): the SID filter varies between chips, numbers would be made up.
// In:  set cutoff n | res n | type n (0..6) | depth n | invert 0|1 | lfodepth n | sustain n   (also without "set")
//      style n      1 = colour band + ghost curves: the filter at the envelope's peak (dashed yellow), at the sustain level
//                       (dashed pink – where the filter sits while the key is held) and the LFO's extremes (dotted green)
//                   2 = colour band only   3 = ghost curves only
//      show env|sus|lfo|cut 0|1   turn a layer on/off (from sid.legend.js)
//      legend 0|1   built-in colour legend top right (off by default – the legend is its own widget)
//      color bg|grid|fill|line|band|lfo|text r g b [a]
// Out: nothing (picture only).
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 0;

const OCTAVES = 9, DB_MIN = -36, DB_MAX = 12, PAD = 8;
const st = { cutoff: 100, res: 0, type: 0, depth: 0, invert: 0, lfodepth: 0, sustain: 127 };
let style = 1, showLegend = 0;
const vis = { env: 1, sus: 1, lfo: 1, cut: 1 };
const colors = {
  bg: UI.bg, grid: UI.grid, fill: UI.fill, line: UI.line,
  band: [1, 0.78, 0.3, 0.22], lfo: [0.6, 1, 0.6, 0.14], sus: UI.sus, text: UI.text,
};
const solid = (c, a) => [c[0], c[1], c[2], a];

// Q: the SID's resonance is gentle (never self-oscillates); 0 → Butterworth, 15 → a clear peak (~+10 dB).
function q() { return 0.707 + (st.res / 15) * 2.3; }
const TYPE_BITS = [1, 2, 3, 4, 5, 6, 7];                                 // menu index → LP=1 BP=2 HP=4 (SidParams FILTER ftype values)
function bits() { return TYPE_BITS[st.type] || 1; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Frequency response in dB at normalised axis position x (0..1) for a filter with cutoff at xc (default st.cutoff).
function response(x, xc) {
  if (xc === undefined) xc = st.cutoff / 127;
  const w = Math.pow(2, (x - xc) * OCTAVES);                             // ω/ωc
  const Q = q(), b = bits();
  // H(s) = (a2 s² + a1 s + a0) / (s² + s/Q + 1) with s = jω: the numerator = -a2 ω² + a0 + j a1 ω
  const a0 = b & 1 ? 1 : 0, a1 = b & 2 ? 1 / Q : 0, a2 = b & 4 ? 1 : 0;
  const nr = a0 - a2 * w * w, ni = a1 * w;
  const dr = 1 - w * w, di = w / Q;
  const mag = Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  return 20 * Math.log10(Math.max(mag, 1e-6));
}
// The sweeps as axis positions: band [x0, x1] and extremes (cutoff positions for the ghost curves), clamped 0..1.
function bands() {
  const xc = st.cutoff / 127, d = st.depth / 127, l = st.lfodepth / 127;
  const sign = st.invert ? -1 : 1, envEnd = clamp01(xc + sign * d), susEnd = clamp01(xc + sign * d * st.sustain / 127);
  return { env: st.depth ? [Math.min(xc, envEnd), Math.max(xc, envEnd)] : null,
           lfo: st.lfodepth ? [clamp01(xc - l), clamp01(xc + l)] : null,
           envEnd: st.depth ? envEnd : null, susEnd: st.depth ? susEnd : null, lfoEnds: st.lfodepth ? [clamp01(xc - l), clamp01(xc + l)] : null };
}

function paint() {
  const size = mgraphics.size, W = size[0], H = size[1];
  const x0 = PAD, x1 = W - PAD, top = PAD, bottom = H - PAD, hgt = bottom - top, wid = x1 - x0;
  const px = (x) => x0 + x * wid;
  const py = (db) => bottom - ((Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * hgt;
  mgraphics.set_source_rgba(colors.bg); mgraphics.rectangle(0, 0, W, H); mgraphics.fill();

  mgraphics.set_source_rgba(colors.grid); mgraphics.set_line_width(1);
  for (let o = 0; o <= OCTAVES; o++) { const x = Math.round(px(o / OCTAVES)) + 0.5; mgraphics.move_to(x, top); mgraphics.line_to(x, bottom); }
  for (const db of [0, -12, -24]) { const y = Math.round(py(db)) + 0.5; mgraphics.move_to(x0, y); mgraphics.line_to(x1, y); }
  mgraphics.stroke();

  const b = bands();
  if (style !== 3) {
    for (const [key, col] of [["lfo", colors.lfo], ["env", colors.band]]) {
      if (!b[key] || !vis[key]) continue;
      mgraphics.set_source_rgba(col);
      mgraphics.rectangle(px(b[key][0]), top, Math.max(1, px(b[key][1]) - px(b[key][0])), hgt);
      mgraphics.fill();
    }
  }

  const N = Math.max(32, Math.round(wid));
  // Curve, possibly dashed: on/off in samples (mgraphics lacks a reliable set_dash in v8ui) – dash = [on, period]
  const curve = (xc, dash) => {
    let pen = false;
    for (let i = 0; i <= N; i++) {
      if (dash && (i % dash[1]) >= dash[0]) { pen = false; continue; }
      const x = i / N, y = py(response(x, xc));
      if (!pen) { mgraphics.move_to(px(x), y); pen = true; } else mgraphics.line_to(px(x), y);
    }
  };
  if (style !== 2) {                                                     // ghost curves at the extremes
    mgraphics.set_line_width(1);
    if (b.lfoEnds && vis.lfo) { mgraphics.set_source_rgba(solid(colors.lfo, 0.9)); for (const xc of b.lfoEnds) { curve(xc, [2, 4]); mgraphics.stroke(); } }
    if (b.envEnd !== null && vis.env) { mgraphics.set_source_rgba(solid(colors.band, 0.9)); curve(b.envEnd, [4, 7]); mgraphics.stroke(); }
    if (b.susEnd !== null && vis.sus) { mgraphics.set_source_rgba(solid(colors.sus, 0.9)); curve(b.susEnd, [4, 7]); mgraphics.stroke(); }
  }
  mgraphics.set_source_rgba(colors.fill);
  curve(); mgraphics.line_to(x1, bottom); mgraphics.line_to(x0, bottom); mgraphics.close_path(); mgraphics.fill();
  mgraphics.set_source_rgba(colors.line); mgraphics.set_line_width(1.5);
  curve(); mgraphics.stroke();

  // cutoff: dashed vertical line
  const t = colors.text;
  if (vis.cut) {
    mgraphics.set_source_rgba(solid(t, 0.5)); mgraphics.set_line_width(1);
    const xc = Math.round(px(st.cutoff / 127)) + 0.5;
    for (let y = top; y < bottom; y += 6) { mgraphics.move_to(xc, y); mgraphics.line_to(xc, Math.min(bottom, y + 3)); }
    mgraphics.stroke();
  }

  // units in the corners (ungraduated axes)
  mgraphics.select_font_face("Arial"); mgraphics.set_font_size(8);
  mgraphics.set_source_rgba(solid(t, 0.6));
  mgraphics.move_to(x0 + 2, top + 9); mgraphics.show_text("dB");
  mgraphics.move_to(x1 - measure("Hz") - 2, bottom - 2); mgraphics.show_text("Hz");

  if (showLegend) legend(x1, top);
}

function measure(s) { try { return mgraphics.text_measure(s)[0]; } catch (e) { return s.length * 4.5; } }

// Legend from the right: "▮ Env  ▮ LFO  ╎ Cut" – colour swatch for the bands/ghost curves, dashed line for cutoff.
function legend(xRight, top) {
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(8);
  const t = colors.text;
  const entries = [["Cut", null], ["LFO", solid(colors.lfo, 0.85)], ["Sus", solid(colors.sus, 0.85)], ["Env", solid(colors.band, 0.85)]];
  let x = xRight - 2;
  for (const [label, col] of entries) {
    x -= measure(label);
    mgraphics.set_source_rgba(solid(t, 0.7));
    mgraphics.move_to(x, top + 9); mgraphics.show_text(label);
    x -= 9;
    if (col) { mgraphics.set_source_rgba(col); mgraphics.rectangle(x, top + 2, 7, 7); mgraphics.fill(); }
    else {                                                               // dashed vertical line like the cutoff marker
      mgraphics.set_source_rgba(solid(t, 0.5)); mgraphics.set_line_width(1);
      const lx = x + 3.5;
      mgraphics.move_to(lx, top + 2); mgraphics.line_to(lx, top + 5); mgraphics.move_to(lx, top + 7); mgraphics.line_to(lx, top + 10);
      mgraphics.stroke();
    }
    x -= 8;
  }
}

function setOne(name, v) {
  if (!(name in st)) { post("sid.filtcurve: unknown parameter " + name + "\n"); return false; }
  v = Number(v);
  if (!Number.isFinite(v)) return false;
  const max = name === "res" ? 15 : name === "type" ? 6 : name === "invert" ? 1 : 127;   // sustain 0..127 like the others
  st[name] = Math.max(0, Math.min(max, Math.round(v)));
  return true;
}
function set() {
  const a = arrayfromargs(arguments);
  let changed = false;
  for (let i = 0; i + 1 < a.length; i += 2) changed = setOne(String(a[i]), a[i + 1]) || changed;
  if (changed) mgraphics.redraw();
}
function anything() {
  const a = arrayfromargs(arguments);
  if (messagename === "legend") { showLegend = a[0] ? 1 : 0; mgraphics.redraw(); return; }
  if (messagename === "show") { const k = String(a[0]); if (k in vis) { vis[k] = a[1] ? 1 : 0; mgraphics.redraw(); } else post("sid.filtcurve: show env|sus|lfo|cut 0|1\n"); return; }
  if (messagename === "style") { style = Math.max(1, Math.min(3, a[0] | 0)); mgraphics.redraw(); return; }
  if (messagename === "color") {
    const name = a.shift();
    if (!(name in colors) || a.length < 3) { post("sid.filtcurve: color <bg|grid|fill|line|band|lfo|sus|text> r g b [a]\n"); return; }
    colors[name] = [a[0], a[1], a[2], a.length > 3 ? a[3] : 1].map(Number); mgraphics.redraw(); return;
  }
  if (setOne(String(messagename), a[0])) mgraphics.redraw();
}
function onresize() { mgraphics.redraw(); }

paint = sidguard("filtcurve", paint); set = sidguard("filtcurve", set); anything = sidguard("filtcurve", anything);
sidlog("filtcurve", "loaded");
