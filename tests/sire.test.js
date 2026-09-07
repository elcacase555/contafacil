"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { fixture, setup } = require("./helpers");
const { buildSire } = require("../modules/contabilidad/sire");
const { service } = require("../modules/contabilidad/service");
function build(s, p = "2026-08", libro = "RVIE", clasificacion = {}) {
  return buildSire({
    libro,
    periodo: p,
    empresa: s.cliente,
    rows: s.registros(p),
    originals: s.comprobantes(),
    clasificacion,
  });
}
test("SIRE requires review and exports RVIE 33 columns with correct tax positions", () => {
  const { s } = setup();
  const id = s.importar(fixture()).id;
  assert.throws(() => build(s), /revisión/);
  s.revisar(id, { periodo: "2026-08", estadoSunat: "aceptado" });
  const result = build(s),
    row = result.contenido.trimEnd().split("|");
  assert.equal(row.length, 33);
  assert.equal(row[3], "");
  assert.equal(row[14], "100.00");
  assert.equal(row[16], "18.00");
  assert.equal(row[25], "118.00");
});
test("RVIE prior-period credit note uses discount columns; void sales zero amounts", () => {
  const { s } = setup();
  const a = s.importar(fixture()).id;
  s.revisar(a, { periodo: "2026-08", estadoSunat: "anulado" });
  assert.equal(build(s).contenido.split("|")[25], "0.00");
  const b = s.importar(fixture({ kind: "CreditNote", number: "FC01-1" })).id;
  s.revisar(b, { periodo: "2026-09", estadoSunat: "aceptado" });
  const row = build(s, "2026-09").contenido.trimEnd().split("|");
  assert.equal(row[15], "-100.00");
  assert.equal(row[17], "-18.00");
  assert.equal(row[14], "0.00");
  assert.equal(row[28], "01/08/2026");
});
test("RCE 37 columns, fiscal categories and all-or-nothing export", () => {
  const { db } = setup();
  const s = service(db, 2, 2);
  const id = s.importar(fixture()).id;
  s.revisar(id, {
    periodo: "2026-08",
    estadoSunat: "aceptado",
    creditoFiscal: true,
  });
  assert.throws(() => build(s, "2026-08", "RCE"), /clasificación/);
  const row = build(s, "2026-08", "RCE", { [id]: "5" })
    .contenido.trimEnd()
    .split("|");
  assert.equal(row.length, 37);
  assert.equal(row[14], "100.00");
  assert.equal(row[15], "18.00");
  assert.equal(row[24], "118.00");
  s.importar(fixture({ number: "F001-2" }));
  assert.throws(
    () => build(s, "2026-08", "RCE", { [id]: "5" }),
    /No se exportó un registro parcial/,
  );
});
test("SIRE rejects future fiscal dates", () => {
  const { s } = setup();
  const id = s.importar(fixture()).id;
  s.revisar(id, { periodo: "2026-07", estadoSunat: "aceptado" });
  assert.throws(() => build(s, "2026-07"), /posterior/);
});
test("SIRE rejects delimiter injection and unsupported currency", () => {
  const { s } = setup();
  const id = s.importar(fixture().replace("Cliente SAC", "Cliente|SAC")).id;
  s.revisar(id, { periodo: "2026-08", estadoSunat: "aceptado" });
  assert.throws(() => build(s), /separadores/);
  const { s: other } = setup();
  const x = other.importar(fixture({ currency: "USD" })).id;
  other.revisar(x, { periodo: "2026-08", estadoSunat: "aceptado" });
  assert.throws(() => build(other), /especial/);
});
