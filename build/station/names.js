// names.js – Live's short names and the labels the device shows instead of them.
// Live's API, and every program driving the device through it, sees only a parameter's short name (name and original_name are both
// the short name for a Max for Live parameter); the long name stays inside the device file. So every short name is unique and says
// what it is: a short form of the long name with its group (Osc1, Filt, LFO1) last. Push shows the short name too and cuts it off at
// the end, while its bank already names the group, so the part that tells parameters apart comes first ("A Osc1", "Tbl Speed Osc1").
// The device itself looks as before: a live.dial no longer shows its name (showname 0), and a live.comment beside it shows the
// label it used to show, lying on the dial's name line and letting clicks through to the dial. Long names never change (sets and automation are restored by them); short names may.

// The rest of a long name after its group, shortened (whole words, first match wins).
const SHORTER = [
  ["Attack", "A"], ["Decay", "D"], ["Sustain", "S"], ["Release", "R"],
  ["PWM Start", "PW"], ["PWM LFO Depth", "PW LFO"], ["PWM LFO", "PW LFO#"], ["PWM", "PW"],
  ["Arp Speed", "Arp"], ["Porta Speed", "Porta"], ["Transpose", "Transp"], ["Vib Depth", "Vib"], ["PB Range", "PB"],
  ["Track Mode", "Track"], ["Fixed Note", "Note"], ["Length", "Len"], ["Filter", "Filt"],
  ["Cutoff", "Cut"], ["Resonance", "Res"], ["Env Depth", "Env Dp"], ["Env Invert", "Inv"], ["LFO Depth", "LFO"], ["LFO Select", "LFO#"], ["LFO Wheel", "Wheel"],
  ["Above Zero", "> 0"], ["Add Depth", "Add Dp"], ["Add LFO", "Add"], ["Ctrl Dest", "Dest"], ["Ctrl Source", "Src"], ["Ctrl Value", "Ctrl"],
  ["Fade In", "Fade"], ["Lace Speed", "Lace Sp"], ["Lace With", "Lace"], ["Invert", "Inv"], ["Off", "Off"],
];
function shorten(rest) {
  for (const [from, to] of SHORTER) if (rest === from || rest.startsWith(from + " ")) return to + rest.slice(from.length);
  return rest;
}
// "Osc 1 Attack" -> "A Osc1", "Filter Env Depth" -> "Env Dp Filt", "LFO2 Lace Speed" -> "Lace Sp LFO2". A table knob says "Tbl" after
// what it sets ("Osc 2 Table Speed" -> "Speed Tbl Osc2": Push's table bank would otherwise show "Tbl" on every knob), and a panel
// switch (hidden/shown) starts with "Show", so "Osc 1 Env" (the envelope panel) is not taken for the envelope.
function shortName(vo) {
  const long = vo.parameter_longname;
  const panel = Array.isArray(vo.parameter_enum) && vo.parameter_enum.join() === "hidden,shown";
  let m, group, rest;
  if ((m = /^Osc (\d) (.+)$/.exec(long))) { group = "Osc" + m[1]; rest = m[2]; }
  else if ((m = /^(LFO\d) (.+)$/.exec(long))) { group = m[1]; rest = m[2]; }
  else if ((m = /^Filter (.+)$/.exec(long))) { group = "Filt"; rest = m[1]; }
  else return long;                                                       // patch-wide: Poly, Legato, HCut, Name 1, Patch Number …
  const table = /^Table (.+)$/.exec(rest);
  const what = rest === "Show" ? "Show" : panel ? "Show " + shorten(rest === "Table" ? "Tbl" : rest) : table ? shorten(table[1]) + " Tbl" : shorten(rest);
  return what + " " + group;
}

// Every parameter gets its short name; every presented live.dial keeps its old label as a live.comment that the layout moves with it.
function renameAll(boxes, panels) {
  const labels = {};                                                      // dial varname -> label varname
  const added = [];
  for (const { box: b } of boxes) {
    const vo = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
    if (!vo || !vo.parameter_longname) continue;
    const old = vo.parameter_shortname;
    vo.parameter_shortname = shortName(vo);
    if (b.maxclass !== "live.dial" || !b.presentation || b.showname === 0) continue;
    b.showname = 0;                                                       // the dial then draws its knob at the top, so it moves down below the label
    const lv = b.varname + "_label", r = b.presentation_rect;
    b.presentation_rect = dialRect(r);
    labels[b.varname] = lv;
    added.push({ box: { id: "obj-" + lv, maxclass: "live.comment", numinlets: 1, numoutlets: 0, text: old, textjustification: 1, fontsize: LABEL_PT, ignoreclick: 1,
      patching_rect: [b.patching_rect[0], b.patching_rect[1] - 16, b.patching_rect[2], 15], presentation: 1, presentation_rect: labelRect(r), varname: lv } });
  }
  boxes.push(...added);
  const follow = (it) => labels[it.name] ? [{ ...it, rect: dialRect(it.rect), ...(it.compact ? { compact: dialRect(it.compact) } : {}) },
    { ...it, name: labels[it.name], rect: labelRect(it.rect), ...(it.compact ? { compact: labelRect(it.compact) } : {}) }] : [it];
  const walk = (p) => { if (p.items) p.items = p.items.flatMap(follow); for (const q of p.sub || []) walk(q); };   // a voice holds its sub-panels
  panels.forEach(walk);
  return added.length;
}
// Where a live.dial draws its name: the top line of its box. Measured against a screenshot of the dials with their own names
// (label, knob and value as fractions of the row pitch): the dial without its name goes 14 px down and ends 1 px lower, and a
// live.comment at 8.5 pt is as wide as the dial's own name at 9 pt.
const LABEL_H = 12, LABEL_PT = 8.5, DIAL_DOWN = 14, DIAL_LONGER = 1;
const labelRect = (r) => [r[0], r[1], r[2], LABEL_H];
const dialRect = (r) => [r[0], r[1] + DIAL_DOWN, r[2], r[3] - DIAL_DOWN + DIAL_LONGER];

module.exports = { shortName, renameAll, LABEL_H };
