// maxlog.js – shared log for all v8/v8ui scripts (bundled in by the build scripts).
// Everything goes to the Max console. For troubleshooting it can also go to a file – loading, arming, refused messages and,
// above all, exceptions caught in message handlers (sidguard) – but only when the log folder exists, since Max cannot create
// folders: create ~/Library/Logs/SidStation (macOS) to get max.log there. (Windows: not checked yet.)
//   sidlog(tag, ...parts)      write one line (post + file)
//   sidguard(tag, fn)          return fn wrapped in a try/catch that logs errors
const SIDLOG_FILE = "~/Library/Logs/SidStation/max.log";

function sidlog(tag) {
  const parts = Array.prototype.slice.call(arguments, 1).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)));
  const line = (function (d) { return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? "0" : "") + n; }).join(":"); })(new Date()) + " [" + tag + "] " + parts.join(" ");
  try { post(line + "\n"); } catch (e) {}
  try {
    if (typeof File === "undefined") return;
    const f = new File(SIDLOG_FILE, "write", "TEXT");
    if (f.isopen) { f.position = f.eof; f.writestring(line + "\n"); f.close(); }
  } catch (e) {}
}

function sidguard(tag, fn) {
  return function () {
    try { return fn.apply(this, arguments); }
    catch (e) {
      const where = e && e.stack ? " | " + String(e.stack).split("\n").slice(0, 2).join(" ") : "";
      sidlog(tag, "ERROR in " + (fn.name || "?") + "(" + Array.prototype.slice.call(arguments).join(" ") + "): " + (e && e.message || e) + where);
    }
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { sidlog, sidguard };


// params.js – parameter table for the SidStation editor. Shared by Node (tests,
// build scripts) and v8 in Live (bundled by build/build-station.js into dist/sid.osc.js).
//
// Each row: key (message name in the patcher), name/short (Live parameter names),
// ccOff (position in the oscillator's group of 16, base 34/50/72; osc2 skips 64–69),
// dumpOff (+offset in the 21-byte oscillator block, base 36/57/78), min/max in
// the synth's own scale, unit (int | semitones | bool | enum), init (Live value
// when the device is added). CC scaling [H]: cc = round((v−min)·127/(max−min)),
// v = min + round(cc·(max−min)/127); lossless for every range of ≤ 128 steps.

const ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 240, 500, 800, 1000, 3000, 5000, 8000];
const DECAY_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];
const fmtMs = (ms) => (ms >= 1000 ? ms / 1000 + " s" : ms + " ms");
// Note names in Live's convention (C3 = 60). The SidStation display uses C-5 = 60
// (tracker style, manual: 45 = A-3); we follow Live since the panel lives there.
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);

