// node --test: the whole SidStation layout (dist/sid.layout.js, generated) – no controls on top of each other and
// everything within the device height, in the initial state and with each LFO selected. Tolerance 5 px: the Tone dials
// are 46 px apart but 48 px tall, headings and brackets touch by design.
// The name display deliberately sits on top of the overview.
const test = require("node:test");
const NAME = require("../package.json").productName;   // the device's name
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../lib/layout");

const src = fs.readFileSync(path.join(__dirname, "..", "dist", "sid.layout.js"), "utf8");
const LAYOUTS = JSON.parse(src.match(/const LAYOUTS = (.*);\n/)[1]);
const TOL = 5, HEIGHT = 169;
const ALLOWED = new Set(["map × name", "map × tip", "name × tip"]);   // the name display and the tooltip layer lie on the overview on purpose

function problems(layout, state) {
  const ops = L.compute(layout, state).ops.filter((o) => o.rect && !/frame/.test(o.name));
  const out = [];
  for (const o of ops) if (o.rect[1] < 0 || o.rect[1] + o.rect[3] > HEIGHT) out.push("outside the height: " + o.name);
  for (const a of ops) for (const b of ops) {
    if (a.name >= b.name || ALLOWED.has(a.name + " × " + b.name)) continue;
    const r = a.rect, q = b.rect;
    const dx = Math.min(r[0] + r[2], q[0] + q[2]) - Math.max(r[0], q[0]), dy = Math.min(r[1] + r[3], q[1] + q[3]) - Math.max(r[1], q[1]);
    if (dx > TOL && dy > TOL) out.push(a.name + " × " + b.name + " (" + dx + "×" + dy + ")");
  }
  return out;
}

test("SidStation: no overlapping controls, initial state and LFO 1–4", () => {
  const layout = LAYOUTS[NAME];
  const st = L.initialState(layout);
  assert.deepEqual(problems(layout, st), []);
  for (let k = 1; k <= 4; k++) { L.selectLfo(st, k); assert.deepEqual(problems(layout, st), [], "LFO " + k); }
  for (const id of ["o1", "o2", "o3"]) st[id].pulse = 0;                   // pulse group hidden (compact osc panel)
  assert.deepEqual(problems(layout, st), [], "compact");
});

