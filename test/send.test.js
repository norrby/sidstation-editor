// node --test: max/sid.send.js (the gateway) in a v8 mock – queue, validation, whitelist.
const test = require("node:test");
const assert = require("node:assert/strict");
const { midiParser } = require("../lib/midi");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const S = require("../lib/sysex");
const SidParams = require("../lib/params");

function loadGateway() {
  const out = [], status = [], sched = [], logs = [], ev = [];
  class Task { constructor(fn) { this.fn = fn; } schedule(ms) { sched.push([this, ms]); } cancel() { this.cancelled = true; } }
  const g = { midiParser, sidlog: (tag, ...a) => { logs.push(a.join(" ")); sidlog(tag, ...a); }, sidguard, ...S, SidParams, Task, File: class {}, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a), messagename: "x",
    outlet: (o, ...a) => { if (o === 0) out.push(a[0]); else { ev.push(a); if (a[0] === "status") status.push(a[1]); } } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.send.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { frame, msg_int, stored, pushed, arm, get queue() { return queue; } };");
  const run = () => { while (sched.length) { const [t] = sched.shift(); if (!t.cancelled) t.fn(); } };   // drain all ticks
  const w = fn(...Object.values(g));
  w.store = () => w.frame(...S.encodeStore());                             // what the filter router sends for Store patch
  return { w, out, status, sched, run, logs, ev };
}

test("gateway: what the track sends is counted per type and logged once a second", () => {
  const { w, run, logs } = loadGateway();
  for (const b of [0x90, 60, 100, 0xd0, 5, 0xd0, 6, 0xd0, 7, 0xf8, 0x80, 60, 0]) w.msg_int(b);
  assert.deepEqual(logs.filter((l) => l.startsWith("track input")), [], "nothing until the second is up");
  run();
  assert.deepEqual(logs.filter((l) => l.startsWith("track input")), ["track input, last second: 1 note on, 3 channel pressure, 1 clock, 1 note off"]);
  for (const b of [0x90, 62, 100]) w.msg_int(b); run();
  assert.equal(logs.filter((l) => l.startsWith("track input")).pop(), "track input, last second: 1 note on", "counts start over");
});
const DP_TRI = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x04, 0x00, 0x56, 0x0f, 0x04, 0x01, 0xf7];
const dp = (ph, pl, mask, shift, v) => [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x04, ph, pl, mask, shift, v, 0xf7];

test("everything goes through one queue: one whole message per tick, in arrival order, with a pause", () => {
  const { w, out, sched, run } = loadGateway();
  w.frame(0xb0, 42, 10);
  assert.deepEqual(out, [0xb0, 42, 10]);                    // the first goes out at once
  w.frame(...DP_TRI); w.frame(0x90, 60, 100);              // arrive while the queue waits
  assert.deepEqual(out, [0xb0, 42, 10]); assert.equal(w.queue.length, 2);
  assert.equal(sched[0][1], 1);
  run();
  assert.deepEqual(out, [0xb0, 42, 10, ...DP_TRI, 0x90, 60, 100]);
});

test("refuses: DP outside the whitelist, wrong form, foreign SysEx, broken channel message", () => {
  const { w, out, status, run } = loadGateway();
  w.frame(...dp(0, 86, 15, 0, 1)); run();                  // right address, wrong shift
  w.frame(...dp(0, 86, 15, 4, 16)); run();                 // value > mask
  w.frame(0xf0, 0x00, 0x45, 0x01, 0x69, 0x7f, 0xf7); run(); // OS-upgrade-header
  w.frame(0xb0, 42); run();                                // too short
  w.frame(0x90, 60, 200); run();                           // data > 7F
  assert.deepEqual(out, []);
  assert.equal(status.filter((s) => s.startsWith("REFUSED")).length, 5);
  w.frame(...dp(0, 86, 15, 4, 1)); run();
  assert.deepEqual(out, DP_TRI);
});

test("the note path (one track): channel messages go out at once, outside the queue; SysEx never passes", () => {
  const { w, out, sched } = loadGateway();
  for (const b of [0x90, 60, 100, 61, 90]) w.msg_int(b);                 // with running status
  assert.deepEqual(out.splice(0), [0x90, 60, 100, 0x90, 61, 90]);
  assert.equal(w.queue.length, 0, "not queued");
  for (const b of [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0xf7]) w.msg_int(b);   // a "memory clear" frame
  assert.deepEqual(out, [], "SysEx on the note path is dropped");
  for (const b of [0xb0, 7]) w.msg_int(b);
  w.msg_int(0xf8);                                                         // realtime in the middle passes
  w.msg_int(100);
  assert.deepEqual(out.splice(0), [0xf8, 0xb0, 7, 100]);
});

