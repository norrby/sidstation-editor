// overview.js – the overview: the diagram (sid.map.js), the patch name and the patch column (Poly/Legato/HCut, Pull/Push/Store).
const A = require("../amxd");
const P = require("../../lib/params");
const { PAD, FRAME_Y, FRAME_H, INNER_Y, INNER_H, DEVICE_H, live, valueof, v8ui, SHADE, frameBox, voiceFrame, shifted, actionButton, DIAL } = require("./common");
const { FILTER_BTN } = require("./voice");

const MAP_W = 230;
const PCOL_BTN = 60;                                           // the Patch column's button width: "Send patch" was clipped at 52 px
const PCOL_W = PAD + PCOL_BTN;                                    // the Patch column on the left of the overview box
const MAP_TOTAL = PCOL_W + MAP_W;                              // the overview box: Patch column + the diagram
const NAME_RECT = [PCOL_W + 10, FRAME_Y + 7, 144, 26];         // the name display top left in the diagram, above Osc 1 (the Env box sits above the filter), inside MAP_INNER
// The overview like the voices: the Patch column on the
// device background, the diagram on a darker inner panel like the voices' sub-panels; the voices' dividers separate them.
const MAP_INNER = [PCOL_W + 6, INNER_Y, MAP_W - 10, INNER_H];         // 3 px clear of the Patch column with the halo
// Framed like an expanded oscillator (same height and theme): sid.voicebg.js draws a 3 px halo round MAP_INNER in a neutral tone, and the patch tongue (PATCH_TONGUE); the inner panel on top.

// Patch-wide: a column on the left of the overview box – Poly, Legato (buttons), HCut (dial) and Send all. Sent by
// the filter router (DP, the common block); Sync Speed and Direct Controllers left out (see params.js COMMON).

