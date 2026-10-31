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
  const rel = "Documents/SidStation-Editor/logs/max.log";
  assert.deepEqual(sidUserPaths(rel, "windows", "C:/Users/Ann Lee/Documents/Ableton/User Library/SidStation Editor.amxd"),
    ["C:/Users/Ann Lee/Documents/SidStation-Editor/logs/max.log", "~/Documents/SidStation-Editor/logs/max.log"]);
  assert.deepEqual(sidUserPaths(rel, "windows", "c:\\Users\\ann\\Downloads\\SidStation Editor.amxd"),
    ["c:/Users/ann/Documents/SidStation-Editor/logs/max.log", "~/Documents/SidStation-Editor/logs/max.log"], "backslashes and lower case");
  assert.deepEqual(sidUserPaths(rel, "windows", "D:/Live/SidStation Editor.amxd"), ["~/Documents/SidStation-Editor/logs/max.log"], "not under Users: only ~");
  assert.deepEqual(sidUserPaths(rel, "windows", ""), ["~/Documents/SidStation-Editor/logs/max.log"], "no device path (not saved yet)");
});

test("capture: a patch dump goes to the log as one line of bytes, and nothing is saved as a file", () => {
  const logs = [];
  const g = { midiParser, sidlog: (tag, ...a) => logs.push(tag + " " + a.join(" ")), sidguard, ...S, inlets: 0, outlets: 0, post() {},
    arrayfromargs: (a) => Array.from(a), outlet() {}, File: class { constructor() { throw new Error("must not touch a file"); } } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.capture.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const cap = new Function(...Object.keys(g), src + "\nreturn { msg_int };")(...Object.values(g));
  const skip = S.SID_HEADER.concat([0x03, 0xf7]);
  for (const b of skip) cap.msg_int(b);
  assert.deepEqual(logs.filter((l) => l.startsWith("capture dump")), ["capture dump 8 bytes: f0 00 20 3c 01 00 03 f7"]);
});
