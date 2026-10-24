// node --test: sid.filter.js (the routing field), the overview sid.map.js, the legend, the depth slider.
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");
const SidParams = require("../lib/params");
const { encodeDP } = require("../lib/sysex");

function loadFilter() {
  const out = [];
  const g = { UI, sidlog, sidguard, SidParams, encodeDP, inlets: 0, outlets: 0, post() {}, outlet: (o, msg, ...a) => { if (msg === "frame") out.push(a); }, arrayfromargs: (a) => Array.from(a), messagename: "x",
    Task: class { constructor(fn) { this.fn = fn; } schedule() {} cancel() {} } };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.filter.js"), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  const f = new Function(...Object.keys(g), src + "\nreturn { route, arm, sendall, quiet, msg: (n, v) => { messagename = n; anything(v); } };")(...Object.values(g));
  for (const d of SidParams.FILTER.concat(SidParams.COMMON)) f.msg(d.key, d.init);   // Live's restore on load: the starting point
  for (let n = 1; n <= 3; n++) f.route(n, 1);
  out.length = 0;
  return { f, out };
}
function loadUi(file, size, extra) {
  const out = [];
  const mg = { size, init() {}, redraw() {}, text_measure: () => [8, 9] };
  for (const f of ["set_source_rgba", "rectangle", "fill", "set_line_width", "move_to", "line_to", "stroke", "ellipse", "select_font_face", "set_font_size", "show_text", "arc", "curve_to"]) mg[f] = () => {};
  const rects = []; let ink = null;                                     // every rectangle with the colour it was drawn in
  mg.set_source_rgba = (...a) => { ink = [].concat(...a); }; mg.rectangle = (x, y, w, h) => rects.push({ x, y, ink });
  let t = 0;
  const g = { UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, outlet: (o, ...a) => out.push(a.join(" ")), arrayfromargs: (a) => Array.from(a), messagename: "x",
    Date: { now: () => (t += 5000) } };   // every call "5 s later": the load-time click guard does not trigger
  const src = fs.readFileSync(path.join(__dirname, "..", "max", file), "utf8").replace(/^inlets = 1;\noutlets = 2;\n/m, "");
  return { w: new Function(...Object.keys(g), src + "\nreturn { " + extra + " };")(...Object.values(g)), out, rects };
}

test("filter router: nothing before arm; routing and type as fields; CC for cutoff, DP for resonance", () => {
  const { f, out } = loadFilter();
  f.route(2, 0); f.msg("cutoff", 100); f.msg("ftype", 2);                          // L/B
  assert.deepEqual(out, []);
  f.arm();
  f.route(1, 0);
  assert.deepEqual(out.splice(0), [encodeDP(0x18, 7, 0, 0b100)]);
  f.msg("cutoff", 90); assert.deepEqual(out.splice(0), [[0xb0, 27, 90]]);
  f.msg("res", 5); assert.deepEqual(out.splice(0), [encodeDP(0x18, 0x0f, 4, 5)]);
  f.msg("ftype", 6); assert.deepEqual(out.splice(0), [encodeDP(0x19, 7, 0, 0b111)]);    // All
  f.msg("ftype", "High"); assert.deepEqual(out.splice(0), [encodeDP(0x19, 7, 0, 0b100)]);
  f.msg("ftype", 3); assert.deepEqual(out.splice(0), []);                                // same field value: nothing sent
  f.msg("wrap", 1); assert.deepEqual(out.splice(0), [encodeDP(0x16, 1, 6, 1)]);
  f.quiet(); f.msg("cutoff", 50); f.route(2, 1); f.msg("ftype", 0);                  // patch dump in: silent, but the state is updated
  assert.deepEqual(out.splice(0), []);
  f.quiet(-1); f.msg("res", 3); assert.deepEqual(out.splice(0), [encodeDP(0x18, 0x0f, 4, 3)]);
  f.sendall();
  const plain = SidParams.FILTER.concat(SidParams.COMMON).filter((d) => !d.field).length;
  assert.equal(out.length, plain + 2); assert.ok(out.some((m) => m[1] === 27));    // every plain parameter + the routing and type fields
  for (const row of ["24:7:0", "25:7:0", "24:15:4", "25:3:4", "26:127:0", "22:1:6"]) assert.ok(SidParams.dpRows().has(row), row);
});

