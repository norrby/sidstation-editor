// sid.table.js – waveform table (wavetable) editor for v8ui (Max 9), the SidStation editor.
//
// A step sequencer: one column per step, 16 visible of 65 with a scrollbar below (see MAXCOL), the
// step's pitch on top and its two buttons below it, so they always line up. Rows, top to bottom:
//   ruler   step numbers and the loop target (triangle, drag; only steps before the Loop command, manual p. 23)
//   pitch   fixed note (orange bar from the bottom) or a step from the played note (blue bar from the centre line), or no
//           change (the line). Where a drag starts sets the mode: the bottom quarter = fixed, above = difference; on the step's own
//           bar it keeps its mode. A drag that leaves the step paints every step it passes. Double click = no change.
//   wave    click cycles Tri Saw Pulse Mix Noise Off --- (shift: backwards); drag paints
//   mod     click cycles – / sync / ring / s+r (shift: backwards); drag paints
// The End/Loop command is a step of its own after the last one, drawn a whole step wide with the loop button's symbol; its
// edge, ball or body drags the length (0 steps = End alone). Once/Loop is toggled by the loop button beside the table.
// Speed 0 (no table) draws everything in grey.
//
// Data (dump/DP): two bytes per step. DATA1 = wave code << 4 | ring << 2 | sync << 1, codes
// Tri 1, Saw 2, Pulse 4, Mix 5, Noise 8, Off 0, --- 9; FE xx = Loop to xx, FF = End (one byte in the dump).
// DATA2 = 00..7F fixed note (the panel offers 00..51), C0+n add n, 80+n subtract n – as on the manual's DP page (p. 43); the dump table says the
// opposite, but the factory patches settle it: SidDrum has fixed notes 21 20 1D 10 (33 32 29 16, falling) and TuneDrum the same
// numbers as E1 E0 DD D0, i.e. C0 + 33 32 29 16 (the tunable version of the same drum); Bassdrum D9 D1 CF … C0.
// R33's step routine ($9471–$94A0) settles DATA2: 00..7F fixed, pitch = DATA2 + 12 ($949B ADDA #$0C; the base pitch is the MIDI
// note, $9443–$946A), 80..BF subtract DATA2 & 3F, C0..FE add DATA2 & 3F, FF = no change ("---"). DATA1 >= $90 keeps the wave.
//
// In:  bytes d1 d2 d1 d2 … [FE xx | FF]   load a table as stored in a dump
//      clear | bang (outputs)
//      speed n      the table speed (0 = no table) and rate <Hz> the update rate (the patch's Sync Speed, default 100)
//      note 1|0     note on/off from the track: runs a playhead like the OS's table player ($95DD–$9650 in R33): at note on
//                   step 0 and a counter = speed; every tick the counter counts down, at 0 the next step (Loop jumps to its
//                   target in the same tick, End or step 65 stops). So every step lasts exactly <speed> ticks. The synth does
//                   not report its position – this is a simulation; it stops when no note is held.
//      push <key> <v>   from the Push bank's knobs (build/station/voice.js PUSH_TABLE): step = the cursor (0..64), len = the
//                   table's length (0..65), loop 0|1 (as loopmode; switching on loops to the last step), target = the loop's target step
//                   (clamped to the table), and for the
//                   step under the cursor wave 0..6, mod = sync | ring << 1 (as the mod button), pitch 0 --- | 1 fixed | 2 relative,
//                   note = the fixed note F 0..81 (the knob's list of names), offset -47..47. A note or offset also sets the pitch mode.
// Out: "steps n end|loop target" and "bytes …" on outlet 0 after every change (on mouse up while dragging), "knob <key> <v>"
//      for every Push knob whose value should change, so they show the step under the cursor (the value goes INTO the knob, so
//      that Live and Push follow – a silent "set" left Live's value behind – and comes straight back here as "push": the echo is
//      told apart by a flag, as the patcher runs the chain synchronously), and "bank 0|1" when the step's pitch mode changes
//      between fixed and relative: the bank then shows Note or Offset in the slot after Pitch (live.banks edit in the patcher);
//      likewise "bankloop 0|1": the last slot shows Loop To right after the Loop knob switched the loop on, until another knob
//      (not Loop To) is turned; otherwise Speed.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

