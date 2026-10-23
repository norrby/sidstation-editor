// common.js – what every SidStation panel builder shares: the sizes of the voice frame, the helpers that make live.* boxes
// and v8ui widgets, the voice background (sid.voicebg.js) and the momentary action button.
// --- sizes (relative to the osc panel's left edge) ---------------------------------------
const A = require("../amxd");
const L = require("../../lib/layout");

const PAD = 8, GAP = L.LAYOUT_GAP, FRAME_Y = 3, FRAME_H = 163, DIAL = [44, 48];
const COL_W = 52;                                              // the button column: number + fold buttons, Active/Sync/Ring/Filter
const VOICE_GAP = 10;                                          // space between the column and the sub-panels
const COL_PW = PAD + COL_W;                                    // the column inside the voice panel (left padding + buttons)
const INNER_Y = FRAME_Y + 4, INNER_H = FRAME_H - 8;            // sub-panels inset 4 px so the voice frame shows around them
const FCOL_W = COL_W;                                          // the filter/LFO column, as wide as the oscillators' (a wider one left too long a gap between filter and filter env box)
const ENV_DIAL_Y = 106;                                        // the dial row below the ADSR curve (curve 38..100)
// The sub-panel: heading "Oscillator n"/"Envelope n" at y 10, sub-headings "Waveform"/"Tone" at y 22, content from y 34.
const TITLE_Y = 10, SUB_Y = 22, CONTENT_Y = 38;              // 4 px space below the bracket
// The voice frame: sid.voicebg.js over the device's whole height, which draws the divider and a tongue from every open fold
// row to its panel, one colour per row (mode 1).
const DEVICE_H = 169;
function voiceFrameItem(name, rect, rows) {
  return { name, rect: [0, 0, rect[2], DEVICE_H], frame: true,
    bg: { mode: 1, frame: [FRAME_Y, FRAME_Y + FRAME_H], inner: [INNER_Y, INNER_Y + INNER_H], rows } };
}

// --- helpers ----------------------------------------------------------------
const OUTS = { "live.menu": [3, ["", "", "float"]], "live.tab": [3, ["", "", "float"]], "live.dial": [2, ["", "float"]], "live.slider": [2, ["", "float"]],
  "live.numbox": [2, ["", "float"]], "live.toggle": [1, [""]], "live.text": [2, ["", ""]] };
function live(id, cls, rect, pres, vo, extra = {}, varname = vo.parameter_longname) {
  const [n, types] = OUTS[cls];
  return { box: { id, maxclass: cls, numinlets: 1, numoutlets: n, outlettype: types, parameter_enable: 1,
    patching_rect: rect, ...(pres ? { presentation: 1, presentation_rect: pres } : {}),
    varname, saved_attribute_attributes: { valueof: vo }, ...extra } };
}
const UNIT = { int: 0, semitones: 7 };
function valueof(d, longPrefix) {
  const vo = { parameter_longname: longPrefix + d.name, parameter_shortname: d.short, parameter_modmode: 0, parameter_initial_enable: 1, parameter_initial: [d.init] };
  if (d.unit === "enum") Object.assign(vo, { parameter_type: 2, parameter_enum: d.labels, parameter_mmax: d.labels.length - 1 });
  else if (d.unit === "bool") Object.assign(vo, { parameter_type: 2, parameter_enum: ["off", "on"], parameter_mmax: 1 });
  else Object.assign(vo, { parameter_type: 1, parameter_mmin: d.min, parameter_mmax: d.max, parameter_unitstyle: UNIT[d.unit] });
  return vo;
}
// border 0: otherwise v8ui draws a black outline (around the overview and fold buttons).
const v8ui = (id, file, rect, pres, varname) => ({ box: { id, maxclass: "v8ui", filename: file, numinlets: 1, numoutlets: 1, outlettype: [""],
  parameter_enable: 0, border: 0, patching_rect: rect, ...(pres ? { presentation: 1, presentation_rect: pres } : {}), varname,
  textfile: { filename: file, flags: 0, embed: 0, autowatch: 1 } } });
const plain = (id, maxclass, rect, pres, extra = {}) => ({ box: { id, maxclass, numinlets: 1, patching_rect: rect,
  ...(pres ? { presentation: 1, presentation_rect: pres } : {}), ...extra } });
// Panel in Live's style: lighter filled area, rounded corners, no outline.
const SHADE = { outer: [1, 1, 1, 0.07], inner: [0, 0, 0, 0.14], halo: [0.85, 0.87, 0.92, 0.26], dim: [0.24, 0.24, 0.24, 0.6] };   // halo: the overview's frame
const frameBox = (boxId, name, rect, shade = SHADE.outer, rounded = 6) => plain(boxId, "panel", [1100, 30, 60, 60], rect, { varname: name, numinlets: 1, numoutlets: 0, mode: 0, border: 0, rounded,
  bgcolor: shade, bgfillcolor_type: "color", bgfillcolor_color: shade });
// The voice frame box: see voiceFrameItem.
const voiceFrame = (boxId, name, rect) => ({ box: { ...v8ui(boxId, "sid.voicebg.js", [1100, 30, 60, 60], [rect[0], 0, rect[2], DEVICE_H], name).box, numoutlets: 0, outlettype: [], ignoreclick: 1 } });
const titleBox = (boxId, name, text, rect, fontsize = 9) => A.comment(boxId, text, [1100, 100, 80, 18], rect, { varname: name, fontsize, fontface: 1 });
const shifted = (rect, dx, dy) => [rect[0] + dx, rect[1] + dy, rect[2], rect[3]];

// Momentary live.text (mode 0) like Live's own buttons; its output goes through [route bang] + [sel 1] so that either a bang or a 1
// triggers (sel 1 alone did not fire in Live): flat, follows the theme (textbutton drew a gradient).
// Hidden from automation and not stored (parameter_invisible 2): it only triggers.
function actionButton(boxId, rect, pres, longname, text, varname) {
  return live(boxId, "live.text", rect, pres, { parameter_longname: longname, parameter_shortname: text, parameter_type: 2,
    parameter_enum: ["off", "on"], parameter_mmax: 1, parameter_invisible: 2, parameter_modmode: 0 },
    { text, texton: text, mode: 0, fontsize: 9 }, varname);
}

module.exports = { PAD, GAP, FRAME_Y, FRAME_H, DIAL, COL_W, VOICE_GAP, COL_PW, INNER_Y, INNER_H, FCOL_W, ENV_DIAL_Y, TITLE_Y, SUB_Y, CONTENT_Y, DEVICE_H, voiceFrameItem, live, valueof, v8ui, plain, SHADE, frameBox, voiceFrame, titleBox, shifted, actionButton };
