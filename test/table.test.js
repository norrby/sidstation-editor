// node --test: max/sid.table.js in a v8ui mock (table bytes in/out, End/Loop, clicks on mode/wave/sync).
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function loadWidget() {
  const out = [], logs = [], inks = [];
  const mg = { size: [640, 150], init() {}, redraw() {}, text_measure: () => [10, 8] };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "move_to", "line_to", "stroke", "close_path", "select_font_face", "set_font_size", "show_text", "arc", "ellipse"]) mg[f] = () => {};
  mg.set_source_rgba = (...a) => inks.push([].concat(...a));
  const g = { UI, sidlog: (...a) => logs.push(a.join(" ")), sidguard, mgraphics: mg, post() {}, outlet: (o, ...a) => out.push([].concat(...a).join(" ")), arrayfromargs: (a) => Array.from(a),
    messagename: "", Task: class { constructor(fn) { this.fn = fn; this.running = false; } repeat() { this.running = true; } cancel() { this.running = false; } schedule() {} } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.table.js"), "utf8")
    .replace(/^inlets = 1;\noutlets = 1;\n/m, "").replace("const born = Date.now();", "const born = 0;");
  const fn = new Function(...Object.keys(g), src + "\nreturn { geom, paint, onclick, ondrag, bytes, bang, encode, clear, loopmode, note, tick, rate, speed: (v) => { messagename = 'speed'; anything(v); }, get play() { return play; }, get running() { return ticker.running; }, get n() { return n; }, get term() { return term; }, get steps() { return steps; }, push, get cursor() { return cursor; } };");
  return { w: fn(...Object.values(g)), out, logs, inks };
}
const last = (out) => out.filter((s) => s.startsWith("bytes")).pop();

test("tables read back byte for byte (fixed notes, relative notes, End)", () => {
  const { w, out } = loadWidget();
  for (const t of [[0x10, 0x24, 0x10, 0x30, 0x10, 0x18, 0x10, 0x1c, 0xff], [0x10, 0xc4, 0x10, 0xd0, 0x10, 0xc8, 0x10, 0x8c, 0xff], [0x16, 0x28, 0x54, 0x30, 0x14, 0x34, 0xff]]) {
    w.bytes(...t);
    assert.equal(last(out), "bytes " + t.join(" "));
  }
  assert.equal(w.n, 3);
  assert.deepEqual([w.steps[0].sync, w.steps[0].ring, w.steps[1].wave], [1, 1, 3]);       // 16 = Tri+ring+sync, 54 = Mix+ring
});

test("C0+n adds and 80+n subtracts", () => {
  const { w } = loadWidget();
  w.bytes(0x10, 0xe1, 0x10, 0x85, 0xff);
  assert.deepEqual([w.steps[0].mode, w.steps[0].rel, w.steps[1].rel], ["rel", 33, -5]);
});

test("DATA2 FF is no pitch change (---) and is written back as FF (R33 $9480)", () => {
  const { w, out } = loadWidget();
  w.bytes(0x90, 0xff, 0x10, 0x3c, 0xff);
  assert.deepEqual([w.steps[0].mode, w.steps[1].mode, w.steps[1].fixed], ["keep", "F", 60]);
  assert.equal(last(out), "bytes 144 255 16 60 255");
});

test("Loop: FE xx reads back, the target is clamped below the loop step", () => {
  const { w, out } = loadWidget();
  w.bytes(0x10, 0x30, 0x20, 0xc0, 0x40, 0x3c, 0xfe, 0x01);
  assert.equal(w.term, "loop"); assert.equal(last(out), "bytes 16 48 32 192 64 60 254 1");   // a step read in goes back as it was (C0)
  w.bytes(0x10, 0x30, 0xfe, 0x05);
  assert.equal(last(out), "bytes 16 48 254 0");
});

test("Pull + Push is exact: steps read in go back byte for byte until edited, also what the editor only approximates", () => {
  const { w, out } = loadWidget();
  // fixed 83 (above the panel's 81), subtract 53 (over 47), add 0, an unknown wave code 3 with the unused bits 0 and 3 set
  w.bytes(0x10, 0x53, 0x20, 0xb5, 0x40, 0xc0, 0x39, 0x30, 0xff);
  assert.equal(last(out), "bytes 16 83 32 181 64 192 57 48 255");
  assert.equal(w.steps[0].mode, "F"); assert.equal(w.steps[0].fixed, 83);
  w.steps[1].rel = -12;                                                    // an edit: that step is encoded again, the rest stay
  w.bang();
  assert.equal(last(out), "bytes 16 83 32 140 64 192 57 48 255");
});

