// validate-bank.js – check a .syx before it is sent to the SidStation.
//   node tools/validate-bank.js <file.syx> [--clean <out.syx>]
// --clean writes a copy without invalid 02 frames (the 03 frames are kept so the
// slots line up). The file is refused outright if 01/03 frames or the header are wrong.
const fs = require("fs");
const S = require("../lib/sysex");

const [file, flag, out] = process.argv.slice(2);
if (!file) { console.error("give a file"); process.exit(2); }
const bytes = [...fs.readFileSync(file)];
const { frames, rows, stray, positions } = S.validateBank(bytes);
const bad = rows.filter((r) => !r.ok);
const fatal = bad.filter((r) => r.id !== S.ID_DUMP);
console.log(file.split("/").pop() + ": " + frames.length + " frames, " + positions + " slots, " + stray + " stray bytes, " + bad.length + " invalid");
for (const r of bad) console.log("  frame " + r.i + " pos " + r.pos + " id " + r.id + " " + (r.name ? JSON.stringify(r.name) + " " : "") + "– " + r.reason);
if (stray) console.log("  NOTE: bytes outside frames");
if (fatal.length || stray) { console.log("REFUSED: the file is not a clean SidStation patch dump"); process.exit(1); }
const okDumps = rows.filter((r) => r.ok && r.id === S.ID_DUMP);
console.log("  valid patches: " + okDumps.length + (okDumps.length ? "  (" + okDumps.map((r) => r.pos + ":" + r.name.trim()).join(", ") + ")" : ""));
if (flag === "--clean" && out) {
  const keep = rows.filter((r) => r.ok).map((r) => frames[r.i]);
  fs.writeFileSync(out, Buffer.from([].concat(...keep)));
  console.log("wrote " + out + " with " + keep.length + " frames (removed " + bad.length + ")");
}
