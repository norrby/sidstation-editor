#!/usr/bin/env node
// sid.js – send commands to SidStation's gateway in Live via OSC over UDP 127.0.0.1:9871.
//   node tools/sid.js cc 42 127          CC 42 = 127 on channel 1
//   node tools/sid.js note 60 100        note on;  node tools/sid.js note 60 0  = note off
//   node tools/sid.js pc 11              program change (patch slot)
//   node tools/sid.js dp 0 86 15 4 1        Direct Program Ph Pl mask shift value (osc1 wave = Tri)
//   node tools/sid.js request 14          dump request for slot 14 (127 = current); needs a firmware with dump-request support
//   node tools/sid.js load /abs/path.syx ; node tools/sid.js send ; node tools/sid.js stop
// The device only lets through 7-bit CC/notes and validated patch frames.
const dgram = require("dgram");
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error("give a command"); process.exit(2); }
const pad = (buf) => Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]);   // OSC: null-terminated, 4-byte aligned
const str = (s) => pad(Buffer.from(s, "utf8"));
const parts = args.map((a) => (/^-?\d+$/.test(a) ? { t: "i", v: Number(a) } : { t: "s", v: a }));
const body = parts.map((p) => (p.t === "i" ? (() => { const b = Buffer.alloc(4); b.writeInt32BE(p.v); return b; })() : str(p.v)));
const packet = Buffer.concat([str("/" + cmd), str("," + parts.map((p) => p.t).join("")), ...body]);
const sock = dgram.createSocket("udp4");
sock.send(packet, 9871, "127.0.0.1", (err) => { if (err) { console.error(err.message); process.exit(1); } console.log("sent:", "/" + cmd, args.join(" ")); sock.close(); });
