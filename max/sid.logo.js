// sid.logo.js – v8ui: the editor's logo top left in the overview: an atom (three orbits round a lit nucleus), SID / STATION and EDITOR.
// Drawn here rather than as a picture, so it is sharp at any size and uses the editor's palette. Nothing to click.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 0;

const INK = [1, 1, 1, 0.5];

function paint() {
  const g = mgraphics, h = g.size[1], cy = h / 2, cx = cy, rx = cy - 1.5, ry = rx * 0.36;
  g.set_source_rgba(INK); g.set_line_width(1.2);
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    g.save(); g.translate(cx, cy); g.rotate(a); g.ellipse(-rx, -ry, 2 * rx, 2 * ry); g.stroke(); g.restore();
  }
  g.set_source_rgba(UI.lit); g.ellipse(cx - 2.5, cy - 2.5, 5, 5); g.fill();
  g.set_source_rgba(INK); g.select_font_face("Ableton Sans Bold"); g.set_font_size(h * 0.4);
  const x = 2 * cx + 6;
  g.move_to(x, cy - 2); g.show_text("SID");
  g.move_to(x, h - 2); g.show_text("STATION");
  let tw = 50; try { tw = g.text_measure("EDITOR")[0]; } catch (e) {}
  g.set_source_rgba(UI.lit); g.move_to(g.size[0] - tw - 1, cy - 2); g.show_text("EDITOR");   // right-aligned on SID's line, lit like the nucleus
}

function onresize() { mgraphics.redraw(); }
function anything() {}

paint = sidguard("logo", paint);
