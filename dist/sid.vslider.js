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


// sid.vslider.js – v8ui: vertical slider for the filter envelope's depth, right next to the ADSR graph. The bar grows
// from the bottom; with Inv from the top, like the envelope's direction.
// The colour is the envelope's peak yellow as in the graphs. The value is written under the track.
// Behind it sits a hidden live.dial (the parameter), as in the ADSR graph: the widget sends the value, the dial answers with set.
// In:  set n        silent        n (number)   sets and sends       invert 0|1     range n (max, default 127)
//      color bar|track|text r g b [a]
// Out: n  (0..range) on outlet 0 while dragging
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const NUM_H = 14;                                    // number zone under the track; the track above = the graph's height
let value = 0, range = 127, inverted = 0;
const colors = { bar: UI.peak, track: UI.bg, text: UI.text };
let drag = false;

function geom() {
  const w = mgraphics.size[0], h = mgraphics.size[1];
  return { w, h, top: 1, bottom: h - NUM_H - 1, cx: w / 2 };
}
function paint() {
  const g = geom(), hgt = g.bottom - g.top, len = (value / range) * hgt;
  mgraphics.set_source_rgba(colors.track);
  mgraphics.rectangle(g.cx - 3, g.top, 6, hgt); mgraphics.fill();
  mgraphics.set_source_rgba(colors.bar);
  if (inverted) mgraphics.rectangle(g.cx - 3, g.top, 6, len); else mgraphics.rectangle(g.cx - 3, g.bottom - len, 6, len);
  mgraphics.fill();
  const y = inverted ? g.top + len : g.bottom - len;                   // handle at the end of the bar
  mgraphics.rectangle(g.cx - 7, Math.round(y) - 1.5, 14, 3); mgraphics.fill();
  mgraphics.set_source_rgba(colors.text);
  mgraphics.select_font_face("Arial"); mgraphics.set_font_size(9);
  const s = String(value);
  let tw = s.length * 5; try { tw = mgraphics.text_measure(s)[0]; } catch (e) { /* mock */ }
  mgraphics.move_to(g.cx - tw / 2, g.h - 3); mgraphics.show_text(s);
}
function fromY(y) {
  const g = geom(), hgt = g.bottom - g.top;
  const frac = inverted ? (y - g.top) / hgt : (g.bottom - y) / hgt;
  return Math.max(0, Math.min(range, Math.round(frac * range)));
}
function apply(v, silent) {
  v = Math.max(0, Math.min(range, Math.round(Number(v))));
  if (!Number.isFinite(v)) return;
  const changed = v !== value;
  value = v;
  if (!silent && changed) outlet(0, value);
  if (changed) mgraphics.redraw();
}
function onclick(x, y) { drag = true; apply(fromY(y)); }
function ondrag(x, y, but) { if (!but) { drag = false; return; } if (drag) apply(fromY(y)); }
function msg_int(v) { apply(v); }
function msg_float(v) { apply(v); }
function set(v) { apply(v, true); }
function invert(v) { inverted = v ? 1 : 0; mgraphics.redraw(); }
function anything() {
  const a = arrayfromargs(arguments);
  if (messagename === "range") { range = Math.max(1, a[0] | 0); apply(value, true); mgraphics.redraw(); return; }
  if (messagename === "color") { const n = a.shift(); if (n in colors && a.length >= 3) { colors[n] = [a[0], a[1], a[2], a.length > 3 ? a[3] : 1].map(Number); mgraphics.redraw(); } return; }
  post("sid.vslider: unknown message " + messagename + "\n");
}
function onresize() { mgraphics.redraw(); }

paint = sidguard("vslider", paint); onclick = sidguard("vslider", onclick); ondrag = sidguard("vslider", ondrag); set = sidguard("vslider", set);
sidlog("vslider", "loaded");
