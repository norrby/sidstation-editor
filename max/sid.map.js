// sid.map.js – v8ui: overview after the SID datasheet's block diagram. Three voices one below the other:
// [Osc n] -> [Env] -> switch -> [Filter] or straight to the output (bypass). Sync/ring
// arrows between the oscillators (1 -> 2, 2 -> 3 in the gaps, 3 -> 1 around the left edge);
// outer/left track = sync (blue), inner/right = ring (orange). The arrows are the controls for
// the TARGET's Sync/Ring. A click on Osc expands/collapses that oscillator's panel (zero to three can
// be shown), a click on Env expands/collapses that oscillator's envelope panel (same parameter as
// the env fold button in the column), the switch toggles filter/out. Osc 3's switch has a third position, off (3OFF, as in the
// datasheet's block diagram: voice 3's direct path can be cut; it still runs and can sync/ring osc 1): a click steps filter -> out -> off.
// In:  set show <n> <v>  set env <n> <v>  set sync <n> <v>  set ring <n> <v>  set route <n> <v>  set off3 3 <v>   (silent)
//      set ringok <n> <v>   ring can act on osc n (waveform Tri/Mixed); otherwise dimmed and inert
//      set active <n> <v>   set poly <v>   a voice not heard (Active off, or osc 2/3 in Poly) is drawn in grey
//      bang   output everything
// Out: "show <n> <v>", "env <n> <v>", "sync <n> <v>", "ring <n> <v>", "route <n> <v>", "off3 <v>"

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;   // 0: the switches, 1: "tip …" to the tooltip layer (sid.tip.js)

// The filter box spans all three rows so that osc 3's switch also points into the filter and not at
// the Env box below it (otherwise the switch at osc 3 pointed at env when thrown towards the filter).
// The filter envelope's Env box sits above the filter with the arrow pointing down (mirrored compared to before), so that the diagram
// could move down 28 px with unchanged rows/arrows and the name display fit top left.
// The filter is longer downwards, Osc 1/Env 1 lowered so their top is level with the filter's top; the rows
// spread evenly (40 px) and the out bus runs just below the filter's foot. The filter's Env box as tall as the name display beside
// it was too heavy next to the dot letters, 18 px too small: now as tall as the diagram's other boxes (22 px),
// centred on the name display (NAME_RECT y 7..33 here), as wide as the filter. The filter moved right (and 4 px narrower, "out"
// must fit) to give the switches' wires room.
const G = { rows: [51, 91, 131], boxH: 22, osc: [26, 66], env: [76, 110], pivot: 122, bus: 153, filt: [166, 200], filtY: [40, 150], fenv: [166, 200], fenvY: 20, fenvH: 22, outY: 155,
  laneSync: 40, laneRing: 52, wrapSync: 8, wrapRing: 16 };
// boxFill: unlit boxes are filled dark like Live's unlit buttons, not hollow.
const C = { box: [1, 1, 1, 0.35], boxFill: [0.07, 0.07, 0.07, 0.6], boxOn: UI.lit, text: [1, 1, 1, 0.8], textOn: UI.dark, off: [1, 1, 1, 0.25],
  sync: UI.line, ring: UI.lit, wire: [1, 1, 1, 0.55], wireOn: UI.line, envOff: [1, 1, 1, 0.15] };
const show = [1, 0, 0], env = [1, 1, 1];
const sync = [0, 0, 0], ring = [0, 0, 0], route = [1, 1, 1], ringok = [1, 1, 1], active = [1, 1, 1];
let poly = 0, off3 = 0;
// Osc 3's switch position: through the filter, direct out, or off (3OFF only acts on the direct path, so filter wins).
const pos3 = () => (route[2] ? "filter" : off3 ? "off" : "out");
// A voice that is not heard is drawn in grey: Active off, or osc 2/3 in Poly (Poly plays osc 1 on all three voices and ignores
// Active, so osc 1 always counts as heard), consistently wherever it is inactive. The boxes still click; the sync/ring lanes keep their colours.
const silent = (i) => (poly ? i > 0 : !active[i] || (i === 2 && off3 && !route[2]));   // osc 3 Mod only (3OFF) is not heard either
let greyNow = false;
function ink(c) {
  if (!greyNow) { mgraphics.set_source_rgba(c); return; }
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], v = 0.3 + (l - 0.3) * 0.5;
  mgraphics.set_source_rgba(v, v, v, c[3] * 0.6);
}
let filterShow = 1;   // filter panel expanded (a click on the Filter box toggles)
let filterEnv = 1;    // filter envelope expanded (the Env box by the filter toggles it in the diagram)
const born = Date.now();   // see sid.fold.js: clicks during loading are ignored

