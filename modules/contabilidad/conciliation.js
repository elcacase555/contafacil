"use strict";
const { cents, date } = require("./money");
const norm = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function fiscalKey(emisor, tipo, numero) {
  const [serie, n] = numero.split("-");
  if (!serie || !/^\d+$/.test(n)) throw new Error("Número fiscal inválido");
  return [
    emisor,
    tipo.padStart(2, "0"),
    serie.toUpperCase(),
    BigInt(n).toString(),
  ].join("|");
}
// Official RVIE/RCE TXT proposal: the first 33/37 fields follow the annex layout.
// Additional SUNAT diagnostic fields are retained in raw, never interpreted as acceptance.
function parseSire(text, libro, ruc, periodo) {
  if (!["RVIE", "RCE"].includes(libro)) throw new Error("Libro SIRE inválido");
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length)
    throw new Error("Archivo SIRE vacío: no equivale a sin operaciones");
  const out = [];
  let header = false;
  for (const [i, line] of lines.entries()) {
    const row = line.split("|").map((v) => v.trim());
    if (i === 0 && norm(row[0]) === "ruc") {
      if (
        row.length < (libro === "RVIE" ? 33 : 37) ||
        norm(row[2]) !== "periodo"
      )
        throw new Error("Cabecera SIRE incompleta");
      header = true;
      continue;
    }
    if (row.length < (libro === "RVIE" ? 33 : 37))
      throw new Error("Estructura TXT SIRE no reconocida en fila " + (i + 1));
    if (row[0] !== ruc || row[2] !== periodo)
      throw new Error("SIRE pertenece a otro RUC o periodo");
    const type = row[6].padStart(2, "0"),
      number = row[7] + "-" + row[libro === "RVIE" ? 8 : 9];
    const rawDate = row[4];
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate))
      throw new Error("Fecha SIRE inválida");
    const fecha = date(rawDate.split("/").reverse().join("-"));
    const get = (n) => cents(row[n - 1] || "0");
    const emisor = libro === "RVIE" ? ruc : row[12],
      receptor = libro === "RVIE" ? row[11] : ruc;
    const base =
      libro === "RVIE"
        ? get(14) + get(15) + get(16) + get(19) + get(20)
        : get(15) + get(17) + get(19) + get(21);
    const igv =
      libro === "RVIE" ? get(17) + get(18) : get(16) + get(18) + get(20);
    const total = get(libro === "RVIE" ? 26 : 25),
      moneda = row[libro === "RVIE" ? 26 : 25];
    out.push({
      key: fiscalKey(emisor, type, number),
      libro,
      periodo,
      emisor,
      receptor,
      tipo: type,
      numero: number,
      fecha,
      moneda,
      base,
      igv,
      total,
      car: row[3],
      raw: row,
    });
  }
  if (!out.length && !header) throw new Error("Archivo SIRE sin estructura");
  const keys = new Set();
  for (const r of out) {
    if (keys.has(r.key))
      throw new Error("SIRE contiene claves fiscales duplicadas");
    keys.add(r.key);
  }
  return out;
}
function reconcile(docs, sire, desde, hasta, available) {
  const included = sire.filter((r) => r.fecha >= desde && r.fecha <= hasta),
    map = new Map(),
    results = [];
  for (const r of included) {
    const key = r.libro + ":" + r.key;
    map.set(key, [...(map.get(key) || []), r]);
  }
  for (const d of docs.filter((r) => r.fecha >= desde && r.fecha <= hasta)) {
    const key = fiscalKey(d.emisor, d.tipo, d.numero),
      libro = d.direccion === "venta" ? "RVIE" : "RCE",
      candidates = map.get(libro + ":" + key) || [],
      s = candidates[0],
      scope = libro + ":" + d.fecha.slice(0, 7).replace("-", "");
    const sign = d.tipo === "07" ? -1 : 1;
    const dif = s
      ? ["base", "igv", "total"]
          .filter((k) => d[k] * sign !== s[k])
          .concat(["moneda", "receptor", "fecha"].filter((k) => d[k] !== s[k]))
      : [];
    results.push({
      xmlId: d.id,
      key,
      libro,
      numero: d.numero,
      estado: s
        ? dif.length
          ? "diferencia"
          : "coincide"
        : available.includes(scope)
          ? "solo_xml"
          : "sire_no_disponible",
      detalle:
        candidates.length > 1
          ? "Documento repetido en varios periodos SIRE"
          : dif.join(", "),
      xmlTotal: d.total * sign,
      sireTotal: s?.total ?? null,
      moneda: d.moneda,
    });
    if (candidates.length > 1) results.at(-1).estado = "sire_duplicado";
    map.delete(libro + ":" + key);
  }
  for (const s of [...map.values()].flat())
    results.push({
      key: s.key,
      libro: s.libro,
      numero: s.numero,
      estado: "solo_sire",
      detalle: "Falta XML: no se inventó un asiento",
      xmlTotal: null,
      sireTotal: s.total,
      moneda: s.moneda,
    });
  return results;
}
module.exports = { parseSire, reconcile, fiscalKey };