test("clicks: wave cycles, mod cycles off -> sync -> ring -> s+r; columns after the table ignore clicks", () => {
  const { w, out } = loadWidget();
  w.bytes(0x10, 0x30, 0xff);
  const g = w.geom(), x = g.x0 + g.cw / 2;
  w.onclick(x, g.waveY + 5); w.ondrag(0, 0, 0);
  assert.equal(w.steps[0].wave, 1);                                              // Tri -> Saw
  const mod = () => { w.onclick(x, g.modY + 5); w.ondrag(0, 0, 0); return [w.steps[0].sync, w.steps[0].ring]; };
  assert.deepEqual([mod(), mod(), mod(), mod()], [[1, 0], [0, 1], [1, 1], [0, 0]]);
  mod();                                                                         // sync
  w.onclick(g.x0 + 5 * g.cw + 3, g.waveY + 5); w.ondrag(0, 0, 0);
  assert.equal(w.steps[5].wave, 0);
  assert.equal(last(out), "bytes 34 48 255");                                    // Saw + sync, F48, End
  w.paint();
});

test("pitch drag is relative: 3 px per semitone from where it starts, clamped", () => {
  const { w, out } = loadWidget();
  w.bytes(0x10, 0x30, 0x10, 0xc0, 0xff);                         // F48, diff +0
  const g = w.geom(), y = g.barY + 5, yb = g.barY + g.barH - 2;
  w.onclick(g.x0 + 3, yb); w.ondrag(g.x0 + 3, yb - 12, 1); w.ondrag(0, 0, 0);    // on the tone bar: stays a tone
  assert.equal(w.steps[0].fixed, 52, "12 px up = +4 semitones");
  w.onclick(g.x0 + g.cw + 3, y); w.ondrag(g.x0 + g.cw + 3, y + 600, 1); w.ondrag(0, 0, 0);
  assert.equal(w.steps[1].rel, -47, "clamped at -47");
  assert.equal(last(out), "bytes 16 52 16 175 255");
});

test("where a pitch drag starts sets the mode: bottom quarter = tone from C3, above = difference from 0, the own bar keeps it", () => {
  const { w } = loadWidget();
  w.bytes(0x10, 0xff, 0x10, 0xff, 0x10, 0x3c, 0xff);                         // ---, ---, F60
  const g = w.geom(), bottom = g.barY + g.barH - 2, high = g.barY + 4;
  w.onclick(g.x0 + 3, bottom); w.ondrag(0, 0, 0);
  assert.deepEqual([w.steps[0].mode, w.steps[0].fixed], ["F", 48], "tone, from C3 (F48 = MIDI 60)");
  w.onclick(g.x0 + g.cw + 3, high); w.ondrag(0, 0, 0);
  assert.deepEqual([w.steps[1].mode, w.steps[1].rel], ["rel", 0], "difference");
  w.onclick(g.x0 + 2 * g.cw + 3, bottom); w.ondrag(0, 0, 0);
  assert.deepEqual([w.steps[2].mode, w.steps[2].fixed], ["F", 60], "on its own bar: unchanged");
  w.onclick(g.x0 + 2 * g.cw + 3, high); w.ondrag(0, 0, 0);
  assert.equal(w.steps[2].mode, "rel", "above the bar: becomes a difference");
});

test("a pitch drag that leaves its step paints: each step under the mouse gets the start's mode and the value at that height", () => {
  const { w } = loadWidget();
  w.bytes(0x10, 0x3c, 0x10, 0xff, 0x10, 0xc5, 0x10, 0xff, 0xff);              // F60, ---, +5, ---
  const g = w.geom(), yb = g.barY + g.barH - 2, cx = (k) => g.x0 + k * g.cw + 3, yAt = (f) => g.barY + g.barH - (f / 81) * g.barH;
  w.onclick(cx(0), yb); w.ondrag(cx(1), yAt(20), 1); w.ondrag(cx(2), yAt(70), 1); w.ondrag(0, 0, 0);
  assert.deepEqual(w.steps.slice(0, 4).map((s) => s.mode + (s.mode === "F" ? s.fixed : s.rel)), ["F60", "F20", "F70", "keep0"]);
});

test("playhead: every step lasts <speed> ticks, Loop jumps to its target, End stops, note off stops, speed 0 = no table", () => {
  const { w } = loadWidget();
  w.bytes(0x10, 0x30, 0x20, 0x30, 0x40, 0x30, 0xfe, 0x01);       // 3 steps, Loop to 1
  w.note(1); assert.equal(w.play, -1, "speed 0: no table");
  w.speed(2); w.note(0); w.note(1);
  const seq = [w.play];
  for (let k = 0; k < 9; k++) { w.tick(); seq.push(w.play); }
  assert.deepEqual(seq, [0, 0, 1, 1, 2, 2, 1, 1, 2, 2]);
  w.note(0); assert.equal(w.play, -1); assert.equal(w.running, false);
  w.bytes(0x10, 0x30, 0x20, 0x30, 0xff); w.speed(1); w.note(1);
  w.tick(); assert.equal(w.play, 1); w.tick(); assert.equal(w.play, -1, "End stops");
  w.paint();
});

