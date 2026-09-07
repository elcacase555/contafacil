"use strict";
const fs = require("fs/promises");
const path = require("path");
const { service } = require("./service");
// Called only with the server's already authorized download destination, never
// with a path received through the accounting API. Skip links and limit work.
async function importFolder(db, tenant, client, folder) {
  const s = service(db, tenant, client),
    root = await fs.realpath(folder),
    result = { importados: 0, duplicados: 0, errores: [] };
  let count = 0;
  async function walk(dir, depth) {
    if (depth > 8) throw new Error("Carpeta demasiado profunda");
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (++count > 10000)
        throw new Error(
          "Límite de archivos alcanzado; continúe desde el panel XML",
        );
      if (e.isSymbolicLink()) continue;
      const file = path.join(dir, e.name),
        real = await fs.realpath(file),
        relative = path.relative(root, real);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      if (e.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".xml")) continue;
      try {
        const info = await fs.stat(file);
        if (info.size > 2 * 1024 * 1024) throw new Error("XML mayor a 2 MB");
        const bytes = await fs.readFile(file),
          header = bytes.subarray(0, 200).toString("ascii");
        if (/encoding\s*=\s*["'](?!utf-8|UTF-8)/.test(header))
          throw new Error(
            "Codificación distinta de UTF-8: convertir y revisar antes de importar",
          );
        const r = s.importar(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        result[r.duplicado ? "duplicados" : "importados"]++;
      } catch (e) {
        result.errores.push({
          archivo: path.relative(root, file),
          mensaje: e.message,
        });
      }
    }
  }
  await walk(root, 0);
  return result;
}
module.exports = { importFolder };