// 65 places (index 0..64): the OS's player stops at step 65 ($9619 CMPB #$41 in R33) and each table is 130 bytes; the manual's
// "maximum size of 32" is wrong for R33: the synth's own editor lists steps 0..64 ("63 Off SR F03 / 64[Off]
// -- F00"). Up to 64 steps + End/Loop, or all 65 without a command ("Full": the player stops after step 64).
// 16 columns are visible; a scrollbar at the bottom reaches the rest (up to 64).
const MAXCOL = 65, VISIBLE = 16;
const PX_PER_SEMI = 3;                             // relative pitch drag: 3 px per semitone
const HANDLE = 5;                                  // the End/Loop line's drag handle, as sid.adsr.js (a ball to drag)
// Fixed notes by name (an absolute note rather than bare numbers). Live's convention, C3 = 60,
// as params.js noteName. Fixed note F n plays MIDI note n + 12 (R33 $949B; F60 sounds as Live's C4 = 72).
const FIXED_OFFSET = 12;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);
const pitchText = (s) => (s.mode === "F" ? noteName(s.fixed + FIXED_OFFSET) : s.mode === "rel" ? (s.rel >= 0 ? "+" : "−") + Math.abs(s.rel) : "---");
const WAVES = [
  { key: "tri", label: "Tri", code: 1 }, { key: "saw", label: "Saw", code: 2 }, { key: "pulse", label: "Pulse", code: 4 },
  { key: "mix", label: "Mix", code: 5 }, { key: "noise", label: "Noise", code: 8 }, { key: "off", label: "Off", code: 0 },
  { key: "keep", label: "---", code: 9 },
];
const MOD_TEXT = ["–", "sync", "ring", "s+r"];               // the mod button: sync | ring << 1
const C = {
  bg: UI.bg, col: [1, 1, 1, 0.035], grid: [1, 1, 1, 0.1], dim: [1, 1, 1, 0.25], text: UI.text,
  fixed: [1, 0.62, 0.25, 1], rel: UI.line, keep: [1, 1, 1, 0.3], loop: UI.loop, end: [1, 0.4, 0.4, 1],
  on: UI.peak, hover: [1, 1, 1, 0.08], play: [1, 0.78, 0.3, 0.22], btn: [0.09, 0.09, 0.09, 1], btnText: UI.dark,
};

const born = Date.now();
let steps = [], n = 0, term = "end", target = 0;
let speed = 0, rateHz = 120, held = 0, play = -1, cnt = 0, t0 = 0, done = 0;
const ticker = new Task(pump, this);
let drag = null, hover = -1, msg = "", off = 0;   // off: the first visible column
// Push edits one step at a time, the one under the cursor. Every knob outputs a value when the device loads (Live's restore, as
// with every live.* object, also for a parameter that is not stored), and that first value per knob is never applied: with a
// table it would overwrite step 0 and set the length to 0. The same rule as the routers' (sid.osc.js param).
let cursor = 0, bankShown = -1, bankLoopShown = -1;   // bankShown: 0 Note or 1 Offset in the bank; bankLoopShown: Loop To shown; -1 not told yet
let loopToShown = false;                            // Loop To is in the bank: from a Loop turn that loops until another knob is turned
const pushSeen = {}, knobVal = {};                 // knobVal: what each knob holds now (from Push or from knobs()), so only a change is sent
let syncing = false;                               // knobs() is sending: what comes back is our own echo
// Live's restore of the knobs comes after the table was restored and overwrites what knobs() had sent, so the knobs are sent again
// shortly after the last first value has arrived (Live restores them one after another).
const resync = new Task(() => knobs(), this);
const PITCH_MODES = ["keep", "F", "rel"];

function newStep() { return { wave: 0, sync: 0, ring: 0, mode: "keep", fixed: 48, rel: 0 }; }
function reset() { steps = []; for (let i = 0; i < MAXCOL; i++) steps.push(newStep()); n = 0; term = "end"; target = 0; mgraphics.redraw(); }   // the smallest table: End alone, as in most factory patches
function clear() { reset(); out(); }

// --- geometry -------------------------------------------------------------

function geom() {
  const [w, h] = mgraphics.size;
  const pad = 4, x0 = pad, cw = (w - 2 * pad) / VISIBLE;
  const rulerY = 2, rulerH = 14;
  // Per step: the bars, then two buttons: wave (icon, cycles) and mod (off -> sync -> ring -> s+r, cycles). Where a pitch drag
  // starts sets the mode (fixed note when dragging up from the bottom, a difference when dragging
  // from the middle; told apart by colour, not letters); the value is dragged relatively (PX_PER_SEMI).
  const btnH = 13, waveH = 16, tagH = 0, scrollH = 6;
  const scrollY = h - pad - scrollH, modY = scrollY - 3 - btnH, waveY = modY - 2 - waveH;
  const pitchY = rulerY + rulerH + 2, pitchH = waveY - 3 - pitchY, barY = pitchY + tagH + 2, barH = waveY - 3 - barY;
  return { w, h, pad, x0, cw, rulerY, rulerH, pitchY, pitchH, tagH, barY, barH, waveY, waveH, modY, btnH, bottom: modY + btnH, scrollY, scrollH,
    mid: barY + barH / 2, x1: w - pad };
}
const colAt = (g, x) => Math.max(0, Math.min(MAXCOL - 1, off + Math.floor((x - g.x0) / g.cw)));
const colX = (g, i) => g.x0 + (i - off) * g.cw;
const MAXOFF = MAXCOL - VISIBLE;
function scrollTo(o) { const v = Math.max(0, Math.min(MAXOFF, Math.round(o))); if (v !== off) { off = v; mgraphics.redraw(); } }
// The scrollbar: the track is all 65 places, the thumb the visible 16; End/Loop and the playhead are marked on it.
const thumbW = (g) => ((g.x1 - g.x0) * VISIBLE) / MAXCOL;
const thumbX = (g) => g.x0 + ((g.x1 - g.x0) * off) / MAXCOL;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

