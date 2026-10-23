// node --test: lib/midi.js – the one MIDI byte-stream parser behind every [midiin] script.
const test = require("node:test");
const assert = require("node:assert/strict");
const { midiParser } = require("../lib/midi");

function run(bytes) {
  const ev = [];
  const p = midiParser({ channel: (m) => ev.push(["ch", ...m]), sysex: (f) => ev.push(["sx", f.length]), realtime: (b) => ev.push(["rt", b]),
    broken: (part, b) => ev.push(["broken", part.length, b]) });
  for (const b of bytes) p(b);
  return ev;
}

test("channel messages whole, running status followed, data without a status dropped", () => {
  assert.deepEqual(run([60, 0x90, 60, 100, 62, 90, 0xc0, 5]), [["ch", 0x90, 60, 100], ["ch", 0x90, 62, 90], ["ch", 0xc0, 5]]);
});
test("SysEx whole; realtime passes inside it and inside a channel message", () => {
  assert.deepEqual(run([0xf0, 1, 0xf8, 2, 0xf7, 0x90, 0xfe, 60, 100]), [["rt", 0xf8], ["sx", 4], ["rt", 0xfe], ["ch", 0x90, 60, 100]]);
});
test("a status byte or a new F0 cuts SysEx off; the status starts the next message", () => {
  assert.deepEqual(run([0xf0, 1, 2, 0x90, 60, 100]), [["broken", 3, 0x90], ["ch", 0x90, 60, 100]]);
  assert.deepEqual(run([0xf0, 1, 0xf0, 2, 0xf7]), [["broken", 2, 0xf0], ["sx", 3]]);
});
test("system common and a stray F7 are dropped and end running status", () => {
  assert.deepEqual(run([0x90, 60, 100, 0xf2, 1, 2, 0xf7, 61, 90]), [["ch", 0x90, 60, 100]]);
});
