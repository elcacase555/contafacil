"use strict";
const { amount, period } = require("./money");
// Perfil base acotado. No valida padrones, CDR ni sustituye PVSIRE.
const versions = {
  RVIE: "RS112-2021-Anexo3-base",
  RCE: "RS040-2022-Anexo11-base",
};
function buildSire({
  libro,
  periodo,
  empresa,
  rows,
  originals,
  clasificacion,
}) {
  period(periodo);
  if (!versions[libro]) throw new Error("Seleccione RVIE o RCE");
  if (!empresa.nombre_cliente?.trim())
    throw new Error("Falta razón social legal de la empresa");
  const out = [],
    errors = [];
  const formatDate = (s) => s.split("-").reverse().join("/");
  const clean = (v) => {
    const s = String(v ?? "");
    if (/[|\r\n\x00]/.test(s))
      throw new Error("Texto contiene separadores no permitidos");
    if (s.length > 1500) throw new Error("Texto excede longitud SIRE");
    return s;
  };
  const filtered = rows.filter(
    (r) => r.direccion === (libro === "RVIE" ? "venta" : "compra"),
  );
  for (const r of filtered) {
    try {
      const d = r.datos;
      if (!r.revisado || r.estado_sunat === "sin_verificar")
        throw new Error("Falta revisión fiscal/estado SUNAT");
      if (d.warnings.length)
        throw new Error("Operación especial fuera del perfil base");
      if (r.moneda !== "PEN" || !["01", "03", "07", "08"].includes(r.tipo))
        throw new Error("Solo operaciones nacionales simples en PEN");
      if (r.fecha.slice(0, 7) > periodo)
        throw new Error("Emisión posterior al periodo de anotación");
      if (libro === "RCE" && r.estado_sunat !== "aceptado")
        throw new Error(
          "RCE requiere comprobantes aceptados; concilie exclusiones antes de exportar",
        );
      if (libro === "RCE" && d.motivo === "02")
        throw new Error(
          "Nota por error en RUC: requiere conciliación y exclusión del original",
        );
      if (libro === "RCE" && !/^[1-5]$/.test(clasificacion?.[r.id] ?? ""))
        throw new Error("Seleccione clasificación de bienes/servicios");
      if (d.references.length > 1)
        throw new Error("Notas múltiples fuera del perfil base");
      const ref = d.references[0];
      let original;
      if (ref) {
        original = originals.find(
          (o) =>
            o.emisor === r.emisor &&
            o.numero === ref.numero &&
            o.tipo === ref.tipo,
        );
        if (
          !original ||
          original.fecha > r.fecha ||
          original.receptor !== r.receptor ||
          original.moneda !== r.moneda
        )
          throw new Error("Original ausente o incompatible con la nota");
        if (!["01", "03"].includes(ref.tipo))
          throw new Error("Original fuera del perfil base");
      }
      const sign =
        r.estado_sunat === "aceptado" ? (r.tipo === "07" ? -1 : 1) : 0;
      const sum = (code) =>
        d.taxes
          .filter((t) => t.codigo === code)
          .reduce((s, t) => s + t.base, 0);
      const grav = sum("1000"),
        exo = sum("9997"),
        ina = sum("9998");
      if (grav + exo + ina !== r.base)
        throw new Error("Bases fiscales no concilian");
      const a = Array(libro === "RVIE" ? 33 : 37).fill("");
      const set = (n, v) => (a[n - 1] = clean(v)),
        amt = (n, v) => set(n, amount(v * sign));
      set(1, empresa.ruc);
      set(2, empresa.nombre_cliente);
      set(3, periodo.replace("-", ""));
      set(5, formatDate(r.fecha));
      set(7, r.tipo);
      const [serie, num] = r.numero.split("-");
      set(8, serie);
      if (libro === "RVIE") {
        set(9, num);
        set(11, d.receptor_tipo);
        set(12, r.receptor);
        set(13, d.receptor_nombre);
        if (!d.receptor_nombre)
          throw new Error("Falta nombre legal del receptor");
        for (let i = 14; i <= 26; i++) amt(i, 0);
        const prior = r.tipo === "07" && original.fecha.slice(0, 7) < periodo;
        amt(prior ? 16 : 15, grav);
        amt(prior ? 18 : 17, r.igv);
        amt(19, exo);
        amt(20, ina);
        amt(26, r.total);
        set(27, "PEN");
        if (original) {
          set(29, formatDate(original.fecha));
          set(30, original.tipo);
          set(31, original.numero.split("-")[0]);
          set(32, original.numero.split("-")[1]);
        }
      } else {
        set(10, num);
        set(12, d.emisor_tipo);
        set(13, r.emisor);
        set(14, d.emisor_nombre);
        if (!d.emisor_nombre) throw new Error("Falta razón social del emisor");
        for (let i = 15; i <= 25; i++) amt(i, 0);
        amt(r.credito_fiscal ? 15 : 19, grav);
        amt(r.credito_fiscal ? 16 : 20, r.igv);
        amt(21, exo + ina);
        amt(25, r.total);
        set(26, "PEN");
        if (original) {
          set(28, formatDate(original.fecha));
          set(29, original.tipo);
          set(30, original.numero.split("-")[0]);
          set(32, original.numero.split("-")[1]);
        }
        set(33, clasificacion[r.id]);
        amt(36, 0);
      }
      out.push(a.join("|"));
    } catch (e) {
      errors.push(`${r.tipo} ${r.numero}: ${e.message}`);
    }
  }
  if (errors.length)
    throw new Error("No se exportó un registro parcial. " + errors.join("; "));
  if (!out.length)
    throw new Error(
      "No hay documentos del libro en el periodo; no se infiere ausencia de operaciones",
    );
  return {
    contenido: out.join("\r\n") + "\r\n",
    version: versions[libro],
    filas: out.length,
    campos: libro === "RVIE" ? 33 : 37,
    archivo: `${empresa.ruc}-${libro}-${periodo.replace("-", "")}-preliminar.txt`,
    advertencia:
      "Perfil base: validar normativa aplicable y PVSIRE, conciliar propuesta SUNAT y renombrar según mecanismo de carga. No presentado.",
  };
}
module.exports = { buildSire, versions };
