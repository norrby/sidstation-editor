// help.js – the help texts Live shows in its Info View when the mouse is over a control, in plain
// English. Written for someone who has never seen a SidStation: what it does to the
// sound first, the range or the trick after. build/build-station.js sets each presented box's annotation_name/annotation.
// help(varname) -> [title, text] or null (no help: frames, section headings).

const prev = (n) => ((n + 1) % 3) + 1;                        // SID: osc n is synced/ring-modulated by the previous one (1 <- 3)

const OSC = {
  active: (n) => ["Active", "Turns oscillator " + n + " on or off. A sound can use one, two or all three oscillators; each one plays the note you press, layered on top of the others. In Poly mode this button does nothing and is greyed out: the sound plays even when every oscillator is switched off."],
  wave: () => ["Waveform", "The basic sound of the oscillator. Tri: soft and round, like a flute. Saw: bright and buzzy. Pulse: hollow, from thin and nasal to a full square (see the pulse settings). Mixed: triangle and pulse at once, thin and odd. Noise: hiss, for drums and effects. Off: the oscillator is switched off (Active goes off with it; choosing a waveform switches it back on). Off but Active, as some old patches have it, is silent too but keeps the envelope running. In Poly mode all three voices play oscillator 1's settings, so Off on oscillator 1 silences everything."],
  tblnote: (n) => ["Waveform table in use", "Oscillator " + n + " plays its waveform table, because Table Speed is above 0: the table sets the waveform step by step, and the pitch too where a step says so. The waveform chosen here still sounds at the start of every note, for the first steps' worth of time, and in table steps set to ---. To switch the table off, set Table Speed to 0 in the table panel (tbl in the column)."],
  pwsync: () => ["Restart pulse at note", "On: every new note starts the pulse width again from its start value, so all notes sound alike. Off: the pulse keeps moving from wherever it was, so each note comes out a little different."],
  gate: () => ["Gate", "Replaces the SID chip's own envelope with a plain on/off: the note sounds at the Sustain level while the key is held and stops when it is let go. Tight timing, no attack or release. The chip may let out a faint ghost sound a few seconds later."],
  pbrange: () => ["Pitch bend range", "How far the pitch bend wheel bends this oscillator, in semitones up and down. 12 = one octave each way."],
  pwlfo: () => ["Pulse LFO", "Which of the four LFOs moves the pulse width back and forth. How much is set with PW LFO."],
  viblfo: () => ["Vibrato LFO", "Which of the four LFOs makes the vibrato (the wobble in pitch). How much is set with Vib."],
  arp: () => ["Arpeggio speed", "Hold a chord and the oscillator plays its notes one after another, very fast: the classic C64 way to play chords on one voice. Higher = slower, 0 = off. The notes come in the order you pressed them. Does nothing in Poly mode."],
  trackmode: () => ["Pitch", "Key follow: the oscillator plays the key you press. Note: it always plays the same note, whatever key you press. Good for drums and drones."],
  notepick: () => ["Fixed note", "The note this oscillator always plays when Pitch is set to Note. Drag up or down to change it. The names are the SidStation's own, where C-5 is Live's C3."],
  transpose: () => ["Transpose", "Moves this oscillator up or down in semitones, at most two octaves. Put one oscillator 12 or 24 below the others for a fatter bass."],
  vibdepth: () => ["Vibrato", "How much the pitch wobbles. The speed and shape of the wobble come from the LFO chosen under Vib LFO. 0 = no vibrato."],
  detune: () => ["Detune", "Tunes the oscillator slightly sharp or flat, at most half a semitone. A little detune between oscillators makes the sound fuller and more alive."],
  porta: () => ["Portamento", "Glides from one note to the next instead of jumping straight there. 0 = no glide; higher = slower. The glide takes about the same time however far apart the notes are: 10 ≈ 0.1 s, 50 ≈ 0.4 s, 99 ≈ 0.85 s for an octave (small steps a little quicker). It starts from the last note played, even after a pause. When it glides is set by Legato in the Patch column."],
  sync: (n) => ["Sync", "Hard sync to oscillator " + prev(n) + ". Every time oscillator " + prev(n) + " starts a new cycle of its wave, this oscillator is forced to start its own wave over, even halfway through. The pitch then follows oscillator " + prev(n) + " and the tone gets sharp and biting; change this oscillator's pitch to sweep the tone. Works with every waveform."],
  ring: (n) => ["Ring modulation", "Multiplies this oscillator's triangle wave by oscillator " + prev(n) + ", giving metallic, bell-like tones. Only works when this oscillator's waveform is Tri or Mixed; otherwise the button is greyed out."],
  pwstart: () => ["Pulse width", "The shape of the pulse wave. 64 is a full square (hollow, like a clarinet); values further from 64 give thinner, more nasal pulses. 0 is silent."],
  pwadd: () => ["Pulse sweep", "Makes the pulse width move by itself, so the sound keeps changing while the note plays. Higher = faster. 0 = still."],
  pwlfodepth: () => ["Pulse LFO depth", "How much an LFO moves the pulse width back and forth. The LFO is chosen in the menu below. 0 = none."],
  delay: () => ["Delay", "Makes this oscillator start a little later than the others, counted in the synth's updates (normally 100 per second). Small values thicken a layered sound; large ones give a C64-style echo."],
  attack: () => ["Attack", "How long the sound takes to rise to full volume when you press a key. Short for plucks and drums, long for soft pads."],
  decay: () => ["Decay", "How long the sound takes to fall from full volume to the Sustain level."],
  sustain: () => ["Sustain", "The volume the sound stays at while you hold the key, 0 to 15. With Gate on, it is the volume of the whole note."],
  release: () => ["Release", "How long the sound takes to fade out after you let go of the key."],
  adsr: () => ["Envelope", "The volume of a note over time: up (Attack), down (Decay), hold while the key is down (Sustain), fade after it (Release). Drag the points or use the dials."],
  pulse: () => ["Pulse shape", "A few cycles of the pulse wave. Drag the edge to set the pulse width; the later cycles show how Pulse sweep changes it."],
  tablespeed: () => ["Table speed", "How fast the table below plays its steps. Higher = slower. 0 = no table: the oscillator plays normally."],
  table: () => ["Table", "A small step sequencer inside the oscillator, played left to right from each new note. Drag up from the bottom of a step for a fixed note (orange), or from higher up for a step away from the played note (blue). Double-click: leave the pitch alone. The buttons below set the waveform and sync/ring. Drag across steps to paint, and the red line to set the length."],
  tableloop: () => ["Once or loop", "Once (arrow to a bar): the table plays to the end and stops there. Loop (circle): it jumps back to the green marker and repeats as long as the note sounds."],
  tableclear: () => ["Clear table", "Empties the table (no steps, only the end) and sets Speed to 0, so the table is off. Drag the red line to the right to add steps."],
  activebtn: () => ["Active", "Click to step: Active -> Mod only -> off. Mod only (the SID's 3OFF): oscillator 3 keeps running but is not heard, so it can still sync or ring oscillator 1 – the classic hard-sync sound without the modulator. Mod only also turns Filter off. In Poly mode it is greyed out and only switches between Active and off, for when Poly is off: Mod only would silence the third voice."],
  activepoly: () => ["Active", "In Poly mode oscillator 1 always plays: it is the sound of all three voices. Deactivating it has no effect, so the button stays on. Its own setting comes back when Poly is off."],
  foldbtn: (n) => ["Show oscillator " + n, "Shows or hides the oscillator panel. The overview's Osc boxes do the same."],
  envfoldbtn: () => ["Show envelope", "Shows or hides the envelope panel (Attack, Decay, Sustain, Release). The overview's Env boxes do the same."],
  tblfoldbtn: () => ["Show table", "Shows or hides the table panel, a step sequencer for this oscillator's pitch and waveform."],
  // Parameters with no control on screen: the Push table knobs, the show/hide switches and the hidden value carriers. Read by
  // a program that drives the device through Live's API, so each says what it belongs to and what it does not do.
  pushstep: (n) => ["Table step", "Picks the step of oscillator " + n + "'s waveform table that Table Wave, Mod, Pitch, Note and Offset show and edit, counted from 0. Set it on its own, before them; it stops at Table Length minus 1. The table plays only while Table Speed is above 0."],
  pushwave: (n) => ["Table step waveform", "The waveform at the selected step of oscillator " + n + "'s table. Keep (--- in the table) leaves the waveform as the step before had it."],
  pushmod: (n) => ["Table step sync/ring", "Sync and ring modulation at the selected step of oscillator " + n + "'s table: None, Sync, Ring or both (S+R)."],
  pushpitch: (n) => ["Table step pitch", "What the selected step of oscillator " + n + "'s table does to the pitch. Keep: leaves it alone. Fixed: plays Table Note. Relative: moves Table Offset semitones from the note played."],
  pushnote: (n) => ["Table step note", "The note the selected step of oscillator " + n + "'s table plays when Table Pitch is Fixed. The names are the SidStation's own, where C-5 is Live's C3. On Push it takes Offset's place while Pitch is Fixed."],
  pushoffset: (n) => ["Table step offset", "How many semitones the selected step of oscillator " + n + "'s table moves from the note played, when Table Pitch is Relative. On Push it takes Note's place while Pitch is Relative."],
  pushlen: (n) => ["Table length", "How many steps oscillator " + n + "'s table plays, for the whole table. 0 = no steps, only the end."],
  pushloop: (n) => ["Table once or loop", "For the whole table of oscillator " + n + ". Once: the table plays to the end and stops there. Loop: it jumps back to Table Loop To and repeats as long as the note sounds."],
  pushtarget: (n) => ["Table loop to", "The step oscillator " + n + "'s table jumps back to when Table Loop is Loop, for the whole table. On Push it takes Speed's place right after Loop is turned on."],
  show: (n) => ["Show oscillator " + n, "Shows or hides oscillator " + n + "'s panel in the editor. Does not change the sound."],
  envshow: (n) => ["Show envelope " + n, "Shows or hides oscillator " + n + "'s envelope panel in the editor. Does not change the sound."],
  tblshow: (n) => ["Show table " + n, "Shows or hides oscillator " + n + "'s table panel in the editor. Does not change the sound."],
  tracknote: (n) => ["Fixed note", "The note oscillator " + n + " always plays when Pitch is set to Note, as a MIDI note where 60 is Live's C3 (the SidStation calls it C-5). The same value as the note display in the panel."],
};

