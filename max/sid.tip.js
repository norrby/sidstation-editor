// sid.tip.js – v8ui: the tooltip layer. A transparent box with the overview's rect, in front of every other box there (the layout
// raises it last), and ignoreclick, so the mouse goes through to the overview beneath. The overview decides when a tip shows
// and sends it here; drawn here it is never hidden behind another box, such as the patch name in front of the overview.
// ignoreclick lets clicks through, but the mouse's hovering stops here, so it is passed on: "idle x y" / "idleout" to the overview.
// In:  tip <x> <y> <line> <line> …   show the lines near (x, y), in this box's coordinates (the same as the overview's)
//      tip                           hide
// Out: idle <x> <y> | idleout        the mouse hovering, to the overview
inlets = 1;
outlets = 1;
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

let cur = null;   // { x, y, lines }

function tip() {
  const a = arrayfromargs(arguments);
  cur = a.length >= 3 ? { x: +a[0], y: +a[1], lines: a.slice(2).map(String) } : null;
  sidlog("tip", cur ? "show at " + cur.x + " " + cur.y + ": " + cur.lines[0] : "hide");
  mgraphics.redraw();
}
function onidle(x, y) { outlet(0, "idle", x, y); }
function onidleout() { outlet(0, "idleout"); }
function measure(t) { try { return mgraphics.text_measure(t)[0]; } catch (e) { return t.length * 5; } }
// Above and to the right of the pointer, kept inside the box.
function paint() {
  if (!cur) return;
  mgraphics.set_font_size(9);
  const w = Math.max.apply(null, cur.lines.map((t) => measure(t))) + 10, h = cur.lines.length * 12 + 6;
  const W = mgraphics.size[0], H = mgraphics.size[1];
  const x = Math.max(2, Math.min(W - w - 2, cur.x + 8)), y = Math.max(2, Math.min(H - h - 2, cur.y - h - 4));
  mgraphics.set_source_rgba(0.1, 0.1, 0.1, 0.95); mgraphics.rectangle(x, y, w, h); mgraphics.fill();
  mgraphics.set_source_rgba(1, 1, 1, 0.9);
  cur.lines.forEach((t, i) => { mgraphics.move_to(x + 5, y + 13 + i * 12); mgraphics.show_text(t); });
}
function onresize() { mgraphics.redraw(); }
function anything() { post("sid.tip: unknown message " + messagename + "\n"); }
