"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express");
const { routes } = require("../modules/contabilidad/routes");
const { setup, fixture } = require("./helpers");
test("HTTP authentication, CSRF, tenant isolation and full posting flow", async (t) => {
  const { db } = setup(),
    app = express();
  app.use(express.json());
  // Test-only identity injection. Production uses express-session in server.js.
  app.use((req, res, next) => {
    req.session = req.get("X-Test-User")
      ? { contadorId: Number(req.get("X-Test-User")), ctCsrf: "test-token" }
      : {};
    next();
  });
  app.use("/api/contabilidad", routes(db));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.close();
    db.close();
  });
  const base =
    "http://127.0.0.1:" + server.address().port + "/api/contabilidad";
  const req = (
    p,
    method = "GET",
    body,
    identity = "1",
    csrf = "test-token",
    xml = false,
  ) =>
    fetch(base + p, {
      method,
      headers: {
        ...(identity ? { "X-Test-User": identity } : {}),
        "X-CSRF-Token": csrf,
        "Content-Type": xml ? "application/xml" : "application/json",
      },
      body: body === undefined ? undefined : xml ? body : JSON.stringify(body),
    });
  assert.equal(
    (await req("/clientes/1/cuentas", "GET", undefined, "")).status,
    401,
  );
  assert.equal(
    (await req("/clientes/1/cuentas", "GET", undefined, "2")).status,
    404,
  );
  assert.equal(
    (await req("/clientes/1/asientos", "POST", {}, "1", "bad")).status,
    403,
  );
  assert.equal(
    (await req("/clientes/1/automatizacion", "POST", {}, "1", "bad")).status,
    403,
  );
  assert.equal(
    (await req("/clientes/1/automatizacion/config", "GET", undefined, "2"))
      .status,
    404,
  );
  db.prepare(
    "INSERT INTO ct_trabajos(id,contador_id,cliente_id,desde,hasta,estado) VALUES('test-job',1,1,'2026-08-01','2026-08-31','completado')",
  ).run();
  assert.equal(
    (
      await req(
        "/clientes/2/automatizacion/test-job/excel",
        "GET",
        undefined,
        "2",
      )
    ).status,
    404,
  );
  const imported = await req(
    "/clientes/1/xml",
    "POST",
    fixture(),
    "1",
    "test-token",
    true,
  );
  assert.equal(imported.status, 200);
  const doc = await imported.json();
  const proposal = await (
    await req("/clientes/1/comprobantes/" + doc.id + "/proponer", "POST", {
      cuenta: "70111",
    })
  ).json();
  assert.equal(
    (
      await req(
        "/clientes/2/asientos/" + proposal.id + "/contabilizar",
        "POST",
        {},
        "2",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "/clientes/1/asientos/" + proposal.id + "/contabilizar",
        "POST",
        {},
      )
    ).status,
    200,
  );
  const financial = await (
    await req("/clientes/1/estados?corte=2026-08-31")
  ).json();
  assert.equal(financial.utilidad, 10000);
  assert.equal(
    (
      await req("/clientes/1/tareas", "POST", {
        titulo: "Conciliar",
        vence: "2026-09-15",
      })
    ).status,
    200,
  );
  const crm = await (await req("/crm?periodo=2026-08")).json();
  assert.equal(crm.length, 2);
  assert.equal(crm.find((c) => c.id === 1).tareas.length, 1);
  const csv = await (
    await req("/clientes/1/exportar?libro=mayor&corte=2026-08-31")
  ).text();
  assert.match(csv, /1212/);
  db.prepare("UPDATE contadores SET activo=0 WHERE id=1").run();
  assert.equal((await req("/clientes/1/cuentas")).status, 401);
});