const FILTER = {
  cutoff: () => ["Cutoff", "Where the filter starts to cut. With low pass: lower = darker and more muffled, higher = brighter."],
  res: () => ["Resonance", "Boosts the sound right at the cutoff, for a sharper, whistling, 'wah' character. 0 to 15."],
  depthslider: () => ["Envelope amount", "How far the filter envelope moves the cutoff during each note. 0 = not at all. With Inv it moves down instead of up."],
  lfodepth: () => ["LFO amount", "How much an LFO moves the cutoff back and forth, for a wah-wah. The LFO is chosen in the LFO menu."],
  fattack: () => ["Filter attack", "How quickly the filter envelope opens the cutoff when you press a key."],
  fdecay: () => ["Filter decay", "How quickly the cutoff falls back to the Sustain level after the attack."],
  fsustain: () => ["Filter sustain", "Where the filter envelope stays while you hold the key."],
  frelease: () => ["Filter release", "How quickly the filter envelope falls to zero after you let go of the key."],
  wheel: () => ["Mod wheel", "How much the mod wheel adds to the LFO amount. Push the wheel up for more wah."],
  flfo: () => ["Filter LFO", "Which of the four LFOs moves the cutoff."],
  ftype: () => ["Filter type", "Lowp keeps the bass and cuts the treble. High does the opposite. Band keeps a band around the cutoff. L/B, L/H, B/H and All mix them: L/H removes a band, the others give odd in-between colours."],
  wrap: () => ["Wrap", "Normally the cutoff stops at the top when something pushes it further. With Wrap on it jumps round to the bottom and carries on. An odd effect."],
  invert: () => ["Invert envelope", "Turns the filter envelope upside down: the cutoff goes down during the note instead of up."],
  curve: () => ["Filter response", "Which frequencies get through the filter: bass to the left, treble to the right. The marks show how far the envelope and the LFO move the cutoff."],
  legend: () => ["Show in the picture", "Click a row to show or hide that line in the filter picture: the envelope's peak, the sustain level, the LFO's range and the cutoff."],
  adsr: () => ["Filter envelope", "How the cutoff moves during a note: up (Attack), back (Decay), hold while the key is down (Sustain), down after it (Release). Drag the points."],
  fold: () => ["Show filter", "Shows or hides the filter panel."],
  envfold: () => ["Show filter envelope", "Shows or hides the filter's envelope panel."],
  route: (n) => ["Filter", "On: oscillator " + n + " goes through the filter. Off: it skips the filter and goes straight out. Same as the switch in the overview."],
  // No control on screen (see OSC above):
  show: () => ["Show filter", "Shows or hides the filter panel in the editor. Does not change the sound."],
  envshow: () => ["Show filter envelope", "Shows or hides the filter's envelope panel in the editor. Does not change the sound."],
  envdepth: () => ["Envelope amount", "How far the filter envelope moves the cutoff during each note, 0 to 127. 0 = not at all. With Invert on it moves down instead of up. The same value as the Env amount slider."],
  off3: () => ["Osc 3 off", "On: oscillator 3 keeps running but is not heard (the SID's 3OFF), so it can still sync or ring oscillator 1, and it is taken out of the filter. The same as Mod only on oscillator 3's Active button."],
};

