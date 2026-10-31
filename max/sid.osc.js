// sid.osc.js – router for one oscillator panel (v8, Max 9). Argument: osc 1..3.
// Bundled with lib/maxlog.js + lib/sysex.js + lib/params.js by build/build-station.js (dist/sid.osc.js).
//
// Inlet 0: int   = MIDI bytes from [midiin] (the track's notes) – passed on
//                   to outlet 0 as whole messages, EXCEPT SysEx: everything from F0
//                   to F7 is dropped, so that a dump from the synth can never be echoed
//                   back (an echo loop once wiped the synth's memory). Realtime (F8..FF) passes.
//           "<param> <value>" from the hidden/visible live.* objects, the value in
//                   the synth's own scale (e.g. transpose −24..24). Scaled to CC
//                   with SidParams.toCC and sent as B0 cc v on channel 1 –
//                   NOT through its own midiout but as "frame <bytes…>" on outlet 2 to the
//                   gateway (sid.send.js), which queues and validates.
//                   Parameters without a CC (wave, pwsync) go as Direct Program
//                   SysEx (encodeDP, only documented rows from params.js).
//           "trackmode 0|1" (Key follow | Note), "tracknote n": the Track controls -> param track.
//           "table <bytes…>" the waveform table from sid.table.js; changed rows go as DP (four messages per row).
//           "sendall" sends every known value and the whole table (Push patch, e.g. after a patch change).
//           "arm"     from [live.thisdevice]: the device has loaded, changes may now be sent.
//           "quiet"   from sid.load.js: a patch dump is arriving in the panel – send nothing for 1.5 s
//                   (the values come from the synth and must not be echoed back to it).
//           "channel n" MIDI channel 1..16 for CC (default 1).
// Outlet 0: the track's notes to [midiout] (on to External Instrument). Outlet 1: "status <text>", "ringok 0|1",
//           "note 1|0" for every note on/off that passes (drives the table playheads), "setactive 0|1" (the waveform turned the
//           oscillator on/off), "pushcc" (CC 119: Push patch). Outlet 2: "frame <bytes…>" to the gateway.

inlets = 1;
outlets = 3;

const osc = Math.max(1, Math.min(3, parseInt(jsarguments[1], 10) || 1));
const defs = {};
for (const d of SidParams.OSC) defs[d.key] = d;
const val = {};
let chan = 1;
// Nothing is sent to the synth until Live has finished loading the device ([live.thisdevice]
// -> "armed"). On load every live.* object outputs its value, and that must
// NOT overwrite the synth's edit buffer (osc 1 kept getting switched off).
// The values are stored anyway, so "sendall" (Push patch) can push the whole panel.
let armed = false;
function arm() { if (!armed) sidlog("osc" + osc, "armed"); armed = true; }
// Fallback in case the bang from live.thisdevice never arrives or comes before the script
// has compiled: arm 1.5 s after the script has loaded (the parameters
// are restored synchronously on load, long before that).
const armTask = new Task(arm);
armTask.schedule(1500);
let quietUntil = 0;                                   // sid.load.js: the dump's values are streaming in, stay quiet meanwhile
function quiet(ms) { quietUntil = Date.now() + (ms === undefined ? 1500 : Number(ms)); }
const muted = () => !armed || Date.now() < quietUntil;

