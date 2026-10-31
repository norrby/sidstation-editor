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
// The store reply's checksum (sum): the 16-bit sum of the stored patch bytes (as decodeDump().patch for terminated tables).
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
function validateDPFrame(f) {
  if (f.length !== 13 || !hasSidHeader(f) || f[6] !== ID_DP || f[12] !== 0xf7) return fail({}, "DP: wrong frame shape (13 bytes, id 04)");
  if (f.slice(1, 12).some((b) => b > 0x7f)) return fail({}, "DP: byte > 7F");
  return validateDPFields((f[7] << 7) | f[8], f[9], f[10], f[11]);
}

const api = { SID_HEADER, ID_CLEAR, ID_DUMP, ID_SKIP, ID_DP, ID_REQUEST, validateRequestFrame, encodeRequest,
  ID_SETTINGS, ID_STORE, ID_SETTINGS_REPLY, ID_STORE_REPLY, validateSettingsFrame, encodeSettingsRequest, validateStoreFrame, encodeStore,
  decodeReply, STORE_STATUS, splitFrames, hasSidHeader, decodeDump, encodeDump, tableInfo, validateFrame, validateBank,
  encodeDP, validateDPFrame, validateDPFields };
if (typeof module !== "undefined" && module.exports) module.exports = api;
