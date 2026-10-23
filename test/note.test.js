// node --test: max/sid.note.js in a v8ui mock – names in the synth's style, drag, enable.
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function loadWidget() {
  const out = [];
  const mg = { size: [48, 18], init() {}, redraw() {}, text_measure: (s) => [s.length * 6, 10] };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "stroke", "move_to", "select_font_face", "set_font_size", "show_text"]) mg[f] = () => {};
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, outlet: (o, ...a) => out.push(a.join(" ")), arrayfromargs: (a) => Array.from(a), messagename: "x" };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.note.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { get note() { return note; }, noteName, paint, onclick, ondrag, noteMsg: (v) => apply(v), set, bang, enable, range };");
  return { w: fn(...Object.values(g)), out };
}

test("note names as on the synth display: 60 = C-5, 99 = D#8, 100 = E-8, 1 = C#0", () => {
  const { w } = loadWidget();
  assert.equal(w.noteName(60), "C-5"); assert.equal(w.noteName(99), "D#8"); assert.equal(w.noteName(100), "E-8"); assert.equal(w.noteName(1), "C#0");
});

test("note sets and echoes, set is silent, clamped to 1..100 with echo", () => {
  const { w, out } = loadWidget();
  w.noteMsg(72); assert.deepEqual(out.splice(0), ["note 72"]);
  w.set("note", 60); assert.deepEqual(out.splice(0), []); assert.equal(w.note, 60);
  w.noteMsg(0); assert.deepEqual(out.splice(0), ["note 1"]);
  w.noteMsg(127); assert.deepEqual(out.splice(0), ["note 100"]);
});

test("dragging up raises 1 semitone per 4 px; disabled (start) ignores drag", () => {
  const { w, out } = loadWidget();
  w.set("note", 60);
  w.onclick(10, 10); w.ondrag(10, -40, 1); assert.deepEqual(out.splice(0), []);   // starts disabled
  w.enable(1);
  w.onclick(10, 10); w.ondrag(10, 10 - 12, 1); w.ondrag(10, 10 - 12, 0);
  assert.deepEqual(out.splice(0), ["note 63"]);
  w.enable(0); w.paint();
  w.onclick(10, 10); w.ondrag(10, -40, 1);
  assert.deepEqual(out.splice(0), []); assert.equal(w.note, 63);
  w.enable(1); w.paint();
});
