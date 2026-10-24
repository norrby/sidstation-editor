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


// sid.name.js – v8ui: the patch name as ten characters in a 5×7 dot matrix, styled like the SidStation's character display,
// edited with the keyboard. v8ui has no keyboard events,
// so editing happens in a [textedit] ("nameedit") that is normally hidden: a click here shows it on top of the display
// (outlet 2: script messages to thispatcher) and gives it keyboard focus (outlet 1: select). Return in the field
// outputs the text -> "typed <text>" here: the display updates, the field hides, changed characters go out as
// "namechar <i> <code>" (i 1..10, ASCII) to the hidden Name parameters, which answer with "set char <i> <code>" and
// pass it on to the filter router -> DP 00 0i 7f 00 (manual p. 42). Per-keystroke mirroring was removed
// (very slow and unreliable). Upper case, lower case, digits and common characters; unknown ones are drawn as "?".
// In:  typed <text>         from textedit on Return: sets, sends changed characters, hides the field
//      cancel               Esc in the field: hides it without sending
//      set char <i> <code>  silent (from the Name parameters; echoes are ignored)     set name <word…>   silent, padded
//      bang                 output all ten
//      noreply <what>       from the gateway: a request got no answer -> NO REPLY in red until "answered" (any reply) or a click
//      answered <what>      from the gateway: a reply came in -> the name again
// Out: 0: namechar <i> <code>    1: "set <text>" / "select" to textedit    2: "script …" to thispatcher (show/hide the field)
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 3;

const N = 10;
const SET = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_./+*";   // characters that must have a glyph (test)
// 5×7 matrix per character as on an HD44780 character display (the SidStation's screen): seven rows, five bits, MSB = left.
const FONT_SRC = {
  " ": "00000 00000 00000 00000 00000 00000 00000", "!": "00100 00100 00100 00100 00000 00000 00100", "\"": "01010 01010 01010 00000 00000 00000 00000",
  "#": "01010 01010 11111 01010 11111 01010 01010", "%": "11000 11001 00010 00100 01000 10011 00011", "'": "01100 00100 01000 00000 00000 00000 00000",
  "(": "00010 00100 01000 01000 01000 00100 00010", ")": "01000 00100 00010 00010 00010 00100 01000", "*": "00000 00100 10101 01110 10101 00100 00000",
  "+": "00000 00100 00100 11111 00100 00100 00000", ",": "00000 00000 00000 00000 01100 00100 01000", "-": "00000 00000 00000 11111 00000 00000 00000",
  ".": "00000 00000 00000 00000 00000 01100 01100", "/": "00000 00001 00010 00100 01000 10000 00000", ":": "00000 01100 01100 00000 01100 01100 00000",
  "=": "00000 00000 11111 00000 11111 00000 00000", "?": "01110 10001 00001 00010 00100 00000 00100", "_": "00000 00000 00000 00000 00000 00000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110", "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110", "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000", "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  A: "01110 10001 10001 10001 11111 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11100 10010 10001 10001 10001 10010 11100", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  a: "00000 00000 01110 00001 01111 10001 01111", b: "10000 10000 10110 11001 10001 10001 11110", c: "00000 00000 01110 10000 10000 10001 01110",
  d: "00001 00001 01101 10011 10001 10001 01111", e: "00000 00000 01110 10001 11111 10000 01110", f: "00110 01001 01000 11100 01000 01000 01000",
  g: "00000 01111 10001 10001 01111 00001 01110", h: "10000 10000 10110 11001 10001 10001 10001", i: "00100 00000 01100 00100 00100 00100 01110",
  j: "00010 00000 00110 00010 00010 10010 01100", k: "10000 10000 10010 10100 11000 10100 10010", l: "01100 00100 00100 00100 00100 00100 01110",
  m: "00000 00000 11010 10101 10101 10001 10001", n: "00000 00000 10110 11001 10001 10001 10001", o: "00000 00000 01110 10001 10001 10001 01110",
  p: "00000 00000 11110 10001 11110 10000 10000", q: "00000 00000 01101 10011 01111 00001 00001", r: "00000 00000 10110 11001 10000 10000 10000",
  s: "00000 00000 01110 10000 01110 00001 11110", t: "01000 01000 11100 01000 01000 01001 00110", u: "00000 00000 10001 10001 10001 10011 01101",
  v: "00000 00000 10001 10001 10001 01010 00100", w: "00000 00000 10001 10001 10101 10101 01010", x: "00000 00000 10001 01010 00100 01010 10001",
  y: "00000 00000 10001 10001 01111 00001 01110", z: "00000 00000 11111 00010 00100 01000 11111",
};
const FONT = {};
for (const ch in FONT_SRC) FONT[ch] = FONT_SRC[ch].split(" ").map((row) => parseInt(row, 2));
const COLS = 5, ROWS = 7;
const C = { lit: UI.lit, ghost: [1, 1, 1, 0.05], bg: [0, 0, 0, 0.35], cursor: [1, 0.6, 0.2, 1] };
const codes = new Array(N).fill(32);
let cursor = -1;           // cursor (cell index): shown while the field is open, -1 = none
const born = Date.now();   // clicks during loading are ignored (see sid.fold.js)

