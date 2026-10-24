// node --test: build/freeze.js – the frozen release file holds the device and every file it uses, unchanged.
const test = require("node:test");
const NAME = require("../package.json").productName;   // the device's name
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function entries(buf) {
  const mx = buf.subarray(32), d = mx.readUInt32BE(12), out = {};
  assert.equal(mx.subarray(d, d + 4).toString(), "dlst");
  for (let j = d + 8, end = d + mx.readUInt32BE(d + 4); j < end; j += mx.readUInt32BE(j + 4)) {
    const f = {};
    for (let k = j + 8; k < j + mx.readUInt32BE(j + 4); k += mx.readUInt32BE(k + 4)) f[mx.subarray(k, k + 4).toString()] = mx.subarray(k + 8, k + mx.readUInt32BE(k + 4));
    const name = f.fnam.toString().replace(/\0+$/, "");
    out[name] = { type: f.type.toString(), flag: f.flag.readUInt32BE(0), data: mx.subarray(f.of32.readUInt32BE(0), f.of32.readUInt32BE(0) + f.sz32.readUInt32BE(0)) };
  }
  return out;
}

test("freeze: the device plus its scripts and icons, byte for byte, and nothing from the test devices", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "freeze-")), "SidStation.amxd");
  execFileSync(process.execPath, [path.join(ROOT, "build", "freeze.js"), path.join(ROOT, "dist", NAME + ".amxd"), out]);
  const buf = fs.readFileSync(out);
  assert.equal(buf.subarray(0, 4).toString(), "ampf");
  assert.equal(buf.readUInt32LE(20), 7, "meta 7: frozen");
  assert.equal(buf.subarray(32, 36).toString(), "mx@c");
  const e = entries(buf);
  assert.equal(e[NAME + ".amxd"].type, "JSON"); assert.equal(e[NAME + ".amxd"].flag, 0x11);
  for (const f of ["sid.name.js", "sid.send.js", "sid.osc.js", "sid.layout.js", "wave-tri.svg", "lfo-rand.svg"]) {
    assert.ok(e[f], f + " embedded");
    assert.deepEqual(e[f].data, fs.readFileSync(path.join(ROOT, "dist", f)), f + " unchanged");
  }
  for (const f of ["sid.fake.js", "sid.probe.js"]) assert.ok(!e[f], f + " is not part of the device");
  assert.ok(!buf.includes(Buffer.from("/Users/")), "no local paths");
});
