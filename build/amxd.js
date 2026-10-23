// amxd.js – read/write Max for Live devices (.amxd) and helpers for patcher JSON.
// Format: "ampf" u32(4) "mmmm" | "meta" u32(4) u32(0) | "ptch" u32(len) JSON "\n\0".
const fs = require("fs");
const { writeIfChanged, copyIfChanged } = require("./write");

const TEMPLATE_MIDI = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Misc/Max Devices/Max MIDI Effect.amxd";

function readAmxd(file) {
  const raw = fs.readFileSync(file);
  const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
  return { header: raw.subarray(0, i), json: JSON.parse(raw.subarray(i, j + 1).toString("utf8")) };
}

function writeAmxd(file, json, type = "mmmm") {
  const body = Buffer.from(JSON.stringify(json, null, "\t") + "\n\0", "utf8");
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  writeIfChanged(file, Buffer.concat([
    Buffer.from("ampf"), u32(4), Buffer.from(type),
    Buffer.from("meta"), u32(4), u32(0),
    Buffer.from("ptch"), u32(body.length), body,
  ]));
}

// Empty MIDI effect from Live's template with our patcher attributes set.
function midiEffectSkeleton(title, width) {
  const { json } = readAmxd(TEMPLATE_MIDI);
  const p = json.patcher;
  p.appversion = { major: 9, minor: 1, revision: 5, architecture: "x64", modernui: 1 };
  p.title = title;
  p.openinpresentation = 1;
  p.openrect = [0, 0, width, 169];
  p.devicewidth = width;
  p.boxes = [];
  p.lines = [];
  return json;
}

const box = (id, maxclass, rect, extra = {}) =>
  ({ box: { id, maxclass, patching_rect: rect, numinlets: 1, numoutlets: 0, ...extra } });
const obj = (id, text, rect, outlets = 1, outlettype = [""], extra = {}) =>
  box(id, "newobj", rect, { text, numoutlets: outlets, outlettype, fontname: "Arial Bold", fontsize: 10, ...extra });
const msg = (id, text, rect, pres) =>
  box(id, "message", rect, { text, numoutlets: 1, outlettype: [""], ...(pres ? { presentation: 1, presentation_rect: pres } : {}) });
const comment = (id, text, rect, pres, extra = {}) =>
  box(id, "comment", rect, { text, fontname: "Arial Bold", fontsize: 10, ...(pres ? { presentation: 1, presentation_rect: pres } : {}), ...extra });
const line = (src, so, dst, di) => ({ patchline: { source: [src, so], destination: [dst, di] } });
// own id: "obj-9" collided with boxes in SidAdsrTest, SidPulseTest and SidTableTest (test/amxd.test.js)
const verticalLimit = () => box("obj-vlimit", "comment", [0, 170, 133, 20],
  { text: "Device vertical limit", hidden: 1, fontname: "Ableton Sans Medium Regular", fontsize: 11 });

module.exports = { TEMPLATE_MIDI, readAmxd, writeAmxd, midiEffectSkeleton, box, obj, msg, comment, line, verticalLimit };
