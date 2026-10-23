// sid.fold.js – v8ui: fold button like Live's own (light filled circle with a dark triangle):
// ▶ when the panel is expanded, ▼ when it is collapsed. A click toggles and outputs the new state
// (1 = expanded) to the Show parameter; "set v" updates silently.
// In:  state <0|1>   bang (send the state)   (not "set": in v8ui it triggered onclick)
// Out: 0|1 on outlet 0.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const C = { disc: [0.85, 0.85, 0.85, 1], tri: [0.12, 0.12, 0.12, 1] };
let open = 1;
// On load (via LiveRemote) a click sometimes arrives at the object under the mouse pointer; ignore
// clicks during the first second so that a panel does not collapse by itself.
const born = Date.now();

function paint() {
  const w = mgraphics.size[0], h = mgraphics.size[1], r = Math.min(w, h) / 2 - 1, cx = w / 2, cy = h / 2;
  mgraphics.set_source_rgba(C.disc);
  mgraphics.ellipse(cx - r, cy - r, 2 * r, 2 * r);
  mgraphics.fill();
  mgraphics.set_source_rgba(C.tri);
  const s = r * 0.5;
  if (open) { mgraphics.move_to(cx - s * 0.6, cy - s); mgraphics.line_to(cx + s * 0.8, cy); mgraphics.line_to(cx - s * 0.6, cy + s); }
  else { mgraphics.move_to(cx - s, cy - s * 0.6); mgraphics.line_to(cx + s, cy - s * 0.6); mgraphics.line_to(cx, cy + s * 0.8); }
  mgraphics.close_path();
  mgraphics.fill();
}
function onclick() {
  if (Date.now() - born < 1000) { sidlog("fold", "click ignored (just loaded)"); return; }
  open = open ? 0 : 1; outlet(0, open); mgraphics.redraw();
}
function state(v) { open = v ? 1 : 0; mgraphics.redraw(); }
function bang() { sidlog("fold", "bang ->", open); outlet(0, open); }
function onresize() { mgraphics.redraw(); }

paint = sidguard("fold", paint); onclick = sidguard("fold", onclick); state = sidguard("fold", state);
sidlog("fold", "loaded");
