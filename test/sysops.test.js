// node --test: the extended firmware's ops (a firmware with dump-request support) on the JS side – 06/07 frames,
// 46/47 replies (lib/sysex.js), the gateway's store lock (nothing else to the synth until the 47 reply) and the capture/sid.load passing the replies on.
const test = require("node:test");
const assert = require("node:assert/strict");
const { midiParser } = require("../lib/midi");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const S = require("../lib/sysex");
const SidParams = require("../lib/params");

const H = S.SID_HEADER;
const nib = (vals) => vals.flatMap((v) => [v & 15, v >> 4]);
const settingsReply = (v) => H.concat([0x46], nib(v), [0xf7]);
const storeReply = (v) => H.concat([0x47], nib(v), [0xf7]);
// A typical settings reply: version 1, base ch 0, slot 5, loaded 5, Globl, 120 Hz, HCut 3, Patch dump,
// patch speed 100, patch HCut 4, period 2083 ($0823), ExtCl period $0A2B, not locked.
const SETTINGS = [1, 0, 5, 5, 1, 120, 3, 0, 100, 4, 0x08, 0x23, 0x0a, 0x2b, 0];

test("06 and 07 frames: exact shapes only", () => {
  assert.deepEqual(S.encodeSettingsRequest(), H.concat([6, 0xf7]));
  assert.deepEqual(S.encodeStore(), H.concat([7, 0x7f, 0xf7]));
  assert.ok(S.validateSettingsFrame(S.encodeSettingsRequest()).ok && S.validateStoreFrame(S.encodeStore()).ok);
  assert.ok(!S.validateSettingsFrame(H.concat([6, 0, 0xf7])).ok);
  for (const slot of [0, 5, 99, 0x7e]) assert.ok(!S.validateStoreFrame(H.concat([7, slot, 0xf7])).ok, "store only to the current slot");
});

test("46 reply: values, the rate that applies (250000 / period), strict validation", () => {
  const r = S.decodeReply(settingsReply(SETTINGS));
  assert.ok(r.ok);
  assert.deepEqual([r.source, r.globalSpeed, r.patchSpeed, r.slot, r.period, r.lock], [1, 120, 100, 5, 2083, 0]);
  assert.ok(Math.abs(r.rateHz - 120.02) < 0.01);
  const ext = S.decodeReply(settingsReply([1, 0, 5, 5, 2, 120, 3, 0, 100, 4, 0x08, 0x23, 0x0a, 0x2b, 4]));
  assert.ok(Math.abs(ext.rateHz - 250000 / 0x0a2b) < 1e-9, "ExtCl and locked: the measured clock period");
  assert.ok(!S.decodeReply(settingsReply(SETTINGS).slice(0, -3).concat([0xf7])).ok, "wrong length");
  const bad = settingsReply(SETTINGS); bad[9] = 0x10; assert.ok(!S.decodeReply(bad).ok, "not a nibble");
  assert.ok(!S.decodeReply(settingsReply([2].concat(SETTINGS.slice(1)))).ok, "unknown format version");
});

test("47 reply: status, slot, size, checksum, free", () => {
  const r = S.decodeReply(storeReply([0, 14, 0x01, 0x23, 0xbe, 0xef, 0x40, 0x00]));
  assert.deepEqual([r.status, r.statusText, r.slot, r.size, r.sum, r.free], [0, "stored", 14, 0x123, 0xbeef, 0x4000]);
  assert.equal(S.decodeReply(storeReply([1, 14, 0, 0, 0, 0, 0, 0])).statusText, "memory full");
  assert.equal(S.storeSum([0xff, 0xff, 2]), 0x200);
});

function loadGateway() {
  const out = [], status = [], tasks = [], warn = [];
  class Task { constructor(fn) { this.fn = fn; tasks.push(this); } schedule(ms) { this.due = ms; this.cancelled = false; } cancel() { this.cancelled = true; } }
  const g = { midiParser, sidlog, sidguard, ...S, SidParams, Task, File: class {}, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a), messagename: "x",
    outlet: (o, ...a) => { if (o === 0) out.push(a[0]); else if (a[0] === "status") status.push(a[1]); else if (a[0] === "noreply") warn.push(a[1]); else if (a[0] === "answered") warn.push("ok " + a[1]); } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.send.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { cc, settings, store, stored, replied, request, frame, get queue() { return queue; }, get storing() { return storing; } };");
  // Runs the queue Task's ticks (not the store timeout) a number of times.
  const ticks = (n) => { for (let k = 0; k < n; k++) for (const t of tasks) if (t.due !== undefined && t.due < 3000 && !t.cancelled) { t.due = undefined; t.fn(); } };
  const timeout = () => { for (const t of tasks) if (t.due === 3000 && !t.cancelled) { t.due = undefined; t.fn(); } };
  return { w: fn(...Object.values(g)), out, status, warn, ticks, timeout };
}
const frames = (out) => {                                                  // SysEx frames and channel messages (status byte starts one)
  const f = []; let cur = null;
  for (const b of out) {
    if (b === 0xf0) cur = [b];
    else if (cur && cur[0] === 0xf0) { cur.push(b); if (b === 0xf7) { f.push(cur); cur = null; } }
    else if (b >= 0x80) { cur = [b]; f.push(cur); }
    else cur.push(b);
  }
  return f;
};

