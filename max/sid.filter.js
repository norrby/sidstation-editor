// sid.filter.js – v8 router for the filter (common parameters). Built together with lib/maxlog.js,
// lib/sysex.js, lib/params.js (dist/sid.filter.js). Sends "frame <bytes…>" on outlet 1 (the patcher takes it to the gateway).
// Same rule as the osc router: CC when the parameter has a CC (27–33, all 0..127), otherwise Direct
// Program. Two fields are written as a whole because the SID stores the bits in the same byte:
//   routing (FLT1..3, DP 00 18 07 00) via "route <n> <0|1>", type (LP/BP/HP, DP 00 19 07 00) via the ftype menu 0..6.
// In:  <param> <v>      cutoff res envdepth lfodepth fattack fdecay fsustain frelease wheel flfo ftype wrap invert poly legato hcut
//      route <n> <0|1>  osc n through the filter (1) or straight to the output (0)
//      namechar <i> <code>  the patch name's character i (1..10), ASCII -> DP 00 0(i-1) 7f 00 (from sid.name.js via the Name parameters)
//      arm              start sending (on load the values from live.* come first)
//      sendall          send everything now
//      quiet [ms]       patch dump on its way in (sid.load.js): send nothing for 1.5 s

inlets = 1;
outlets = 2;

const defs = {};
for (const d of SidParams.FILTER.concat(SidParams.COMMON)) defs[d.key] = d;   // also patch-wide settings (poly, legato, hcut)
const val = {};
const fields = { filterRouting: 0x07, filterType: 0x01 };
let armed = false, chan = 1;

function arm() { if (!armed) sidlog("filter", "armed"); armed = true; }
const armTask = new Task(arm);
armTask.schedule(1500);
let quietUntil = 0;
function quiet(ms) { quietUntil = Date.now() + (ms === undefined ? 1500 : Number(ms)); }
const muted = () => !armed || Date.now() < quietUntil;

// To the synth: "frame <bytes…>" on outlet 1 to the device's own gateway (sid.send.js), not over a global bus.
function tx(bytes) { outlet.apply(null, [1, "frame"].concat(bytes)); }
function sendField(name) {
  const r = SidParams.COMMON_DP[name];
  try { tx(encodeDP(r.addr, r.mask, r.shift, fields[name])); }
  catch (e) { sidlog("filter", "DP error", name, "=", fields[name], ":", e.message); }
}
function setBit(name, bit, on) {
  const next = on ? (fields[name] | (1 << bit)) : (fields[name] & ~(1 << bit));
  if (next === fields[name] && armed) return;
  fields[name] = next;
  if (!muted()) sendField(name);
}
function setField(name, value) {
  if (value === fields[name] && armed) return;
  fields[name] = value;
  if (!muted()) sendField(name);
}
const routeSeen = [];
function route(n, v) {
  n = n | 0;
  if (n < 1 || n > 3) { sidlog("filter", "route: osc outside 1..3", n); return; }
  const bit = 1 << (n - 1);
  if (!routeSeen[n]) { routeSeen[n] = true; fields.filterRouting = v ? fields.filterRouting | bit : fields.filterRouting & ~bit; return; }   // restored on load: not sent (see param)
  setBit("filterRouting", n - 1, !!v);
}
const nameChars = [];                                   // 1..10 -> ASCII; also sent by sendall
function namechar(i, code) {
  i = i | 0; code = code | 0;
  if (i < 1 || i > SidParams.NAME_LEN || code < 0 || code > 127) { sidlog("filter", "namechar out of range", i, code); return; }
  const first = nameChars[i - 1] === undefined;
  nameChars[i - 1] = code;
  if (first || muted()) return;                         // the first is restored by Live on load (see param)
  try { tx(encodeDP(i - 1, 0x7f, 0, code)); }
  catch (e) { sidlog("filter", "DP error namechar", i, "=", code, ":", e.message); }
}
function sendParam(d, v) {
  if (d.cc !== undefined) { tx([0xb0 | (chan - 1), d.cc & 0x7f, SidParams.toCC(v, d.min, d.max) & 0x7f]); return; }
  try { tx(encodeDP(d.dp[0], d.dp[1], d.dp[2], v)); }
  catch (e) { sidlog("filter", "DP error", d.key, "=", v, ":", e.message); }
}
function param(key, v) {
  const d = defs[key];
  if (!d) { sidlog("filter", "unknown parameter", key); return; }
  if (typeof v === "string" && d.labels) v = d.labels.indexOf(v);
  else if (v === "on" || v === "off") v = v === "on" ? 1 : 0;
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) { sidlog("filter", "invalid value", key, v); return; }
  v = Math.max(d.min, Math.min(d.max, v));
  const first = !(key in val);
  val[key] = v;
  // The first value of a parameter is what Live restores when the device loads: it is the starting point and never goes
  // to the synth, whenever it arrives (once it came after "armed" and 155 values overwrote the synth's edit buffer).
  if (first) {
    if (d.field) fields[d.field] = d.values ? d.values[v] : v === 1 ? fields[d.field] | (1 << d.bit) : fields[d.field] & ~(1 << d.bit);
    if (armed) sidlog("filter", "first value kept, not sent:", key, v);
    return;
  }
  if (d.field) { if (d.values) setField(d.field, d.values[v]); else setBit(d.field, d.bit, v === 1); return; }
  if (muted()) return;
  sendParam(d, v);
}
function sendall() {
  armed = true; quietUntil = 0;
  for (const key of Object.keys(val)) { const d = defs[key]; if (!d.field) sendParam(d, val[key]); }
  for (const name of Object.keys(fields)) sendField(name);
  nameChars.forEach((c, k) => { if (c !== undefined) tx(encodeDP(k, 0x7f, 0, c)); });
  outlet(0, "status", "filter: sent " + Object.keys(val).length + " parameters");
}
// Fetch patch: dump request for the current slot (05 7F, our firmware only). The answer (the 02 frame = the STORED patch, not
// the edit buffer) comes in through the capture and is loaded into the panels by sid.load.js.
function fetch() {
  try {
    tx(encodeRequest(0x7f)); tx(encodeSettingsRequest());                 // 06: the update rate for the table playheads
    outlet(0, "status", "filter: fetch requested (current slot)"); sidlog("filter", "fetch: request 05 7F + settings 06");
  }
  catch (e) { sidlog("filter", "fetch error:", e.message); }
}
// Store patch: 07 7F (needs a firmware with store support) – the synth stores its edit buffer to the current slot and replies 47; the gateway
// holds every other message to the synth until that reply (the store compacts the patch memory).
function store() {
  try { tx(encodeStore()); outlet(0, "status", "filter: store requested (current slot)"); sidlog("filter", "store: 07 7F"); }
  catch (e) { sidlog("filter", "store error:", e.message); }
}
function channel(n) { chan = Math.max(1, Math.min(16, n | 0)); }
function anything() {
  const a = arrayfromargs(arguments);
  param(String(messagename), a[0]);
}

anything = sidguard("filter", anything); route = sidguard("filter", route); namechar = sidguard("filter", namechar); sendall = sidguard("filter", sendall); fetch = sidguard("filter", fetch); store = sidguard("filter", store); quiet = sidguard("filter", quiet);
sidlog("filter", "loaded");
