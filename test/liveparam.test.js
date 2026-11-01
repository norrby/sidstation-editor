// node --test: lib/liveparam.js – automation found by short name through a mock of Live's API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function load(params, fail) {
  let made = 0;
  class LiveAPI {
    constructor(p) { made++; if (fail) throw new Error("no API"); this.p = p; }
    get(prop) {
      if (this.p === "this_device" && prop === "parameters") return params.flatMap((_, i) => ["id", 100 + i]);
      const q = params[Number(this.p.slice(3)) - 100];
      return prop === "name" ? [q.name] : [q.state];
    }
  }
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "liveparam.js"), "utf8").replace(/^if \(typeof module.*$/m, "");
  const f = new Function("LiveAPI", src + "\nreturn sidAutomated;")(LiveAPI);
  return { f, made: () => made };
}

test("true only while automation plays the parameter (state 1), by its short name; the ids are looked up once", () => {
  const { f, made } = load([{ name: "Wave Osc1", state: 1 }, { name: "Active Osc1", state: 0 }, { name: "Off Osc3", state: 2 }]);
  assert.equal(f("Wave Osc1"), true);
  assert.equal(f("Active Osc1"), false, "no automation");
  assert.equal(f("Off Osc3"), false, "overridden by hand: the automation is not playing");
  assert.equal(f("Nope"), false, "unknown name");
  const n = made(); f("Wave Osc1");
  assert.equal(made(), n + 1, "one API object per question after the first look-up");
});

test("outside Live, or when the API fails: false", () => {
  assert.equal(require("../lib/liveparam").sidAutomated("Wave Osc1"), false);
  assert.equal(load([], true).f("Wave Osc1"), false);
});

test("the short names the rules ask about are the device's own (sid.osc.js, sid.map.js)", () => {
  const dist = path.join(__dirname, "..", "dist");
  const f = "SidStation Editor.amxd";
  const shorts = new Set();
  (function walk(p) { for (const { box: b } of p.boxes) { const vo = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof; if (vo && vo.parameter_shortname) shorts.add(vo.parameter_shortname); if (b.patcher) walk(b.patcher); } })(require("../build/amxd").readAmxd(path.join(dist, f)).json.patcher);
  for (const n of [1, 2, 3]) for (const name of ["Wave Osc" + n, "Active Osc" + n]) assert.ok(shorts.has(name), name);
  for (const name of ["Off Osc3", "Filt Osc3"]) assert.ok(shorts.has(name), name);
});
