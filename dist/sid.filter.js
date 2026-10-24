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


// sysex.js – SidStation SysEx: split into frames, decode dumps, validate.
// Used in Node (require) and bundled into v8 scripts by build-*.js.
// Facts marked [H] were verified on hardware.

const SID_HEADER = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00];
const ID_CLEAR = 0x01, ID_DUMP = 0x02, ID_SKIP = 0x03, ID_DP = 0x04;
// 05 = dump request, exists ONLY in a modified firmware (R33 + a routine at $B400-$B4B3), not in Elektron's OS
// (which ignores id 05). Frame: header 05 <slot 0..99 | 7F = current> F7; the reply is an 02 or 03 frame.
const ID_REQUEST = 0x05;
// 06 = system settings request, 07 7F = store the edit buffer to the current slot: the same modified firmware
// only. Replies have id 40 + the request id (46, 47), every value as two nibbles, low first.
const ID_SETTINGS = 0x06, ID_STORE = 0x07, ID_SETTINGS_REPLY = 0x46, ID_STORE_REPLY = 0x47;
const SETTINGS_VALUES = 15, STORE_VALUES = 8;
const STORE_STATUS = ["stored", "memory full", "invalid slot", "busy"];

function splitFrames(bytes) {
  const frames = []; let cur = null, stray = 0;
  for (const b of bytes) {
    if (b === 0xf0) { if (cur) stray += cur.length; cur = [b]; continue; }
    if (!cur) { stray++; continue; }
    if (b >= 0xf8) continue;                       // realtime inside the frame
    cur.push(b);
    if (b === 0xf7) { frames.push(cur); cur = null; }
  }
  if (cur) stray += cur.length;
  return { frames, stray };
}

function hasSidHeader(f) { return SID_HEADER.every((v, i) => f[i] === v); }

// Patch dump (02): name in ASCII, the rest low nibble first [H].
function decodeDump(m) {
  const r = { id: m[6], ok: false };
  if (!hasSidHeader(m)) { r.err = "bad header"; return r; }
  if (m[6] !== ID_DUMP) { r.err = "not a patch dump (id " + m[6] + ")"; return r; }
  r.version = m[7];
  r.size = (m[8] << 7) | m[9];
  let k = 10, pad = 0;
  while (k < m.length && m[k] === 0x2d) { pad++; k++; }
  r.pad = pad; r.marker = m[k++];
  const body = m.slice(k, m.length - 1);
  r.name = String.fromCharCode.apply(null, body.slice(0, 10));
  const nib = body.slice(10);
  r.oddNibbles = nib.length % 2;
  r.badNibble = nib.some((x) => x > 0x0f);
  const patch = body.slice(0, 10);
  for (let i = 0; i + 1 < nib.length; i += 2) patch.push((nib[i + 1] << 4) | nib[i]);
  r.patch = patch;
  r.ok = true;
  return r;
}

// Tables from index 143: steps of 2 bytes, LOOP FE xx, END FF (1 byte) [H],
// at most 65 steps without END [H].
function tableInfo(p) {
  const tables = []; let i = 143;
  for (let t = 0; t < 3 && i < p.length; t++) {
    const steps = []; let term = "";
    while (i < p.length && steps.length < 65) {
      if (p[i] === 0xff) { term = "END"; i++; break; }
      if (p[i] === 0xfe) { term = "LOOP"; steps.push([p[i], p[i + 1]]); i += 2; break; }
      steps.push([p[i], p[i + 1]]); i += 2;
    }
    tables.push({ steps, term });
  }
  return { tables, unterminated: tables.filter((t) => !t.term).length, end: i };
}

