// sid.tablenote.js – v8ui: the note "(using waveform table)" after "Oscillator n", shown by the layout only while the oscillator's
// Table Speed is above 0 (its waveform is then set by the table, step by step). Live's Info View explains it (lib/help.js); hovering
// over the note lights up where the cause is: 1|0 goes as "hilite 2 1|0" to the voice's background (sid.voicebg.js), which frames the tbl
// row in the column and the table panel, if it is open.
// In:  label <text…>    the text (default "(using waveform table)")
// Out: 1 when the mouse comes over the note, 0 when it leaves (the patcher prepends "hilite <row>" for the background)
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

let text = "(using waveform table)";
let hot = false;

function paint() {
  const h = mgraphics.size[1];
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(9);
  mgraphics.set_source_rgba(hot ? UI.peak : [UI.text[0], UI.text[1], UI.text[2], 0.55]);
  mgraphics.move_to(1, h / 2 + 2.5);                                        // the baseline level with the bold title's (a comment box)
  mgraphics.show_text(text);
}
function label() { text = arrayfromargs(arguments).join(" "); mgraphics.redraw(); }
function onidle() { if (hot) return; hot = true; outlet(0, 1); mgraphics.redraw(); }
function onidleout() { if (!hot) return; hot = false; outlet(0, 0); mgraphics.redraw(); }
function onresize() { mgraphics.redraw(); }

paint = sidguard("tablenote", paint); label = sidguard("tablenote", label); onidle = sidguard("tablenote", onidle); onidleout = sidguard("tablenote", onidleout);
sidlog("tablenote", "loaded");
