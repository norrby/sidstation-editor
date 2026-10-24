// node --test: lib/ui.js – UI.button, the one way the widgets draw a live.text-style button, against a recording mgraphics mock.
const test = require("node:test");
const assert = require("node:assert/strict");
const { UI } = require("../lib/ui");

function mock(measure = (t) => [t.length * 6, 9]) {
  const calls = [];
  const g = { text_measure: measure };
  for (const f of ["set_source_rgba", "rectangle", "fill", "stroke", "set_line_width", "select_font_face", "set_font_size", "move_to", "show_text"]) g[f] = (...a) => calls.push([f, ...a]);
  return { g, calls };
}

test("lit: orange fill, dark border, dark label centred in Ableton Sans 9.5", () => {
  const { g, calls } = mock();
  UI.button(g, 52, 18, { label: "Active", on: true });
  assert.deepEqual(calls, [
    ["set_source_rgba", UI.btnOn], ["rectangle", 0, 0, 52, 18], ["fill"],
    ["set_source_rgba", UI.btnEdge], ["set_line_width", 1], ["rectangle", 0.5, 0.5, 51, 17], ["stroke"],
    ["select_font_face", "Ableton Sans Medium"], ["set_font_size", 9.5],
    ["set_source_rgba", UI.btnEdge], ["move_to", (52 - 36) / 2, 12.5], ["show_text", "Active"]]);
  assert.deepEqual(UI.btnOn, [1, 0.678, 0.337, 1], "sampled from a lit live.text (255 173 86)");
});

test("unlit: dark grey fill and a light label; lit takes its colour from o.lit", () => {
  let { g, calls } = mock();
  UI.button(g, 52, 18, { label: "Active", on: false });
  assert.deepEqual(calls[0], ["set_source_rgba", UI.btnOff]);
  assert.deepEqual(calls[9], ["set_source_rgba", UI.text]);
  ({ g, calls } = mock());
  UI.button(g, 52, 18, { label: "Mod only", on: true, lit: UI.line });
  assert.deepEqual(calls[0], ["set_source_rgba", UI.line]);
  assert.deepEqual(calls[9], ["set_source_rgba", UI.btnEdge]);
});

test("dim draws a disabled live.text: on = grey with a dark label (any lit colour), off = unlit with a grey label; the border stays", () => {
  for (const on of [true, false]) {
    const { g, calls } = mock();
    UI.button(g, 52, 18, { label: "Active", on, lit: UI.line, dim: true });
    assert.deepEqual(calls[0], ["set_source_rgba", on ? UI.btnDimOn : UI.btnOff]);
    assert.deepEqual(calls[3], ["set_source_rgba", UI.btnEdge]);
    assert.deepEqual(calls[9], ["set_source_rgba", on ? UI.btnDimOnText : UI.btnDimText]);
  }
});

test("no label: background only; border false: no border; text_measure failing falls back to 5 px a character", () => {
  let { g, calls } = mock();
  UI.button(g, 30, 18, { on: false, unlit: [0.12, 0.12, 0.12, 1], border: false });
  assert.deepEqual(calls, [["set_source_rgba", [0.12, 0.12, 0.12, 1]], ["rectangle", 0, 0, 30, 18], ["fill"]]);
  ({ g, calls } = mock(() => { throw new Error("no font"); }));
  UI.button(g, 52, 18, { label: "Active", on: true });
  assert.deepEqual(calls.find((c) => c[0] === "move_to"), ["move_to", (52 - 30) / 2, 12.5]);
});
