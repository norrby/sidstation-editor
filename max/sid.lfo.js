// sid.lfo.js – v8 router for LFO 1–4. Built together with lib/maxlog.js, lib/sysex.js, lib/params.js (dist/sid.lfo.js).
// Sends "frame <bytes…>" on outlet 1 to the gateway (see sid.filter.js). Same rule as the filter: CC when the parameter has a CC (speed, depth, add depth,
// fade in, S/H, lace speed; 88–95 + 102–117), otherwise Direct Program on the LFO block's row (01 06.. / 01 22.. / 01 3e.. / 01 5a..).
// Type/source and option/target share bytes but have their own masked DP rows, so each parameter is sent on its own.
// In:  lfo <n> <param> <v>   n 1..4, param per SidParams.LFO (type speed depth … ctrlval)
//      arm                   start sending (on load the values from live.* come first)
//      sendall               send everything now
//      quiet [ms]            patch dump on its way in (sid.load.js): send nothing for 1.5 s

inlets = 1;
outlets = 2;

const defs = {};
for (const d of SidParams.LFO) defs[d.key] = d;
const val = [{}, {}, {}, {}];
let armed = false, chan = 1;

function arm() { if (!armed) sidlog("lfo", "armed"); armed = true; }
const armTask = new Task(arm);
armTask.schedule(1500);
let quietUntil = 0;
function quiet(ms) { quietUntil = Date.now() + (ms === undefined ? 1500 : Number(ms)); }
const muted = () => !armed || Date.now() < quietUntil;

function tx(bytes) { outlet.apply(null, [1, "frame"].concat(bytes)); }   // to the gateway (see sid.filter.js)
function sendParam(n, d, v) {
  const cc = SidParams.lfoCC(n, d);
  if (cc !== null) { tx([0xb0 | (chan - 1), cc & 0x7f, SidParams.toCC(v, d.min, d.max) & 0x7f]); return; }
  const r = SidParams.lfoDP(n, d);
  try { tx(encodeDP(r.addr, r.mask, r.shift, v)); }
  catch (e) { sidlog("lfo", "DP error lfo", n, d.key, "=", v, ":", e.message); }
}
function lfo(n, key, v) {
  n = n | 0;
  if (n < 1 || n > 4) { sidlog("lfo", "LFO outside 1..4", n); return; }
  const d = defs[key];
  if (!d) { sidlog("lfo", "unknown parameter", key); return; }
  if (typeof v === "string" && d.labels) v = d.labels.indexOf(v);
  else if (v === "on" || v === "off") v = v === "on" ? 1 : 0;
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) { sidlog("lfo", "invalid value", key, v); return; }
  v = Math.max(d.min, Math.min(d.max, v));
  val[n - 1][key] = v;
  if (muted()) return;
  sendParam(n, d, v);
}
function sendall() {
  armed = true; quietUntil = 0;
  let k = 0;
  for (let n = 1; n <= 4; n++) for (const key of Object.keys(val[n - 1])) { sendParam(n, defs[key], val[n - 1][key]); k++; }
  outlet(0, "status", "lfo: sent " + k + " parameters");
}
function channel(n) { chan = Math.max(1, Math.min(16, n | 0)); }
function anything() { sidlog("lfo", "unknown message", messagename); }

lfo = sidguard("lfo", lfo); sendall = sidguard("lfo", sendall); quiet = sidguard("lfo", quiet);
sidlog("lfo", "loaded");
