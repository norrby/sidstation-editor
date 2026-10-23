// node --test: max/sid.load.js – synthetic dumps (test/fixtures.js) in, "script send <varname> <value>" out; the routers are silenced first.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const SidParams = require("../lib/params");
const S = require("../lib/sysex");
const F = require("./fixtures");
function loadLoader(args) {
  const out = [];
  const g = { sidlog, sidguard, SidParams, inlets: 0, outlets: 0, jsarguments: ["sid.load.js"].concat(args || []), post() {},
    outlet: (o, ...a) => out.push(a), arrayfromargs: (a) => Array.from(a), messagename: "x" };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.load.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const w = new Function(...Object.keys(g), src + "\nreturn { patch };")(...Object.values(g));
  return { w, out, sent: () => Object.fromEntries(out.filter((m) => m[0] === "script" && m[1] === "send" && m[3] !== "quiet" && m[2] !== "map").map((m) => [m[2], m[3]])), quiet: () => out.filter((m) => m[3] === "quiet").map((m) => m[2]) };
}

test("a dump: the routers are silenced first, then osc 1–3 on, res 11, all through the filter, type L/B, filter LFO 4, gate on osc 1", () => {
  const { w, out, sent, quiet } = loadLoader();
  const r = S.decodeDump(F.fresh());
  w.patch(...r.patch);
  assert.deepEqual(quiet(), ["o1_router", "o2_router", "o3_router", "f_router", "l_router"]);
  assert.deepEqual(out.slice(0, 5).map((m) => m[3]), ["quiet", "quiet", "quiet", "quiet", "quiet"], "quiet before any value");
  const v = sent();
  assert.deepEqual([v.o1_active, v.o2_active, v.o3_active], [1, 1, 1]);                     // PATCH_MODE 27
  assert.equal(v.f_res, 11); assert.deepEqual([v.f_route1, v.f_route2, v.f_route3], [1, 1, 1]);   // FLT_ACTRS B7
  assert.equal(v.f_ftype, 2, "type bits 3 = LP+BP = menu L/B");                             // FLT_TYPLFO 33
  assert.equal(v.f_flfo, 3, "filter LFO 3 (0-based) = LFO 4");
  assert.equal(v.o1_gate, 1); assert.equal(v.o1_pwsync, 0);                                 // osc1 flags 02
  assert.equal(v.f_cutoff, r.patch[0x1a]); assert.equal(v.f_envdepth, r.patch[0x1b]);
  assert.equal(v.f_wrap, (r.patch[0x16] >> 6) & 1); assert.equal(v.f_invert, (r.patch[0x16] >> 7) & 1);
  for (const n of [1, 2, 3]) {
    const b = r.patch.slice([36, 57, 78][n - 1]);
    assert.equal(v["o" + n + "_attack"], b[6] & 0x0f); assert.equal(v["o" + n + "_sustain"], b[8] & 0x0f);
    assert.equal(v["o" + n + "_wave"], [1, 2, 4, 5, 8].indexOf(b[15] >> 4), "wave code -> menu index");
    assert.equal(v["o" + n + "_sync"], (b[15] >> 1) & 1); assert.equal(v["o" + n + "_ring"], (b[15] >> 2) & 1);
    assert.equal(v["o" + n + "_trackmode"], b[1] ? 1 : 0);
    if (b[1]) assert.equal(v["o" + n + "_tracknote"], b[1]);
  }
  assert.ok(!("o1_track" in v), "track goes via trackmode/tracknote");
  assert.deepEqual([v.o1_sync, v.o2_ring, v.o2_wave, v.o3_wave], [1, 1, 2, 0]);               // 22 = Saw+sync, 44 = Pulse+ring, 10 = Tri
  assert.deepEqual([v.o2_trackmode, v.o2_tracknote], [1, 48]);
  assert.equal(v.f_cutoff, 0x5a);
  assert.equal(v.n_char1, "F".charCodeAt(0)); assert.equal(v.n_char10, "1".charCodeAt(0));      // the patch name -> Name 1..10 (ASCII)
});

test("an older dump: transpose two's complement (+12 / −12), detune signed; only requested blocks (arguments)", () => {
  const { w, sent, quiet } = loadLoader(["2", "3"]);
  const r = S.decodeDump(F.older());
  w.patch(...r.patch);
  assert.deepEqual(quiet(), ["o2_router", "o3_router"]);
  const v = sent();
  assert.equal(v.o2_transpose, 12); assert.equal(v.o3_transpose, -12);
  assert.ok(Object.keys(v).every((k) => /^o[23]_/.test(k)), "nothing to osc 1 or the filter");
  assert.equal(r.patch[57 + 4], 0xf6);
  assert.equal(v.o2_detune, -10, "F6 = −10 in two's complement");
});

test("a too short or broken patch gives nothing at all", () => {
  const { w, out } = loadLoader();
  w.patch(1, 2, 3); w.patch(...new Array(120).fill("x"));
  assert.deepEqual(out, []);
});

test("LFO blocks: lfo4 = Ramp with Inv+Sync in one dump, lfo1 = Pulse with source LFO 4 in another", () => {
  const { w, sent } = loadLoader();
  w.patch(...S.decodeDump(F.fresh()).patch);
  let v = sent();
  assert.equal(v.l4_type, 2); assert.equal(v.l4_invert, 1); assert.equal(v.l4_notesync, 1);
  for (const n of [1, 2, 3, 4]) for (const d of SidParams.LFO) assert.ok(("l" + n + "_" + d.key) in v, "l" + n + "_" + d.key);
  const p = S.decodeDump(F.poly()).patch;
  const b = loadLoader(); b.w.patch(...p); v = b.sent();
  assert.equal(v.l1_type, 3); assert.equal(v.l1_source, 11);
  assert.deepEqual([v.l1_speed, v.l3_depth, v.l2_fadein], [0x41, 0x66, 0x17]);
});

test("Patch panel: legato/poly from PATCH_MODE, HCut from 0x23 (a legato dump, a poly dump)", () => {
  let { w, sent } = loadLoader();
  w.patch(...S.decodeDump(F.fresh()).patch);
  assert.deepEqual([sent().c_legato, sent().c_poly, sent().c_hcut], [1, 0, 0]);
  ({ w, sent } = loadLoader());
  w.patch(...S.decodeDump(F.poly()).patch);
  assert.deepEqual([sent().c_legato, sent().c_poly, sent().c_hcut], [0, 1, 5]);
});
