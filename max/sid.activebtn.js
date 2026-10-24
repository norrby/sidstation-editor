// sid.activebtn.js – v8ui: osc 3's Active button with a third state, "Mod only" (the SID's 3OFF: osc 3 keeps running but is not
// heard, so it can still sync or ring osc 1). Whether osc 3 is heard belongs to Active, not to the filter. Drawn like a live.text; a click steps
// Active -> Mod only -> off -> Active. The parameters stay the hidden live.text "Osc 3 Active" and "Osc 3 Off" (3OFF).
// In:  set active <v>   set off3 <v>   (silent, from the parameters)      active <0|1>   enabled (0 in Poly, which ignores Active)
// Out: "active <v>", "off3 <v>"

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

let active = 1, off3 = 0, enabled = 1;
const born = Date.now();   // see sid.fold.js: clicks during loading are ignored

function state() { return !active ? "off" : off3 ? "mod" : "on"; }
// Mod only is lit in the blue of sync/relative pitch, so it reads as "a modulator"; in Poly it is greyed like the other Active buttons.
function paint() {
  const s = state();
  UI.button(mgraphics, mgraphics.size[0], mgraphics.size[1], { label: s === "mod" ? "Mod only" : "Active", on: s !== "off", lit: s === "mod" ? UI.line : UI.btnOn, dim: !enabled });
}
function onclick() {
  if (Date.now() - born < 1000) return;
  const s = state();
  // In Poly greyed but settable like osc 2's Active, on <-> off only: 3OFF silences SID voice 3, which in Poly plays the third note
  if (!enabled) {
    if (s === "on") { active = 0; outlet(0, "active", 0); }
    else { if (off3) { off3 = 0; outlet(0, "off3", 0); } if (s === "off") { active = 1; outlet(0, "active", 1); } else { active = 0; outlet(0, "active", 0); } }
    mgraphics.redraw();
    return;
  }
  if (s === "on") { off3 = 1; outlet(0, "off3", 1); }
  else if (s === "mod") { off3 = 0; active = 0; outlet(0, "off3", 0); outlet(0, "active", 0); }
  else { active = 1; outlet(0, "active", 1); }
  mgraphics.redraw();
}
function set(what, v) {
  if (what === "active") active = v ? 1 : 0;
  else if (what === "off3") off3 = v ? 1 : 0;
  else { post("sid.activebtn: unknown set " + what + "\n"); return; }
  mgraphics.redraw();
}
function msg_int(v) {}                                                    // (ints are not ours)
function anything() {
  if (messagename === "active") { enabled = arguments[0] ? 1 : 0; mgraphics.redraw(); return; }
  post("sid.activebtn: unknown message " + messagename + "\n");
}
function onresize() { mgraphics.redraw(); }

paint = sidguard("activebtn", paint); onclick = sidguard("activebtn", onclick); set = sidguard("activebtn", set);
sidlog("activebtn", "loaded");