const LFO = {
  type: () => ["LFO shape", "The shape of the movement. Tri: smoothly up and down. Saw: a slope that snaps back. Ramp: one slope after each note, then it stays. Pulse: jumps between two values. Rand: jumps to random values. Flat: stands still (useful with Control)."],
  speed: () => ["Speed", "How fast the LFO moves. Higher = slower. The picture shows the result in Hz."],
  depth: () => ["Depth", "How strong the movement is. 0 = the LFO does nothing."],
  fadein: () => ["Fade in", "Makes the LFO start from nothing at each new note and grow to full strength. Higher = longer, up to about 20 seconds. 0 = off."],
  samphold: () => ["Sample & hold", "Holds the LFO still for a while, then jumps to where it has got to, so a smooth movement turns into steps. Higher = longer steps. 0 = off."],
  notesync: () => ["At note on", "Starts the LFO over at every new note, so each note gets the same movement. Off: it runs freely."],
  offsync: () => ["At note off", "Starts the LFO over when you let go of a key."],
  invert: () => ["Invert", "Turns the LFO upside down."],
  abovezero: () => ["Above zero", "Keeps the LFO on one side: it moves between nothing and full instead of up and down around the middle."],
  addlfo: () => ["Add LFO", "Mixes another LFO into this one, for a more complex movement. How much is set with Add Dp."],
  adddepth: () => ["Add depth", "How much of the other LFO is mixed in. 0 = none."],
  lacewith: () => ["Lace with", "What gets chopped into this LFO: zero or another LFO."],
  lace: () => ["Lace speed", "Rapidly switches between this LFO and the Lace with source, for a chopped-up movement. Lower = faster chopping. 0 = off."],
  source: () => ["Control source", "Something you play that can change this LFO: the mod wheel, pitch bend, how hard you hit the key (velocity), aftertouch, MIDI CC 20 to 23, or another LFO."],
  dest: () => ["Control target", "What the control source changes: this LFO's depth, speed, sample & hold or lace speed. None = nothing."],
  ctrlval: () => ["Control amount", "How far the control source can move the target at its maximum. At its minimum the target keeps its own value."],
  view: () => ["LFO picture", "The LFO's movement over time, from the start of a note. The ruler is in seconds and the number in the corner is the speed in Hz."],
};