// Nominal size = decoded bytes + 1 per unterminated table [H].
function validateFrame(f) {
  const v = { id: f[6], ok: false, reason: "" };
  if (f[0] !== 0xf0 || f[f.length - 1] !== 0xf7) return fail(v, "missing F0/F7");
  if (!hasSidHeader(f)) return fail(v, "not a SidStation patch header");
  if (f.slice(1, -1).some((b) => b > 0x7f)) return fail(v, "data byte > 7F");
  if (v.id === ID_CLEAR) {
    if (f.length !== 23 || f[7] !== 0x45 || f.slice(8, 22).some((b) => b !== 0x2d)) return fail(v, "01 frame has the wrong shape");
    return ok(v);
  }
  if (v.id === ID_SKIP) return f.length === 8 ? ok(v) : fail(v, "03 frame has the wrong length");
  if (v.id !== ID_DUMP) return fail(v, "id " + v.id + " is not sent");
  const r = decodeDump(f);
  v.name = r.name;
  if (r.version !== 0) return fail(v, "version " + r.version);
  if (r.pad !== 24 || r.marker !== 0x45) return fail(v, "pad/marker");
  if (r.oddNibbles) return fail(v, "odd number of nibbles");
  if (r.badNibble) return fail(v, "nibble > 0F");
  if (r.patch.length < 146 || r.patch.length > 143 + 3 * 130) return fail(v, "implausible length " + r.patch.length);
  const t = tableInfo(r.patch);
  if (t.end !== r.patch.length) return fail(v, "tables end at " + t.end + " of " + r.patch.length);
  if (r.size !== r.patch.length + t.unterminated) return fail(v, "size " + r.size + " vs " + r.patch.length + "+" + t.unterminated);
  return ok(v);
}
function ok(v) { v.ok = true; return v; }
function fail(v, why) { v.reason = why; return v; }

// Encode a patch (raw bytes incl. 10 name bytes, tables with END) as an 02 frame.
// The inverse of decodeDump: decodeDump(encodeDump(p)).patch == p.
function encodeDump(patch) {
  const body = patch.slice(0, 10);
  for (const b of patch.slice(10)) body.push(b & 0x0f, (b >> 4) & 0x0f);
  const size = patch.length + tableInfo(patch).unterminated;
  const pad = []; for (let i = 0; i < 24; i++) pad.push(0x2d);
  return SID_HEADER.concat([ID_DUMP, 0x00, (size >> 7) & 0x7f, size & 0x7f], pad, [0x45], body, [0xf7]);
}

// Validate a whole file. Positions: 03 counts up, 02 is stored at the current one [M].
function validateBank(bytes) {
  const { frames, stray } = splitFrames(bytes);
  const rows = []; let pos = 0;
  frames.forEach((f, i) => {
    const v = validateFrame(f);
    rows.push({ i, pos, id: f[6], ok: v.ok, reason: v.reason, name: v.name, len: f.length });
    if (f[6] === ID_SKIP) pos++;
  });
  return { frames, rows, stray, positions: pos };
}

