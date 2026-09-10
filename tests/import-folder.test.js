const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { setup, fixture } = require("./helpers");
const { importFolder } = require("../modules/contabilidad/import-folder");
test("download adapter imports valid XML, reports unrelated XML and skips duplicates", async (t) => {
  const { db, s } = setup();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "contafacil-test-"));
  // Remove only this explicit temporary test directory after the run.
  t.after(async () => {
    db.close();
    if (
      !path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(dir).startsWith("contafacil-test-")
    )
      throw new Error("Unsafe cleanup");
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(dir, "venta.xml"),
    Buffer.from(
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
        fixture().replace("Proveedor SAC", "Muñoz y compañía"),
      "latin1",
    ),
  );
  await fs.writeFile(
    path.join(dir, "otro.xml"),
    fixture({ supplier: "20999999999", customer: "20888888888" }),
  );
  await fs.writeFile(path.join(dir, "documento.pdf"), "ignored");
  let result = await importFolder(db, 1, 1, dir);
  assert.equal(result.importados, 1);
  assert.equal(result.errores.length, 1);
  result = await importFolder(db, 1, 1, dir);
  assert.equal(result.duplicados, 1);
  assert.equal(s.comprobantes().length, 1);
});
