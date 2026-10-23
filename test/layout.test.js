// node --test: lib/layout.js – panels in a row, pulse group, folding, diff messages.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib/layout");

const osc = (id) => ({ id, kind: "osc", fullW: 700, compactW: 500, foldW: 52, shift: 200, items: [
  { name: id + "_fold", rect: [8, 8, 44, 18], col: true },
  { name: id + "_waveframe", rect: [58, 3, 260, 163], compact: [58, 3, 60, 163] },
  { name: id + "_pulse", rect: [114, 18, 204, 76], when: "pulse" },
  { name: id + "_transpose", rect: [340, 18, 44, 48], shift: true },
] });
const arrow = (id) => ({ id, kind: "fixed", width: 40, items: [{ name: id, rect: [0, 3, 40, 163] }] });
const layout = { panels: [arrow("a1"), osc("o1"), arrow("a2"), osc("o2")], backs: ["o1_waveframe", "o2_waveframe"] };
const byName = (ops) => Object.fromEntries(ops.map((o) => [o.name, o.rect]));

test("full layout: panels are laid out with GAP and the width is the sum", () => {
  const r = L.compute(layout, {});
  const m = byName(r.ops);
  assert.deepEqual(m.a1, [0, 3, 40, 163]);
  assert.deepEqual(m.o1_fold, [46 + 8, 8, 44, 18]);
  assert.deepEqual(m.a2, [46 + 706, 3, 40, 163]);
  assert.equal(r.width, 46 + 706 + 46 + 706);
});

test("pulse group hidden: pulse out of the presentation, waveframe compact, the rest moved by shift", () => {
  const r = L.compute(layout, { o1: { pulse: 0 } });
  const m = byName(r.ops);
  assert.equal(m.o1_pulse, null);
  assert.deepEqual(m.o1_waveframe, [46 + 58, 3, 60, 163]);
  assert.deepEqual(m.o1_transpose, [46 + 340 - 200, 18, 44, 48]);
  assert.deepEqual(m.a2, [46 + 506, 3, 40, 163]);
  assert.equal(r.width, 46 + 506 + 46 + 706);
});

test("messages: everything the first time, then only changes, sendtoback last", () => {
  const prev = {};
  const all = L.messages(L.compute(layout, {}).ops, prev, layout.backs);
  assert.ok(all.length > 10);
  assert.deepEqual(all.slice(-2), ["script sendtoback o1_waveframe", "script sendtoback o2_waveframe"]);
  assert.deepEqual(L.messages(L.compute(layout, {}).ops, prev, layout.backs), []);
  const diff = L.messages(L.compute(layout, { o1: { pulse: 0 } }).ops, prev, layout.backs);
  assert.ok(diff.includes("script sendbox o1_pulse presentation 0"));
  assert.ok(diff.includes("script sendbox o1_transpose presentation_rect 186 18 44 48"));
  assert.ok(!diff.some((m) => m.startsWith("script sendbox o1_fold")));
  assert.equal(L.pulseVisible(2), true); assert.equal(L.pulseVisible(1), false);
});

test("voice: column + unfolded sub-panels, the frame follows the width; show 0 / env 0 removes a sub-panel", () => {
  const voice = { id: "v1", kind: "voice", colW: 72, gap: 6, pad: 8, items: [{ name: "v1_frame", rect: [0, 3, 80, 163], frame: true }, { name: "v1_digit", rect: [8, 9, 24, 20] }],
    sub: [{ ...osc("o1"), items: osc("o1").items.concat([{ name: "o1_frame", rect: [0, 7, 700, 155], compact: [0, 7, 500, 155] }]) },
          { id: "e1", kind: "env", owner: "o1", width: 240, items: [{ name: "o1_adsr", rect: [8, 18, 224, 118] }] }] };
  const lay = { panels: [arrow("map"), voice, arrow("f")], backs: [] };
  let r = L.compute(lay, {});
  let m = byName(r.ops);
  assert.deepEqual(m.v1_digit, [46 + 8, 9, 24, 20]);
  assert.deepEqual(m.o1_frame, [46 + 78, 7, 700, 155]); assert.deepEqual(m.o1_adsr, [46 + 78 + 706 + 8, 18, 224, 118]);
  assert.deepEqual(m.v1_frame, [46, 3, 78 + 700 + 6 + 240 + 8, 163]); assert.equal(r.width, 46 + 1032 + 6 + 46);
  r = L.compute(lay, { o1: { show: 0 } }); m = byName(r.ops);
  assert.equal(m.o1_frame, null); assert.deepEqual(m.o1_adsr, [46 + 78 + 8, 18, 224, 118]); assert.deepEqual(m.v1_frame, [46, 3, 78 + 240 + 8, 163]);
  r = L.compute(lay, { o1: { show: 0, env: 0 } }); m = byName(r.ops);
  assert.equal(m.o1_adsr, null); assert.deepEqual(m.v1_frame, [46, 3, 80, 163]); assert.equal(r.width, 46 + 86 + 46);
  r = L.compute(lay, { o1: { pulse: 0 } }); m = byName(r.ops);
  assert.deepEqual(m.o1_frame, [46 + 78, 7, 500, 155]); assert.deepEqual(m.v1_frame, [46, 3, 78 + 500 + 6 + 240 + 8, 163]);
});

