// voice.js – one voice of SidStation: the column (number, fold buttons osc/env/tbl, Active/Sync/Ring/Filter) and three
// sub-panels, the oscillator (Waveform + Tone), the Envelope and the Table.
const A = require("../amxd");
const P = require("../../lib/params");
const { PAD, GAP, FRAME_Y, FRAME_H, COL_W, VOICE_GAP, COL_PW, INNER_Y, INNER_H, ENV_DIAL_Y, TITLE_Y, SUB_Y, CONTENT_Y, voiceFrameItem, live, valueof, v8ui, SHADE, frameBox, voiceFrame, titleBox, shifted, actionButton, DIAL } = require("./common");

const X = { btn: PAD };                                        // the column panel: relative to its left edge
X.wave = PAD;  X.det = X.wave + 40 + 8;                        // the osc panel: relative to its left edge
X.pitch = X.det + 204 + PAD + GAP;
const OSC_W = X.pitch + 144 + 44 + PAD;                        // the osc panel's width: Tone has 3 dial columns + a column for PB range/Vib LFO
const ENV_W = PAD + 224 + PAD;                                 // the envelope panel (its own panel, follows its osc)
X.env = PAD;                                                   // ADSR/Gate relative to the envelope panel
// The waveform table panel (a table editor per voice): Speed dial on the left, the sid.table.js widget
// (65 steps, 16 visible) to its right; a third fold button "tbl" in the column, collapsed by default.
const TABLE_WIDGET_W = 576;
const TABLE_W = PAD + 44 + GAP + TABLE_WIDGET_W + PAD;
const WAVE_COMPACT_W = 60;                                     // the "Waveform" title must fit
const SHIFT = X.pitch - (X.wave + WAVE_COMPACT_W + GAP);       // offset when the pulse group is hidden
const WAVE_ICONS = ["wave-tri.svg", "wave-saw.svg", "wave-pulse.svg", "wave-mixed.svg", "wave-noise.svg", "wave-off.svg"];
// key -> [class, rect | [x,y] for dials | null = not in the presentation]
const PRES = {
  active:    ["live.text", [X.btn, 78, COL_W, 18]],                // below the three fold rows
  sync:      ["live.text", [X.btn, 101, COL_W, 18]], ring: ["live.text", [X.btn, 124, COL_W, 18]],   // the same parameters as the overview's arrows
  wave:      ["live.tab",  [X.wave, 38, 40, 122]],
  pwstart:   ["live.dial", [X.det, 110]], pwadd: ["live.dial", [X.det + 48, 110]], pwlfodepth: ["live.dial", [X.det + 96, 110]],
  pwsync:    ["live.text", [X.det + 148, 118, 52, 18]],
  pwlfo:     ["live.menu", [X.det + 148, 140, 52, 18]],       // below PW Sync, only when the PW LFO depth > 0
  transpose: ["live.dial", [X.pitch, 38]], detune:   ["live.dial", [X.pitch + 48, 38]], porta: ["live.dial", [X.pitch + 96, 38]],
  arp:       ["live.dial", [X.pitch, 84]], vibdepth: ["live.dial", [X.pitch + 48, 84]], delay: ["live.dial", [X.pitch + 96, 84]],
  pbrange:   ["live.numbox", [X.pitch + 144, 54, 44, 18]],   // fourth column: PB range above Vib LFO
  viblfo:    ["live.menu", [X.pitch + 144, 96, 44, 18]],
  gate:      ["live.text", [X.env + 180, 9, 44, 18]],       // in the title row, right of "Envelope n"
  // the ADSR dials below the curve: easier to hit, the same in both envelope types
  attack: ["live.dial", [X.env, ENV_DIAL_Y]], decay: ["live.dial", [X.env + 48, ENV_DIAL_Y]], sustain: ["live.dial", [X.env + 96, ENV_DIAL_Y]], release: ["live.dial", [X.env + 144, ENV_DIAL_Y]],
};
PRES.tablespeed = ["live.dial", [PAD, CONTENT_Y]];            // relative to the table panel
const PULSE_RECT = [X.det, CONTENT_Y, 204, 70];
const TRACK_TAB = [X.pitch, 134, 92, 18], TRACK_NOTE = [X.pitch + 96, 134, 44, 18];
const ADSR_RECT = [X.env, CONTENT_Y, 224, 62];                // the curve without a text row; the values are on the dials
const PB_LABEL = [X.pitch + 144, CONTENT_Y, 48, 15], VIB_LABEL = [X.pitch + 144, 80, 48, 15];
// The top of the column: a large number on the left, right of it two fold buttons
// stacked, with "osc" and "env" to their right.
const DIGIT_RECT = [X.btn, 10, 14, 18];                       // level with the top fold button
const FOLD_RECT = [X.btn + 16, 10, 18, 18], OSC_TITLE = [X.btn + 36, 11, 24, 15], ENVFOLD_RECT = [X.btn + 16, 32, 18, 18], ENV_LABEL = [X.btn + 36, 33, 24, 15];
const OSC_FRAME = { full: [0, INNER_Y, OSC_W, INNER_H], compact: [0, INNER_Y, OSC_W - SHIFT, INNER_H] };
const TABLE_FRAME = [0, INNER_Y, TABLE_W, INNER_H], TABLE_TITLE = [PAD, TITLE_Y, 44, 15], TABLE_WIDGET = [PAD + 44 + GAP, TITLE_Y, TABLE_WIDGET_W, INNER_Y + INNER_H - 4 - TITLE_Y];
const TBLFOLD_RECT = [X.btn + 16, 54, 18, 18], TBL_LABEL = [X.btn + 36, 55, 24, 15];   // the third fold row, right below env
const ENV_FRAME = [0, INNER_Y, ENV_W, INNER_H], VOICE_FRAME = [0, FRAME_Y, COL_PW + PAD, FRAME_H];   // the width is set by the layout engine
const TITLES = { osctitle: ["Oscillator", [X.wave, TITLE_Y, 100, 15]] };   // gets the number in oscPanel
// Section brackets "──── Waveform ────" (sid.section.js): [full rect, compact rect | null]
const SECTIONS = { wavetitle: ["Waveform", [X.wave, SUB_Y, X.det + 204 - X.wave, 13], [X.wave, SUB_Y, 40, 13]], tonetitle: ["Tone", [X.pitch, SUB_Y, 188, 13], null] };
const ENV_TITLE = [X.env, TITLE_Y, 100, 15], ENV_SECTION = [X.env, SUB_Y, 224, 13];
const PULSE_KEYS = ["pwstart", "pwadd", "pwlfodepth", "pwsync", "pwlfo"];
const rectOf = (key) => { const [cls, r] = PRES[key]; return !r ? null : cls === "live.dial" ? [r[0], r[1], ...DIAL] : r; };