// --- drawing --------------------------------------------------------------

// Table off (Speed 0): everything in grey, so the table shows but reads as unused. Each colour goes to its luminance, pulled towards the background.
let grey = false;
function ink(c) {
  if (!grey) { mgraphics.set_source_rgba(c); return; }
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], v = C.bg[0] + (l - C.bg[0]) * 0.55;
  mgraphics.set_source_rgba(v, v, v, c[3]);
}
function rect(c, x, y, w, h) { ink(c); mgraphics.rectangle(x, y, w, h); mgraphics.fill(); }
function text(c, s, x, y, size, center) {
  mgraphics.select_font_face("Arial"); mgraphics.set_font_size(size); ink(c);
  let tw = s.length * size * 0.5; try { tw = mgraphics.text_measure(s)[0]; } catch (e) {}
  mgraphics.move_to(center ? x - tw / 2 : x, y); mgraphics.show_text(s);
}
function line(c, pts, wdt) {
  ink(c); mgraphics.set_line_width(wdt || 1.2);
  mgraphics.move_to(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) mgraphics.line_to(pts[k][0], pts[k][1]);
  mgraphics.stroke();
}

// A step button: dark with light text, or filled with lit (a colour) and dark text.
function button(x, y, w, h, label, lit) {
  rect(lit || C.btn, x, y, w, h);
  text(lit ? C.btnText : C.dim, label, x + w / 2, y + h - 3.5, 9, true);
}
// Small waveform icon in the box (x, y, w, h).
function icon(key, x, y, w, h, c) {
  const L = x + 2, R = x + w - 2, T = y + 3, B = y + h - 3, M = (L + R) / 2;
  if (key === "tri") line(c, [[L, B], [M, T], [R, B]]);
  else if (key === "saw") line(c, [[L, B], [R, T], [R, B]]);
  else if (key === "pulse") line(c, [[L, B], [L, T], [M, T], [M, B], [R, B]]);
  else if (key === "mix") { line(c, [[L, B], [M, T], [R, B]]); line(c, [[L, (T + B) / 2], [M, (T + B) / 2], [M, B]], 0.8); }
  else if (key === "noise") { const ys = [0.5, 0.1, 0.8, 0.3, 0.9, 0.2, 0.6]; line(c, ys.map((v, k) => [L + (k / (ys.length - 1)) * (R - L), T + v * (B - T)]), 1); }
  else if (key === "off") line(c, [[L, (T + B) / 2], [R, (T + B) / 2]], 1);
  else text(c, "---", M, (T + B) / 2 + 3, 8, true);
}

// The loop button's symbols (sid.loopbtn.js), centred on (cx, cy) in a box h high: a circle with an arrowhead, or →|.
function termIcon(loop, cx, cy, h, c) {
  const g = mgraphics, head = (x, y, dx, dy, s) => { const px = -dy, py = dx; g.move_to(x, y); g.line_to(x - dx * s + px * s * 0.6, y - dy * s + py * s * 0.6); g.line_to(x - dx * s - px * s * 0.6, y - dy * s - py * s * 0.6); g.close_path(); g.fill(); };
  ink(c); g.set_line_width(1.3);
  if (loop) {
    const r = h * 0.3, a0 = -Math.PI * 0.35, a1 = Math.PI * 1.45;
    g.arc(cx, cy, r, a0, a1); g.stroke();
    head(cx + r * Math.cos(a1), cy + r * Math.sin(a1), -Math.sin(a1), Math.cos(a1), 3.5);
  } else {
    const x0 = cx - 8, x1 = cx + 6;
    g.move_to(x0, cy); g.line_to(x1 - 3, cy); g.stroke();
    head(x1 - 1, cy, 1, 0, 3.5);
    g.move_to(x1 + 1.5, cy - 5); g.line_to(x1 + 1.5, cy + 5); g.stroke();
  }
}

