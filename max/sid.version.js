// sid.version.js – v8: the editor's version, kept in the Live Set. Argument: the version from package.json (the build).
// Bundled with lib/maxlog.js (dist/sid.version.js).
// In:  the hidden Version parameter (a live.numbox, stored only, no automation): its first value is what Live restores when the
//      set loads – the build's own version for a new device (the parameter's initial value), the saved one for a set, 0 for a set
//      saved before the version was kept. It is logged, and if it is not the device's own version, that goes back into the
//      parameter after 50 ms (a value sent in the same event as Live's own update never reaches Live), so a saved set says which
//      version last had it. Only then: every write is a step in Live's undo history, and a new device must go away on one Cmd+Z.
//      Nothing else happens: no migration, nothing to the synth.
// Out: outlet 0 -> the Version parameter: the device's version as a number, major * 10000 + minor * 100 + patch
//      (0.3.2 = 302, 1.0.0 = 10000).

inlets = 1;
outlets = 1;

const VERSION = typeof jsarguments !== "undefined" && jsarguments[1] !== undefined ? String(jsarguments[1]) : "0.0.0";
function encode(v) { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v)); return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0; }
function decode(n) { n = Math.round(n); return Math.floor(n / 10000) + "." + (Math.floor(n / 100) % 100) + "." + (n % 100); }
const CODE = encode(VERSION);
let stamp = null;                                                        // the Task that writes the version back, or null
let seen = false;                                                        // the first value (Live's restore) has been logged
let stamped = false;                                                     // written once per load: if the echo differs, it is logged, never written again (no loop)

function msg_float(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return;
  if (!seen) {
    seen = true;
    sidlog("version", n === CODE ? "new device, or a set saved with " + VERSION + ", same as the device"
      : n > 0 ? "set saved with " + decode(n) + ", device is " + VERSION
      : "set saved before the version was kept; device is " + VERSION);
  }
  if (n === CODE) return;
  if (stamped) { sidlog("version", "the parameter holds " + n + " after " + CODE + " was written: not kept"); return; }
  stamped = true;
  stamp = new Task(() => { stamp = null; outlet(0, CODE); });
  stamp.schedule(50);
}
function msg_int(v) { msg_float(v); }
function anything() { post("sid.version: unknown message " + messagename + "\n"); }

msg_float = sidguard("version", msg_float);
sidlog("version", "device version " + VERSION);
