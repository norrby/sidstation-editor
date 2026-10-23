// node --test: waveform tables end to end in mocks – the osc router sends changed rows as DP (four messages per row,
// manual p. 43), the DP rows are whitelisted, sid.load.js fills the table widgets from a dump, and the layout with a
// table panel expanded has no overlaps.
const test = require("node:test");
const assert = require("node:assert/strict");
const { midiParser } = require("../lib/midi");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const SidParams = require("../lib/params");
const { encodeDP } = require("../lib/sysex");
const L = require("../lib/layout");

// frames ("frame <bytes>" on the gateway outlet) are recorded as ["gw", "frame", bytes…]
function loadRouter(oscNo) {
  const out = [];
  const g = { midiParser, sidlog: () => {}, sidguard, SidParams, encodeDP, jsarguments: ["sid.osc.js", oscNo], post() {},
    outlet: (o, ...a) => out.push(a[0] === "frame" ? ["gw", ...a] : [o, ...a]), arrayfromargs: (a) => Array.from(a), messagename: "x",
    Task: class { schedule() {} cancel() {} } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.osc.js"), "utf8").replace(/^inlets = 1;\noutlets = 3;\n/m, "");
  const r = new Function(...Object.keys(g), src + "\nreturn { table, sendall, arm, quiet };")(...Object.values(g));
  return { r, out };
}
// DP frames on the bus as [addr, mask, shift, value]
const dps = (out) => out.filter((o) => o[0] === "gw").map((o) => o.slice(2)).filter((f) => f[6] === 4).map((f) => [(f[7] << 7) | f[8], f[9], f[10], f[11]]);

test("the router: a table before arming is only the baseline; a changed row goes as four DP messages, End as FF FF", () => {
  const { r, out } = loadRouter(1);
  r.table(0x10, 0x30, 0xff);                                    // device load: baseline, nothing sent
  r.arm();
  assert.deepEqual(dps(out), []);
  r.table(0x80, 0x2d, 0xff);                                    // row 0: Noise, fixed 2d (the manual's example)
  assert.deepEqual(dps(out), [[246, 15, 4, 8], [246, 15, 0, 0], [247, 15, 4, 2], [247, 15, 0, 13]]);
  out.length = 0;
  r.table(0x80, 0x2d, 0x24, 0xc3, 0xff);                        // a second row (Saw + ring, +3) and End moves to row 2
  assert.deepEqual(dps(out), [[248, 15, 4, 2], [248, 15, 0, 4], [249, 15, 4, 12], [249, 15, 0, 3],
    [250, 15, 4, 15], [250, 15, 0, 15], [251, 15, 4, 15], [251, 15, 0, 15]]);
  for (const [a, m, sh] of dps(out)) assert.ok(SidParams.dpRows().has(a + ":" + m + ":" + sh), "whitelisted " + a);
});

test("the router: osc 3 uses table 3 (03 7a), sendall sends the whole table, quiet makes a table the baseline", () => {
  const { r, out } = loadRouter(3);
  r.arm(); r.table(0x10, 0x30, 0xfe, 0x00);
  out.length = 0;
  r.quiet(); r.table(0x20, 0x30, 0xfe, 0x00);                   // a dump arriving: nothing sent
  assert.deepEqual(dps(out), []);
  r.sendall();
  assert.deepEqual(dps(out).map((d) => d[0]), [506, 506, 507, 507, 508, 508, 509, 509]);
  assert.equal(dps(out)[4][3], 0xf);                            // FE
});

test("sid.load.js sends every table to o<n>_table, an unterminated one as all 65 steps", () => {
  const out = [];
  const g = { midiParser, sidlog: () => {}, sidguard, SidParams, jsarguments: ["sid.load.js"], post() {}, outlet: (o, ...a) => out.push([].concat(...a)), arrayfromargs: (a) => Array.from(a) };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.load.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const w = new Function(...Object.keys(g), src + "\nreturn { patch };")(...Object.values(g));
  const p = Array(143).fill(0).concat([0x10, 0x21, 0x10, 0x20, 0xff, 0x40, 0xe1, 0xfe, 0x00]).concat(Array(130).fill(0));
  w.patch(...p);
  const tables = out.filter((m) => m[2] && String(m[2]).endsWith("_table"));
  assert.deepEqual(tables.slice(0, 2), [["script", "send", "o1_table", "bytes", 0x10, 0x21, 0x10, 0x20, 0xff], ["script", "send", "o2_table", "bytes", 0x40, 0xe1, 0xfe, 0x00]]);
  assert.equal(tables.length, 3);
  assert.deepEqual(tables[2].slice(0, 3), ["script", "send", "o3_table"]);
  assert.equal(tables[2].length - 4, 130, "table 3 has no End: 65 steps of two bytes");
});

test("SidStation layout: every table panel expanded fits, nothing overlaps", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "dist", "sid.layout.js"), "utf8");
  const layout = JSON.parse(src.match(/const LAYOUTS = (.*);\n/)[1]).SidStation;
  const st = L.initialState(layout);
  const hidden = L.compute(layout, st).ops.filter((o) => /_table$/.test(o.name));
  assert.ok(hidden.length === 3 && hidden.every((o) => o.rect === null), "collapsed by default");
  for (const id of ["o1", "o2", "o3"]) st[id].table = 1;
  const ops = L.compute(layout, st).ops.filter((o) => o.rect && !/frame/.test(o.name));
  for (const o of ops) assert.ok(o.rect[1] >= 0 && o.rect[1] + o.rect[3] <= 169, "height " + o.name);
  for (const a of ops) for (const b of ops) {
    if (a.name >= b.name || a.name + " × " + b.name === "map × name") continue;
    const r = a.rect, q = b.rect;
    const dx = Math.min(r[0] + r[2], q[0] + q[2]) - Math.max(r[0], q[0]), dy = Math.min(r[1] + r[3], q[1] + q[3]) - Math.max(r[1], q[1]);
    assert.ok(!(dx > 5 && dy > 5), a.name + " × " + b.name);
  }
});

test("the router refuses a Loop to itself or forward (FE FF read past the table, a self-loop hangs the synth)", () => {
  const { r, out } = loadRouter(1);
  r.table(0x10, 0xc0, 0xff); r.arm(); out.length = 0;
  r.table(0x10, 0xc0, 0x10, 0xc0, 0xfe, 0xff);                  // Loop at step 2 to step 255
  r.table(0x10, 0xc0, 0x10, 0xc0, 0xfe, 0x02);                  // Loop at step 2 to itself
  assert.deepEqual(dps(out), [], "nothing sent");
  r.sendall(); assert.ok(!dps(out).some(([a, m, sh, v]) => a === 251 && v === 15), "sendall keeps the last valid table");
  out.length = 0;
  r.table(0x10, 0xc0, 0x10, 0xc0, 0xfe, 0x01);                  // Loop at step 2 to step 1: fine
  assert.ok(dps(out).length > 0);
});
