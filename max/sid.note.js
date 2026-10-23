// sid.note.js – small note picker for v8ui (Max 9), the SidStation editor.
//
// Shows a fixed note with the SidStation's own names (C-5 = 60, D#8 = 99, E-8 = 100:
// tracker style, octave = note div 12) so that the panel and the synth's display say
// the same thing. Drag up/down to change (4 px per semitone), or send
// the value. Disabled (enable 0) it is hidden completely (box.hidden) and takes no drags –
// used when Key follow is selected. Starts hidden.
//
// In:  note n        sets and outputs
//      set note n    sets silently (from live.*)
//      enable 0|1    on/off
//      range lo hi   allowed notes (default 1..100)
//      bang          outputs
// Out: "note n" on outlet 0, only on change or bang.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
const cfg = { lo: 1, hi: 100, pxPerStep: 4, colors: { bg: UI.bg, off: [0.22, 0.22, 0.22, 1], text: [1, 1, 1, 0.9], frame: [1, 1, 1, 0.15] } };
let note = 60, enabled = 0;   // starts hidden: Key follow is the panel's initial state
let dragY = 0, dragFrom = 0;

function noteName(n) { return NAMES[n % 12] + Math.floor(n / 12); }
function clamp(v) { return Math.max(cfg.lo, Math.min(cfg.hi, Math.round(Number(v)))); }

function paint() {
  const [w, h] = mgraphics.size;
  const c = cfg.colors;
  mgraphics.set_source_rgba(enabled ? c.bg : c.off);
  mgraphics.rectangle(0, 0, w, h);
  mgraphics.fill();
  mgraphics.set_source_rgba(c.frame);
  mgraphics.set_line_width(1);
  mgraphics.rectangle(0.5, 0.5, w - 1, h - 1);
  mgraphics.stroke();
  if (!enabled) return;
  mgraphics.set_source_rgba(c.text);
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(10);
  const s = noteName(note);
  const tw = mgraphics.text_measure(s)[0];
  mgraphics.move_to((w - tw) / 2, h / 2 + 4);
  mgraphics.show_text(s);
}

function onclick(x, y) { if (!enabled) return; dragY = y; dragFrom = note; }
function ondrag(x, y, but) {
  if (!but || !enabled) return;
  apply(clamp(dragFrom + Math.round((dragY - y) / cfg.pxPerStep)));
}

function apply(v, silent) {
  const raw = Number(v);
  v = clamp(raw);
  const outside = raw < cfg.lo || raw > cfg.hi;
  if (note === v && !outside) return;
  note = v;
  if (!silent || outside) outlet(0, "note", v);
  mgraphics.redraw();
}

function set() {
  const a = arrayfromargs(arguments);
  for (let i = 0; i + 1 < a.length; i += 2) if (a[i] === "note") apply(a[i + 1], true);
}
function bang() { outlet(0, "note", note); mgraphics.redraw(); }
// Off = completely invisible: box.hidden ("Hide on Lock"; the Live device is always locked).
function enable(on) {
  enabled = on ? 1 : 0;
  if (typeof box !== "undefined" && box) { try { box.hidden = enabled ? 0 : 1; } catch (e) { post("sid.note: " + e + "\n"); } }
  mgraphics.redraw();
}
function range(lo, hi) { cfg.lo = lo | 0; cfg.hi = hi | 0; apply(note, true); mgraphics.redraw(); }
function onresize() { mgraphics.redraw(); }
function anything() { post("sid.note: unknown message " + messagename + "\n"); }

// Error capture to logs/max.log (lib/maxlog.js is bundled in by the build script).
paint = sidguard("note", paint); onclick = sidguard("note", onclick); ondrag = sidguard("note", ondrag); set = sidguard("note", set);
