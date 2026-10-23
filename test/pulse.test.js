// node --test: max/sid.pulse.js in a v8ui mock (messages, drag, periods, Add).
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function loadWidget() {
  const out = [];
  const mg = { size: [360, 100], init() {}, redraw() {} };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "move_to", "line_to", "stroke", "ellipse", "select_font_face", "set_font_size", "show_text"]) mg[f] = () => {};
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, outlet: (o, ...a) => out.push(a.join(" ")), arrayfromargs: (a) => Array.from(a), messagename: "x" };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.pulse.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "");
  const fn = new Function(...Object.keys(g), src + "\nreturn { get start() { return start; }, geom, label, paint, onclick, ondrag, startMsg: (v) => apply(v), set, bang, steps, periods, add, addscale };");
  return { w: fn(...Object.values(g)), out };
}

test("start sets and echoes, set is silent, out of range is clamped with echo", () => {
  const { w, out } = loadWidget();
  w.steps(128);
  w.startMsg(40); assert.deepEqual(out.splice(0), ["start 40"]);
  w.set("start", 100); assert.deepEqual(out.splice(0), []); assert.equal(w.start, 100);
  w.startMsg(500); assert.deepEqual(out.splice(0), ["start 127"]);
  w.startMsg(-1); assert.deepEqual(out.splice(0), ["start 0"]);
});

test("dragging in the first period moves the edge to the mouse position; clicks in later periods do nothing", () => {
  const { w, out } = loadWidget();
  w.steps(128); w.periods(3); w.set("start", 64);
  const g = w.geom();
  assert.ok(Math.abs(g.xs - (g.x0 + 64 * g.u)) < 1e-9);
  assert.ok(Math.abs(g.pw * 3 - (g.x1 - g.x0)) < 1e-9);
  const ym = (g.top + g.bottom) / 2;
  w.onclick(g.xs, ym); w.ondrag(g.x0 + 10.4 * g.u, ym, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["start 10"]);
  w.onclick(g.x0 + 5 * g.u, ym); w.ondrag(g.x1 + 50, ym, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), ["start 5", "start 127"]);           // clamped at the edge
  w.onclick(g.x0 + 1.5 * g.pw, ym); w.ondrag(g.x0 + 1.5 * g.pw + 20, ym, 1); w.ondrag(0, 0, 0);
  assert.deepEqual(out.splice(0), []); assert.equal(w.start, 127);     // period 2: nothing
});

test("Add shifts the edge period by period (next pulse narrower), stops at the thinnest pulse, not echoed", () => {
  const { w, out } = loadWidget();
  w.steps(128); w.periods(3); w.addscale(0.25); w.set("start", 64);
  assert.deepEqual(w.geom().edges, [64, 64, 64]);
  w.add(40); assert.deepEqual(out.splice(0), []);
  assert.deepEqual(w.geom().edges, [64, 74, 84]);
  w.set("add", 127); assert.deepEqual(w.geom().edges, [64, 96, 127]);   // no wrap: stops at the thinnest pulse
  w.set("start", 0); w.set("add", 40);
  assert.deepEqual(w.geom().edges, [0, 10, 20]);   // period 1 flat (silent), then a thin pulse
  assert.equal(w.label(), "PW 0  quiet  Add 40");
  w.paint();
});

test("label: 64 = 50 % high, 127 = thin pulse, 0 = silent [H]", () => {
  const { w } = loadWidget();
  w.steps(128); w.set("start", 64); assert.equal(w.label(), "PW 64  50 %");
  w.set("start", 127); assert.equal(w.label(), "PW 127  1 %"); w.paint();
  w.set("start", 0); assert.equal(w.label(), "PW 0  quiet"); w.paint();
});
