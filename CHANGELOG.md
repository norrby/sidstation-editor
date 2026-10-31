# Changelog

All notable changes to SidStation Editor are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every release is also on the
[Releases](https://github.com/norrby/sidstation-editor/releases) page, with the device file to download.

## [Unreleased]

### Added

- **Ready**, a parameter that turns from loading to ready about 2 seconds after the device loads,
  once Live has handed it the set's values. A program driving the editor through Live's API waits
  for it; its help text ends with [ready], the mark Live MCP looks for.

### Changed

- **Store patch is greyed until Push patch has been pressed**, and greyed again by any change after
  that, so what it saves is always what the editor shows. Store saves what the synth has, so right
  after a set was loaded it would have saved the synth's sound, not the editor's. Patch Action's
  Store patch is refused in the same state. After Push patch a notice by the button says the sound
  can now be saved. A program change or a patch CC from the track's own clips greys it too. The
  help texts now say that Store and Pull use the patch number the synth's display shows, also while
  it flashes before ENTER.
- The device no longer listens on UDP port 9871. It was a development aid for sending commands from
  the terminal, and anything on the local network could reach the synth through it.
- The editor never sends the SysEx frame that clears every patch on the synth (id 01), not even as
  part of a bank.
- The README's Setup says how to set External Instrument's Hardware Latency and Push's aftertouch.
- The help text for a table step's note on Push named the notes the SidStation way; it shows Live's
  names, like the table on screen.
- Detune's help text said at most half a semitone; measured on the synth it is a full semitone
  either way.
- Shorter help texts for Push patch, Pull patch and Store patch in Live's Info View: the note to
  programs driving the editor stays in Patch Action and the device description.

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

[Unreleased]: https://github.com/norrby/sidstation-editor/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/norrby/sidstation-editor/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/norrby/sidstation-editor/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/norrby/sidstation-editor/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/norrby/sidstation-editor/releases/tag/v0.1.0
