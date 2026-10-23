// midi.js – one parser for the MIDI byte stream from [midiin], shared by every script that reads it (the osc 1 router's
// note path, the gateway's note path, the capture, SidProbe, SidFake). Bundled in front of those scripts (v8 has no require).
//
// midiParser(handlers) -> function (byte). Handlers, all optional:
//   channel(msg)      a whole channel message [status, data…] (running status is followed)
//   sysex(frame)      a whole SysEx frame F0 … F7
//   realtime(b)       F8..FF, also in the middle of SysEx or a channel message
//   broken(part, b)   a SysEx frame cut off by byte b (a new F0, or any status byte – it ends SysEx, as the MIDI spec says)
// System common messages (F1..F6) and stray F7s are dropped.

const MIDI_CH_LEN = { 0x8: 3, 0x9: 3, 0xa: 3, 0xb: 3, 0xc: 2, 0xd: 2, 0xe: 3 };

function midiParser(h) {
  let sx = null, msg = [], need = 0;
  return function (b) {
    b &= 0xff;
    if (b >= 0xf8) { if (h.realtime) h.realtime(b); return; }
    if (sx) {
      if (b === 0xf7) { const f = sx; f.push(b); sx = null; if (h.sysex) h.sysex(f); return; }
      if (!(b & 0x80)) { sx.push(b); return; }
      if (h.broken) h.broken(sx, b);
      sx = null;                                                       // the status byte starts something new
    }
    if (b === 0xf0) { sx = [b]; msg = []; need = 0; return; }
    if (b & 0x80) {
      if (b >= 0xf1) { msg = []; need = 0; return; }                   // system common, stray F7: not ours
      msg = [b]; need = MIDI_CH_LEN[b >> 4];
      return;
    }
    if (!msg.length) return;                                           // data without a status
    msg.push(b);
    if (msg.length === need) { if (h.channel) h.channel(msg.slice()); msg = [msg[0]]; }
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { midiParser, MIDI_CH_LEN };
