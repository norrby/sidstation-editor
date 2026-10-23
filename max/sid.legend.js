// sid.legend.js – v8ui: legend with toggleable layers for the frequency response (sid.filtcurve.js). Four rows,
// each drawn like its layer in the graph (dashed yellow peak, dashed pink sustain, dotted green LFO,
// dashed white cutoff) + label. A click toggles the layer: a switched-off row turns grey.
// In:  set <key> 0|1      (silent)      bang  (send all)
// Out: show <key> 0|1     key = env | sus | lfo | cut
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

const ROWS = [
  { key: "env", label: "Depth", color: UI.peak, dash: [4, 3] },   // Env depth (the manual: EnvDpth); "Depth" is easier to understand
  { key: "sus", label: "Sus", color: UI.sus, dash: [4, 3] },
  { key: "lfo", label: "LFO", color: UI.lfo, dash: [2, 2] },
  { key: "cut", label: "Cut", color: [1, 1, 1, 0.7], dash: [3, 3] },
];
const on = { env: 1, sus: 1, lfo: 1, cut: 1 };
const OFF = [1, 1, 1, 0.25];
const born = Date.now();   // see sid.fold.js: clicks during loading are ignored

function paint() {
  const w = mgraphics.size[0], h = mgraphics.size[1], rowH = h / ROWS.length;
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(8);
  mgraphics.set_line_width(1.5);
  ROWS.forEach((r, i) => {
    const y = Math.round(rowH * (i + 0.5)) + 0.5, col = on[r.key] ? r.color : OFF;
    mgraphics.set_source_rgba(col);
    for (let x = 2; x < 16; x += r.dash[0] + r.dash[1]) { mgraphics.move_to(x, y); mgraphics.line_to(Math.min(16, x + r.dash[0]), y); }
    mgraphics.stroke();
    mgraphics.move_to(20, y + 3);
    mgraphics.show_text(r.label);
  });
  void w;
}

function onclick(x, y) {
  if (Date.now() - born < 1000) { sidlog("legend", "click ignored (just loaded)"); return; }
  const i = Math.floor(y / (mgraphics.size[1] / ROWS.length));
  const r = ROWS[Math.max(0, Math.min(ROWS.length - 1, i))];
  on[r.key] = on[r.key] ? 0 : 1;
  outlet(0, "show", r.key, on[r.key]);
  mgraphics.redraw();
}
function set(key, v) { if (key in on) { on[key] = v ? 1 : 0; mgraphics.redraw(); } }
function bang() { for (const r of ROWS) outlet(0, "show", r.key, on[r.key]); }
function onresize() { mgraphics.redraw(); }
function anything() { post("sid.legend: unknown message " + messagename + "\n"); }

paint = sidguard("legend", paint); onclick = sidguard("legend", onclick); set = sidguard("legend", set);
sidlog("legend", "loaded");
