# SidStation editor

A Max for Live editor for the **Elektron SidStation**, the MOS 6581 (SID) synthesizer from 1999.
Every sound parameter of a patch is on screen and automatable in Ableton Live: three oscillators
with envelopes, pulse width and wave tables, the filter with its envelope, four LFOs, and the
patch-wide settings.

Not affiliated with or endorsed by Elektron. Use at your own risk.

## Features

- **Overview** after the SID datasheet's block diagram: oscillators, envelopes, the filter
  routing switches, sync and ring arrows, the patch name in the synth's dot-matrix style.
- **Oscillators:** waveform, pulse width with its LFO and sync, envelope (ADSR drawn and draggable),
  vibrato, portamento, transpose, arpeggio, and the wave **table** editor (a small step sequencer
  per oscillator, with loop and end).
- **Filter:** cutoff, resonance, type, envelope with invert, LFO depth, a live frequency-response
  picture.
- **LFOs 1–4:** type, speed, depth, fade-in, sample & hold, note-on/off sync, with a curve view.
- **Osc 3 "Mod only"** (the SID's 3OFF): oscillator 3 keeps running for sync and ring modulation
  without being heard.
- **Push patch** sends the whole editor state to the synth's edit buffer.
- **Pull patch / Store patch** and the settings request need a firmware with dump-request and
  store support (see below). With the stock OS the synth does not answer, and the editor shows
  **NO REPLY**.
- Every value is a Live parameter: automation, MIDI mapping and presets work as usual.

## Requirements

- Ableton Live 12 with Max for Live (Max 9, the `v8` objects).
- A SidStation with OS 1.10 (R33). Other versions are untested.
- A MIDI interface connected both ways to the synth (MIDI Out → synth In, synth Out → MIDI In).

## Install

1. Download or clone this repository.
2. In Live's browser, **Places → Add Folder…** and pick the `dist/` folder.
3. Drag **SidStation** onto a MIDI track.

The devices load their scripts from `dist/`, so keep the folder where it is (or rebuild after
moving it).

## Setup in Live

One MIDI track does everything:

- **Devices:** `SidStation`, then Live's **External Instrument** with *MIDI To* = the synth's port.
- **MIDI From:** a port that hears the synth's **MIDI Out** (the interface's input, or *All Ins*).
  It must never hear the track's own output through a loop.
- **Monitor:** *In*, track armed.
- In Live's MIDI settings, keep *Remote* off for the synth's ports: with it on, Live itself sends
  mapped values to the synth.

If the synth's MIDI In light blinks but replies never reach the editor, Live may have lost the
input port: restart Live.

## Safety

The SidStation's OS lives in flash memory, and wrong SysEx can damage it. The editor therefore
sends to the synth only through one gateway (`max/sid.send.js`):

- Patch frames, direct-parameter frames and requests are validated byte by byte; parameter
  frames must also match a whitelist of the documented parameter rows.
- One queue, one message at a time; nothing else goes out while the synth stores a patch.
- Incoming SysEx is never passed on. A frame of a kind only the editor sends that comes back in is
  reported as a loop.
- OS update frames can never pass.

## Data folders

Max cannot create folders, so these are used only if you create them:

| Folder | What |
|---|---|
| `~/Documents/SidStation/dumps` | every patch dump received is saved here as `.syx` |
| `~/Library/Logs/SidStation` | `max.log`, a log for troubleshooting (everything also goes to the Max console) |

## Firmware

Pull, Store and the settings request use SysEx messages (ids 05, 06 and 07) that the stock
SidStation OS does not know; they need a modified firmware. Everything else works with the stock
OS 1.10.

## Command line

```
node tools/validate-bank.js bank.syx [--clean out.syx]   # check a .syx bank before sending it
node tools/sid.js cc 42 127                               # control the editor in Live over UDP 9871
node tools/sid.js request 127                             # dump request (needs the modified firmware)
```

## Development

```
npm run build    # generates dist/ (devices + bundled scripts) from build/, lib/ and max/
npm test
```

| Directory | Contents |
|---|---|
| `lib/` | plain JavaScript shared by Node and Max: SysEx, parameters, layout, MIDI parser, palette, help texts |
| `max/` | the scripts that run in Max (`v8` and `v8ui`) |
| `build/` | generators for the `.amxd` devices |
| `dist/` | generated; what Live loads |
| `test/` | `node --test` |
| `tools/` | command-line tools |

Node 24 or later.

## License

Copyright (C) 2026 M Norrby

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. See [LICENSE](LICENSE).
