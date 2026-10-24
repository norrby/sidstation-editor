// node --test: max/sid.lfo.js – the LFO router: silent before arm and during quiet, CC where there is one, otherwise whitelisted DP.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const SidParams = require("../lib/params");
const { encodeDP, validateDPFrame } = require("../lib/sysex");

function loadLfo() {
  const out = [];
  let now = 0;
  const g = { sidlog, sidguard, SidParams, encodeDP, inlets: 0, outlets: 0, post() {}, outlet: (o, msg, ...a) => { if (msg === "frame") out.push(a); }, arrayfromargs: (a) => Array.from(a), messagename: "x",
    Date: { now: () => now }, Task: class { constructor(fn) { this.fn = fn; } schedule() {} cancel() {} } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.lfo.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const r = new Function(...Object.keys(g), src + "\nreturn { lfo, arm, sendall, quiet };")(...Object.values(g));
  for (let n = 1; n <= 4; n++) for (const d of SidParams.LFO) r.lfo(n, d.key, d.init);   // Live's restore on load: the starting point
  out.length = 0;
  return { r, out, tick: (ms) => (now += ms) };
}
const row = (f) => ((f[7] << 7) | f[8]) + ":" + f[9] + ":" + f[10];

test("nothing before arm; then CC for speed/add depth, DP for type, source, target and options", () => {
  const { r, out } = loadLfo();
  r.lfo(1, "speed", 64);
  assert.deepEqual(out, [], "silent before arm");
  r.arm();
  r.lfo(1, "speed", 64); r.lfo(2, "adddepth", 127);
  assert.deepEqual(out.splice(0), [[0xb0, 88, 64], [0xb0, 102, 127]]);
  r.lfo(2, "dest", 3); r.lfo(4, "type", "Flat"); r.lfo(3, "source", 11); r.lfo(1, "invert", 1);
  const f = out.splice(0);
  for (const m of f) { assert.ok(validateDPFrame(m).ok); assert.ok(SidParams.dpRows().has(row(m)), "whitelisted " + row(m)); }
  assert.deepEqual(f.map((m) => [m[7], m[8], m[9], m[10], m[11]]), [[1, 0x23, 7, 4, 3], [1, 0x5a, 7, 0, 5], [1, 0x3e, 0x0f, 4, 11], [1, 0x07, 1, 1, 1]]);
});

test("quiet stops sending for 1.5 s; out of range is clipped; unknown LFO/parameter gives nothing", () => {
  const { r, out, tick } = loadLfo();
  r.arm(); r.quiet();
  r.lfo(1, "depth", 10);
  assert.deepEqual(out, []);
  tick(1600);
  r.lfo(1, "depth", 10); r.lfo(1, "lacewith", 9);
  assert.deepEqual(out.splice(0).map((m) => m.length === 3 ? m : m[11]), [[0xb0, 89, 10], 4], "lace with is clipped to 4");
  r.lfo(5, "depth", 1); r.lfo(1, "nope", 1);
  assert.deepEqual(out, []);
});

test("sendall sends all known values even after quiet", () => {
  const { r, out } = loadLfo();
  r.lfo(1, "speed", 1); r.lfo(3, "type", 2);
  out.length = 0;
  r.quiet(); r.sendall();
  assert.equal(out.length, 4 * SidParams.LFO.length, "every parameter of all four LFOs");
});
