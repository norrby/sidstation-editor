// sid.capture.js – capture SidStation SysEx in Max for Live (v8, Max 9).
// Bundled with lib/maxlog.js, lib/sysex.js (decodeDump, decodeReply) and lib/midi.js by build/build-station.js (sidlog -> logs/max.log,
// so that the capture is visible outside the Max console).
//
// Usage: [midiin] -> [v8 sid.capture.js]. Every complete SidStation frame is decoded in the Max console; in a development
// build a patch dump is also saved as dumps/<date>_<patchname>.syx (see dumpDirs).
// Outlet 0: "patch <bytes...>" (decoded raw bytes), "stored …" (a 47 store reply), "replied dump|settings", "settings …" (a 46
// reply, to the loader only: the patcher routes only stored/replied to the gateway). Outlet 1: "saved <path>".

inlets = 1;
outlets = 2;

// Dumps are kept as files only in a development build (SID_DEV, set by build/build-station.js), and only when this folder
// exists (Max cannot create folders): Documents/SidStation-Editor/dumps in the home folder. The places to try come from
// sidUserPaths (lib/maxlog.js); the first that works is kept. A release only loads a dump into the editor.
let dumpDirs = SID_DEV ? sidUserPaths("Documents/SidStation-Editor/dumps") : [];
let seq = 0;

// Every complete F0..F7 frame (lib/midi.js); realtime in the middle is skipped, a frame cut off by a status byte is dropped.
const midiIn = midiParser({
  sysex: (f) => finish(f),
  broken: (part, b) => sidlog("capture", "frame cut off by " + hex(b) + " after " + part.length + " bytes, dropped"),
});
function msg_int(b) { midiIn(b); }                                   // a declared function: Max looks msg_int up on the global object

function finish(frame) {
  // Built into SidStation the capture hears the whole track input, so any SysEx can arrive (a 6-byte test frame
  // F0 7D … once crashed the tag below). Frames that are not SidStation frames are only logged (not saved: with All Ins
  // other gear's SysEx would fill dumps/) and go no further.
  if (frame.length < 8 || !hasSidHeader(frame)) {
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
  const info = decodeDump(frame);
  if (dumpDirs.length) keep(frame, info);
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

function keep(frame, info) {
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

function report(m, r) {
  post("---- SidStation sysex, " + m.length + " MIDI-bytes, id " + hex(r.id) + " ----\n");
  if (r.id === ID_SKIP) { sidlog("capture", "skip patch (03): empty patch number"); return; }
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

msg_int = sidguard("capture", msg_int);
sidlog("capture", "loaded");
