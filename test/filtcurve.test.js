// node --test: max/sid.filtcurve.js in a v8ui mock – frequency response per filter type, resonance peak, sweep bands.
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function loadWidget() {
  const mg = { size: [224, 62], init() {}, redraw() {} };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "move_to", "line_to", "stroke", "close_path", "select_font_face", "set_font_size", "show_text"]) mg[f] = () => {};
  mg.text_measure = (s) => [s.length * 4.5, 8];
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a), messagename: "x" };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.filtcurve.js"), "utf8").replace(/^inlets = 1;\noutlets = 0;\n/m, "");
  return new Function(...Object.keys(g), src + "\nreturn { st, response, bands, set, paint, msg: (n, v) => { messagename = n; anything(v); }, set2: (n, a, b) => { messagename = n; anything(a, b); } };")(...Object.values(g));
}

test("Lowp: flat below cutoff, falls above; High the other way round; L/H has a notch at cutoff", () => {
  const w = loadWidget();
  w.set("cutoff", 64, "res", 0, "type", 0);                       // Lowp, xc = 0.5
  assert.ok(Math.abs(w.response(0.1)) < 0.5, "far below cutoff ≈ 0 dB");
  assert.ok(w.response(0.9) < -30, "far above cutoff strongly attenuated");
  assert.ok(Math.abs(w.response(0.5) - (-3)) < 0.5, "Butterworth: -3 dB at cutoff");
  w.set("type", 3);                                                // High
  assert.ok(w.response(0.1) < -30 && Math.abs(w.response(0.9)) < 0.5);
  w.set("type", 4);                                                // L/H = notch
  assert.ok(w.response(0.5) < -20 && Math.abs(w.response(0.1)) < 0.5 && Math.abs(w.response(0.9)) < 0.5);
  w.set("type", 1);                                                // Band
  assert.ok(w.response(0.5) > w.response(0.3) + 6 && w.response(0.5) > w.response(0.7) + 6);
});

test("resonance gives a peak at cutoff that grows with Res, without changing the level far away", () => {
  const w = loadWidget();
  w.set("cutoff", 64, "type", 0, "res", 0);
  const flat = w.response(0.5), far = w.response(0.1);
  w.set("res", 15);
  assert.ok(w.response(0.5) > flat + 8, "Res 15: clear peak");
  assert.ok(Math.abs(w.response(0.1) - far) < 0.5, "the rest of the curve unaffected");
  w.set("cutoff", 127); assert.ok(w.response(1) > 5, "cutoff moves the peak to the right edge");
});

test("sweep bands: Env depth from cutoff upwards, downwards with Inv, clamped; LFO both ways", () => {
  const w = loadWidget();
  w.set("cutoff", 64, "depth", 0, "lfodepth", 0);
  assert.deepEqual(w.bands(), { env: null, lfo: null, envEnd: null, susEnd: null, lfoEnds: null });
  w.set("depth", 32); let b = w.bands();
  assert.ok(Math.abs(b.env[0] - 64 / 127) < 1e-9 && Math.abs(b.env[1] - 96 / 127) < 1e-9);
  assert.ok(Math.abs(b.envEnd - 96 / 127) < 1e-9, "the ghost curve sits at the sweep's extreme");
  assert.ok(Math.abs(b.susEnd - 96 / 127) < 1e-9, "sustain 127: the sustain curve coincides with the top");
  w.set("sustain", 64); assert.ok(Math.abs(w.bands().susEnd - (64 + 32 * 64 / 127) / 127) < 1e-9, "sustain 64/127 of the way between cutoff and the top");
  w.set("sustain", 127);
  w.set("invert", 1); b = w.bands();
  assert.ok(Math.abs(b.env[0] - 32 / 127) < 1e-9 && Math.abs(b.env[1] - 64 / 127) < 1e-9 && Math.abs(b.envEnd - 32 / 127) < 1e-9);
  w.set("depth", 127); assert.deepEqual(w.bands().env, [0, 64 / 127]); assert.equal(w.bands().envEnd, 0);
  w.set("lfodepth", 127); assert.deepEqual(w.bands().lfo, [0, 1]); assert.deepEqual(w.bands().lfoEnds, [0, 1]);
  assert.ok(Math.abs(w.response(0.75, 0.75) - w.response(64 / 127)) < 1e-9, "the ghost curve = the same shape moved");
  for (const s of [1, 2, 3]) { w.msg("style", s); w.paint(); }
  w.set2("show", "sus", 0); w.set2("show", "cut", 0); w.paint();                 // hidden layers are not drawn (no crash)
  w.msg("res", 99); assert.equal(w.st.res, 15, "without set: clamped to 15");
  w.msg("type", 2); assert.equal(w.st.type, 2);
  w.paint();
});