function paint() {
  const g = geom();
  grey = !(speed > 0);
  rect(C.bg, 0, 0, g.w, g.h);
  for (let i = off; i < Math.min(MAXCOL, off + VISIBLE); i++) {
    const x = colX(g, i), active = i < n;
    if (i % 2 === 0) rect(C.col, x, g.pitchY, g.cw, g.bottom - g.pitchY);
    if (i === hover && active) rect(C.hover, x, g.pitchY, g.cw, g.bottom - g.pitchY);
    if (g.cw >= 20 || i % 4 === 0) text(C.dim, String(i), x + 1, g.rulerY + 9, 8);   // every step once they are wide enough
    if (!active) continue;
    const s = steps[i], bx = x + 2, bw = g.cw - 4;
    // pitch
    if (s.mode === "F") { const hh = (Math.min(s.fixed, 81) / 81) * g.barH; rect(C.fixed, bx, g.barY + g.barH - hh, bw, Math.max(1, hh)); }
    else if (s.mode === "rel" && s.rel !== 0) { const hh = (Math.min(Math.abs(s.rel), 47) / 47) * (g.barH / 2); rect(C.rel, bx, s.rel >= 0 ? g.mid - hh : g.mid, bw, Math.max(1, hh)); }
    else line(C.keep, [[bx, g.mid], [bx + bw, g.mid]], 1);
    // the buttons: wave, sync, ring, pitch mode
    const wv = WAVES[s.wave];
    rect(C.btn, bx, g.waveY, bw, g.waveH);
    icon(wv.key, bx, g.waveY, bw, g.waveH, wv.key === "off" || wv.key === "keep" ? C.dim : C.text);
    button(bx, g.modY, bw, g.btnH, MOD_TEXT[s.sync | (s.ring << 1)], s.sync || s.ring ? C.on : null);
  }
  line(C.grid, [[g.x0, g.mid], [Math.min(g.x1, colX(g, n)), g.mid]], 0.5);                            // the ± zero line
  // the scrollbar
  rect(C.col, g.x0, g.scrollY, g.x1 - g.x0, g.scrollH);
  rect(C.hover, thumbX(g), g.scrollY, thumbW(g), g.scrollH);
  const mark = (i, c) => rect(c, g.x0 + ((g.x1 - g.x0) * (i + 0.5)) / MAXCOL - 1, g.scrollY, 2, g.scrollH);
  mark(Math.min(n, MAXCOL - 1), n >= MAXCOL ? C.dim : term === "loop" ? C.loop : C.end);
  if (play >= 0 && play < n) mark(play, C.on);
  if (play >= off && play < n && play < off + VISIBLE) {                                            // the playhead
    const px = colX(g, play);
    rect(C.play, px, g.pitchY, g.cw, g.bottom - g.pitchY);
    ink(C.on); mgraphics.move_to(px + 1, g.rulerY + 2); mgraphics.line_to(px + g.cw - 1, g.rulerY + 2);
    mgraphics.line_to(px + g.cw / 2, g.rulerY + 10); mgraphics.close_path(); mgraphics.fill();
  }
  // the End/Loop command sits at index n and is a step of its own, so it is drawn a whole step wide (that is how
  // the synth implements it). In the wave row it shows the loop button's symbol (a circle or →|) so the two read as one; only the
  // button toggles. Its left edge is where the steps end. A full table has no command: only the edge.
  if (n >= off && n <= off + VISIBLE) {
    const tx = Math.min(colX(g, n), g.x1 - 2), full = n >= MAXCOL, c = full ? C.dim : term === "loop" ? C.loop : C.end;
    if (!full && n < off + VISIBLE) {
      const bx = tx + 2, bw = g.cw - 4;
      rect([c[0], c[1], c[2], 0.2], bx, g.pitchY, bw, g.bottom - g.pitchY);
      text(c, term === "loop" ? "Loop" : "End", tx + g.cw / 2 + 1, g.pitchY + 10, 9, true);
      termIcon(term === "loop", tx + g.cw / 2 + 1, g.waveY + g.waveH / 2, g.waveH, c);   // the loop button's symbol (sid.loopbtn.js)
    } else if (full) text(c, "Full", tx - 22, g.pitchY + 10, 9);
    rect(c, tx, g.pitchY, 2, g.bottom - g.pitchY);
    ink(c); mgraphics.ellipse(tx + 1 - HANDLE, g.mid - HANDLE, 2 * HANDLE, 2 * HANDLE); mgraphics.fill();   // the handle to drag (like the envelope's)
  }
  // the loop: a line in the ruler from the target to the command, clipped to the view, and the target's triangle when it is in
  // view – drawn on its own so the loop's start still shows when the command is scrolled out
  if (term === "loop" && n < MAXCOL && target < off + VISIBLE && n >= off) {
    const c = C.loop, lx = colX(g, target), ex = Math.min(colX(g, n), g.x1);
    line(c, [[Math.max(g.x0, lx) + 1, g.rulerY + 12], [ex + 1, g.rulerY + 12]], 1);
    if (target >= off) {
      ink(c); mgraphics.move_to(lx, g.rulerY + 6); mgraphics.line_to(lx + 7, g.rulerY + 12); mgraphics.line_to(lx, g.rulerY + 16);
      mgraphics.close_path(); mgraphics.fill();
    }
  }
  if (msg) text(C.text, msg, g.w - g.pad - 170, g.rulerY + 9, 9);
  // while a bar is dragged: its note (or interval) on a tag above the bar
  const tagCol = drag && drag.type === "pitch" ? (drag.painting ? drag.col2 : drag.col) : -1;
  if (tagCol >= 0 && tagCol < n && steps[tagCol].mode !== "keep") {
    const s = steps[tagCol], x = colX(g, tagCol) + g.cw / 2, t = pitchText(s);
    const top = s.mode === "F" ? g.barY + g.barH - (Math.min(s.fixed, 81) / 81) * g.barH : s.rel >= 0 ? g.mid - (Math.min(s.rel, 47) / 47) * (g.barH / 2) : g.mid;
    const ty = Math.max(g.pitchY + 1, top - 14), tw = t.length * 6 + 6, tx = Math.max(g.x0, Math.min(g.w - g.pad - tw, x - tw / 2));
    rect([0, 0, 0, 0.75], tx, ty, tw, 12);
    text(s.mode === "F" ? C.fixed : C.rel, t, tx + tw / 2, ty + 9, 9, true);
  }
}