test("Clear gives the smallest table (End alone); an empty table loads as 0 steps and cannot loop", () => {
  const { w } = loadWidget();
  w.clear();
  assert.equal(w.n, 0);
  assert.deepEqual(w.encode(), [0xff]);
  w.bytes(0x10, 0xc0, 0xff); assert.equal(w.n, 1);
  w.bytes(0xff); assert.equal(w.n, 0, "FF first = no steps (factory patches), not one step");
  w.loopmode(1); assert.equal(w.term, "end", "Loop at step 0 would loop to itself");
  assert.deepEqual(w.encode(), [0xff]);
});

test("the command is a whole step: a click in it does not toggle, dragging inside it moves the length without a jump", () => {
  const { w, logs } = loadWidget();
  w.bytes(0x10, 0xc0, 0x10, 0xc0, 0x10, 0xc0, 0xff);                     // three steps, End at 3
  const g = w.geom(), cx = g.x0 + 3 * g.cw + g.cw / 2;
  w.onclick(cx, g.waveY + 4); w.ondrag(cx, g.waveY + 4, 0); assert.equal(w.term, "end", "only the loop button toggles");
  w.onclick(cx, g.mid); w.ondrag(cx, g.mid, 1); assert.equal(w.n, 3, "grabbing the middle does not move it");
  w.ondrag(cx + g.cw, g.mid, 1); assert.equal(w.n, 4);
  w.ondrag(cx + g.cw, g.mid, 0);
  w.paint(); w.loopmode(1); w.paint();
  assert.deepEqual(logs.filter((l) => /ERROR/.test(l)), [], "the End and Loop symbols draw without errors");
});

test("Speed 0 draws the table in grey, Speed > 0 in colour", () => {
  const { w, inks, logs } = loadWidget();
  w.bytes(0x10, 0x30, 0xff);                                            // one fixed-note step (orange)
  const coloured = () => inks.some(([r, g, b]) => Math.abs(r - g) > 0.05 || Math.abs(g - b) > 0.05);
  inks.length = 0; w.paint(); assert.ok(!coloured(), "Speed 0: only greys");
  w.speed(10); inks.length = 0; w.paint(); assert.ok(coloured(), "Speed > 0: colours back");
  assert.deepEqual(logs.filter((l) => /ERROR/.test(l)), []);
});

test("Clear, then steps, then Loop: the target is a real step (it once went out as FE FF)", () => {
  const { w } = loadWidget();
  w.clear();
  const g = w.geom();
  w.onclick(g.x0 + 1, g.mid); w.ondrag(g.x0 + 3 * g.cw, g.mid, 1); w.ondrag(g.x0 + 3 * g.cw, g.mid, 0);   // drag End from 0 to 3
  assert.equal(w.n, 3);
  w.loopmode(1);
  const b = w.encode();
  assert.deepEqual(b.slice(-2), [0xfe, 0], "Loop to step 0, not FF");
});

// --- Push: the table step by step from the "Osc n Table" bank ----------------------------------------------------------
const knob = (out, key) => out.filter((s) => s.startsWith("knob " + key + " ")).pop();

// Every knob's first value is Live's restore on load and is never applied (also before the table is restored, so a real table is safe).
const KEYS = ["step", "wave", "mod", "pitch", "note", "offset", "len", "loop", "target"];
const restore = (w) => { for (const k of KEYS) w.push(k, 0); };

