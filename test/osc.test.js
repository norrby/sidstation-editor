// node --test: max/sid.osc.js in a v8 mock – SysEx filter, CC scaling, osc number.
const test = require("node:test");
const assert = require("node:assert/strict");
const { midiParser } = require("../lib/midi");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const SidParams = require("../lib/params");
const { encodeDP } = require("../lib/sysex");

// frames ("frame <bytes>" on the gateway outlet) are recorded as ["gw", "frame", bytes…]
function loadRouter(oscNo, armed = true) {
  const out = [];
  const g = { midiParser, sidlog, sidguard, SidParams, encodeDP, inlets: 0, outlets: 0, jsarguments: ["sid.osc.js", oscNo], post() {},
    outlet: (o, ...a) => out.push(a[0] === "frame" ? ["gw", ...a] : [o, ...a]), arrayfromargs: (a) => Array.from(a), messagename: "x",
    Task: class { constructor(fn) { this.fn = fn; } schedule() {} cancel() {} } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.osc.js"), "utf8").replace(/^inlets = 1;\noutlets = 3;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { msg_int, param, sendall, arm, msg: (n, ...a) => { const fns = { trackmode, tracknote, sendall, arm, channel, quiet }; if (fns[n]) return fns[n](...a); messagename = n; anything(...a); } };");   // v8 calls named functions before anything
  const r = fn.call({}, ...Object.values(g));
  if (armed) r.arm();
  return { r, out };
}
const bytes = (out) => out.filter((o) => o[0] === 0).map((o) => o[1]);                       // pass-through to midiout
const bus = (out) => out.filter((o) => o[0] === "gw").flatMap((o) => o.slice(2));          // to the gateway

test("notes pass as whole messages, SysEx is dropped entirely, realtime passes", () => {
  const { r, out } = loadRouter(1);
  for (const b of [0x90, 60, 100, 0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0xf8, 0x45, 0xf7, 0x80, 60, 0, 0xb0, 1, 5, 0xc0, 7]) r.msg_int(b);
  assert.deepEqual(bytes(out), [0x90, 60, 100, 0xf8, 0x80, 60, 0, 0xb0, 1, 5, 0xc0, 7]);
});

test("a parameter in the middle of a note never lands between status and data", () => {
  const { r, out } = loadRouter(1);
  r.msg_int(0x90); r.msg_int(60);
  r.msg("transpose", 0);                                     // the panel sends during an ongoing note
  r.msg_int(100);
  assert.deepEqual(bytes(out), [0x90, 60, 100]);             // the note whole on midiout
  assert.deepEqual(bus(out), [0xb0, 36, 64]);                // the CC whole on the bus
  r.msg_int(0x90); r.msg_int(62); r.msg_int(0); r.msg_int(64); r.msg_int(90);   // running status
  assert.deepEqual(bytes(out).slice(3), [0x90, 62, 0, 0x90, 64, 90]);
});

test("parameters become CC on the right number with the right scaling and clamping", () => {
  const { r, out } = loadRouter(1);
  r.msg("transpose", 12);  assert.deepEqual(bus(out.splice(0)), [0xb0, 36, 95]);
  r.msg("transpose", 0);   assert.deepEqual(bus(out.splice(0)), [0xb0, 36, 64]);
  r.msg("attack", 99);     assert.deepEqual(bus(out.splice(0)), [0xb0, 46, 127]);
  r.msg("pwstart", 64);    assert.deepEqual(bus(out.splice(0)), [0xb0, 42, 64]);
  r.msg("sync", 1);        assert.deepEqual(bus(out.splice(0)), [0xb0, 40, 127]);
  r.msg("active", 1);      assert.deepEqual(bus(out.splice(0)), [0xb0, 24, 127]);
  r.msg("nonsense", 1);     assert.deepEqual(out.splice(0), []);
});

test("osc 2 uses 50.. and 70/71, sendall resends everything", () => {
  const { r, out } = loadRouter(2);
  r.msg("sustain", 15);    assert.deepEqual(bus(out.splice(0)), [0xb0, 70, 127]);
  r.msg("release", 4);     assert.deepEqual(bus(out.splice(0)), [0xb0, 71, Math.round(4 * 127 / 15)]);
  r.msg("active", 0);      assert.deepEqual(bus(out.splice(0)), [0xb0, 25, 0]);
  r.sendall();
  const b = bus(out.splice(0));
  assert.equal(b.length, 9);
});

