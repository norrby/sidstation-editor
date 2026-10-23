// build-station.js – dist/SidStation.amxd, the editor: [overview after the SID datasheet (sid.map.js): three voices
//   Osc -> Env -> switch -> Filter/out, sync/ring arrows, the patch name and the patch column] [voice 1..3: a column (number,
//   fold buttons osc/env/tbl, Active/Sync/Ring/Filter) and three sub-panels: oscillator (Waveform + Tone), Envelope, Table]
//   [filter + filter envelope] [LFO 1–4, one at a time]. Every voice's width follows what is expanded.
// Panels in Live's style (light filled area, no outlines); sub-panels slightly darker. npm run build.
//
// Every x is derived from PAD/GAP. At runtime all presentation rects are owned by [v8 sid.layout.js SidStation] (lib/layout.js),
// which hides the pulse group, collapses panels and sets the device width (setwidth).
//
// Every Live parameter is a live.* object (automation, storage, mapping). The widgets (ADSR, pulse, note picker, table …)
// are paired with live.* objects: widget -> "attack 5" -> route -> live.*; live.* -> "set attack 5" -> widget (silent) and
// -> "attack 5" -> the router (v8) -> CC/DP.
// One track: [midiin] -> the capture (sid.capture.js) and the osc 1 router (notes pass, SysEx is dropped); every
// router's frames and the notes -> the gateway (sid.send.js: validation, whitelist, one queue, store lock) -> [midiout].
const fs = require("fs");
const { writeIfChanged, copyIfChanged } = require("./write");
const path = require("path");
const A = require("./amxd");
const L = require("../lib/layout");
const H = require("../lib/help");

const OUT_DIR = process.env.SID_OUT || path.join(__dirname, "..", "dist");   // SID_OUT: build elsewhere (to compare without touching Live)

const { PAD, GAP, VOICE_GAP, COL_PW, live, v8ui, plain } = require("./station/common");
const { OSC_W, ENV_W, TABLE_W, SHIFT, oscPanel } = require("./station/voice");
const { FVOICE_W, filterPanel } = require("./station/filter");
const { LVOICE_W, lfoPanel } = require("./station/lfo");
const { MAP_TOTAL, mapPanel } = require("./station/overview");

