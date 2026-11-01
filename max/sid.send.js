// sid.send.js – the gateway: the ONLY path to the synth ("synth mutex"), built into SidStation. v8, Max 9.
// Built together with lib/maxlog.js + lib/sysex.js + lib/params.js by build/build-station.js (dist/sid.send.js), which also sets
// SID_DEV (true in a development build, false in a release: the per-message "bus:" lines and the per-second count are logged only then).
//
// SAFETY: the SidStation's OS lives in PROM and can be destroyed by wrong SysEx
// (a chip has had to be reprogrammed before). Three rules apply here:
//  1. Only validated messages go out: patch frames that validateFrame()
//     accepts (id 02/03; id 01, which clears the whole patch memory, is always refused), Direct Program frames that validateDPFrame()
//     accepts AND that are in the params.js whitelist (dpRows),
//     channel messages with the right length and 7-bit data, and the dump request (id 05,
//     validateRequestFrame: exactly 9 bytes, slot 0..99 or 7F; only for a firmware with
//     dump-request support); with that firmware also the settings request (06, validateSettingsFrame) and store (07 7F, validateStoreFrame).
//  2. One message at a time, never interleaved, in arrival order: everything goes into ONE queue. Channel messages and DP
//     frames go out at once; only a patch frame (150 ms for the synth to store it) and a request (10 ms) are followed by a
//     pause, during which later messages wait in the queue. Nothing is paced to the MIDI cable: what the cable cannot carry
//     waits in Live's / the system's MIDI buffer (decided 2026-11-01: no queue handling of our own beyond this).
//     While a dump request (05) waits for its dump, the queue is held like during a store: the synth stops reading its
//     256-byte channel-message buffer while it dumps (0.3–0.5 s), and more bytes would overwrite unread ones (wrong CC values). The routers send "frame <bytes…>" here on an
//     outlet of their own (no global bus, so nothing else in the set can send through it twice).
//  3. Store: from sending 07 until its 47 reply (from the capture: "stored") or a timeout NOTHING else goes to
//     the synth. The store compacts the patch memory for up to ~0.3 s; a patch frame (02/01) in that window corrupts the
//     whole patch memory. Queued messages wait, the track's notes are held; a second store is refused.
//  The track's notes come in as bytes (msg_int) and go out at once, outside the queue (held during a store). A frame is always output whole in
//  one call, so a note can never land inside it.
//
// [v8 sid.send.js] outlet 0 -> [midiout]. Outlet 1: "status <text>". Messages (from the patcher only: the device has no network port):
//   frame <bytes…>  a complete message from a router; validated as above
//   stored <status> <slot> <size> <sum> <free>        the 47 reply (from the capture): ends the store lock
//   replied dump|settings                             a 02/03 dump or a 46 reply came in (from the capture)
// Every request that expects an answer is timed (Live can lose its input port, and Pull then just does nothing): 05 -> a dump, 06 -> 46, 07 -> 47. No answer within 3 s: a log line and
// "noreply <dump|settings|store>" on outlet 1, and "sent" after every router frame (the name display shows NO REPLY until "answered" – any reply – or a click).

inlets = 1;
outlets = 2;

let queue = [];
let task = null;
const GAP_MS = 150;                          // the pause after a patch frame, for the synth to store it
let storing = null;                          // the store lock: the Task that times it out, or null
const STORE_TIMEOUT_MS = 3000;
const DP_ROWS = SidParams.dpRows();          // the DP whitelist, built once
const REPLY_TIMEOUT_MS = 3000;
const waiting = { dump: null, settings: null };   // the Tasks that time out a 05 / 06 request, or null

// --- the queue ------------------------------------------------------------------

function enqueue(m) {
  queue.push(m);
  if (!task) { task = new Task(drain); drain(); }
}

function pace(m) {                                           // the pause after a message, 0 = none
  if (m[0] !== 0xf0 || m[6] === ID_DP) return 0;             // channel message, DP: the next one at once
  if (m[6] === ID_REQUEST || m[6] === ID_SETTINGS || m[6] === ID_STORE) return 10;   // DP/requests: short pause
  return Math.round(m.length * 0.32) + GAP_MS;                // patch frame: wire time + storing
}

