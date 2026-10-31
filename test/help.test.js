// node --test: every control on SidStation's panel has a help text for Live's Info View (lib/help.js); only frames and
// section headings go without.
const test = require("node:test");
const NAME = require("../package.json").productName;   // the device's name
const assert = require("node:assert/strict");
const path = require("path");
const { readAmxd } = require("../build/amxd");
const { help } = require("../lib/help");

test("SidStation: every presented control has annotation_name and annotation", () => {
  const p = readAmxd(path.join(__dirname, "..", "dist", NAME + ".amxd")).json.patcher;
  const silent = (b) => b.filename === "sid.voicebg.js" || b.filename === "sid.section.js" || b.filename === "sid.tip.js";   // backgrounds and the tooltip layer
  const missing = p.boxes.map((x) => x.box)
    .filter((b) => b.presentation && /^live\.|^v8ui$|^textedit$/.test(b.maxclass) && !silent(b))
    .filter((b) => !b.annotation || !b.annotation_name).map((b) => b.varname);
  assert.deepEqual(missing, []);
});

test("SidStation: every parameter has a help text, on screen or not (read by programs driving the device through Live's API)", () => {
  const p = readAmxd(path.join(__dirname, "..", "dist", NAME + ".amxd")).json.patcher;
  const missing = p.boxes.map((x) => x.box)
    .filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname)
    .filter((b) => !b.annotation || !b.annotation_name).map((b) => b.varname);
  assert.deepEqual(missing, []);
  const byVar = (v) => p.boxes.find((b) => b.box.varname === v).box;
  assert.match(byVar("o2_pushstep").annotation, /oscillator 2's waveform table .* before them/);
  assert.match(byVar("o1_show").annotation, /Does not change the sound/);
  assert.match(byVar("c_action").annotation, /Store patch overwrites.*\[ask first\]$/);
  assert.match(p.description, /Live's API/);
  assert.match(p.description, new RegExp("^" + NAME + " " + require("../package.json").version.replace(/\./g, "\\.") + "\\. "));   // the version first
  assert.match(byVar("d_version").annotation, /302 is 0\.3\.2/);
  assert.match(byVar("map").annotation, new RegExp("This is " + NAME + " " + require("../package.json").version.replace(/\./g, "\\.") + "\\.$"), "the version where a person can read it");
});

test("help: sync and ring name the previous oscillator", () => {
  assert.match(help("o1_sync")[1], /oscillator 3/);
  assert.match(help("o2_ring")[1], /oscillator 1/);
  assert.equal(help("l3_speed")[0], "Speed");
  assert.equal(help("f_route2")[0], "Filter");
  assert.equal(help("o1_voiceframe"), null);
});
