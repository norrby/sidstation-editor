// sid.litbtn.js – v8ui: a button that is always lit, drawn like a live.text that is on. Used for osc 1's Active in Poly mode,
// where Poly plays osc 1 and ignores Active, so a switchable button would mislead. A live.text without a parameter
// did not take its value in Live and showed off, so the stand-in draws itself. Clicks do nothing.
// Args: the label (default "Active").

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 0;

const label = jsarguments.length > 1 ? jsarguments.slice(1).join(" ") : "Active";

function paint() { UI.button(mgraphics, mgraphics.size[0], mgraphics.size[1], { label, on: true }); }
function onclick() {}
function onresize() { mgraphics.redraw(); }

paint = sidguard("litbtn", paint);
sidlog("litbtn", "loaded");