// Aligned with the diagram's rows (sid.map.js G.rows + FRAME_Y): Send patch level with the name, Poly centred on Osc 1,
// Legato centred on Osc 2, the HCut dial at Osc 3.
// Poly moved down below Store patch; Legato and HCut stay level with Osc 2/3.
// The diagram's rows moved to 51/91/131 (the filter longer, Osc 1 level with its top).
// Poly, Legato and HCut together at the top in a tongue from the overview's frame, so they read as part of the sound;
// Pull/Push/Store outside it at the bottom.
const CPRES = { poly: ["live.text", [PAD, 10, PCOL_BTN, 18]], legato: ["live.text", [PAD, 32, PCOL_BTN, 18]], hcut: ["live.dial", [PAD + (PCOL_BTN - 44) / 2, 54]] };
const PATCH_TONGUE = { x: 3, y: 8, h: 96 };                     // round Poly..HCut (the dial ends at 102)
// The patch buttons stacked in full width, 15 px high: two half-width buttons clipped the text to "Sen"/"Fet..".
// Fetch ("Pull patch") reads the current slot.
const FETCH_RECT = [PAD, 116, PCOL_BTN, 15];                   // Pull, Push, Store at the bottom
const SENDALL_RECT = [PAD, 133, PCOL_BTN, 15];
const STORE_RECT = [PAD, 150, PCOL_BTN, 15];                   // Store below Push
const SENDALL_TEXT = "Push patch";
const STORE_TEXT = "Store patch";
const FETCH_TEXT = "Pull patch";
const ACTION_LONG = "Patch Action";                           // the parameter that triggers Pull/Push/Store from Live (API, mapping, automation)
// Produces the overview panel's items for the column (x relative to the overview box's left edge).
function patchColumn(x0, ctx) {
  const { id, boxes, lines, vFilter } = ctx;
  const px = (r) => shifted(r, x0, 0);
  const items = [];
  let row = 0;
  for (const d of P.COMMON) {
    const [cls, pr] = CPRES[d.key];
    const rect = cls === "live.dial" ? [pr[0], pr[1], ...DIAL] : pr;
    const extra = cls === "live.text" ? { text: d.short, texton: d.short, mode: 1, fontsize: 9 } : {};
    const Lb = id(), prep = id(), py = 2400 + row++ * 30;
    boxes.push(live(Lb, cls, [3200, py, 60, cls === "live.dial" ? 48 : 18], px(rect), valueof(d, ""), extra, "c_" + d.key),
      A.obj(prep, "prepend " + d.key, [3300, py, 90, 20]));
    lines.push(A.line(Lb, 0, prep, 0), A.line(prep, 0, vFilter, 0));
    if (d.key === "poly") ctx.polyId = Lb;
    if (d.key === "legato") {
      // Legato only decides when Portamento glides: while no oscillator has Portamento a greyed stand-in that still toggles is
      // shown instead (the layout's glide/noglide flags; build-station.js computes them from the three Porta dials).
      const vDim = id(), vSet = id();
      boxes.push(v8ui(vDim, "sid.dimbtn.js", [3200, py + 500, 60, 18], px(rect), "c_legatodim"), A.obj(vSet, "prepend set", [3300, py + 500, 70, 20]));
      lines.push(A.line(Lb, 0, vSet, 0), A.line(vSet, 0, vDim, 0), A.line(vDim, 0, Lb, 0));
      items.push({ name: "c_legato", rect, of: "o1", when: "glide" }, { name: "c_legatodim", rect, of: "o1", when: "noglide" });
      continue;
    }
    items.push({ name: "c_" + d.key, rect });
  }
  // Push: sendall to osc 1–3, the filter/common (including the name) and LFO 1–4 (one button for the whole patch)
  const vBtn = id(), vSel = id(), vSel1 = id(), vMsg = id();
  boxes.push(actionButton(vBtn, [3200, 2500, 60, 15], px(SENDALL_RECT), "Push Patch", SENDALL_TEXT, "c_sendall"),
    A.obj(vSel, "route bang", [3200, 2520, 60, 20]), A.obj(vSel1, "sel 1", [3260, 2520, 40, 20]), A.msg(vMsg, "sendall", [3200, 2545, 50, 20]));
  lines.push(A.line(vBtn, 0, vSel, 0), A.line(vSel, 0, vMsg, 0), A.line(vSel, 1, vSel1, 0), A.line(vSel1, 0, vMsg, 0));
  ctx.sendAllId = vMsg;
  items.push({ name: "c_sendall", rect: SENDALL_RECT });
  // Pull: dump request (05 7F, needs a firmware with dump-request support) via the filter router; the reply comes in through the capture and is loaded into the panels
  const vFetch = id(), vFetchSel = id(), vFetchSel1 = id(), vFetchMsg = id();
  boxes.push(actionButton(vFetch, [3300, 2500, 60, 15], px(FETCH_RECT), "Pull Patch", FETCH_TEXT, "c_fetch"),
    A.obj(vFetchSel, "route bang", [3300, 2520, 60, 20]), A.obj(vFetchSel1, "sel 1", [3360, 2520, 40, 20]), A.msg(vFetchMsg, "fetch", [3300, 2545, 50, 20]));
  lines.push(A.line(vFetch, 0, vFetchSel, 0), A.line(vFetchSel, 0, vFetchMsg, 0), A.line(vFetchSel, 1, vFetchSel1, 0), A.line(vFetchSel1, 0, vFetchMsg, 0),
    A.line(vFetchMsg, 0, vFilter, 0));
  items.push({ name: "c_fetch", rect: FETCH_RECT });
  // Store: 07 7F (needs a firmware with store support) – the synth stores its edit buffer to the current slot; the gateway holds all other
  // traffic until the 47 reply. Push first to store the editor's settings.
  const vStore = id(), vStoreSel = id(), vStoreSel1 = id(), vStoreMsg = id();
  boxes.push(actionButton(vStore, [3400, 2500, 60, 15], px(STORE_RECT), "Store Patch", STORE_TEXT, "c_store"),
    A.obj(vStoreSel, "route bang", [3400, 2520, 60, 20]), A.obj(vStoreSel1, "sel 1", [3460, 2520, 40, 20]), A.msg(vStoreMsg, "store", [3400, 2545, 50, 20]));
  lines.push(A.line(vStore, 0, vStoreSel, 0), A.line(vStoreSel, 0, vStoreMsg, 0), A.line(vStoreSel, 1, vStoreSel1, 0), A.line(vStoreSel1, 0, vStoreMsg, 0),
    A.line(vStoreMsg, 0, vFilter, 0));
  items.push({ name: "c_store", rect: STORE_RECT });
  // Patch Action: the same three actions as a Live parameter, for automation, MIDI mapping and Live's API (the buttons themselves
  // are hidden from Live, see actionButton). A quantized parameter None | Pull patch | Push patch | Store patch, off screen and off
  // Push (in no bank): a value 1-3 -> [sel 0] (None passes nothing) -> [t b i]: the action first (right outlet -> [sel 1 2 3] ->
  // the buttons' messages), then [delay 50] -> [0( back into the menu as a value (not "set": Live follows only a value), so Live
  // shows None again and a saved set holds None: loading sends nothing. The delay: a value sent back in the same event as Live's
  // own update never reached Live's parameter (tried 2026-10-26 via the Extensions API: it stayed at Pull patch). parameter_initial
  // None for a new device; no undo steps.
  const vAct = id(), vActSel0 = id(), vActT = id(), vActSel = id(), vActZero = id(), vActDelay = id();
  boxes.push(live(vAct, "live.menu", [3500, 2500, 100, 15], null, { parameter_longname: ACTION_LONG, parameter_shortname: "Action",
      parameter_type: 2, parameter_enum: ["None", FETCH_TEXT, SENDALL_TEXT, STORE_TEXT], parameter_mmax: 3, parameter_invisible: 0,
      parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0], parameter_visible_undoable: 0 }, {}, "c_action"),
    A.obj(vActSel0, "sel 0", [3500, 2520, 40, 20], 2, ["bang", ""]), A.obj(vActT, "t b i", [3500, 2545, 40, 20], 2, ["bang", "int"]),
    A.obj(vActSel, "sel 1 2 3", [3560, 2570, 70, 20], 4, ["bang", "bang", "bang", ""]), A.obj(vActDelay, "delay 50", [3500, 2570, 50, 20], 1, ["bang"]),
    A.msg(vActZero, "0", [3500, 2595, 30, 20]));
  lines.push(A.line(vAct, 0, vActSel0, 0), A.line(vActSel0, 1, vActT, 0), A.line(vActT, 1, vActSel, 0), A.line(vActT, 0, vActDelay, 0),
    A.line(vActDelay, 0, vActZero, 0), A.line(vActZero, 0, vAct, 0), A.line(vActSel, 0, vFetchMsg, 0), A.line(vActSel, 1, vMsg, 0), A.line(vActSel, 2, vStoreMsg, 0));
  return items;
}

