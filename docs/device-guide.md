# SidStation Editor

A Max for Live editor for the Elektron SidStation, a 1999 synth module built around the MOS 6581 SID chip of the Commodore 64. Every sound parameter of the synth's edit buffer is a Live parameter. A change is sent to the synth over MIDI as soon as it is made, and the synth's audio comes back through an External Instrument after the editor.

## Signal path

A patch has three oscillators. In the manual, an "oscillator" is a whole voice: a waveform generator, its own amplitude envelope, pulse width settings, pitch, vibrato and a waveform table. All three go through one shared filter, or past it: `Osc n Filter` routes each oscillator through the filter or straight out.

- **Single mode** (`Poly` off): monophonic. Every note plays all active oscillators together as a three-layer sound. `Osc n Active` switches an oscillator on or off. `Osc 3 Off` (the chip's 3OFF, shown as Mod only) keeps oscillator 3 running silently, so it can still sync or ring oscillator 1.
- **Poly mode** (`Poly` on): three notes at once, each voice with oscillator 1's settings. Oscillators 2 and 3 are not used, and the arpeggio does nothing.

Sync and ring modulation link each oscillator to the previous one: 2 to 1, 3 to 2, and 1 to 3. The filter has one envelope and one LFO input, and it is shared by every note.

## Oscillators

- **Waveform:** `Osc n Wave` is Tri, Saw, Pulse, Mixed or Noise. Mixed is the chip's combined Tri+Pulse, and its pulse width behaves unpredictably. `Osc n Sync` restarts this oscillator's waveform at each cycle of the previous oscillator. `Osc n Ring` ring-modulates the previous oscillator, and the chip does that only with Tri or Mixed.
- **Pulse width:** `PWM Start` (1 = thin, 64 = square), `PWM Add` (sweeps the width by itself), `PWM Sync` (restarts the sweep at each note), and `PWM LFO` with `PWM LFO Depth`. They affect only Pulse and Mixed.
- **Envelope:** `Attack`, `Decay`, `Sustain` and `Release`, each 0–15. The steps are coarse: Attack goes from 2 ms to 8 s, Decay and Release from 6 ms to 24 s. `Gate` replaces the chip's envelope with plain on/off at the Sustain level. It gives tight timing, but the chip can leave a faint ghost sound a few seconds later. `Delay` starts the oscillator a number of update cycles late.
- **Pitch:** `Track Mode` is Key follow, or Note with `Fixed Note`. Also `Transpose` (±24), `Detune` (up to a semitone either way), `PB Range`, `Porta Speed` and `Arp Speed`. The arpeggio plays held notes one at a time, in the order they were pressed, and 0 turns it off.
- **Vibrato:** `Vib LFO` chooses one of the four LFOs, and `Vib Depth` sets the amount.

## Waveform tables

Each oscillator has a table. It is the C64 technique behind percussive attacks and drums: a short list of steps played quickly, either once at note-on or as a loop. Each step sets a waveform, sync and ring, and a pitch. The pitch can be unchanged, a fixed note, or an offset in semitones from the played note.

- `Osc n Table Speed` 0 turns the table off. A higher value plays it more slowly.
- The steps live in `Osc n Table Data`, which Live cannot read. A program edits the table one step at a time through the Push knobs:
  1. Set `Table Step` in a call of its own.
  2. Then set `Table Wave` (Tri, Saw, Pulse, Mix, Noise, Off, or Keep for the oscillator's own waveform), `Table Mod` (None, Sync, Ring, S+R), `Table Pitch` (Keep, Fixed, Relative), and `Table Note` or `Table Offset` (±47).
- `Table Length` adds or removes steps at the end. `Table Loop` chooses whether the table plays once or loops back to `Table Loop To`, which must be an earlier step.
- While a table plays, it sets the oscillator's waveform. Steps set to Keep, and the start of every note, use the oscillator's `Wave`.

## Filter

`Filter Cutoff` (0–127), `Filter Resonance` (0–15) and `Filter Type`:

- Lowp, Band and High: low pass, band pass and high pass.
- The combinations L/B, L/H (notch), B/H and All.

The filter envelope has `Filter Env Depth`, `Filter Attack`, `Filter Decay`, `Filter Sustain` and `Filter Release`. `Filter Env Invert` subtracts the envelope from the cutoff instead of adding it. The filter's LFO input has `Filter LFO Select`, `Filter LFO Depth` and `Filter LFO Wheel`, the last being extra depth from the mod wheel. `Filter Wrap` lets cutoff modulation wrap round from the top to the bottom.

The SID filter is weak and varies from chip to chip. Expect a gentle effect rather than a modern resonant sweep.

## LFOs and modulation

There are four LFOs (`LFO1` … `LFO4`). Each one has:

- `Type`: Tri, Saw, Ramp, Pulse, Rand, or Flat (a constant maximum).
- `Speed`, where higher is slower, and `Depth`.
- `Fade In`.
- `S/H` (sample and hold).
- `Invert` and `Above Zero` (folds negative values up).
- `Sync On` and `Sync Off`, which restart the LFO at note-on and note-off.
- `Add LFO` with `Add Depth`, which mixes in another LFO.
- `Lace With` with `Lace Speed`, which interleaves another source.

The LFOs drive vibrato, pulse width and the filter.

Velocity, mod wheel, pitch bend, aftertouch, CC 20–23 and the other LFOs act only through an LFO's `Ctrl Source` (Wheel, Bend, Velocity, Aftertouch, CC 20–23, LFO 1–4). They modulate that LFO's `Ctrl Dest` (Depth, Speed, S/H or Lace) up to `Ctrl Value`. For example, velocity to filter: a Flat LFO, Ctrl Source Velocity, Ctrl Dest Depth, and that LFO as `Filter LFO Select`.

## Patches: Push, Pull, Store

The editor edits the synth's edit buffer, never patch memory directly.

- **Push patch** sends the whole editor state.
- **Pull patch** reads the patch the synth's display shows into the editor.
- **Store patch** writes the edit buffer to the patch number the display shows, overwriting it for good. It is allowed only right after Push patch.
- **Patch Number** selects one of the synth's patches P00–P99 by program change.

These are `Patch Action` (None, Pull patch, Push patch, Store patch) and `Patch Number`. Both are ask-first: change them only when the user asks. Never choose Store unless the user explicitly asks to store.

Pull and Store need a modified firmware that answers dump requests. With the stock OS the synth does not answer, and the editor shows NO REPLY.

## Working with the editor

- Loading a set or the device sends nothing to the synth, so the synth may still play another sound than the editor shows.
- Setting a parameter to the value it already has sends nothing. Before shaping a sound, ask the user to press Push patch so that the synth and the editor agree.
- Edits are sent at once, at MIDI speed. A burst of changes takes a moment to reach the synth.
- The patch name is `Name 1` … `Name 10`, one character each. The device takes the patch name as its own name.

## What the synth cannot do

- It has no velocity to amplitude and no per-note filter: one filter and one filter envelope are shared by all notes.
- It has no more than three voices, and only one sound in Poly mode.
- Envelope times are coarse 0–15 steps. The chip's envelope has a known timing bug, which `HCut` (a short silence before each note) or `Gate` works round.
- It has no effects, no stereo and no multitimbral mode. The output is noisy, which is part of the character.

Further reading: the Elektron SidStation owner's manual, chapter "Programming the SidStation" (oscillators, tables, filter, LFOs), and "SidStation MIDI implementation".
