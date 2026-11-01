# MIDI implementation

An appendix to the [README](../README.md): what the editor sends to the SidStation for each parameter, and
what of it a Live clip can hold.

## Two kinds of message

The editor reaches the synth in two ways, and every parameter uses exactly one of them:

- **Control change (CC):** the 82 parameters that the SidStation's manual gives a controller number. A
  CC carries one value, 0–127; the editor scales each parameter's own range (Transpose −24…24, an
  envelope's 0…15) to it, and the synth scales it back. Measured: 81 of them came back unchanged from the
  synth's patch memory; Filter Sustain could not be measured that way (¹).
- **SysEx:** everything else, as the synth's Direct Program messages: one message per setting, written
  straight into the synth's edit buffer. The patch name and the waveform tables go this way too. SysEx has
  no MIDI channel.

## The MIDI channel

The editor has no channel of its own. Live sends everything that leaves a track on the channel set in the
track's *MIDI To*, whatever channel it had inside the track: set the synth to receive on that channel. Clips in Live hold no channel either: notes and
CC curves in a clip reach the track's devices on channel 1.

## Recording what you do in the editor

There are two ways, and they keep different things:

| | Automation of the editor's parameters | The editor's MIDI recorded on another track |
|---|---|---|
| How | automation of the editor's parameters, drawn or recorded: on playback Live moves the editor's knobs, and the editor sends as it always does | a second MIDI track with *MIDI From* = the editor's track, recording a clip |
| CC parameters | yes | yes, except Filter Sustain (CC 32) ¹ |
| SysEx parameters | yes | no: Live does not record SysEx into clips |

¹ CC 32 is also MIDI's Bank Select (LSB), and Live does not record it into a clip: the curve is simply
missing. The SidStation's manual puts Filter Sustain there, so the editor cannot move it. Automation of
the *Filter Sustain* parameter itself records and plays back as any other.

² One synth setting with two Live parameters: Key follow or a fixed note. The CC value is the note, or
key follow.

## Filter and patch

| Live parameter | Sent as |
| --- | --- |
| Filter Cutoff | CC 27 |
| Filter Resonance | SysEx |
| Filter Env Depth | CC 28 |
| Filter LFO Depth | CC 29 |
| Filter Attack | CC 30 |
| Filter Decay | CC 31 |
| Filter Sustain | CC 32 ¹ |
| Filter Release | CC 33 |
| Filter LFO Wheel | SysEx |
| Filter LFO Select | SysEx |
| Filter Type | SysEx |
| Filter Wrap | SysEx |
| Filter Env Invert | SysEx |
| Osc 3 Off | SysEx |
| Poly | SysEx |
| Legato | SysEx |
| HCut | SysEx |
| Name 1 … Name 10 (the patch name) | SysEx |

## Oscillators

| Live parameter | Osc 1 | Osc 2 | Osc 3 |
| --- | --- | --- | --- |
| Osc n Active | CC 24 | CC 25 | CC 26 |
| Osc n Wave | SysEx | SysEx | SysEx |
| Osc n PWM Sync | SysEx | SysEx | SysEx |
| Osc n Gate | SysEx | SysEx | SysEx |
| Osc n PB Range | SysEx | SysEx | SysEx |
| Osc n PWM LFO | SysEx | SysEx | SysEx |
| Osc n Vib LFO | SysEx | SysEx | SysEx |
| Osc n Arp Speed | CC 34 | CC 50 | CC 72 |
| Osc n Track Mode, Osc n Fixed Note ² | CC 35 | CC 51 | CC 73 |
| Osc n Transpose | CC 36 | CC 52 | CC 74 |
| Osc n Vib Depth | CC 37 | CC 53 | CC 75 |
| Osc n Detune | CC 38 | CC 54 | CC 76 |
| Osc n Porta Speed | CC 39 | CC 55 | CC 77 |
| Osc n Sync | CC 40 | CC 56 | CC 78 |
| Osc n Ring | CC 41 | CC 57 | CC 79 |
| Osc n PWM Start | CC 42 | CC 58 | CC 80 |
| Osc n PWM Add | CC 43 | CC 59 | CC 81 |
| Osc n PWM LFO Depth | CC 44 | CC 60 | CC 82 |
| Osc n Delay | CC 45 | CC 61 | CC 83 |
| Osc n Attack | CC 46 | CC 62 | CC 84 |
| Osc n Decay | CC 47 | CC 63 | CC 85 |
| Osc n Sustain | CC 48 | CC 70 | CC 86 |
| Osc n Release | CC 49 | CC 71 | CC 87 |
| Osc n Table Speed | SysEx | SysEx | SysEx |
| Osc n Filter | SysEx | SysEx | SysEx |
| Osc n Step 00 … Osc n Step 64 (the waveform table) | SysEx | SysEx | SysEx |

## LFOs

| Live parameter | LFO1 | LFO2 | LFO3 | LFO4 |
| --- | --- | --- | --- | --- |
| LFOn Type | SysEx | SysEx | SysEx | SysEx |
| LFOn Speed | CC 88 | CC 94 | CC 106 | CC 112 |
| LFOn Depth | CC 89 | CC 95 | CC 107 | CC 113 |
| LFOn Fade In | CC 91 | CC 103 | CC 109 | CC 115 |
| LFOn S/H | CC 92 | CC 104 | CC 110 | CC 116 |
| LFOn Sync On | SysEx | SysEx | SysEx | SysEx |
| LFOn Invert | SysEx | SysEx | SysEx | SysEx |
| LFOn Above Zero | SysEx | SysEx | SysEx | SysEx |
| LFOn Sync Off | SysEx | SysEx | SysEx | SysEx |
| LFOn Add LFO | SysEx | SysEx | SysEx | SysEx |
| LFOn Add Depth | CC 90 | CC 102 | CC 108 | CC 114 |
| LFOn Lace With | SysEx | SysEx | SysEx | SysEx |
| LFOn Lace Speed | CC 93 | CC 105 | CC 111 | CC 117 |
| LFOn Ctrl Source | SysEx | SysEx | SysEx | SysEx |
| LFOn Ctrl Dest | SysEx | SysEx | SysEx | SysEx |
| LFOn Ctrl Value | SysEx | SysEx | SysEx | SysEx |

## Other messages

- **Notes and everything else from the track** (pitch bend, aftertouch, CC from a clip or a controller) go
  through the editor to the synth unchanged. A CC from the track reaches the synth without moving the
  editor's knob.
- **CC 119** on the track (value above 0) presses Push patch, at most once every 5 seconds. The editor keeps
  it to itself; it never reaches the synth.
- **Patch Number** sends a program change.
- **Push patch** sends every parameter, CC and SysEx, at once. **Pull patch** and **Store patch** use SysEx
  that only a firmware with dump-request and store support answers.
- Parameters that only change the editor's view (Osc n Show, Osc n Env, Osc n Table, Filter Show, Filter
  Env, LFO Select, LFO Show) send nothing. The Push table knobs (Osc n Table Step, Wave, Length …) edit
  the Step parameters, which go as SysEx.

## How this was measured

In Live 12.4 with a SidStation on OS 1.12 R01, 2026-11-01: an editor sent all 82 CC parameters (Push patch)
to a second track that recorded a clip; the clip, played on another *MIDI To* channel with the synth set to
that channel, gave the synth all of them but Filter Sustain; the synth stored the patch and Pull read it
back. Clip automation of Filter Sustain and Filter Resonance on the editor's track made the editor send
CC 32 and SysEx. A MIDI file with every kind of channel message on channel 3, dragged into Live, played into the
editor on channel 1, without its polyphonic aftertouch.