// The overview (sid.map.js): shows/hides oscillator panels via the "Osc n Show" parameters, controls every
// oscillator's Sync/Ring (the same live.text as the buttons in the panel), collapses/expands the envelope part per
// osc (layout engine) and the filter routing (live.text "Osc n Filter" -> v8 sid.filter.js -> DP 00 18 07 00).
function mapPanel(x0, oscs, oscNos, filterShowId, filterEnvId, ctx) {
  const { id, boxes, lines, vFilter, vThis } = ctx;
  const vW = id(), vRoute = id(), vV8 = vFilter;
  ctx.mapId = vW;
  boxes.unshift(frameBox(id(), "mapinnerframe", shifted(MAP_INNER, x0, 0), SHADE.inner), voiceFrame(id(), "mapframe", [x0, 0, MAP_TOTAL, DEVICE_H]));   // the frame + the patch tongue (sid.voicebg.js)
  const vTip = id();
  boxes.push({ box: { ...v8ui(vW, "sid.map.js", [1100, 100, 230, 163], [x0 + PCOL_W, FRAME_Y, MAP_W, FRAME_H], "map").box, numoutlets: 2, outlettype: ["", ""] } },
    A.obj(vRoute, "route show env sync ring route filter fenv off3", [1100, 280, 260, 20], 9, ["", "", "", "", "", "", "", "", ""]),
    // The tooltip layer: the overview's rect, in front of the name display (the layout's fronts); clicks go through it, the
    // hovering it passes on to the overview ("idle x y" / "idleout")
    { box: { ...v8ui(vTip, "sid.tip.js", [1400, 100, 230, 163], [x0 + PCOL_W, FRAME_Y, MAP_W, FRAME_H], "tip").box, ignoreclick: 1 } });
  lines.push(A.line(vW, 0, vRoute, 0), A.line(vW, 1, vTip, 0), A.line(vTip, 0, vW, 0));
  // The patch name: ten characters in a 5×7 dot matrix (sid.name.js). Clicking the display opens a visible [textedit]
  // on top (script sendbox nameedit presentation 1 + bringtofront + select), you type with a cursor, Return
  // (keymode 1) outputs the text -> [route text] (textedit puts the selector "text" first) -> prepend typed -> the display,
  // which hides the field again, shows the name and sends changed characters as namechar. Ten hidden live.numbox "Name 1..10"
  // (ASCII) carry the characters in the set; numbox -> "set char" back + namechar -> f_router -> DP 00 00..00 09 (manual p. 42).
  // Commit on Return: mirroring per keystroke was very slow and unreliable and did not send on Return.
  const vName = id(), vNameRoute = id(), vNameIdx = id();
  const namePres = [x0 + NAME_RECT[0], NAME_RECT[1], NAME_RECT[2], NAME_RECT[3]];
  const nameBox = v8ui(vName, "sid.name.js", [1100, 600, 144, 30], namePres, "name");
  ctx.nameId = vName;                                                   // the gateway's "noreply" warnings are shown here
  nameBox.box.numoutlets = 3; nameBox.box.outlettype = ["", "", ""];        // 0 namechar, 1 to textedit, 2 script to thispatcher
  boxes.push(nameBox,
    A.obj(vNameRoute, "route namechar", [1100, 640, 90, 20], 2, ["", ""]),
    A.obj(vNameIdx, "route 1 2 3 4 5 6 7 8 9 10", [1100, 670, 200, 20], 11, new Array(11).fill("")));
  lines.push(A.line(vName, 0, vNameRoute, 0), A.line(vNameRoute, 0, vNameIdx, 0), A.line(vName, 2, vThis, 0));
  for (let i = 1; i <= 10; i++) {
    const vN = id(), vSet = id(), vTx = id();
    boxes.push(live(vN, "live.numbox", [1100 + i * 50, 700, 40, 18], null,
      { parameter_longname: "Name " + i, parameter_shortname: "N" + i, parameter_type: 1, parameter_mmin: 0, parameter_mmax: 127, parameter_unitstyle: 0,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [32] }, {}, "n_char" + i),
      A.obj(vSet, "prepend set char " + i, [1100 + i * 50, 730, 110, 20]));
    lines.push(A.line(vNameIdx, i - 1, vN, 0), A.line(vN, 0, vSet, 0), A.line(vSet, 0, vName, 0));
    if (vV8) { boxes.push(A.obj(vTx, "prepend namechar " + i, [1100 + i * 50, 760, 110, 20])); lines.push(A.line(vN, 0, vTx, 0), A.line(vTx, 0, vV8, 0)); }
  }
  // The text field: saved in the presentation (presentation 1) but hidden by the layout engine on load (item with rect null) – an
  // object saved with presentation 0 cannot be shown in Live. Shown by the display when clicked.
  const vEdit = id(), vRouteText = id(), vTyped = id();
  boxes.push(A.box(vEdit, "textedit", namePres.slice(),      // patching rect = presentation rect: if it is shown without a rect it still lands in the right place
    { numinlets: 1, numoutlets: 4, outlettype: ["", "int", "", ""], presentation: 1, presentation_rect: namePres, varname: "nameedit",
      keymode: 1, outputmode: 1, lines: 1, wordwrap: 0, tabmode: 1, border: 1, rounded: 3, fontsize: 12, fontname: "Arial",
      bgcolor: [0.1, 0.1, 0.1, 1], bordercolor: [1, 0.6, 0.2, 0.8], textcolor: [1, 0.6, 0.2, 1] }),
    A.obj(vRouteText, "route text", [1300, 670, 70, 20], 2, ["", ""]), A.obj(vTyped, "prepend typed", [1300, 700, 90, 20]));
  lines.push(A.line(vEdit, 0, vRouteText, 0), A.line(vRouteText, 0, vTyped, 0), A.line(vTyped, 0, vName, 0), A.line(vName, 1, vEdit, 0));
  // Esc (key 27 on outlet 1) cancels editing; Tab (9) accepts like Return: a bang makes textedit output its text. tabmode 1 (Max's
  // default) keeps the Tab out of the field – with tabmode 0 it stayed there as four blanks and went out as the name the next time.
  // The bang is still needed: tabmode 1 alone outputs nothing when the text is unchanged, and the field stayed open. If textedit outputs as well, the second "typed" arrives after the field has closed and is ignored.
  const vEsc = id(), vCancel = id();
  boxes.push(A.obj(vEsc, "sel 27 9", [1400, 670, 60, 20], 3, ["bang", "bang", ""]), A.msg(vCancel, "cancel", [1400, 700, 50, 20]));
  lines.push(A.line(vEdit, 1, vEsc, 0), A.line(vEsc, 0, vCancel, 0), A.line(vCancel, 0, vName, 0), A.line(vEsc, 1, vEdit, 0));
  if (filterShowId) {                                            // the Filter box toggles the filter panel
    const vSet = id();
    boxes.push(A.obj(vSet, "prepend set filter", [1100, 500, 100, 20]));
    lines.push(A.line(vRoute, 5, filterShowId, 0), A.line(filterShowId, 0, vSet, 0), A.line(vSet, 0, vW, 0));
  }
  if (filterEnvId) {                                             // the Env box by the filter toggles the filter envelope
    const vSet = id();
    boxes.push(A.obj(vSet, "prepend set fenv", [1100, 530, 100, 20]));
    lines.push(A.line(vRoute, 6, filterEnvId, 0), A.line(filterEnvId, 0, vSet, 0), A.line(vSet, 0, vW, 0));
  }
  for (const n of oscNos) {                                      // ringok n -> the overview (ring arrow dimmed/inert)
    const vP = id();
    boxes.push(A.obj(vP, "prepend set ringok " + n, [1700, 300 + n * 30, 120, 20]));
    lines.push(A.line(oscs[n].ringOkId, 0, vP, 0), A.line(vP, 0, vW, 0));
  }
  // routing parameters
  const routeIds = {};
  for (const n of oscNos) {
    const vT = id(), vPre = id();
    boxes.push(live(vT, "live.text", [1500 + n * 70, 320, 60, 18], shifted(FILTER_BTN, oscs[n].cx0, 0),
      { parameter_longname: "Osc " + n + " Filter", parameter_shortname: "Flt" + n, parameter_type: 2, parameter_enum: ["out", "filter"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [1] }, { text: "Filter", texton: "Filter", mode: 1, fontsize: 9 }, "f_route" + n),
      A.obj(vPre, "prepend route " + n, [1500 + n * 70, 380, 90, 20]));
    lines.push(A.line(vT, 0, vPre, 0), A.line(vPre, 0, vV8, 0));
    routeIds[n] = vT;
  }
  // sync/ring/route: widget -> route 1 2 3 -> live.text; live.text -> prepend set <kind> n -> widget
  for (const [kind, outl, targets] of [["show", 0, (n) => oscs[n].showId], ["env", 1, (n) => oscs[n].envShowId], ["sync", 2, (n) => oscs[n].syncId], ["ring", 3, (n) => oscs[n].ringId], ["route", 4, (n) => routeIds[n]]]) {
    const vR = id();
    boxes.push(A.obj(vR, "route 1 2 3", [1100 + outl * 120, 310, 80, 20], 4, ["", "", "", ""]));
    lines.push(A.line(vRoute, outl, vR, 0));
    for (const n of oscNos) {
      const target = targets(n), vSet = id();
      boxes.push(A.obj(vSet, "prepend set " + kind + " " + n, [1100 + outl * 120, 340 + n * 30, 120, 20]));
      lines.push(A.line(vR, n - 1, target, 0), A.line(target, 0, vSet, 0), A.line(vSet, 0, vW, 0));
    }
  }
  if (ctx.off3Id) {                                              // osc 3's third switch position <-> the hidden "Osc 3 Off" (3OFF)
    const vSet = id();
    boxes.push(A.obj(vSet, "prepend set off3 3", [1100, 560, 110, 20]));
    lines.push(A.line(vRoute, 7, ctx.off3Id, 0), A.line(ctx.off3Id, 0, vSet, 0), A.line(vSet, 0, vW, 0));
  }
  const patchItems = ctx.vFilter ? patchColumn(x0, ctx) : [];
  return { id: "map", kind: "fixed", width: MAP_TOTAL, items: [{ name: "mapinnerframe", rect: MAP_INNER },
    { name: "mapframe", rect: [0, 0, MAP_TOTAL, DEVICE_H], bg: { mode: 2, frame: [FRAME_Y, FRAME_Y + FRAME_H], inner: [INNER_Y, INNER_Y + INNER_H],
      rows: [{ ...PATCH_TONGUE, subs: [0], c: 4 }], subs: [[MAP_INNER[0], MAP_INNER[2]]] } }, { name: "map", rect: [PCOL_W, FRAME_Y, MAP_W, FRAME_H] },
    { name: "name", rect: NAME_RECT }, { name: "nameedit", rect: null }, { name: "tip", rect: [PCOL_W, FRAME_Y, MAP_W, FRAME_H] }].concat(patchItems) };
}

module.exports = { MAP_TOTAL, mapPanel };