// --- pass-through of the track's MIDI (notes) ------------------------------
// Whole channel messages are collected (lib/midi.js) and output in one go, so that nothing can
// end up between status byte and data. SysEx (F0..F7) is dropped entirely. Realtime passes.
const midiIn = midiParser({
  realtime: (b) => outlet(0, b),
  channel: (m) => {
    if ((m[0] & 0xf0) === 0xb0 && m[1] === SidParams.PUSH_CC) { pushCC(m[2]); return; }   // the editor's own CC: never to the synth
    for (const x of m) outlet(0, x);
    const st = m[0] >> 4;                             // note on/off -> outlet 1 for the table playheads (sid.table.js)
    if (st === 0x9 || st === 0x8) outlet(1, "note", st === 0x9 && m[2] > 0 ? 1 : 0);
  },
});
// Choosing a waveform turns the oscillator on, choosing Off turns it off (Active): Off alone leaves the SID's gate and envelope
// running (R33 writes the wave byte straight to the control register), Active off clears the whole control register ($8B05,
// $9859) – silent, and the oscillator still runs as a sync/ring source. Only for a change made now: never on load or Pull (both
// return before this), never for Push patch (same value), and the Active button does not change the waveform.
const WAVE_OFF = SidParams.OSC.find((d) => d.key === "wave").labels.indexOf("Off");
function followWave(v) {
  const want = v === WAVE_OFF ? 0 : 1;
  if (val.active === want) return;
  sidlog("osc" + osc, "wave", v === WAVE_OFF ? "Off -> Active off" : "chosen -> Active on");
  outlet(1, "setactive", want);
}
let lastPushCC = -Infinity;
function pushCC(v) {
  if (!(v > 0)) return;
  const now = Date.now();
  if (now - lastPushCC < SidParams.PUSH_CC_GAP_MS) { sidlog("osc" + osc, "CC " + SidParams.PUSH_CC + " ignored: pushed " + (now - lastPushCC) + " ms ago"); return; }
  lastPushCC = now;
  sidlog("osc" + osc, "Push patch from CC " + SidParams.PUSH_CC);
  outlet(1, "pushcc");                                                     // -> sendall to every router (build-station.js)
}
function msg_int(b) { midiIn(b); }                                   // a declared function: Max looks msg_int up on the global object


// --- to the synth: via the gateway (outlet 2 -> sid.send.js), never its own midiout ------
function tx(bytes) { outlet.apply(null, [2, "frame"].concat(bytes)); }
function sendCC(cc, v) { tx([0xb0 | (chan - 1), cc & 0x7f, v & 0x7f]); }
function sendBytes(bytes) { tx(bytes); }

// CC wherever possible, Direct Program as fallback: CC is ordinary
// MIDI that Live sees and that is harmless to the synth. CC is used when the parameter has
// a CC number and the value fits losslessly in the synth's CC range [min, ccMax];
// otherwise DP (e.g. Track 100: the synth's CC scaling only reaches 99).
function ccMax(d) { return d.ccMax !== undefined ? d.ccMax : d.max; }
function viaCC(d, v) {
  if (!(d.cc || d.ccOff !== undefined)) return false;
  const hi = ccMax(d);
  if (v < d.min || v > hi) return false;
  return SidParams.fromCC(SidParams.toCC(v, d.min, hi), d.min, hi) === v;
}
function param(key, v, keep) {
  const d = defs[key];
  if (!d) { sidlog("osc" + osc, "unknown parameter", key); return; }
  const raw = v;
  if (typeof v === "string" && d.labels) v = d.labels.indexOf(v);          // enum symbol from live.* -> index
  else if (v === "on" || v === "off") v = v === "on" ? 1 : 0;
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) { sidlog("osc" + osc, "invalid value", key, JSON.stringify(raw)); return; }
  v = Math.max(d.min, Math.min(d.max, v));
  const first = keep || !(key in val), prev = val[key];
  val[key] = v;
  // In the SID, ring modulation only acts on the triangle wave: Tri (0) and Mixed (3, Tri+Pulse). Outlet 1 ->
  // the Ring button (active 0/1) and the overview, regardless of arming.
  if (key === "wave") outlet(1, "ringok", v === 0 || v === 3 ? 1 : 0);
  // The first value of a parameter is what Live restores when the device loads: it is the starting point and never goes
  // to the synth, whenever it arrives (once it came after "armed" and 155 values overwrote the synth's edit buffer).
  if (first) { if (armed) sidlog("osc" + osc, "first value kept, not sent:", key, v); return; }
  if (muted()) return;
  if (key === "wave" && v !== prev) followWave(v);
  if (viaCC(d, v)) { sendCC(SidParams.oscCC(osc, d), SidParams.toCC(v, d.min, ccMax(d))); return; }
  const r = SidParams.oscDP(osc, d);
  if (!r) { sidlog("osc" + osc, key, "has neither CC nor DP"); return; }
  try { sendBytes(encodeDP(r.addr, r.mask, r.shift, d.codes ? d.codes[v] : v)); }
  catch (e) { sidlog("osc" + osc, "DP error", key, "=", v, "(" + JSON.stringify(raw) + "):", e.message); }
}

