// node --test: lib/params.js – CC numbers and scaling.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const P = require("../lib/params");

const def = (k) => P.OSC.find((d) => d.key === k);

test("CC numbers per osc follow the manual, osc2 skips 64–69", () => {
  assert.equal(P.oscCC(1, def("arp")), 34);
  assert.equal(P.oscCC(1, def("release")), 49);
  assert.equal(P.oscCC(2, def("arp")), 50);
  assert.equal(P.oscCC(2, def("decay")), 63);
  assert.equal(P.oscCC(2, def("sustain")), 70);
  assert.equal(P.oscCC(2, def("release")), 71);
  assert.equal(P.oscCC(3, def("arp")), 72);
  assert.equal(P.oscCC(3, def("release")), 87);
  assert.equal(P.oscCC(1, def("pwstart")), 42);
  assert.equal(P.oscCC(2, def("active")), 25);
});

test("CC scaling round-trips for every value in each range", () => {
  for (const d of P.OSC) {
    const hi = d.ccMax !== undefined ? d.ccMax : d.max;
    for (let v = d.min; v <= hi; v++) {
      const cc = P.toCC(v, d.min, hi);
      assert.ok(cc >= 0 && cc <= 127, d.key + " cc " + cc);
      assert.equal(P.fromCC(cc, d.min, hi), v, d.key + " v " + v);
    }
  }
  // known points from the hardware test
  assert.equal(P.fromCC(127, 0, 15), 15); assert.equal(P.fromCC(12, 0, 15), 1); assert.equal(P.fromCC(4, 0, 15), 0);
  assert.equal(P.fromCC(64, -24, 24), 0); assert.equal(P.fromCC(65, -24, 24), 1); assert.equal(P.fromCC(127, -64, 63), 63);
  assert.equal(P.toCC(64, 0, 127), 64);
});

test("envelope labels: 16 of them, ms below one second, s above", () => {
  assert.equal(def("attack").labels.length, 16);
  assert.equal(def("attack").labels[0], "2 ms");
  assert.equal(def("attack").labels[12], "1 s");
  assert.equal(def("release").labels[15], "24 s");
});

test("Direct Program rows: address = base + dumpOff, osc3 goes beyond 7 bits, active at 00 16", () => {
  assert.deepEqual(P.oscDP(1, def("wave")), { addr: 0x56, mask: 0x0f, shift: 4 });
  assert.deepEqual(P.oscDP(2, def("wave")), { addr: 0x6b, mask: 0x0f, shift: 4 });
  assert.deepEqual(P.oscDP(3, def("wave")), { addr: 0x80, mask: 0x0f, shift: 4 });
  assert.deepEqual(P.oscDP(2, def("pwsync")), { addr: 0x5c, mask: 0x01, shift: 0 });
  assert.deepEqual(P.oscDP(1, def("attack")), { addr: 0x4d, mask: 0x0f, shift: 0 });
  assert.deepEqual(P.oscDP(1, def("pwstart")), { addr: 0x52, mask: 0x7f, shift: 0 });
  assert.deepEqual(P.oscDP(2, def("active")), { addr: 0x16, mask: 0x01, shift: 1 });
  assert.equal(P.oscDP(1, def("sync")), null);
  assert.ok(P.dpRows().has("86:15:4") && !P.dpRows().has("86:15:0"));
  assert.deepEqual(def("wave").codes, [1, 2, 4, 5, 8]);
});

test("Track: synth value 0..100, CC reaches 99 (ccMax), UI = Key follow + note", () => {
  const t = def("track");
  assert.equal(t.max, 100); assert.equal(t.ccMax, 99); assert.equal(t.ui, "track");
  assert.equal(P.toCC(99, 0, 99), 127);
  assert.equal(P.noteName(60), "C3");
});

