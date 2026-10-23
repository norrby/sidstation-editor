// filter.js – the filter voice: the response curve and its dials, and the filter envelope.
const A = require("../amxd");
const P = require("../../lib/params");
const { PAD, GAP, FRAME_Y, FRAME_H, VOICE_GAP, INNER_Y, INNER_H, FCOL_W, ENV_DIAL_Y, TITLE_Y, SUB_Y, CONTENT_Y, voiceFrameItem, live, valueof, v8ui, SHADE, frameBox, voiceFrame, titleBox, shifted, DIAL } = require("./common");
const { colItems, envItems } = require("./voice");

const FILTER_W = PAD + 224 + GAP + 44 + GAP + 44 + PAD;          // graph + dial column + legend column
// The filter: the same model as a voice – column [▶] filter / [▶] env (always visible) + two sub-panels:
// "Filter" (the frequency response sid.filtcurve.js 224×62, below it Cutoff/Res/LFO depth/Wheel, column Type/LFO choice/Wrap/Sync)
// and "Filter Envelope" (ADSR widget 128 steps with hidden live.dial A/D/S/R, Env depth, Invert). Both 290 px, the same
// structure: graph + four dials + right column. The frequency response shows cutoff, type, resonance and the sweep bands for
// Env depth (+Inv) and LFO depth; the envelope graph shows only the shape over time. The parameters "Filter Show"/"Filter Env"
// (hidden live.text) are toggled by the fold buttons; Show also by the Filter box in the overview. CC 27–33 where available, otherwise DP.
const FENV_W = PAD + 224 + GAP + 44 + PAD;                     // ADSR widget + column for Env depth/Invert
// The column has no oscillator number: the buttons are 8 px in instead of 16, so "filter" fits before the frame.
const F = { fold: [PAD + 8, 10, 18, 18], label: [PAD + 28, 11, 34, 15], envfold: [PAD + 8, 32, 18, 18], envlabel: [PAD + 28, 33, 34, 15],
  frame: [0, INNER_Y, FILTER_W, INNER_H], title: [PAD, TITLE_Y, 100, 15], section: [PAD, SUB_Y, 224, 13], curve: [PAD, CONTENT_Y, 224, 62],
  typelabel: [PAD + 224 + GAP, CONTENT_Y, 44, 13], lfolabel: [PAD + 224 + GAP, 76, 44, 13], legend: [PAD + 224 + GAP + 44 + GAP, CONTENT_Y, 44, 62],
  envframe: [0, INNER_Y, FENV_W, INNER_H], envtitle: [PAD, TITLE_Y, 120, 15], envsection: [PAD, SUB_Y, 224, 13], adsr: [PAD, CONTENT_Y, 224, 62],
  depthlabel: [PAD + 224 + 2, SUB_Y + 2, 44, 13], depthslider: [PAD + 224 + 2, CONTENT_Y, 24, 62 + 14] };
