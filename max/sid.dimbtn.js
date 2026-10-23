// sid.dimbtn.js – v8ui: a toggle drawn greyed out that still works. Stands in for a live.text while its setting has no effect
// (Legato while no oscillator has Portamento): the value can still be changed, and the help text says why nothing happens.
// The layout swaps it with the real button. Args: the label (default Legato, its only use so far).
// In:  set <v>   (silent, from the real button)      Out: <v> to the real button on a click

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const label = jsarguments.length > 1 ? jsarguments.slice(1).join(" ") : "Legato";
let value = 0;
const born = Date.now();   // see sid.fold.js: clicks during loading are ignored

function paint() { UI.button(mgraphics, mgraphics.size[0], mgraphics.size[1], { label, on: value === 1, dim: true }); }
function onclick() {
  if (Date.now() - born < 1000) return;
  value = value ? 0 : 1;
  outlet(0, value);
  mgraphics.redraw();
}
function set(v) { value = v ? 1 : 0; mgraphics.redraw(); }
function onresize() { mgraphics.redraw(); }

paint = sidguard("dimbtn", paint); onclick = sidguard("dimbtn", onclick); set = sidguard("dimbtn", set);
sidlog("dimbtn", "loaded");