test("push: the first value per knob (the restore on load) is kept, not applied; then the step under the cursor is edited and the table goes out as after a click", () => {
  const { w, out, logs } = loadWidget();
  w.bytes(0x10, 0x3c, 0x20, 0xff, 0xff);                                   // Tri F60, Saw ---, End
  restore(w);                                                                // what Live sends on load, after the table was restored
  assert.equal(logs.filter((l) => /first value .* kept/.test(l)).length, KEYS.length);
  assert.equal(w.n, 2); assert.equal(last(out), "bytes 16 60 32 255 255", "the table is untouched");
  w.bytes(0x10, 0x3c, 0x20, 0xff, 0xff);
  assert.deepEqual([knob(out, "step"), knob(out, "wave"), knob(out, "pitch"), knob(out, "note"), knob(out, "len")], [undefined, undefined, "knob pitch 1", "knob note 60", "knob len 2"],
    "only the knobs that differ from Live's restore (0) are written");
  const tables = () => out.filter((s) => s.startsWith("bytes")).length, nb = tables();
  w.push("step", 1);                                                        // the knobs that differ from step 0 follow; Step itself is not echoed
  assert.deepEqual([knob(out, "step"), knob(out, "wave"), knob(out, "pitch")], [undefined, "knob wave 1", "knob pitch 0"]);
  assert.equal(tables(), nb, "moving the cursor sends no table");
  w.push("wave", 4); w.push("mod", 1); w.push("offset", -5);
  assert.deepEqual([w.steps[1].wave, w.steps[1].sync, w.steps[1].mode, w.steps[1].rel], [4, 1, "rel", -5]);
  assert.equal(last(out), "bytes 16 60 130 133 255");                      // 82 = Noise + sync, 85 = subtract 5
  assert.equal(knob(out, "pitch"), "knob pitch 2");                          // the pitch knob followed the offset
  assert.deepEqual(out.filter((s) => s.startsWith("bank ")), ["bank 1"], "the slot after Pitch: Note as built (not sent: every bank edit is an undo step in Live), Offset once the step is relative");
  w.push("note", 48); assert.deepEqual([w.steps[1].mode, w.steps[1].fixed], ["F", 48]); assert.equal(last(out), "bytes 16 60 130 48 255");
  w.push("pitch", 0); assert.equal(last(out), "bytes 16 60 130 255 255");
});

test("a new device writes no knob and no bank (each is an undo step in Live), and an undo of a knob beyond the table is not written back", () => {
  const { w, out } = loadWidget();
  w.bytes(0xff);                                                             // an empty table, as a new device restores it
  restore(w); w.bang();                                                      // Live's restore, then the resync
  assert.deepEqual(out.filter((s) => /^(knob|bank)/.test(s)), [], "nothing written on load");
  w.push("note", 0);                                                         // Cmd+Z turned a knob: refused, and not answered with a write
  assert.deepEqual(out.filter((s) => /^(knob|bank)/.test(s)), []);
});

test("push: Length grows and shrinks the table, keeps Loop below 65 and clamps the cursor's edits to the table", () => {
  const { w, out, logs } = loadWidget();
  restore(w);
  w.bytes(0x10, 0x3c, 0xfe, 0x00);
  w.push("len", 3); assert.equal(w.n, 3); assert.equal(last(out), "bytes 16 60 16 255 16 255 254 0");   // new steps: Tri ---
  w.push("len", 65); assert.equal(w.n, 64, "a looping table keeps room for the command");
  w.push("len", 0); assert.equal(w.term, "end"); assert.equal(last(out), "bytes 255");
  w.push("loop", 1); assert.equal(w.term, "end", "an empty table cannot loop"); assert.equal(knob(out, "loop"), "knob loop 0");
  w.push("len", 2); w.push("loop", 1); assert.equal(last(out), "bytes 16 60 16 255 254 1", "steps keep their content when the table grows back; switching on loops to the last step");
  assert.equal(knob(out, "target"), "knob target 1"); assert.equal(out.filter((s) => s.startsWith("bankloop")).pop(), "bankloop 1", "Loop To shows");
  w.push("mod", 3); assert.equal(last(out), "bytes 22 60 16 255 254 1");                                                     // 22 = Tri + ring + sync
  assert.equal(out.filter((s) => s.startsWith("bankloop")).pop(), "bankloop 0", "another knob was turned: Speed is back");
  w.push("loop", 1); assert.equal(out.filter((s) => s.startsWith("bankloop")).pop(), "bankloop 1", "Loop turned while looping: Loop To again");
  w.push("target", 0); assert.equal(last(out), "bytes 22 60 16 255 254 0");
  w.push("target", 9); assert.equal(last(out), "bytes 22 60 16 255 254 1", "the target stays inside the table"); assert.equal(knob(out, "target"), "knob target 1");
  w.push("loop", 0); assert.equal(last(out), "bytes 22 60 16 255 255"); assert.equal(out.filter((s) => s.startsWith("bankloop")).pop(), "bankloop 0", "Loop To hides");
  w.push("loop", 1); assert.equal(last(out), "bytes 22 60 16 255 254 1", "on again: the last step, not the old target");
  w.push("loop", 0); assert.equal(last(out), "bytes 22 60 16 255 255");
  w.push("len", 0);
  w.push("step", 5); w.push("wave", 1);
  assert.ok(logs.some((l) => /beyond the table/.test(l))); assert.equal(last(out), "bytes 255");
  w.push("len", 10); w.push("step", 99); assert.equal(w.cursor, 9, "Step stops at the last step"); assert.equal(knob(out, "step"), "knob step 9");
  w.push("len", 4); assert.equal(w.cursor, 3, "the cursor follows a shorter table"); assert.equal(knob(out, "step"), "knob step 3");
});