const COMMON = {
  poly: () => ["Poly", "Off: every key plays all active oscillators together, one note at a time. On: up to three notes at once, each on its own voice, all with oscillator 1's sound. The Active buttons are ignored in Poly: it sounds even when they are all off."],
  legato: () => ["Legato", "Decides when the oscillators' Portamento glides (for the whole patch). Off: every new note glides from the last one, even after a pause. On: only a note played while the previous key is still held glides; a detached note jumps straight to its pitch."],
  legatodim: () => ["Legato", "Does nothing right now: no oscillator has Portamento, so there is no glide to control. It can still be switched and takes effect once an oscillator's Portamento is above 0. Decides when Portamento glides: off = every new note glides, on = only notes played while the previous key is held."],
  hcut: () => ["Hard cut", "Keeps each new note silent for a moment, to hide a timing bug in the SID chip's envelope. About 2 (20 ms) is enough; 0 = off. Notes then start a little late. Not needed with Gate."],
  sendall: () => ["Push patch", "Sends every setting in the editor to the SidStation at once, so the synth sounds like the editor shows. Every change you make in the editor goes to the synth right away, so this is only for sending the whole editor state together, for example after a saved set has been loaded (loading sends nothing). Nothing is saved until you press Store patch. A program driving the editor must never choose Pull patch or Push patch unless the user asks for it, and never Store patch unless the user explicitly asks to store. CC 119 on the track (a clip or a controller button) pushes too, at most once every 5 seconds: put it at the start of a song. It never reaches the synth."],
  fetch: () => ["Pull patch", "Reads the sound saved in the SidStation's current slot into the editor, replacing every setting the editor shows. Unsaved changes on the synth are not included. Needs a firmware that answers dump requests. A program driving the editor must never choose Pull patch or Push patch unless the user asks for it, and never Store patch unless the user explicitly asks to store."],
  store: () => ["Store patch", "Saves the sound the SidStation is playing into its current slot, so it is still there after power off, overwriting what the slot held for good. Press Push patch first to save what the editor shows. Needs a firmware with store support. A program driving the editor must never choose Pull patch or Push patch unless the user asks for it, and never Store patch unless the user explicitly asks to store."],
  slot: () => ["Patch number", "Selects which of the synth's 100 patches (P00 to P99, as the synth shows them) it plays, by a program change: turn it on Push to try sounds while playing. The editor's panels still show the sound they had; press Pull patch to read the chosen one. Store patch saves to this patch number. Not sent when a set loads, and Push patch leaves it alone. [ask first]"],
  // "[ask first]" at the end: a tag for programs (Live MCP) that then refuse to move the parameter from None unless the user asked;
  // it is not on screen, so nobody sees the tag in Live's Info View.
  action: () => ["Patch action", "Presses one of the Pull, Push and Store patch buttons from automation, a MIDI mapping or Live's API, then goes back to None by itself. Pull patch reads the synth's current slot into the editor, replacing every setting; Push patch sends the whole editor state to the synth at once; Store patch overwrites the synth's current slot for good. Every change in the editor already goes to the synth at once, so Push patch is only for sending everything together, for example after a saved set has been loaded. A program driving the editor must never choose Pull patch or Push patch unless the user asks for it, and never Store patch unless the user explicitly asks to store. Map a button to it, not a knob: a knob sweeping through the choices does all three. [ask first]"],
};