// --- interaction ----------------------------------------------------------

function describe(i) {
  if (i < 0 || i >= n) return i === n && n < MAXCOL ? (term === "loop" ? i + ": Loop to " + target : i + ": End") : "";
  const s = steps[i];
  const p = s.mode === "F" ? "note " + noteName(s.fixed + FIXED_OFFSET) + " (F" + s.fixed + " = MIDI " + (s.fixed + FIXED_OFFSET) + ")" : s.mode === "rel" ? (s.rel >= 0 ? "+" : "−") + Math.abs(s.rel) : "pitch ---";
  return i + ": " + WAVES[s.wave].label + "  " + p + (s.sync ? "  sync" : "") + (s.ring ? "  ring" : "");
}

function onidle(x, y) {
  const g = geom(), i = colAt(g, x);
  if (i !== hover) { hover = i; msg = describe(i); mgraphics.redraw(); }
}
function onidleout() { hover = -1; msg = ""; mgraphics.redraw(); }

function region(g, y) {
  if (y >= g.scrollY - 1) return "scroll";
  if (y < g.pitchY) return "ruler";
  if (y < g.waveY - 1) return "pitch";
  if (y < g.modY - 1) return "wave";
  return "mod";
}

function onclick(x, y, but, cmd, shift) {
  if (Date.now() - born < 1000) return;                         // Live sometimes delivers a click on load
  const g = geom(), i = colAt(g, x), r = region(g, y), dir = shift ? -1 : 1;
  const tx = Math.min(colX(g, n), g.x1 - 2);
  if (r === "scroll") {                                         // the thumb drags; a click beside it centres the view there
    const tx0 = thumbX(g);
    drag = { type: "scroll", grab: x >= tx0 && x <= tx0 + thumbW(g) ? x - tx0 : thumbW(g) / 2 };
    ondrag(x, y, 1); return;
  }
  const inCmd = n < MAXCOL && n >= off && n < off + VISIBLE && x > tx + 4 && x < tx + g.cw;                     // inside the command step
  if (n >= off && n <= off + VISIBLE && (inCmd || ((r === "ruler" || r === "pitch") && (Math.abs(x - tx) < 5 || Math.hypot(x - tx - 1, y - g.mid) <= HANDLE + 2)))) {
    drag = { type: "term", dx: inCmd ? x - tx : 0 }; return;                    // the edge, the ball or anywhere in the step drags the length
  }
  if (r === "ruler" && term === "loop") { drag = { type: "target" }; ondrag(x, y, 1); return; }
  if (r === "ruler") return;
  if (i >= n) return;
  const s = steps[i];
  if (r === "pitch") {
    // The mode from where the drag starts: on the step's own bar it stays; otherwise the bottom quarter = fixed tone (from C3 if it
    // was not one), above it = difference (from 0). Then the value moves with the distance dragged.
    const end = s.mode === "rel" ? g.mid - (s.rel / 47) * (g.barH / 2) : g.mid;          // a difference bar runs from the centre line to end
    const onBar = s.mode === "F" ? y >= g.barY + g.barH - (Math.min(s.fixed, 81) / 81) * g.barH - 3
      : s.mode === "rel" && s.rel !== 0 ? y >= Math.min(end, g.mid) - 3 && y <= Math.max(end, g.mid) + 3 : false;
    if (!onBar) {
      if (y >= g.barY + g.barH * 0.75) { if (s.mode !== "F") { s.mode = "F"; s.fixed = 60 - FIXED_OFFSET; } }
      else { if (s.mode !== "rel") { s.mode = "rel"; s.rel = 0; } }
    }
    drag = { type: "pitch", col: i, y0: y, start: s.mode === "F" ? s.fixed : s.rel }; msg = describe(i); changed(true); return;
  }
  if (r === "wave") { s.wave = (s.wave + dir + WAVES.length) % WAVES.length; drag = { type: "paint", key: "wave", v: s.wave }; }
  else { const m = ((s.sync | (s.ring << 1)) + dir + 4) % 4; s.sync = m & 1; s.ring = m >> 1; drag = { type: "paint", key: "mod", v: m }; }
  changed(true);
}

