"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrate, service } = require("../modules/contabilidad/service");
const { parseUBL } = require("../modules/contabilidad/parser");
const { cents } = require("../modules/contabilidad/money");
const { due } = require("../modules/contabilidad/crm");
const { fixture, setup } = require("./helpers");
test("money exact cents, negative and invalid precision", () => {
  assert.equal(cents("0.29"), 29);
  assert.equal(cents("-1.01"), -101);
  assert.throws(() => cents("1.001"));
  assert.throws(() => cents("NaN"));
});
test("UBL recognizes both directions and arbitrary namespace prefixes", () => {
  const xml = fixture()
    .replaceAll("cbc:", "b:")
    .replaceAll("xmlns:cbc", "xmlns:b")
    .replaceAll("cac:", "a:")
    .replaceAll("xmlns:cac", "xmlns:a");
  assert.equal(parseUBL(xml, "20100000001").direccion, "venta");
  assert.equal(parseUBL(xml, "20100000002").direccion, "compra");
});
test("XML rejects entities, wrong namespace, unrelated RUC, bad dates and malformed data", () => {
  for (const xml of [
    "<!DOCTYPE x>" + fixture(),
    fixture().replace("Invoice-2", "Fake-2"),
    fixture().replace("2026-08-01", "2026-02-30"),
    "<Invoice>",
  ])
    assert.throws(() => parseUBL(xml, "20100000001"));
  assert.throws(() => parseUBL(fixture(), "20999999999"));
});
test("foreign currency and special totals require manual review", () => {
  const { s } = setup();
  for (const opts of [
    { currency: "USD" },
    { total: "110.00" },
    { taxcode: "2000" },
  ]) {
    const id = s.importar(
      fixture({
        ...opts,
        number: "F001-" + (opts.currency ? 2 : opts.total ? 3 : 4),
      }),
    ).id;
    assert.throws(() => s.proponer(id, { cuenta: "70111" }));
  }
});
test("tenant isolation and composite foreign keys", () => {
  const { db, s } = setup();
  const id = s.importar(fixture()).id;
  assert.throws(() => service(db, 2, 1), /Cliente no encontrado/);
  assert.equal(service(db, 2, 2).comprobantes().length, 0);
  assert.throws(() => service(db, 1, 3).proponer(id, { cuenta: "70111" }));
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO ct_registros(contador_id,cliente_id,comprobante_id,periodo) VALUES(2,2,?,'2026-08')",
      )
      .run(id),
  );
});
test("idempotent XML imports, conflict protection and proposal", () => {
  const { s } = setup();
  const x = fixture(),
    a = s.importar(x);
  assert.equal(s.importar(x).id, a.id);
  assert.equal(s.importar(x).duplicado, true);
  assert.throws(
    () => s.importar(x.replace("Servicio", "Otro servicio")),
    /otro XML/,
  );
  const p = s.proponer(a.id, { cuenta: "70111" });
  assert.equal(s.proponer(a.id, { cuenta: "70111" }).id, p.id);
});
test("sale -> double entry -> financials and ledger, draft excluded", () => {
  const { s } = setup();
  const p = s.proponer(s.importar(fixture()).id, { cuenta: "70111" });
  assert.equal(s.financial("2026-08-31").activo, 0);
  s.contabilizar(p.id);
  const f = s.financial("2026-08-31");
  assert.equal(f.activo, 11800);
  assert.equal(f.pasivo, 1800);
  assert.equal(f.utilidad, 10000);
  assert.equal(f.diferencia, 0);
  assert.equal(s.mayor("2026-08-31").length, 3);
});
test("purchase with and without eligible credit", () => {
  const { db } = setup();
  const s = service(db, 2, 2);
  let p = s.proponer(s.importar(fixture()).id, {
    cuenta: "6399",
    creditoFiscal: true,
  });
  assert.equal(p.apuntes.find((p) => p.cuenta === "40111").debe, 1800);
  p = s.proponer(s.importar(fixture({ number: "F001-2" })).id, {
    cuenta: "6399",
    creditoFiscal: false,
  });
  assert.equal(p.apuntes.find((p) => p.cuenta === "6399").debe, 11800);
  assert.equal(p.apuntes.length, 2);
});
test("credit and debit notes use original and reverse signs only for credit", () => {
  const { s } = setup();
  const missing = s.importar(
    fixture({ kind: "CreditNote", number: "FC01-1" }),
  ).id;
  assert.throws(() => s.proponer(missing, { cuenta: "70111" }), /original/);
  s.importar(fixture());
  let a = s.proponer(missing, { cuenta: "70111" });
  assert.equal(a.apuntes.find((p) => p.cuenta === "1212").haber, 11800);
  a = s.proponer(
    s.importar(fixture({ kind: "DebitNote", number: "FD01-1" })).id,
    { cuenta: "70111" },
  );
  assert.equal(a.apuntes.find((p) => p.cuenta === "1212").debe, 11800);
});
test("unbalanced posting rolls back, immutable posted entries and reversal", () => {
  const { db, s } = setup();
  const a = s.manual({
    fecha: "2026-08-01",
    glosa: "Apertura",
    apuntes: [
      { cuenta: "101", debe: "10", haber: "0" },
      { cuenta: "5011", debe: "0", haber: "9" },
    ],
  });
  assert.throws(() => s.contabilizar(a.id), /descuadrado/);
  assert.equal(s.asientos()[0].estado, "borrador");
  s.editar(a.id, [
    { cuenta: "101", debe: "10", haber: "0" },
    { cuenta: "5011", debe: "0", haber: "10" },
  ]);
  s.contabilizar(a.id);
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE ct_apuntes SET debe=2000 WHERE asiento_id=? AND debe>0",
        )
        .run(a.id),
    /inmutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM ct_asientos WHERE id=?").run(a.id),
    /inmutable/,
  );
  s.contabilizar(s.revertir(a.id, "2026-08-02").id);
  assert.equal(s.financial("2026-08-31").activo, 0);
  assert.throws(() => s.revertir(a.id, "2026-08-03"));
});
test("closing periods blocks posting and creation; reopen is audited", () => {
  const { s } = setup();
  const a = s.proponer(s.importar(fixture()).id, { cuenta: "70111" });
  assert.throws(() => s.periodo("2026-08", true), /borradores/);
  s.contabilizar(a.id);
  s.periodo("2026-08", true);
  assert.throws(() => s.revertir(a.id, "2026-08-15"), /cerrado/);
  s.periodo("2026-08", false);
  assert.ok(s.revertir(a.id, "2026-08-15"));
  assert.ok(s.auditoria().some((a) => a.evento === "periodo"));
});
test("trial balance includes opening and prior year; income is current year", () => {
  const { s } = setup();
  s.contabilizar(
    s.manual({
      fecha: "2025-01-01",
      glosa: "Apertura",
      clase: "apertura",
      apuntes: [
        { cuenta: "101", debe: "100", haber: "0" },
        { cuenta: "5011", debe: "0", haber: "100" },
      ],
    }).id,
  );
  assert.equal(s.financial("2026-08-31").activo, 10000);
  assert.equal(s.financial("2026-08-31").utilidad, 0);
});
test("fiscal period independent and credit note register sign", () => {
  const { s } = setup();
  const id = s.importar(fixture({ kind: "CreditNote", number: "FC01-1" })).id;
  s.revisar(id, {
    periodo: "2026-09",
    estadoSunat: "aceptado",
    creditoFiscal: false,
  });
  assert.equal(s.registros("2026-08").length, 0);
  assert.equal(s.registros("2026-09")[0].signo, -1);
});
test("tax RG/RMT exact progressive brackets and invalid loss claims", () => {
  const { s } = setup();
  s.contabilizar(
    s.manual({
      fecha: "2026-08-01",
      glosa: "Servicios",
      apuntes: [
        { cuenta: "1212", debe: "100000", haber: "0" },
        { cuenta: "7041", debe: "0", haber: "100000" },
      ],
    }).id,
  );
  const data = {
    ejercicio: 2026,
    regimen: "RG",
    uit: "5000",
    fuenteNormativa: "fuente de prueba",
    ajustes: [],
    pagos: "1000",
  };
  assert.equal(s.renta(data).impuesto, 2950000);
  assert.equal(s.renta({ ...data, regimen: "RMT" }).impuesto, 1487500);
  assert.throws(() => s.renta({ ...data, perdidas: "100001" }));
  assert.throws(() => s.renta({ ...data, perdidas: "1000" }), /sistema/);
});
test("monthly calendar RUC groups, rollover and missing year", () => {
  assert.equal(due("20100000000", "2026-08"), "2026-09-15");
  assert.equal(due("20100000003", "2026-08"), "2026-09-17");
  assert.equal(due("20100000009", "2026-12"), "2027-01-25");
  assert.equal(
    due("20100000000", "2026-08", "buen_contribuyente"),
    "2026-09-23",
  );
  assert.equal(due("20100000000", "2027-01"), null);
});
test("migration idempotency retains accounting data", () => {
  const { db, s } = setup();
  s.importar(fixture());
  migrate(db);
  assert.equal(s.comprobantes().length, 1);
});
