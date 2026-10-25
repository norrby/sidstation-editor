// maxlog.js – shared log for all v8/v8ui scripts (bundled in by the build scripts).
// Everything goes to the Max console. For troubleshooting it can also go to a file – loading, arming, refused messages and,
// above all, exceptions caught in message handlers (sidguard) – but only when the log folder exists, since Max cannot create
// folders: create ~/Library/Logs/SidStation (macOS) or Documents\SidStation\logs in your user folder (Windows) to get max.log.
//   sidlog(tag, ...parts)      write one line (post + file)
//   sidguard(tag, fn)          return fn wrapped in a try/catch that logs errors
//   sidUserPaths(rel)          the places to try for a file or folder in the user's home folder (also used for the dumps)

// Max expands "~" to the home folder on macOS. On Windows that is not certain, so the home folder is also taken from the
// device's own path when it lies under C:/Users/<name>/ (the User Library is in Documents there). os and devicePath are
// parameters for the tests; in Max they come from max.os and this.patcher.filepath.
const SID_OS = typeof max !== "undefined" && max.os ? String(max.os) : "macintosh";
const SID_DEVICE_PATH = (function (t) { try { return String(t.patcher.filepath || ""); } catch (e) { return ""; } })(this);
function sidUserPaths(rel, os, devicePath) {
  os = os || SID_OS;
  devicePath = devicePath === undefined ? SID_DEVICE_PATH : devicePath;
  const paths = [];
  if (os === "windows") {
    const m = /^([A-Za-z]:[\\/]Users[\\/][^\\/]+)[\\/]/i.exec(devicePath);
    if (m) paths.push(m[1].replace(/\\/g, "/") + "/" + rel);
  }
  paths.push("~/" + rel);
  return paths;
}
const SIDLOG_FILES = sidUserPaths(SID_OS === "windows" ? "Documents/SidStation/logs/max.log" : "Library/Logs/SidStation/max.log");

// File opens even when its folder is missing (the write just goes nowhere), so a path counts only once a line written
// there can be read back. Until then the candidates are tried again at most every 10 s, so a folder created later is found.
let sidlogFile = null, sidlogProbed = 0;
function sidlogWrite(path, line) {
  const f = new File(path, "write", "TEXT");
  if (!f.isopen) return false;
  f.position = f.eof; f.writestring(line + "\n"); f.close();
  const r = new File(path, "read");
  const ok = r.isopen && r.eof > 0;
  r.close();
  return ok;
}

function sidlog(tag) {
  const parts = Array.prototype.slice.call(arguments, 1).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)));
  const line = (function (d) { return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? "0" : "") + n; }).join(":"); })(new Date()) + " [" + tag + "] " + parts.join(" ");
  try { post(line + "\n"); } catch (e) {}
  try {
    if (typeof File === "undefined") return;
    if (sidlogFile) { sidlogWrite(sidlogFile, line); return; }
    if (Date.now() - sidlogProbed < 10000) return;
    sidlogProbed = Date.now();
    for (const p of SIDLOG_FILES) if (sidlogWrite(p, line)) { sidlogFile = p; return; }
  } catch (e) {}
}

function sidguard(tag, fn) {
  return function () {
    try { return fn.apply(this, arguments); }
    catch (e) {
      const where = e && e.stack ? " | " + String(e.stack).split("\n").slice(0, 2).join(" ") : "";
      sidlog(tag, "ERROR in " + (fn.name || "?") + "(" + Array.prototype.slice.call(arguments).join(" ") + "): " + (e && e.message || e) + where);
    }
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { sidlog, sidguard, sidUserPaths };
