// node --test: max/sid.version.js – the version kept in the set: Live's restore in, the device's own version back after 50 ms.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function load(version) {
  const out = [], tasks = [], logs = [];
  const g = { sidlog: (...a) => { logs.push(a.join(" ")); }, sidguard, inlets: 0, outlets: 0, jsarguments: ["sid.version.js", version], post() {},
    outlet: (o, v) => out.push(v), messagename: "x",
    Task: class { constructor(fn) { this.fn = fn; } schedule(ms) { tasks.push([this, ms]); } cancel() { tasks.splice(tasks.findIndex((t) => t[0] === this), 1); } } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.version.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const v = new Function(...Object.keys(g), src + "\nreturn { msg_float, msg_int, encode, decode };")(...Object.values(g));
  const run = () => { for (const [t] of tasks.splice(0)) t.fn(); };
  return { v, out, tasks, logs, run };
}

test("version: encode/decode", () => {
  const { v } = load("0.3.2");
  assert.equal(v.encode("0.3.2"), 302);
  assert.equal(v.encode("1.0.0"), 10000);
  assert.equal(v.encode("12.34.56"), 123456);
  assert.equal(v.decode(302), "0.3.2");
  assert.equal(v.decode(10000), "1.0.0");
  assert.equal(v.encode("garbage"), 0);
});

test("version: a new device (restore 0) is stamped after 50 ms, and the stamp coming back changes nothing", () => {
  const { v, out, tasks, logs, run } = load("0.3.2");
  v.msg_float(0);
  assert.equal(out.length, 0, "nothing in the same event");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0][1], 50);
  assert.match(logs.at(-1), /new device, or a set saved before.*device is 0\.3\.2/);
  run();
  assert.deepEqual(out, [302]);
  v.msg_float(302);                                                    // the parameter echoes the stamp
  run();
  assert.deepEqual(out, [302]);
  assert.equal(logs.filter((l) => /set saved|new device/.test(l)).length, 1, "the restore is logged once");
});

test("version: an older set is logged with its version and stamped; the same version is left alone", () => {
  const a = load("0.3.2");
  a.v.msg_int(301);
  assert.match(a.logs.at(-1), /set saved with 0\.3\.1, device is 0\.3\.2/);
  a.run();
  assert.deepEqual(a.out, [302]);
  const b = load("1.0.0");
  b.v.msg_float(10000);
  assert.match(b.logs.at(-1), /set saved with 1\.0\.0, same as the device/);
  assert.equal(b.tasks.length, 0);
  assert.deepEqual(b.out, []);
});