// Direct Program (id 04) [M pp. 42–43]: F0 00 20 3C 01 00 04 Ph Pl mask shift value F7.
// The address is 14 bits (Ph<<7 | Pl); mask and shift select the field in the target byte,
// value is the field's value (≤ mask). The manual: send only documented rows,
// anything else can crash the unit and destroy patch memory. So we validate
// the shape here and the sender additionally requires the row to be in params.js.
const DP_MASKS = [0x01, 0x03, 0x07, 0x0f, 0x7f];
function validateDPFields(addr, mask, shift, value) {
  if (!Number.isInteger(addr) || addr < 0 || addr > 0x3fff) return fail({}, "DP: address outside 14 bits");
  if (DP_MASKS.indexOf(mask) < 0) return fail({}, "DP: unknown mask");
  if (!Number.isInteger(shift) || shift < 0 || shift > 7 || ((mask << shift) & ~0xff)) return fail({}, "DP: shift outside the byte");
  if (!Number.isInteger(value) || value < 0 || value > mask) return fail({}, "DP: value outside the mask");
  return ok({});
}
function encodeDP(addr, mask, shift, value) {
  const v = validateDPFields(addr, mask, shift, value);
  if (!v.ok) throw new Error(v.reason);
  return SID_HEADER.concat([ID_DP, (addr >> 7) & 0x7f, addr & 0x7f, mask, shift, value, 0xf7]);
}
function validateRequestFrame(f) {
  if (f.length !== 9 || !hasSidHeader(f) || f[6] !== ID_REQUEST || f[8] !== 0xf7) return fail({}, "request: wrong frame shape (9 bytes, id 05)");
  if (!(f[7] <= 99 || f[7] === 0x7f)) return fail({}, "request: slot must be 0..99 or 7F");
  return ok({});
}
function encodeRequest(slot) {
  const f = SID_HEADER.concat([ID_REQUEST, slot, 0xf7]);
  const v = validateRequestFrame(f);
  if (!v.ok) throw new Error(v.reason);
  return f;
}
function validateSettingsFrame(f) {
  if (f.length !== 8 || !hasSidHeader(f) || f[6] !== ID_SETTINGS || f[7] !== 0xf7) return fail({}, "settings: wrong frame shape (8 bytes, id 06)");
  return ok({});
}
function encodeSettingsRequest() { return SID_HEADER.concat([ID_SETTINGS, 0xf7]); }
function validateStoreFrame(f) {
  if (f.length !== 9 || !hasSidHeader(f) || f[6] !== ID_STORE || f[7] !== 0x7f || f[8] !== 0xf7) return fail({}, "store: wrong frame shape (9 bytes, id 07, slot 7F only)");
  return ok({});
}
function encodeStore() { return SID_HEADER.concat([ID_STORE, 0x7f, 0xf7]); }
// A 46 or 47 reply: exact length, header, nibbles only. Returns { ok, id, ... } or { ok: false, reason }.
function decodeReply(f) {
  const id = f[6], n = id === ID_SETTINGS_REPLY ? SETTINGS_VALUES : id === ID_STORE_REPLY ? STORE_VALUES : 0;
  if (!n || !hasSidHeader(f)) return fail({}, "not a 46/47 reply");
  if (f.length !== 8 + 2 * n || f[f.length - 1] !== 0xf7) return fail({}, "reply " + id.toString(16) + ": wrong length " + f.length);
  const nib = f.slice(7, -1);
  if (nib.some((b) => b > 0x0f)) return fail({}, "reply " + id.toString(16) + ": byte > 0F");
  const v = [];
  for (let k = 0; k < nib.length; k += 2) v.push(nib[k] | (nib[k + 1] << 4));
  const w = (k) => (v[k] << 8) | v[k + 1];
  if (id === ID_SETTINGS_REPLY) {
    if (v[0] !== 1) return fail({}, "settings reply: unknown format version " + v[0]);
    const r = { ok: true, id, version: v[0], baseCh: v[1], slot: v[2], loaded: v[3], source: v[4], globalSpeed: v[5], globalHCut: v[6],
      sysexDump: v[7], patchSpeed: v[8], patchHCut: v[9], period: w(10), extPeriod: w(12), lock: v[14] };
    // The update rate that applies now: 250000 / period (timer 250 kHz, $FA71); with ExtCl and a running clock the measured period.
    const per = r.source === 2 && r.lock && r.extPeriod ? r.extPeriod : r.period;
    r.rateHz = per ? 250000 / per : 0;
    return r;
  }
  return { ok: true, id, status: v[0], statusText: STORE_STATUS[v[0]] || "unknown status " + v[0], slot: v[1], size: w(2), sum: w(4), free: w(6) };
}
// Checksum the store reply gives: 16-bit sum of the stored patch bytes (as decodeDump().patch for terminated tables).
function storeSum(patch) { return patch.reduce((a, b) => (a + b) & 0xffff, 0); }
function validateDPFrame(f) {
  if (f.length !== 13 || !hasSidHeader(f) || f[6] !== ID_DP || f[12] !== 0xf7) return fail({}, "DP: wrong frame shape (13 bytes, id 04)");
  if (f.slice(1, 12).some((b) => b > 0x7f)) return fail({}, "DP: byte > 7F");
  return validateDPFields((f[7] << 7) | f[8], f[9], f[10], f[11]);
}

