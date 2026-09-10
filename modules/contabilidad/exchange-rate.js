"use strict";
const { date } = require("./money");
const { fiscalKey } = require("./conciliation");
const SERIES = "PD04640PD";
const SOURCE = "SBS — tipo de cambio venta, serie oficial BCRP PD04640PD";
const API = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api/";
const FOREIGN_WARNING =
  "Moneda extranjera: convertir mediante asiento manual con tipo de cambio documentado.";
const days = (s, n) =>
  new Date(Date.parse(s + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
function rateUnits(value) {
  const v = String(value);
  if (!/^\d{1,2}(\.\d{1,6})?$/.test(v) || Number(v) <= 0)
    throw new Error("Tipo de cambio SBS inválido");
  const [a, b = ""] = v.split(".");
  return BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
}
function convertCents(cents, rate) {
  if (!Number.isSafeInteger(cents)) throw new Error("Importe fuera de rango");
  const v = BigInt(Math.abs(cents)) * rateUnits(rate);
  const result = Number((v + 500000n) / 1000000n) * (cents < 0 ? -1 : 1);
  if (!Number.isSafeInteger(result))
    throw new Error("Importe convertido fuera de rango");
  return result;
}
function parseBcrp(text) {
  // Some official responses append a PHP diagnostic after a complete JSON object.
  // Extract only a balanced leading JSON object, never evaluate HTML or scripts.
  let depth = 0,
    quoted = false,
    escaped = false,
    end = -1;
  const input = text.trim();
  if (!input.startsWith("{"))
    throw new Error("La fuente SBS/BCRP no devolvió datos de cambio");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error("Respuesta SBS/BCRP incompleta");
  const data = JSON.parse(input.slice(0, end));
  if (
    data.config?.series?.length !== 1 ||
    !/SBS.*Venta/i.test(data.config.series[0].name) ||
    !Array.isArray(data.periods)
  )
    throw new Error("La respuesta no corresponde a la serie SBS venta");
  const months = {
    Ene: 1,
    Feb: 2,
    Mar: 3,
    Abr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Ago: 8,
    Sep: 9,
    Set: 9,
    Oct: 10,
    Nov: 11,
    Dic: 12,
  };
  const rows = new Map();
  for (const p of data.periods) {
    const match = /^(\d{2})\.([A-Za-z]{3})\.(\d{2}|\d{4})$/.exec(p.name);
    if (!match || !months[match[2]])
      throw new Error("Fecha de cotización SBS/BCRP no reconocida");
    const year = match[3].length === 2 ? "20" + match[3] : match[3];
    const fecha = date(
      `${year}-${String(months[match[2]]).padStart(2, "0")}-${match[1]}`,
    );
    if (p.values?.[0] === "n.d.") continue;
    rateUnits(p.values?.[0]);
    const venta = Number(p.values[0]);
    if (rows.has(fecha) && rows.get(fecha).venta !== venta)
      throw new Error("Cotizaciones SBS contradictorias");
    rows.set(fecha, { fecha, venta });
  }
  return [...rows.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}
function createExchangeClient({
  fetchImpl = fetch,
  today = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(
      new Date(),
    ),
} = {}) {
  return async function resolve(dates) {
    const requested = [...new Set(dates.map(date))].sort();
    if (!requested.length) return new Map();
    const current = today();
    const eligible = requested.filter((d) => d <= current);
    if (!eligible.length)
      throw new Error("Las fechas solicitadas aún no tienen cotización SBS");
    const start = days(eligible[0], -14),
      end = eligible.at(-1);
    const url = `${API}${SERIES}/json/${start}/${end}/esp`;
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        "No se pudo consultar el tipo de cambio SBS/BCRP (HTTP " +
          response.status +
          ")",
      );
    const text = await response.text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024)
      throw new Error("Respuesta SBS/BCRP demasiado grande");
    const rows = parseBcrp(text);
    if (rows.some((r) => r.fecha < start || r.fecha > end))
      throw new Error("SBS/BCRP devolvió otro rango de fechas");
    const result = new Map();
    for (const requestedDate of eligible) {
      const row = rows.findLast((r) => r.fecha <= requestedDate);
      // Do not turn an unexpectedly stale/missing series into a plausible conversion.
      if (!row || row.fecha < days(requestedDate, -7)) continue;
      result.set(requestedDate, {
        rate: row.venta,
        fecha: row.fecha,
        fechaOperacion: requestedDate,
        source: SOURCE,
        url,
        serie: SERIES,
        consultado: new Date().toISOString(),
      });
    }
    return result;
  };
}
async function prepareExchange(
  docs,
  { resolve = createExchangeClient(), references = [] } = {},
) {
  const originalDocs = new Map();
  for (const d of [...references, ...docs]) {
    const key = fiscalKey(d.emisor, d.tipo, d.numero);
    if (!originalDocs.has(key)) originalDocs.set(key, d);
    else if (originalDocs.get(key)?.sha256 !== d.sha256)
      originalDocs.set(key, null);
  }
  const dated = [],
    issues = [];
  const fail = (d, message) => {
    d.fx = null;
    d.warnings.push(message);
  };
  for (const d of docs) {
    if (d.moneda === "PEN") {
      d.fx = {
        rate: 1,
        fecha: d.fecha,
        fechaOperacion: d.fecha,
        source: "Moneda nacional",
        url: "",
      };
      continue;
    }
    d.warnings = d.warnings.filter((w) => w !== FOREIGN_WARNING);
    if (d.moneda !== "USD") {
      fail(
        d,
        `Conversión pendiente: moneda ${d.moneda} no cubierta por la serie USD/PEN.`,
      );
      continue;
    }
    let fecha = d.fecha;
    if (["07", "08"].includes(d.tipo)) {
      if (d.references.length !== 1) {
        fail(
          d,
          "Conversión pendiente: la nota requiere una única factura de referencia.",
        );
        continue;
      }
      const ref = d.references[0];
      let referenceKey;
      try {
        referenceKey = fiscalKey(d.emisor, ref.tipo, ref.numero);
      } catch {
        fail(
          d,
          "Conversión pendiente: la referencia de la nota no contiene una serie y número válidos.",
        );
        continue;
      }
      const original = originalDocs.get(referenceKey);
      if (originalDocs.has(referenceKey) && !original) {
        fail(
          d,
          "Conversión pendiente: existen XML distintos para la factura original.",
        );
        continue;
      }
      if (
        original &&
        (original.receptor !== d.receptor ||
          original.moneda !== d.moneda ||
          original.fecha > d.fecha ||
          (ref.fecha && ref.fecha !== original.fecha))
      ) {
        fail(
          d,
          "Conversión pendiente: la referencia no coincide con la factura original.",
        );
        continue;
      }
      fecha = original?.fecha || ref.fecha;
      if (!fecha || fecha > d.fecha) {
        fail(
          d,
          "Conversión pendiente: falta el XML o la fecha de emisión de la factura original de la nota.",
        );
        continue;
      }
    }
    dated.push({ d, fecha });
  }
  let rates = new Map(),
    failure;
  try {
    if (dated.length) rates = await resolve(dated.map((v) => v.fecha));
  } catch (e) {
    failure = "No se pudo obtener la cotización oficial SBS/BCRP. " + e.message;
  }
  for (const { d, fecha } of dated) {
    const fx = rates.get(fecha);
    if (!fx) {
      fail(
        d,
        failure ||
          `Conversión pendiente: no hay una cotización SBS verificable para ${fecha}.`,
      );
      continue;
    }
    try {
      rateUnits(fx.rate);
      if (date(fx.fecha) > fecha || !fx.url)
        throw new Error("Cotización sin fecha/fuente válida");
      d.fx = { ...fx, fechaOperacion: fecha };
      d.pen = Object.fromEntries(
        ["base", "igv", "total"].map((k) => [k, convertCents(d[k], fx.rate)]),
      );
    } catch (e) {
      fail(d, "Conversión pendiente: " + e.message);
    }
  }
  for (const d of docs)
    for (const mensaje of d.warnings)
      issues.push({ etapa: "xml", documento: d.numero, mensaje });
  return issues;
}
module.exports = {
  createExchangeClient,
  parseBcrp,
  prepareExchange,
  convertCents,
  SOURCE,
  SERIES,
};