// The layout engine's items for an osc panel (name = varname with prefix).
function oscItems(pre) {
  const items = [];
  const add = (name, rect, flags = {}) => items.push({ name: pre + name, rect, ...flags });
  add("oscframe", OSC_FRAME.full, { compact: OSC_FRAME.compact });
  add("osctitle", TITLES.osctitle[1]); add("wavetitle", SECTIONS.wavetitle[1], { compact: SECTIONS.wavetitle[2] }); add("tonetitle", SECTIONS.tonetitle[1], { shift: true }); add("viblabel", VIB_LABEL, { shift: true });
  add("wave", rectOf("wave"));
  add("pulse", PULSE_RECT, { when: "pulse" });
  for (const k of PULSE_KEYS) add(k, rectOf(k), { when: k === "pwlfo" ? ["pulse", "pwlfo"] : "pulse" });
  for (const k of ["transpose", "detune", "porta", "arp", "vibdepth", "delay", "pbrange", "viblfo"]) add(k, rectOf(k), { shift: true });
  add("pblabel", PB_LABEL, { shift: true }); add("trackmode", TRACK_TAB, { shift: true }); add("notepick", TRACK_NOTE, { shift: true });
  return items;
}
// The Filter button below Ring: the "Osc n Filter" parameter, the same as the overview's switch.
// Osc 1's Active swaps with its always-on stand-in in Poly (activepoly).
const FILTER_BTN = [X.btn, 147, COL_W, 18];
function colItems(pre, n) {
  const r = (name, rect) => ({ name: pre + name, rect });
  const rows = [FOLD_RECT, ENVFOLD_RECT, TBLFOLD_RECT].map((f, i) => ({ x: f[0] - 2, y: f[1], h: f[3], subs: [i], ...(i === 2 ? { dim: { of: "o" + n, flag: "tbloff" } } : {}) }));
  return [voiceFrameItem(pre + "voiceframe", VOICE_FRAME, rows), r("digit", DIGIT_RECT), r("title", OSC_TITLE), r("foldbtn", FOLD_RECT), r("envfoldbtn", ENVFOLD_RECT), r("envlabel", ENV_LABEL),
    ...(n === 1 ? [{ ...r("active", rectOf("active")), of: "o1", when: "single" }, { ...r("activepoly", rectOf("active")), of: "o1", when: "poly" }]
      : n === 3 ? [r("active", null), r("activebtn", rectOf("active"))] : [r("active", rectOf("active"))]), r("sync", rectOf("sync")), r("ring", rectOf("ring")), r("tblfoldbtn", TBLFOLD_RECT), r("tbllabel", TBL_LABEL)].concat([{ name: "f_route" + n, rect: FILTER_BTN }, { name: pre + "tbldimframe", rect: TBL_LABEL, of: "o" + n, when: "tbloff" }]);
}
// "OFF" below the Speed dial while Speed is 0.
const TABLE_OFF = [PAD, CONTENT_Y + 50, 44, 15];
const TABLE_LOOP = [PAD, CONTENT_Y + 68, 44, 18];             // the one-shot/loop button (sid.loopbtn.js)
const TABLE_CLEAR = [PAD, CONTENT_Y + 92, 44, 15];            // Clear: empties the table
function tableItems(pre, n) {
  return [{ name: pre + "tableframe", rect: TABLE_FRAME }, { name: pre + "tabletitle", rect: TABLE_TITLE }, { name: pre + "table", rect: TABLE_WIDGET },
    { name: pre + "tableoff", rect: TABLE_OFF, of: "o" + n, when: "tbloff" }, { name: pre + "tableloop", rect: TABLE_LOOP }, { name: pre + "tableclear", rect: TABLE_CLEAR },
    { name: pre + "tablespeed", rect: rectOf("tablespeed") }];
}
function envItems(pre) {
  return [{ name: pre + "envframe", rect: ENV_FRAME }, { name: pre + "envtitle", rect: ENV_TITLE }, { name: pre + "envsection", rect: ENV_SECTION }, { name: pre + "adsr", rect: ADSR_RECT }, { name: pre + "gate", rect: rectOf("gate") },
    ...["attack", "decay", "sustain", "release"].map((k) => ({ name: pre + k, rect: rectOf(k) }))];
}