// An exception here would leave `task` set and never rescheduled, and every later message would wait for good: catch it,
// drop the queue and say so (the store lock, if any, still ends by its reply or timeout).
function drain() {
  try { drainOne(); }
  catch (e) { queue = []; task = null; status("STOP: error while sending (" + e.message + "), queue dropped"); }
}
function drainOne() {
  if (!task) return;
  if (storing || waiting.dump) { task.schedule(10); return; }   // store lock, dump pending: nothing to the synth until the reply
  while (queue.length) {
    const m = queue.shift();
    if (m[0] === 0xf0) {                                     // last check right before sending
      const v = validate(m);
      if (!v.ok) { queue = []; task = null; status("STOP: frame failed validation while sending (" + v.reason + ")"); return; }
    }
    for (const b of m) outlet(0, b);
    if (SID_DEV) tally(m);
    if (m[0] === 0xf0 && m[6] === ID_STORE) lockStore();
    if (m[0] === 0xf0 && m[6] === ID_REQUEST) expectReply("dump");
    if (m[0] === 0xf0 && m[6] === ID_SETTINGS) expectReply("settings");
    const ms = pace(m);
    if (ms) { task.schedule(ms); return; }
    if (storing || waiting.dump) { task.schedule(10); return; }
  }
  task = null;
}

// Development builds only (SID_DEV): what leaves for the synth, counted per kind and logged once a second while anything goes
// out (the "bus:" lines are logged when a message arrives, not when it is sent).
const sent = {}; let sentTask = null;
function tally(m) {
  const k = m[0] !== 0xf0 ? ((m[0] & 0xf0) === 0xb0 ? "CC" : TYPE[m[0] & 0xf0] || "channel")
    : m[6] === ID_DP ? "DP" : m[6] === ID_REQUEST ? "dump request" : m[6] === ID_SETTINGS ? "settings request" : m[6] === ID_STORE ? "store" : "patch frame";
  sent[k] = (sent[k] || 0) + 1;
  if (!sentTask) {
    sentTask = new Task(() => { sentTask = null; sidlog("send", "sent last second: " + Object.keys(sent).map((k) => sent[k] + " " + k).join(", ") + ", " + queue.length + " queued"); for (const k of Object.keys(sent)) delete sent[k]; });
    sentTask.schedule(1000);
  }
}

// The same checks on entering the queue (accept) and right before sending (drainOne): 01 and DP rows outside the whitelist never go out.
function validate(m) {
  switch (m[6]) {
    case ID_CLEAR: return { ok: false, reason: "01 clears every patch on the synth and is never sent" };
    case ID_DP: {
      const v = validateDPFrame(m);
      if (!v.ok) return v;
      const row = ((m[7] << 7) | m[8]) + ":" + m[9] + ":" + m[10];
      return DP_ROWS.has(row) ? v : { ok: false, reason: "DP row " + row + " not in whitelist" };
    }
    case ID_REQUEST: return validateRequestFrame(m);
    case ID_SETTINGS: return validateSettingsFrame(m);
    case ID_STORE: return validateStoreFrame(m);
    default: return validateFrame(m);
  }
}

