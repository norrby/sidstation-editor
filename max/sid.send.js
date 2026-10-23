// sid.send.js – the gateway: the ONLY path to the synth ("synth mutex"), built into SidStation. v8, Max 9.
// Built together with lib/maxlog.js + lib/sysex.js + lib/params.js by build/build-station.js (dist/sid.send.js).
//
// SAFETY: the SidStation's OS lives in PROM and can be destroyed by wrong SysEx
// (a chip has had to be reprogrammed before). Three rules apply here:
//  1. Only validated messages go out: patch frames that validateFrame()
//     accepts (id 01/02/03), Direct Program frames that validateDPFrame()
//     accepts AND that are in the params.js whitelist (dpRows),
//     channel messages with the right length and 7-bit data, and the dump request (id 05,
//     validateRequestFrame: exactly 9 bytes, slot 0..99 or 7F; only for a firmware with
//     dump-request support); with that firmware also the settings request (06, validateSettingsFrame) and store (07 7F, validateStoreFrame).
//  2. One message at a time, never interleaved: everything goes into ONE queue emptied by a
//     Task, one whole message per tick, with a pause suited to the type. The routers send "frame <bytes…>" here on an
//     outlet of their own (no global bus, so nothing else in the set can send through it twice).
//  3. Store: from sending 07 until its 47 reply (from the capture: "stored") or a timeout NOTHING else goes to
//     the synth. The store compacts the patch memory for up to ~0.3 s; a patch frame (02/01) in that window corrupts the
//     whole patch memory. Queued messages wait; a second store is refused.
//  The track's notes come in as bytes (msg_int) and go out at once, outside the queue. A frame is always output whole in
//  one call, so a note can never land inside it.
//
// [v8 sid.send.js] outlet 0 -> [midiout]. Outlet 1: "status <text>",
// "progress <i> <n>". Messages (also as OSC via [udpreceive], "/cc 42 127"):
//   load <path>     validate and load a .syx bank;  send   queue all frames;  stop
//   gap <ms>        extra pause after each patch frame (default 150)
//   cc <nr> <v>     note <pitch> <vel>     pc <n>     (channel 1)
//   dp <Ph> <Pl> <mask> <shift> <v>      Direct Program, whitelisted row
//   request <slot>  dump request (0..99, 127 = current slot); the answer comes in through the capture
//   settings        system settings request (06)      store   store the edit buffer to the current slot (07 7F)
//   stored <status> <slot> <size> <sum> <free>        the 47 reply (from the capture): ends the store lock
//   replied dump|settings                             a 02/03 dump or a 46 reply came in (from the capture)
// Every request that expects an answer is timed (Live can lose its input port, and Pull then just does nothing): 05 -> a dump, 06 -> 46, 07 -> 47. No answer within 3 s: a log line and
// "noreply <dump|settings|store>" on outlet 1 (the name display shows NO REPLY until "answered" – any reply – or a click).
//   frame <bytes…>  a complete message from a router; validated as above

inlets = 1;
outlets = 2;

let queue = [];
let task = null;
let gapMs = 150;
let chan = 1;
let bank = [], loaded = "";
let sentFrames = 0, totalFrames = 0;
let storing = null;                          // the store lock: the Task that times it out, or null
const STORE_TIMEOUT_MS = 3000;
const REPLY_TIMEOUT_MS = 3000;
const waiting = { dump: null, settings: null };   // the Tasks that time out a 05 / 06 request, or null

// --- the queue ------------------------------------------------------------------

function enqueue(m) {
  queue.push(m);
  if (!task) { task = new Task(drain); drain(); }
}

function pace(m) {
  if (m[0] !== 0xf0) return 1;                               // channel message
  if (m[6] === ID_DP || m[6] === ID_REQUEST || m[6] === ID_SETTINGS || m[6] === ID_STORE) return 10;   // DP/requests: short pause
  return Math.round(m.length * 0.32) + gapMs;                // patch frame: wire time + storing
}

function drain() {
  if (!task) return;
  if (storing) { task.schedule(10); return; }                // store lock: nothing to the synth until the reply
  if (!queue.length) {
    task = null;
    if (totalFrames) { status("done, " + sentFrames + " frames sent"); totalFrames = 0; }
    return;
  }
  const m = queue.shift();
  if (m[0] === 0xf0) {                                       // last check right before sending
    const v = validate(m);
    if (!v.ok) { queue = []; task = null; status("STOP: frame failed validation while sending (" + v.reason + ")"); return; }
  }
  for (const b of m) outlet(0, b);
  if (m[0] === 0xf0 && m[6] === ID_STORE) lockStore();
  if (m[0] === 0xf0 && m[6] === ID_REQUEST) expectReply("dump");
  if (m[0] === 0xf0 && m[6] === ID_SETTINGS) expectReply("settings");
  if (m[0] === 0xf0 && m[6] !== ID_DP && totalFrames) { sentFrames++; outlet(1, "progress", sentFrames, totalFrames); }
  task.schedule(pace(m));
}