// dp: [mask, shift] for the Direct Program row at address OSC_DP_BASE[osc] + dumpOff
// (the DP address space for the osc blocks has the same offsets as the dump) [M p. 42].
// Rows without dp (sync, ring) are missing from the manual's DP table and go via CC only.
const B7 = [0x7f, 0], B4 = [0x0f, 0];
const OSC = [
  { key: "active",     name: "Active",        short: "Active", cc: [24, 25, 26], dumpOff: null, min: 0, max: 1, unit: "bool", init: 1 },
  { key: "wave",       name: "Wave",          short: "Wave",   dumpOff: 15, dp: [0x0f, 4], min: 0, max: 5, unit: "enum",
    // Off (code 0): no waveform selected in the SID, a silent oscillator (some patches have it). Last, so saved sets keep their index.
    labels: ["Tri", "Saw", "Pulse", "Mixed", "Noise", "Off"], codes: [1, 2, 4, 5, 8, 0], init: 2 },
  { key: "pwsync",     name: "PWM Sync",      short: "PW Sync", dumpOff: 0, dp: [0x01, 0], min: 0, max: 1, unit: "bool", init: 1 },
  { key: "gate",       name: "Gate",          short: "Gate",   dumpOff: 0,  dp: [0x01, 1], min: 0, max: 1, unit: "bool", init: 0 },
  { key: "pbrange",    name: "PB Range",      short: "PB",     dumpOff: 5,  dp: B7, min: 0, max: 24, unit: "semitones", init: 2 },
  { key: "pwlfo",      name: "PWM LFO",       short: "PW LFO#", dumpOff: 13, dp: [0x03, 0], min: 0, max: 3, unit: "enum", labels: ["LFO 1", "LFO 2", "LFO 3", "LFO 4"], init: 0 },
  { key: "viblfo",     name: "Vib LFO",       short: "Vib LFO", dumpOff: 17, dp: [0x03, 0], min: 0, max: 3, unit: "enum", labels: ["LFO 1", "LFO 2", "LFO 3", "LFO 4"], init: 0 },
  { key: "arp",        name: "Arp Speed",     short: "Arp",    ccOff: 0,  dumpOff: 2, dp: B7,  min: 0,   max: 127, unit: "int", init: 0 },
  // Track: the manual says 1..99 but the synth goes to 100 (E-8) [H]. The synth's
  // CC scaling only reaches 99 (ccMax), so 100 goes via DP – the rule in sid.osc.js: CC when
  // the value fits losslessly in the CC range, otherwise DP.
  // UI: Key follow button + value box in MIDI notes (two Live parameters, one synth value; see sid.osc.js keyfollow/tracknote).
  { key: "track",      name: "Pitch/Track",   short: "Track",  ccOff: 1,  dumpOff: 1, dp: B7,  ccMax: 99, min: 0, max: 100, unit: "int", init: 0, ui: "track" },
  { key: "transpose",  name: "Transpose",     short: "Transp", ccOff: 2,  dumpOff: 3, dp: B7,  min: -24, max: 24,  unit: "semitones", init: 0 },
  { key: "vibdepth",   name: "Vib Depth",     short: "Vib",    ccOff: 3,  dumpOff: 18, dp: B7, min: 0,   max: 127, unit: "int", init: 0 },
  { key: "detune",     name: "Detune",        short: "Detune", ccOff: 4,  dumpOff: 4, dp: B7,  min: -64, max: 63,  unit: "int", init: 0 },
  { key: "porta",      name: "Porta Speed",   short: "Porta",  ccOff: 5,  dumpOff: 16, dp: B7, min: 0,   max: 127, unit: "int", init: 0 },
  { key: "sync",       name: "Sync",          short: "Sync",   ccOff: 6,  dumpOff: 15, bit: 1, min: 0, max: 1, unit: "bool", init: 0 },
  { key: "ring",       name: "Ring",          short: "Ring",   ccOff: 7,  dumpOff: 15, bit: 2, min: 0, max: 1, unit: "bool", init: 0 },
  { key: "pwstart",    name: "PWM Start",     short: "PW",     ccOff: 8,  dumpOff: 11, dp: B7, min: 0, max: 127, unit: "int", init: 64 },
  { key: "pwadd",      name: "PWM Add",       short: "PW Add", ccOff: 9,  dumpOff: 12, dp: B7, min: 0, max: 127, unit: "int", init: 0 },
  { key: "pwlfodepth", name: "PWM LFO Depth", short: "PW LFO", ccOff: 10, dumpOff: 14, dp: B7, min: 0, max: 127, unit: "int", init: 0 },
  { key: "delay",      name: "Delay",         short: "Delay",  ccOff: 11, dumpOff: 10, dp: B7, min: 0, max: 127, unit: "int", init: 0 },
  { key: "attack",     name: "Attack",        short: "A",      ccOff: 12, dumpOff: 6, dp: B4,  min: 0, max: 15, unit: "enum", labels: ATTACK_MS.map(fmtMs), init: 0 },
  { key: "decay",      name: "Decay",         short: "D",      ccOff: 13, dumpOff: 7, dp: B4,  min: 0, max: 15, unit: "enum", labels: DECAY_MS.map(fmtMs), init: 9 },
  { key: "sustain",    name: "Sustain",       short: "S",      ccOff: 14, dumpOff: 8, dp: B4,  min: 0, max: 15, unit: "int", init: 15 },
  { key: "release",    name: "Release",       short: "R",      ccOff: 15, dumpOff: 9, dp: B4,  min: 0, max: 15, unit: "enum", labels: DECAY_MS.map(fmtMs), init: 4 },
  // the waveform table's speed, 0 = no table (DP 00 5b / 00 70 / 01 05, manual p. 42); no CC
  { key: "tablespeed", name: "Table Speed",   short: "Speed",  dumpOff: 20, dp: B7, min: 0, max: 127, unit: "int", init: 0 },
];