test("store lock: after 07 nothing goes to the synth until the 47 reply; a second store is refused", () => {
  const { w, out, status, ticks } = loadGateway();
  w.store();
  assert.deepEqual(out, S.encodeStore());
  assert.ok(w.storing, "locked after sending 07");
  w.cc(42, 1); w.request(127); w.store();
  ticks(50);
  assert.deepEqual(out, S.encodeStore(), "held while storing");
  assert.ok(status.some((s) => /REFUSED store: a store is already pending/.test(s)));
  w.stored(0, 5, 300, 1234, 9000);
  assert.ok(!w.storing && status.some((s) => /store reply: stored, slot 5/.test(s)));
  ticks(50);
  assert.deepEqual(frames(out).slice(1), [[0xb0, 42, 1], H.concat([5, 0x7f, 0xf7])], "the held messages follow in order");
});

test("store lock: a missing reply times out as uncertain, then the queue moves on", () => {
  const { w, out, status, ticks, timeout } = loadGateway();
  w.store(); w.cc(1, 2); ticks(10);
  assert.equal(frames(out).length, 1);
  timeout();
  assert.ok(status.some((s) => /NO REPLY .* may or may not have been stored/.test(s)) && !w.storing);
  ticks(10);
  assert.deepEqual(frames(out)[1], [0xb0, 1, 2]);
});

test("no reply: 05 and 06 are timed like the store; an answer in time ends the wait, a missing one warns (log + noreply)", () => {
  const { w, status, warn, ticks, timeout } = loadGateway();
  w.request(127); w.settings(); ticks(5);                              // the timer starts when the request is sent, not queued
  w.replied("dump");                                                   // the dump came, the settings reply did not
  timeout();
  assert.deepEqual(warn.splice(0), ["ok dump", "settings"]);
  assert.ok(status.some((s) => /settings request: NO REPLY within 3000 ms/.test(s)));
  assert.ok(!status.some((s) => /dump request: NO REPLY/.test(s)));
  w.store(); timeout();
  assert.deepEqual(warn.splice(0), ["store"], "the store timeout warns the same way");
  ticks(5); w.request(5); w.request(6); ticks(5); timeout();
  assert.deepEqual(warn.splice(0), ["dump"], "a second request restarts the wait: one warning");
  w.replied("dump"); w.replied("settings");                            // late or stray replies: nothing happens
});

test("settings: 06 passes the gateway; a stray reply without a store does nothing", () => {
  const { w, out } = loadGateway();
  w.settings(); assert.deepEqual(out, S.encodeSettingsRequest());
  w.stored(0, 1, 2, 3, 4); assert.ok(!w.storing);
});

test("the capture passes 46/47 on as settings/stored and does not save them; sid.load sends the rate to the playheads and the LFO views", () => {
  const sent = [], logs = [];
  const g = { midiParser, sidlog: (...a) => logs.push(a.join(" ")), sidguard, ...S, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a),
    outlet: (o, ...a) => sent.push([o].concat(a)), File: class { constructor() { throw new Error("must not save a reply"); } } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.capture.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const cap = new Function(...Object.keys(g), src + "\nreturn { msg_int };")(...Object.values(g));
  for (const b of settingsReply(SETTINGS)) cap.msg_int(b);
  for (const b of storeReply([1, 7, 0, 0x92, 0, 0, 0, 0x10])) cap.msg_int(b);
  assert.deepEqual(sent, [[0, "settings", 120, 1, 5, 120, 100, 0, 0], [0, "replied", "settings"], [0, "stored", 1, 7, 0x92, 0, 0x10]]);

  const out = [];
  const gl = { sidlog() {}, sidguard, SidParams, jsarguments: ["sid.load.js", "1", "2", "3", "f", "l"], inlets: 0, outlets: 0, post() {},
    arrayfromargs: (a) => Array.from(a), outlet: (o, ...a) => out.push(a.join(" ")) };
  const lsrc = fs.readFileSync(path.join(__dirname, "..", "max", "sid.load.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const load = new Function(...Object.keys(gl), lsrc + "\nreturn { settings };")(...Object.values(gl));
  load.settings(120, 1, 5);
  assert.deepEqual(out, ["script send o1_table rate 120", "script send o2_table rate 120", "script send o3_table rate 120",
    "script send l1_view rate 120", "script send l2_view rate 120", "script send l3_view rate 120", "script send l4_view rate 120"]);
  load.settings(5000, 1, 5); assert.equal(out.length, 7, "an implausible rate is ignored");
});

test("capture (built into SidStation, hears all SysEx): a foreign or short frame is logged and ignored – no crash, no file, no output", () => {
  const sent = [], logs = [];
  const g = { midiParser, sidlog: (...a) => logs.push(a.join(" ")), sidguard, ...S, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a),
    outlet: (o, ...a) => sent.push([o].concat(a)), File: class { constructor() { throw new Error("must not save a foreign frame"); } } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.capture.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const cap = new Function(...Object.keys(g), src + "\nreturn { msg_int };")(...Object.values(g));
  for (const b of [0xf0, 0x7d, 0x53, 0x49, 0x44, 0xf7]) cap.msg_int(b);                          // a non-commercial test frame (7D)
  for (const b of [0xf0, 0x47, 0x7f, 0x15, 0x60, 0x00, 0x04, 0x41, 0x09, 0x00, 0x00, 0xf7]) cap.msg_int(b);   // another maker's SysEx
  assert.deepEqual(sent, []);
  assert.equal(logs.filter((l) => /not a SidStation frame/.test(l)).length, 2);
  assert.deepEqual(logs.filter((l) => /ERROR/.test(l)), []);
  for (const b of S.encodeDP(0x1a, 0x7f, 0, 90)) cap.msg_int(b);                                 // our own DP looping back
  assert.deepEqual(sent, [], "not passed on, not saved (File throws)");
  assert.ok(logs.some((l) => /ERROR outgoing-type frame \(id 04\)/.test(l)));
});
