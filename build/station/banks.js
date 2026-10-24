// banks.js – the parameter banks Push (and other control surfaces) show: 8 parameters per bank, by long name.
// Left out: the show/hide tabs, the table data, the name letters and the one-shot buttons (Push/Pull/Store patch), so
// a stray touch on a controller can never send or store a patch.
const osc = (n) => {
  const o = (s) => "Osc " + n + " " + s;
  return [
    ["Osc" + n, [o("Wave"), o("PWM Start"), o("PWM Add"), o("PWM LFO Depth"), o("Transpose"), o("Detune"), o("Sync"), o("Ring")]],
    ["Osc" + n + " Env", [o("Attack"), o("Decay"), o("Sustain"), o("Release"), o("Delay"), o("Gate"), o("Active"), o("Porta Speed")]],
    ["Osc" + n + " Mod", [o("Vib Depth"), o("Vib LFO"), o("PWM LFO"), o("PWM Sync"), o("Arp Speed"), o("PB Range"), o("Table Speed"), o("Track Mode")]],
  ];
};
const lfo = (n) => {
  const l = (s) => "LFO" + n + " " + s;
  return [
    ["LFO" + n, [l("Type"), l("Speed"), l("Depth"), l("Fade In"), l("S/H"), l("Invert"), l("Above Zero"), l("Sync On")]],
    ["LFO" + n + " Mod", [l("Sync Off"), l("Add LFO"), l("Add Depth"), l("Lace With"), l("Lace Speed"), l("Ctrl Source"), l("Ctrl Dest"), l("Ctrl Value")]],
  ];
};

const BANKS = [
  ["Main", ["Filter Cutoff", "Filter Resonance", "Filter Type", "Filter Env Depth", "Filter LFO Depth", "Osc 1 Active", "Osc 2 Active", "Osc 3 Active"]],
  ["Patch", ["Poly", "Legato", "HCut", "Osc 3 Off", "Osc 1 Fixed Note", "Osc 2 Fixed Note", "Osc 3 Fixed Note", null]],
  ["Filter", ["Filter Cutoff", "Filter Resonance", "Filter Type", "Filter Env Depth", "Filter LFO Depth", "Filter LFO Select", "Filter Env Invert", "Filter Wrap"]],
  ["Filter Env", ["Filter Attack", "Filter Decay", "Filter Sustain", "Filter Release", "Filter LFO Wheel", "Osc 1 Filter", "Osc 2 Filter", "Osc 3 Filter"]],
  ...osc(1), ...osc(2), ...osc(3),
  ...lfo(1), ...lfo(2), ...lfo(3), ...lfo(4),
];

// patcher.parameters as Max saves it: every parameter by box id, and the banks as lists of long names ("-" = empty slot).
function parameters(boxes) {
  const ids = new Map(), out = {};
  for (const { box: b } of boxes) {
    const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
    if (v && v.parameter_longname) { ids.set(v.parameter_longname, b.id); out[b.id] = [v.parameter_longname, v.parameter_shortname, 0]; }
  }
  const banks = {};
  BANKS.forEach(([name, params], i) => {
    if (params.length !== 8) throw new Error("bank " + name + ": " + params.length + " parameters, not 8");
    banks[i] = { index: i, name, parameters: params.map((p) => {
      if (p === null) return "-";
      if (!ids.has(p)) throw new Error("bank " + name + ": no parameter " + p);
      return p;
    }) };
  });
  out.parameterbanks = banks;
  out.inherited_shortname = 1;
  return out;
}

module.exports = { BANKS, parameters };