// Waveform tables (manual p. 42-43): table n starts at DP address 01 76 / 02 78 / 03 7a (246/376/506); row k is the
// 16-bit word at base + 2k (DATA1) and base + 2k + 1 (DATA2), programmed as four DP messages in sequence, mask 0f,
// shift 4 then shift 0 on each byte. 65 rows (TABLE_ROWS; the manual's 32 is wrong for OS R33).
const TABLE_DP_BASE = [246, 376, 506];
const TABLE_ROWS = 65;                                   // the OS plays 65 steps per table (R33 $9619), 130 bytes each
function tableDP(osc, row, d1, d2) {
  const a = TABLE_DP_BASE[osc - 1] + 2 * row;
  return [[a, 0x0f, 4, d1 >> 4], [a, 0x0f, 0, d1 & 15], [a + 1, 0x0f, 4, d2 >> 4], [a + 1, 0x0f, 0, d2 & 15]];
}

const OSC_CC_BASE = [34, 50, 72];
const OSC_DP_BASE = [0x47, 0x5c, 0x71];
const DP_COMMON_FLAGS = 0x16;   // bit 0..2 = osc 1..3 on/off

// CC number for an oscillator parameter (osc 1..3). Osc2 skips 64–69:
// sustain/release are on 70/71.
function oscCC(osc, def) {
  if (def.cc) return def.cc[osc - 1];
  let cc = OSC_CC_BASE[osc - 1] + def.ccOff;
  if (osc === 2 && def.ccOff >= 14) cc = 70 + (def.ccOff - 14);
  return cc;
}
// Direct Program row {addr, mask, shift} for an oscillator parameter, or null.
function oscDP(osc, def) {
  if (def.key === "active") return { addr: DP_COMMON_FLAGS, mask: 0x01, shift: osc - 1 };
  if (!def.dp) return null;
  return { addr: OSC_DP_BASE[osc - 1] + def.dumpOff, mask: def.dp[0], shift: def.dp[1] };
}
// Common DP rows (manual): filter routing = three bits in idx 24 (FLT3 FLT2 FLT1) and filter type = three
// bits in idx 25 (HP BP LP, SID bitmask, shown as a type menu); both are written as one field by the filter router.
// CC 119 on the track's MIDI (a clip or a controller button), value > 0: Push patch. At most one push per PUSH_CC_GAP_MS (a push
// takes about a second), so a short looping clip cannot flood the synth. Unused by the synth (manual p. 38) and undefined in
// MIDI; the editor keeps it, it never reaches the synth.
const PUSH_CC = 119, PUSH_CC_GAP_MS = 5000;
const NAME_LEN = 10;            // PATCH_NAME: ten ASCII characters, DP rows 00 00 7f 00 … 00 09 7f 00 [M p. 42]
const COMMON_DP = { filterRouting: { addr: 0x18, mask: 0x07, shift: 0 }, filterType: { addr: 0x19, mask: 0x07, shift: 0 } };
// The filter [M]: CC 27–33 for cutoff, env depth, LFO depth, A, D, S, R (all 0..127); the rest via DP.
// field/bit: the bit belongs to a field (COMMON_DP[field]) that the router writes as a whole; field/values: menu choice -> whole field.
const FILTER = [
  { key: "cutoff",   name: "Filter Cutoff",       short: "Cutoff", cc: 27, dp: [0x1a, 0x7f, 0], min: 0, max: 127, unit: "int", init: 100 },
  { key: "res",      name: "Filter Resonance",    short: "Res",            dp: [0x18, 0x0f, 4], min: 0, max: 15,  unit: "int", init: 0 },
  { key: "envdepth", name: "Filter Env Depth",    short: "F Env",  cc: 28, dp: [0x1b, 0x7f, 0], min: 0, max: 127, unit: "int", init: 0 },
  { key: "lfodepth", name: "Filter LFO Depth",    short: "F LFO",  cc: 29, dp: [0x20, 0x7f, 0], min: 0, max: 127, unit: "int", init: 0 },
  { key: "fattack",  name: "Filter Attack",       short: "A",      cc: 30, dp: [0x1c, 0x7f, 0], min: 0, max: 127, unit: "int", init: 0 },
  { key: "fdecay",   name: "Filter Decay",        short: "D",      cc: 31, dp: [0x1d, 0x7f, 0], min: 0, max: 127, unit: "int", init: 64 },
  { key: "fsustain", name: "Filter Sustain",      short: "S",      cc: 32, dp: [0x1e, 0x7f, 0], min: 0, max: 127, unit: "int", init: 127 },
  { key: "frelease", name: "Filter Release",      short: "R",      cc: 33, dp: [0x1f, 0x7f, 0], min: 0, max: 127, unit: "int", init: 32 },
  { key: "wheel",    name: "Filter LFO Wheel",    short: "Wheel",          dp: [0x21, 0x7f, 0], min: 0, max: 127, unit: "int", init: 0 },
  { key: "flfo",     name: "Filter LFO Select",   short: "F LFO#",         dp: [0x19, 0x03, 4], min: 0, max: 3, unit: "enum", labels: ["LFO 1", "LFO 2", "LFO 3", "LFO 4"], init: 0 },
  // The type menu as on the SidStation (manual pp. 25–26): seven combinations of the SID bits LP/BP/HP; values = the field value.
  // Not named "Filter Type": Push would draw its four filter images and show nothing at all for the other three values.
  { key: "ftype",    name: "Filter Type",         short: "Type", field: "filterType", values: [1, 2, 3, 4, 5, 6, 7], min: 0, max: 6, unit: "enum",
    labels: ["Lowp", "Band", "L/B", "High", "L/H", "B/H", "All"], init: 0 },
  { key: "wrap",     name: "Filter Wrap",         short: "Wrap",           dp: [0x16, 0x01, 6], min: 0, max: 1, unit: "bool", init: 0 },
  { key: "invert",   name: "Filter Env Invert",   short: "Inv",            dp: [0x16, 0x01, 7], min: 0, max: 1, unit: "bool", init: 0 },
  // 3OFF: the SID's MODE/VOL bit 7 – voice 3 is not heard on the direct path (it still runs, so it can sync/ring osc 1). The firmware
  // copies the filter-type byte $19 straight into MODE/VOL ($9334), so bit 3 of $19 reaches the chip. Shown as the
  // third position of osc 3's switch in the overview, like a three-way switch on a diagram of the chip.
  { key: "off3",     name: "Osc 3 Off",           short: "3OFF",           dp: [0x19, 0x01, 3], min: 0, max: 1, unit: "bool", init: 0 },
  // "Filter Sync Note On" (DP 00 16 01 04) is left out: the DP table lists it, but neither R33 nor R34 reads PATCH_MODE bit 4, and
  // on the synth Sync on/off gave the same filter curve.
];
// Patch-wide [M pp. 41–42]: Poly/Single and Legato (bits in PATCH_MODE 0x16, own DP rows) and HCut (0x23, 0..15).
// Sync Speed (0x22) is left out on purpose: the dumps have 100/107/150/200 but the DP row is 7 bits (mask 7f), so 150/200
// cannot be sent; Direct Controllers (0x0a–0x15) wait for the target list.
const COMMON = [
  { key: "poly",   name: "Poly",   short: "Poly",   dp: [0x16, 0x01, 3], min: 0, max: 1,  unit: "bool", init: 0 },
  { key: "legato", name: "Legato", short: "Legato", dp: [0x16, 0x01, 5], min: 0, max: 1,  unit: "bool", init: 0 },
  { key: "hcut",   name: "HCut",   short: "HCut",   dp: [0x23, 0x0f, 0], min: 0, max: 15, unit: "int",  init: 0 },
];
// LFO 1–4 [M pp. 41–42]: DP blocks 01 06 / 01 22 / 01 3e / 01 5a (decimal 134/162/190/218), same +offset as the dump block
// (base 99/110/121/132, 11 bytes). Six parameters per LFO have CC (ccOff in LFO_CC); the rest DP. Type and source share byte +0,
// options and destination byte +1 – DP writes only its masked bits, so each row is sent separately.
// Type codes per the OS's own menu table ($D861 in OS 1.10 R33): 0 Tri, 1 Saw, 2 Rmp, 3 Sqr, 4 Rnd, 5 Flat (6–7 "Err");
// the manual's DP row says "4=DC", the dump table "7 Flat" – the OS decides.
const LFO_LABELS = ["LFO 1", "LFO 2", "LFO 3", "LFO 4"];
const LFO = [
  { key: "type",     name: "Type",       short: "Type",   dumpOff: 0,  dp: [0x07, 0], min: 0, max: 5,  unit: "enum", labels: ["Tri", "Saw", "Ramp", "Pulse", "Rand", "Flat"], init: 0 },
  { key: "speed",    name: "Speed",      short: "Speed",  dumpOff: 2,  dp: B7, ccOff: 0, min: 0, max: 127, unit: "int", init: 40 },
  { key: "depth",    name: "Depth",      short: "Depth",  dumpOff: 4,  dp: B7, ccOff: 1, min: 0, max: 127, unit: "int", init: 0 },
  { key: "fadein",   name: "Fade In",    short: "Fade",   dumpOff: 10, dp: B7, ccOff: 3, min: 0, max: 127, unit: "int", init: 0 },
  { key: "samphold", name: "S/H",        short: "S/H",    dumpOff: 3,  dp: B7, ccOff: 4, min: 0, max: 127, unit: "int", init: 0 },
  { key: "notesync", name: "Sync On",    short: "At note on",   push: "LFO Sync", dumpOff: 1,  dp: [0x01, 0], min: 0, max: 1, unit: "bool", init: 1 },
  { key: "invert",   name: "Invert",     short: "Inv",    dumpOff: 1,  dp: [0x01, 1], min: 0, max: 1, unit: "bool", init: 0 },
  { key: "abovezero",name: "Above Zero", short: "> 0",    dumpOff: 1,  dp: [0x01, 2], min: 0, max: 1, unit: "bool", init: 0 },
  { key: "offsync",  name: "Sync Off",   short: "At note off",    dumpOff: 1,  dp: [0x01, 3], min: 0, max: 1, unit: "bool", init: 0 },
  { key: "addlfo",   name: "Add LFO",    short: "Add",    dumpOff: 5,  dp: [0x03, 0], min: 0, max: 3, unit: "enum", labels: LFO_LABELS, init: 0 },
  { key: "adddepth", name: "Add Depth",  short: "Add Dp", dumpOff: 8,  dp: B7, ccOff: 2, min: 0, max: 127, unit: "int", init: 0 },
  { key: "lacewith", name: "Lace With",  short: "Lace",   dumpOff: 7,  dp: [0x07, 0], min: 0, max: 4, unit: "enum", labels: ["Zero"].concat(LFO_LABELS), init: 0 },
  { key: "lace",     name: "Lace Speed", short: "Lace Sp", dumpOff: 6, dp: B7, ccOff: 5, min: 0, max: 127, unit: "int", init: 0 },
  { key: "source",   name: "Ctrl Source", short: "Src",   dumpOff: 0,  dp: [0x0f, 4], min: 0, max: 11, unit: "enum",
    labels: ["Wheel", "Bend", "Velocity", "Aftertouch", "CC 20", "CC 21", "CC 22", "CC 23"].concat(LFO_LABELS), init: 0 },
  { key: "dest",     name: "Ctrl Dest",  short: "Dest",   dumpOff: 1,  dp: [0x07, 4], min: 0, max: 4, unit: "enum", labels: ["None", "Depth", "Speed", "S/H", "Lace"], init: 0 },
  { key: "ctrlval",  name: "Ctrl Value", short: "Ctrl",   dumpOff: 9,  dp: B7, min: 0, max: 127, unit: "int", init: 0 },
];
const LFO_DP_BASE = [134, 162, 190, 218];
const LFO_DUMP_BASE = [99, 110, 121, 132];
// CC [M]: LFO1 88–93, LFO2 94–95 + 102–105 (96–101 skipped), LFO3 106–111, LFO4 112–117;
// order speed, depth, add depth, fade in, S/H, lace speed.
function lfoCC(n, def) {
  if (def.ccOff === undefined) return null;
  const cc = 88 + (n - 1) * 6 + def.ccOff;
  return cc >= 96 ? cc + 6 : cc;
}
function lfoDP(n, def) { return { addr: LFO_DP_BASE[n - 1] + def.dumpOff, mask: def.dp[0], shift: def.dp[1] }; }
// Whitelist "addr:mask:shift" of all DP rows we know from the manual.
function dpRows() {
  const rows = new Set();
  for (let osc = 1; osc <= 3; osc++) for (const d of OSC) { const r = oscDP(osc, d); if (r) rows.add(r.addr + ":" + r.mask + ":" + r.shift); }
  for (const r of Object.values(COMMON_DP)) rows.add(r.addr + ":" + r.mask + ":" + r.shift);
  for (const d of FILTER.concat(COMMON)) if (d.dp) rows.add(d.dp[0] + ":" + d.dp[1] + ":" + d.dp[2]);
  for (let n = 1; n <= 4; n++) for (const d of LFO) { const r = lfoDP(n, d); rows.add(r.addr + ":" + r.mask + ":" + r.shift); }
  for (let i = 0; i < NAME_LEN; i++) rows.add(i + ":127:0");                    // the patch name: one character per address 00 00..00 09 [M p. 42]
  for (let osc = 1; osc <= 3; osc++) for (let k = 0; k < TABLE_ROWS; k++) for (const [a, m, sh] of tableDP(osc, k, 0, 0)) rows.add(a + ":" + m + ":" + sh);
  return rows;
}
function toCC(v, min, max) { return Math.round((v - min) * 127 / (max - min)); }
function fromCC(cc, min, max) { return min + Math.round(cc * (max - min) / 127); }

