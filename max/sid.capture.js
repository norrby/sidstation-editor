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
// Documents/SidStation/dumps in the home folder; the places to try come from sidUserPaths (lib/maxlog.js), the first
// that works is kept. "dir <path>" sets one folder instead.
let dumpDirs = sidUserPaths("Documents/SidStation/dumps");
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
function dir(p) { dumpDirs = [String(p)]; post("sid.capture: dir = " + p + "\n"); }
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
  const name = "/" + stamp + "_" + String(seq).padStart(3, "0") + "_" + tag + ".syx";
  const dir = dumpDirs.find((p) => save(p + name, frame));
  if (dir) {
    dumpDirs = [dir];
    sidlog("capture", "saved " + frame.length + " bytes to " + dir + name);
    outlet(1, "saved", dir + name);
  } else {
    sidlog("capture", "not saved: " + dumpDirs.join(" or ") + " does not exist (create it to keep dumps) – hex follows in the console");
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
      r.patchSpeed + " Hz, period " + r.period + " -> " + r.rateHz.toFixed(1) + " Hz, slot " + r.slot + " (loaded " + r.loaded + "), base ch " + (r.baseCh + 1));
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