const api = { SID_HEADER, ID_CLEAR, ID_DUMP, ID_SKIP, ID_DP, ID_REQUEST, validateRequestFrame, encodeRequest,
  ID_SETTINGS, ID_STORE, ID_SETTINGS_REPLY, ID_STORE_REPLY, validateSettingsFrame, encodeSettingsRequest, validateStoreFrame, encodeStore,
  decodeReply, storeSum, STORE_STATUS, splitFrames, hasSidHeader, decodeDump, encodeDump, tableInfo, validateFrame, validateBank,
  encodeDP, validateDPFrame, validateDPFields };
if (typeof module !== "undefined" && module.exports) module.exports = api;


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


// sid.filter.js – v8 router for the filter (common parameters). Built together with lib/maxlog.js,
// lib/sysex.js, lib/params.js (dist/sid.filter.js). Sends "frame <bytes…>" on outlet 1 (the patcher takes it to the gateway).
// Same rule as the osc router: CC when the parameter has a CC (27–33, all 0..127), otherwise Direct
// Program. Two fields are written as a whole because the SID stores the bits in the same byte:
//   routing (FLT1..3, DP 00 18 07 00) via "route <n> <0|1>", type (LP/BP/HP, DP 00 19 07 00) via the ftype menu 0..6.
// In:  <param> <v>      cutoff res envdepth lfodepth fattack fdecay fsustain frelease wheel flfo ftype wrap invert poly legato hcut
//      route <n> <0|1>  osc n through the filter (1) or straight to the output (0)
//      namechar <i> <code>  the patch name's character i (1..10), ASCII -> DP 00 0(i-1) 7f 00 (from sid.name.js via the Name parameters)
//      arm              start sending (on load the values from live.* come first)
//      sendall          send everything now
//      quiet [ms]       patch dump on its way in (sid.load.js): send nothing for 1.5 s

inlets = 1;
outlets = 2;

const defs = {};
for (const d of SidParams.FILTER.concat(SidParams.COMMON)) defs[d.key] = d;   // also patch-wide settings (poly, legato, hcut)
const val = {};
const fields = { filterRouting: 0x07, filterType: 0x01 };
let armed = false, chan = 1;

function arm() { if (!armed) sidlog("filter", "armed"); armed = true; }
const armTask = new Task(arm);
armTask.schedule(1500);
let quietUntil = 0;
function quiet(ms) { quietUntil = Date.now() + (ms === undefined ? 1500 : Number(ms)); }
const muted = () => !armed || Date.now() < quietUntil;