test("overview: Osc shows/hides, Env per osc (only when the osc is shown), switches and arrows toggle; set is silent", () => {
  const { w, out } = loadUi("sid.map.js", [230, 163], "paint, onclick, set, bang, G");
  const G = w.G;
  w.onclick(46, G.rows[1]); assert.deepEqual(out.splice(0), ["show 2 1"]);
  w.onclick(93, G.rows[1]); assert.deepEqual(out.splice(0), ["env 2 0"]);                                  // Env unfolds/folds the envelope panel
  w.onclick(46, G.rows[0]); assert.deepEqual(out.splice(0), ["show 1 0"]);                                 // zero shown is allowed
  w.onclick(130, G.rows[1]); assert.deepEqual(out.splice(0), ["route 2 0"]);                             // osc 1/2: two positions, a click toggles
  w.onclick(130, G.rows[1]); assert.deepEqual(out.splice(0), ["route 2 1"]);
  // osc 3: three positions (3OFF); each click steps filter -> out -> off -> filter, wherever on the switch (the ground symbol too)
  w.onclick(130, G.rows[2]); assert.deepEqual(out.splice(0), ["route 3 0", "off3 0"]);
  w.onclick(143, G.rows[2] + 14); assert.deepEqual(out.splice(0), ["route 3 0", "off3 1"]);
  w.onclick(130, G.rows[2] - 9); assert.deepEqual(out.splice(0), ["route 3 1", "off3 0"]);
  w.onclick(130, G.rows[2]); out.splice(0);                                                          // leave osc 3 on out for the rest
  w.onclick((G.filt[0] + G.filt[1]) / 2, 80); assert.deepEqual(out.splice(0), ["filter 0"]);          // the Filter box folds the filter panel
  w.onclick((G.fenv[0] + G.fenv[1]) / 2, G.fenvY); assert.deepEqual(out.splice(0), ["fenv 0"]);       // the Env box by the filter folds the filter envelope
  w.onclick(G.laneSync, (G.rows[0] + G.rows[1]) / 2); assert.deepEqual(out.splice(0), ["sync 2 1"]);      // 1 -> 2: target osc 2
  w.onclick(G.laneRing, (G.rows[1] + G.rows[2]) / 2); assert.deepEqual(out.splice(0), ["ring 3 1"]);      // 2 -> 3: target osc 3
  w.onclick(G.wrapSync, G.rows[1]); assert.deepEqual(out.splice(0), ["sync 1 1"]);                        // 3 -> 1 around the edge: target osc 1
  w.onclick(G.filt[1] + 12, 80); assert.deepEqual(out.splice(0), []);                                  // right of the filter: nothing
  w.set("ringok", 3, 0); w.onclick(G.laneRing, (G.rows[1] + G.rows[2]) / 2); assert.deepEqual(out.splice(0), []);   // ring has no effect on osc 3: inert
  w.set("ringok", 3, 1);
  w.set("sync", 2, 0); w.set("route", 3, 1); w.set("env", 2, 1); w.set("show", 1, 1); assert.deepEqual(out.splice(0), []);
  w.set("filter", 1); w.set("fenv", 1);
  w.bang(); assert.deepEqual(out.splice(0), ["filter 1", "fenv 1", "show 1 1", "env 1 1", "sync 1 1", "ring 1 0", "route 1 1", "show 2 1", "env 2 1", "sync 2 0", "ring 2 0", "route 2 1", "show 3 0", "env 3 1", "sync 3 0", "ring 3 1", "route 3 1", "off3 0"]);
  w.set("route", 3, 0); w.set("off3", 3, 1); assert.deepEqual(out.splice(0), []);
  w.set("route", 3, 1); assert.deepEqual(out.splice(0), ["off3 0"], "the panel's Filter button from off: filter, 3OFF cleared");
  w.set("route", 3, 0); assert.deepEqual(out.splice(0), [], "and off again gives out, silently");
  w.set("route", 3, 1); w.set("off3", 3, 1); assert.deepEqual(out.splice(0), ["route 3 0"], "the panel's Off button from filter: off the filter too");
  w.paint();
});

test("legend: a click per row toggles the layer and sends show <key> v; set is silent; bang sends all", () => {
  const { w, out } = loadUi("sid.legend.js", [44, 62], "paint, onclick, set, bang");
  w.onclick(10, 5); assert.deepEqual(out.splice(0), ["show env 0"]);
  w.onclick(10, 60); assert.deepEqual(out.splice(0), ["show cut 0"]);
  w.set("env", 1); assert.deepEqual(out.splice(0), []);
  w.bang(); assert.deepEqual(out.splice(0), ["show env 1", "show sus 1", "show lfo 1", "show cut 0"]);
  w.paint();
});