const SidParams = { OSC, TABLE_DP_BASE, TABLE_ROWS, tableDP, FILTER, COMMON, LFO, LFO_DP_BASE, LFO_DUMP_BASE, lfoCC, lfoDP, OSC_CC_BASE, OSC_DP_BASE, COMMON_DP, PUSH_CC, PUSH_CC_GAP_MS, NAME_LEN, ATTACK_MS, DECAY_MS, fmtMs, noteName, oscCC, oscDP, dpRows, toCC, fromCC };
if (typeof module !== "undefined" && module.exports) module.exports = SidParams;


// sid.load.js – v8: receives a decoded patch dump (SysEx 02) and sets the panels from it.
// Bundled with lib/maxlog.js + lib/params.js (dist/sid.load.js). The path: the built-in capture [v8 sid.capture.js] -> deferlow -> here ->
// [deferlow] -> this script -> [thispatcher]. The capture has no midiout and the editor's midiin drops SysEx;
// the only thing that travels between the devices is the already decoded byte list.
//
// Every parameter is set with "script send <varname> <value>" to thispatcher, i.e. the live.* object gets
// the value as if it had been turned: graphs, slider and overview follow without new patch cords.
// FIRST the routers get "quiet": sending to the synth is shut off for 1.5 s, so the dump is never echoed back as
// CC/DP (an echo like that has erased the patch memory once).
//
// Arguments: which blocks the device has, e.g. "1 2 3 f l" (osc 1..3, the filter, LFO 1..4). Default all.
// In:  patch <byte...>   decoded raw bytes: 10 characters of name + dump index 10..  (common 0..35, osc 36/57/78 + 21)
// Out: outlet 0 -> [thispatcher]: "script send <varname> <value>" (also n_char1..10 = the patch name's ASCII)

