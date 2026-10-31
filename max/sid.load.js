// sid.load.js – v8: receives a decoded patch dump (SysEx 02) and sets the panels from it.
// Bundled with lib/maxlog.js + lib/params.js (dist/sid.load.js). The path: the built-in capture [v8 sid.capture.js] -> deferlow -> here ->
// [deferlow] -> this script -> [thispatcher]. The capture has no midiout and the editor's midiin drops SysEx;
// the only thing that travels from the capture to the panels is the already decoded byte list.
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
