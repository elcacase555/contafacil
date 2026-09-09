"use strict";
const fs = require("fs/promises"),
  path = require("path"),
  crypto = require("crypto");
const { parseUBL } = require("./parser"),
  { fiscalKey } = require("./conciliation");
const { simulationBook, invoiceBook, NOTICE } = require("./simulation-excel");
const label = (s) =>
  String(s)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 70) || "Empresa";
async function simulate({
  empresa,
  desde,
  hasta,
  months,
  destination,
  id,
  credentials,
  accounts,
  rules,
  progress,
  download,
}) {
  const parent = await fs.realpath(destination);
  if (!(await fs.stat(parent)).isDirectory())
    throw new Error("El destino debe ser una carpeta");
  const output = path.join(
    parent,
    `${label(empresa.nombre_cliente)} ${empresa.ruc} ${desde} a ${hasta} ${id.slice(0, 8)}`,
  );
  await fs.mkdir(output); // Deliberately exclusive: never replace a previous accountant's work.
  const issues = [],
    docs = [],
    seen = new Map();
  const folders = [
    "Registros/Ventas",
    "Registros/Compras",
    "Libro Diario",
    "Libro Mayor",
    "Estados financieros",
  ];
  for (const type of ["Facturas", "Notas de credito", "Notas de debito"])
    for (const direction of ["Emitidas", "Recibidas"])
      for (const format of ["XML", "PDF", "Excel"])
        folders.push(`Comprobantes de pago/${type}/${direction}/${format}`);
  for (const dir of folders)
    await fs.mkdir(path.join(output, dir), { recursive: true });
  try {
    await download(credentials, months, output, (event) => {
      progress(event?.mensaje || "Descargando comprobantes…");
      if (event?.etapa?.endsWith("_error"))
        issues.push({ etapa: "descarga", mensaje: event.mensaje });
    });
  } catch {
    issues.push({
      etapa: "descarga",
      mensaje:
        "El motor no completó la descarga SUNAT. Los archivos disponibles se procesaron; revise la integridad del rango.",
    });
  }
  let pdf = 0,
    count = 0;
  async function walk(dir, depth = 0) {
    if (depth > 8) throw new Error("Estructura de carpetas demasiado profunda");
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++count > 20000) throw new Error("Demasiados archivos en el rango");
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (entry.name.toLowerCase().endsWith(".pdf")) pdf++;
      if (!entry.name.toLowerCase().endsWith(".xml")) continue;
      try {
        if ((await fs.stat(file)).size > 2 * 1024 * 1024)
          throw new Error("XML mayor a 2 MB");
        const text = require("./xml-encoding").decodeXml(
          await fs.readFile(file),
        );
        const d = parseUBL(text, empresa.ruc);
        if (d.fecha < desde || d.fecha > hasta)
          throw new Error("XML fuera del rango: excluido de los reportes");
        d.key = fiscalKey(d.emisor, d.tipo, d.numero);
        d.archivo = path.relative(output, file);
        if (seen.has(d.key)) {
          if (seen.get(d.key) !== d.sha256) {
            docs
              .find((item) => item.key === d.key)
              .warnings.push("Conflicto: misma clave fiscal con XML diferente");
            throw new Error(
              "Misma clave fiscal con XML diferente: revisar conflicto",
            );
          }
          continue;
        }
        seen.set(d.key, d.sha256);
        docs.push(d);
        for (const warning of d.warnings)
          issues.push({ etapa: "xml", documento: d.numero, mensaje: warning });
      } catch (e) {
        issues.push({
          etapa: "xml",
          documento: path.relative(output, file),
          mensaje: e.message,
        });
      }
    }
  }
  await walk(path.join(output, "Comprobantes de pago"));
  docs.sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.key.localeCompare(b.key),
  );
  if (pdf < docs.length)
    issues.push({
      etapa: "pdf",
      mensaje: `Se encontraron ${pdf} PDF para ${docs.length} XML únicos. Revise los PDF faltantes.`,
    });
  if (!docs.length)
    issues.push({
      etapa: "xml",
      mensaje: "No hay XML válidos. Esto no confirma ausencia de operaciones.",
    });
  for (const d of docs) {
    const kind =
        d.tipo === "07"
          ? "Notas de credito"
          : d.tipo === "08"
            ? "Notas de debito"
            : "Facturas",
      direction = d.direccion === "venta" ? "Emitidas" : "Recibidas";
    const excel = path.join(
      output,
      "Comprobantes de pago",
      kind,
      direction,
      "Excel",
      label(d.emisor + "-" + d.tipo + "-" + d.numero) + ".xlsx",
    );
    await fs.writeFile(excel, await invoiceBook(d));
  }
  progress("Generando registros, libros y estados con fórmulas…");
  const data = { empresa, desde, hasta, docs, accounts, rules, issues },
    files = [];
  for (const [name, focus] of [
    ["Registros/Ventas/Registro ventas.xlsx", "Registro ventas"],
    ["Registros/Compras/Registro compras.xlsx", "Registro compras"],
    ["Libro Diario/Libro Diario.xlsx", "Diario"],
    ["Libro Mayor/Libro Mayor.xlsx", "Mayor"],
    ["Estados financieros/Estados financieros.xlsx", "Dashboard"],
  ]) {
    await fs.writeFile(
      path.join(output, name),
      await simulationBook(data, focus),
    );
    files.push(name);
  }
  await fs.writeFile(
    path.join(output, "LEER PRIMERO.txt"),
    NOTICE +
      "\r\n\r\n" +
      "Los archivos son autónomos: cambios en uno no se sincronizan con los demás ni con ContaFácil. Use Estados financieros como archivo principal.\r\n" +
      "Incluye únicamente los XML de esta descarga. Complete saldos iniciales y ajustes. No se consultó SIRE ni se contabilizó en la aplicación.\r\n\r\n" +
      issues
        .map((i) => (i.documento || i.etapa) + ": " + i.mensaje)
        .join("\r\n"),
    "utf8",
  );
  return {
    carpeta: output,
    archivos: files,
    documentos: docs.length,
    pdf,
    propuestos: docs.filter((d) => d.moneda === "PEN" && !d.warnings.length)
      .length,
    contabilizados: 0,
    simulacion: true,
    aviso: NOTICE,
    observaciones: issues,
  };
}
module.exports = { simulate, label };
