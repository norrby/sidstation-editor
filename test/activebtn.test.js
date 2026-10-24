// node --test: max/sid.activebtn.js – osc 3's Active with Mod only (3OFF) in a v8ui mock.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { UI } = require("../lib/ui");
const { sidlog, sidguard } = require("../lib/maxlog");

function load() {
  const out = [], drawn = [];
  const mg = { size: [52, 18], init() {}, redraw() {}, text_measure: (t) => [t.length * 5, 9] };
  for (const f of ["set_source_rgba", "rectangle", "fill", "stroke", "set_line_width", "select_font_face", "set_font_size", "move_to", "show_text"]) mg[f] = (...a) => drawn.push([f, ...a]);
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, messagename: "", outlet: (o, ...a) => out.push(a.join(" ")), Date: { now: () => 1e12 } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.activebtn.js"), "utf8").replace("const born = Date.now();", "const born = 0;");
  const w = new Function(...Object.keys(g), src + "\nreturn { paint, onclick, set, state, setEnabled: (v) => { enabled = v; } };")(...Object.values(g));
  return { w, out, drawn };
}

test("a click steps Active -> Mod only -> off -> Active; set is silent", () => {
  const { w, out } = load();
  assert.equal(w.state(), "on");
  w.onclick(); assert.deepEqual(out.splice(0), ["off3 1"]); assert.equal(w.state(), "mod");
  w.paint();
  w.onclick(); assert.deepEqual(out.splice(0), ["off3 0", "active 0"]); assert.equal(w.state(), "off");
  w.onclick(); assert.deepEqual(out.splice(0), ["active 1"]); assert.equal(w.state(), "on");
  w.set("off3", 1); w.set("active", 1); assert.deepEqual(out.splice(0), []); assert.equal(w.state(), "mod");
  w.set("active", 0); assert.equal(w.state(), "off", "inactive wins over 3OFF");
});

test("in Poly (disabled) it is greyed but a click toggles Active on/off like osc 2's, never into Mod only (3OFF mutes voice 3)", () => {
  const { w, out } = load();
  w.setEnabled(0); w.onclick(); w.paint();
  assert.deepEqual(out.splice(0), ["active 0"]); assert.equal(w.state(), "off");
  w.onclick(); assert.deepEqual(out.splice(0), ["active 1"]); assert.equal(w.state(), "on");
  w.set("off3", 1); assert.equal(w.state(), "mod");                       // Mod only from before Poly: a click turns it off and releases 3OFF
  w.onclick(); assert.deepEqual(out.splice(0), ["off3 0", "active 0"]); assert.equal(w.state(), "off");
});

test("paint: Active lit orange, Mod only lit blue, off unlit; dimmed in Poly (UI.button)", () => {
  const { w, drawn } = load();
  const look = () => { w.paint(); const d = drawn.splice(0); return [d[0][1], d.find((c) => c[0] === "show_text")[1]]; };
  assert.deepEqual(look(), [UI.btnOn, "Active"]);
  w.onclick(); assert.deepEqual(look(), [UI.line, "Mod only"]);
  w.onclick(); assert.deepEqual(look(), [UI.btnOff, "Active"]);
  w.setEnabled(0); assert.deepEqual(look()[0], UI.btnOff);                // off stays unlit; Active in Poly turns grey
  w.onclick(); assert.deepEqual(look()[0], UI.btnDimOn);
});