inlets = 1;
outlets = 1;

const blocks = (typeof jsarguments !== "undefined" ? jsarguments.slice(1) : []).map(String);
if (!blocks.length) blocks.push("1", "2", "3", "f", "l");
const DUMP_OSC_BASE = [36, 57, 78];                                      // the dump's osc blocks (DP has other addresses)
const COMMON_FLAGS = 0x16;                                               // idx 22: bit 0..2 = osc 1..3 on
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const signed = (b) => (b > 127 ? b - 256 : b);                           // two's complement 8 bits [H: transpose F4 = −12]

// The oscillator parameter's value from the dump, or null if it cannot be read (logged).
function oscValue(p, n, d) {
  if (d.key === "active") return (p[COMMON_FLAGS] >> (n - 1)) & 1;
  if (d.dumpOff === null || d.dumpOff === undefined) return null;
  const byte = p[DUMP_OSC_BASE[n - 1] + d.dumpOff];
  if (d.bit !== undefined) return (byte >> d.bit) & 1;                   // sync/ring: bits in the wave byte
  if (!d.dp) return null;
  if (d.min < 0) return clamp(signed(byte), d.min, d.max);               // transpose/detune: the whole byte signed
  const raw = (byte >> d.dp[1]) & d.dp[0];
  if (d.codes) {                                                         // waveform: SID code -> menu index
    const i = d.codes.indexOf(raw);
    if (i < 0) { sidlog("load", "osc" + n, "unknown wave code", raw); return null; }
    return i;
  }
  return clamp(raw, d.min, d.max);
}
// The LFO parameter's value from the LFO block (base 99/110/121/132), or null if it is outside the menu (logged).
function lfoValue(p, n, d) {
  const raw = (p[SidParams.LFO_DUMP_BASE[n - 1] + d.dumpOff] >> d.dp[1]) & d.dp[0];
  if (raw < d.min || raw > d.max) { sidlog("load", "lfo" + n, d.key, "value out of range", raw); return null; }
  return raw;
}
// The filter parameter's value from the common block (same index as the DP addresses).
function filterValue(p, d) {
  if (d.field) {
    const r = SidParams.COMMON_DP[d.field], raw = (p[r.addr] >> r.shift) & r.mask;
    const i = d.values.indexOf(raw);
    if (i < 0) { sidlog("load", d.key, "value outside the menu", raw); return null; }
    return i;
  }
  return clamp((p[d.dp[0]] >> d.dp[2]) & d.dp[1], d.min, d.max);
}

