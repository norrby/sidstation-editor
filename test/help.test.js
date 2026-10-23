// node --test: every control on SidStation's panel has a help text for Live's Info View (lib/help.js); only frames and
// section headings go without.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { readAmxd } = require("../build/amxd");
const { help } = require("../lib/help");

test("SidStation: every presented control has annotation_name and annotation", () => {
  const p = readAmxd(path.join(__dirname, "..", "dist", "SidStation.amxd")).json.patcher;
  const silent = (b) => b.filename === "sid.voicebg.js" || b.filename === "sid.section.js";
  const missing = p.boxes.map((x) => x.box)
    .filter((b) => b.presentation && /^live\.|^v8ui$|^textedit$/.test(b.maxclass) && !silent(b))
    .filter((b) => !b.annotation || !b.annotation_name).map((b) => b.varname);
  assert.deepEqual(missing, []);
});

test("help: sync and ring name the previous oscillator", () => {
  assert.match(help("o1_sync")[1], /oscillator 3/);
  assert.match(help("o2_ring")[1], /oscillator 1/);
  assert.equal(help("l3_speed")[0], "Speed");
  assert.equal(help("f_route2")[0], "Filter");
  assert.equal(help("o1_voiceframe"), null);
});
