// maxlog.js – shared log for all v8/v8ui scripts (bundled in by the build scripts).
// Everything goes to the Max console. For troubleshooting it can also go to a file – loading, arming, refused messages and,
// above all, exceptions caught in message handlers (sidguard) – but only when the log folder exists, since Max cannot create
// folders: create ~/Library/Logs/SidStation (macOS) to get max.log there. (Windows: not checked yet.)
//   sidlog(tag, ...parts)      write one line (post + file)
//   sidguard(tag, fn)          return fn wrapped in a try/catch that logs errors
const SIDLOG_FILE = "~/Library/Logs/SidStation/max.log";

function sidlog(tag) {
  const parts = Array.prototype.slice.call(arguments, 1).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)));
  const line = (function (d) { return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? "0" : "") + n; }).join(":"); })(new Date()) + " [" + tag + "] " + parts.join(" ");
  try { post(line + "\n"); } catch (e) {}
  try {
    if (typeof File === "undefined") return;
    const f = new File(SIDLOG_FILE, "write", "TEXT");
    if (f.isopen) { f.position = f.eof; f.writestring(line + "\n"); f.close(); }
  } catch (e) {}
}

function sidguard(tag, fn) {
  return function () {
    try { return fn.apply(this, arguments); }
    catch (e) {
      const where = e && e.stack ? " | " + String(e.stack).split("\n").slice(0, 2).join(" ") : "";
      sidlog(tag, "ERROR in " + (fn.name || "?") + "(" + Array.prototype.slice.call(arguments).join(" ") + "): " + (e && e.message || e) + where);
    }
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { sidlog, sidguard };


// ui.js – the palette shared by the editor's widgets, bundled in front of every v8ui script (build/build-station.js). Named for what
// a colour means, so the widgets agree: one blue for curves, relative pitch and sync, one yellow for the envelope's peak, …
const UI = {
  bg: [0.16, 0.16, 0.16, 1],          // a widget's own background (graphs, the table, the note picker)
  grid: [1, 1, 1, 0.08],              // grid lines and ruler ticks
  text: [1, 1, 1, 0.75],              // labels and values
  line: [0.4, 0.75, 1, 1],            // curves, relative pitch, sync
  fill: [0.4, 0.75, 1, 0.22],         // the area under a curve
  peak: [1, 0.78, 0.3, 1],            // the envelope's peak and depth, the playhead
  sus: [1, 0.5, 0.75, 1],             // the sustain level
  lfo: [0.6, 1, 0.6, 1],              // LFO movement
  lit: [1, 0.6, 0.2, 1],              // lit in the overview and the name display, ring
  loop: [0.55, 0.9, 0.45, 1],         // Loop (the table, the loop button)
  dark: [0.1, 0.1, 0.1, 1],           // text on a lit button
  warn: [1, 0.3, 0.25, 1],            // a warning (NO REPLY in the name display)
  btnOn: [1, 0.678, 0.337, 1],        // a lit live.text, sampled (255 173 86)
  btnOff: [0.2, 0.2, 0.2, 1],         // an unlit button
  btnEdge: [0.07, 0.07, 0.07, 1],     // a live.text's border, and the label on a lit one (sampled)
};

// A button drawn like a live.text, filling the whole v8ui (w x h): filled, a 1 px dark border, the label centred in Live's font.
// o: { label, on, lit (the colour when on, default btnOn), unlit (when off, default btnOff), border (default true), dim }. The label
// is dark on a lit button and light on an unlit one; dim greys the fill and label like a disabled live.text (not the border).
// A button with an icon instead of a label draws the background here and the icon itself (sid.loopbtn.js).
UI.button = function (g, w, h, o) {
  const dim = (c) => (o.dim ? [c[0], c[1], c[2], c[3] * 0.4] : c);
  g.set_source_rgba(dim(o.on ? o.lit || UI.btnOn : o.unlit || UI.btnOff)); g.rectangle(0, 0, w, h); g.fill();
  if (o.border !== false) { g.set_source_rgba(UI.btnEdge); g.set_line_width(1); g.rectangle(0.5, 0.5, w - 1, h - 1); g.stroke(); }
  if (!o.label) return;
  g.select_font_face("Ableton Sans Medium"); g.set_font_size(9.5);
  let tw = o.label.length * 5; try { tw = g.text_measure(o.label)[0]; } catch (e) {}
  g.set_source_rgba(dim(o.on ? UI.btnEdge : UI.text)); g.move_to((w - tw) / 2, h / 2 + 3.5); g.show_text(o.label);
};

if (typeof module !== "undefined" && module.exports) module.exports = { UI };


// sid.voicebg.js – v8ui: the voice's background, drawn as tabs: every open fold row in the
// column gets a tongue that leads to its panel, so the label and the panel it opened read as one shape.
//   mode 1 (the voices): a divider on the voice's left edge – a black line with the Commodore rainbow at its foot
//          (full-height cards met Live's title bar in the same grey), one colour per row and a halo around its panel (the darker sub-panel on top gets
//          tinted). The tongue runs straight to the right at its row's height; it passes under the panels in its way
//          (it is not drawn there) and shows in the gaps between them until it joins its own panel.
//   mode 2 (the overview): the same without the divider.
// Lies behind everything (sendtoback) and ignores clicks; the layout engine sets its rect and sends the shape.
// In: shape <numbers…> (lib/layout.js voiceShape)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 0;

const DIVIDER = [0, 0, 0, 0.55];
const RAINBOW = [[0.86, 0.2, 0.18, 1], [0.95, 0.52, 0.16, 1], [0.97, 0.82, 0.25, 1], [0.35, 0.72, 0.32, 1], [0.27, 0.5, 0.86, 1]];   // the C64 badge stripes
const COLOURS = [[0.36, 0.56, 0.9, 0.34], [0.38, 0.78, 0.46, 0.34], [0.96, 0.66, 0.24, 0.34], [0.66, 0.46, 0.92, 0.34],   // osc/env/tbl, LFO
  [0.85, 0.87, 0.92, 0.26]];                                                                                                  // the overview (SHADE.halo)
const R = 6, FILLET = 5;
let sh = null;

// Rounded rectangle, clockwise (all subpaths clockwise, so overlapping ones fill as a union).
function rr(x, y, w, h, c) {
  const [tl, tr, br, bl] = c, g = mgraphics, P = Math.PI;
  if (w <= 0 || h <= 0) return;
  g.move_to(x + tl, y); g.line_to(x + w - tr, y);
  if (tr) g.arc(x + w - tr, y + tr, tr, -P / 2, 0);
  g.line_to(x + w, y + h - br);
  if (br) g.arc(x + w - br, y + h - br, br, 0, P / 2);
  g.line_to(x + bl, y + h);
  if (bl) g.arc(x + bl, y + h - bl, bl, P / 2, P);
  g.line_to(x, y + tl);
  if (tl) g.arc(x + tl, y + tl, tl, P, 1.5 * P);
  g.close_path();
}
// Concave corners where a tongue (y0..y1) meets a vertical edge at x, 1 px into both so no seam shows.
function fillets(x, y0, y1, top, bottom, r) {
  const g = mgraphics, P = Math.PI;
  if (top) { g.move_to(x + 1, y0 - r); g.line_to(x + 1, y0 + 1); g.line_to(x - r, y0 + 1); g.line_to(x - r, y0); g.arc_negative(x - r, y0 - r, r, P / 2, 0); g.close_path(); }
  if (bottom) { g.move_to(x - r, y1 - 1); g.line_to(x + 1, y1 - 1); g.line_to(x + 1, y1 + r); g.line_to(x, y1 + r); g.arc_negative(x - r, y1 + r, r, 0, -P / 2); g.close_path(); }
}
// A tongue from x0 to edge (plus overlap into the shape behind it); snaps to the edge's top/bottom when too close for a fillet.
// round: rounded left end (false = it comes out from under a panel); r: the fillet radius (smaller in a narrow gap).
function tongue(x0, edge, y0, y1, top, bottom, round = true, r = FILLET) {
  const snapTop = y0 - r < top + R, snapBot = y1 + r > bottom - R;
  if (snapTop) y0 = top;
  if (snapBot) y1 = bottom;
  const c = round ? R : 0;
  rr(x0, y0, edge + 8 - x0, y1 - y0, [c, 0, 0, c]);
  fillets(edge, y0, y1, !snapTop, !snapBot, r);
}

function parse() {
  if (!sh) return null;
  const [mode, bodyX, fy0, fy1, iy0, iy1, n] = sh, rows = [], subs = [];
  for (let i = 0; i < n; i++) {
    const o = 7 + 7 * i;
    rows.push({ open: sh[o], x: sh[o + 1], y: sh[o + 2], h: sh[o + 3], target: sh[o + 4], c: sh[o + 5], dim: sh[o + 6] });
  }
  const v = 7 + 7 * n;
  for (let i = 0; i < sh[v]; i++) subs.push({ x: sh[v + 1 + 2 * i], w: sh[v + 2 + 2 * i] });
  return { mode, bodyX, fy0, fy1, iy0, iy1, rows, subs };
}

// The divider: x 0..2, from y 8 to the foot, where five 4 px stripes of the rainbow finish it.
function divider(h) {
  const g = mgraphics, top = 8, foot = h - 8, band = 4, x = 0, w = 2;
  const rainTop = foot - band * RAINBOW.length;
  rr(x, top, w, rainTop - top, [1, 1, 0, 0]); g.set_source_rgba(DIVIDER); g.fill();
  RAINBOW.forEach((c, i) => { rr(x, rainTop + i * band, w, band, i === RAINBOW.length - 1 ? [0, 0, 1, 1] : [0, 0, 0, 0]); g.set_source_rgba(c); g.fill(); });
}
// Dashes along a straight line (3 on, 2 off).
function dashLine(x0, y0, x1, y1) {
  const g = mgraphics, L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / (L || 1), uy = (y1 - y0) / (L || 1);
  for (let d = 0; d < L; d += 5) { const e = Math.min(L, d + 3); g.move_to(x0 + ux * d, y0 + uy * d); g.line_to(x0 + ux * e, y0 + uy * e); }
  g.stroke();
}
function dashRect(x, y, w, h) { dashLine(x, y, x + w, y); dashLine(x + w, y, x + w, y + h); dashLine(x + w, y + h, x, y + h); dashLine(x, y + h, x, y); }
function paintColour(s, w, h, withDivider) {
  const g = mgraphics, hy0 = s.iy0 - 3, hy1 = s.iy1 + 3;
  if (withDivider) divider(h);
  const halo = s.subs.map((b) => [b.x - 3, b.x + b.w + 3]);              // [left, right] of each visible panel's halo
  for (let i = s.rows.length - 1; i >= 0; i--) {                      // the first row on top
    const r = s.rows[i], t = r.target;
    if (!r.open || !(t >= 0 && t < halo.length)) continue;
    const [hl, hr] = halo[t], y0 = r.y - 2, y1 = r.y + r.h + 2;
    rr(hl, hy0, hr - hl, hy1 - hy0, [R, R, R, R]);                      // the halo
    if (t === 0) tongue(r.x, hl, y0, y1, hy0, hy1);
    else {
      rr(r.x, y0, halo[0][0] - r.x, y1 - y0, [R, 0, 0, R]);             // up to the first panel, then under it
      for (let k = 1; k < t; k++) rr(halo[k - 1][1], y0, halo[k][0] - halo[k - 1][1], y1 - y0, [0, 0, 0, 0]);   // the gaps on the way
      const from = halo[t - 1][1];
      tongue(from, hl, y0, y1, hy0, hy1, false, Math.max(1, Math.min(FILLET, hl - from - 1)));
    }
    const col = COLOURS[r.c >= 0 ? r.c : i % 3];
    if (!r.dim) { g.set_source_rgba(col); g.fill(); continue; }
    // dim (the table is off): a faint fill, and a dashed outline round the halo and the tongue
    g.set_source_rgba(col[0], col[1], col[2], col[3] * 0.3); g.fill();
    g.set_source_rgba(col[0], col[1], col[2], 0.85); g.set_line_width(1);
    dashRect(hl + 0.5, hy0 + 0.5, hr - hl - 1, hy1 - hy0 - 1);
    const runs = [[r.x, t === 0 ? hl : halo[0][0]]];                  // the visible parts of the tongue: the column, then each gap
    for (let k = 1; k <= t; k++) runs.push([halo[k - 1][1], halo[k][0]]);
    for (const [a0, a1] of runs) { dashLine(a0, y0 + 0.5, a1, y0 + 0.5); dashLine(a0, y1 - 0.5, a1, y1 - 0.5); }
    dashLine(r.x + 0.5, y0, r.x + 0.5, y1);
  }
}

function paint() {
  const s = parse();
  if (!s) return;
  const w = mgraphics.size[0], h = mgraphics.size[1];
  if (s.mode === 1 || s.mode === 2) paintColour(s, w, h, s.mode === 1);   // 2: no divider (the overview, first)
}
function shape() { sh = arrayfromargs(arguments).map(Number); sidlog("voicebg", "shape", sh.slice(0, 7).join(" "), "open", (parse().rows.map((r) => r.open).join(""))); mgraphics.redraw(); }
function onresize() { mgraphics.redraw(); }

paint = sidguard("voicebg", paint); shape = sidguard("voicebg", shape);
sidlog("voicebg", "loaded");
