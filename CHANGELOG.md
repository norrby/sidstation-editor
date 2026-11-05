# Changelog

All notable changes to SidStation Editor are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every release is also on the
[Releases](https://github.com/norrby/sidstation-editor/releases) page, with the device file to download.

## [Unreleased]

### Added

- **Connect and Synth OS**: Connect asks the synth which OS it runs and sets Synth OS (OS <= 1.11,
  1.12 R01, 1.12 R02), which can also be set by hand. OS 1.12 R02 and later say their version (the
  version request, 08); R01 answers only the settings request; Elektron's own OS answers neither, and
  with no reply Synth OS is set to OS <= 1.11 and the editor says the synth may also be off or not
  connected. Patch Action has Connect as a fifth choice. Synth OS changes nothing yet.
- **A logo** top left.

### Changed

- **The patch column**: Poly, Legato and HCut side by side below the logo, and the buttons below them
  in two columns: Synth OS on the left, Connect, Pull, Push and Store patch on the right.
- **The overview**: "out" sits right of where the outputs meet under the filter, and the diagram is
  centred in its panel. The patch name's dots look centred in their display.

### Fixed

- **Editing the patch name** no longer adds a quote: a name with a blank in it came into the text
  field in quotes, and the quote became part of the name on Return.

## [1.0.0] - 2026-11-01

### Added

- **A device guide** (docs/device-guide.md): a short text on the synth and the editor, from the
  signal path to what the synth cannot do, with the Live parameter names. It is embedded in the
  device file, and the device description names it, so a program driving the editor can read it.

### Changed

- **The waveform tables are Live parameters**: one per cell of the synth's table, "Osc n Step 00" to
  "Osc n Step 64" (value DATA1 × 256 + DATA2, as the synth stores it). A program driving the editor
  through Live's API can now read and write the tables, and every table edit is ordinary Live undo.
  They are stored with the set (opening it sends none of them to the synth), but not automated and
  not on Push. A table saved by an older editor
  moves into them when the set is opened, without sending anything to the synth.
- **A new editor starts as the synth's own New Patch**, the sound the synth gives a patch it
  creates, named "New Patch": oscillator 1 alone (2 and 3 off, set an octave up and down),
  nothing through the filter. Before, it started with a sound of its own that the synth never had.
  Saved sets keep their values. The device description says how to make the synth and the editor
  alike: dump the patch from the synth (System > MIDI > SYSEXDump = Patch), or press Push patch.
- **Every parameter's short name is unique**, so a program reading the device through Live's API
  (which shows only short names) can tell the four A, D, S and R apart. The short name puts the
  parameter first and its group last: "A Osc1", "Speed Tbl Osc2", "Cut Filt", "Lace Sp LFO3";
  patch-wide parameters keep their name. Push shows the new names; the device looks as before. Long
  names, and with them saved sets, automation and MIDI mappings, are unchanged.
- **After loading, the device says for a few seconds that the synth may not match the editor**, and
  how to sync them: dump the patch from the synth, or press Push patch. Loading still sends nothing. The
  help texts now say that Store and Pull use the patch number the synth's display shows, even one not
  yet selected on the synth, and that Store saves what the synth has.
- The device no longer listens on UDP port 9871. It was a development aid for sending commands from
  the terminal, and anything on the local network could reach the synth through it.
- The editor never sends the SysEx frame that clears every patch on the synth (id 01), not even as
  part of a bank. The last check right before a frame goes out now refuses it too, and a Direct
  Program frame outside the editor's list of parameters, not only the check where frames enter the queue.
- The README's Setup says how to set External Instrument's Hardware Latency and Push's aftertouch.
- The help text for a table step's note on Push named the notes the SidStation way; it shows Live's
  names, like the table on screen.
- Detune's help text said at most half a semitone; measured on the synth it is a full semitone
  either way.
- Shorter help texts for Push patch, Pull patch and Store patch in Live's Info View: the note to
  programs driving the editor stays in Patch Action and the device description.
- The device description tells a program driving the editor that after a set loads the synth may
  play another sound than the editor shows, and to ask for Push patch first.
- **Fast automation reaches the synth in time.** The editor sent at most one message to the synth
  about every 11 ms, roughly 90 a second; faster automation queued up and arrived late, up to tens of
  seconds after the clip. Now CC, program changes and Direct Program messages go out as soon as they
  are made, whole and in order. Only a patch frame and a request to the synth are still followed by a
  short pause. Nothing is sent ahead of time.
- While Pull patch waits for the synth's dump, nothing else from the editor goes to the synth (the
  track's notes still do): the synth stops reading incoming CC while it dumps, and too many would
  overwrite each other. The wait ends when the dump arrives, or after 3 s.
- While the synth stores, MIDI clock from the track is dropped instead of held, so a running clock
  cannot crowd out the held notes.
- The log file's folder is now named after the editor: create `Library/Logs/SidStation-Editor`
  (macOS) or `Documents\SidStation-Editor\logs` (Windows) in your home folder to get `max.log`.
- Received patch dumps are no longer saved as `.syx` files; the log gets their bytes as one line.
  The README's Data folders section is gone; the log is described under Development.
- Patch Number's help text and the README no longer say that Store patch is greyed or
  refused until Push patch, and the device guide lists Off among the waveforms.

### Fixed

- **Attack, Decay and Release reach the synth while Gate is on.** Gate greyed the three dials by
  switching them off, and a switched-off dial in Max holds back the values that automation, Push or
  a program set, so the synth (and Push patch, and Store) got the old ones until Gate went off. Now
  the dials are dimmed, like the editor's other greyed controls, can still be turned, and every value
  goes out.
- **The editor's own rules no longer overrule automation.** Choosing a waveform or Off switches the
  oscillator on or off, and osc 3's Off and Filter clear each other; such a rule writes the other
  parameter, which stopped that parameter's automation. While automation plays either parameter,
  the rule now leaves both as the automation sets them.
- **Undo and redo of the waveform tables.** Undoing an edit made through a table knob (Table Step,
  Wave, Length …) turned the knob back, and the editor took that as a new edit and wrote the table
  again, so the table ended up wrong and redo was lost. Now a knob turned by undo or redo leaves the
  table alone, and the table's own undo step puts it back. Live's restore of a table (on load, undo
  or redo) no longer adds undo steps of its own. A click in the table is one undo step; an edit
  through the knobs is still several, but each undo leaves the table right. Undoing a longer Length goes
  straight back to the shorter table (it passed through a full table of 65 steps, all sent to the
  synth), and the last redo of a knob edit no longer turns the step into a fixed note.
- **A newly added editor can be undone away again.** On load it set a Push knob of each
  oscillator's waveform table (Table Note) although the table was empty; every such write is a step
  in Live's undo history, and each Cmd+Z made the editor write it back, so the device never went
  away. Now a new editor changes none of its own parameters on load, and one Cmd+Z removes it, as
  with any other device.
- Loading a set where an oscillator's Pitch was set to Note sent that note to the synth. Pitch
  (Key follow | Note) and its note are two Live parameters for one synth setting, and only the
  first of them counted as restored.
- A patch dump with a damaged byte (above 0F where the dump has a half byte) is no longer loaded into
  the editor; the log says why.
- A damaged table in a set saved by an older editor can no longer stop its move into the Step
  parameters halfway.

## [0.3.2] - 2026-10-31

### Added

- The version is kept in the Live Set, as a hidden Version parameter, and written to the log when
  the device loads: the log says what a set was last saved with. The device's description in Live's
  Info View shows the version too.

### Changed

- The release file is `SidStation-Editor.amxd`, with no version in its name: upgrading is
  overwriting the file, and every set keeps its settings. See Upgrading in the README.

## [0.3.1] - 2026-10-31

### Added

- **Patch Number** on Push, the leftmost knob of the Patch bank: P00 to P99 sends a program change,
  and the synth switches to that patch at once. The editor does not read the patch back; turn the
  knob, then Pull patch when you want the editor to show it. The knob has no control on screen.
- The Max log counts what the track sends to the synth, per message type and second. It showed
  that Push's polyphonic aftertouch keeps the MIDI lamp blinking while a key is held.

### Fixed

- The overview's tip is drawn in front of the patch name instead of behind it.

## [0.3.0] - 2026-10-27

Version 0.2.0 was skipped; its changes are part of this release.

### Added

- **Edit the waveform tables on Push 2:** a bank per oscillator edits the table step by step,
  including length and loop.
- A note shows when an oscillator plays its waveform table, and points out the table.
- **Patch Action:** a Live parameter (not on screen) with the choices None, Pull patch, Push patch
  and Store patch, for automation, MIDI mapping and Live's API. It does the action and returns to
  None. Map a button to it, not a knob.
- **Help texts for every parameter**, also those with no control on screen, and a device
  description for programs driving the editor through Live's API: edits reach the synth at once,
  and Pull, Push and Store patch are never chosen unless asked.
- **Windows:** the dump and log folders are looked for in the user's Documents folder. Not yet
  tried on Windows.
- README with screenshots, an architecture overview and a reading guide for anyone reading the code.
- `npm run release` freezes the device into one file.

## [0.1.0] - 2026-10-24

First release.

### Added

- Every patch parameter as a Live parameter: automation, MIDI mapping and presets.
- Push patch sends the editor's sound to the synth; Pull and Store with the modified firmware.
- CC 119 on the track (from a clip or a controller button) pushes the patch, at most once every
  5 seconds.
- Push 2 banks: Main, Patch, Filter, Filter Env, three per oscillator and two per LFO.
- The patch name becomes the device name, shown in Push's header.
- Loading a Live Set sends nothing to the synth; every message to it is validated and goes through
  one gateway.

[Unreleased]: https://github.com/norrby/sidstation-editor/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/norrby/sidstation-editor/compare/v0.3.2...v1.0.0
[0.3.2]: https://github.com/norrby/sidstation-editor/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/norrby/sidstation-editor/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/norrby/sidstation-editor/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/norrby/sidstation-editor/releases/tag/v0.1.0
