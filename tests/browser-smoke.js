"use strict";
// End-to-end smoke against a disposable DB, never against real SOL credentials.
const express = require("express"),
  path = require("path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { setup, fixture } = require("./helpers");
const { routes } = require("../modules/contabilidad/routes");
(async () => {
  const { db } = setup(),
    app = express();
  app.use(express.json());
  const session = { contadorId: 1 };
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use(express.static(path.join(__dirname, "../public")));
  app.get("/contabilidad", (req, res) =>
    res.sendFile(path.join(__dirname, "../views/contabilidad.html")),
  );
  app.get("/api/clientes", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,nombre_cliente,ruc FROM clientes_sunat WHERE contador_id=1",
        )
        .all(),
    ),
  );
  app.use("/api/contabilidad", routes(db));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "http://127.0.0.1:" + server.address().port + "/contabilidad",
    );
    await page.waitForSelector("#clientesCrm table");
    await page.locator("#periodo").fill("2026-08");
    await page.locator("#periodo").dispatchEvent("change");
    await page.locator('[data-tab="xml"]').click();
    await page
      .locator("#archivos")
      .setInputFiles({
        name: "factura.xml",
        mimeType: "application/xml",
        buffer: Buffer.from(fixture()),
      });
    await page
      .getByRole("button", { name: "Importar XML", exact: true })
      .click();
    await page.getByText("factura.xml: importado", { exact: true }).waitFor();
    await page.locator("#comprobantes select").selectOption("70111");
    await page
      .getByRole("button", { name: "Proponer asiento", exact: true })
      .click();
    await page.locator("#diario:not([hidden])").waitFor();
    await page
      .getByRole("button", { name: "Contabilizar", exact: true })
      .click();
    await page.getByText("Asiento contabilizado.", { exact: true }).waitFor();
    await page.locator('[data-tab="estados"]').click();
    await page.locator("#balance table").waitFor();
    assert.match(await page.locator("#indicadores").innerText(), /100/);
    if (process.env.CT_SCREENSHOT)
      await page.screenshot({
        path: process.env.CT_SCREENSHOT,
        fullPage: true,
      });
    await page.locator('[data-tab="renta"]').click();
    await page.locator('#rentaForm input[name="ejercicio"]').fill("2026");
    await page
      .getByRole("button", { name: "Calcular y guardar borrador" })
      .click();
    await page.locator("#resultadoRenta table").waitFor();
    assert.match(await page.locator("#resultadoRenta").innerText(), /29[.,]50/);
    await page.locator('[data-tab="crm"]').click();
    await page.locator('#tareaForm input[name="titulo"]').fill("Revisar renta");
    await page.locator('#tareaForm input[name="vence"]').fill("2026-09-15");
    await page
      .getByRole("button", { name: "Guardar tarea", exact: true })
      .click();
    await page
      .locator("#tareas")
      .getByText("Revisar renta", { exact: true })
      .waitFor();
    await page.locator("#cliente").selectOption("3");
    await page.waitForFunction(() =>
      document
        .querySelector("#tareas")
        .textContent.includes("Todavía no hay registros."),
    );
    await page.locator('[data-tab="diario"]').click();
    assert.match(
      await page.locator("#asientos").innerText(),
      /Todavía no hay registros/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Browser smoke OK: import, proposal, posting, statements, tax, CRM, company switch and mobile layout.",
    );
  } finally {
    if (browser) await browser.close();
    server.close();
    db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
