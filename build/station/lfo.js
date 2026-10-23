// lfo.js – LFO 1–4, one at a time.
// LFO 1–4: the same voice model as the filter – column [▶] lfo + the selector 1–4 (live.tab "LFO Select", vertical) and one
// sub-panel per LFO, of which only the selected one is visible (layout engine: lfosel/lfoshow). The sub-panel has three parts:
// "Wave" (waveform curve sid.lfoview.js, type menu with symbols, dials Speed/Depth/Fade/S/H), "Restart" (Note on/Note off) + "Shape" (Inv/> 0), "Add" + "Lace" (which LFO and
// how much) and "Control" (source, destination, value). CC 88–95/102–117 where available, otherwise DP (sid.lfo.js).
// One LFO at a time so the device does not grow 4×400 px wider.
// The button column is 72 px: the "Restart LFO" bracket and "Note on"/"Note off" do not fit in 44
const A = require("../amxd");
const P = require("../../lib/params");
const H = require("../../lib/help");
const { PAD, GAP, FRAME_Y, FRAME_H, VOICE_GAP, INNER_Y, INNER_H, FCOL_W, ENV_DIAL_Y, TITLE_Y, SUB_Y, CONTENT_Y, voiceFrameItem, live, valueof, v8ui, SHADE, frameBox, voiceFrame, titleBox, shifted, DIAL } = require("./common");
const { colItems } = require("./voice");

const OPT_W = 72;
const LFO_W = PAD + 192 + GAP + OPT_W + GAP + 92 + GAP + 92 + PAD;
const LFO_ICONS = ["wave-tri.svg", "wave-saw.svg", "lfo-ramp.svg", "wave-pulse.svg", "lfo-rand.svg", "lfo-flat.svg"];   // the type menu with symbols like Waveform
const LX = { wave: PAD, opt: PAD + 192 + GAP, add: PAD + 192 + GAP + OPT_W + GAP, lace: PAD + 192 + GAP + OPT_W + GAP + 48, ctrl: PAD + 192 + GAP + OPT_W + GAP + 92 + GAP };
// The column: four fold buttons "lfo 1".."lfo 4" (22 px apart like the oscillators' fold rows), one open at a time (sid.lfotabs.js).
const LF = { fold: (k) => [PAD + 8, 10 + (k - 1) * 22, 18, 18], label: (k) => [PAD + 28, 11 + (k - 1) * 22, 34, 15],
  frame: [0, INNER_Y, LFO_W, INNER_H], title: [PAD, TITLE_Y, 100, 15], view: [LX.wave, CONTENT_Y, 192, 44],
  sections: [["wavesec", "Wave", [LX.wave, SUB_Y, 192, 13]], ["optsec", "Restart LFO", [LX.opt, SUB_Y, OPT_W, 13]], ["shapesec", "Shape", [LX.opt, 80, OPT_W, 13]], ["addsec", "Add", [LX.add, SUB_Y, 44, 13]],
    ["lacesec", "Lace", [LX.lace, SUB_Y, 44, 13]], ["ctrlsec", "Control", [LX.ctrl, SUB_Y, 92, 13]]] };
