// fixtures.js – synthetic SidStation SysEx for the tests. Frames are built by hand from the format
// (not with lib/sysex.js), so decodeDump/encodeDump are checked against an independent encoder.
//
// Patch layout (decoded bytes): 0..9 name, 10..35 common, osc blocks 36/57/78 (21 bytes),
// LFO blocks 99/110/121/132 (11 bytes), waveform tables from 143.

const HEADER = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00];
const END = 0xff;

// A 143-byte patch body (no tables) with plausible defaults; `set` maps index -> byte.
function body(name, set) {
  const p = new Array(143).fill(0);
  const n = (name + "          ").slice(0, 10);
  for (let i = 0; i < 10; i++) p[i] = n.charCodeAt(i);
  for (const base of [36, 57, 78]) { p[base + 15] = 0x20; p[base + 8] = 0x0f; }   // Saw, full sustain: a valid wave code everywhere
  for (const [i, v] of Object.entries(set || {})) p[Number(i)] = v;
  return p;
}

// n table steps [DATA1, DATA2] that never start with FE/FF, so they are never read as Loop/End.
function steps(n, seed) {
  const out = [];
  for (let k = 0; k < n; k++) out.push((0x10 + ((k * 7 + seed) % 0x60)) & 0xff, (0x30 + k * 3 + seed) & 0xff);
  return out;
}

// An 02 frame: header, version 0, 14-bit size, 24 × 2D, marker 45, name in ASCII, the rest as nibbles low first, F7.
function frame(patch, size) {
  const f = HEADER.concat([0x02, 0x00, (size >> 7) & 0x7f, size & 0x7f]);
  for (let i = 0; i < 24; i++) f.push(0x2d);
  f.push(0x45, ...patch.slice(0, 10));
  for (const b of patch.slice(10)) f.push(b & 0x0f, b >> 4);
  f.push(0xf7);
  return f;
}

const CLEAR = HEADER.concat([0x01, 0x45], new Array(14).fill(0x2d), [0xf7]);
const SKIP = HEADER.concat([0x03, 0xf7]);

// A fresh R33 dump: three empty tables, size = raw bytes (146). Legato, osc 1–3 on, res 11, all osc through
// the filter, type L/B, filter LFO 4, osc 1 gate on; LFO 4 = Ramp with Invert + Sync; DCTRL1_LU (idx 12) = 7F.
const fresh = body("Fixture 01", {
  12: 0x7f,
  0x16: 0x27,                      // PATCH_MODE: osc 1–3 on, legato
  0x18: 0xb7,                      // res 11, routing osc 1–3
  0x19: 0x33,                      // filter LFO 3 (0-based), type LP+BP
  0x1a: 0x5a, 0x1b: 0x21, 0x23: 0,
  [36 + 0]: 0x02, [36 + 6]: 0x04, [36 + 8]: 0x09, [36 + 15]: 0x22,            // osc 1: gate, Saw + sync
  [57 + 1]: 48, [57 + 6]: 0x0b, [57 + 8]: 0x03, [57 + 15]: 0x44,               // osc 2: track note 48, Pulse + ring
  [78 + 6]: 0x01, [78 + 8]: 0x0e, [78 + 15]: 0x10,                           // osc 3: Tri
  [132 + 0]: 0x02, [132 + 1]: 0x03,                                        // LFO 4: Ramp, Sync + Invert
}).concat([END, END, END]);

// Poly, not legato, HCut 5; LFO 1 = Pulse with source LFO 4; distinct LFO speed/depth/fade bytes.
const poly = body("PolyTest", {
  0x16: 0x0b, 0x23: 5,             // osc 1–2 on, poly
  0x19: 0x01,
  [99 + 0]: 0xb3, [99 + 2]: 0x41,      // LFO 1: source 11 (LFO 4), type 3 (Pulse), speed
  [110 + 10]: 0x17,                  // LFO 2 fade in
  [121 + 4]: 0x66,                   // LFO 3 depth
}).concat([END, END, END]);

// Three tables without End: dumped as 65 steps each, size = raw bytes + 1 per table. Osc 3 transpose −24.
const unterminated = body("NoEnd", { 0x16: 0x07, [78 + 3]: 0xe8 }).concat(steps(65, 1), steps(65, 2), steps(65, 3));

// An older dump: table 1 = 18 steps + End, table 2 empty, table 3 = 65 steps of junk without End (ends evenly).
// Osc 2 transpose +12, osc 3 −12 (two's complement), osc 2 detune −10.
const older = body("OldCapture", { 0x16: 0x07, [57 + 3]: 0x0c, [57 + 4]: 0xf6, [78 + 3]: 0xf4 })
  .concat(steps(18, 5), [END], [END], steps(65, 9));

// A bank: 01, then per slot 0..99 an 02 (slots 0..90) and an 03; slot 11's 02 has a size that does not match its contents.
const BROKEN_SLOT = 11;
function bank() {
  const frames = [CLEAR];
  for (let s = 0; s < 100; s++) {
    if (s < 91) {
      const p = body(s === BROKEN_SLOT ? "Broken" : "Slot " + s, { 0x16: 0x07, 0x1a: s }).concat(s === BROKEN_SLOT ? steps(18, s).concat([END, END, END]) : [END, END, END]);
      frames.push(frame(p, s === BROKEN_SLOT ? 146 : p.length));
    }
    frames.push(SKIP);
  }
  return [].concat(...frames);
}

// The AllPatch frame after a memory wipe: 01 + 100 × 03.
const wiped = () => [].concat(CLEAR, ...new Array(100).fill(SKIP));

module.exports = {
  frame, body, steps, CLEAR, SKIP, BROKEN_SLOT, bank, wiped,
  fresh: () => frame(fresh, 146),
  poly: () => frame(poly, 146),
  unterminated: () => frame(unterminated, unterminated.length + 3),
  older: () => frame(older, older.length + 1),
};