function drawBox(x0, x1, y, text, on, dim, h = G.boxH) {   // NB: not 'box' – that is Max's own global object
  if (!on) { ink(C.boxFill); mgraphics.rectangle(x0, y - h / 2, x1 - x0, h); mgraphics.fill(); }   // dark like an unlit live.text
  ink(dim ? C.envOff : on ? C.boxOn : C.box);
  mgraphics.rectangle(x0, y - h / 2, x1 - x0, h);
  if (on) mgraphics.fill(); else { mgraphics.set_line_width(1.2); mgraphics.stroke(); }
  ink(on ? C.textOn : dim ? C.envOff : C.text);
  const tw = measure(text);
  mgraphics.move_to((x0 + x1) / 2 - tw / 2, y + 3.5);
  mgraphics.show_text(text);
}
function measure(t) { try { return mgraphics.text_measure(t)[0]; } catch (e) { return t.length * 5; } }
function head(x, y, dx, dy) {   // arrowhead at (x,y) with direction (dx,dy)
  const px = -dy * 0.6, py = dx * 0.6;
  mgraphics.move_to(x - dx * 5 + px * 5, y - dy * 5 + py * 5); mgraphics.line_to(x, y); mgraphics.line_to(x - dx * 5 - px * 5, y - dy * 5 - py * 5); mgraphics.stroke();
}
// The filter/out switch as a schematic changeover switch (a wire hopping over and a contact on
// a bending leaf): two fixed contacts, a leaf of fixed length that bends slightly and rests on the chosen one; the wire to the filter hops
// over the out bus, the bypass contact has a stub up to the bus (junction dot). The live path is lit (blue into the filter).
const SW = { cf: 15, cbx: 12, cby: 9, hop: 3 };
function drawSwitch(y, on, three, off) {
  const g = mgraphics, px = G.pivot, cf = [px + SW.cf, y], cb = [px + SW.cbx, y - SW.cby], co = [px + SW.cbx, y + SW.cby];
  const live = on ? C.wireOn : C.wire;
  if (off) on = false;
  // to the filter: hop over the bus, arrow into the filter
  ink(on ? live : C.off); g.set_line_width(on ? 1.5 : 1);
  g.move_to(cf[0] + 2, y); g.line_to(G.bus - SW.hop, y); g.arc(G.bus, y, SW.hop, Math.PI, 2 * Math.PI); g.line_to(G.filt[0], y); g.stroke();
  head(G.filt[0], y, 1, 0);
  // to the out bus
  ink(on || off ? C.off : live); g.set_line_width(on || off ? 1 : 1.5);
  g.move_to(cb[0] + 2, cb[1]); g.line_to(G.bus, cb[1]); g.stroke();
  g.ellipse(G.bus - 1.5, cb[1] - 1.5, 3, 3); g.fill();
  // the contacts (open rings) and the leaf with its contact point
  g.set_line_width(1);
  const contacts = [[cf, on], [cb, !on && !off]];
  if (three) {                                                              // the off contact: a stub to ground (3OFF)
    contacts.push([co, off]);
    ink(off ? live : C.off); g.set_line_width(1);
    const gx = co[0] + 9;
    g.move_to(co[0] + 2, co[1]); g.line_to(gx, co[1]); g.line_to(gx, co[1] + 3); g.stroke();
    for (const [w, dy] of [[5, 3], [3.4, 5], [1.8, 7]]) { g.move_to(gx - w, co[1] + dy); g.line_to(gx + w, co[1] + dy); g.stroke(); }
  }
  for (const [c, lit] of contacts) { ink(lit ? live : C.off); g.ellipse(c[0] - 2, c[1] - 2, 4, 4); g.stroke(); }
  const t = off ? co : on ? cf : cb, dx = t[0] - px, dy = t[1] - y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  ink(live); g.set_line_width(1.6);
  g.move_to(px, y); g.curve_to(px + dx * 0.35 + nx * 1.5, y + dy * 0.35 + ny * 1.5, px + dx * 0.7 + nx * 1.5, y + dy * 0.7 + ny * 1.5, t[0], t[1]); g.stroke();   // the leaf, slightly bent
  g.ellipse(px - 2, y - 2, 4, 4); g.fill();                                // the pivot
  g.ellipse(t[0] - 1.6, t[1] - 1.6, 3.2, 3.2); g.fill();                   // the contact point on the leaf
}
function lane(on, col, ok) { ink(ok === false ? C.envOff : on ? col : C.off); mgraphics.set_line_width(on && ok !== false ? 2 : 1); }