function ondrag(x, y, but) {
  if (!but) { if (drag) { drag = null; out(); } return; }
  if (!drag) return;
  const g = geom();
  if (drag.type === "scroll") { scrollTo(((x - drag.grab - g.x0) / (g.x1 - g.x0)) * MAXCOL); return; }
  if (drag.type === "term") {
    if (x > g.x1 - 4) scrollTo(off + 1); else if (x < g.x0 + 4) scrollTo(off - 1);   // dragging past an edge scrolls
    n = clamp((x - (drag.dx || 0) - g.x0) / g.cw + off, 0, MAXCOL); target = Math.max(0, Math.min(target, n - 1));   // MAXCOL = full, no command
    if (n === 0) term = "end";                                                // Loop at step 0 would loop to itself and hang the synth
  } else if (drag.type === "target") {
    target = clamp(Math.floor((x - g.x0) / g.cw) + off, 0, n - 1);
  } else if (drag.type === "pitch") {
    // Within the starting step the value moves relatively. Once the drag leaves it, it paints: each step under the mouse takes the
    // starting step's mode and the value at the mouse's height there (paints a new value per column).
    const j = colAt(g, x), mode = steps[drag.col].mode;
    if (j !== drag.col) drag.painting = true;
    if (!drag.painting) {
      const s = steps[drag.col], d = (drag.y0 - y) / PX_PER_SEMI;
      if (s.mode === "F") s.fixed = clamp(drag.start + d, 0, 81); else s.rel = clamp(drag.start + d, -47, 47);
      msg = describe(drag.col);
    } else if (j < n) {
      const s = steps[j];
      s.mode = mode;
      if (mode === "F") s.fixed = clamp(((g.barY + g.barH - y) / g.barH) * 81, 0, 81); else s.rel = clamp(((g.mid - y) / (g.barH / 2)) * 47, -47, 47);
      drag.col2 = j; msg = describe(j);
    }
  } else if (drag.type === "paint") {
    const i = colAt(g, x); if (i >= n) return;
    if (drag.key === "mod") { steps[i].sync = drag.v & 1; steps[i].ring = drag.v >> 1; } else steps[i][drag.key] = drag.v;
    msg = describe(i);
  }
  changed(true);
}

// Double click on a step's bars: no pitch change ("---", written as FF), whatever the mode was.
function ondblclick(x, y) {
  const g = geom(), i = colAt(g, x);
  if (region(g, y) !== "pitch" || i >= n) return;
  drag = null; steps[i].mode = "keep"; steps[i].rel = 0; msg = describe(i); changed();
}
function changed(quietWhileDragging) { mgraphics.redraw(); if (!(quietWhileDragging && drag)) out(); }

// --- Push ------------------------------------------------------------------

