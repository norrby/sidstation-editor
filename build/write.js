// write.js – write a build output only when its content changed. Every rewrite of a dist file makes Live/Max reload it: a
// rewritten .amxd reloads that device, a rewritten script reloads every instance via autowatch. Rewriting everything on each
// build made Live peak at ~600 % CPU, so unchanged files are left alone.
const fs = require("fs");

function writeIfChanged(file, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  try { if (fs.readFileSync(file).equals(buf)) return false; } catch (e) { /* new file */ }
  fs.writeFileSync(file, buf);
  return true;
}
function copyIfChanged(from, to) { return writeIfChanged(to, fs.readFileSync(from)); }

module.exports = { writeIfChanged, copyIfChanged };