function lockStore() {
  storing = new Task(() => { unlockStore(); noReply("store", "store: NO REPLY within " + STORE_TIMEOUT_MS + " ms – the patch may or may not have been stored"); });
  storing.schedule(STORE_TIMEOUT_MS);
  status("store sent, waiting for the reply");
}
// The track's notes are held while the synth stores (it compacts its patch memory) and go out in order afterwards: held, not
// dropped, so no note-off is lost and no note hangs. At most HELD_MAX messages; more is dropped and logged. Clock and active
// sensing are dropped instead: a clock that arrives late is wrong anyway, and a running clock must not fill the room for the notes.
const held = [], HELD_MAX = 256;
let heldDropped = 0;
function unlockStore() {
  storing = null;
  if (held.length || heldDropped) sidlog("send", "store done: " + held.length + " held messages out" + (heldDropped ? ", " + heldDropped + " dropped" : ""));
  for (const m of held.splice(0)) for (const x of m) outlet(0, x);
  heldDropped = 0;
}
function play(m) {
  if (!storing) { for (const x of m) outlet(0, x); return; }
  if (m[0] === 0xf8 || m[0] === 0xfe) return;
  if (held.length < HELD_MAX) held.push(m); else heldDropped++;
}
function stored(st, slot, size, sum, free) {
  if (!storing) { sidlog("send", "store reply without a pending store"); return; }
  storing.cancel(); unlockStore();
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
    const v = validate(m);
    if (!v.ok) return refuse(what, v.reason);
    if (m[6] === ID_STORE && (storing || queue.some((q) => q[0] === 0xf0 && q[6] === ID_STORE))) return refuse(what, "a store is already pending");
  } else {
    const len = CH_LEN[m[0] >> 4];
    if (!len || m.length !== len || m.slice(1).some((b) => b > 0x7f)) return refuse(what, "bad channel message");
  }
  enqueue(m);
  return true;
}
function refuse(what, why) { status("REFUSED " + what + ": " + why); return false; }

// The track's notes (built into SidStation): bytes from the osc 1 router, which already drops SysEx and passes whole channel
// messages. Collected again here and checked like any channel message, then output at once (notes must not wait behind
// DP traffic), except during a store (see play). SysEx bytes are never let through on this path.
// What the track sends, counted per message type and logged once a second while anything passes: a flood (aftertouch from a
// pad, a clock) can then be told from the notes.
const TYPE = { 0x80: "note off", 0x90: "note on", 0xa0: "poly aftertouch", 0xb0: "CC", 0xc0: "program change", 0xd0: "channel pressure", 0xe0: "pitch bend",
  0xf8: "clock", 0xfa: "start", 0xfb: "continue", 0xfc: "stop", 0xfe: "active sensing" };
const seen = {}; let seenTask = null;
function count(m) {
  const t = TYPE[m[0]] || TYPE[m[0] & 0xf0] || ("status " + m[0].toString(16));
  seen[t] = (seen[t] || 0) + 1;
  if (!seenTask) {
    seenTask = new Task(() => { seenTask = null; sidlog("send", "track input, last second: " + Object.keys(seen).map((k) => seen[k] + " " + k).join(", ")); for (const k of Object.keys(seen)) delete seen[k]; });
    seenTask.schedule(1000);
  }
}
const midiIn = midiParser({                                          // lib/midi.js
  realtime: (b) => { count([b]); play([b]); },
  channel: (m) => {
    count(m);
    // A program change from the track's input loads that patch on the synth at once (like choosing it on the synth's panel): logged, so it can be told apart from the editor
    if ((m[0] & 0xf0) === 0xc0) sidlog("send", "track input: program change", m[1], "on channel", (m[0] & 0x0f) + 1);
    play(m);
  },
  sysex: () => sidlog("send", "REFUSED SysEx on the note path"),
  broken: () => sidlog("send", "REFUSED SysEx on the note path"),
});
function msg_int(b) { midiIn(b); }                                   // a declared function: Max looks msg_int up on the global object

// From a router: "frame <bytes…>", one complete message at a time.
function frame() {
  const m = arrayfromargs(arguments).map(Number);
  if (!accept(m, "bus")) return;
  if (SID_DEV) status("bus: " + (m[0] === 0xf0 ? "DP " + m.slice(7, 12).map((b) => b.toString(16)).join(" ") : m.map((b) => b.toString(16)).join(" ")));
  outlet(1, "sent");                                                 // a control was used: the name display closes an open field
}

const COMMANDS = { stored, replied, frame };

function anything() {
  const name = String(messagename).replace(/^\//, "");
  const fn = COMMANDS[name];
  if (!fn) { status("unknown message " + messagename); return; }
  fn.apply(null, arrayfromargs(arguments));
}

function status(s) { sidlog("send", s); outlet(1, "status", s); }

msg_int = sidguard("send", msg_int); anything = sidguard("send", anything); frame = sidguard("send", frame);
sidlog("send", "loaded");
