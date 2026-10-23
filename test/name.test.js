// node --test: max/sid.name.js – the dot-matrix display for the patch name in a v8ui mock.
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");
const fs = require("fs");
const path = require("path");
const { sidlog, sidguard } = require("../lib/maxlog");

function loadWidget() {
  const out = [];
  const mg = { size: [144, 30], init() {}, redraw() {} };
  for (const f of ["set_source_rgba", "rectangle", "rectangle_rounded", "fill", "set_line_width", "move_to", "line_to", "stroke"]) mg[f] = () => {};
  const scripts = [], tasks = [];
  class Task { constructor(fn) { this.fn = fn; tasks.push(this); } schedule(ms) { this.due = ms; } cancel() {} }
  const g = { Task, UI, sidlog, sidguard, mgraphics: mg, inlets: 0, outlets: 0, post() {}, outlet: (o, ...a) => (o === 2 ? scripts : out).push(a.join(" ")), arrayfromargs: (a) => Array.from(a), messagename: "x", Date,
    jsarguments: ["sid.name.js", 4, 127, 144, 30] };
  const src = fs.readFileSync(path.join(__dirname, "..", "max", "sid.name.js"), "utf8").replace(/^inlets = 1;\noutlets = 1;\n/m, "").replace("const born = Date.now();", "const born = 0;");
  const w = new Function(...Object.keys(g), src + "\nreturn { set, bang, text, paint, typed, onclick, noreply, answered, FONT, SET, geom, get warning() { return warning; } };")(...Object.values(g));
  w.patcher = { getnamed: (n) => ({ getattr: (a) => (n === "name" && a === "presentation_rect" ? [490, 127, 144, 30] : null) }) };   // the layout engine's position, not the build's
  return { w, out, scripts, tasks };
}

test("set name pads to ten characters, set char is silent but syncs textedit, bang sends all", () => {
  const { w, out } = loadWidget();
  w.set("name", "Oiseau");
  assert.equal(w.text(), "Oiseau    ");
  assert.deepEqual(out.splice(0), ["set Oiseau"], "textedit follows, no namechar");
  w.set("char", 1, "o".charCodeAt(0));
  assert.equal(w.text(), "oiseau    ");
  assert.deepEqual(out.splice(0), ["set oiseau"]);
  w.set("char", 1, "o".charCodeAt(0));                                   // echo of the same character: silent
  assert.deepEqual(out.splice(0), []);
  w.bang();
  assert.equal(out.length, 10); assert.equal(out[0], "namechar 1 " + "o".charCodeAt(0)); assert.equal(out[9], "namechar 10 32");
});

test("every character in SET has a 5x7 glyph with seven rows", () => {
  const { w } = loadWidget();
  for (const ch of w.SET) { assert.ok(w.FONT[ch], "glyph missing for " + JSON.stringify(ch)); assert.equal(w.FONT[ch].length, 7); assert.ok(w.FONT[ch].every((r) => r >= 0 && r < 32)); }
  w.paint();
});

test("a click opens the field (script + select), Return sends the whole name (ten characters) and hides the field", () => {
  const { w, out, scripts } = loadWidget();
  const edit = (...a) => { w.onclick(10, 10); out.splice(0); scripts.splice(0); w.typed(...a); };   // every Return comes from an open field
  w.onclick(10, 10);
  assert.deepEqual(scripts.splice(0), ["script sendbox name presentation 0", "script sendbox nameedit presentation 1", "script sendbox nameedit presentation_rect 490 127 144 30", "script bringtofront nameedit"]);
  assert.deepEqual(out.splice(0), ["set ", "select"], "the field is set to the current name (blank) before it gets focus");
  w.typed("Oi");
  const all = (t) => [...t.padEnd(10)].map((c, i) => "namechar " + (i + 1) + " " + c.charCodeAt(0));
  assert.deepEqual(out.splice(0), all("Oi"));
  assert.deepEqual(scripts.splice(0), ["script sendbox nameedit presentation 0", "script sendbox name presentation 1", "script sendbox name presentation_rect 490 127 144 30"]);
  edit("Ois");
  assert.deepEqual(out.splice(0), all("Ois"), "unchanged characters too");
  edit("My", "Patch");                                                  // (outputmode 0 style) words as separate arguments
  assert.equal(w.text(), "My Patch  ");
  out.splice(0);
  edit("ABCDEFGHIJKL");
  assert.equal(w.text(), "ABCDEFGHIJ");
  assert.ok(out.includes("set ABCDEFGHIJ"), "the field is set to what applies when the text is clipped");
  out.splice(0);
  edit("ABCDEFGHIJ");                                                  // the same text again: still sent in full
  assert.deepEqual(out.filter((m) => m.startsWith("namechar")), all("ABCDEFGHIJ"));
  edit(123);
  assert.equal(w.text(), "123       ");
  edit("S\u00e4l\u00f6 \u00df\u20ac");                                                       // outside ASCII: diacritics removed, the rest "?"
  assert.equal(w.text(), "Salo ??   ");
  edit("bang");                                                          // empty textedit -> route text -> bang -> "typed bang"
  assert.equal(w.text(), "          ");
});

test("opening the field sets it to the current name, so leftovers in the field never go out", () => {
  const { w, out } = loadWidget();
  w.set("name", "FatLead");
  out.splice(0);
  w.onclick(10, 10);
  assert.deepEqual(out.splice(0), ["set FatLead", "select"]);
});

test("the build: tabmode 1 keeps Tab out of the field, [sel 27 9] still bangs it so an unchanged name closes the field", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "build", "station", "overview.js"), "utf8");
  assert.match(src, /tabmode: 1/);
  assert.match(src, /"sel 27 9"/);
  assert.match(src, /A\.line\(vEsc, 1, vEdit, 0\)/);
});

test("text from the field after it has closed is ignored (Tab, then focus loss)", () => {
  const { w, out } = loadWidget();
  w.onclick(10, 10); out.splice(0);
  w.typed("bandy");
  assert.equal(out.filter((m) => m.startsWith("namechar")).length, 10);
  out.splice(0);
  w.typed("bandy    ");
  assert.deepEqual(out, []);
  assert.equal(w.text(), "bandy     ");
});

test("noreply shows NO REPLY until a reply comes in, without touching the name; a click or an open field wins", () => {
  const { w, out } = loadWidget();
  w.set("name", "SoftPad"); out.splice(0);
  w.noreply("dump");
  assert.ok(w.warning); assert.equal(w.text(), "SoftPad   ", "the name itself is unchanged"); assert.deepEqual(out, [], "nothing sent");
  w.paint();
  w.answered("settings"); assert.ok(!w.warning, "back to the name when a reply comes in");
  w.noreply("store"); w.onclick(10, 10);
  assert.ok(!w.warning, "a click to edit clears the warning");
  w.noreply("settings");
  assert.ok(!w.warning, "not shown while the field is open");
});