test("parameters without CC go as Direct Program with the right address and code", () => {
  const { r, out } = loadRouter(1);
  r.msg("wave", 0);        assert.deepEqual(bus(out.splice(0)), [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x04, 0x00, 0x56, 0x0f, 0x04, 0x01, 0xf7]);
  r.msg("wave", 4);        assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x56, 0x0f, 0x04, 0x08]);
  r.msg("pwsync", 1);      assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x47, 0x01, 0x00, 0x01]);
  r.msg("gate", 1);        assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x47, 0x01, 0x01, 0x01]);
  r.msg("pbrange", 12);    assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x4c, 0x7f, 0x00, 12]);
  r.msg("viblfo", 3);      assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x58, 0x03, 0x00, 3]);
  const o3 = loadRouter(3);
  o3.r.msg("wave", 2);     assert.deepEqual(bus(o3.out.splice(0)).slice(7, 12), [0x01, 0x00, 0x0f, 0x04, 0x04]);
  // CC as far as possible, DP as fallback: Track 99 fits in CC (0..99), 100 does not
  r.msg("attack", 15);     assert.deepEqual(bus(out.splice(0)), [0xb0, 46, 127]);
  r.msg("track", 99);      assert.deepEqual(bus(out.splice(0)), [0xb0, 35, 127]);
  r.msg("track", 60);      assert.deepEqual(bus(out.splice(0)), [0xb0, 35, 77]);
  r.msg("track", 100);     assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x48, 0x7f, 0x00, 100]);
  assert.deepEqual(bytes(out), []);                          // nothing to midiout
});

test("before the device is loaded (arm) nothing is sent; the values are kept and sendall pushes them out", () => {
  const { r, out } = loadRouter(1, false);
  r.msg("active", 0); r.msg("transpose", 12); r.msg("wave", 0);
  assert.deepEqual(bus(out), []); assert.deepEqual(bytes(out), []);   // the load's output does not reach the synth (ringok on outlet 1 is ok)
  r.arm();
  r.msg("transpose", 5);
  assert.deepEqual(bus(out.splice(0)), [0xb0, 36, Math.round(29 * 127 / 48)]);
  r.sendall();
  const b = bus(out.splice(0));
  assert.equal(b.filter((x) => x === 0xb0).length, 2);      // active + transpose via CC
  assert.equal(b.filter((x) => x === 0xf0).length, 1);      // wave via DP
});

test("Track in the panel: radio button Key follow | Note + note -> one synth value; 100 goes via DP", () => {
  const { r, out } = loadRouter(1);
  r.msg("tracknote", 60);  assert.deepEqual(out, []);                     // Key follow selected: the note waits
  r.msg("trackmode", 1);   assert.deepEqual(bus(out.splice(0)), [0xb0, 35, 77]);
  r.msg("tracknote", 99);  assert.deepEqual(bus(out.splice(0)), [0xb0, 35, 127]);
  r.msg("tracknote", 100); assert.deepEqual(bus(out.splice(0)).slice(7, 12), [0x00, 0x48, 0x7f, 0x00, 100]);
  r.msg("trackmode", 0);   assert.deepEqual(bus(out.splice(0)), [0xb0, 35, 0]);
});

test("wave gives ringok on outlet 1: 1 for Tri and Mixed, 0 for others, even unarmed", () => {
  const { r, out } = loadRouter(1, false);
  const ringok = () => out.filter((o) => o[0] === 1 && o[1] === "ringok").map((o) => o[2]);
  r.msg("wave", 0); r.msg("wave", 2); r.msg("wave", 3); r.msg("wave", 4);
  assert.deepEqual(ringok(), [1, 0, 1, 0]);
  assert.deepEqual(bus(out), []);                                   // unarmed: nothing to the synth
});

test("quiet (patch dump on its way in): nothing to the bus during the window, the value is kept, sendall opens again", () => {
  const { r, out } = loadRouter(1);
  r.msg("quiet");
  r.msg("transpose", 5); r.msg("wave", 4);
  assert.deepEqual(bus(out), [], "the dump's values are not echoed to the synth");
  r.msg("quiet", -1);                                          // the window has expired
  r.msg("transpose", 6); assert.deepEqual(bus(out), [0xb0, 36, Math.round((6 + 24) * 127 / 48)]);
  out.length = 0; r.msg("quiet"); r.msg("sendall");
  assert.ok(bus(out).length > 0, "Push patch breaks the silence and sends everything");
});