const TOP = {
  map: () => ["Overview", "The whole sound at a glance: three oscillators, each through its envelope, then through the filter or straight out. Click an Osc or Env box to show its panel, a switch to send that oscillator through the filter or past it, an arrow to turn Sync or Ring on. Osc 3's switch has a third position, Off (the SID's 3OFF): osc 3 is not heard but keeps running, so it can still sync or ring osc 1."],
  name: () => ["Patch name", "Click and type a name of up to 10 characters, then press Return or Tab. Esc cancels."],
  nameedit: () => ["Patch name", "Type a name of up to 10 characters and press Return or Tab. Esc cancels."],
};

function help(varname) {
  let m;
  if ((m = /^o([123])_(\w+)$/.exec(varname)) && OSC[m[2]]) return OSC[m[2]](Number(m[1]));
  if ((m = /^f_route([123])$/.exec(varname))) return FILTER.route(Number(m[1]));
  if ((m = /^f_(\w+)$/.exec(varname)) && FILTER[m[1]]) return FILTER[m[1]]();
  if ((m = /^l_fold([1-4])$/.exec(varname))) return ["LFO " + m[1], "Shows LFO " + m[1] + ". One LFO is shown at a time; click the open one again to hide them."];
  if (varname === "l_sel") return ["LFO shown", "Which LFO's panel the editor shows, 1 to 4. Does not change the sound: every LFO's own settings are the LFO1 to LFO4 parameters."];
  if (varname === "l_show") return ["Show LFO", "Shows or hides the LFO panel in the editor. Does not change the sound."];
  if ((m = /^n_char(\d+)$/.exec(varname))) return ["Patch name, character " + m[1], "Character " + m[1] + " of the ten-character patch name, as an ASCII code from 32 (space) to 126. The name goes to the synth with Push patch and names the device in Live. The display is easier: click it and type."];
  if ((m = /^l([1-4])_(\w+)$/.exec(varname)) && LFO[m[2]]) return LFO[m[2]](Number(m[1]));
  if (varname === "d_version") return ["Version", "The editor version that last had this set, as a number: major times 10000 plus minor times 100 plus patch, so 302 is 0.3.2 and 10000 is 1.0.0. The editor writes it when it loads. Not a control, and it does not change the sound."];
  if ((m = /^c_(\w+)$/.exec(varname)) && COMMON[m[1]]) return COMMON[m[1]]();
  if (TOP[varname]) return TOP[varname]();
  return null;
}

module.exports = { help };