test("depth slider: drag gives values 0..127 from the bottom, from the top when inverted; set is silent", () => {
  const { w, out } = loadUi("sid.vslider.js", [24, 76], "paint, onclick, ondrag, set, invert, msg_int");
  w.onclick(12, 1); w.ondrag(0, 0, 0); assert.deepEqual(out.splice(0), ["127"]);          // top = max
  w.onclick(12, 61); w.ondrag(0, 0, 0); assert.deepEqual(out.splice(0), ["0"]);           // bottom of the track (76 - 14 - 1) = 0
  w.invert(1);
  w.onclick(12, 1); w.ondrag(0, 0, 0); assert.deepEqual(out.splice(0), []);               // inverted: top = 0, unchanged → silent
  w.onclick(12, 61); w.ondrag(0, 0, 0); assert.deepEqual(out.splice(0), ["127"]);
  w.set(64); assert.deepEqual(out.splice(0), []);
  w.msg_int(200); assert.deepEqual(out.splice(0), ["127"]);                               // clamped
  w.paint();
});

test("the filter router sends Poly/Legato/HCut as whitelisted DP (the common block)", () => {
  const { f, out } = loadFilter();
  f.arm(); f.msg("poly", 1); f.msg("legato", "on"); f.msg("hcut", 20);
  assert.deepEqual(out.map((m) => m.slice(7, 12)), [[0, 0x16, 1, 3, 1], [0, 0x16, 1, 5, 1], [0, 0x23, 0x0f, 0, 15]], "HCut is clipped to 15");
  for (const m of out) assert.ok(SidParams.dpRows().has(((m[7] << 7) | m[8]) + ":" + m[9] + ":" + m[10]));
});

test("SidStation: Poly greys the Active buttons (== 0 -> prepend active -> o<n>_active and osc 3's Mod only button)", () => {
  const p = require("../build/amxd").readAmxd(require("path").join(__dirname, "..", "dist", "SidStation.amxd")).json.patcher;
  const byVn = (v) => p.boxes.find((b) => b.box.varname === v).box.id;
  const from = (src) => p.lines.filter((l) => l.patchline.source[0] === src).map((l) => l.patchline.destination[0]);
  const text = (bid) => p.boxes.find((b) => b.box.id === bid).box.text;
  const not = from(byVn("c_poly")).find((d) => text(d) === "== 0");
  assert.ok(not, "Poly -> == 0");
  const act = from(not).find((d) => text(d) === "prepend active");
  assert.deepEqual(from(act).sort(), ["o1_active", "o2_active", "o3_active", "o3_activebtn"].map(byVn).sort());   // + osc 3's Active/Mod only button
});

test("overview: a voice not heard is grey – Active off, or osc 2/3 in Poly (osc 1 always counts as heard)", () => {
  const { w, rects } = loadUi("sid.map.js", [230, 163], "paint, set, G");
  const grey = (i) => { rects.length = 0; w.paint(); const r = rects.filter((q) => q.x === w.G.osc[0] && Math.abs(q.y - (w.G.rows[i] - w.G.boxH / 2)) < 0.01);
    assert.ok(r.length, "osc box " + (i + 1) + " drawn"); return r.every((q) => Math.abs(q.ink[0] - q.ink[1]) < 0.01 && Math.abs(q.ink[1] - q.ink[2]) < 0.01); };
  w.set("show", 1, 1);                                                  // osc 1 lit (orange) so a grey shows
  assert.equal(grey(0), false);
  w.set("active", 1, 0); assert.equal(grey(0), true, "Active off");
  w.set("poly", 1); assert.equal(grey(0), false, "Poly: osc 1 always plays");
  w.set("show", 2, 1); assert.equal(grey(1), true, "Poly: osc 2 unused");
  w.set("poly", 0); w.set("active", 1, 1); assert.equal(grey(0), false); assert.equal(grey(1), false);
});

test("SidStation layout: Poly swaps osc 1's Active for the always-on stand-in", () => {
  const L = require("../lib/layout");
  const src = fs.readFileSync(path.join(__dirname, "..", "dist", "sid.layout.js"), "utf8");
  const lay = JSON.parse(src.split("const LAYOUTS = ")[1].split(";\n")[0]).SidStation;
  const rectOf = (st, name) => L.compute(lay, st).ops.find((o) => o.name === name).rect;
  const st = L.initialState(lay);
  assert.ok(rectOf(st, "o1_active") && !rectOf(st, "o1_activepoly"));
  st.o1.poly = 1; st.o1.single = 0;
  assert.ok(!rectOf(st, "o1_active") && rectOf(st, "o1_activepoly"));
  assert.ok(rectOf(st, "o2_active"), "osc 2/3 keep their (greyed) button");
});

