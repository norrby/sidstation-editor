// sid.section.js – v8ui: section bracket "──── Waveform ────": a thin line at the object's mid height
// with the label centred in a gap. If the label does not fit (compact mode) only the line is drawn.
// In:  label <text…>    color r g b [a]
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 0;

let text = "";
let color = [1, 1, 1, 0.45];

function paint() {
  const w = mgraphics.size[0], h = mgraphics.size[1], y = Math.round(h / 2) + 0.5;
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(9);
  let tw = 0;
  try { tw = text ? mgraphics.text_measure(text)[0] : 0; } catch (e) { tw = text.length * 5; }
  mgraphics.set_source_rgba(color);
  mgraphics.set_line_width(1);
  if (text && tw + 16 <= w) {
    const x0 = (w - tw) / 2 - 5, x1 = (w + tw) / 2 + 5;
    mgraphics.move_to(2, y); mgraphics.line_to(x0, y); mgraphics.stroke();
    mgraphics.move_to(x1, y); mgraphics.line_to(w - 2, y); mgraphics.stroke();
    mgraphics.move_to((w - tw) / 2, h / 2 + 3.5);
    mgraphics.show_text(text);
  } else {
    mgraphics.move_to(2, y); mgraphics.line_to(w - 2, y); mgraphics.stroke();
  }
}
function label() { text = arrayfromargs(arguments).join(" "); mgraphics.redraw(); }
function color_() {}
function anything() {
  if (messagename === "color") { const a = arrayfromargs(arguments); if (a.length >= 3) color = [a[0], a[1], a[2], a.length > 3 ? a[3] : 1].map(Number); mgraphics.redraw(); return; }
  post("sid.section: unknown message " + messagename + "\n");
}
function onresize() { mgraphics.redraw(); }

paint = sidguard("section", paint); label = sidguard("section", label);
sidlog("section", "loaded");