test("the last osc parameters without CC have DP rows per the manual", () => {
  assert.deepEqual(P.oscDP(1, def("gate")), { addr: 0x47, mask: 0x01, shift: 1 });
  assert.deepEqual(P.oscDP(1, def("pbrange")), { addr: 0x4c, mask: 0x7f, shift: 0 });
  assert.deepEqual(P.oscDP(1, def("pwlfo")), { addr: 0x54, mask: 0x03, shift: 0 });
  assert.deepEqual(P.oscDP(1, def("viblfo")), { addr: 0x58, mask: 0x03, shift: 0 });
  assert.deepEqual(P.oscDP(3, def("viblfo")), { addr: 0x82, mask: 0x03, shift: 0 });
});

test("LFO 1–4: the DP rows are exactly the manual's 64 LFO rows, CC 88–95 + 102–117, type codes per the OS menu", () => {
  // The LFO rows of the SysEx implementation chart (address hi, lo, mask, shift), LFO 1–4.
  const MANUAL_LFO_ROWS = [
    "01 06 07 00, 01 06 0f 04, 01 07 01 00, 01 07 01 01, 01 07 01 02, 01 07 01 03, 01 07 07 04, 01 08 7f 00",
    "01 09 7f 00, 01 0a 7f 00, 01 0b 03 00, 01 0c 7f 00, 01 0d 07 00, 01 0e 7f 00, 01 0f 7f 00, 01 10 7f 00",
    "01 22 07 00, 01 22 0f 04, 01 23 01 00, 01 23 01 01, 01 23 01 02, 01 23 01 03, 01 23 07 04, 01 24 7f 00",
    "01 25 7f 00, 01 26 7f 00, 01 27 03 00, 01 28 7f 00, 01 29 07 00, 01 2a 7f 00, 01 2b 7f 00, 01 2c 7f 00",
    "01 3e 07 00, 01 3e 0f 04, 01 3f 01 00, 01 3f 01 01, 01 3f 01 02, 01 3f 01 03, 01 3f 07 04, 01 40 7f 00",
    "01 41 7f 00, 01 42 7f 00, 01 43 03 00, 01 44 7f 00, 01 45 07 00, 01 46 7f 00, 01 47 7f 00, 01 48 7f 00",
    "01 5a 07 00, 01 5a 0f 04, 01 5b 01 00, 01 5b 01 01, 01 5b 01 02, 01 5b 01 03, 01 5b 07 04, 01 5c 7f 00",
    "01 5d 7f 00, 01 5e 7f 00, 01 5f 03 00, 01 60 7f 00, 01 61 07 00, 01 62 7f 00, 01 63 7f 00, 01 64 7f 00",
  ].join(", ").split(", ");
  const man = new Set(MANUAL_LFO_ROWS.map((r) => r.split(" ").map((h) => parseInt(h, 16))).map(([hi, lo, mask, shift]) => ((hi << 7) | lo) + ":" + mask + ":" + shift));
  const ours = new Set();
  for (let n = 1; n <= 4; n++) for (const d of P.LFO) { const r = P.lfoDP(n, d); ours.add(r.addr + ":" + r.mask + ":" + r.shift); }
  assert.equal(man.size, 64); assert.deepEqual([...ours].sort(), [...man].sort());
  for (const r of ours) assert.ok(P.dpRows().has(r), "whitelisted " + r);
  const ccs = [];
  for (let n = 1; n <= 4; n++) for (const d of P.LFO) { const c = P.lfoCC(n, d); if (c !== null) ccs.push(c); }
  assert.deepEqual(ccs.sort((a, b) => a - b), [88, 89, 90, 91, 92, 93, 94, 95].concat(Array.from({ length: 16 }, (_, i) => 102 + i)));
  assert.equal(P.lfoCC(2, P.LFO.find((d) => d.key === "adddepth")), 102);
  assert.deepEqual(P.LFO.find((d) => d.key === "type").labels, ["Tri", "Saw", "Ramp", "Pulse", "Rand", "Flat"]);
  for (const d of P.LFO) assert.ok(d.max <= d.dp[0], d.key + ": max fits in the mask");
});
