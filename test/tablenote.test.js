// node --test: max/sid.tablenote.js (the note after "Oscillator n" while the table is on) and the frame it lights up in sid.voicebg.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { UI } = require("../lib/ui");
const { sidlog, sidguard } = require("../lib/maxlog");
const L = require("../lib/layout");

function mock(size, drawn) {
  const mg = { size, init() {}, redraw() {}, text_measure: (t) => [t.length * 5, 9] };
  return new Proxy(mg, { get: (o, k) => (k in o ? o[k] : (...a) => drawn.push([k, ...a])) });
}
function loadNote() {
  const out = [], drawn = [];
  const g = { UI, sidlog() {}, sidguard, mgraphics: mock([124, 14], drawn), inlets: 0, outlets: 0, post() {}, messagename: "", arrayfromargs: (a) => Array.from(a), outlet: (o, ...a) => out.push(a.join(" ")) };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.tablenote.js"), "utf8");
  const w = new Function(...Object.keys(g), src + "\nreturn { paint, onidle, onidleout, label };")(...Object.values(g));
  return { w, out, drawn };
}
function loadBg() {
  const drawn = [];
  const g = { UI, sidlog() {}, sidguard, mgraphics: mock([700, 169], drawn), inlets: 0, outlets: 0, post() {}, messagename: "", arrayfromargs: (a) => Array.from(a), outlet() {} };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.voicebg.js"), "utf8");
  const w = new Function(...Object.keys(g), src + "\nreturn { paint, shape, hilite };")(...Object.values(g));
  return { w, drawn };
}

test("the note sends 1 once when the mouse comes over it and 0 once when it leaves; paints the text", () => {
  const { w, out, drawn } = loadNote();
  w.paint(); assert.ok(drawn.some((d) => d[0] === "show_text" && d[1] === "(using waveform table)"));
  w.onidle(); w.onidle(); assert.deepEqual(out.splice(0), ["1"]);
  w.onidleout(); w.onidleout(); assert.deepEqual(out.splice(0), ["0"]);
});

test("the voice background frames the tbl row and, when open, its panel on hilite 2 1, and nothing on hilite 2 0", () => {
  const { w, drawn } = loadBg();
  // mode 1, body at x 70, frame 3..166, inner 7..162, three rows: osc (open, panel 0), env (open, panel 1), tbl (open, panel 2); three panels
  const sh = [1, 70, 3, 166, 7, 162, 3, 1, 24, 10, 18, 0, -1, 0, 1, 24, 32, 18, 1, -1, 0, 1, 24, 54, 18, 2, -1, 0, 3, 80, 200, 290, 224, 524, 576];
  w.shape(...sh);
  w.paint(); const before = drawn.filter((d) => d[0] === "stroke").length;
  w.hilite(2, 1); drawn.length = 0; w.paint();
  const strokes = drawn.filter((d) => d[0] === "stroke").length;
  assert.equal(strokes, 2, "the row's frame and the panel's frame");
  assert.ok(drawn.some((d) => d[0] === "set_source_rgba" && String(d[1]) === String(UI.peak)), "in the accent colour");
  w.hilite(2, 0); drawn.length = 0; w.paint();
  assert.equal(drawn.filter((d) => d[0] === "stroke").length, before, "no frame without the hilite");
  // a closed row: only the label's frame
  sh[7 + 7 * 2] = 0; w.shape(...sh); w.hilite(2, 1); drawn.length = 0; w.paint();
  assert.equal(drawn.filter((d) => d[0] === "stroke").length, 1);
});

test("layout: the note is hidden at Table Speed 0 and shown above 0", () => {
  const panel = { id: "o1", kind: "osc", fullW: 400, compactW: 300, shift: 100, items: [{ name: "o1_tblnote", rect: [10, 9, 124, 14], when: "tblon" }, { name: "o1_osctitle", rect: [0, 10, 100, 15] }] };
  const layout = { panels: [{ id: "v1", kind: "voice", colW: 60, gap: 10, pad: 8, items: [], sub: [panel] }], backs: [] };
  const state = L.initialState(layout);
  const rects = (st) => Object.fromEntries(L.compute(layout, st).ops.map((o) => [o.name, o.rect]));
  assert.equal(rects(state).o1_tblnote, null, "Table Speed 0: no note");
  state.o1.tblon = 1; state.o1.tbloff = 0;
  assert.ok(rects(state).o1_tblnote, "Table Speed > 0: the note is placed");
});