const FVOICE_W = PAD + FCOL_W + VOICE_GAP + FILTER_W + VOICE_GAP + FENV_W + PAD;
const CURVE_STYLE = Number(process.env.CURVE_STYLE || 1);        // the frequency response variant (1 bands+ghost curves, 2 bands, 3 ghost curves)
// key -> [class, rect | [x,y] | null = hidden, env: true = in the envelope panel]
const FPRES = {
  cutoff: ["live.dial", [PAD, ENV_DIAL_Y]], res: ["live.dial", [PAD + 48, ENV_DIAL_Y]], lfodepth: ["live.dial", [PAD + 96, ENV_DIAL_Y]], wheel: ["live.dial", [PAD + 144, ENV_DIAL_Y]],
  ftype: ["live.menu", [PAD + 224 + GAP, CONTENT_Y + 14, 44, 18]],                 // the SidStation's Type menu (Lowp … All)
  flfo: ["live.menu", [PAD + 224 + GAP, 90, 44, 18]], wrap: ["live.text", [PAD + 224 + GAP, 114, 44, 18]],
  off3: ["live.text", null],                                                       // hidden: the overview's osc 3 switch shows it
  // Env depth: a hidden live.dial behind our own slider sid.vslider.js (F.depthslider) right next to the graph – the bar
  // grows from the top when Inv is on. Label "Env" above, Inv below.
  envdepth: ["live.dial", null, true],
  invert: ["live.text", [PAD + 224 + 2, ENV_DIAL_Y + 14, 44, 18], true],
  fattack: ["live.dial", [PAD, ENV_DIAL_Y], true], fdecay: ["live.dial", [PAD + 48, ENV_DIAL_Y], true], fsustain: ["live.dial", [PAD + 96, ENV_DIAL_Y], true], frelease: ["live.dial", [PAD + 144, ENV_DIAL_Y], true],
};
function filterPanel(cx0, ctx) {
  const { id, boxes, lines, vLayout, vLoad, vFilter } = ctx;
  const pre = "f_", x0 = cx0 + PAD + FCOL_W + VOICE_GAP, ex0 = x0 + FILTER_W + VOICE_GAP;
  const pc = (r) => shifted(r, cx0, 0), px = (r) => shifted(r, x0, 0), pe = (r) => shifted(r, ex0, 0);
  boxes.unshift(frameBox(id(), pre + "frame", px(F.frame), SHADE.inner), frameBox(id(), pre + "envframe", pe(F.envframe), SHADE.inner));
  boxes.unshift(voiceFrame(id(), pre + "voiceframe", pc([0, FRAME_Y, FVOICE_W, FRAME_H]), ));
  boxes.push(titleBox(id(), pre + "label", "filter", pc(F.label)), titleBox(id(), pre + "envlabel", "env", pc(F.envlabel)),
    titleBox(id(), pre + "title", "Filter", px(F.title)), titleBox(id(), pre + "envtitle", "Filter Envelope", pe(F.envtitle)),
    A.comment(id(), "Type", [2300, 40, 60, 18], px(F.typelabel), { varname: pre + "typelabel", fontsize: 9 }),
    A.comment(id(), "LFO", [2300, 55, 60, 18], px(F.lfolabel), { varname: pre + "lfolabel", fontsize: 9 }),
    A.comment(id(), "Depth", [2300, 85, 60, 18], pe(F.depthlabel), { varname: pre + "depthlabel", fontsize: 9 }));
  const vDepthSl = id(), vDepthInv = id();
  boxes.push(v8ui(vDepthSl, "sid.vslider.js", [2500, 100, 24, 76], pe(F.depthslider), pre + "depthslider"), A.obj(vDepthInv, "prepend invert", [2500, 70, 90, 20]));
  lines.push(A.line(vDepthInv, 0, vDepthSl, 0));
  const vCurve = id(), vCurveCfg = id(), vLegend = id();
  boxes.push(v8ui(vCurve, "sid.filtcurve.js", [2600, 100, 224, 62], px(F.curve), pre + "curve"), A.msg(vCurveCfg, "style " + CURVE_STYLE, [2600, 70, 80, 20]),
    v8ui(vLegend, "sid.legend.js", [2850, 100, 44, 62], px(F.legend), pre + "legend"));           // switchable layers: Env/Sus/LFO/Cut
  lines.push(A.line(vLoad, 0, vCurveCfg, 0), A.line(vCurveCfg, 0, vCurve, 0), A.line(vLegend, 0, vCurve, 0));
  // the ADSR widget (128 steps/levels, raw values – no time table in the manual) + the "ADSR" bracket
  const vAdsr = id(), cfgA = id(), vRouteA = id(), vS = id(), vL = id();
  boxes.push(v8ui(vAdsr, "sid.adsr.js", [2300, 100, 224, 150], pe(F.adsr), pre + "adsr"), A.msg(cfgA, "steps 128, levels 128, sustainlen 16, labels 0, units s Hz", [2300, 70, 260, 20]),
    A.obj(vRouteA, "route attack decay sustain release", [2300, 270, 220, 20], 5, ["", "", "", "", ""]),
    v8ui(vS, "sid.section.js", [2300, 300, 120, 13], pe(F.envsection), pre + "envsection"), A.msg(vL, "label ADSR", [2300, 330, 100, 20]));
  lines.push(A.line(vLoad, 0, cfgA, 0), A.line(cfgA, 0, vAdsr, 0), A.line(vAdsr, 0, vRouteA, 0), A.line(vLoad, 0, vL, 0), A.line(vL, 0, vS, 0));
  // The "Response" bracket above the frequency response, like "ADSR" in the envelope panel
  const vFS = id(), vFL = id();
  boxes.push(v8ui(vFS, "sid.section.js", [2600, 300, 120, 13], px(F.section), pre + "section"), A.msg(vFL, "label Response", [2600, 330, 100, 20]));
  lines.push(A.line(vLoad, 0, vFL, 0), A.line(vFL, 0, vFS, 0));
  const items = [{ name: pre + "frame", rect: F.frame }, { name: pre + "title", rect: F.title }, { name: pre + "section", rect: F.section }, { name: pre + "curve", rect: F.curve }, { name: pre + "legend", rect: F.legend },
    { name: pre + "typelabel", rect: F.typelabel }, { name: pre + "lfolabel", rect: F.lfolabel }];
  const envItems = [{ name: pre + "envframe", rect: F.envframe }, { name: pre + "envtitle", rect: F.envtitle }, { name: pre + "envsection", rect: F.envsection }, { name: pre + "adsr", rect: F.adsr },
    { name: pre + "depthlabel", rect: F.depthlabel }, { name: pre + "depthslider", rect: F.depthslider }];
  const ADSR = { fattack: ["attack", 0], fdecay: ["decay", 1], fsustain: ["sustain", 2], frelease: ["release", 3] };
  // What the graphs are told: the envelope graph height + direction, the frequency response everything that shapes it (no cutoff as baseline in
  // the envelope graph: cutoff is not part of the envelope picture – it shows in the frequency response instead).
  const MOD = { envdepth: "depth", invert: "invert" };
  const CURVE = { cutoff: "cutoff", res: "res", lfodepth: "lfodepth", ftype: "type", envdepth: "depth", invert: "invert", fsustain: "sustain" };
  let row = 0;
  for (const d of P.FILTER) {
    const [cls, pr, env] = FPRES[d.key];
    const rect = !pr ? null : cls === "live.dial" ? [pr[0], pr[1], ...DIAL] : pr;
    let extra = {};
    if (cls === "live.text") extra = { text: d.short, texton: d.short, mode: 1, fontsize: 9 };
    if (cls === "live.menu") extra = { fontsize: 9 };
    if (cls === "live.slider") extra = { showname: 0, shownumber: 1, fontsize: 9 };
    const Lb = id(), prep = id(), py = 100 + row++ * 30;
    boxes.push(live(Lb, cls, [1900, py, 60, 18], rect && (env ? pe : px)(rect), valueof(d, ""), extra, pre + d.key), A.obj(prep, "prepend " + d.key, [2000, py, 90, 20]));
    lines.push(A.line(Lb, 0, prep, 0), A.line(prep, 0, vFilter, 0));
    if (rect) (env ? envItems : items).push({ name: pre + d.key, rect });
    if (ADSR[d.key]) {                                                     // widget <-> hidden dial (the same pattern as the voices)
      const [wname, back] = ADSR[d.key], setp = id();
      boxes.push(A.obj(setp, "prepend set " + wname, [2100, py, 110, 20]));
      lines.push(A.line(Lb, 0, setp, 0), A.line(setp, 0, vAdsr, 0), A.line(vRouteA, back, Lb, 0));
    }
    if (MOD[d.key]) {
      const setm = id();
      boxes.push(A.obj(setm, "prepend set " + MOD[d.key], [2100, py, 110, 20]));
      lines.push(A.line(Lb, 0, setm, 0), A.line(setm, 0, vAdsr, 0));
    }
    if (d.key === "envdepth") {                                            // dial <-> our own slider
      const sets = id();
      boxes.push(A.obj(sets, "prepend set", [2500, py, 70, 20]));
      lines.push(A.line(Lb, 0, sets, 0), A.line(sets, 0, vDepthSl, 0), A.line(vDepthSl, 0, Lb, 0));
    }
    if (d.key === "invert") lines.push(A.line(Lb, 0, vDepthInv, 0));
    if (d.key === "off3") ctx.off3Id = Lb;                                  // the overview's three-way switch for osc 3         // Inv flips the slider
    if (CURVE[d.key]) {
      const setc = id();
      boxes.push(A.obj(setc, "prepend set " + CURVE[d.key], [2600, py, 110, 20]));
      lines.push(A.line(Lb, 0, setc, 0), A.line(setc, 0, vCurve, 0));
    }
  }
  // the Show/Env parameters + the fold buttons in the column
  const vShow = id(), vEnvShow = id();
  const toggles = [{ p: vShow, long: "Filter Show", short: "Show", msg: "show f", fold: F.fold, vn: "show", fvn: "fold", y: 30 },
    { p: vEnvShow, long: "Filter Env", short: "Env", msg: "env f", fold: F.envfold, vn: "envshow", fvn: "envfold", y: 60 }];
  for (const t of toggles) {
    const vPre = id(), vFold = id(), vSet = id();
    boxes.push(live(t.p, "live.text", [1900, t.y, 60, 18], null,
      { parameter_longname: t.long, parameter_shortname: t.short, parameter_type: 2, parameter_enum: ["hidden", "shown"], parameter_mmax: 1,
        parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [0] }, { text: t.short, texton: t.short, mode: 1, fontsize: 9 }, pre + t.vn),
      A.obj(vPre, "prepend " + t.msg, [2000, t.y, 90, 20]));
    lines.push(A.line(t.p, 0, vPre, 0), A.line(vPre, 0, vLayout, 0));
    boxes.push(v8ui(vFold, "sid.fold.js", [2100, t.y, 18, 18], pc(t.fold), pre + t.fvn), A.obj(vSet, "prepend state", [2200, t.y, 80, 20]));
    lines.push(A.line(vFold, 0, t.p, 0), A.line(t.p, 0, vSet, 0), A.line(vSet, 0, vFold, 0));
  }
  const colItems = [voiceFrameItem(pre + "voiceframe", [0, FRAME_Y, PAD + FCOL_W + PAD, FRAME_H], [F.fold, F.envfold].map((f, i) => ({ x: f[0] - 2, y: f[1], h: f[3], subs: [i] }))),
    { name: pre + "fold", rect: F.fold }, { name: pre + "label", rect: F.label }, { name: pre + "envfold", rect: F.envfold }, { name: pre + "envlabel", rect: F.envlabel }];
  return { panel: { id: "vf", kind: "voice", colW: PAD + FCOL_W, gap: VOICE_GAP, pad: PAD, items: colItems,
    sub: [{ id: "f", kind: "osc", fullW: FILTER_W, compactW: FILTER_W, shift: 0, items }, { id: "fe", kind: "env", owner: "f", width: FENV_W, items: envItems }] }, showId: vShow, envShowId: vEnvShow };
}

module.exports = { FVOICE_W, filterPanel };