// --- one oscillator panel --------------------------------------------------------------
// Produces boxes/lines; x0 = the panel's left edge in the full layout (initial values before the engine takes over).
// cx0 = the column panel's left edge in the full layout; the osc and envelope panels follow.
function oscPanel(n, cx0, ctx) {
  const { id, boxes, lines, vLayout, vLoad, armTargets } = ctx;
  const pre = "o" + n + "_", longPre = "Osc " + n + " ";
  const x0 = cx0 + COL_PW + VOICE_GAP, ex0 = x0 + OSC_W + VOICE_GAP, tx0 = ex0 + ENV_W + VOICE_GAP;   // the sub-panels inside the voice
  const pc = (r) => shifted(r, cx0, 0), px = (r) => shifted(r, x0, 0), pe = (r) => shifted(r, ex0, 0), pt = (r) => shifted(r, tx0, 0);
  const COL_KEYS = { active: 1, sync: 1, ring: 1 }, ENV_KEYS = { gate: 1, attack: 1, decay: 1, sustain: 1, release: 1 }, TABLE_KEYS = { tablespeed: 1 };
  const py = 30 + (n - 1) * 520;                       // patching y per osc, so the patcher stays readable
  const vV8 = id(), vAdsr = id(), vPulse = id(), vRouteA = id(), vRouteP = id();
  armTargets.push(vV8);
  boxes.push(
    A.obj(vV8, "v8 sid.osc.js " + n, [30, py + 390, 110, 20], 3, ["", "", ""], { varname: pre + "router" }),   // varname: sid.load.js reaches it with "script send"
    v8ui(vAdsr, "sid.adsr.js", [400, py, 224, 150], pe(ADSR_RECT), pre + "adsr"),
    v8ui(vPulse, "sid.pulse.js", [650, py, 204, 84], px(PULSE_RECT), pre + "pulse"),
    A.obj(vRouteA, "route attack decay sustain release", [400, py + 170, 220, 20], 5, ["", "", "", "", ""]),
    A.obj(vRouteP, "route start", [650, py + 170, 70, 20], 2, ["", ""]),
    A.comment(id(), "PB range", [1200, py + 370, 60, 18], px(PB_LABEL), { varname: pre + "pblabel", fontsize: 9 }),
  );
  boxes.unshift(frameBox(id(), pre + "oscframe", px(OSC_FRAME.full), SHADE.inner), frameBox(id(), pre + "envframe", pe(ENV_FRAME), SHADE.inner));   // sub-panels
  boxes.unshift(frameBox(id(), pre + "tableframe", pt(TABLE_FRAME), SHADE.inner));
  boxes.unshift(voiceFrame(id(), pre + "voiceframe", pc([0, FRAME_Y, COL_PW + VOICE_GAP + OSC_W + VOICE_GAP + ENV_W + VOICE_GAP + TABLE_W + PAD, FRAME_H]), ));   // the voice behind them
  // the waveform table: widget -> [route bytes] -> [prepend table] -> the router (changed rows as DP); sid.load.js sends "bytes …" to it
  const vTable = id(), vTableRoute = id(), vTablePre = id();
  boxes.push(titleBox(id(), pre + "tabletitle", "Table " + n, pt(TABLE_TITLE)), A.comment(id(), "OFF", [1000, py + 210, 44, 15], pt(TABLE_OFF), { varname: pre + "tableoff", fontsize: 10, fontface: 1, textjustification: 1 }),
    // The table is a hidden blob parameter (getvalueof/setvalueof in sid.table.js): Live keeps it in the set and in presets and
    // restores it when the device reloads (otherwise the tables vanished from the editor on every reload).
    { box: { ...v8ui(vTable, "sid.table.js", [1000, py, TABLE_WIDGET_W, 146], pt(TABLE_WIDGET), pre + "table").box, parameter_enable: 1,
      saved_attribute_attributes: { valueof: { parameter_longname: longPre + "Table Data", parameter_shortname: "Table", parameter_type: 3, parameter_invisible: 1, parameter_modmode: 0 } } } },
    A.obj(vTableRoute, "route bytes", [1000, py + 160, 70, 20], 2, ["", ""]), A.obj(vTablePre, "prepend table", [1000, py + 185, 90, 20]));
  lines.push(A.line(vTable, 0, vTableRoute, 0), A.line(vTableRoute, 0, vTablePre, 0), A.line(vTablePre, 0, vV8, 0));
  const vLoopBtn = id(), vLoopPre = id(), vLoopRoute = id(), vLoopSet = id();     // the one-shot/loop button <-> the table
  boxes.push(v8ui(vLoopBtn, "sid.loopbtn.js", [1100, py + 160, 44, 18], pt(TABLE_LOOP), pre + "tableloop"),
    A.obj(vLoopPre, "prepend loopmode", [1100, py + 185, 100, 20]), A.obj(vLoopRoute, "route loop", [1200, py + 160, 70, 20], 2, ["", ""]),
    A.obj(vLoopSet, "prepend state", [1200, py + 185, 80, 20]));
  const vClr = id(), vClrSel = id(), vClrSel1 = id(), vClrMsg = id();           // Clear: End alone and Speed 0 (sent like any edit)
  boxes.push(actionButton(vClr, [1300, py + 160, 44, 15], pt(TABLE_CLEAR), longPre + "Table Clear", "Clear", pre + "tableclear"),
    A.obj(vClrSel, "route bang", [1300, py + 185, 60, 20]), A.obj(vClrSel1, "sel 1", [1360, py + 185, 40, 20]), A.msg(vClrMsg, "clear", [1300, py + 210, 40, 20]));
  lines.push(A.line(vClr, 0, vClrSel, 0), A.line(vClrSel, 0, vClrMsg, 0), A.line(vClrSel, 1, vClrSel1, 0), A.line(vClrSel1, 0, vClrMsg, 0), A.line(vClrMsg, 0, vTable, 0));
  lines.push(A.line(vLoopBtn, 0, vLoopPre, 0), A.line(vLoopPre, 0, vTable, 0), A.line(vTable, 0, vLoopRoute, 0), A.line(vLoopRoute, 0, vLoopSet, 0), A.line(vLoopSet, 0, vLoopBtn, 0));
  for (const [name, [text, rect]] of Object.entries(TITLES)) boxes.push(titleBox(id(), pre + name, name === "osctitle" ? "Oscillator " + n : text, px(rect)));
  boxes.push(titleBox(id(), pre + "envtitle", "Envelope " + n, pe(ENV_TITLE)));
  for (const [name, text, rect] of [["wavetitle", SECTIONS.wavetitle[0], px(SECTIONS.wavetitle[1])], ["tonetitle", SECTIONS.tonetitle[0], px(SECTIONS.tonetitle[1])], ["envsection", "ADSR", pe(ENV_SECTION)]]) {
    const vS = id(), vL = id();
    boxes.push(v8ui(vS, "sid.section.js", [1200, py + 400, 120, 13], rect, pre + name), A.msg(vL, "label " + text, [1200, py + 430, 100, 20]));
    lines.push(A.line(vLoad, 0, vL, 0), A.line(vL, 0, vS, 0));
  }
  boxes.push(A.comment(id(), "Vib LFO", [1200, py + 350, 60, 18], px(VIB_LABEL), { varname: pre + "viblabel", fontsize: 9 }));
  const times = ["attack", "decay", "release"].map((k) => "times " + k + " " + (k === "attack" ? P.ATTACK_MS : P.DECAY_MS).join(" ")).join(", ");
  const cfgA = id(), cfgP = id();
  boxes.push(A.msg(cfgA, "steps 16, levels 16, sustainlen 6, labels 0, units s, " + times, [400, py - 30, 500, 20]), A.msg(cfgP, "steps 128, periods 3", [650, py - 30, 120, 20]));
  lines.push(A.line(vLoad, 0, cfgA, 0), A.line(cfgA, 0, vAdsr, 0), A.line(vLoad, 0, cfgP, 0), A.line(cfgP, 0, vPulse, 0));

  // one live.* parameter per row in params.js
  let x = 30, waveId = null, vGateAct = null; const ids = {};
  for (const d of P.OSC) {
    if (!PRES[d.key]) continue;                      // track: its own controls below
    const [cls] = PRES[d.key];
    const pres = rectOf(d.key) ? (ENV_KEYS[d.key] ? pe : COL_KEYS[d.key] ? pc : TABLE_KEYS[d.key] ? pt : px)(rectOf(d.key)) : null;
    let extra = {};
    if (cls === "live.text") extra = { text: d.short, texton: d.short, mode: 1, fontsize: 9 };   // mode 1 = toggle
    if (cls === "live.menu" || cls === "live.numbox") extra = { fontsize: 9 };
    if (cls === "live.tab") extra = { mode: 0, num_lines_patching: 6, num_lines_presentation: 6, spacing_x: 2, spacing_y: 2, pictures: WAVE_ICONS, usepicture: 1, remapsvgcolors: 1 };
    const Lb = id(); ids[d.key] = Lb;
    const vo = valueof(d, longPre);
    if (d.key === "wave") vo.parameter_shortname = "Osc " + n;        // Push shows the three side by side on its Main bank (Off = the oscillator off)
    boxes.push(live(Lb, cls, [x, py + 210, 60, cls === "live.dial" ? 48 : cls === "live.tab" ? 100 : 18], pres, vo, extra, pre + d.key));
    if (d.key === "wave") waveId = Lb;
    if (d.key === "tablespeed") {                                        // the playhead needs the speed; the layout dims the tbl row at 0
      const vSp = id(), vTs = id();
      boxes.push(A.obj(vSp, "prepend speed", [x, py + 330, 90, 20]), A.obj(vTs, "prepend tblspeed " + n, [x, py + 360, 110, 20]));
      lines.push(A.line(Lb, 0, vSp, 0), A.line(vSp, 0, vTable, 0), A.line(Lb, 0, vTs, 0), A.line(vTs, 0, vLayout, 0));
      const vZero = id();                                                // Clear also sets Speed 0
      boxes.push(A.msg(vZero, "0", [1400, py + 210, 30, 20]));
      lines.push(A.line(vClrSel, 0, vZero, 0), A.line(vClrSel1, 0, vZero, 0), A.line(vZero, 0, Lb, 0));
    }
    const prep = id();
    boxes.push(A.obj(prep, "prepend " + d.key, [x, py + 290, 90, 20]));
    lines.push(A.line(Lb, 0, prep, 0), A.line(prep, 0, vV8, 0));
    if (d.key === "pwlfodepth") {                                        // the depth controls whether the LFO selector is visible
      const vP = id();
      boxes.push(A.obj(vP, "prepend pwlfo " + n, [x, py + 380, 100, 20]));
      lines.push(A.line(Lb, 0, vP, 0), A.line(vP, 0, vLayout, 0));
    }
    if (d.key === "gate") {                                              // Gate (manual p. 24): the graph draws a gate at the sustain level, the A/D/R dials are disabled (active 0)
      const vG = id(), vAct = id(), vActP = id();
      boxes.push(A.obj(vG, "prepend set gate", [x, py + 330, 100, 20]), A.obj(vAct, "expr 1-$i1", [x, py + 355, 70, 20]), A.obj(vActP, "prepend active", [x, py + 380, 90, 20]));
      lines.push(A.line(Lb, 0, vG, 0), A.line(vG, 0, vAdsr, 0), A.line(Lb, 0, vAct, 0), A.line(vAct, 0, vActP, 0));
      vGateAct = vActP;
    }
    const link = { attack: [vAdsr, "attack", 0], decay: [vAdsr, "decay", 1], sustain: [vAdsr, "sustain", 2], release: [vAdsr, "release", 3],
      pwstart: [vPulse, "start", 0], pwadd: [vPulse, "add", null] }[d.key];
    if (link) {
      const [widget, wname, back] = link;
      const setp = id();
      boxes.push(A.obj(setp, "prepend set " + wname, [x, py + 320, 110, 20]));
      lines.push(A.line(Lb, 0, setp, 0), A.line(setp, 0, widget, 0));
      if (back !== null) lines.push(A.line(widget === vAdsr ? vRouteA : vRouteP, back, Lb, 0));
    }
    x += 70;
  }
  lines.push(A.line(vAdsr, 0, vRouteA, 0), A.line(vPulse, 0, vRouteP, 0));
  if (vGateAct) for (const k of ["attack", "decay", "release"]) lines.push(A.line(vGateAct, 0, ids[k], 0));   // gate on -> A/D/R disabled
  // In Poly, osc 1's Active is replaced by a stand-in that always shows Active (Poly plays osc 1 and ignores Active); the real
  // button keeps its value for Single; the help text says deactivating it has no effect. sid.litbtn.js draws itself lit: a
  // live.text without a parameter showed off in Live.
  // The layout swaps the two (poly/single).
  if (n === 1) boxes.push({ box: { ...v8ui(id(), "sid.litbtn.js", [1300, py + 260, 52, 18], pc(rectOf("active")), pre + "activepoly").box, numoutlets: 0, outlettype: [] } });
  // Osc 3's Active has a third state, Mod only (3OFF): sid.activebtn.js is shown in its place and drives the hidden Active and the
  // filter router's Osc 3 Off (wired in build-station.js, which knows both).
  let activeBtnId = null;
  if (n === 3) { activeBtnId = id(); boxes.push(v8ui(activeBtnId, "sid.activebtn.js", [1360, py + 260, 52, 18], pc(rectOf("active")), pre + "activebtn")); }
  // ringok from the router (outlet 1): the Ring button is disabled when the waveform is not Tri/Mixed
  const vRingOk = id(), vRingAct = id();
  // setactive from the router (choosing a waveform / Off): the Active parameter itself, so Live, Push and the synth follow
  boxes.push(A.obj(vRingOk, "route ringok setactive", [200, py + 430, 120, 20], 3, ["", "", ""]), A.obj(vRingAct, "prepend active", [200, py + 460, 90, 20]));
  lines.push(A.line(vV8, 1, vRingOk, 0), A.line(vRingOk, 0, vRingAct, 0), A.line(vRingAct, 0, ids.ring, 0), A.line(vRingOk, 1, ids.active, 0));

  // Track: radio button [live.tab] Key follow | Note + the note picker sid.note.js (the synth's note names).
  const vMode = id(), vModePre = id(), vNote = id(), vNotePre = id(), vNoteW = id(), vNoteRoute = id(), vNoteSet = id(), vEnable = id();
  boxes.push(
    live(vMode, "live.tab", [1500, py + 210, 90, 18], px(TRACK_TAB),
      { parameter_longname: longPre + "Track Mode", parameter_shortname: "Track", parameter_type: 2, parameter_enum: ["Key follow", "Note"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] },
      { mode: 0, num_lines_patching: 1, num_lines_presentation: 1, spacing_x: 2, spacing_y: 2, fontsize: 9 }, pre + "trackmode"),
    A.obj(vModePre, "prepend trackmode", [1500, py + 290, 100, 20]),
    A.obj(vEnable, "prepend enable", [1500, py + 320, 90, 20]),
    live(vNote, "live.numbox", [1620, py + 210, 60, 18], null,
      { parameter_longname: longPre + "Fixed Note", parameter_shortname: "Note", parameter_type: 1, parameter_mmin: 1, parameter_mmax: 100, parameter_unitstyle: 8,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [60] }, {}, pre + "tracknote"),
    A.obj(vNotePre, "prepend tracknote", [1620, py + 290, 100, 20]),
    v8ui(vNoteW, "sid.note.js", [1740, py + 210, 44, 18], px(TRACK_NOTE), pre + "notepick"),
    A.obj(vNoteRoute, "route note", [1740, py + 250, 70, 20], 2, ["", ""]),
    A.obj(vNoteSet, "prepend set note", [1620, py + 320, 100, 20]),
  );
  lines.push(
    A.line(vMode, 0, vModePre, 0), A.line(vModePre, 0, vV8, 0),
    A.line(vMode, 0, vEnable, 0), A.line(vEnable, 0, vNoteW, 0),
    A.line(vNote, 0, vNotePre, 0), A.line(vNotePre, 0, vV8, 0),
    A.line(vNote, 0, vNoteSet, 0), A.line(vNoteSet, 0, vNoteW, 0),
    A.line(vNoteW, 0, vNoteRoute, 0), A.line(vNoteRoute, 0, vNote, 0),
  );

  // The button column: number, "osc"/"env"/"tbl" with their fold balls. The Show parameter (hidden live.text) carries whether
  // the panel is shown; the ball and the overview toggle it, the layout engine listens.
  const vWavePre = id(), vShow = id(), vShowPre = id(), vFoldBtn = id(), vEnvShow = id(), vEnvPre = id(), vEnvFold = id();
  const vTblShow = id(), vTblPre = id(), vTblFold = id();
  boxes.push(
    titleBox(id(), pre + "digit", String(n), pc(DIGIT_RECT), 14),
    titleBox(id(), pre + "title", "osc", pc(OSC_TITLE)),
    titleBox(id(), pre + "envlabel", "env", pc(ENV_LABEL)),
    titleBox(id(), pre + "tbllabel", "tbl", pc(TBL_LABEL)),
    { box: { ...frameBox(id(), pre + "tbldimframe", pc(TBL_LABEL), SHADE.dim, 0).box, ignoreclick: 1 } },   // dims "tbl" while Speed is 0 (in front of the label)
    // a new SidStation device starts with every panel folded
    live(vTblShow, "live.text", [1300, py + 60, 60, 18], null,
      { parameter_longname: longPre + "Table", parameter_shortname: "Table", parameter_type: 2, parameter_enum: ["hidden", "shown"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] }, { text: "Tbl", texton: "Tbl", mode: 1, fontsize: 9 }, pre + "tblshow"),
    A.obj(vTblPre, "prepend table " + n, [1300, py + 30, 90, 20]),
    live(vEnvShow, "live.text", [1300, py + 120, 60, 18], null,
      { parameter_longname: longPre + "Env", parameter_shortname: "Env", parameter_type: 2, parameter_enum: ["hidden", "shown"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] }, { text: "Env", texton: "Env", mode: 1, fontsize: 9 }, pre + "envshow"),
    A.obj(vEnvPre, "prepend env " + n, [1300, py + 90, 90, 20]),
    live(vShow, "live.text", [1300, py + 210, 60, 18], null,
      { parameter_longname: longPre + "Show", parameter_shortname: "Show", parameter_type: 2, parameter_enum: ["hidden", "shown"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] }, { text: "Show", texton: "Show", mode: 1, fontsize: 9 }, pre + "show"),
    A.obj(vShowPre, "prepend show " + n, [1300, py + 250, 90, 20]),
    A.obj(vWavePre, "prepend wave " + n, [1300, py + 290, 90, 20]),
  );
  lines.push(A.line(vShow, 0, vShowPre, 0), A.line(vShowPre, 0, vLayout, 0), A.line(vEnvShow, 0, vEnvPre, 0), A.line(vEnvPre, 0, vLayout, 0),
    A.line(vTblShow, 0, vTblPre, 0), A.line(vTblPre, 0, vLayout, 0));
  for (const [btn, param, rect, name] of [[vFoldBtn, vShow, FOLD_RECT, "foldbtn"], [vEnvFold, vEnvShow, ENVFOLD_RECT, "envfoldbtn"], [vTblFold, vTblShow, TBLFOLD_RECT, "tblfoldbtn"]]) {
    const vSet = id();
    boxes.push(v8ui(btn, "sid.fold.js", [1300, py + 180, 18, 18], pc(rect), pre + name), A.obj(vSet, "prepend state", [1300, py + 150, 80, 20]));
    lines.push(A.line(btn, 0, param, 0), A.line(param, 0, vSet, 0), A.line(vSet, 0, btn, 0));
  }
  lines.push(A.line(waveId, 0, vWavePre, 0), A.line(vWavePre, 0, vLayout, 0));

  return { vV8, activeId: ids.active, activeBtnId, portaId: ids.porta, syncId: ids.sync, ringId: ids.ring, showId: vShow, envShowId: vEnvShow, ringOkId: vRingOk, colItems: colItems(pre, n), cx0, items: oscItems(pre), envItems: envItems(pre), tableItems: tableItems(pre, n), tableId: vTable };
}

module.exports = { OSC_W, ENV_W, TABLE_W, SHIFT, FILTER_BTN, colItems, tableItems, envItems, oscPanel };
