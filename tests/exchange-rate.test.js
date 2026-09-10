const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createExchangeClient,
  parseBcrp,
  prepareExchange,
  convertCents,
} = require("../modules/contabilidad/exchange-rate");
const { fixture } = require("./helpers");
const { parseUBL } = require("../modules/contabilidad/parser");
const { fiscalKey } = require("../modules/contabilidad/conciliation");

test("SEE-SOL note references allow spaces around hyphen and malformed references do not stop the batch", async () => {
  const invoice = parseUBL(fixture({ currency: "USD" }), "20100000001");
  const note = parseUBL(
    fixture({
      currency: "USD",
      kind: "CreditNote",
      number: "FC01-1",
      reference: " F001 - 00000001 ",
    }),
    "20100000001",
  );
  const bad = parseUBL(
    fixture({
      currency: "USD",
      kind: "CreditNote",
      number: "FC01-2",
      reference: "F001 - uno",
    }),
    "20100000001",
  );
  assert.equal(note.original, "F001-00000001");
  assert.equal(
    fiscalKey(invoice.emisor, "01", " F001 - 00000001 "),
    fiscalKey(invoice.emisor, "01", "F001-1"),
  );
  assert.throws(
    () => fiscalKey(invoice.emisor, "01", "F001-1-extra"),
    /inválido/,
  );
  const issues = await prepareExchange([invoice, note, bad], {
    resolve: async (dates) =>
      new Map(
        dates.map((d) => [
          d,
          { rate: 3.5, fecha: d, url: "https://estadisticas.bcrp.gob.pe" },
        ]),
      ),
  });
  assert.equal(invoice.fx.rate, 3.5);
  assert.equal(note.fx.rate, 3.5);
  assert.equal(bad.fx, null);
  assert.equal(issues.length, 1);
  assert.match(issues[0].mensaje, /referencia de la nota/);
});
const payload = JSON.stringify({
  config: {
    series: [
      { name: "Tipo de cambio - TC Sistema bancario SBS (S/ por US$) - Venta" },
    ],
  },
  periods: [
    { name: "31.Jul.25", values: ["3.580"] },
    { name: "01.Ago.25", values: ["3.588"] },
    { name: "04.Ago.25", values: ["3.579"] },
    { name: "06.Ago.25", values: ["n.d."] },
  ],
});
test("SBS series is validated, last prior quote crosses month/weekend and never uses future rates", async () => {
  let calls = 0;
  const client = createExchangeClient({
    today: () => "2025-08-15",
    fetchImpl: async (url) => {
      calls++;
      assert.match(url, /PD04640PD\/json\/2025-07-18\/2025-08-15\/esp$/);
      return {
        ok: true,
        text: async () =>
          payload + "<br /><font>diagnóstico PHP de la fuente</font>",
      };
    },
  });
  const result = await client([
    "2025-08-01",
    "2025-08-03",
    "2025-08-06",
    "2025-08-15",
    "2025-08-16",
  ]);
  assert.equal(calls, 1);
  assert.equal(result.get("2025-08-03").rate, 3.588);
  assert.equal(result.get("2025-08-06").fecha, "2025-08-04");
  assert.equal(result.has("2025-08-15"), false);
  assert.equal(result.has("2025-08-16"), false);
  assert.throws(
    () => parseBcrp(payload.replace("SBS", "Interbancario")),
    /serie SBS/,
  );
  assert.throws(() => parseBcrp(payload.replace('"3.588"', '"0"')), /inválido/);
  assert.throws(() => parseBcrp("<html>Error</html>"), /no devolvió/);
});
test("SBS conversion uses integer arithmetic and half-away-from-zero rounding", () => {
  assert.equal(convertCents(11800, 3.588), 42338);
  assert.equal(convertCents(1, 3.5), 4);
  assert.equal(convertCents(-1, 3.5), -4);
  assert.equal(convertCents(0, 3.588), 0);
  assert.throws(() => convertCents(100, NaN), /inválido/);
});
test("USD credit/debit notes inherit the original invoice date; missing or conflicting reference stays pending", async () => {
  const make = (o, day) =>
    parseUBL(
      fixture({ currency: "USD", ...o }).replace("2026-08-01", day),
      "20100000001",
    );
  const original = make({}, "2026-07-30");
  const credit = make({ kind: "CreditNote", number: "FC01-1" }, "2026-08-02");
  const debit = make({ kind: "DebitNote", number: "FD01-1" }, "2026-08-03");
  const missing = make(
    { kind: "CreditNote", number: "FC01-2", reference: "F999-1" },
    "2026-08-04",
  );
  const docs = [credit, debit, missing];
  await prepareExchange(docs, {
    references: [original],
    resolve: async (dates) => {
      assert.deepEqual(dates, ["2026-07-30", "2026-07-30"]);
      return new Map([
        [
          "2026-07-30",
          {
            rate: 3.5,
            fecha: "2026-07-30",
            url: "https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04640PD",
          },
        ],
      ]);
    },
  });
  assert.equal(credit.fx.rate, 3.5);
  assert.equal(debit.fx.fechaOperacion, "2026-07-30");
  assert.equal(credit.total, 11800);
  assert.equal(credit.pen.total, 41300);
  assert.equal(credit.warnings.length, 0);
  assert.equal(missing.fx, null);
  assert.match(missing.warnings.join(" "), /factura original/);
  const mismatch = make(
    { kind: "CreditNote", number: "FC01-3", customer: "20100000003" },
    "2026-08-02",
  );
  await prepareExchange([mismatch], {
    references: [original],
    resolve: () => {
      throw Error("should not call");
    },
  });
  assert.match(mismatch.warnings.join(" "), /no coincide/);
});
test("rate network failure leaves original amounts intact, visible and unconverted", async () => {
  const d = parseUBL(fixture({ currency: "USD" }), "20100000001");
  const issues = await prepareExchange([d], {
    resolve: async () => {
      throw Error("timeout");
    },
  });
  assert.equal(d.total, 11800);
  assert.equal(d.fx, null);
  assert.equal(d.pen, undefined);
  assert.match(issues[0].mensaje, /cotización oficial/);
});