function validate(m) {
  switch (m[6]) {
    case ID_DP: return validateDPFrame(m);
    case ID_REQUEST: return validateRequestFrame(m);
    case ID_SETTINGS: return validateSettingsFrame(m);
    case ID_STORE: return validateStoreFrame(m);
    default: return validateFrame(m);
  }
}

function lockStore() {
  storing = new Task(() => { storing = null; noReply("store", "store: NO REPLY within " + STORE_TIMEOUT_MS + " ms – the patch may or may not have been stored"); });
  storing.schedule(STORE_TIMEOUT_MS);
  status("store sent, waiting for the reply");
}
function stored(st, slot, size, sum, free) {
  if (!storing) { sidlog("send", "store reply without a pending store"); return; }
  storing.cancel(); storing = null;
  outlet(1, "answered", "store");
  status("store reply: " + (STORE_STATUS[st] || "status " + st) + ", slot " + slot + ", " + size + " bytes, " + free + " free");
}

function expectReply(what) {
  if (waiting[what]) waiting[what].cancel();                 // a new request restarts the wait
  waiting[what] = new Task(() => { waiting[what] = null; noReply(what, (what === "dump" ? "dump request" : "settings request") + ": NO REPLY within " + REPLY_TIMEOUT_MS +
    " ms – is the synth on, running a firmware with dump-request support, and its MIDI Out reaching this track? (If the MIDI interface's input light blinks but nothing arrives, restart Live.)"); });
  waiting[what].schedule(REPLY_TIMEOUT_MS);
}
function replied(what) { if (waiting[what]) { waiting[what].cancel(); waiting[what] = null; } outlet(1, "answered", what); }
function noReply(what, text) { status(text); outlet(1, "noreply", what); }

// Common funnel: everything bound for the synth passes accept().
const CH_LEN = { 0x8: 3, 0x9: 3, 0xa: 3, 0xb: 3, 0xc: 2, 0xd: 2, 0xe: 3 };
function accept(m, what) {
  if (!m.length || m.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) return refuse(what, "not bytes");
  if (m[0] === 0xf0) {
    if (m[m.length - 1] !== 0xf7 || m.slice(1, -1).some((b) => b > 0x7f)) return refuse(what, "malformed SysEx");
    if (!hasSidHeader(m)) return refuse(what, "not a SidStation frame");
    if (m[6] === ID_DP) {
      const v = validateDPFrame(m);
      if (!v.ok) return refuse(what, v.reason);
      const row = ((m[7] << 7) | m[8]) + ":" + m[9] + ":" + m[10];
      if (!SidParams.dpRows().has(row)) return refuse(what, "DP row " + row + " not in whitelist");
    } else {
      const v = validate(m);
      if (!v.ok) return refuse(what, v.reason);
      if (m[6] === ID_STORE && (storing || queue.some((q) => q[0] === 0xf0 && q[6] === ID_STORE))) return refuse(what, "a store is already pending");
    }
  } else {
    const len = CH_LEN[m[0] >> 4];
    if (!len || m.length !== len || m.slice(1).some((b) => b > 0x7f)) return refuse(what, "bad channel message");
  }
  enqueue(m);
  return true;
}
function refuse(what, why) { status("REFUSED " + what + ": " + why); return false; }

// --- bank -----------------------------------------------------------------

