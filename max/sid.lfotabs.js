// sid.lfotabs.js – v8: the LFO column's four fold buttons "lfo 1".."lfo 4", mutually exclusive, like tabs.
// Opening one closes the others, closing the open one
// folds the LFO section. The state lives in the two existing parameters, so automation and presets keep working:
// "LFO Select" (live.tab, hidden, 0..3) and "LFO Show" (live.text, hidden, 0|1).
// In:  click <k> <v>   from fold button k (1..4)     sel <i>   from LFO Select     show <v>   from LFO Show
// Out: 0: <i> to LFO Select   1: <v> to LFO Show   2: <k> <v> fold button k's state (-> [route 1 2 3 4] -> [prepend state])

inlets = 1;
outlets = 3;

let cur = 0, shown = 1;

function refresh() { for (let k = 1; k <= 4; k++) outlet(2, k, shown && cur === k - 1 ? 1 : 0); }
function click(k, v) {
  k = k | 0;
  if (k < 1 || k > 4) return;
  if (!v || (shown && cur === k - 1)) { shown = 0; outlet(1, 0); }
  else { cur = k - 1; outlet(0, cur); if (!shown) { shown = 1; outlet(1, 1); } }
  sidlog("lfotabs", "click", k, "-> lfo", cur + 1, shown ? "shown" : "folded");
  refresh();
}
function sel(i) { cur = Math.max(0, Math.min(3, i | 0)); refresh(); }
function show(v) { shown = v ? 1 : 0; refresh(); }

click = sidguard("lfotabs", click); sel = sidguard("lfotabs", sel); show = sidguard("lfotabs", show);
sidlog("lfotabs", "loaded");