test("when as a list: shown only when all flags are set", () => {
  const p = { id: "o1", kind: "osc", fullW: 700, compactW: 500, shift: 200, items: [{ name: "o1_pwlfo", rect: [250, 140, 52, 18], when: ["pulse", "pwlfo"] }] };
  const lay = { panels: [p], backs: [] };
  assert.equal(byName(L.compute(lay, { o1: { pulse: 1, pwlfo: 0 } }).ops).o1_pwlfo, null);
  assert.equal(byName(L.compute(lay, { o1: { pulse: 0, pwlfo: 1 } }).ops).o1_pwlfo, null);
  assert.deepEqual(byName(L.compute(lay, { o1: { pulse: 1, pwlfo: 1 } }).ops).o1_pwlfo, [250, 140, 52, 18]);
});

test("LFO section: only the selected LFO is shown, the fold button folds all, the initial state shows LFO 1", () => {
  const P = { id: "vl", kind: "voice", colW: 60, gap: 10, pad: 8, items: [{ name: "l_sel", rect: [16, 36, 40, 92] }],
    sub: [1, 2, 3, 4].map((n) => ({ id: "l" + n, kind: "osc", fullW: 404, compactW: 404, shift: 0, items: [{ name: "l" + n + "_speed", rect: [8, 106, 44, 48] }], ...(n > 1 ? { initShow: 0 } : {}) })) };
  const layout = { panels: [P] };
  const st = L.initialState(layout);
  const vis = (s) => L.compute(layout, s).ops.filter((o) => o.rect && /_speed$/.test(o.name)).map((o) => o.name);
  assert.deepEqual(vis(st), ["l1_speed"]);
  assert.equal(L.compute(layout, st).width, 60 + 10 + 404 + 8 + L.LAYOUT_GAP);
  L.selectLfo(st, 3);
  assert.deepEqual(vis(st), ["l3_speed"]);
  for (const n of [1, 2, 3, 4]) st["l" + n].fold = 1;
  assert.deepEqual(vis(st), []);
  assert.equal(L.compute(layout, st).width, 60 + 8 + L.LAYOUT_GAP);
});

test("voice background: a shape per frame item with bg; rows open with their sub-panel, target = index among the visible ones", () => {
  const bg = { mode: 0, frame: [3, 166], inner: [7, 162], rows: [{ x: 22, y: 10, h: 18, subs: [0] }, { x: 22, y: 32, h: 18, subs: [1] }] };
  const voice = { id: "v1", kind: "voice", colW: 60, gap: 10, pad: 8, items: [{ name: "v1_bg", rect: [0, 0, 80, 169], frame: true, bg }],
    sub: [{ id: "o1", kind: "fixed", width: 100, items: [] }, { id: "e1", kind: "env", owner: "o1", width: 50, items: [] }] };
  const shape = (st) => L.compute({ panels: [voice] }, st).ops.find((o) => o.shape).shape;
  assert.deepEqual(shape({ o1: { env: 1 } }), [0, 66, 3, 166, 7, 162, 2, 1, 22, 10, 18, 0, -1, 0, 1, 22, 32, 18, 1, -1, 0, 2, 70, 100, 180, 50]);
  assert.deepEqual(shape({ o1: { env: 0 } }).slice(14), [0, 22, 32, 18, -1, -1, 0, 1, 70, 100]);
  const prev = {};
  assert.ok(L.messages(L.compute({ panels: [voice] }, { o1: { env: 1 } }).ops, prev).some((m) => m.startsWith("script send v1_bg shape 0 66")));
  assert.equal(L.messages(L.compute({ panels: [voice] }, { o1: { env: 1 } }).ops, prev).length, 0, "unchanged: nothing sent");
});