function paint() {
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(9);
  // filter, bussar, out
  if (!filterShow) { ink(C.boxFill); mgraphics.rectangle(G.filt[0], G.filtY[0], G.filt[1] - G.filt[0], G.filtY[1] - G.filtY[0]); mgraphics.fill(); }
  ink(filterShow ? C.boxOn : C.box); mgraphics.set_line_width(1.2);
  mgraphics.rectangle(G.filt[0], G.filtY[0], G.filt[1] - G.filt[0], G.filtY[1] - G.filtY[0]);
  if (filterShow) mgraphics.fill(); else mgraphics.stroke();
  ink(filterShow ? C.textOn : C.text);
  const ft = "Filter", fw = measure(ft);
  mgraphics.move_to((G.filt[0] + G.filt[1]) / 2 - fw / 2, (G.filtY[0] + G.filtY[1]) / 2 + 3); mgraphics.show_text(ft);
  ink(C.wire); mgraphics.set_line_width(1);
  mgraphics.move_to(G.bus, G.rows[0] - SW.cby); mgraphics.line_to(G.bus, G.outY); mgraphics.line_to(G.filt[1] + 4, G.outY); mgraphics.stroke();     // direct bus -> out
  mgraphics.move_to(G.filt[1] - 4, G.filtY[1]); mgraphics.line_to(G.filt[1] - 4, G.outY); mgraphics.stroke();                                  // filter -> out
  // the filter envelope: Env box above the filter with a short arrow down into it (modulates cutoff, not in the signal path)
  drawBox(G.fenv[0], G.fenv[1], G.fenvY, "Env", filterEnv === 1, false, G.fenvH);
  const fx = (G.fenv[0] + G.fenv[1]) / 2;
  ink(C.wire); mgraphics.move_to(fx, G.fenvY + G.fenvH / 2); mgraphics.line_to(fx, G.filtY[0] - 1); mgraphics.stroke(); head(fx, G.filtY[0] - 1, 0, 1);
  ink(C.text); mgraphics.move_to(G.filt[1] + 7, G.outY + 3); mgraphics.show_text("out");
  for (let i = 0; i < 3; i++) {
    const y = G.rows[i];
    greyNow = silent(i);
    drawBox(G.osc[0], G.osc[1], y, "Osc " + (i + 1), show[i] === 1, false);
    ink(C.wire); mgraphics.set_line_width(1);
    mgraphics.move_to(G.osc[1], y); mgraphics.line_to(G.env[0], y); mgraphics.stroke();
    drawBox(G.env[0], G.env[1], y, "Env", env[i] === 1, false);            // filled (like Osc) when the envelope panel is expanded
    ink(C.wire); mgraphics.set_line_width(1);        // (drawBox leaves the text colour set)
    mgraphics.move_to(G.env[1], y); mgraphics.line_to(G.pivot, y); mgraphics.stroke();
    if (i === 2) drawSwitch(y, pos3() === "filter", true, pos3() === "off");
    else drawSwitch(y, route[i] === 1);
    greyNow = false;
    // arrows to the next osc (target = i+1)
    if (i < 2) {
      const y0 = y + G.boxH / 2, y1 = G.rows[i + 1] - G.boxH / 2;
      lane(sync[i + 1], C.sync); mgraphics.move_to(G.laneSync, y0); mgraphics.line_to(G.laneSync, y1); mgraphics.stroke(); head(G.laneSync, y1, 0, 1);
      lane(ring[i + 1], C.ring, ringok[i + 1] === 1); mgraphics.move_to(G.laneRing, y0); mgraphics.line_to(G.laneRing, y1); mgraphics.stroke(); head(G.laneRing, y1, 0, 1);
    }
  }
  // 3 -> 1 around the left edge (target = osc 1)
  const yA = G.rows[2], yB = G.rows[0];
  lane(sync[0], C.sync); mgraphics.move_to(G.osc[0], yA - 3); mgraphics.line_to(G.wrapSync, yA - 3); mgraphics.line_to(G.wrapSync, yB - 3); mgraphics.line_to(G.osc[0], yB - 3); mgraphics.stroke(); head(G.osc[0], yB - 3, 1, 0);
  lane(ring[0], C.ring, ringok[0] === 1); mgraphics.move_to(G.osc[0], yA + 3); mgraphics.line_to(G.wrapRing, yA + 3); mgraphics.line_to(G.wrapRing, yB + 3); mgraphics.line_to(G.osc[0], yB + 3); mgraphics.stroke(); head(G.osc[0], yB + 3, 1, 0);
}