test("the track's notes are held while the synth stores and go out in order after the reply (or the timeout)", () => {
  const { w, out, sched, run } = loadGateway();
  const STORE = S.encodeStore();
  w.pushed(); w.store();
  assert.deepEqual(out.splice(0), STORE, "the store goes out");
  for (const b of [0x90, 60, 100, 0xf8, 0xfa, 0x80, 60, 0]) w.msg_int(b); // note on, clock, start, note off during the store
  assert.deepEqual(out, [], "nothing to the synth while it stores");
  w.stored(0, 5, 146, 1234, 4000);
  assert.deepEqual(out.splice(0), [0x90, 60, 100, 0xfa, 0x80, 60, 0], "held, in order, note-off included; the clock dropped");
  w.msg_int(0x90); w.msg_int(62); w.msg_int(100);
  assert.deepEqual(out.splice(0), [0x90, 62, 100], "after the store: at once again");
  w.pushed(); w.store(); out.length = 0;
  w.msg_int(0x90); w.msg_int(64); w.msg_int(100);
  const lock = sched.find(([t, ms]) => ms === 3000)[0];
  lock.fn();                                                               // no reply: the timeout also lets them out
  assert.deepEqual(out.splice(0), [0x90, 64, 100]);
  run();
});

test("Store patch needs Push patch first: refused until pushed, allowed after, greyed again by the next change", () => {
  const { w, out, status, ev, run } = loadGateway();
  const storable = () => ev.filter((e) => e[0] === "storable").map((e) => e[1]);
  w.arm();
  assert.deepEqual(storable(), [0], "on load: grey");
  w.store();
  assert.deepEqual(out, []); assert.match(status.pop(), /^REFUSED bus: Store patch needs Push patch first/);
  w.frame(...DP_TRI); out.length = 0;                       // Push patch: the routers' frames …
  w.pushed();                                               // … then the marker
  assert.deepEqual(storable(), [0, 1]);
  w.store(); run(); assert.deepEqual(out.splice(0), S.encodeStore(), "allowed");
  w.stored(0, 5, 146, 1234, 4000);
  w.frame(...S.encodeSettingsRequest()); run(); out.length = 0;
  assert.deepEqual(storable(), [0, 1], "a settings request changes nothing");
  w.store(); run(); assert.deepEqual(out.splice(0), S.encodeStore(), "a second store (another patch number) is fine");
  w.stored(0, 6, 146, 1234, 4000); run();
  w.msg_int(0x90); w.msg_int(60); w.msg_int(100); out.length = 0;
  assert.deepEqual(storable(), [0, 1], "the track's notes change nothing");
  w.frame(...DP_TRI); run(); out.length = 0;                 // an edit
  assert.deepEqual(storable(), [0, 1, 0]);
  w.frame(...S.encodeStore()); run();
  assert.deepEqual(out, []); assert.match(status.pop(), /^REFUSED bus: Store patch needs Push patch first/);
  w.pushed(); w.frame(...S.encodeRequest(0x7f)); run(); out.length = 0;   // Pull replaces the editor
  assert.deepEqual(storable(), [0, 1, 0, 1, 0]);
});

test("the frame that clears every patch (id 01) is refused, however it arrives", () => {
  const { w, out, status } = loadGateway();
  const CLEAR = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0x45].concat(Array(14).fill(0x2d), [0xf7]);
  assert.ok(S.validateFrame(CLEAR).ok, "a well-formed 01 frame (validateFrame still recognises it, for checking bank files)");
  w.frame(...CLEAR);
  assert.deepEqual(out, []); assert.match(status.pop(), /^REFUSED bus: 01 clears every patch/);
});

test("Store goes grey on a patch CC or program change from the track; playing controls leave it", () => {
  const { w, ev } = loadGateway();
  const storable = () => ev.filter((e) => e[0] === "storable").map((e) => e[1]);
  w.pushed();
  for (const b of [0xb0, 1, 90, 0xb0, 64, 127, 0xb0, 20, 5, 0xe0, 0, 64, 0xd0, 30]) w.msg_int(b);   // wheel, sustain, LFO ctrl, bend, pressure
  assert.deepEqual(storable(), [1], "playing controls change nothing");
  w.msg_int(0xb0); w.msg_int(27); w.msg_int(40);                       // a patch CC (filter cutoff)
  assert.deepEqual(storable(), [1, 0]);
  w.pushed(); w.msg_int(0xc0); w.msg_int(5);                           // a program change
  assert.deepEqual(storable(), [1, 0, 1, 0]);
});
