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


// sid.activebtn.js – v8ui: osc 3's Active button with a third state, "Mod only" (the SID's 3OFF: osc 3 keeps running but is not
// heard, so it can still sync or ring osc 1). Whether osc 3 is heard belongs to Active, not to the filter. Drawn like a live.text; a click steps
// Active -> Mod only -> off -> Active. The parameters stay the hidden live.text "Osc 3 Active" and "Osc 3 Off" (3OFF).
// In:  set active <v>   set off3 <v>   (silent, from the parameters)      active <0|1>   enabled (0 in Poly, which ignores Active)
// Out: "active <v>", "off3 <v>"

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

let active = 1, off3 = 0, enabled = 1;
const born = Date.now();   // see sid.fold.js: clicks during loading are ignored

function state() { return !active ? "off" : off3 ? "mod" : "on"; }
// Mod only is lit in the blue of sync/relative pitch, so it reads as "a modulator"; in Poly it is greyed like the other Active buttons.
function paint() {
  const s = state();
  UI.button(mgraphics, mgraphics.size[0], mgraphics.size[1], { label: s === "mod" ? "Mod only" : "Active", on: s !== "off", lit: s === "mod" ? UI.line : UI.btnOn, dim: !enabled });
}
function onclick() {
  if (Date.now() - born < 1000) return;
  const s = state();
  // In Poly greyed but settable like osc 2's Active, on <-> off only: 3OFF silences SID voice 3, which in Poly plays the third note
  if (!enabled) {
    if (s === "on") { active = 0; outlet(0, "active", 0); }
    else { if (off3) { off3 = 0; outlet(0, "off3", 0); } if (s === "off") { active = 1; outlet(0, "active", 1); } else { active = 0; outlet(0, "active", 0); } }
    mgraphics.redraw();
    return;
  }
  if (s === "on") { off3 = 1; outlet(0, "off3", 1); }
  else if (s === "mod") { off3 = 0; active = 0; outlet(0, "off3", 0); outlet(0, "active", 0); }
  else { active = 1; outlet(0, "active", 1); }
  mgraphics.redraw();
}
function set(what, v) {
  if (what === "active") active = v ? 1 : 0;
  else if (what === "off3") off3 = v ? 1 : 0;
  else { post("sid.activebtn: unknown set " + what + "\n"); return; }
  mgraphics.redraw();
}
function msg_int(v) {}                                                    // (ints are not ours)
function anything() {
  if (messagename === "active") { enabled = arguments[0] ? 1 : 0; mgraphics.redraw(); return; }
  post("sid.activebtn: unknown message " + messagename + "\n");
}
function onresize() { mgraphics.redraw(); }

paint = sidguard("activebtn", paint); onclick = sidguard("activebtn", onclick); set = sidguard("activebtn", set);
sidlog("activebtn", "loaded");