// Own tooltip (v8ui has none): shown when the mouse rests over a disabled ring arrow. Drawn by the tooltip layer in front of
// the overview (sid.tip.js, outlet 1), so the patch name display, which lies in front of this box, never hides it.
let tip = null;   // { x, y, lines: [...] }
// The Store notice: after Push patch the gateway says "storable 1" (build-station.js), and the tooltip layer shows for a few seconds,
// down by the Store button, that the sound can now be saved on the synth. "storable 0" (any change) only greys the button.
let notice = null, noticeTask = null;
function storable(v) {
  if (noticeTask) { noticeTask.cancel(); noticeTask = null; }
  notice = v ? { x: -6, y: 166, lines: ["Store patch saves this sound", "to the synth's patch number"] } : null;
  if (notice) { noticeTask = new Task(() => { notice = null; noticeTask = null; showTip(); }); noticeTask.schedule(5000); }
  showTip();
}
function showTip() { const t = tip || notice; if (t) outlet(1, "tip", t.x, t.y, ...t.lines); else outlet(1, "tip"); }
// What is under the mouse, including things that cannot be clicked? -> text or null
function hoverText(x, y) {
  for (let i = 0; i < 3; i++) {
    const ry = G.rows[i];
    if (i < 2 && y > ry + G.boxH / 2 && y < G.rows[i + 1] - G.boxH / 2 && Math.abs(x - G.laneRing) <= 6 && !ringok[i + 1]) return ringTip(i + 2, i + 1);
  }
  if (x <= G.osc[0] - 3 && y >= G.rows[0] - 8 && y <= G.rows[2] + 8 && x >= (G.wrapSync + G.wrapRing) / 2 && !ringok[0]) return ringTip(1, 3);
  return null;
}
function ringTip(target, source) { return ["Ring " + source + " -> " + target + " has no effect:", "ring modulation only affects the", "triangle wave. Set osc " + target + " to Tri or Mixed."]; }
function onidle(x, y) {
  const lines = hoverText(x, y);
  const next = lines ? { x, y, lines } : null;
  if (!!next !== !!tip) { tip = next; showTip(); }
  else if (next && (next.x !== tip.x || next.y !== tip.y)) { tip = next; showTip(); }
}
function onidleout() { if (tip) { tip = null; showTip(); } }
// The hovering as the tooltip layer in front passes it on
function idle(x, y) { onidle(x, y); }
function idleout() { onidleout(); }