function load(p) {
  stop(false);
  bank = []; loaded = "";
  try {
    const f = new File(p, "read");
    if (!f.isopen) { status("could not open " + p); return; }
    const bytes = f.readbytes(f.eof);
    f.close();
    const v = validateBank(bytes);
    const bad = v.rows.filter((r) => !r.ok);
    const fatal = bad.filter((r) => r.id !== ID_DUMP);
    for (const r of bad) post("sid.send: frame " + r.i + " pos " + r.pos + " id " + r.id + (r.name ? " '" + r.name + "'" : "") + " – " + r.reason + "\n");
    if (fatal.length || v.stray) { status("REFUSED " + p.split("/").pop() + ": not a clean SidStation patch dump (" + (fatal[0] ? fatal[0].reason : "stray bytes") + ")"); return; }
    bank = v.rows.filter((r) => r.ok).map((r) => v.frames[r.i]);
    loaded = p;
    const ids = {};
    for (const fr of bank) ids[fr[6]] = (ids[fr[6]] || 0) + 1;
    const desc = Object.keys(ids).sort().map((k) => "id" + ("0" + k).slice(-2) + ":" + ids[k]).join(" ");
    status("loaded " + bank.length + " valid frames (" + desc + ")" + (bad.length ? ", skipping " + bad.length + " broken" : "") + " – " + p.split("/").pop());
    outlet(1, "progress", 0, bank.length);
  } catch (e) { status("error: " + e); }
}

function send() {
  if (!bank.length) { status("nothing loaded"); return; }
  stop(false);
  sentFrames = 0; totalFrames = bank.length;
  status("sending " + bank.length + " frames …");
  for (const fr of bank) accept(fr.slice(), "bank");
}

function stop(report) {
  const dropped = queue.length;
  queue = [];
  if (task) { task.cancel(); task = null; }       // (a store lock stays: the synth may still be compacting)
  if (report !== false) status("stopped, " + dropped + " queued messages dropped");
  totalFrames = 0;
}

function gap(ms) { gapMs = Math.max(0, ms | 0); status("gap " + gapMs + " ms"); }
function channel(n) { chan = Math.max(1, Math.min(16, n | 0)); status("channel " + chan); }

// --- single messages ---------------------------------------------------

function cc(nr, value) { if (accept([0xb0 | (chan - 1), nr | 0, value | 0], "cc")) status("CC " + (nr | 0) + " = " + (value | 0)); }
function note(pitch, velocity) { accept([0x90 | (chan - 1), pitch | 0, velocity | 0], "note"); }
function pc(program) { if (accept([0xc0 | (chan - 1), program | 0], "pc")) status("Program Change " + (program | 0)); }
function dp(ph, pl, mask, shift, value) {
  const f = SID_HEADER.concat([ID_DP, ph | 0, pl | 0, mask | 0, shift | 0, value | 0, 0xf7]);
  if (accept(f, "dp")) status("DP " + (ph | 0) + " " + (pl | 0) + " " + (mask | 0) + " " + (shift | 0) + " = " + (value | 0));
}
function request(slot) {
  const s = (slot | 0) === 127 || (slot | 0) < 0 ? 0x7f : slot | 0;
  if (accept(SID_HEADER.concat([ID_REQUEST, s, 0xf7]), "request")) status("request dump " + (s === 0x7f ? "current" : s));
}
function settings() { if (accept(encodeSettingsRequest(), "settings")) status("settings requested"); }
function store() { if (accept(encodeStore(), "store")) status("store queued (current slot)"); }
// The track's notes (built into SidStation): bytes from the osc 1 router, which already drops SysEx and passes whole channel
// messages. Collected again here and checked like any channel message, then output at once (notes must not wait behind
// DP traffic). SysEx bytes are never let through on this path.
const midiIn = midiParser({                                          // lib/midi.js
  realtime: (b) => outlet(0, b),
  channel: (m) => { for (const x of m) outlet(0, x); },
  sysex: () => sidlog("send", "REFUSED SysEx on the note path"),
  broken: () => sidlog("send", "REFUSED SysEx on the note path"),
});
function msg_int(b) { midiIn(b); }                                   // a declared function: Max looks msg_int up on the global object

// From a router: "frame <bytes…>", one complete message at a time.
function frame() {
  const m = arrayfromargs(arguments).map(Number);
  if (accept(m, "bus")) status("bus: " + (m[0] === 0xf0 ? "DP " + m.slice(7, 12).map((b) => b.toString(16)).join(" ") : m.map((b) => b.toString(16)).join(" ")));
}

const COMMANDS = { load, send, stop, gap, channel, cc, note, pc, dp, request, settings, store, stored, replied, frame };

function anything() {
  const name = String(messagename).replace(/^\//, "");
  const fn = COMMANDS[name];
  if (!fn) { status("unknown message " + messagename); return; }
  fn.apply(null, arrayfromargs(arguments));
}

function status(s) { sidlog("send", s); outlet(1, "status", s); }

msg_int = sidguard("send", msg_int); anything = sidguard("send", anything); frame = sidguard("send", frame); load = sidguard("send", load); send = sidguard("send", send);
sidlog("send", "loaded");
