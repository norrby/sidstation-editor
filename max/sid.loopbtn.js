// sid.loopbtn.js – v8ui: the table's one-shot / loop toggle, so looping does not depend on
// knowing that the End/Loop step can be clicked. Drawn like a live.text: dark when one-shot (an arrow to a bar, →|), lit when
// looping (an arrow round a circle). A click toggles and outputs the new state; "state v" updates silently (from the table).
// In:  state <0|1>    Out: 0|1 on outlet 0 (1 = loop)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const C = { off: [0.12, 0.12, 0.12, 1], on: UI.loop, iconOff: UI.text, iconOn: UI.dark };   // on: the table's Loop green
let loop = 0;
const born = Date.now();

function arrowHead(x, y, dx, dy, s) {
  const px = -dy, py = dx, g = mgraphics;
  g.move_to(x, y); g.line_to(x - dx * s + px * s * 0.6, y - dy * s + py * s * 0.6); g.line_to(x - dx * s - px * s * 0.6, y - dy * s - py * s * 0.6); g.close_path(); g.fill();
}
function paint() {
  const g = mgraphics, w = g.size[0], h = g.size[1], cx = w / 2, cy = h / 2;
  UI.button(g, w, h, { on: loop, lit: C.on, unlit: C.off, border: false });
  g.set_source_rgba(loop ? C.iconOn : C.iconOff); g.set_line_width(1.3);
  if (loop) {                                                            // a circle with an arrowhead: around and around
    const r = h * 0.3, a0 = -Math.PI * 0.35, a1 = Math.PI * 1.45;
    g.arc(cx, cy, r, a0, a1); g.stroke();
    arrowHead(cx + r * Math.cos(a1), cy + r * Math.sin(a1), -Math.sin(a1), Math.cos(a1), 3.5);
  } else {                                                               // →| : once, then stop
    const x0 = cx - 8, x1 = cx + 6;
    g.move_to(x0, cy); g.line_to(x1 - 3, cy); g.stroke();
    arrowHead(x1 - 1, cy, 1, 0, 3.5);
    g.move_to(x1 + 1.5, cy - 5); g.line_to(x1 + 1.5, cy + 5); g.stroke();
  }
}
function onclick() {
  if (Date.now() - born < 1000) return;                                  // see sid.fold.js
  loop = loop ? 0 : 1; outlet(0, loop); mgraphics.redraw();
}
function state(v) { loop = Number(v) ? 1 : 0; mgraphics.redraw(); }
function onresize() { mgraphics.redraw(); }

paint = sidguard("loopbtn", paint); onclick = sidguard("loopbtn", onclick); state = sidguard("loopbtn", state);
sidlog("loopbtn", "loaded");