// Wave: the curve (sid.lfoview.js) on top, the type selector below, the dials on the same row as in the envelope panels; Restart/Shape: four buttons.
const LPRES = {
  type: ["live.tab", [LX.wave, 86, 192, 16]],
  // "Restart LFO: [Note on] [Note off]" – two moments, can be combined; under "Shape": Inv and > 0
  notesync: ["live.text", [LX.opt, CONTENT_Y, OPT_W, 18]], offsync: ["live.text", [LX.opt, 58, OPT_W, 18]], invert: ["live.text", [LX.opt, 96, OPT_W, 18]], abovezero: ["live.text", [LX.opt, 116, OPT_W, 18]],
  speed: ["live.dial", [LX.wave, ENV_DIAL_Y]], depth: ["live.dial", [LX.wave + 48, ENV_DIAL_Y]], fadein: ["live.dial", [LX.wave + 96, ENV_DIAL_Y]], samphold: ["live.dial", [LX.wave + 144, ENV_DIAL_Y]],
  addlfo: ["live.menu", [LX.add, CONTENT_Y, 44, 18]], adddepth: ["live.dial", [LX.add, 62]],
  lacewith: ["live.menu", [LX.lace, CONTENT_Y, 44, 18]], lace: ["live.dial", [LX.lace, 62]],
  source: ["live.menu", [LX.ctrl, CONTENT_Y, 92, 18]], dest: ["live.menu", [LX.ctrl, 62, 92, 18]], ctrlval: ["live.dial", [LX.ctrl, ENV_DIAL_Y]],
};
const LVIEW_KEYS = ["type", "speed", "depth", "invert", "abovezero", "samphold", "fadein", "notesync", "offsync"];   // what the curve needs
const LVOICE_W = PAD + FCOL_W + VOICE_GAP + LFO_W + PAD;
function lfoPanel(cx0, ctx) {
  const { id, boxes, lines, vLayout, vLoad, vLfo } = ctx;
  const x0 = cx0 + PAD + FCOL_W + VOICE_GAP;
  const pc = (r) => shifted(r, cx0, 0), px = (r) => shifted(r, x0, 0);
  boxes.unshift(voiceFrame(id(), "l_voiceframe", pc([0, FRAME_Y, LVOICE_W, FRAME_H]), ));
  for (let k = 1; k <= 4; k++) boxes.push(titleBox(id(), "l_label" + k, "lfo " + k, pc(LF.label(k))));
  const subs = [];
  for (let n = 1; n <= 4; n++) {
    const pre = "l" + n + "_", by = 100 + (n - 1) * 560;
    boxes.unshift(frameBox(id(), pre + "frame", px(LF.frame), SHADE.inner));
    boxes.push(titleBox(id(), pre + "title", "LFO " + n, px(LF.title)));
    const items = [{ name: pre + "frame", rect: LF.frame }, { name: pre + "title", rect: LF.title }];
    for (const [vn, text, r] of LF.sections) {
      const vS = id(), vL = id();
      boxes.push(v8ui(vS, "sid.section.js", [3500, by, 120, 13], px(r), pre + vn), A.msg(vL, "label " + text, [3500, by + 20, 100, 20]));
      lines.push(A.line(vLoad, 0, vL, 0), A.line(vL, 0, vS, 0));
      items.push({ name: pre + vn, rect: r });
    }
    const vView = id();
    boxes.push(v8ui(vView, "sid.lfoview.js", [3500, by + 200, 192, 44], px(LF.view), pre + "view"));
    items.push({ name: pre + "view", rect: LF.view });
    let row = 0;
    for (const d of P.LFO) {
      const [cls, pr] = LPRES[d.key];
      const rect = cls === "live.dial" ? [pr[0], pr[1], ...DIAL] : pr;
      let extra = {};
      if (cls === "live.text") extra = { text: d.short, texton: d.short, mode: 1, fontsize: 9 };
      if (cls === "live.menu") extra = { fontsize: 9 };
      if (cls === "live.tab") extra = { mode: 0, num_lines_patching: 1, num_lines_presentation: 1, spacing_x: 2, fontsize: 9, pictures: LFO_ICONS, usepicture: 1, remapsvgcolors: 1 };
      const Lb = id(), prep = id(), py = by + 50 + row++ * 30;
      boxes.push(live(Lb, cls, [3200, py, 60, cls === "live.dial" ? 48 : 18], px(rect), valueof(d, "LFO" + n + " "), extra, pre + d.key),
        A.obj(prep, "prepend lfo " + n + " " + d.key, [3300, py, 130, 20]));
      lines.push(A.line(Lb, 0, prep, 0), A.line(prep, 0, vLfo, 0));
      items.push({ name: pre + d.key, rect });
      if (LVIEW_KEYS.includes(d.key)) {
        const setv = id();
        boxes.push(A.obj(setv, "prepend set " + d.key, [3450, py, 110, 20]));
        lines.push(A.line(Lb, 0, setv, 0), A.line(setv, 0, vView, 0));
      }
    }
    subs.push({ id: "l" + n, kind: "osc", fullW: LFO_W, compactW: LFO_W, shift: 0, items, ...(n > 1 ? { initShow: 0 } : {}) });
  }
  // LFO Select (0..3) and LFO Show stay the parameters (hidden); the four fold buttons drive them through sid.lfotabs.js,
  // which also keeps the buttons in step when the parameters change (automation, presets).
  const vSel = id(), vSelPre = id(), vShow = id(), vShowPre = id(), vTabs = id(), vTabsSel = id(), vTabsShow = id(), vTabsRoute = id();
  boxes.push(live(vSel, "live.tab", [3200, 30, 40, 92], null,
      { parameter_longname: "LFO Select", parameter_shortname: "LFO", parameter_type: 2, parameter_enum: ["1", "2", "3", "4"], parameter_mmax: 3,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] },
      { mode: 0, num_lines_patching: 4, num_lines_presentation: 4, spacing_y: 2, fontsize: 9 }, "l_sel"),
    A.obj(vSelPre, "prepend lfosel", [3300, 30, 90, 20]),
    live(vShow, "live.text", [3200, 0, 60, 18], null,
      { parameter_longname: "LFO Show", parameter_shortname: "Show", parameter_type: 2, parameter_enum: ["hidden", "shown"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] }, { text: "Show", texton: "Show", mode: 1, fontsize: 9 }, "l_show"),
    A.obj(vShowPre, "prepend lfoshow", [3300, 0, 90, 20]),
    A.obj(vTabs, "v8 sid.lfotabs.js", [3500, 60, 110, 20], 3, ["", "", ""]),
    A.obj(vTabsSel, "prepend sel", [3500, 30, 70, 20]), A.obj(vTabsShow, "prepend show", [3580, 30, 80, 20]),
    A.obj(vTabsRoute, "route 1 2 3 4", [3500, 90, 100, 20], 5, ["", "", "", "", ""]));
  lines.push(A.line(vSel, 0, vSelPre, 0), A.line(vSelPre, 0, vLayout, 0), A.line(vShow, 0, vShowPre, 0), A.line(vShowPre, 0, vLayout, 0),
    A.line(vSel, 0, vTabsSel, 0), A.line(vTabsSel, 0, vTabs, 0), A.line(vShow, 0, vTabsShow, 0), A.line(vTabsShow, 0, vTabs, 0),
    A.line(vTabs, 0, vSel, 0), A.line(vTabs, 1, vShow, 0), A.line(vTabs, 2, vTabsRoute, 0));
  for (let k = 1; k <= 4; k++) {
    const vFold = id(), vClick = id(), vSet = id();
    boxes.push(v8ui(vFold, "sid.fold.js", [3400, k * 30, 18, 18], pc(LF.fold(k)), "l_fold" + k),
      A.obj(vClick, "prepend click " + k, [3420, k * 30, 90, 20]), A.obj(vSet, "prepend state", [3620, 90 + k * 30, 80, 20]));
    lines.push(A.line(vFold, 0, vClick, 0), A.line(vClick, 0, vTabs, 0), A.line(vTabsRoute, k - 1, vSet, 0), A.line(vSet, 0, vFold, 0));
  }
  // One tongue row per fold button: the open LFO's tongue leads to its panel, all four in one colour (only one
  // is open at a time).
  const lfoRows = [1, 2, 3, 4].map((k) => ({ x: LF.fold(k)[0] - 2, y: LF.fold(k)[1], h: LF.fold(k)[3], subs: [k - 1], c: 3 }));
  const colItems = [voiceFrameItem("l_voiceframe", [0, FRAME_Y, PAD + FCOL_W + PAD, FRAME_H], lfoRows)];
  for (let k = 1; k <= 4; k++) colItems.push({ name: "l_fold" + k, rect: LF.fold(k) }, { name: "l_label" + k, rect: LF.label(k) });
  return { id: "vl", kind: "voice", colW: PAD + FCOL_W, gap: VOICE_GAP, pad: PAD, items: colItems, sub: subs };
}

module.exports = { LVOICE_W, lfoPanel };
