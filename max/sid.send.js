// sid.send.js – the gateway: the ONLY path to the synth ("synth mutex"), built into SidStation. v8, Max 9.
// Built together with lib/maxlog.js + lib/sysex.js + lib/params.js by build/build-station.js (dist/sid.send.js).
//
// SAFETY: the SidStation's OS lives in PROM and can be destroyed by wrong SysEx
// (a chip has had to be reprogrammed before). Three rules apply here:
//  1. Only validated messages go out: patch frames that validateFrame()
//     accepts (id 02/03; id 01, which clears the whole patch memory, is always refused), Direct Program frames that validateDPFrame()
//     accepts AND that are in the params.js whitelist (dpRows),
//     channel messages with the right length and 7-bit data, and the dump request (id 05,
//     validateRequestFrame: exactly 9 bytes, slot 0..99 or 7F; only for a firmware with
//     dump-request support); with that firmware also the settings request (06, validateSettingsFrame) and store (07 7F, validateStoreFrame).
//  2. One message at a time, never interleaved: everything goes into ONE queue emptied by a
//     Task, one whole message per tick, with a pause suited to the type. The routers send "frame <bytes…>" here on an
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
//   pushed          Push patch is done (sent after every router queued its frames): the synth has the editor's sound, Store may go
//   arm             on load: says the Store state ("storable 0") so the button starts grey
// Store goes grey again after any change: a router frame, a request, a failed queue, and from the track a program
// change or a CC that sets a patch parameter (changesSound).
// "storable 0|1" on outlet 1: Store patch is allowed only right after Push patch (the button is greyed otherwise, see below).
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
// Store needs Push first. Store writes the synth's edit buffer, not the editor, so it is allowed only while the edit buffer is known
// to hold the editor's sound: from "pushed" (the Push button or CC 119, which arrives after every router has queued its frames)
// until anything else goes to the synth or a dump is requested (Pull replaces the editor). A store itself keeps the state, so a
// sound can be stored to a second patch number. "storable 0|1" on outlet 1 greys the Store button and shows the notice
// (build-station.js); a store while not storable is refused, also from Patch Action.
let storable = false;
function pushed() { storable = true; outlet(1, "storable", 1); status("pushed: the synth has the editor's sound, Store patch saves it to the patch number on the synth"); }
function touched() { if (!storable) return; storable = false; outlet(1, "storable", 0); }
function arm() { outlet(1, "storable", storable ? 1 : 0); }

// --- the queue ------------------------------------------------------------------

function enqueue(m) {
  queue.push(m);
  if (!task) { task = new Task(drain); drain(); }
}

function pace(m) {
  if (m[0] !== 0xf0) return 1;                               // channel message
  if (m[6] === ID_DP || m[6] === ID_REQUEST || m[6] === ID_SETTINGS || m[6] === ID_STORE) return 10;   // DP/requests: short pause
  return Math.round(m.length * 0.32) + GAP_MS;                // patch frame: wire time + storing
}

// An exception here would leave `task` set and never rescheduled, and every later message would wait for good: catch it,
// drop the queue and say so (the store lock, if any, still ends by its reply or timeout).
function drain() {
  try { drainOne(); }
  catch (e) { queue = []; task = null; touched(); status("STOP: error while sending (" + e.message + "), queue dropped"); }
}
function drainOne() {
  if (!task) return;
  if (storing) { task.schedule(10); return; }                // store lock: nothing to the synth until the reply
  if (!queue.length) { task = null; return; }
  const m = queue.shift();
  if (m[0] === 0xf0) {                                       // last check right before sending
    const v = validate(m);
    if (!v.ok) { queue = []; task = null; touched(); status("STOP: frame failed validation while sending (" + v.reason + ")"); return; }
  }
  for (const b of m) outlet(0, b);
  if (m[0] === 0xf0 && m[6] === ID_STORE) lockStore();
  if (m[0] === 0xf0 && m[6] === ID_REQUEST) expectReply("dump");
  if (m[0] === 0xf0 && m[6] === ID_SETTINGS) expectReply("settings");
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
    if (m[6] === ID_CLEAR) return refuse(what, "01 clears every patch on the synth and is never sent");
    if (m[6] === ID_DP) {
      const v = validateDPFrame(m);
      if (!v.ok) return refuse(what, v.reason);
      const row = ((m[7] << 7) | m[8]) + ":" + m[9] + ":" + m[10];
      if (!DP_ROWS.has(row)) return refuse(what, "DP row " + row + " not in whitelist");
    } else {
      const v = validate(m);
      if (!v.ok) return refuse(what, v.reason);
      if (m[6] === ID_STORE && (storing || queue.some((q) => q[0] === 0xf0 && q[6] === ID_STORE))) return refuse(what, "a store is already pending");
      if (m[6] === ID_STORE && !storable) return refuse(what, "Store patch needs Push patch first");
    }
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
    if (changesSound(m)) touched();                 // Store needs a new Push: the synth no longer has the editor's sound
    play(m);
  },
  sysex: () => sidlog("send", "REFUSED SysEx on the note path"),
  broken: () => sidlog("send", "REFUSED SysEx on the note path"),
});
function msg_int(b) { midiIn(b); }                                   // a declared function: Max looks msg_int up on the global object
// From the track (a clip, a controller): a program change, or a CC that sets a patch parameter, changes the synth's edit buffer.
// Playing controls do not: mod wheel (1), the LFO control sources (20-23) and sustain (64), nor notes, bend or pressure.
const PLAYING_CC = new Set([1, 20, 21, 22, 23, 64]);
function changesSound(m) { const t = m[0] & 0xf0; return t === 0xc0 || (t === 0xb0 && !PLAYING_CC.has(m[1])); }

// From a router: "frame <bytes…>", one complete message at a time.
function frame() {
  const m = arrayfromargs(arguments).map(Number);
  if (!accept(m, "bus")) return;
  if (!(m[0] === 0xf0 && (m[6] === ID_STORE || m[6] === ID_SETTINGS))) touched();   // a store or a settings request changes nothing
  status("bus: " + (m[0] === 0xf0 ? "DP " + m.slice(7, 12).map((b) => b.toString(16)).join(" ") : m.map((b) => b.toString(16)).join(" ")));
  outlet(1, "sent");                                                 // a control was used: the name display closes an open field
}

const COMMANDS = { stored, replied, frame, pushed, arm };

function anything() {
  const name = String(messagename).replace(/^\//, "");
  const fn = COMMANDS[name];
  if (!fn) { status("unknown message " + messagename); return; }
  fn.apply(null, arrayfromargs(arguments));
}

function status(s) { sidlog("send", s); outlet(1, "status", s); }

msg_int = sidguard("send", msg_int); anything = sidguard("send", anything); frame = sidguard("send", frame);
sidlog("send", "loaded");
