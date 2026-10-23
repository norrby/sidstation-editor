// node --test: max/sid.adsr.js in a v8ui mock (messages, drag, clamping).
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function loadWidget() {
  const out = [];
  const mg = { size: [360, 130], init() {}, redraw() {} };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "move_to", "line_to", "stroke", "close_path", "ellipse", "select_font_face", "set_font_size", "show_text"]) mg[f] = () => {};
  mg.text_measure = (s) => [s.length * 5, 9];
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, outlet: (o, ...a) => out.push(a.join(" ")), arrayfromargs: (a) => Array.from(a), messagename: "x" };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.adsr.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { val, geom, fmt, paint, onclick, ondrag, attack, decay, sustain, release, set, bang, steps, levels, sustainlen, times, units, gate };");
  return { w: fn(...Object.values(g)), out };
}

test("messages set and echo, set is silent, bang sends all", () => {
  const { w, out } = loadWidget();
  w.steps(16); w.levels(16);
  w.attack(5); w.decay(3); w.sustain(9); w.release(2);
  assert.deepEqual(out.splice(0), ["attack 5", "decay 3", "sustain 9", "release 2"]);
  w.set("attack", 7, "sustain", 12);
  assert.deepEqual(out.splice(0), []);
  w.bang();
  assert.deepEqual(out.splice(0), ["attack 7", "decay 3", "sustain 12", "release 2"]);
});

test("out-of-range values are clamped and echoed back, valid unchanged ones stay silent", () => {
  const { w, out } = loadWidget();
  w.steps(16); w.attack(15); out.length = 0;
  w.attack(127); assert.deepEqual(out.splice(0), ["attack 15"]);
  w.attack(15); assert.deepEqual(out.splice(0), []);
  w.attack(-3); assert.deepEqual(out.splice(0), ["attack 0"]);
});

test("drag: the peak sets attack, the decay point sets decay+sustain, release is clamped at the edge", () => {
  const { w, out } = loadWidget();
  w.steps(16); w.levels(16); w.sustainlen(6); w.sustain(9); out.length = 0;
  let g = w.geom();
  w.onclick(g.x1, g.top); w.ondrag(g.x0 + 10 * g.u, g.top, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["attack 10"]);
  g = w.geom();
  w.onclick(g.x2, g.yS); w.ondrag(g.x1 + 15 * g.u, g.bottom, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["decay 15", "sustain 0"]);
  g = w.geom();
  w.onclick(g.x4, g.bottom); w.ondrag(9999, g.bottom, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["release 15"]);
  w.attack(15); g = w.geom();
  assert.ok(Math.abs(g.x4 - (g.w - g.pad)) < 1e-6, "all max → the curve reaches the right edge");
});

test("labels from a time table: ms below one second, otherwise seconds", () => {
  const { w } = loadWidget();
  w.times("attack", 2, 8, 16, 24, 38, 56, 68, 80, 100, 240, 500, 800, 1000, 3000, 5000, 8000);
  assert.equal(w.fmt("attack", 4), "38 ms");
  assert.equal(w.fmt("attack", 12), "1 s");
  assert.equal(w.fmt("attack", 15), "8 s");
  assert.equal(w.fmt("decay", 3), "3", "without a table the raw value is shown");
});

test("switching to 128 steps does not clamp down, paint works in both modes", () => {
  const { w } = loadWidget();
  w.steps(16); w.attack(15); w.paint();
  w.steps(128); w.levels(128); w.attack(100); w.sustain(127); w.paint();
  assert.deepEqual([w.val.attack, w.val.sustain], [100, 127]);
});

test("filter: depth scales the height above the baseline (cutoff), invert turns the curve downwards, the edges clamp", () => {
  const { w, out } = loadWidget();
  w.steps(128); w.levels(128); w.sustain(127); out.length = 0;
  let g = w.geom(); assert.equal(g.yB, g.bottom); assert.equal(g.yP, g.top);                 // without depth: the full height as before
  w.set("depth", 0, "base", 0); g = w.geom(); assert.equal(g.yP, g.bottom);                   // depth 0: flat on the baseline
  w.set("depth", 127); g = w.geom(); assert.equal(g.yP, g.top);
  w.set("base", 64); g = w.geom();
  assert.ok(Math.abs(g.yB - (g.bottom - g.hgt * 64 / 127)) < 1e-6); assert.equal(g.yP, g.top); // cutoff 64 + 127 is clamped at 127
  w.set("invert", 1); g = w.geom(); assert.equal(g.yP, g.bottom);                             // 64 - 127 is clamped at 0
  w.set("depth", 32); g = w.geom(); assert.ok(Math.abs(g.yP - (g.yB + g.hgt * 32 / 127)) < 1e-6);
  w.paint();
  // the decay point is dragged relative to the baseline: to the baseline → sustain 0, halfway to the curve's top → 64
  w.onclick(g.x2, g.yS); w.ondrag(g.x2, g.yB, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["sustain 0"]);
  g = w.geom(); w.onclick(g.x2, g.yS); w.ondrag(g.x2, (g.yB + g.yP) / 2, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["sustain 64"]);
});

test("units: units in the corners are drawn without errors, even without a y unit", () => {
  const { w } = loadWidget();
  w.units("s", "Hz"); w.paint();
  w.units("s"); w.paint();
});

test("gate: the curve is drawn as a gate, a click only changes the sustain level", () => {
  const { w, out } = loadWidget();
  w.steps(16); w.levels(16); w.set("attack", 5, "decay", 3, "sustain", 9, "release", 2);
  w.set("gate", 1); w.paint();
  const g = w.geom();
  w.onclick(g.x1, g.top); w.ondrag(g.x1, g.top, 0);                       // up at the top: level max, no attack drag
  assert.deepEqual(out.splice(0), ["sustain 15"]);
  assert.deepEqual([w.val.attack, w.val.decay, w.val.release], [5, 3, 2]);
  w.gate(0); w.paint();
  w.onclick(g.x0 + 1, g.bottom); w.ondrag(g.x0 + 1, g.bottom, 0);         // without gate: attack drag again
  assert.deepEqual(out.splice(0), ["attack 0"]);
});
