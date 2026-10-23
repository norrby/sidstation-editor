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


// sid.loopbtn.js – v8ui: the table's one-shot / loop toggle, so looping does not depend on
// knowing that the End/Loop step can be clicked. Drawn like a live.text: dark when one-shot (an arrow to a bar, →|), lit when
// looping (an arrow round a circle). A click toggles and outputs the new state; "state v" updates silently (from the table).
// In:  state <0|1>    Out: 0|1 on outlet 0 (1 = loop)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const C = { off: [0.12, 0.12, 0.12, 1], on: UI.loop, iconOff: UI.text, iconOn: UI.dark };   // on: the table's Loop green
let loop = 0;
const born = Date.now();

function arrowHead(x, y, dx, dy, s) {
  const px = -dy, py = dx, g = mgraphics;
  g.move_to(x, y); g.line_to(x - dx * s + px * s * 0.6, y - dy * s + py * s * 0.6); g.line_to(x - dx * s - px * s * 0.6, y - dy * s - py * s * 0.6); g.close_path(); g.fill();
}
function paint() {
  const g = mgraphics, w = g.size[0], h = g.size[1], cx = w / 2, cy = h / 2;
  UI.button(g, w, h, { on: loop, lit: C.on, unlit: C.off, border: false });
  g.set_source_rgba(loop ? C.iconOn : C.iconOff); g.set_line_width(1.3);
  if (loop) {                                                            // a circle with an arrowhead: around and around
    const r = h * 0.3, a0 = -Math.PI * 0.35, a1 = Math.PI * 1.45;
    g.arc(cx, cy, r, a0, a1); g.stroke();
    arrowHead(cx + r * Math.cos(a1), cy + r * Math.sin(a1), -Math.sin(a1), Math.cos(a1), 3.5);
  } else {                                                               // →| : once, then stop
    const x0 = cx - 8, x1 = cx + 6;
    g.move_to(x0, cy); g.line_to(x1 - 3, cy); g.stroke();
    arrowHead(x1 - 1, cy, 1, 0, 3.5);
    g.move_to(x1 + 1.5, cy - 5); g.line_to(x1 + 1.5, cy + 5); g.stroke();
  }
}
function onclick() {
  if (Date.now() - born < 1000) return;                                  // see sid.fold.js
  loop = loop ? 0 : 1; outlet(0, loop); mgraphics.redraw();
}
function state(v) { loop = Number(v) ? 1 : 0; mgraphics.redraw(); }
function onresize() { mgraphics.redraw(); }

paint = sidguard("loopbtn", paint); onclick = sidguard("loopbtn", onclick); state = sidguard("loopbtn", state);
sidlog("loopbtn", "loaded");