// Track in the panel: radio button "trackmode" (0 = Key follow, 1 = Note) + "tracknote 1..100"
// -> one synth value (0 = Key, otherwise the note). Two Live parameters, so each has its own first value (Live's restore):
// with Note selected, Live restoring the mode and then the note would otherwise send the note on load.
let trackMode = 0, trackNote = 60;
const trackRestored = { mode: false, note: false };
function restoring(control) { const first = !trackRestored[control]; trackRestored[control] = true; return first; }
function trackmode(v) { const keep = restoring("mode"); trackMode = v ? 1 : 0; param("track", trackMode ? trackNote : 0, keep); }
function tracknote(v) { const keep = restoring("note"); trackNote = Math.max(1, Math.min(100, Math.round(Number(v)))); if (trackMode) param("track", trackNote, keep); }

function anything() {
  const a = arrayfromargs(arguments);
  if (a.length < 1) return;
  param(messagename, a[0]);
}

// The waveform table (sid.table.js -> "table <bytes…>", the table as stored in a dump: pairs, FE xx = Loop, FF = End).
// Only rows that differ from what the synth is known to have are sent, each as four DP messages in sequence (manual p. 43;
// tx() is synchronous, so nothing can come between them). While muted (loading, a dump arriving) the table only becomes
// the new baseline. End is written as FF FF.
let tableSent = null, tableNow = [];
function tableRows(b) {
  const rows = [];
  for (let k = 0; k < b.length && rows.length < SidParams.TABLE_ROWS; k += 2) {
    if (b[k] === 0xff) { rows.push([0xff, 0xff]); break; }
    rows.push([b[k] & 0xff, (b[k + 1] | 0) & 0xff]);
    if (b[k] === 0xfe) {
      // Loop must go back to an earlier step: to itself hangs the synth, and the OS jumps without a check (R33 $95DD), so FE FF
      // read past the table (the loop "stopped"). Such a table is not sent at all.
      if (rows[rows.length - 1][1] >= rows.length - 1) { sidlog("osc" + osc, "ERROR table refused: Loop at step", rows.length - 1, "to step", rows[rows.length - 1][1]); return null; }
      break;
    }
  }
  return rows;
}
function sendRow(k, r) {
  for (const [a, m, sh, v] of SidParams.tableDP(osc, k, r[0], r[1])) sendBytes(encodeDP(a, m, sh, v));
}
function table() {
  const rows = tableRows(arrayfromargs(arguments).map(Number));
  if (!rows) return;                                     // refused (logged): keep the last valid table
  tableNow = rows;
  if (muted() || !tableSent) { tableSent = tableNow.map((r) => r.slice()); return; }
  let n = 0;
  tableNow.forEach((r, k) => { const old = tableSent[k]; if (!old || old[0] !== r[0] || old[1] !== r[1]) { sendRow(k, r); n++; } });
  tableSent = tableNow.map((r) => r.slice());
  if (n) sidlog("osc" + osc, "table:", n, "rows sent");
}

function sendall() {
  armed = true; quietUntil = 0;
  for (const k in val) param(k, val[k]);
  tableNow.forEach((r, k) => sendRow(k, r));
  tableSent = tableNow.map((r) => r.slice());
  outlet(1, "status", "sent " + Object.keys(val).length + " parameters, " + tableNow.length + " table rows");
}

function channel(n) { chan = Math.max(1, Math.min(16, n | 0)); }

function list() { /* lists, e.g. from live.menu outlet 2, are ignored */ }

// Every handler wrapped in error capture that logs to logs/max.log.
msg_int = sidguard("osc" + osc, msg_int); anything = sidguard("osc" + osc, anything); sendall = sidguard("osc" + osc, sendall);
trackmode = sidguard("osc" + osc, trackmode); table = sidguard("osc" + osc, table); tracknote = sidguard("osc" + osc, tracknote); channel = sidguard("osc" + osc, channel); quiet = sidguard("osc" + osc, quiet);
sidlog("osc" + osc, "loaded");