// What does the click hit?
function hit(x, y) {
  for (let i = 0; i < 3; i++) {
    const ry = G.rows[i];
    if (i === 2 && x >= G.pivot - 10 && x <= G.filt[0] && Math.abs(y - ry) <= SW.cby + 6) return { route: i };   // reaches the ground symbol
    if (Math.abs(y - ry) <= G.boxH / 2 + 2) {
      if (x >= G.osc[0] - 2 && x <= G.osc[1] + 2) return { show: i };
      if (x >= G.env[0] - 2 && x <= G.env[1] + 2) return { env: i };                   // expand/collapse the envelope panel
      if (x >= G.pivot - 10 && x <= G.filt[0]) return { route: i };
    }
    if (i < 2 && y > ry + G.boxH / 2 && y < G.rows[i + 1] - G.boxH / 2) {
      if (Math.abs(x - G.laneSync) <= 5) return { sync: i + 1 };
      if (Math.abs(x - G.laneRing) <= 5) return ringok[i + 1] ? { ring: i + 1 } : null;
    }
  }
  if (x <= G.osc[0] - 3 && y >= G.rows[0] - 8 && y <= G.rows[2] + 8) return x < (G.wrapSync + G.wrapRing) / 2 ? { sync: 0 } : ringok[0] ? { ring: 0 } : null;
  if (x >= G.filt[0] && x <= G.filt[1] && y >= G.filtY[0] && y <= G.filtY[1]) return { filter: true };
  if (x >= G.fenv[0] - 2 && x <= G.fenv[1] + 2 && Math.abs(y - G.fenvY) <= G.fenvH / 2 + 2) return { fenv: true };
  return null;
}
function onclick(x, y) {
  if (Date.now() - born < 1000) { sidlog("map", "click ignored (just loaded)"); return; }
  const h = hit(x, y);
  if (!h) return;
  if (h.filter) { filterShow = filterShow ? 0 : 1; outlet(0, "filter", filterShow); }
  else if (h.fenv) { filterEnv = filterEnv ? 0 : 1; outlet(0, "fenv", filterEnv); }
  else if (h.show !== undefined) { show[h.show] = show[h.show] ? 0 : 1; outlet(0, "show", h.show + 1, show[h.show]); }
  else if (h.env !== undefined) { env[h.env] = env[h.env] ? 0 : 1; outlet(0, "env", h.env + 1, env[h.env]); }
  else if (h.route === 2) {                                                 // osc 3: each click steps filter -> out -> off -> filter
    const p = { filter: "out", out: "off", off: "filter" }[pos3()];       // (a toggle like the others, not aiming at a contact)
    route[2] = p === "filter" ? 1 : 0; off3 = p === "off" ? 1 : 0;
    outlet(0, "route", 3, route[2]); outlet(0, "off3", off3);
  }
  else if (h.route !== undefined) { route[h.route] = route[h.route] ? 0 : 1; outlet(0, "route", h.route + 1, route[h.route]); }
  else if (h.sync !== undefined) { sync[h.sync] = sync[h.sync] ? 0 : 1; outlet(0, "sync", h.sync + 1, sync[h.sync]); }
  else if (h.ring !== undefined) { ring[h.ring] = ring[h.ring] ? 0 : 1; outlet(0, "ring", h.ring + 1, ring[h.ring]); }
  mgraphics.redraw();
}
function set() {
  const a = arrayfromargs(arguments);
  const n = a[1] | 0;
  const arrs = { show, env, sync, ring, route, ringok, active };
  if (a[0] === "poly") poly = a[1] ? 1 : 0;
  else if (a[0] === "filter") filterShow = a[1] ? 1 : 0;
  else if (a[0] === "fenv") filterEnv = a[1] ? 1 : 0;
  else if (a[0] === "off3" && a[2] && !off3 && route[2]) {
    // Osc 3's Off button pressed while it goes through the filter: 3OFF only cuts the direct path, so take it off the filter too
    // (the overview's step filter -> out -> off in one press).
    off3 = 1; route[2] = 0; outlet(0, "route", 3, 0);
  }
  else if (a[0] === "off3") off3 = a[2] ? 1 : 0;
  else if (a[0] === "route" && n === 3 && a[2] && !route[2] && off3) {
    // Osc 3's Filter button turned the filter on while 3OFF was set: clear 3OFF (it has no effect through the filter), so the next
    // press gives out like on osc 1/2 instead of off. Off is reached from the overview.
    route[2] = 1; off3 = 0; outlet(0, "off3", 0);
  }
  else if (arrs[a[0]] && n >= 1 && n <= 3) arrs[a[0]][n - 1] = a[2] ? 1 : 0;
  mgraphics.redraw();
}
function bang() {
  sidlog("map", "bang");
  outlet(0, "filter", filterShow); outlet(0, "fenv", filterEnv);
  for (let n = 1; n <= 3; n++) { outlet(0, "show", n, show[n - 1]); outlet(0, "env", n, env[n - 1]); outlet(0, "sync", n, sync[n - 1]); outlet(0, "ring", n, ring[n - 1]); outlet(0, "route", n, route[n - 1]); }
  outlet(0, "off3", off3);
}
function onresize() { mgraphics.redraw(); }
function anything() { post("sid.map: unknown message " + messagename + "\n"); }

paint = sidguard("map", paint); onclick = sidguard("map", onclick); set = sidguard("map", set); onidle = sidguard("map", onidle); storable = sidguard("map", storable);
sidlog("map", "loaded");
