// build-station.js – dist/<productName>.amxd, the editor: [overview after the SID datasheet (sid.map.js): three voices
//   Osc -> Env -> switch -> Filter/out, sync/ring arrows, the patch name and the patch column] [voice 1..3: a column (number,
//   fold buttons osc/env/tbl, Active/Sync/Ring/Filter) and three sub-panels: oscillator (Waveform + Tone), Envelope, Table]
//   [filter + filter envelope] [LFO 1–4, one at a time]. Every voice's width follows what is expanded.
// Panels in Live's style (light filled area, no outlines); sub-panels slightly darker. npm run build.
//
// Every x is derived from PAD/GAP. At runtime all presentation rects are owned by [v8 sid.layout.js <device name>] (lib/layout.js),
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
const { parameters } = require("./station/banks");

// The device: the overview, voices 1–3, the filter, LFO 1–4, and the one-track plumbing (gateway, capture).
const OSCS = [1, 2, 3];
// The device's name (package.json productName): its file name in Live's browser, its name in the track when no patch name is
// set (sid.name.js, DEVICE_NAME), the layout's key, the release file.
const DEVICE = require("../package.json").productName;
// kept in every set by sid.version.js, and in the description. A development build says "-dev" wherever the version shows (the
// overview's help text, the description, the name display's title, the log); only "npm run release" (--release) builds the plain version.
const RELEASE = process.argv.includes("--release");
const VERSION = require("../package.json").version + (RELEASE ? "" : "-dev");
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
  // The version in the set: a hidden parameter (stored only, no automation, in no bank) holds the version that last had the set,
  // so the log can say what a set was saved with. On load Live restores it (0 for a new device or an older set) -> sid.version.js
  // logs that and writes the device's own version back after 50 ms. Long parameter names never change after a release: Live
  // restores a set's values by them, so a renamed parameter would lose its value in every saved set.
  const vVer = id(), vVerJs = id();
  boxes.push(live(vVer, "live.numbox", [1300, 30, 70, 18], null, { parameter_longname: "Version", parameter_shortname: "Version",
      parameter_type: 0, parameter_mmin: 0, parameter_mmax: 999999, parameter_unitstyle: 0, parameter_invisible: 1,   // float: an int came back as 255 (clipped to 8 bits somewhere)
      parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0], parameter_visible_undoable: 0 }, {}, "d_version"),
    A.obj(vVerJs, "v8 sid.version.js " + VERSION, [1300, 60, 150, 20], 1, [""]));
  lines.push(A.line(vVer, 0, vVerJs, 0), A.line(vVerJs, 0, vVer, 0));

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
    const vNote = id(), vNotePre = id(), vPushCC = id(), vPushCCT = id();
    boxes.push(A.obj(vNote, "route note pushcc", [30, 520, 100, 20], 3, ["", "", ""]), A.obj(vNotePre, "prepend note", [30, 545, 80, 20]),
      A.obj(vPushCCT, "t b b", [140, 530, 40, 20], 2, ["bang", "bang"]), A.msg(vPushCC, "sendall", [140, 555, 60, 20]));
    lines.push(A.line(oscs[1].vV8, 1, vNote, 0), A.line(vNote, 0, vNotePre, 0), A.line(vNote, 1, vPushCCT, 0), A.line(vPushCCT, 1, vPushCC, 0));
    ctx.pushCCTriggerId = vPushCCT;                                        // its left outlet -> "pushed" to the gateway (connected with the gateway below)
    for (const n of OSCS) lines.push(A.line(vNotePre, 0, oscs[n].tableId, 0));
    // CC 119 (SidParams.PUSH_CC) on the track: Push patch, at most every 5 s (sid.osc.js pushCC), like the button: sendall, then "pushed"
    for (const n of OSCS) lines.push(A.line(vPushCC, 0, oscs[n].vV8, 0));
    lines.push(A.line(vPushCC, 0, vFilter, 0), A.line(vPushCC, 0, vLfo, 0));
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
    const vGate = id(), vCap = id(), vStored = id(), vStoredPre = id(), vCapRoute = id(), vRepliedPre = id(), vGateRoute = id(), vNoReplyPre = id(), vAnsweredPre = id(), vSentMsg = id();
    const vStoreActive = id(), vStorablePre = id();                        // "storable 0|1" -> the Store button's active state and the overview's notice
    boxes.push(A.obj(vGate, "v8 sid.send.js", [30, 500, 100, 20], 2, ["", ""], { varname: "gateway" }),
      A.obj(vCap, "v8 sid.capture.js", [200, 60, 110, 20], 2, ["", ""], { varname: "capture" }),
      A.obj(vCapRoute, "route stored replied", [200, 90, 120, 20], 3, ["", "", ""]), A.obj(vStoredPre, "prepend stored", [200, 120, 90, 20]),
      A.obj(vRepliedPre, "prepend replied", [300, 120, 90, 20]), A.obj(vGateRoute, "route noreply answered sent storable", [140, 530, 200, 20], 5, ["", "", "", "", ""]), A.obj(vNoReplyPre, "prepend noreply", [140, 560, 100, 20]),
      A.obj(vAnsweredPre, "prepend answered", [250, 560, 100, 20]), A.msg(vSentMsg, "outside", [360, 560, 50, 20]),
      A.msg(vStoreActive, "active $1", [420, 560, 60, 20]), A.obj(vStorablePre, "prepend storable", [490, 560, 100, 20]),
      A.obj(vStored, "t l l", [320, 90, 40, 20], 2, ["", ""]));
    lines.push(A.line(vMidiin, 0, vCap, 0), A.line(vCap, 0, vStored, 0), A.line(vStored, 1, vRxDefer, 0), A.line(vStored, 0, vCapRoute, 0),
      A.line(vCapRoute, 0, vStoredPre, 0), A.line(vStoredPre, 0, vGate, 0), A.line(vCapRoute, 1, vRepliedPre, 0), A.line(vRepliedPre, 0, vGate, 0),
      A.line(vGate, 1, vGateRoute, 0), A.line(vGateRoute, 0, vNoReplyPre, 0), A.line(vNoReplyPre, 0, ctx.nameId, 0), A.line(vGateRoute, 1, vAnsweredPre, 0), A.line(vAnsweredPre, 0, ctx.nameId, 0),
      A.line(vGateRoute, 2, vSentMsg, 0), A.line(vSentMsg, 0, ctx.nameId, 0),
      A.line(vGateRoute, 3, vStoreActive, 0), A.line(vStoreActive, 0, ctx.storeBtnId, 0), A.line(vGateRoute, 3, vStorablePre, 0), A.line(vStorablePre, 0, ctx.mapId, 0),
      A.line(ctx.pushedId, 0, vGate, 0), A.line(ctx.pushCCTriggerId, 0, ctx.pushedId, 0),
      A.line(oscs[1].vV8, 0, vGate, 0), A.line(vGate, 0, vMidiout, 0));
    for (const [r, k] of routers) lines.push(A.line(r, k, vGate, 0));
    ctx.armTargets.push(vGate);                                            // "arm" on load: the gateway answers "storable 0", so Store starts grey
  }
  for (const t of ctx.armTargets) lines.push(A.line(vArm, 0, t, 0));

  // sendtoback in order: last = furthest back, so outer panels (voice, overview, filter) after the inner ones
  const panelsVn = boxes.filter((b) => b.box.maxclass === "panel" && !/tbldimframe$/.test(b.box.varname)).map((b) => b.box.varname);   // the dimmers stay in front
  const inner = (v) => /oscframe|envframe|^f_frame$|^l\d_frame$|^mapinnerframe$/.test(v);    // sub-panels (also the filter's f_frame and the LFOs' l<n>_frame)
  const bgsVn = boxes.filter((b) => b.box.filename === "sid.voicebg.js").map((b) => b.box.varname);   // the voice backgrounds furthest back
  const backs = panelsVn.filter(inner).concat(panelsVn.filter((v) => !inner(v)), bgsVn);
  const layout = { panels, backs, fronts: ["name", "tip"] };   // the name display in front of the overview's v8ui (the text field is raised when shown), the tooltip layer in front of that
  const width = L.compute(layout, L.initialState(layout)).width;            // all oscillators visible, LFO 1 selected
  p.openrect = [0, 0, width, 169];
  for (const { box: b } of boxes) {                                      // Live's Info View: a title and a plain-English text (lib/help.js), also
    const h = b.varname && H.help(b.varname);                             // on parameters with no control on screen, for a program reading the device
    if (h) { b.annotation_name = h[0]; b.annotation = h[1]; }
    if (b.varname === "map") b.annotation += " This is " + DEVICE + " " + VERSION + ".";   // Live shows no description for the device itself in the Info View, so the version is here
  }
  boxes.push(A.verticalLimit());
  p.boxes = boxes; p.lines = lines;
  p.parameters = parameters(boxes);                                     // Push banks (build/station/banks.js)
  return { json, layout, width };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const LAYOUTS = {};
{
  const { json, layout, width } = buildDevice(DEVICE);
  // Live's Info View for the device itself (empty, Live showed a generic "MIDI Effect" text)
  json.patcher.description = DEVICE + " " + VERSION + ". Editor for the Elektron SidStation: every patch parameter as a Live parameter, with Pull, Push and Store patch. Not affiliated with Elektron.\n\n"
    + "For a program driving the device through Live's API: every change to a parameter goes to the synth right away. A program must never choose Pull patch or Push patch "
    + "unless the user asks for it, and must never choose Store patch unless the user explicitly asks to store. Pull patch replaces every setting in the editor with the "
    + "synth's current slot; Push patch sends the whole editor state together, for example after a saved set has been loaded (loading sends nothing); Store patch "
    + "overwrites the patch number the synth shows for good, and is allowed only right after Push patch (greyed and refused otherwise). Patch Action (None, Pull patch, Push patch, Store patch) presses those buttons and goes back to None by itself. A waveform table is edited through Osc n Table Step, set first in a call of its own, then the step's Table Wave, Mod, "
    + "Pitch and Note or Offset; Table Length, Loop and Loop To apply to the whole table, which plays only while Table Speed is above 0. Osc n Table Data and Table Clear "
    + "are the editor's own storage. Parameters with the values hidden/shown only show or hide panels and do not change the sound. The patch name is Name 1 to Name 10 "
    + "as ASCII codes and names the device in Live.";
  LAYOUTS[DEVICE] = layout;
  A.writeAmxd(path.join(OUT_DIR, DEVICE + ".amxd"), json);
  console.log("wrote dist/" + DEVICE + ".amxd (" + width + " px)");
}
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
writeIfChanged(path.join(OUT_DIR, "sid.osc.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "lib/midi.js", "max/sid.osc.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.filter.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "max/sid.filter.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.lfo.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "max/sid.lfo.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.send.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/params.js", "lib/midi.js", "max/sid.send.js"].map(read).join("\n\n"));     // the gateway
writeIfChanged(path.join(OUT_DIR, "sid.capture.js"), ["lib/maxlog.js", "lib/sysex.js", "lib/midi.js", "max/sid.capture.js"].map(read).join("\n\n"));               // the capture
writeIfChanged(path.join(OUT_DIR, "sid.load.js"), ["lib/maxlog.js", "lib/params.js", "max/sid.load.js"].map(read).join("\n\n"));
writeIfChanged(path.join(OUT_DIR, "sid.version.js"), ["lib/maxlog.js", "max/sid.version.js"].map(read).join("\n\n"));         // the version in the set
writeIfChanged(path.join(OUT_DIR, "sid.layout.js"), [read("lib/maxlog.js"), read("lib/layout.js"), "const LAYOUTS = " + JSON.stringify(LAYOUTS) + ";\n", read("max/sid.layout.js")].join("\n\n"));
for (const f of ["sid.adsr.js", "sid.pulse.js", "sid.note.js", "sid.map.js", "sid.fold.js", "sid.section.js", "sid.filtcurve.js", "sid.legend.js", "sid.vslider.js", "sid.name.js", "sid.lfoview.js", "sid.table.js", "sid.voicebg.js", "sid.tablenote.js", "sid.lfotabs.js", "sid.loopbtn.js", "sid.litbtn.js", "sid.activebtn.js", "sid.dimbtn.js", "sid.tip.js"]) writeIfChanged(path.join(OUT_DIR, f), ["lib/maxlog.js", "lib/ui.js", "max/" + f].map(read).join("\n\n").replace("\n\n// sid.name.js", "\n\nconst DEVICE_NAME = " + JSON.stringify(DEVICE) + ";\nconst DEVICE_TITLE = " + JSON.stringify(DEVICE + " " + VERSION) + ";\n\n// sid.name.js"));   // + the shared palette (and the device name for sid.name.js)
for (const f of fs.readdirSync(path.join(__dirname, "..", "max", "icons"))) copyIfChanged(path.join(__dirname, "..", "max", "icons", f), path.join(OUT_DIR, f));
console.log("wrote dist/sid.osc.js, sid.layout.js, widgets, icons");
