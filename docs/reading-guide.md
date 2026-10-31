# Reading guide

A path through the code for someone who knows programming but not this project.
[architecture.md](architecture.md) has the overview diagrams; read it first.

## In this order

| # | File | Why | Lines |
|---|---|---|---|
| 1 | `lib/params.js` | the parameter table: everything the editor knows about the synth's parameters | ~180 |
| 2 | `lib/sysex.js` | SysEx frames: decode a dump, validate, encode Direct Program and the requests | ~190 |
| 3 | `lib/midi.js` | one MIDI byte parser, used by every script that reads the track's input | ~35 |
| 4 | `max/sid.send.js` | the gateway: queue, validation, store lock. The safety rules are at the top | ~250 |
| 5 | `max/sid.capture.js` | SysEx coming in | ~155 |
| 6 | `max/sid.osc.js` | a router: parameter → CC or DP, the note path, the waveform table | ~185 |
| 7 | `max/sid.load.js` | a dump → every panel value | ~120 |
| 8 | `max/sid.adsr.js` | a typical widget: drawing with `mgraphics`, mouse handling | ~300 |
| 9 | `build/build-station.js` | how the device is assembled; skim, then follow one panel into `build/station/voice.js` | ~200 |
| 10 | `lib/layout.js`, `max/sid.layout.js` | how panels fold and the device width changes | ~200 |

Read the test next to each file (`test/params.test.js`, `test/sysex.test.js`, `test/send.test.js` …). The tests are
the most precise description of what a file must do.

## Scripts in Max

There are no classes in this code. A Max script is a module with top-level state (`let queue = []`) and top-level
functions. Max creates one instance of the script per `[v8]` object, so `sid.osc.js` runs three times with separate
state.

### How Max talks to a script

```
inlets = 1; outlets = 3;           // number of inlets and outlets of the [v8] box
function msg_int(b) { … }          // an int arrives
function anything() { … }          // any message: its name is in messagename, its arguments via arrayfromargs(arguments)
function sendall() { … }           // the message "sendall" calls this function directly
outlet(2, "frame", 0xb0, 46, 42);  // send "frame 176 46 42" from outlet 2
new Task(fn).schedule(ms)          // run fn later (the queue, timeouts)
jsarguments                        // the box's arguments: [v8 sid.osc.js 2] → ["sid.osc.js", 2]
post("text\n")                     // the Max console
```

A `v8ui` script also has `mgraphics` (Cairo-like drawing), `paint()` and `onclick` / `ondrag`.

### Why the files end with `if (typeof module !== "undefined") module.exports = …`

The same file runs in Max, which has no modules here, and in Node, which does. In Max the line does nothing, and the
names are simply globals in the bundle. In Node, tests `require` the file and get the exported object.

## Doing a change yourself

The loop is:

```
npm test               # before and after
npm run build          # writes dist/; Live reloads the scripts by itself
```

Then watch the **Max Console**: every script logs there, and an exception in a message handler shows up there too
instead of being lost (`sidguard` in `lib/maxlog.js`). Open it from the device: click its edit button to open it in
Max, then *Window → Max Console*.

The same lines also go to a file if its folder exists in your home folder: `Library/Logs/SidStation-Editor/max.log` on
macOS, `Documents/SidStation-Editor/logs/max.log` on Windows. With the file you can follow the log (`tail -f` on macOS)
without opening Max. The places to try come from `sidUserPaths` in `lib/maxlog.js`.

Small first changes, each with the tests as a safety net:

1. **A help text.** Change a text in `lib/help.js`, build, and hover over the control in Live: Info View shows it.
   `test/help.test.js` checks that every control has one.
2. **A colour.** The palette is `UI` in `lib/ui.js`, named by meaning (`line` for curves, `peak`, `warn` …). Change one, build, and
   watch every widget that uses it follow.
3. **A test.** Add a case to `test/params.test.js`, for example that `toCC` and `fromCC` round-trip every value of
   `Transpose`. Run `node --test test/params.test.js`.
4. **A parameter detail.** Change a `short` name in the `OSC` table in `lib/params.js` and check where it appears:
   the Live parameter's short name, and Push's display. Run `npm test` and see whether any test pins the old name.

Change nothing in `max/sid.send.js` or the validators in `lib/sysex.js` without reading their header comments
first. They protect the synth's flash memory.
