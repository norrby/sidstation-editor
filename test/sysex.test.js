// node --test: lib/sysex.js against synthetic frames built by hand (test/fixtures.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/sysex");
const F = require("./fixtures");

test("a fresh R33 dump: header, nibbles low first, size = raw bytes, three empty tables", () => {
  const m = F.fresh();
  const r = S.decodeDump(m);
  assert.equal(r.ok, true);
  assert.equal(r.name, "Fixture 01");
  assert.equal(r.pad, 24);
  assert.equal(r.marker, 0x45);
  assert.equal(r.size, 146);
  assert.equal(r.patch.length, 146);
  assert.equal(r.patch[12], 0x7f, "DCTRL1_LU = 7F requires low nibble first");
  const t = S.tableInfo(r.patch);
  assert.deepEqual(t.tables.map((x) => x.term), ["END", "END", "END"]);
  assert.equal(S.validateFrame(m).ok, true);
});

test("a dump with unterminated tables: they are dumped as 65 steps, size = sent + 1 per table", () => {
  const r = S.decodeDump(F.unterminated());
  const t = S.tableInfo(r.patch);
  assert.deepEqual(t.tables.map((x) => x.steps.length), [65, 65, 65]);
  assert.equal(t.unterminated, 3);
  assert.equal(r.size, r.patch.length + 3);
  assert.equal(r.patch.length, 143 + 3 * 130);
  assert.equal(r.patch[81], 0xe8, "osc3 transpose −24 in two's complement");
});

test("an older dump: 18 steps + END, empty table 2, 65 steps of junk in table 3, ends evenly", () => {
  const r = S.decodeDump(F.older());
  const t = S.tableInfo(r.patch);
  assert.equal(t.tables[0].steps.length, 18);
  assert.equal(t.tables[0].term, "END");
  assert.equal(t.tables[1].steps.length, 0);
  assert.equal(t.tables[2].steps.length, 65);
  assert.equal(t.end, r.patch.length);
  assert.equal(r.size, r.patch.length + 1);
});

test("a bank: 192 frames, exactly one broken, the cleaned file clean", () => {
  const v = S.validateBank(F.bank());
  assert.equal(v.frames.length, 192);
  assert.equal(v.positions, 100);
  const bad = v.rows.filter((r) => !r.ok);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].name.trim(), "Broken");
  assert.equal(bad[0].pos, F.BROKEN_SLOT);
  assert.match(bad[0].reason, /^size 146 vs/);
  // --clean (tools/validate-bank.js): keep the valid frames, so the 03 frames still line up the slots
  const cleaned = [].concat(...v.rows.filter((r) => r.ok).map((r) => v.frames[r.i]));
  const clean = S.validateBank(cleaned);
  assert.equal(clean.frames.length, 191);
  assert.equal(clean.positions, 100);
  assert.equal(clean.rows.filter((r) => !r.ok).length, 0);
  assert.equal(clean.rows.filter((r) => r.id === S.ID_DUMP).length, 90);
});

test("validateFrame refuses a wrong header, OS frames and a wrong id", () => {
  assert.equal(S.validateFrame([0xf0, 0x00, 0x45, 0x01, 0x69, 0x7e, 0x41, 0xf7]).ok, false, "OS start frame");
  assert.equal(S.validateFrame([0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x04, 0x00, 0x47, 0x01, 0x01, 0x01, 0xf7]).ok, false, "DP (04) is not sent via a bank");
  assert.equal(S.validateFrame([0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x03, 0xf7]).ok, true);
  const clear = [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0x45, ...Array(14).fill(0x2d), 0xf7];
  assert.equal(S.validateFrame(clear).ok, true);
  assert.equal(S.validateFrame(clear.slice(0, -2).concat([0xf7])).ok, false, "13 padding bytes");
});

test("the AllPatch frame of a wiped memory: 01 + 100 × 03", () => {
  const v = S.validateBank(F.wiped());
  assert.equal(v.frames.length, 101);
  assert.equal(v.rows[0].id, S.ID_CLEAR);
  assert.ok(v.rows.every((r) => r.ok));
  assert.equal(v.rows.filter((r) => r.id === S.ID_DUMP).length, 0);
});

test("encodeDump is the exact inverse of decodeDump on fresh dumps (terminated and not)", () => {
  for (const f of ["fresh", "unterminated", "poly"]) {
    const m = F[f]();
    const r = S.decodeDump(m);
    assert.deepEqual(S.encodeDump(r.patch), m, f);
  }
});

test("Direct Program: encodeDP builds the manual's frame, 14-bit address, refuses wrong fields", () => {
  const S = require("../lib/sysex");
  assert.deepEqual(S.encodeDP(0x56, 0x0f, 4, 1), [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x04, 0x00, 0x56, 0x0f, 0x04, 0x01, 0xf7]);
  assert.deepEqual(S.encodeDP(0x80, 0x0f, 4, 8).slice(7, 12), [0x01, 0x00, 0x0f, 0x04, 0x08]);   // osc3 wave = 01 00
  assert.ok(S.validateDPFrame(S.encodeDP(0x16, 0x01, 2, 1)).ok);
  assert.throws(() => S.encodeDP(0x56, 0x0f, 4, 16));      // value > mask
  assert.throws(() => S.encodeDP(0x56, 0x1f, 0, 1));       // unknown mask
  assert.throws(() => S.encodeDP(0x56, 0x7f, 4, 1));       // the field sticks out of the byte
  assert.ok(!S.validateDPFrame([0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x04, 0x00, 0x56, 0x0f, 0x04, 0x81, 0xf7]).ok);
  assert.ok(!S.validateFrame(S.encodeDP(0x56, 0x0f, 4, 1)).ok);   // DP does not belong in a bank file
});

test("dump request (05, our firmware only): exactly 9 bytes, slot 0..99 or 7F, never via a bank", () => {
  const req = (s) => [0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x05, s, 0xf7];
  for (const s of [0, 14, 99, 0x7f]) assert.equal(S.validateRequestFrame(req(s)).ok, true, "slot " + s);
  for (const s of [100, 0x7e, 0x80]) assert.ok(!S.validateRequestFrame(req(s)).ok, "slot " + s);
  assert.ok(!S.validateRequestFrame(req(1).slice(0, -1).concat([0x00, 0xf7])).ok, "too long");
  assert.ok(!S.validateRequestFrame([0xf0, 0x00, 0x20, 0x3c, 0x01, 0x00, 0x01, 0x0e, 0xf7]).ok, "id 01");
  assert.ok(!S.validateFrame(req(14)).ok, "05 does not go via validateFrame/bank");
  assert.deepEqual(S.encodeRequest(0x7f), req(0x7f));
  assert.throws(() => S.encodeRequest(100));
});
