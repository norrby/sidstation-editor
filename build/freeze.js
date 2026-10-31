// freeze.js – a frozen .amxd for a release, as Max's Freeze Device writes it: the device and every file it uses in one file.
//   node build/freeze.js [device.amxd] [out.amxd]     default: dist/<productName>.amxd -> release/<version>/<productName with dashes>.amxd
// The file name has no version in it: a Live Set refers to the device by its file, so a user upgrades by overwriting the file, and
// the set restores every value by the parameters' long names. The version is inside the device (sid.version.js, the description).
// Format (read from a device Max froze): "ampf" u32(4) "mmmm" | "meta" u32(4) u32(7) | "ptch" u32(len) and in it, big-endian:
// "mx@c" u32(16) u32(0) u32(offset of dlst) | the patcher JSON | the files, one after another | "dlst" u32(len) and per file
// "dire" u32(len) with the fields type, fnam (name + NUL, padded to 4), sz32, of32 (offset from "mx@c"), vers 0, flag (0x11
// for the device, 0 otherwise), mdat (seconds since 1904). Max embeds the files unchanged; mdat is the commit time here, so the
// same commit gives the same file.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const { productName, version } = require(path.join(ROOT, "package.json"));
const src = path.resolve(process.argv[2] || path.join(ROOT, "dist", productName + ".amxd"));
const out = path.resolve(process.argv[3] || path.join(ROOT, "release", version, productName.replace(/ /g, "-") + ".amxd"));
const dir = path.dirname(src);

// The patcher JSON from an unfrozen device ("ptch" u32 JSON).
const raw = fs.readFileSync(src);
if (raw.subarray(0, 4).toString() !== "ampf" || raw.subarray(24, 28).toString() !== "ptch") throw new Error(src + ": not an unfrozen .amxd");
const json = raw.subarray(32, 32 + raw.readUInt32LE(28));

// The files it uses: every .js/.svg/.md named in the patcher that exists next to it, and the .svg files those scripts name. The .md is
// the device guide, which the device's description names, so a program reading the description knows where to find it.
const named = (text) => [...new Set(text.match(/[\w.-]+\.(?:js|svg|md)\b/g) || [])].filter((f) => fs.existsSync(path.join(dir, f)));
const files = new Set(named(json.toString("utf8")));
for (const f of [...files]) if (f.endsWith(".js")) for (const g of named(fs.readFileSync(path.join(dir, f), "utf8"))) if (g.endsWith(".svg")) files.add(g);

const be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const field = (tag, data) => Buffer.concat([Buffer.from(tag), be(8 + data.length), data]);
const fnam = (name) => { const n = Buffer.from(name + "\0"); return Buffer.concat([n, Buffer.alloc((4 - (n.length % 4)) % 4)]); };
const commit = Number(execSync("git log -1 --format=%ct", { cwd: ROOT }).toString().trim());
const mdat = be(commit + 2082844800);                                       // 1904 -> 1970

const entries = [{ name: path.basename(src), type: "JSON", flag: 0x11, data: json }]
  .concat([...files].sort().map((f) => ({ name: f, type: f.endsWith(".svg") ? "svg " : "TEXT", flag: 0, data: fs.readFileSync(path.join(dir, f)) })));
let offset = 16;
const dire = entries.map((e) => {
  const d = Buffer.concat([field("type", Buffer.from(e.type)), field("fnam", fnam(e.name)), field("sz32", be(e.data.length)),
    field("of32", be(offset)), field("vers", be(0)), field("flag", be(e.flag)), field("mdat", mdat)]);
  offset += e.data.length;
  return field("dire", d);
});
const dlst = field("dlst", Buffer.concat(dire));
const mx = Buffer.concat([Buffer.from("mx@c"), be(16), be(0), be(offset), ...entries.map((e) => e.data), dlst]);
const frozen = Buffer.concat([Buffer.from("ampf"), le(4), Buffer.from("mmmm"), Buffer.from("meta"), le(4), le(7), Buffer.from("ptch"), le(mx.length), mx]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, frozen);
console.log("wrote " + path.relative(ROOT, out) + ": " + entries.length + " files, " + frozen.length + " bytes");