function patch() {
  const p = arrayfromargs(arguments).map(Number);
  if (p.length < DUMP_OSC_BASE[2] + 21 || p.some((b) => !Number.isFinite(b))) { sidlog("load", "invalid patch, length", p.length); return; }
  const name = String.fromCharCode.apply(null, p.slice(0, 10)).trim();
  const msgs = [];
  const send = (vn, v) => msgs.push([vn, v]);
  for (const b of blocks) send(b === "f" ? "f_router" : b === "l" ? "l_router" : "o" + b + "_router", "quiet");   // quiet before anything moves
  for (const b of blocks) {
    const n = Number(b);
    if (!(n >= 1 && n <= 3)) continue;
    for (const d of SidParams.OSC) {
      const v = oscValue(p, n, d);
      if (v === null) continue;
      if (d.key === "track") {                                           // one synth value, two controls: Key follow (0) | Note n
        if (v > 0) send("o" + n + "_tracknote", v);
        send("o" + n + "_trackmode", v > 0 ? 1 : 0);
      } else send("o" + n + "_" + d.key, v);
    }
  }
  if (blocks.indexOf("f") >= 0) {
    for (const d of SidParams.FILTER) { const v = filterValue(p, d); if (v !== null) send("f_" + d.key, v); }
    const routing = SidParams.COMMON_DP.filterRouting, bits = (p[routing.addr] >> routing.shift) & routing.mask;
    for (let n = 1; n <= 3; n++) send("f_route" + n, (bits >> (n - 1)) & 1);
    for (const d of SidParams.COMMON) { const v = filterValue(p, d); if (v !== null) send("c_" + d.key, v); }   // the Patch panel (same router)
  }
  if (blocks.indexOf("l") >= 0 && p.length >= SidParams.LFO_DUMP_BASE[3] + 11)
    for (let n = 1; n <= 4; n++) for (const d of SidParams.LFO) { const v = lfoValue(p, n, d); if (v !== null) send("l" + n + "_" + d.key, v); }
  if (blocks.indexOf("f") >= 0) for (let i = 0; i < SidParams.NAME_LEN; i++) if (p[i] <= 127) send("n_char" + (i + 1), p[i]);   // the name: hidden Name 1..10 -> sid.name.js + DP
  for (const [vn, v] of msgs) outlet(0, "script", "send", vn, v);
  // Waveform tables (dump index 143.., three after each other) go to the table widget, which passes them on to its (muted)
  // router as the new baseline. A table without End/Loop is 65 real steps: the OS plays all 65 and its own editor lists 0..64,
  // so it is loaded too.
  // The patch's Sync Speed (index 34) is not sent to the table playheads: with System Sync = Globl the synth's global
  // speed applies instead. Pull also asks for the system settings (06) and settings() sets the rate that applies.
  let i = 143, tables = 0;
  for (let t = 1; t <= 3 && i < p.length; t++) {
    const b = []; let term = false;
    while (i < p.length && b.length < 130) {
      if (p[i] === 0xff) { b.push(0xff); i++; term = true; break; }
      b.push(p[i], p[i + 1]);
      if (p[i] === 0xfe) { i += 2; term = true; break; }
      i += 2;
    }
    if (!term) sidlog("load", "table", t, "without End/Loop: 65 steps");
    if (blocks.indexOf(String(t)) >= 0 && b.length <= 2 * SidParams.TABLE_ROWS) { outlet(0, ["script", "send", "o" + t + "_table", "bytes"].concat(b)); tables++; }
  }
  sidlog("load", "patch '" + name + "' -> " + (msgs.length - blocks.length) + " values, " + tables + " tables");
}
// settings <rateHz> <source> <slot> <globalSpeed> <patchSpeed> <baseCh> <lock> (the 46 reply, via the capture): the update rate
// that applies now goes to the table playheads.
function settings(hz, source, slot) {
  const r = Number(hz);
  if (!(r >= 10 && r <= 400)) { sidlog("load", "settings: implausible rate", hz); return; }
  for (const b of blocks) if (Number(b) >= 1 && Number(b) <= 3) outlet(0, "script", "send", "o" + b + "_table", "rate", r);
  if (blocks.indexOf("l") >= 0) for (let n = 1; n <= 4; n++) outlet(0, "script", "send", "l" + n + "_view", "rate", r);   // the LFO curves' Hz and seconds
  sidlog("load", "settings: update rate " + r + " Hz (source " + source + ", slot " + slot + ") -> table playheads, LFO views");
}
function stored() { sidlog("load", "store reply", arrayfromargs(arguments).join(" ")); }
function replied() {}                                                    // for the gateway (the reply wait), nothing to load
function anything() { post("sid.load: unknown message " + messagename + "\n"); }

patch = sidguard("load", patch); settings = sidguard("load", settings);
sidlog("load", "loaded (" + blocks.join(" ") + ")");
