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


// midi.js – one parser for the MIDI byte stream from [midiin], shared by every script that reads it (the osc 1 router's
// note path, the gateway's note path, the capture, SidProbe, SidFake). Bundled in front of those scripts (v8 has no require).
//
// midiParser(handlers) -> function (byte). Handlers, all optional:
//   channel(msg)      a whole channel message [status, data…] (running status is followed)
//   sysex(frame)      a whole SysEx frame F0 … F7
//   realtime(b)       F8..FF, also in the middle of SysEx or a channel message
//   broken(part, b)   a SysEx frame cut off by byte b (a new F0, or any status byte – it ends SysEx, as the MIDI spec says)
// System common messages (F1..F6) and stray F7s are dropped.

const MIDI_CH_LEN = { 0x8: 3, 0x9: 3, 0xa: 3, 0xb: 3, 0xc: 2, 0xd: 2, 0xe: 3 };

function midiParser(h) {
  let sx = null, msg = [], need = 0;
  return function (b) {
    b &= 0xff;
    if (b >= 0xf8) { if (h.realtime) h.realtime(b); return; }
    if (sx) {
      if (b === 0xf7) { const f = sx; f.push(b); sx = null; if (h.sysex) h.sysex(f); return; }
      if (!(b & 0x80)) { sx.push(b); return; }
      if (h.broken) h.broken(sx, b);
      sx = null;                                                       // the status byte starts something new
    }
    if (b === 0xf0) { sx = [b]; msg = []; need = 0; return; }
    if (b & 0x80) {
      if (b >= 0xf1) { msg = []; need = 0; return; }                   // system common, stray F7: not ours
      msg = [b]; need = MIDI_CH_LEN[b >> 4];
      return;
    }
    if (!msg.length) return;                                           // data without a status
    msg.push(b);
    if (msg.length === need) { if (h.channel) h.channel(msg.slice()); msg = [msg[0]]; }
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { midiParser, MIDI_CH_LEN };


// sid.capture.js – capture SidStation SysEx in Max for Live (v8, Max 9).
// Own decoding; built into dist/ by build/build-capture.js, bundled with lib/maxlog.js (sidlog -> logs/max.log,
// so that the capture is visible outside the Max console).
//
// Usage: [midiin] -> [v8 sid.capture.js]. Every complete F0..F7 frame
// is saved as dumps/<date>_<patchname>.syx and decoded in the Max console.
// Outlet 0: "patch <bytes...>" (decoded raw bytes), outlet 1: "saved <path>".
//
// Messages: "dir <path>" changes directory, "clear" resets, "dump"
// prints the latest frame again.

inlets = 1;
outlets = 2;

// Dumps are kept only when this folder exists (Max cannot create folders); otherwise they are just loaded into the editor.
let dumpDir = "~/Documents/SidStation/dumps";
let last = null;
let seq = 0;

const HEADER = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00];

// Every complete F0..F7 frame (lib/midi.js); realtime in the middle is skipped, a frame cut off by a status byte is dropped.
const midiIn = midiParser({
  sysex: (f) => finish(f),
  broken: (part, b) => sidlog("capture", "frame cut off by " + hex(b) + " after " + part.length + " bytes, dropped"),
});
function msg_int(b) { midiIn(b); }                                   // a declared function: Max looks msg_int up on the global object


function list() { for (const a of arrayfromargs(arguments)) msg_int(a); }
function dir(p) { dumpDir = p; post("sid.capture: dir = " + dumpDir + "\n"); }
function clear() { seq = 0; post("sid.capture: cleared\n"); }
function dump() { if (last) finish(last); else post("sid.capture: no frame yet\n"); }

function finish(frame) {
  last = frame.slice();
  // Built into SidStation the capture hears the whole track input, so any SysEx can arrive (a 6-byte test frame
  // F0 7D … once crashed the tag below). Frames that are not SidStation frames are only logged (not saved: with All Ins
  // other gear's SysEx would fill dumps/) and go no further.
  if (frame.length < 8 || !HEADER.every((v, i) => frame[i] === v)) {
    sidlog("capture", "not a SidStation frame (" + frame.length + " bytes, " + frame.slice(0, 6).map(hex).join(" ") + "), ignored");
    return;
  }
  // A frame of a kind only we send (DP 04, requests 05/06, store 07) coming IN means our output is looping back to the input:
  // warn, do not save or pass it on (with All Ins this would otherwise save every DP of a Push as a dump).
  if (frame[6] === ID_DP || frame[6] === ID_REQUEST || frame[6] === ID_SETTINGS || frame[6] === ID_STORE) {
    sidlog("capture", "ERROR outgoing-type frame (id " + hex(frame[6]) + ") came in – is the track's output looping back to its input?");
    return;
  }
  if (frame[6] === ID_SETTINGS_REPLY || frame[6] === ID_STORE_REPLY) { reply(frame); return; }
  const info = decode(frame);
  const d = new Date(), two = (n) => (n < 10 ? "0" : "") + n;                     // local time (toISOString gives UTC)
  const stamp = d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + "-" + two(d.getHours()) + "-" + two(d.getMinutes());
  const tag = info.name ? info.name.trim().replace(/[^A-Za-z0-9_-]/g, "_") : ("id" + hex(frame[6]));
  seq++;
  const path = dumpDir + "/" + stamp + "_" + String(seq).padStart(3, "0") + "_" + tag + ".syx";
  if (save(path, frame)) {
    sidlog("capture", "saved " + frame.length + " bytes to " + path);
    outlet(1, "saved", path);
  } else {
    sidlog("capture", "not saved: " + dumpDir + " does not exist (create it to keep dumps) – hex follows in the console");
    post(frame.map(hex).join(" ") + "\n");
  }
  report(frame, info);
  if (frame[6] === ID_DUMP || frame[6] === ID_SKIP) outlet(0, "replied", "dump");   // ends the gateway's wait after a 05 request
  if (info.patch) { sidlog("capture", "patch '" + info.name + "' -> the editor, " + info.patch.length + " raw bytes"); outlet(0, "patch", ...info.patch); }
}

// 46/47 replies from our firmware (lib/sysex.js decodeReply): not saved, passed on to the loader and (stored) the gateway.
function reply(frame) {
  const r = decodeReply(frame);
  if (!r.ok) { sidlog("capture", "reply ignored:", r.reason); return; }
  if (r.id === ID_SETTINGS_REPLY) {
    sidlog("capture", "settings: source " + ["Patch", "Globl", "ExtCl"][r.source] + ", global speed " + r.globalSpeed + " Hz, patch speed " +
      r.patchSpeed + " Hz, period " + r.period + " -> " + r.rateHz.toFixed(1) + " Hz, slot " + r.slot + ", base ch " + (r.baseCh + 1));
    outlet(0, "settings", Math.round(r.rateHz * 10) / 10, r.source, r.slot, r.globalSpeed, r.patchSpeed, r.baseCh, r.lock);
    outlet(0, "replied", "settings");
  } else {
    sidlog("capture", "store reply: " + r.statusText + ", slot " + r.slot + ", size " + r.size + ", checksum " + r.sum + ", free " + r.free);
    outlet(0, "stored", r.status, r.slot, r.size, r.sum, r.free);
  }
}

function save(path, bytes) {
  try {
    const f = new File(path, "write");
    if (!f.isopen) return false;
    f.eof = 0;
    f.writebytes(bytes);
    f.close();
    const check = new File(path, "read");                                  // a missing folder still gives an open File: read it back
    const ok = check.isopen && check.eof === bytes.length;
    check.close();
    return ok;
  } catch (e) { post("sid.capture: File error: " + e + "\n"); return false; }
}

// --- decoding (low nibble first, see lib/sysex.js) -------------

function decode(m) {
  const r = { id: m[6], ok: false };
  for (let i = 0; i < HEADER.length; i++) if (m[i] !== HEADER[i]) { r.err = "wrong header"; return r; }
  if (m[6] === 0x03) { r.err = "skip patch (03): empty slot"; return r; }
  if (m[6] !== 0x02) { r.err = "not a patch dump (id " + hex(m[6]) + ")"; return r; }
  r.version = m[7];
  r.size = (m[8] << 7) | m[9];
  let k = 10, pad = 0;
  while (k < m.length && m[k] === 0x2d) { pad++; k++; }
  r.pad = pad;
  r.marker = m[k++];
  const body = m.slice(k, m.length - 1);
  r.name = String.fromCharCode(...body.slice(0, 10));
  const nib = body.slice(10);
  r.oddNibbles = nib.length % 2;
  const patch = body.slice(0, 10);
  for (let i = 0; i + 1 < nib.length; i += 2) patch.push((nib[i + 1] << 4) | nib[i]);
  r.patch = patch;
  r.ok = true;
  return r;
}

function report(m, r) {
  post("---- SidStation sysex, " + m.length + " MIDI-bytes, id " + hex(r.id) + " ----\n");
  if (!r.ok) { sidlog("capture", "frame id " + hex(r.id) + ": " + r.err); return; }
  post("  version " + r.version + ", size " + r.size + ", pad 0x2D x" + r.pad +
       ", marker " + hex(r.marker) + ", raw bytes " + r.patch.length +
       (r.oddNibbles ? " (ODD number of nibbles!)" : "") + "\n");
  const p = r.patch;
  post("  name   '" + r.name + "'\n");
  post("  common " + hexs(p, 10, 36) + "\n");
  for (let o = 0; o < 3; o++) post("  osc" + (o + 1) + "   " + hexs(p, 36 + 21 * o, 57 + 21 * o) + "\n");
  for (let l = 0; l < 4; l++) post("  lfo" + (l + 1) + "   " + hexs(p, 99 + 11 * l, 110 + 11 * l) + "\n");
  // Tables: step = 2 bytes (DATA1 DATA2), LOOP = FE xx (2 bytes),
  // END = FF (1 byte, no DATA2) [H]. Without END the unit dumps 65 steps [H].
  let i = 143, t = 1;
  while (i < p.length && t <= 3) {
    const words = [];
    let steps = 0;
    while (i < p.length && steps < 65) {
      if (p[i] === 0xff) { words.push("END"); i += 1; break; }
      if (i + 1 >= p.length) { words.push(hex(p[i]) + "??"); i += 1; break; }
      words.push(hex(p[i]) + hex(p[i + 1]));
      i += 2; steps++;
    }
    post("  table" + t + " " + (words.length ? words.join(" ") : "(empty, no END)") + "\n");
    t++;
  }
  if (i < p.length) post("  rest   " + hexs(p, i, p.length) + "\n");
}

function hexs(a, from, to) { return a.slice(from, to).map(hex).join(" "); }
function hex(b) { return b === undefined ? "??" : (b < 16 ? "0" : "") + b.toString(16); }

msg_int = sidguard("capture", msg_int); list = sidguard("capture", list); dump = sidguard("capture", dump);
sidlog("capture", "loaded");
