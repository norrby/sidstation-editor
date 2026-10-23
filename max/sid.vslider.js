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