test("SidStation: osc 1's Poly stand-in is sid.litbtn.js (always lit), placed where Active is", () => {
  const p = require("../build/amxd").readAmxd(path.join(__dirname, "..", "dist", "SidStation.amxd")).json.patcher;
  const vn = (v) => p.boxes.find((b) => b.box.varname === v).box;
  assert.equal(vn("o1_activepoly").filename, "sid.litbtn.js");
  assert.deepEqual(vn("o1_activepoly").presentation_rect, vn("o1_active").presentation_rect);
});

test("SidStation (one track): no global bus; midiout is fed only by the built-in gateway; every router and the notes go to it", () => {
  const p = require("../build/amxd").readAmxd(path.join(__dirname, "..", "dist", "SidStation.amxd")).json.patcher;
  const boxes = p.boxes.map((b) => b.box), text = (b) => b.text || "";
  assert.deepEqual(boxes.filter((b) => /^(s|r|send|receive) sid\.(tx|rx)\b/.test(text(b))).map(text), [], "no [s/r sid.tx/rx]");
  const id = (re) => boxes.filter((b) => re.test(text(b))).map((b) => b.id);
  const [gate] = id(/^v8 sid\.send\.js/), [cap] = id(/^v8 sid\.capture\.js/), [mout] = id(/^midiout$/), [min] = id(/^midiin$/);
  const into = (dst) => p.lines.filter((l) => l.patchline.destination[0] === dst).map((l) => l.patchline.source);
  assert.deepEqual(into(mout), [[gate, 0]], "midiout <- the gateway only");
  const routers = [...id(/^v8 sid\.osc\.js/).map((r) => [r, 2]), ...id(/^v8 sid\.(filter|lfo)\.js/).map((r) => [r, 1])];
  assert.equal(routers.length, 5);
  for (const r of routers) assert.ok(into(gate).some((s) => s[0] === r[0] && s[1] === r[1]), "router " + r[0] + " -> gateway");
  const [osc1] = boxes.filter((b) => text(b) === "v8 sid.osc.js 1").map((b) => b.id);
  assert.ok(into(gate).some((s) => s[0] === osc1 && s[1] === 0), "notes (osc 1 outlet 0) -> gateway");
  const fromIn = p.lines.filter((l) => l.patchline.source[0] === min).map((l) => l.patchline.destination[0]).sort();
  assert.deepEqual(fromIn, [cap, osc1].sort(), "midiin -> capture and the osc 1 router only");
  assert.ok(!p.lines.some((l) => l.patchline.source[0] === cap && l.patchline.destination[0] === mout), "capture never to midiout");
  const [udp] = id(/^udpreceive 9871$/);
  assert.ok(into(gate).some((s) => s[0] === udp), "terminal control (tools/sid.js) -> gateway");
});

test("SidStation: Push banks of 8 by long name; no show/hide tabs, table data, name letters or patch buttons", () => {
  const p = require("../build/amxd").readAmxd(path.join(__dirname, "..", "dist", "SidStation.amxd")).json.patcher;
  const banks = Object.values(p.parameters.parameterbanks);
  assert.equal(banks.length, 21);
  assert.deepEqual(banks.map((b) => b.index), banks.map((_, i) => i));
  const longs = new Set(p.boxes.map((b) => b.box.saved_attribute_attributes && b.box.saved_attribute_attributes.valueof && b.box.saved_attribute_attributes.valueof.parameter_longname).filter(Boolean));
  for (const b of banks) {
    assert.equal(b.parameters.length, 8, b.name);
    for (const n of b.parameters.filter((x) => x !== "-")) {
      assert.ok(longs.has(n), b.name + ": " + n);
      assert.doesNotMatch(n, /(Table|Env|Show|Table Data|Table Clear)$|^LFO Select$|^Name \d|Patch$/, b.name + ": " + n);
    }
  }
  assert.deepEqual(banks[0].parameters, ["Filter Cutoff", "Filter Resonance", "Filter Type", "Filter Env Depth", "Filter LFO Depth", "Osc 1 Active", "Osc 2 Active", "Osc 3 Active"]);
});

test("SidStation: every live.text shows its parameter's values in Live and on Push (automation/automationon), never val1/val2", () => {
  const p = require("../build/amxd").readAmxd(path.join(__dirname, "..", "dist", "SidStation.amxd")).json.patcher;
  for (const { box: b } of p.boxes.filter((x) => x.box.maxclass === "live.text")) {
    const e = b.saved_attribute_attributes.valueof.parameter_enum;
    assert.deepEqual([b.automation, b.automationon], e, b.varname);
  }
});