function push(key, v) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return;
  if (syncing) return;                                                       // our own value coming back from the knob
  knobVal[key] = v;
  if (!pushSeen[key]) { pushSeen[key] = true; sidlog("table", "push " + key + ": first value " + v + " kept, not applied (the restore on load)"); resync.schedule(300); return; }
  sidlog("table", "push", key, v);
  if (key !== "loop" && key !== "target") loopToShown = false;             // any other knob: Speed is back
  if (key === "step") { cursor = clamp(v, 0, Math.max(0, n - 1)); msg = describe(cursor); mgraphics.redraw(); knobs(); return; }   // not past the table: knobs() pushes the knob back
  if (key === "len") {
    n = clamp(v, 0, MAXCOL);
    if (term === "loop") n = Math.min(n, MAXCOL - 1);                         // a full table has no room for the Loop command
    if (n === 0) term = "end";
    target = Math.max(0, Math.min(target, n - 1));
    cursor = Math.min(cursor, Math.max(0, n - 1));                             // the cursor follows a shorter table
    changed(); return;
  }
  if (key === "loop") { if (v && term !== "loop") target = MAXCOL; loopmode(v); loopToShown = term === "loop" && n < MAXCOL; knobs(); return; }   // switching on: the last step (loopmode clamps)
  if (key === "target") { target = clamp(v, 0, Math.max(0, n - 1)); changed(); return; }
  if (cursor >= n) { sidlog("table", "push " + key + ": step " + cursor + " is beyond the table's " + n + " steps, turn Length first"); knobs(); return; }
  const s = steps[cursor];
  if (key === "wave") s.wave = clamp(v, 0, WAVES.length - 1);
  else if (key === "mod") { s.sync = v & 1; s.ring = (v >> 1) & 1; }
  else if (key === "pitch") s.mode = PITCH_MODES[clamp(v, 0, 2)];
  else if (key === "note") { s.mode = "F"; s.fixed = clamp(v, 0, 81); }
  else if (key === "offset") { s.mode = "rel"; s.rel = clamp(v, -47, 47); }
  else { post("sid.table: unknown push " + key + "\n"); return; }
  msg = describe(cursor); changed();
}
// The knobs follow the step under the cursor: "knob <key> <v>" -> [prepend set] -> the hidden parameter, silently.
function knobs() {
  const s = steps[cursor];
  syncing = true;
  try {
    for (const [k, v] of [["step", cursor], ["wave", s.wave], ["mod", s.sync | s.ring << 1], ["pitch", PITCH_MODES.indexOf(s.mode)],
      ["note", clamp(s.fixed, 0, 81)], ["offset", s.rel], ["len", n], ["loop", term === "loop" && n < MAXCOL ? 1 : 0], ["target", target]]) {
      if (knobVal[k] === v) continue;
      knobVal[k] = v; outlet(0, "knob", k, v);
    }
  } finally { syncing = false; }
  const slot = s.mode === "rel" ? 1 : 0;
  if (slot !== bankShown) { bankShown = slot; outlet(0, "bank", slot); }
  const lp = loopToShown ? 1 : 0;
  if (lp !== bankLoopShown) { bankLoopShown = lp; outlet(0, "bankloop", lp); }
}

// --- data -----------------------------------------------------------------

// A step read from the synth keeps its bytes and goes back unchanged until it is edited: Pull + Push gives the same table even
// where the editor shows an approximation (an unknown waveform code, the unused bits 0 and 3, a difference over 47).
const stepKey = (s) => [s.wave, s.sync, s.ring, s.mode, s.fixed, s.rel].join(" ");
function encode() {
  const b = [];
  for (let i = 0; i < n; i++) {
    const s = steps[i];
    if (s.raw && stepKey(s) === s.rawKey) { b.push(s.raw[0], s.raw[1]); continue; }
    b.push(WAVES[s.wave].code << 4 | s.ring << 2 | s.sync << 1);
    // no change = FF (R33 $9480); a difference of 0 is the same thing to the synth (adds 0), so it is written as FF too
    b.push(s.mode === "F" ? s.fixed : s.mode === "keep" || s.rel === 0 ? 0xff : s.rel >= 0 ? 0xc0 + s.rel : 0x80 - s.rel);
  }
  // the target is clamped: never FE FF (target -1 after 0 steps went out as FF)
  if (n < MAXCOL) { if (term === "loop") b.push(0xfe, Math.max(0, Math.min(target, n - 1))); else b.push(0xff); }
  return b;
}

function bytes() {
  const a = arrayfromargs(arguments).map(Number);
  steps = []; for (let i = 0; i < MAXCOL; i++) steps.push(newStep());
  n = 0; term = "end"; target = 0;
  for (let k = 0; k < a.length && n < MAXCOL; k += 2) {
    const d1 = a[k], d2 = a[k + 1];
    if (d1 === 0xff) break;
    if (d1 === 0xfe) { term = "loop"; target = Math.min(d2 | 0, Math.max(0, n - 1)); break; }
    const s = steps[n++], w = WAVES.findIndex((v) => v.code === d1 >> 4);
    s.wave = w < 0 ? 6 : w; s.ring = (d1 >> 2) & 1; s.sync = (d1 >> 1) & 1;
    if (d2 === 0xff) s.mode = "keep";
    else if (d2 <= 0x7f) { s.mode = "F"; s.fixed = d2; }                        // 00..7F (the panel only offers 00..51)
    else if (d2 < 0xc0) { s.mode = "rel"; s.rel = -(d2 - 0x80); }
    else { s.mode = "rel"; s.rel = d2 - 0xc0; }
    s.raw = [d1 & 0xff, d2 & 0xff]; s.rawKey = stepKey(s);
  }
  sidlog("table", "in:", n, "steps,", n >= MAXCOL ? "full (no command)" : term === "loop" ? "loop to " + target : "end");
  mgraphics.redraw(); out();
}

