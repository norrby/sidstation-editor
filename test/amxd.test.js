// node --test: every generated device has unique box ids (a duplicate silently replaces an object, e.g. the
// SidTableTest menu's [sel] was overwritten by amxd.verticalLimit()'s obj-9).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { readAmxd } = require("../build/amxd");

const DIST = path.join(__dirname, "..", "dist");
for (const f of fs.readdirSync(DIST).filter((n) => n.endsWith(".amxd"))) {
  test(f + ": unique box ids, every patch line ends at existing boxes", () => {
    const p = readAmxd(path.join(DIST, f)).json.patcher;
    const ids = p.boxes.map((b) => b.box.id);
    const dup = ids.filter((id, k) => ids.indexOf(id) !== k);
    assert.deepEqual(dup, []);
    const set = new Set(ids);
    for (const l of p.lines) for (const end of [l.patchline.source[0], l.patchline.destination[0]]) assert.ok(set.has(end), "line to missing " + end);
  });
}
