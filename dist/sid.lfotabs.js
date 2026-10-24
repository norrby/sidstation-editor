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
  btnOff: [0.118, 0.118, 0.118, 1],   // an unlit live.text, sampled (30)
  btnEdge: [0.07, 0.07, 0.07, 1],     // a live.text's border, and the label on a lit one (sampled)
  btnDimOn: [0.459, 0.459, 0.459, 1], // a disabled live.text that is on: grey whatever its colour (sampled 117)
  btnDimOnText: [0.141, 0.141, 0.141, 1],   // its label (sampled 36)
  btnDimText: [0.412, 0.412, 0.412, 1],     // the label of a disabled live.text that is off (sampled 105); the fill stays
};

// A button drawn like a live.text, filling the whole v8ui (w x h): filled, a 1 px dark border, the label centred in Live's font.
// o: { label, on, lit (the colour when on, default btnOn), unlit (when off, default btnOff), border (default true), dim }. The label
// is dark on a lit button and light on an unlit one; dim draws it like a disabled live.text: grey when on, a grey label when off.
// A button with an icon instead of a label draws the background here and the icon itself (sid.loopbtn.js).
UI.button = function (g, w, h, o) {
  g.set_source_rgba(o.on ? (o.dim ? UI.btnDimOn : o.lit || UI.btnOn) : o.unlit || UI.btnOff); g.rectangle(0, 0, w, h); g.fill();
  if (o.border !== false) { g.set_source_rgba(UI.btnEdge); g.set_line_width(1); g.rectangle(0.5, 0.5, w - 1, h - 1); g.stroke(); }
  if (!o.label) return;
  g.select_font_face("Ableton Sans Medium"); g.set_font_size(9.5);
  let tw = o.label.length * 5; try { tw = g.text_measure(o.label)[0]; } catch (e) {}
  g.set_source_rgba(o.dim ? (o.on ? UI.btnDimOnText : UI.btnDimText) : o.on ? UI.btnEdge : UI.text); g.move_to((w - tw) / 2, h / 2 + 3.5); g.show_text(o.label);
};

if (typeof module !== "undefined" && module.exports) module.exports = { UI };


// sid.lfotabs.js – v8: the LFO column's four fold buttons "lfo 1".."lfo 4", mutually exclusive, like tabs.
// Opening one closes the others, closing the open one
// folds the LFO section. The state lives in the two existing parameters, so automation and presets keep working:
// "LFO Select" (live.tab, hidden, 0..3) and "LFO Show" (live.text, hidden, 0|1).
// In:  click <k> <v>   from fold button k (1..4)     sel <i>   from LFO Select     show <v>   from LFO Show
// Out: 0: <i> to LFO Select   1: <v> to LFO Show   2: <k> <v> fold button k's state (-> [route 1 2 3 4] -> [prepend state])

inlets = 1;
outlets = 3;

let cur = 0, shown = 1;

function refresh() { for (let k = 1; k <= 4; k++) outlet(2, k, shown && cur === k - 1 ? 1 : 0); }
function click(k, v) {
  k = k | 0;
  if (k < 1 || k > 4) return;
  if (!v || (shown && cur === k - 1)) { shown = 0; outlet(1, 0); }
  else { cur = k - 1; outlet(0, cur); if (!shown) { shown = 1; outlet(1, 1); } }
  sidlog("lfotabs", "click", k, "-> lfo", cur + 1, shown ? "shown" : "folded");
  refresh();
}
function sel(i) { cur = Math.max(0, Math.min(3, i | 0)); refresh(); }
function show(v) { shown = v ? 1 : 0; refresh(); }

click = sidguard("lfotabs", click); sel = sidguard("lfotabs", sel); show = sidguard("lfotabs", show);
sidlog("lfotabs", "loaded");
