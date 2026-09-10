"use strict";
const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { createHash } = require("crypto");
const { cents, date } = require("./money");
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v) =>
  String(v && typeof v === "object" ? (v["#text"] ?? "") : (v ?? ""));
function parseUBL(xml, ruc) {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > 2 * 1024 * 1024)
    throw new Error("XML vacío o mayor a 2 MB");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("No se permiten DTD ni entidades XML");
  if (XMLValidator.validate(xml) !== true) throw new Error("XML mal formado");
  // Resolve namespace URIs (prefix names are not significant in UBL).
  const raw = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
  }).parse(xml);
  const rootKey = Object.keys(raw).filter((k) => !k.startsWith("?"));
  if (rootKey.length !== 1) throw new Error("Se requiere un documento UBL");
  const key = rootKey[0],
    kind = key.split(":").pop(),
    root = raw[key];
  if (!["Invoice", "CreditNote", "DebitNote"].includes(kind))
    throw new Error("Solo Invoice, CreditNote y DebitNote UBL 2.1");
  const ns = {};
  for (const [k, v] of Object.entries(root))
    if (k.startsWith("@_xmlns")) ns[k === "@_xmlns" ? "" : k.slice(8)] = v;
  if (
    ns[key.includes(":") ? key.split(":")[0] : ""] !==
    `urn:oasis:names:specification:ubl:schema:xsd:${kind}-2`
  )
    throw new Error("Namespace raíz UBL inválido");
  const expected = {
    cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  };
  function normalize(obj, scope) {
    if (Array.isArray(obj)) return obj.map((v) => normalize(v, scope));
    if (!obj || typeof obj !== "object") return obj;
    const local = { ...scope };
    for (const [k, v] of Object.entries(obj))
      if (k.startsWith("@_xmlns")) local[k === "@_xmlns" ? "" : k.slice(8)] = v;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("@_") || k === "#text") {
        out[k] = v;
        continue;
      }
      const p = k.includes(":") ? k.split(":")[0] : "",
        name = k.split(":").pop();
      const prefix = Object.keys(expected).find(
        (x) => expected[x] === local[p],
      );
      if (prefix) out[prefix + ":" + name] = normalize(v, local);
    }
    return out;
  }
  const d = normalize(root, ns);
  if (text(d["cbc:UBLVersionID"]) !== "2.1")
    throw new Error("Se requiere UBL 2.1");
  function party(k) {
    const p = d[k]?.["cac:Party"];
    const id = list(p?.["cac:PartyIdentification"])
      .map((x) => x["cbc:ID"])
      .find(Boolean);
    return {
      id: text(id),
      tipo: String(id?.["@_schemeID"] ?? ""),
      nombre: text(p?.["cac:PartyLegalEntity"]?.["cbc:RegistrationName"]),
    };
  }
  const em = party("cac:AccountingSupplierParty"),
    re = party("cac:AccountingCustomerParty");
  if (em.tipo !== "6" || !/^\d{11}$/.test(em.id) || !re.id || !re.tipo)
    throw new Error("Identificación del emisor/receptor incompleta");
  if ((em.id === ruc) === (re.id === ruc))
    throw new Error("El cliente debe ser únicamente emisor o receptor");
  const moneda = text(d["cbc:DocumentCurrencyCode"]);
  if (!/^[A-Z]{3}$/.test(moneda)) throw new Error("Moneda inválida");
  function money(v) {
    if (v === undefined) throw new Error("Importe requerido ausente");
    if (v?.["@_currencyID"] && v["@_currencyID"] !== moneda)
      throw new Error("Monedas inconsistentes");
    return cents(text(v));
  }
  const tipo =
    kind === "Invoice"
      ? text(d["cbc:InvoiceTypeCode"])
      : kind === "CreditNote"
        ? "07"
        : "08";
  if (!["01", "03", "07", "08"].includes(tipo))
    throw new Error("Tipo de comprobante no soportado");
  const normalizeNumber = (v) =>
    text(v)
      .trim()
      .replace(/\s*-\s*/g, "-");
  const numero = normalizeNumber(d["cbc:ID"]);
  if (!/^[A-Z0-9]{4}-\d{1,8}$/.test(numero))
    throw new Error("Serie-número inválido");
  const totals =
    d[
      kind === "DebitNote"
        ? "cac:RequestedMonetaryTotal"
        : "cac:LegalMonetaryTotal"
    ];
  const base = money(totals?.["cbc:LineExtensionAmount"]),
    total = money(totals?.["cbc:PayableAmount"]);
  const taxes = list(d["cac:TaxTotal"])
    .flatMap((t) => list(t["cac:TaxSubtotal"]))
    .map((t) => ({
      codigo: text(t["cac:TaxCategory"]?.["cac:TaxScheme"]?.["cbc:ID"]),
      base: money(t["cbc:TaxableAmount"]),
      importe: money(t["cbc:TaxAmount"]),
    }));
  if (!taxes.length) throw new Error("Falta desglose de tributos");
  const igv = taxes
    .filter((t) => t.codigo === "1000")
    .reduce((s, t) => s + t.importe, 0);
  const warnings = [];
  if (taxes.reduce((s, t) => s + t.base, 0) !== base)
    warnings.push(
      "Las bases de tributos no coinciden con las líneas; requiere revisión manual.",
    );
  if (
    list(d["cac:TaxTotal"]).reduce(
      (s, t) => s + money(t["cbc:TaxAmount"]),
      0,
    ) !== taxes.reduce((s, t) => s + t.importe, 0)
  )
    warnings.push("El total de impuestos no concilia con el desglose.");
  if (moneda !== "PEN")
    warnings.push(
      "Moneda extranjera: convertir mediante asiento manual con tipo de cambio documentado.",
    );
  if (taxes.some((t) => !["1000", "9997", "9998"].includes(t.codigo)))
    warnings.push("Tributos/operaciones especiales: requieren asiento manual.");
  if (base + igv !== total || base < 0 || igv < 0 || total <= 0)
    warnings.push(
      "Anticipos, descuentos, cargos o totales especiales: requiere conciliación manual.",
    );
  if (
    list(d["cac:AllowanceCharge"]).length ||
    list(d["cac:PrepaidPayment"]).length
  )
    warnings.push("Descuentos/cargos o anticipos requieren revisión manual.");
  const references = list(d["cac:BillingReference"]).map((v) => ({
    numero: normalizeNumber(v["cac:InvoiceDocumentReference"]?.["cbc:ID"]),
    tipo: text(v["cac:InvoiceDocumentReference"]?.["cbc:DocumentTypeCode"]),
    fecha: v["cac:InvoiceDocumentReference"]?.["cbc:IssueDate"]
      ? date(text(v["cac:InvoiceDocumentReference"]["cbc:IssueDate"]))
      : null,
  }));
  if (
    kind !== "Invoice" &&
    (!references.length || references.some((r) => !r.numero || !r.tipo))
  )
    throw new Error("Nota sin referencia al comprobante original");
  const lines = list(
    d[
      "cac:" +
        {
          Invoice: "InvoiceLine",
          CreditNote: "CreditNoteLine",
          DebitNote: "DebitNoteLine",
        }[kind]
    ],
  ).map((l) => ({
    descripcion: text(l["cac:Item"]?.["cbc:Description"]),
    base: money(l["cbc:LineExtensionAmount"]),
  }));
  if (!lines.length) throw new Error("Comprobante sin líneas");
  if (lines.reduce((s, l) => s + l.base, 0) !== base)
    warnings.push("La suma de líneas no coincide con el subtotal.");
  return {
    tipo,
    numero,
    emisor: em.id,
    receptor: re.id,
    emisor_tipo: em.tipo,
    receptor_tipo: re.tipo,
    emisor_nombre: em.nombre,
    receptor_nombre: re.nombre,
    direccion: em.id === ruc ? "venta" : "compra",
    fecha: date(text(d["cbc:IssueDate"])),
    moneda,
    base,
    igv,
    total,
    original: references[0]?.numero ?? null,
    references,
    taxes,
    lines,
    warnings,
    motivo: text(d["cac:DiscrepancyResponse"]?.["cbc:ResponseCode"]),
    sha256: createHash("sha256").update(xml).digest("hex"),
  };
}
module.exports = { parseUBL };