// The device: the overview, voices 1–3, the filter, LFO 1–4, and the one-track plumbing (gateway, capture).
const OSCS = [1, 2, 3];
function buildDevice(title) {
  const json = A.midiEffectSkeleton(title, 100);
  const p = json.patcher;
  p.devicewidth = 0;                                   // the width is set by the layout engine (setwidth)
  const boxes = [], lines = [];
  let nid = 100;
  const id = () => "obj-" + nid++;

  const vMidiin = id(), vMidiout = id(), vLoad = id(), vLayout = id(), vThis = id(), vWDefer = id(), vThisDev = id(), vDelay = id(), vArm = id(), vKick = id();
  const vFilter = id(), vLfo = id();
  const ctx = { id, boxes, lines, vLayout, vLoad, vFilter, vLfo, vThis, armTargets: [vFilter, vLfo] };
  boxes.push(A.obj(vFilter, "v8 sid.filter.js", [1500, 420, 100, 20], 2, ["", ""], { varname: "f_router" }),
    A.obj(vLfo, "v8 sid.lfo.js", [1500, 460, 100, 20], 2, ["", ""], { varname: "l_router" }));
  // Patch dump in: the built-in capture (below) -> deferlow (main thread) -> sid.load.js -> thispatcher ("script send <varname> <v>").
  // The routers get "quiet" first, so none of it is echoed to the synth.
  const vRxDefer = id(), vLoader = id();
  boxes.push(A.obj(vRxDefer, "deferlow", [700, 330, 60, 20]), A.obj(vLoader, "v8 sid.load.js 1 2 3 f l", [700, 360, 140, 20]));
  lines.push(A.line(vRxDefer, 0, vLoader, 0), A.line(vLoader, 0, vThis, 0));
  boxes.push(
    A.obj(vMidiin, "midiin", [30, 30, 50, 20], 1, ["int"]),
    A.obj(vMidiout, "midiout", [30, 460, 50, 20], 0, []),
    A.obj(vLoad, "loadbang", [900, 30, 55, 20], 1, ["bang"]),
    A.obj(vLayout, "v8 sid.layout.js " + title, [900, 400, 160, 20], 2, ["", ""]),
    A.obj(vThis, "thispatcher", [900, 440, 70, 20], 2, ["", ""]),
    A.obj(vWDefer, "deferlow", [1000, 440, 60, 20], 1, [""]),
    // NOTE: live.thisdevice is not a UI object – it must be saved as a newobj with text
    A.obj(vThisDev, "live.thisdevice", [1100, 440, 90, 20], 3, ["bang", "int", "int"]),
    A.obj(vDelay, "delay 300", [1100, 300, 70, 20], 1, ["bang"]),
    A.msg(vArm, "arm", [1100, 330, 40, 20]),
    A.msg(vKick, "bang", [1180, 330, 40, 20]),
    A.comment(id(), "Incoming notes pass through v8 (osc 1; SysEx is dropped). live.* -> prepend -> v8 -> CC/DP to the built-in gateway (sid.send.js) -> midiout. sid.layout.js owns the presentation.", [100, 30, 320, 48], null, { linecount: 3 }),
  );
  lines.push(A.line(vLayout, 0, vThis, 0), A.line(vLayout, 1, vWDefer, 0), A.line(vWDefer, 0, vThisDev, 0),
    A.line(vThisDev, 0, vDelay, 0), A.line(vDelay, 0, vArm, 0), A.line(vDelay, 0, vKick, 0), A.line(vKick, 0, vLayout, 0));

  // panels in a row; x0 = position in the full layout
  const panels = [];
  let x0 = 0;
  const oscs = {};
  x0 += MAP_TOTAL + GAP;
  for (const n of OSCS) {
    const o = oscPanel(n, x0, ctx);
    oscs[n] = o;
    panels.push({ id: "v" + n, kind: "voice", colW: COL_PW, gap: VOICE_GAP, pad: PAD, items: o.colItems, sub: [
      { id: "o" + n, kind: "osc", fullW: OSC_W, compactW: OSC_W - SHIFT, shift: SHIFT, items: o.items },
      { id: "e" + n, kind: "env", owner: "o" + n, width: ENV_W, items: o.envItems },
      { id: "t" + n, kind: "table", owner: "o" + n, width: TABLE_W, items: o.tableItems }] });
    x0 += COL_PW + VOICE_GAP + OSC_W + VOICE_GAP + ENV_W + VOICE_GAP + TABLE_W + PAD + GAP;
  }
  // note on/off from the router that sees the track's notes -> every table playhead (all three voices start at a note, single mode)
  {
    const vNote = id(), vNotePre = id();
    boxes.push(A.obj(vNote, "route note", [30, 520, 70, 20], 2, ["", ""]), A.obj(vNotePre, "prepend note", [30, 545, 80, 20]));
    lines.push(A.line(oscs[1].vV8, 1, vNote, 0), A.line(vNote, 0, vNotePre, 0));
    for (const n of OSCS) lines.push(A.line(vNotePre, 0, oscs[n].tableId, 0));
  }
  const fp = filterPanel(x0, ctx); panels.push(fp.panel); x0 += FVOICE_W + GAP;
  panels.push(lfoPanel(x0, ctx)); x0 += LVOICE_W + GAP;
  panels.unshift(mapPanel(0, oscs, OSCS, fp.showId, fp.envShowId, ctx));
  {                                                        // Poly ignores Active: the buttons are greyed like Ring without Tri/Mixed
    const vNot = id(), vAct = id();
    boxes.push(A.obj(vNot, "== 0", [3400, 2400, 40, 20]), A.obj(vAct, "prepend active", [3400, 2430, 90, 20]));
    lines.push(A.line(ctx.polyId, 0, vNot, 0), A.line(vNot, 0, vAct, 0));
    for (const n of OSCS) lines.push(A.line(vAct, 0, oscs[n].activeId, 0));
    if (oscs[3] && oscs[3].activeBtnId) lines.push(A.line(vAct, 0, oscs[3].activeBtnId, 0));                   // greyed in Poly too
  }
  {                                                        // any Porta > 0 -> the layout's glide flag (Legato greyed without it)
    const vPak = id(), vExpr = id(), vChg = id(), vPre = id();
    boxes.push(A.obj(vPak, "pak 0 0 0", [3700, 2500, 70, 20], 1, [""], { numinlets: 3 }), A.obj(vExpr, "expr ($i1 != 0) || ($i2 != 0) || ($i3 != 0)", [3700, 2530, 230, 20]),
      A.obj(vChg, "change -1", [3700, 2560, 60, 20]), A.obj(vPre, "prepend glide", [3700, 2590, 80, 20]));
    OSCS.forEach((n, i) => lines.push(A.line(oscs[n].portaId, 0, vPak, i)));
    lines.push(A.line(vPak, 0, vExpr, 0), A.line(vExpr, 0, vChg, 0), A.line(vChg, 0, vPre, 0), A.line(vPre, 0, vLayout, 0));
  }
  if (oscs[3] && oscs[3].activeBtnId && ctx.off3Id) {                     // osc 3: Active / Mod only (3OFF) / off in one button
    const b = oscs[3].activeBtnId, vR = id(), vSa = id(), vSo = id();
    boxes.push(A.obj(vR, "route active off3", [3700, 2400, 110, 20], 3, ["", "", ""]),
      A.obj(vSa, "prepend set active", [3700, 2430, 110, 20]), A.obj(vSo, "prepend set off3", [3820, 2430, 100, 20]));
    lines.push(A.line(b, 0, vR, 0), A.line(vR, 0, oscs[3].activeId, 0), A.line(vR, 1, ctx.off3Id, 0),
      A.line(oscs[3].activeId, 0, vSa, 0), A.line(vSa, 0, b, 0), A.line(ctx.off3Id, 0, vSo, 0), A.line(vSo, 0, b, 0));
  }
  {
    const vLay = id(), vMapPoly = id();                                    // the layout swaps osc 1's Active for its stand-in; the overview greys silent voices
    boxes.push(A.obj(vLay, "prepend poly", [3500, 2400, 80, 20]), A.obj(vMapPoly, "prepend set poly", [3500, 2430, 100, 20]));
    lines.push(A.line(ctx.polyId, 0, vLay, 0), A.line(vLay, 0, vLayout, 0), A.line(ctx.polyId, 0, vMapPoly, 0), A.line(vMapPoly, 0, ctx.mapId, 0));
    for (const n of OSCS) {
      const vA = id();
      boxes.push(A.obj(vA, "prepend set active " + n, [3600, 2400 + n * 30, 120, 20]));
      lines.push(A.line(oscs[n].activeId, 0, vA, 0), A.line(vA, 0, ctx.mapId, 0));
    }
  }
  {                                                                        // "Push patch" in the Patch panel -> all routers
    const vAll = ctx.sendAllId;
    for (const n of OSCS) lines.push(A.line(vAll, 0, oscs[n].vV8, 0));
    lines.push(A.line(vAll, 0, vFilter, 0), A.line(vAll, 0, vLfo, 0));
  }
  lines.push(A.line(vMidiin, 0, oscs[1].vV8, 0));
  // To the synth. The routers send "frame <bytes…>" on an outlet of their own (osc: 2, filter/LFO: 1).
  const routers = OSCS.map((n) => [oscs[n].vV8, 2]).concat([[vFilter, 1], [vLfo, 1]]);
  {
    // One track, with the same protection as separate devices would give: the gateway and the capture (formerly the SidSend and SidCapture devices) are built in. Everything to the synth – the routers' frames and the
    // track's notes – goes through the gateway (validation, whitelist, one queue, store lock) and out of the device's own
    // [midiout] (on to External Instrument). The track's input goes to the capture (dumps saved, patches/replies to the loader
    // and the gateway, nothing global) and to the osc 1 router, which passes notes and drops SysEx (the echo rule).
    const vGate = id(), vCap = id(), vStored = id(), vStoredPre = id(), vCapRoute = id(), vRepliedPre = id(), vGateRoute = id(), vNoReplyPre = id(), vAnsweredPre = id();
    boxes.push(A.obj(vGate, "v8 sid.send.js", [30, 500, 100, 20], 2, ["", ""], { varname: "gateway" }),
      A.obj(vCap, "v8 sid.capture.js", [200, 60, 110, 20], 2, ["", ""], { varname: "capture" }),
      A.obj(vCapRoute, "route stored replied", [200, 90, 120, 20], 3, ["", "", ""]), A.obj(vStoredPre, "prepend stored", [200, 120, 90, 20]),
      A.obj(vRepliedPre, "prepend replied", [300, 120, 90, 20]), A.obj(vGateRoute, "route noreply answered", [140, 530, 140, 20], 3, ["", "", ""]), A.obj(vNoReplyPre, "prepend noreply", [140, 560, 100, 20]),
      A.obj(vAnsweredPre, "prepend answered", [250, 560, 100, 20]),
      A.obj(vStored, "t l l", [320, 90, 40, 20], 2, ["", ""]));
    lines.push(A.line(vMidiin, 0, vCap, 0), A.line(vCap, 0, vStored, 0), A.line(vStored, 1, vRxDefer, 0), A.line(vStored, 0, vCapRoute, 0),
      A.line(vCapRoute, 0, vStoredPre, 0), A.line(vStoredPre, 0, vGate, 0), A.line(vCapRoute, 1, vRepliedPre, 0), A.line(vRepliedPre, 0, vGate, 0),
      A.line(vGate, 1, vGateRoute, 0), A.line(vGateRoute, 0, vNoReplyPre, 0), A.line(vNoReplyPre, 0, ctx.nameId, 0), A.line(vGateRoute, 1, vAnsweredPre, 0), A.line(vAnsweredPre, 0, ctx.nameId, 0),
      A.line(oscs[1].vV8, 0, vGate, 0), A.line(vGate, 0, vMidiout, 0));
    for (const [r, k] of routers) lines.push(A.line(r, k, vGate, 0));
    // Terminal control (tools/sid.js: cc, dp, request, settings, load/send a bank …) straight into the gateway.
    const vUdp = id();
    boxes.push(A.obj(vUdp, "udpreceive 9871", [140, 500, 100, 20], 1, [""]));
    lines.push(A.line(vUdp, 0, vGate, 0));
  }
  for (const t of ctx.armTargets) lines.push(A.line(vArm, 0, t, 0));

  // sendtoback in order: last = furthest back, so outer panels (voice, overview, filter) after the inner ones
  const panelsVn = boxes.filter((b) => b.box.maxclass === "panel" && !/tbldimframe$/.test(b.box.varname)).map((b) => b.box.varname);   // the dimmers stay in front
  const inner = (v) => /oscframe|envframe|^f_frame$|^l\d_frame$|^mapinnerframe$/.test(v);    // sub-panels (also the filter's f_frame and the LFOs' l<n>_frame)
  const bgsVn = boxes.filter((b) => b.box.filename === "sid.voicebg.js").map((b) => b.box.varname);   // the voice backgrounds furthest back
  const backs = panelsVn.filter(inner).concat(panelsVn.filter((v) => !inner(v)), bgsVn);
  const layout = { panels, backs, fronts: ["name"] };   // the name display in front, above the overview's v8ui (the text field is raised when shown)
  const width = L.compute(layout, L.initialState(layout)).width;            // all oscillators visible, LFO 1 selected
  p.openrect = [0, 0, width, 169];
  for (const { box: b } of boxes) {                                      // Live's Info View: a title and a plain-English text (lib/help.js)
    const h = b.presentation && b.varname && H.help(b.varname);
    if (h) { b.annotation_name = h[0]; b.annotation = h[1]; }
  }
  boxes.push(A.verticalLimit());
  p.boxes = boxes; p.lines = lines;
  return { json, layout, width };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const LAYOUTS = {};
{
  const { json, layout, width } = buildDevice("SidStation");
  LAYOUTS.SidStation = layout;
  A.writeAmxd(path.join(OUT_DIR, "SidStation.amxd"), json);
  console.log("wrote dist/SidStation.amxd (" + width + " px)");
}
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
writeIfChanged(path.join(OUT_DIR, "sid.osc.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "lib/midi.js", "max/sid.osc.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.filter.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "max/sid.filter.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.lfo.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "max/sid.lfo.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.send.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "lib/midi.js", "max/sid.send.js"].map(read).join("\n\n"));     // the gateway
writeIfChanged(path.join(OUT_DIR, "sid.capture.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/midi.js", "max/sid.capture.js"].map(read).join("\n\n"));               // the capture
writeIfChanged(path.join(OUT_DIR, "sid.load.js"), ["lib/maxlog.js", "lib/params.js", "max/sid.load.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.layout.js"), [read("lib/maxlog.js"), read("lib/layout.js"), "const LAYOUTS = " + JSON.stringify(LAYOUTS) + ";\n", read("max/sid.layout.js")].join("\n\n"));
for (const f of ["sid.adsr.js", "sid.pulse.js", "sid.note.js", "sid.map.js", "sid.fold.js", "sid.section.js", "sid.filtcurve.js", "sid.legend.js", "sid.vslider.js", "sid.name.js", "sid.lfoview.js", "sid.table.js", "sid.voicebg.js", "sid.lfotabs.js", "sid.loopbtn.js", "sid.litbtn.js", "sid.activebtn.js", "sid.dimbtn.js"]) writeIfChanged(path.join(OUT_DIR, f), ["lib/maxlog.js", "lib/ui.js", "max/" + f].map(read).join("\n\n"));   // + the shared palette
for (const f of fs.readdirSync(path.join(__dirname, "..", "max", "icons"))) copyIfChanged(path.join(__dirname, "..", "max", "icons", f), path.join(OUT_DIR, f));
console.log("wrote dist/sid.osc.js, sid.layout.js, widgets, icons");