// To the synth: "frame <bytes…>" on outlet 1 to the device's own gateway (sid.send.js), not over a global bus.
function tx(bytes) { outlet.apply(null, [1, "frame"].concat(bytes)); }
function sendField(name) {
  const r = SidParams.COMMON_DP[name];
  try { tx(encodeDP(r.addr, r.mask, r.shift, fields[name])); }
  catch (e) { sidlog("filter", "DP error", name, "=", fields[name], ":", e.message); }
}
function setBit(name, bit, on) {
  const next = on ? (fields[name] | (1 << bit)) : (fields[name] & ~(1 << bit));
  if (next === fields[name] && armed) return;
  fields[name] = next;
  if (!muted()) sendField(name);
}
function setField(name, value) {
  if (value === fields[name] && armed) return;
  fields[name] = value;
  if (!muted()) sendField(name);
}
const routeSeen = [];
function route(n, v) {
  n = n | 0;
  if (n < 1 || n > 3) { sidlog("filter", "route: osc outside 1..3", n); return; }
  const bit = 1 << (n - 1);
  if (!routeSeen[n]) { routeSeen[n] = true; fields.filterRouting = v ? fields.filterRouting | bit : fields.filterRouting & ~bit; return; }   // restored on load: not sent (see param)
  setBit("filterRouting", n - 1, !!v);
}
const nameChars = [];                                   // 1..10 -> ASCII; also sent by sendall
function namechar(i, code) {
  i = i | 0; code = code | 0;
  if (i < 1 || i > SidParams.NAME_LEN || code < 0 || code > 127) { sidlog("filter", "namechar out of range", i, code); return; }
  const first = nameChars[i - 1] === undefined;
  nameChars[i - 1] = code;
  if (first || muted()) return;                         // the first is restored by Live on load (see param)
  try { tx(encodeDP(i - 1, 0x7f, 0, code)); }
  catch (e) { sidlog("filter", "DP error namechar", i, "=", code, ":", e.message); }
}
function sendParam(d, v) {
  if (d.cc !== undefined) { tx([0xb0 | (chan - 1), d.cc & 0x7f, SidParams.toCC(v, d.min, d.max) & 0x7f]); return; }
  try { tx(encodeDP(d.dp[0], d.dp[1], d.dp[2], v)); }
  catch (e) { sidlog("filter", "DP error", d.key, "=", v, ":", e.message); }
}
function param(key, v) {
  const d = defs[key];
  if (!d) { sidlog("filter", "unknown parameter", key); return; }
  if (typeof v === "string" && d.labels) v = d.labels.indexOf(v);
  else if (v === "on" || v === "off") v = v === "on" ? 1 : 0;
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) { sidlog("filter", "invalid value", key, v); return; }
  v = Math.max(d.min, Math.min(d.max, v));
  const first = !(key in val);
  val[key] = v;
  // The first value of a parameter is what Live restores when the device loads: it is the starting point and never goes
  // to the synth, whenever it arrives (once it came after "armed" and 155 values overwrote the synth's edit buffer).
  if (first) {
    if (d.field) fields[d.field] = d.values ? d.values[v] : v === 1 ? fields[d.field] | (1 << d.bit) : fields[d.field] & ~(1 << d.bit);
    if (armed) sidlog("filter", "first value kept, not sent:", key, v);
    return;
  }
  if (d.field) { if (d.values) setField(d.field, d.values[v]); else setBit(d.field, d.bit, v === 1); return; }
  if (muted()) return;
  sendParam(d, v);
}
function sendall() {
  armed = true; quietUntil = 0;
  for (const key of Object.keys(val)) { const d = defs[key]; if (!d.field) sendParam(d, val[key]); }
  for (const name of Object.keys(fields)) sendField(name);
  nameChars.forEach((c, k) => { if (c !== undefined) tx(encodeDP(k, 0x7f, 0, c)); });
  outlet(0, "status", "filter: sent " + Object.keys(val).length + " parameters");
}
// Fetch patch: dump request for the current slot (05 7F, our firmware only). The answer (the 02 frame = the STORED patch, not
// the edit buffer) comes in through the capture and is loaded into the panels by sid.load.js.
function fetch() {
  try {
    tx(encodeRequest(0x7f)); tx(encodeSettingsRequest());                 // 06: the update rate for the table playheads
    outlet(0, "status", "filter: fetch requested (current slot)"); sidlog("filter", "fetch: request 05 7F + settings 06");
  }
  catch (e) { sidlog("filter", "fetch error:", e.message); }
}
// Store patch: 07 7F (needs a firmware with store support) – the synth stores its edit buffer to the current slot and replies 47; the gateway
// holds every other message to the synth until that reply (the store compacts the patch memory).
function store() {
  try { tx(encodeStore()); outlet(0, "status", "filter: store requested (current slot)"); sidlog("filter", "store: 07 7F"); }
  catch (e) { sidlog("filter", "store error:", e.message); }
}
function channel(n) { chan = Math.max(1, Math.min(16, n | 0)); }
function anything() {
  const a = arrayfromargs(arguments);
  param(String(messagename), a[0]);
}

anything = sidguard("filter", anything); route = sidguard("filter", route); namechar = sidguard("filter", namechar); sendall = sidguard("filter", sendall); fetch = sidguard("filter", fetch); store = sidguard("filter", store); quiet = sidguard("filter", quiet);
sidlog("filter", "loaded");