// --- playhead (simulation of the OS's table player) ---------------------------

function stopPlay() { ticker.cancel(); if (play !== -1) { play = -1; mgraphics.redraw(); } }
function startPlay() {
  if (!(speed > 0) || n < 1) { stopPlay(); return; }
  play = 0; cnt = speed; t0 = Date.now(); done = 0;
  ticker.interval = 20; ticker.repeat();
  mgraphics.redraw();
}
// One OS tick: count down; at 0 the next step; Loop -> target (same tick); End/65 -> stop.
function tick() {
  if (play < 0) return;
  if (--cnt > 0) return;
  let pos = play + 1;
  if (pos >= 65 || pos > n) { stopPlay(); return; }
  if (pos === n) {
    if (term === "loop" && n < MAXCOL) pos = target;
    else { stopPlay(); return; }
  }
  play = pos; cnt = speed;
  mgraphics.redraw();
}
// A Max Task fires late under load, so count the OS ticks from the wall clock instead of one tick per call.
function pump() {
  const due = Math.floor((Date.now() - t0) * rateHz / 1000);
  while (done < due && play >= 0) { done++; tick(); }
}
function note(v) {
  if (Number(v)) { held++; startPlay(); }
  else { held = Math.max(0, held - 1); if (!held) stopPlay(); }
}
function msg_int(v) { note(v); }
function rate(hz) { pump(); rateHz = Math.max(10, Math.min(400, Number(hz) || 100)); t0 = Date.now(); done = 0; }
function speedmsg(v) { speed = Math.max(0, Math.min(127, Math.round(Number(v)) || 0)); if (!speed) stopPlay(); mgraphics.redraw(); }   // redraw: grey at Speed 0

// loopmode 0|1 from the one-shot/loop button (sid.loopbtn.js): End <-> Loop; a full table gives up its last step for the command.
function loopmode(v) {
  if (Number(v) && n > 0) { if (n >= MAXCOL) n = MAXCOL - 1; term = "loop"; target = Math.max(0, Math.min(target, n - 1)); } else term = "end";   // no Loop on an empty table (it would loop to itself)
  changed();
}
// Stored by Live (the box is a hidden blob parameter): [1 (format), n, encoded table…]. setvalueof loads it like a dump; the router
// takes the first table after loading as its baseline, so a restore is not echoed to the synth (a preset recall later is sent).
function getvalueof() { return [1, n].concat(encode()); }
function setvalueof() {
  const a = arrayfromargs(arguments).map(Number);
  if (a[0] !== 1 || a.length < 3) { sidlog("table", "stored value ignored (format", a[0], "length", a.length + ")"); return; }
  const len = a[1], b = a.slice(2);
  bytes.apply(this, b);
  if (len >= MAXCOL && n !== len) { n = len; mgraphics.redraw(); out(); }   // a full table (no command) is not told apart by bytes()
  sidlog("table", "restored from Live:", n, "steps");
}
function out() {
  try { notifyclients(); } catch (e) {}                                  // Live: the stored value changed
  outlet(0, "steps", n, term, target);
  outlet(0, "loop", term === "loop" && n < MAXCOL ? 1 : 0);              // -> the button
  outlet(0, ["bytes"].concat(encode()));
  knobs();
}
function bang() { out(); }
function onresize() { mgraphics.redraw(); }

// "speed n" from the Table Speed dial (v8: a function cannot be named after the message when that name is taken, so
// anything() dispatches it)
function anything() {
  const a = arrayfromargs(arguments);
  if (messagename === "speed") speedmsg(a[0]);
  else post("sid.table: unknown message " + messagename + "\n");
}

paint = sidguard("table", paint); note = sidguard("table", note); rate = sidguard("table", rate); anything = sidguard("table", anything); tick = sidguard("table", tick); onclick = sidguard("table", onclick); ondrag = sidguard("table", ondrag); bytes = sidguard("table", bytes);
onidle = sidguard("table", onidle); ondblclick = sidguard("table", ondblclick); setvalueof = sidguard("table", setvalueof); push = sidguard("table", push);
reset();                                                                 // silent: a reload (autowatch) must not send an empty table to the synth
sidlog("table", "loaded");
