const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs/promises"),
  path = require("path"),
  os = require("os");
const ExcelJS = require("exceljs"),
  AdmZip = require("adm-zip");
const { setup, fixture } = require("./helpers");
const { coordinator } = require("../modules/contabilidad/workflow");
const { simulationBook } = require("../modules/contabilidad/simulation-excel");
const { parseUBL } = require("../modules/contabilidad/parser");
const { fiscalKey } = require("../modules/contabilidad/conciliation");
test("simulation signs reconcile invoices, credit and debit notes in both directions", async () => {
  const { db, s } = setup();
  try {
    const docs = [];
    for (const purchase of [false, true])
      for (const [kind, number, base] of [
        ["Invoice", "F001-1", purchase ? 50 : 100],
        ["CreditNote", "FC01-1", purchase ? 5 : 10],
        ["DebitNote", "FD01-1", purchase ? 15 : 20],
      ]) {
        const d = parseUBL(
          fixture({
            kind,
            number,
            supplier: purchase ? "20100000002" : "20100000001",
            customer: purchase ? "20100000001" : "20100000002",
            base: base.toFixed(2),
            tax: (base * 0.18).toFixed(2),
            total: (base * 1.18).toFixed(2),
          }),
          "20100000001",
        );
        d.key = fiscalKey(d.emisor, d.tipo, d.numero);
        d.archivo = number + ".xml";
        docs.push(d);
      }
    for (const credit of [false, true]) {
      const b = new ExcelJS.Workbook();
      await b.xlsx.load(
        await simulationBook({
          empresa: s.cliente,
          desde: "2026-08-01",
          hasta: "2026-08-31",
          docs,
          accounts: s.cuentas(),
          rules: { creditoFiscal: credit },
          issues: [],
        }),
      );
      assert.ok(
        Math.abs(
          b.getWorksheet("Estado resultados").getCell("B8").result -
            (credit ? 50 : 39.2),
        ) < 0.00001,
      );
      assert.ok(
        Math.abs(
          b.getWorksheet("Dashboard").getCell("B8").result -
            b.getWorksheet("Dashboard").getCell("B9").result -
            b.getWorksheet("Dashboard").getCell("B12").result,
        ) < 0.00001,
      );
    }
  } finally {
    db.close();
  }
});
test("simulation without SIRE creates organized output, live formulas and native chart without posting", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ct-simulation-"));
  const { db, s } = setup();
  t.after(async () => {
    db.close();
    const p = path.resolve(root);
    if (
      !p.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(p).startsWith("ct-simulation-")
    )
      throw new Error("Unsafe cleanup");
    await fs.rm(p, { recursive: true, force: true });
  });
  db.exec(
    "ALTER TABLE clientes_sunat ADD COLUMN usuario_sol TEXT;ALTER TABLE clientes_sunat ADD COLUMN clave_sol_cifrada TEXT;UPDATE clientes_sunat SET clave_sol_cifrada='test'",
  );
  let calls = 0;
  const flow = coordinator(db, {
    root: path.join(root, "private"),
    decrypt: (x) => x,
    downloadOrganized: async (c, m, folder, cb) => {
      calls++;
      assert.equal(m[0].desde, "01/08/2026");
      assert.equal(m[0].hasta, "20/08/2026");
      const dir = path.join(
        folder,
        "Comprobantes de pago",
        "Facturas",
        "Emitidas",
      );
      await fs.writeFile(path.join(dir, "XML", "venta.xml"), fixture());
      await fs.writeFile(path.join(dir, "PDF", "venta.pdf"), "%PDF-1.4 test");
      await fs.writeFile(
        path.join(
          folder,
          "Comprobantes de pago",
          "Notas de credito",
          "Emitidas",
          "XML",
          "nota.xml",
        ),
        fixture({
          kind: "CreditNote",
          number: "FC01-2",
          base: "10.00",
          tax: "1.80",
          total: "11.80",
        }),
      );
      await fs.writeFile(
        path.join(dir, "XML", "outside.xml"),
        fixture({ number: "F001-3" }).replace("2026-08-01", "2026-07-01"),
      );
    },
  });
  assert.throws(
    () =>
      flow.start(1, 1, {
        modo: "simulacion",
        desde: "2026-08-01",
        hasta: "2026-08-20",
        carpetaDestino: "relative",
      }),
    /absoluta/,
  );
  const job = flow.start(1, 1, {
    modo: "simulacion",
    desde: "2026-08-01",
    hasta: "2026-08-20",
    carpetaDestino: root,
  });
  await flow.wait(job.id);
  const result = flow.read(1, 1, job.id);
  assert.notEqual(result.estado, "error", JSON.stringify(result));
  const r = result.resultado;
  assert.equal(calls, 1);
  assert.equal(r.documentos, 2);
  assert.equal(r.archivos.length, 5);
  assert.equal(s.asientos().length, 0);
  assert.equal(s.comprobantes().length, 0);
  assert.match(r.aviso, /SIMULACIÓN/);
  assert.ok(r.observaciones.some((i) => i.mensaje.includes("fuera del rango")));
  for (const file of r.archivos)
    assert.ok((await fs.stat(path.join(r.carpeta, file))).size > 0);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(flow.file(1, 1, job.id));
  assert.ok(
    book.getWorksheet("XML").getCell("T5").formula.includes("IF(ISBLANK(M5)"),
  );
  assert.equal(book.getWorksheet("Estado resultados").getCell("B8").result, 90);
  assert.equal(
    book.getWorksheet("Registro ventas").getCell("I6").result,
    -11.8,
  );
  assert.equal(book.getWorksheet("Dashboard").getCell("B14").result, 0);
  const zip = new AdmZip(flow.file(1, 1, job.id));
  assert.ok(zip.getEntries().some((e) => /\/charts\/chart/.test(e.entryName)));
  assert.ok(zip.readAsText("xl/worksheets/sheet1.xml").includes("drawing"));
  assert.equal(
    (
      await fs.readdir(
        path.join(
          r.carpeta,
          "Comprobantes de pago",
          "Notas de credito",
          "Emitidas",
          "Excel",
        ),
      )
    ).length,
    1,
  );
  if (process.env.CT_SIMULATION_SAMPLE)
    await fs.copyFile(
      flow.file(1, 1, job.id),
      process.env.CT_SIMULATION_SAMPLE,
    );
  const next = flow.start(1, 1, {
    modo: "simulacion",
    desde: "2026-08-01",
    hasta: "2026-08-20",
    carpetaDestino: root,
  });
  await flow.wait(next.id);
  assert.notEqual(flow.read(1, 1, next.id).resultado.carpeta, r.carpeta);
});
