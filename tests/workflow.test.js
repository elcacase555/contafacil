"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("fs/promises"),
  path = require("path"),
  os = require("os"),
  ExcelJS = require("exceljs");
const { setup, fixture } = require("./helpers");
const { coordinator, range } = require("../modules/contabilidad/workflow");
const {
  parseSire,
  reconcile,
} = require("../modules/contabilidad/conciliation");
const { createSireClient } = require("../modules/contabilidad/sire-client");
const AdmZip = require("adm-zip");
function sireText({
  total = "118.00",
  ruc = "20100000001",
  libro = "RVIE",
  empty = false,
} = {}) {
  const a = Array(libro === "RVIE" ? 33 : 37).fill("");
  if (empty) {
    a[0] = "RUC";
    a[2] = "Periodo";
    return a.join("|");
  }
  a[0] = ruc;
  a[1] = "Empresa";
  a[2] = "202608";
  a[4] = "01/08/2026";
  a[6] = "01";
  a[7] = "F001";
  a[libro === "RVIE" ? 8 : 9] = "1";
  if (libro === "RVIE") {
    a[10] = "6";
    a[11] = "20100000002";
    a[12] = "Cliente";
    a[14] = "100.00";
    a[16] = "18.00";
    a[25] = total;
    a[26] = "PEN";
  } else {
    a[11] = "6";
    a[12] = "20100000002";
    a[13] = "Proveedor";
    a[14] = "100.00";
    a[15] = "18.00";
    a[24] = total;
    a[25] = "PEN";
  }
  return a.join("|") + "\r\n";
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ct-workflow-"));
  t.after(async () => {
    const resolved = path.resolve(root),
      parent = path.resolve(os.tmpdir()) + path.sep;
    if (
      !resolved.startsWith(parent) ||
      !path.basename(resolved).startsWith("ct-workflow-")
    )
      throw new Error("Unsafe cleanup");
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return root;
}
test("exact date range clips both endpoints and handles leap February", () => {
  const m = range("2024-02-12", "2024-03-04");
  assert.equal(m[0].desde, "12/02/2024");
  assert.equal(m[0].hasta, "29/02/2024");
  assert.equal(m[1].hasta, "04/03/2024");
  assert.throws(() => range("2026-02-01", "2026-01-01"));
  assert.throws(() => range("2020-01-01", "2024-01-01"));
});
test("SIRE parsing checks RUC, period, duplicates and real empty header", () => {
  assert.equal(
    parseSire(sireText(), "RVIE", "20100000001", "202608")[0].igv,
    1800,
  );
  assert.throws(() => parseSire(sireText(), "RVIE", "20100000009", "202608"));
  assert.throws(() => parseSire(sireText(), "RVIE", "20100000001", "202609"));
  assert.throws(() =>
    parseSire(sireText() + sireText(), "RVIE", "20100000001", "202608"),
  );
  assert.throws(() => parseSire("RUC", "RVIE", "20100000001", "202608"));
  assert.deepEqual(
    parseSire(sireText({ empty: true }), "RVIE", "20100000001", "202608"),
    [],
  );
});
test("conciliation uses fiscal key and exposes monetary differences and missing source", () => {
  const { s } = setup();
  s.importar(fixture());
  let rows = parseSire(
    sireText({ total: "119.00" }),
    "RVIE",
    "20100000001",
    "202608",
  );
  assert.equal(
    reconcile(s.comprobantes(), rows, "2026-08-01", "2026-08-31", [
      "RVIE:202608",
    ])[0].estado,
    "diferencia",
  );
  assert.equal(
    reconcile(s.comprobantes(), [], "2026-08-01", "2026-08-31", [])[0].estado,
    "sire_no_disponible",
  );
  assert.equal(
    reconcile([], rows, "2026-08-01", "2026-08-31", ["RVIE:202608"])[0].estado,
    "solo_sire",
  );
});
test("one-click pipeline invokes all packages, posts matches, produces Excel and isolates downloads", async (t) => {
  const { db, s } = setup();
  t.after(() => db.close());
  const root = await temporary(t);
  db.exec(
    "ALTER TABLE clientes_sunat ADD COLUMN usuario_sol TEXT;ALTER TABLE clientes_sunat ADD COLUMN clave_sol_cifrada TEXT;UPDATE clientes_sunat SET usuario_sol='TEST',clave_sol_cifrada='test-only'",
  );
  const calls = [];
  const deps = {
    root,
    encrypt: (x) => "encrypted:" + x,
    decrypt: (x) => (x.startsWith("encrypted:") ? x.slice(10) : x),
    download: async (cred, months, folder, progress, pack, direction) => {
      calls.push({ pack, direction, months });
      await fs.mkdir(folder, { recursive: true });
      if (pack === "FE")
        await fs.writeFile(path.join(folder, "invoice.xml"), fixture());
    },
    sireApi: {
      token: async () => "test",
      proposal: async (token, p, libro) => ({
        ticket: "test",
        archivos: [{ texto: sireText({ libro, empty: libro === "RCE" }) }],
      }),
    },
  };
  const flow = coordinator(db, deps);
  flow.save(1, 1, {
    cuentaVenta: "70111",
    cuentaCompra: "6399",
    contabilizar: true,
    clientId: "test-client-id",
    clientSecret: "test-secret",
  });
  assert.equal(flow.config(1, 1).clientSecret, undefined);
  const job = flow.start(1, 1, {
    desde: "2026-08-01",
    hasta: "2026-08-31",
    usarSire: true,
  });
  assert.throws(() =>
    flow.start(1, 1, {
      desde: "2026-08-01",
      hasta: "2026-08-31",
      usarSire: true,
    }),
  );
  await flow.wait(job.id);
  const result = flow.read(1, 1, job.id);
  assert.equal(result.estado, "completado", JSON.stringify(result));
  assert.equal(result.resultado.contabilizados, 1);
  assert.equal(calls.length, 3);
  assert.equal(s.financial("2026-08-31").utilidad, 10000);
  assert.throws(() => flow.file(2, 2, job.id), /no encontrado/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(flow.file(1, 1, job.id));
  for (const name of [
    "Ventas XML",
    "Compras XML",
    "Libro Mayor",
    "Situacion financiera",
    "Estado de resultados",
    "Observaciones",
  ])
    assert.ok(wb.getWorksheet(name));
  assert.equal(wb.getWorksheet("Ventas XML").getCell("I2").value, 118);
  assert.equal(wb.getWorksheet("Diario contabilizado").rowCount, 4);
  assert.equal(wb.getWorksheet("Conciliacion").getCell("C2").value, "coincide");
  const second = flow.start(1, 1, {
    desde: "2026-08-01",
    hasta: "2026-08-31",
    usarSire: true,
  });
  await flow.wait(second.id);
  assert.equal(flow.read(1, 1, second.id).resultado.contabilizados, 0);
  assert.equal(s.asientos().length, 1);
});
test("pipeline with unavailable SIRE generates drafts and a visible incomplete report", async (t) => {
  const { db, s } = setup();
  t.after(() => db.close());
  const root = await temporary(t);
  db.exec(
    "ALTER TABLE clientes_sunat ADD COLUMN usuario_sol TEXT;ALTER TABLE clientes_sunat ADD COLUMN clave_sol_cifrada TEXT;UPDATE clientes_sunat SET clave_sol_cifrada='test-only'",
  );
  const flow = coordinator(db, {
    root,
    decrypt: (x) => x,
    encrypt: (x) => x,
    download: async (c, m, folder, cb, pack) => {
      await fs.mkdir(folder, { recursive: true });
      if (pack === "FE")
        await fs.writeFile(path.join(folder, "invoice.xml"), fixture());
    },
  });
  flow.save(1, 1, {
    cuentaVenta: "70111",
    cuentaCompra: "6399",
    contabilizar: true,
  });
  const j = flow.start(1, 1, {
    desde: "2026-08-01",
    hasta: "2026-08-31",
    usarSire: false,
  });
  await flow.wait(j.id);
  assert.equal(flow.read(1, 1, j.id).estado, "con_observaciones");
  assert.equal(s.asientos()[0].estado, "borrador");
  assert.equal(s.financial("2026-08-31").utilidad, 0);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(flow.file(1, 1, j.id));
  const projected = wb.getWorksheet("Resultados proyectados");
  assert.equal(projected.getCell("C" + projected.rowCount).value, 100);
  assert.equal(wb.getWorksheet("Diario contabilizado").rowCount, 1);
});
test("repeated SIRE documents across periods never authorize automatic posting", () => {
  const { db, s } = setup();
  try {
    s.importar(fixture());
    const rows = parseSire(sireText(), "RVIE", "20100000001", "202608");
    const result = reconcile(
      s.comprobantes(),
      [...rows, { ...rows[0], periodo: "202609" }],
      "2026-08-01",
      "2026-09-30",
      ["RVIE:202608", "RVIE:202609"],
    );
    assert.equal(result[0].estado, "sire_duplicado");
  } finally {
    db.close();
  }
});
test("SIRE client authenticates, waits for ticket, downloads ZIP without exposing credentials", async () => {
  const zip = new AdmZip();
  zip.addFile("propuesta.txt", Buffer.from(sireText()));
  let count = 0;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("oauth2"))
      return new Response(JSON.stringify({ access_token: "mock-token" }));
    if (url.includes("exportapropuesta"))
      return new Response(JSON.stringify({ numTicket: "20260100000001" }));
    if (url.includes("consultaestadotickets")) {
      count++;
      return new Response(
        JSON.stringify({
          registros:
            count === 1
              ? []
              : [
                  {
                    numTicket: "20260100000001",
                    codProceso: "32",
                    archivoReporte: [
                      {
                        nomArchivoReporte: "mock.zip",
                        codTipoArchivoReporte: "01",
                      },
                    ],
                  },
                ],
        }),
      );
    }
    return new Response(zip.toBuffer());
  };
  const api = createSireClient({ fetcher, sleep: async () => {} }),
    token = await api.token({
      clientId: "test-client-id",
      clientSecret: "secret",
      ruc: "20100000001",
      usuario: "TEST",
      password: "password",
    });
  const result = await api.proposal(token, "202608", "RVIE");
  assert.equal(result.archivos.length, 1);
  assert.equal(calls[0].options.body.get("username"), "20100000001TEST");
  assert.ok(calls.at(-1).url.includes("codLibro=140000"));
  assert.ok(calls.every((c) => !c.url.includes("password")));
});
module.exports = { sireText };