function geom() {
  const W = mgraphics.size[0], H = mgraphics.size[1], pad = 3, gap = 1;
  const cw = (W - 2 * pad - (N - 1) * gap) / N;            // cell width ~13 px -> dot pitch ~2.6 px
  const pitch = cw / COLS, top = Math.max(2, (H - 5 - ROWS * pitch) / 2);
  return { W, H, pad, gap, cw, pitch, top };
}
function cellX(g, i) { return g.pad + i * (g.cw + g.gap); }
function glyphOf(code) { const ch = String.fromCharCode(code); return FONT[ch] || FONT["?"]; }
// A missed reply (to any request that expects an answer) is shown where the eye already is
// after Pull: the name display, in the warning colour; the name itself is untouched. It stays until a reply comes in or the
// display is clicked (a 3 s warning was easy to miss).
const WARN_TEXT = "NO REPLY  ";
let warning = false;
function noreply(what) {
  sidlog("name", "NO REPLY shown (" + what + ")");
  if (shownRect) return;                                                   // typing a name: leave the field alone
  warning = true;
  mgraphics.redraw();
}
function answered() { if (warning) { warning = false; mgraphics.redraw(); } }
function drawCell(g, i) {
  const x = cellX(g, i), rows = glyphOf(warning ? WARN_TEXT.charCodeAt(i) : codes[i]), d = g.pitch * 0.78;     // dot with a small gap, like an LCD
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const on = (rows[r] >> (COLS - 1 - c)) & 1;
    mgraphics.set_source_rgba(on ? (warning ? UI.warn : C.lit) : C.ghost);
    mgraphics.rectangle(x + c * g.pitch, g.top + r * g.pitch, d, d); mgraphics.fill();
  }
  if (i === cursor) { mgraphics.set_source_rgba(C.cursor); mgraphics.rectangle(x, g.H - 3, g.cw, 2); mgraphics.fill(); }
}
function paint() {
  const g = geom();
  mgraphics.set_source_rgba(C.bg);
  mgraphics.rectangle_rounded(0, 0, g.W, g.H, 3, 3); mgraphics.fill();
  for (let i = 0; i < N; i++) drawCell(g, i);
}
function apply(i, code, silent) {
  code = Math.max(0, Math.min(127, Math.round(Number(code))));
  if (!Number.isFinite(code) || i < 0 || i >= N) return false;
  if (code === 0) code = 32;                                                 // 0 from a parameter on load is shown as blank
  if (codes[i] === code) return false;
  codes[i] = code;
  if (!silent) outlet(0, "namechar", i + 1, code);
  return true;
}
function syncEdit() { outlet(1, "set", text().replace(/\s+$/, "")); }      // textedit follows along (silently)
// The device takes the patch name as its own name, so Push shows it in its header (an empty name gives "SidStation"). Set once,
// 300 ms after the last change: a dump sets ten characters one by one, and every rename is a step in Live's undo history.
let renameTask = null;
function renameDevice() {
  if (typeof LiveAPI === "undefined" || typeof Task === "undefined") return;     // not in Max (tests)
  if (!renameTask) renameTask = new Task(() => {
    try {
      const dev = new LiveAPI("this_device"), want = text().trim() || "SidStation";
      if (String(dev.get("name")) !== want) { dev.set("name", want); sidlog("name", "device name", JSON.stringify(want)); }
    } catch (e) { sidlog("name", "cannot rename the device", e.message); }
  });
  renameTask.cancel(); renameTask.schedule(300);
}
// The field is shown on the display's rect, which is read from the patcher on click (the layout engine owns the rect). Once the
// display hid but the field didn't show – the overview's v8ui draws on top, so the field is raised with bringtofront after
// being shown. While typing the display is hidden (presentation 0) and the field shown in its place: otherwise the field lay under the
// display's v8ui (the layout's bringtofront name) and received the keys invisibly. The rect is kept for restoring.
let shownRect = null;
function currentRect() {
  try {
    const r = this.patcher.getnamed("name").getattr("presentation_rect");
    if (r && r.length === 4 && r[2] > 0) return Array.from(r).map(Number);
  } catch (e) { sidlog("name", "cannot read the display rect", e.message); }
  return null;
}
// Same order as the layout engine: presentation 1 FIRST, then the rect. The other way round the rect is ignored for a hidden object and it
// appears at its patching position (the field's was at y 600, outside the device: focused but invisible).
function place(box, on, rect) {
  outlet(2, "script", "sendbox", box, "presentation", on ? 1 : 0);
  if (on && rect) outlet.apply(null, [2, "script", "sendbox", box, "presentation_rect"].concat(rect));
}
function report(box) {
  try { const o = this.patcher.getnamed(box); sidlog("name", box, "presentation", o.getattr("presentation"), "rect", Array.from(o.getattr("presentation_rect")).join(" ")); }
  catch (e) { sidlog("name", "cannot read", box, e.message); }
}
function showEdit(on) {
  if (on) {
    shownRect = currentRect.call(this);
    if (!shownRect) return;                                                  // unknown position: hide nothing
    sidlog("name", "editing at", shownRect.join(" "));
    syncEdit();                                                              // the field starts from the current name, never from leftovers
    place("name", false); place("nameedit", true, shownRect); outlet(2, "script", "bringtofront", "nameedit"); outlet(1, "select");
    report.call(this, "nameedit");   // display out of the way, the field gets focus
  } else if (shownRect) { place("nameedit", false); place("name", true, shownRect); shownRect = null; }
  cursor = -1;
  mgraphics.redraw();
}
function onclick() { if (Date.now() - born < 1000) return; warning = false; showEdit.call(this, true); }
function typed() {
  const a = arrayfromargs(arguments);
  // Only while the field is open: after Tab the field sends its text once more when it loses focus (the name went out
  // twice). Only send when the value has been set.
  if (!shownRect) { sidlog("name", "typed while closed, ignored", JSON.stringify(a.join(" "))); return; }
  // Empty field: textedit outputs "text" without arguments, [route text] turns it into a bang and [prepend typed] into
  // "typed bang" (the name became "bang"). A lone "bang" therefore means empty text.
  const raw = a.length === 1 && String(a[0]) === "bang" ? "" : a.map(String).join(" ");
  // A Tab (it accepts, like Return) is dropped, a line break becomes a blank; accented letters (e.g. a with umlaut) lose their marks (NFD + stripping of diacritics), anything else outside
  // 7-bit ASCII becomes "?" – the synth only takes 0..127 per character (an o with umlaut once went out as 7f). At most ten characters.
  const s = raw.replace(/\t/g, "").replace(/[\r\n]+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?").slice(0, N);
  sidlog("name", "typed", JSON.stringify(raw));
  // Return sends the whole name, all ten characters – the synth may hold a different name than the editor thinks, so the changed characters alone are not enough.
  for (let i = 0; i < N; i++) apply(i, i < s.length ? s.charCodeAt(i) : 32, true);
  bang();
  renameDevice();
  if (s !== raw) outlet(1, "set", s);                                        // the field shows what actually applies
  showEdit(false);
}
function set() {
  const a = arrayfromargs(arguments);
  let changed = false;
  if (a[0] === "char") changed = apply((a[1] | 0) - 1, a[2], true);
  else if (a[0] === "name") {
    const s = a.slice(1).map(String).join(" ");
    for (let i = 0; i < N; i++) changed = apply(i, i < s.length ? s.charCodeAt(i) : 32, true) || changed;
  } else { post("sid.name: unknown set " + a.join(" ") + "\n"); return; }
  if (changed) { cursor = -1; syncEdit(); if (shownRect) showEdit(false); mgraphics.redraw(); renameDevice(); }   // change from outside (dump) closes the field (it stayed open after Pull); echoes of our own characters change nothing
}
// Esc in the field (textedit outlet 1, key 27): close without sending, the field goes back to the current name.
function cancel() { if (!shownRect) return; sidlog("name", "editing cancelled"); syncEdit(); showEdit(false); }
function bang() { for (let i = 0; i < N; i++) outlet(0, "namechar", i + 1, codes[i]); }
function text() { return codes.map((c) => String.fromCharCode(c)).join(""); }   // for tests
function onresize() { mgraphics.redraw(); }
function anything() { post("sid.name: unknown message " + messagename + "\n"); }

paint = sidguard("name", paint); typed = sidguard("name", typed); set = sidguard("name", set); onclick = sidguard("name", onclick); cancel = sidguard("name", cancel); noreply = sidguard("name", noreply); answered = sidguard("name", answered);
sidlog("name", "loaded");
