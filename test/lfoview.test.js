// node --test: max/sid.lfoview.js – the shape: type, Inv, > 0, Depth, Fade In, S/H.
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function load() {
  const mg = { size: [192, 44], init() {}, redraw() {} };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "move_to", "line_to", "stroke", "set_font_size", "show_text"]) mg[f] = () => {};
  mg.text_measure = () => [30, 8];
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, outlet() {}, arrayfromargs: (a) => Array.from(a), messagename: "x" };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.lfoview.js"), "utf8").replace(/^inlets = 1;\noutlets = 0;\n/m, "");
  return new Function(...Object.keys(g), src + "\nreturn { set, shape, paint, st, rateText, cycle, windowTicks, rulerStep };")(...Object.values(g));
}

test("Depth scales, Inv mirrors, > 0 lifts to 0..1, Flat is constant", () => {
  const w = load();
  w.set("depth", 127); w.set("type", 3); w.set("speed", 127);          // Pulse, 0.75 periods: first half +1
  assert.equal(w.shape(0.1), 1);
  w.set("invert", 1); assert.equal(w.shape(0.1), -1);
  w.set("abovezero", 1); assert.equal(w.shape(0.1), -1, "> 0 before Inv (OS $8FD8/$8FE8): 0..−1");
  w.set("invert", 0); assert.equal(w.shape(0.1), 1);
  w.set("type", 0); assert.equal(w.shape(0), 0, "Tri from the bottom with > 0: shifted to 0, not rectified to 1");
  w.set("type", 3);
  w.set("depth", 0); assert.equal(w.shape(0.1), 0); assert.equal(w.shape(0.1, true), 1, "the ghost curve ignores Depth");
  w.set("abovezero", 0); w.set("depth", 64); w.set("type", 5);
  assert.ok([0, 0.3, 0.9].every((t) => Math.abs(w.shape(t) - 64 / 127) < 1e-9));
  w.paint();
});

test("Fade In starts at zero; S/H holds the value; Saw rises, Ramp rises once with sync", () => {
  const w = load();
  w.set("depth", 127); w.set("type", 1); w.set("speed", 0);
  assert.ok(w.shape(0.05) > w.shape(0.01), "Saw rises");
  w.set("type", 2); w.set("notesync", 0); w.set("offsync", 0);
  assert.ok(w.shape(0.05) > w.shape(0.01), "Ramp without sync = Saw");
  w.set("notesync", 1); assert.equal(w.shape(0.9), 1, "Ramp with sync: rises once and stays at the top");
  w.set("fadein", 0); w.set("samphold", 127);
  assert.equal(w.shape(0.02), w.shape(0.2), "same step");
});

test("the rate per the OS (100 Hz update): Tri, Saw, Pulse, Rand", () => {
  const w = load();
  w.set("type", 0); w.set("speed", 127); assert.equal(w.cycle(), 32768 / 4);       // slowest: inc 4
  w.set("speed", 0); assert.equal(w.cycle(), 32768 / (260 + 36 * 95));            // fastest: inc 3680 → ≈ 11 Hz
  assert.equal(w.rateText(), "11 Hz");
  w.set("speed", 127); assert.equal(w.rateText(), "82 s/cycle", "below 0.1 Hz the period is shown");
  w.set("type", 1); w.set("speed", 95); assert.equal(w.cycle(), 16384 / 260);
  w.set("type", 3); w.set("speed", 49); assert.equal(w.cycle(), 100); assert.equal(w.rateText(), "1.0 Hz");
  w.set("type", 4); w.set("speed", 9); assert.equal(w.rateText(), "10 steps/s");
  w.set("type", 2); w.set("notesync", 1); w.set("speed", 127); assert.match(w.rateText(), /^rise /);
  w.set("type", 5); assert.equal(w.rateText(), "");
});

test("Fade In per the OS: 16·Fade ticks, independent of Speed; brief full swing first; the window holds the whole fade", () => {
  const w = load();
  w.set("depth", 127); w.set("type", 5); w.set("fadein", 64);              // Flat: only the shape of the fade shows
  assert.equal(w.windowTicks(), 16 * 64 * 1.25);
  assert.equal(w.shape(0), 1, "Fade > 16: quotient 0 for the first ticks → unscaled (OS quirk)");
  assert.ok(Math.abs(w.shape(0.4) - 0.4 / 0.8) < 0.02, "linear towards full level at 80 % of the window");
  assert.equal(w.shape(0.9), 1);
  w.set("speed", 0); assert.equal(w.windowTicks(), 16 * 64 * 1.25, "Speed does not change the fade time");
  w.paint();
});

test("the ruler: steps of 1/2/5 × 10^n with 3–6 ticks across the window", () => {
  const w = load();
  for (const [total, step] of [[0.18, 0.05], [1, 0.2], [2.5, 0.5], [7, 2], [82, 20], [164, 50]]) assert.equal(+w.rulerStep(total).toPrecision(3), step, total + " s");
  for (let s = 0; s <= 127; s += 7) { w.set("speed", s); const t = w.windowTicks() / 100, n = Math.floor(t / w.rulerStep(t) + 1e-9) + 1; assert.ok(n >= 3 && n <= 7, s + ": " + n + " ticks"); }
  w.paint();
});
