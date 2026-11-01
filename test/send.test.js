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
  const g = { midiParser, sidlog: (tag, ...a) => { logs.push(a.join(" ")); sidlog(tag, ...a); }, sidguard, ...S, SidParams, SID_DEV: true, Task, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a), messagename: "x",
    outlet: (o, ...a) => { if (o === 0) out.push(a[0]); else { ev.push(a); if (a[0] === "status") status.push(a[1]); } } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.send.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { frame, msg_int, stored, replied, get queue() { return queue; } };");
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

test("channel messages and DP go out at once, whole and in arrival order; a patch frame's pause holds what comes after it", () => {
  const { w, out, sched, run } = loadGateway();
  w.frame(0xb0, 42, 10); w.frame(...DP_TRI); w.frame(0x90, 60, 100);
  assert.deepEqual(out.splice(0), [0xb0, 42, 10, ...DP_TRI, 0x90, 60, 100], "no tick, no pause");
  assert.equal(w.queue.length, 0);
  run();
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
  w.store();
  assert.deepEqual(out.splice(0), STORE, "the store goes out");
  for (const b of [0x90, 60, 100, 0xf8, 0xfa, 0x80, 60, 0]) w.msg_int(b); // note on, clock, start, note off during the store
  assert.deepEqual(out, [], "nothing to the synth while it stores");
  w.stored(0, 5, 146, 1234, 4000);
  assert.deepEqual(out.splice(0), [0x90, 60, 100, 0xfa, 0x80, 60, 0], "held, in order, note-off included; the clock dropped");
  w.msg_int(0x90); w.msg_int(62); w.msg_int(100);
  assert.deepEqual(out.splice(0), [0x90, 62, 100], "after the store: at once again");
  w.store(); out.length = 0;
  w.msg_int(0x90); w.msg_int(64); w.msg_int(100);
  const lock = sched.find(([t, ms]) => ms === 3000)[0];
  lock.fn();                                                               // no reply: the timeout also lets them out
  assert.deepEqual(out.splice(0), [0x90, 64, 100]);
  run();
});

test("the frame that clears every patch (id 01) is refused, however it arrives", () => {
  const { w, out, status } = loadGateway();
  const CLEAR = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0x45].concat(Array(14).fill(0x2d), [0xf7]);
  assert.ok(S.validateFrame(CLEAR).ok, "a well-formed 01 frame (validateFrame still recognises it, for checking bank files)");
  w.frame(...CLEAR);
  assert.deepEqual(out, []); assert.match(status.pop(), /^REFUSED bus: 01 clears every patch/);
});


test("the last check before sending refuses 01 and DP rows outside the whitelist, even in the queue", () => {
  const { w, out, status } = loadGateway();
  const CLEAR = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0x45].concat(Array(14).fill(0x2d), [0xf7]);
  w.queue.push(CLEAR); w.frame(0xb0, 42, 10);              // as if something put it in the queue without accept()
  assert.deepEqual(out, [], "the queue is dropped, the CC after it too"); assert.ok(status.some((x) => /^STOP: frame failed validation while sending \(01 clears/.test(x)));
  w.queue.push(dp(0, 85, 15, 4, 1)); w.frame(0xb0, 42, 11);   // a well-formed DP frame for a row not in the whitelist
  assert.deepEqual(out, []); assert.ok(status.some((x) => /^STOP: .*not in whitelist/.test(x)));
});

// One tick of the queue's Task: the next scheduled call that is not a timeout or a log timer (those are 1000 ms and up).
const tick = (sched) => { const i = sched.findIndex(([t, ms]) => !t.cancelled && ms < 1000); const [t] = sched.splice(i, 1)[0]; t.fn(); };
const cc = (n, v) => [0xb0, n, v];

test("a request's pause: what comes after it waits one tick", () => {
  const { w, out, sched } = loadGateway();
  w.frame(...S.encodeSettingsRequest()); w.frame(...cc(1, 1)); w.frame(...DP_TRI);
  assert.deepEqual(out.splice(0), S.encodeSettingsRequest());
  assert.equal(sched.find(([t, ms]) => ms < 1000)[1], 10);
  tick(sched);
  assert.deepEqual(out.splice(0), [...cc(1, 1), ...DP_TRI], "then all of it at once");
});

test("the queue is held while a dump request waits for its dump, and goes on at the reply or the timeout", () => {
  const { w, out, sched } = loadGateway();
  w.frame(...S.encodeRequest(0x7f));
  assert.deepEqual(out.splice(0), S.encodeRequest(0x7f));
  w.frame(...cc(1, 5)); w.frame(...DP_TRI);
  for (let i = 0; i < 5; i++) { tick(sched); }
  assert.deepEqual(out, [], "nothing while the synth dumps");
  for (const b of [0x90, 60, 100]) w.msg_int(b);
  assert.deepEqual(out.splice(0), [0x90, 60, 100], "the track's notes still go at once");
  w.replied("dump");
  tick(sched);
  assert.deepEqual(out.splice(0), [...cc(1, 5), ...DP_TRI], "the reply lets all of it out");

  w.frame(...S.encodeRequest(3)); tick(sched);
  assert.deepEqual(out.splice(0), S.encodeRequest(3));
  w.frame(...cc(1, 6));
  tick(sched); assert.deepEqual(out, []);
  sched.find(([t, ms]) => ms === 3000 && !t.cancelled)[0].fn();    // no dump within 3 s
  tick(sched);
  assert.deepEqual(out.splice(0), cc(1, 6), "the timeout lets the queue go on");
});

test("the queue is held during a store, channel messages included", () => {
  const { w, out, sched } = loadGateway();
  w.store(); out.length = 0;
  w.frame(...cc(1, 7));
  tick(sched); assert.deepEqual(out, []);
  w.stored(0, 5, 146, 1234, 4000);
  tick(sched); assert.deepEqual(out, cc(1, 7));
});

test("what is sent is counted per kind and logged once a second", () => {
  const { w, logs, sched } = loadGateway();
  w.frame(...cc(1, 0)); w.frame(...cc(2, 0)); w.frame(...DP_TRI); w.frame(0xc0, 5);
  while (w.queue.length) { tick(sched); }
  sched.find(([t, ms]) => ms === 1000)[0].fn();
  assert.deepEqual(logs.filter((l) => l.startsWith("sent last second")), ["sent last second: 2 CC, 1 DP, 1 program change, 0 queued"]);
});

test("a patch frame's pause (wire time + 150 ms): what comes after it waits, then goes out at once", () => {
  const { w, out, sched } = loadGateway();
  const PATCH = require("./fixtures").fresh();
  assert.ok(S.validateFrame(PATCH).ok);
  w.frame(...PATCH); w.frame(...cc(1, 2)); w.frame(...DP_TRI);
  assert.deepEqual(out.splice(0), PATCH);
  assert.equal(sched.find(([t, ms]) => ms < 1000)[1], Math.round(PATCH.length * 0.32) + 150);
  tick(sched);
  assert.deepEqual(out.splice(0), [...cc(1, 2), ...DP_TRI]);
});
