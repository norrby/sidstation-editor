// node --test: lib/maxlog.js – where the log and the dumps go on macOS and Windows, and the capture keeping the first folder that works.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { midiParser } = require("../lib/midi");
const { sidguard, sidUserPaths } = require("../lib/maxlog");
const S = require("../lib/sysex");

test("macOS: the home folder is ~", () => {
  assert.deepEqual(sidUserPaths("Library/Logs/SidStation-Editor/max.log", "macintosh", "Macintosh HD:/Users/x/Music/SidStation Editor.amxd"),
    ["~/Library/Logs/SidStation-Editor/max.log"]);
});

test("Windows: the home folder from the device's path first, then ~", () => {
  const rel = "Documents/SidStation-Editor/dumps";
  assert.deepEqual(sidUserPaths(rel, "windows", "C:/Users/Ann Lee/Documents/Ableton/User Library/SidStation Editor.amxd"),
    ["C:/Users/Ann Lee/Documents/SidStation-Editor/dumps", "~/Documents/SidStation-Editor/dumps"]);
  assert.deepEqual(sidUserPaths(rel, "windows", "c:\\Users\\ann\\Downloads\\SidStation Editor.amxd"),
    ["c:/Users/ann/Documents/SidStation-Editor/dumps", "~/Documents/SidStation-Editor/dumps"], "backslashes and lower case");
  assert.deepEqual(sidUserPaths(rel, "windows", "D:/Live/SidStation Editor.amxd"), ["~/Documents/SidStation-Editor/dumps"], "not under Users: only ~");
  assert.deepEqual(sidUserPaths(rel, "windows", ""), ["~/Documents/SidStation-Editor/dumps"], "no device path (not saved yet)");
});

function loadCapture(dev, files, logs) {
  // A fake File: writing anywhere "opens", but only C:/Users/ann/Documents/SidStation-Editor/dumps exists.
  class File {
    constructor(p, mode) { this.p = p; this.mode = mode; this.isopen = true; this.eof = mode === "read" ? (files[p] || []).length : 0; }
    writebytes(b) { if (this.p.startsWith("C:/Users/ann/Documents/SidStation-Editor/dumps/")) files[this.p] = b.slice(); }
    close() {}
  }
  const g = { SID_DEV: dev, midiParser, sidlog: (...a) => logs.push(a.join(" ")), sidguard, ...S, inlets: 0, outlets: 0, post() {}, arrayfromargs: (a) => Array.from(a),
    outlet() {}, File, sidUserPaths: (rel) => sidUserPaths(rel, "windows", "C:/Users/ann/Documents/Ableton/User Library/x.amxd").reverse() };   // ~ tried first
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.capture.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  return new Function(...Object.keys(g), src + "\nreturn { msg_int };")(...Object.values(g));
}

test("capture in a release build: a dump is never saved as a file", () => {
  const files = {}, logs = [];
  const cap = loadCapture(false, files, logs);
  const skip = S.SID_HEADER.concat([0x03, 0xf7]);
  for (const b of skip) cap.msg_int(b);
  assert.deepEqual(Object.keys(files), []);
  assert.equal(logs.filter((l) => /saved/.test(l)).length, 0, "not even a 'not saved' line");
});

test("capture: tries each dump folder, keeps the first where the file can be read back", () => {
  const files = {}, logs = [];
  const cap = loadCapture(true, files, logs);
  const skip = S.SID_HEADER.concat([0x03, 0xf7]);
  for (const b of skip.concat(skip)) cap.msg_int(b);
  const saved = Object.keys(files);
  assert.equal(saved.length, 2);
  assert.ok(saved.every((p) => p.startsWith("C:/Users/ann/Documents/SidStation-Editor/dumps/")));
  assert.equal(logs.filter((l) => /^capture saved/.test(l)).length, 2);
});
