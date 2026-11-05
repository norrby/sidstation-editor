// sid.connect.js – Connect: asks the synth which OS it runs and sets the Synth OS parameter. v8, Max 9.
// Built together with lib/maxlog.js and lib/sysex.js by build/build-station.js (dist/sid.connect.js).
//
// Connect sends the settings request (06) and the version request (08) through the gateway. The answer decides the choice:
//   a 48 reply                 -> its version (synthOsIndex: an OS newer than the editor knows counts as the newest it knows)
//   46 but no 48 within 3 s    -> 1.12 R01 (it answers 06 but not 08)
//   neither                    -> OS <= 1.11, and the overview says so: the synth may as well be off or not connected
// Only a Connect sets the choice; replies to Pull (06) change nothing.
// In:  connect                       the Connect button
//      version <major> <minor> <rev> a 48 reply (from the capture)
//      answered <what>, noreply <what>  from the gateway (what = dump | settings | version | store)
// Out 0: the choice (0 = OS <= 1.11, 1 = 1.12 R01, 2 = 1.12 R02, ...) -> the Synth OS parameter
// Out 1: "frame <bytes…>" -> the gateway
// Out 2: "say <line> <line>" -> the overview's notice

inlets = 1;
outlets = 3;

let pending = null;                          // while a Connect waits: { settings: null | true | false }

function connect() {
  pending = { settings: null };
  outlet.apply(null, [1, "frame"].concat(encodeSettingsRequest()));
  outlet.apply(null, [1, "frame"].concat(encodeVersionRequest()));
  sidlog("connect", "connect: settings request 06 + version request 08");
}
function choose(i, why) {
  pending = null;
  sidlog("connect", "Synth OS set to " + SYNTH_OS[i] + " (" + why + ")");
  outlet(0, i);
}
function version(major, minor, revision) {
  if (!pending) return;
  choose(synthOsIndex(Number(major), Number(minor), Number(revision)), "the synth replied OS " + major + "." + minor + " R" + String(revision).padStart(2, "0"));
}
function answered(what) { if (pending && what === "settings") pending.settings = true; }
function noreply(what) {
  if (!pending) return;
  if (what === "settings") { pending.settings = false; return; }
  if (what !== "version") return;
  if (pending.settings) { choose(1, "settings answered, version not"); return; }
  choose(0, "no reply");
  outlet(2, "say", "No reply: set to " + SYNTH_OS[0], "(or the synth is not connected).");
}

connect = sidguard("connect", connect); version = sidguard("connect", version); answered = sidguard("connect", answered); noreply = sidguard("connect", noreply);
sidlog("connect", "loaded");
