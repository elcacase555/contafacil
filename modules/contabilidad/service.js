"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseUBL } = require("./parser");
const { cents, amount, rate, date, period } = require("./money");
const ACCOUNTS = [
  ["101", "Caja", "activo", "Efectivo"],
  ["1041", "Cuentas corrientes operativas", "activo", "Efectivo"],
  ["1212", "Facturas emitidas en cartera", "activo", "Cuentas por cobrar"],
  ["20111", "Mercaderías al costo", "activo", "Inventarios"],
  ["33311", "Maquinaria al costo", "activo", "Propiedad planta y equipo"],
  ["40111", "IGV cuenta propia", "pasivo", "Tributos por pagar"],
  ["4212", "Facturas emitidas por pagar", "pasivo", "Cuentas por pagar"],
  ["5011", "Acciones", "patrimonio", "Capital"],
  ["5911", "Utilidades acumuladas", "patrimonio", "Resultados acumulados"],
  ["5921", "Pérdidas acumuladas", "patrimonio", "Resultados acumulados"],
  ["6011", "Mercaderías", "gasto", "Compras"],
  ["6111", "Variación de mercaderías", "ingreso", "Variación de existencias"],
  [
    "6399",
    "Otros servicios prestados por terceros",
    "gasto",
    "Servicios de terceros",
  ],
  ["69111", "Costo de ventas de mercaderías", "gasto", "Costo de ventas"],
  ["70111", "Venta de mercaderías a terceros", "ingreso", "Ventas"],
  ["7041", "Prestación de servicios a terceros", "ingreso", "Servicios"],
];
function migrate(db) {
  db.pragma("foreign_keys = ON");
  db.transaction(() =>
    db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8")),
  )();
}
function service(db, tenant, client) {
  const c = db
    .prepare(
      "SELECT id,ruc,nombre_cliente FROM clientes_sunat WHERE contador_id=? AND id=?",
    )
    .get(tenant, client);
  if (!c)
    throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
  const scope = [tenant, client];
  const all = (sql, ...args) => db.prepare(sql).all(...scope, ...args);
  const get = (sql, ...args) => db.prepare(sql).get(...scope, ...args);
  const run = (sql, ...args) => db.prepare(sql).run(...scope, ...args);
  const audit = (event, data) =>
    run(
      "INSERT INTO ct_auditoria(contador_id,cliente_id,evento,detalle) VALUES(?,?,?,?)",
      event,
      JSON.stringify(data),
    );
  const ensure = (p) => {
    period(p);
    run(
      "INSERT OR IGNORE INTO ct_periodos(contador_id,cliente_id,periodo) VALUES(?,?,?)",
      p,
    );
  };
  const open = (p) => {
    ensure(p);
    if (
      get(
        "SELECT cerrado FROM ct_periodos WHERE contador_id=? AND cliente_id=? AND periodo=?",
        p,
      ).cerrado
    )
      throw new Error("Periodo cerrado");
  };
  db.transaction(() => {
    for (const a of ACCOUNTS)
      run(
        "INSERT OR IGNORE INTO ct_cuentas(contador_id,cliente_id,codigo,nombre,clase,rubro) VALUES(?,?,?,?,?,?)",
        ...a,
      );
  })();
  function entry(id) {
    const a = get(
      "SELECT * FROM ct_asientos WHERE contador_id=? AND cliente_id=? AND id=?",
      id,
    );
    if (!a)
      throw Object.assign(new Error("Asiento no encontrado"), { status: 404 });
    return {
      ...a,
      apuntes: all(
        "SELECT * FROM ct_apuntes WHERE contador_id=? AND cliente_id=? AND asiento_id=? ORDER BY linea",
        id,
      ),
    };
  }
  function lines(id, rows) {
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > 200)
      throw new Error("Se requieren de 2 a 200 apuntes");
    for (const [i, p] of rows.entries()) {
      if (
        !Number.isSafeInteger(p.debe) ||
        !Number.isSafeInteger(p.haber) ||
        p.debe < 0 ||
        p.haber < 0 ||
        p.debe > 1e13 ||
        p.haber > 1e13
      )
        throw new Error("Importes inválidos");
      if (
        !get(
          "SELECT codigo FROM ct_cuentas WHERE contador_id=? AND cliente_id=? AND codigo=?",
          p.cuenta,
        )
      )
        throw new Error("Cuenta no encontrada");
      run(
        "INSERT INTO ct_apuntes(contador_id,cliente_id,asiento_id,linea,cuenta,debe,haber) VALUES(?,?,?,?,?,?,?)",
        id,
        i + 1,
        p.cuenta,
        p.debe,
        p.haber,
      );
    }
  }
  function create(data) {
    date(data.fecha);
    const p = data.fecha.slice(0, 7);
    open(p);
    if (
      typeof data.glosa !== "string" ||
      !data.glosa.trim() ||
      data.glosa.length > 500
    )
      throw new Error("Glosa requerida (hasta 500 caracteres)");
    const result = run(
      "INSERT INTO ct_asientos(contador_id,cliente_id,comprobante_id,periodo,fecha,glosa,clase,reversion_de,clave,regla) VALUES(?,?,?,?,?,?,?,?,?,?)",
      data.comprobante_id ?? null,
      p,
      data.fecha,
      data.glosa,
      data.clase ?? "operacion",
      data.reversion_de ?? null,
      data.clave ?? crypto.randomUUID(),
      data.regla ?? null,
    );
    const id = Number(result.lastInsertRowid);
    lines(id, data.apuntes);
    audit("borrador_creado", { id });
    return entry(id);
  }
  // Named parameters avoid accidental placement of the tenant predicates.
  function financial(cut) {
    date(cut);
    const balances = db
      .prepare(
        `SELECT c.codigo,c.nombre,c.clase,c.rubro,COALESCE(sum(m.debe),0) debe,COALESCE(sum(m.haber),0) haber,
   COALESCE(sum(CASE WHEN m.fecha>=@inicio AND m.clase='operacion' THEN m.debe-m.haber ELSE 0 END),0) ejercicio
   FROM ct_cuentas c LEFT JOIN ct_mayor m ON m.contador_id=c.contador_id AND m.cliente_id=c.cliente_id AND m.cuenta=c.codigo AND m.fecha<=@corte
   WHERE c.contador_id=@tenant AND c.cliente_id=@client GROUP BY c.codigo,c.nombre,c.clase,c.rubro ORDER BY c.codigo`,
      )
      .all({ tenant, client, inicio: cut.slice(0, 4) + "-01-01", corte: cut });
    let activo = 0,
      pasivo = 0,
      patrimonio = 0,
      resultadoPendiente = 0,
      ingresos = 0,
      gastos = 0,
      control = 0;
    for (const r of balances) {
      r.saldo = r.debe - r.haber;
      r.clasePresentacion =
        r.codigo === "40111" && r.saldo > 0 ? "activo" : r.clase;
      r.rubroPresentacion =
        r.codigo === "40111" && r.saldo > 0 ? "Crédito fiscal IGV" : r.rubro;
      if (r.clasePresentacion === "activo") activo += r.saldo;
      else if (r.clasePresentacion === "pasivo") pasivo -= r.saldo;
      else if (r.clase === "patrimonio") patrimonio -= r.saldo;
      else if (r.clase === "control") control += r.saldo;
      else {
        resultadoPendiente -= r.saldo;
        if (r.clase === "ingreso") ingresos -= r.ejercicio;
        else gastos += r.ejercicio;
      }
    }
    const situacion = new Map(),
      resultados = new Map();
    for (const r of balances) {
      if (["activo", "pasivo", "patrimonio"].includes(r.clasePresentacion)) {
        const key = r.clasePresentacion + ":" + r.rubroPresentacion;
        const item = situacion.get(key) || {
          clase: r.clasePresentacion,
          rubro: r.rubroPresentacion,
          importe: 0,
        };
        item.importe += r.saldo * (r.clasePresentacion === "activo" ? 1 : -1);
        situacion.set(key, item);
      }
      if (["ingreso", "gasto"].includes(r.clase)) {
        const key = r.clase + ":" + r.rubro;
        const item = resultados.get(key) || {
          clase: r.clase,
          rubro: r.rubro,
          importe: 0,
        };
        item.importe += r.ejercicio * (r.clase === "ingreso" ? -1 : 1);
        resultados.set(key, item);
      }
    }
    return {
      corte: cut,
      moneda: "PEN",
      balance: balances,
      activo,
      pasivo,
      patrimonio,
      resultadoPendiente,
      ingresos,
      gastos,
      utilidad: ingresos - gastos,
      diferencia: activo - pasivo - patrimonio - resultadoPendiente,
      control,
      situacion: [...situacion.values()],
      resultados: [...resultados.values()],
      advertencia:
        "Estados preliminares: requieren saldos de apertura, inventarios, bancos, planillas, ajustes y revisión del contador.",
    };
  }
  return {
    cliente: c,
    cuentas: () =>
      all(
        "SELECT * FROM ct_cuentas WHERE contador_id=? AND cliente_id=? ORDER BY codigo",
      ),
    cuenta: (data) => {
      if (
        !/^\d{2,10}$/.test(data.codigo) ||
        typeof data.nombre !== "string" ||
        !data.nombre.trim() ||
        !data.rubro
      )
        throw new Error("Cuenta inválida");
      run(
        "INSERT INTO ct_cuentas(contador_id,cliente_id,codigo,nombre,clase,rubro) VALUES(?,?,?,?,?,?)",
        data.codigo,
        data.nombre,
        data.clase,
        data.rubro,
      );
      audit("cuenta_creada", { codigo: data.codigo });
    },
    importar: (xml) =>
      db.transaction(() => {
        const d = parseUBL(xml, c.ruc),
          existing = get(
            "SELECT id,sha256 FROM ct_comprobantes WHERE contador_id=? AND cliente_id=? AND emisor=? AND tipo=? AND numero=?",
            d.emisor,
            d.tipo,
            d.numero,
          );
        if (existing) {
          if (existing.sha256 !== d.sha256)
            throw new Error(
              "La clave fiscal ya existe con otro XML. Concilie la diferencia; no se sobrescribió.",
            );
          return { id: existing.id, duplicado: true };
        }
        ensure(d.fecha.slice(0, 7));
        const result = run(
          "INSERT INTO ct_comprobantes(contador_id,cliente_id,tipo,numero,emisor,receptor,direccion,fecha,moneda,base,igv,total,original,sha256,xml,datos) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          d.tipo,
          d.numero,
          d.emisor,
          d.receptor,
          d.direccion,
          d.fecha,
          d.moneda,
          d.base,
          d.igv,
          d.total,
          d.original,
          d.sha256,
          xml,
          JSON.stringify(d),
        );
        const id = Number(result.lastInsertRowid);
        run(
          "INSERT INTO ct_registros(contador_id,cliente_id,comprobante_id,periodo) VALUES(?,?,?,?)",
          id,
          d.fecha.slice(0, 7),
        );
        audit("xml_importado", { id, sha256: d.sha256 });
        return { id, duplicado: false, advertencias: d.warnings };
      })(),
    comprobantes: () =>
      all(
        "SELECT id,tipo,numero,emisor,receptor,direccion,fecha,moneda,base,igv,total,datos FROM ct_comprobantes WHERE contador_id=? AND cliente_id=? ORDER BY fecha DESC,id DESC",
      ).map((x) => ({ ...x, datos: JSON.parse(x.datos) })),
    proponer: (id, options) =>
      db.transaction(() => {
        const row = get(
          "SELECT * FROM ct_comprobantes WHERE contador_id=? AND cliente_id=? AND id=?",
          id,
        );
        if (!row) throw new Error("Comprobante no encontrado");
        const d = JSON.parse(row.datos);
        if (d.warnings.length) throw new Error(d.warnings.join(" "));
        const old = get(
          "SELECT id FROM ct_asientos WHERE contador_id=? AND cliente_id=? AND clave=?",
          "xml:" + id,
        );
        if (old) return entry(old.id);
        for (const ref of d.references) {
          const original = get(
            "SELECT * FROM ct_comprobantes WHERE contador_id=? AND cliente_id=? AND emisor=? AND numero=? AND tipo=?",
            d.emisor,
            ref.numero,
            ref.tipo,
          );
          if (!original)
            throw new Error(
              "Importe primero el comprobante original de la nota",
            );
          if (
            original.receptor !== d.receptor ||
            original.moneda !== d.moneda ||
            original.fecha > d.fecha
          )
            throw new Error(
              "La nota no coincide con receptor, moneda o fecha del original",
            );
        }
        const purchase = d.direccion === "compra";
        const account = get(
          "SELECT * FROM ct_cuentas WHERE contador_id=? AND cliente_id=? AND codigo=?",
          options.cuenta,
        );
        if (
          !account ||
          !(purchase ? ["gasto", "activo"] : ["ingreso"]).includes(
            account.clase,
          )
        )
          throw new Error(
            "Seleccione una cuenta de gasto/activo para compra o ingreso para venta",
          );
        const credit = purchase && options.creditoFiscal === true;
        const base = purchase && !credit ? d.base + d.igv : d.base;
        const rows = [];
        const add = (cuenta, debe, haber) => {
          if (debe || haber) rows.push({ cuenta, debe, haber });
        };
        if (purchase) {
          add(account.codigo, base, 0);
          if (credit) add("40111", d.igv, 0);
          add("4212", 0, d.total);
        } else {
          add("1212", d.total, 0);
          add(account.codigo, 0, base);
          add("40111", 0, d.igv);
        }
        if (d.tipo === "07")
          for (const r of rows) [r.debe, r.haber] = [r.haber, r.debe];
        return create({
          fecha: options.fecha || d.fecha,
          glosa: `${d.direccion} ${d.tipo} ${d.numero}`,
          comprobante_id: id,
          clave: "xml:" + id,
          regla: "UBL-simple-PEN-v1",
          apuntes: rows,
        });
      })(),
    asientos: () =>
      all(
        "SELECT * FROM ct_asientos WHERE contador_id=? AND cliente_id=? ORDER BY fecha DESC,id DESC",
      ).map((a) => entry(a.id)),
    manual: (data) =>
      db.transaction(() =>
        create({
          ...data,
          comprobante_id: null,
          reversion_de: null,
          clave: crypto.randomUUID(),
          regla: "manual",
          apuntes: data.apuntes.map((p) => ({
            cuenta: p.cuenta,
            debe: cents(p.debe),
            haber: cents(p.haber),
          })),
        }),
      )(),
    editar: (id, rows) =>
      db.transaction(() => {
        const a = entry(id);
        if (a.estado !== "borrador")
          throw new Error("Solo puede editar borradores");
        open(a.periodo);
        run(
          "DELETE FROM ct_apuntes WHERE contador_id=? AND cliente_id=? AND asiento_id=?",
          id,
        );
        lines(
          id,
          rows.map((p) => ({
            cuenta: p.cuenta,
            debe: cents(p.debe),
            haber: cents(p.haber),
          })),
        );
        audit("borrador_editado", { id });
        return entry(id);
      })(),
    contabilizar: (id) =>
      db.transaction(() => {
        const a = entry(id);
        if (a.estado === "contabilizado") return a;
        open(a.periodo);
        run(
          "UPDATE ct_asientos SET estado='contabilizado',aprobado_en=CURRENT_TIMESTAMP WHERE contador_id=? AND cliente_id=? AND id=?",
          id,
        );
        audit("contabilizado", { id });
        return entry(id);
      })(),
    revertir: (id, fecha) =>
      db.transaction(() => {
        const a = entry(id);
        if (a.estado !== "contabilizado")
          throw new Error("Solo se revierte un asiento contabilizado");
        return create({
          fecha,
          glosa: "Reversión: " + a.glosa,
          reversion_de: id,
          clave: "reversion:" + id,
          clase: a.clase,
          apuntes: a.apuntes.map((p) => ({
            cuenta: p.cuenta,
            debe: p.haber,
            haber: p.debe,
          })),
        });
      })(),
    periodo: (p, cerrado) =>
      db.transaction(() => {
        ensure(p);
        if (
          cerrado &&
          get(
            "SELECT count(*) n FROM ct_asientos WHERE contador_id=? AND cliente_id=? AND periodo=? AND estado='borrador'",
            p,
          ).n
        )
          throw new Error("Hay borradores pendientes en el periodo");
        db.prepare(
          "UPDATE ct_periodos SET cerrado=? WHERE contador_id=? AND cliente_id=? AND periodo=?",
        ).run(cerrado ? 1 : 0, ...scope, p);
        audit("periodo", { periodo: p, cerrado });
      })(),
    periodos: () =>
      all(
        "SELECT * FROM ct_periodos WHERE contador_id=? AND cliente_id=? ORDER BY periodo",
      ),
    mayor: (cut) => {
      date(cut);
      return all(
        "SELECT *,sum(debe-haber) OVER(PARTITION BY cuenta ORDER BY fecha,asiento_id,linea) saldo FROM ct_mayor WHERE contador_id=? AND cliente_id=? AND fecha<=? ORDER BY cuenta,fecha,asiento_id,linea",
        cut,
      );
    },
    financial,
    registros: (p) => {
      period(p);
      return all(
        "SELECT c.id,c.direccion,c.tipo,c.numero,c.emisor,c.receptor,c.fecha,c.moneda,c.base,c.igv,c.total,c.datos,r.periodo,r.revisado,r.credito_fiscal,r.estado_sunat FROM ct_comprobantes c JOIN ct_registros r ON r.contador_id=c.contador_id AND r.cliente_id=c.cliente_id AND r.comprobante_id=c.id WHERE c.contador_id=? AND c.cliente_id=? AND r.periodo=? ORDER BY c.fecha,c.id",
        p,
      ).map((r) => ({
        ...r,
        signo: r.tipo === "07" ? -1 : 1,
        datos: JSON.parse(r.datos),
      }));
    },
    revisar: (id, data) =>
      db.transaction(() => {
        const r = get(
          "SELECT periodo FROM ct_registros WHERE contador_id=? AND cliente_id=? AND comprobante_id=?",
          id,
        );
        if (!r) throw new Error("Registro no encontrado");
        open(r.periodo);
        open(data.periodo);
        if (
          !["sin_verificar", "aceptado", "anulado", "rechazado"].includes(
            data.estadoSunat,
          )
        )
          throw new Error("Estado SUNAT inválido");
        db.prepare(
          "UPDATE ct_registros SET periodo=?,revisado=1,credito_fiscal=?,estado_sunat=? WHERE contador_id=? AND cliente_id=? AND comprobante_id=?",
        ).run(
          data.periodo,
          data.creditoFiscal === true ? 1 : 0,
          data.estadoSunat,
          ...scope,
          id,
        );
        audit("registro_revisado", { id, ...data });
      })(),
    renta: (data) =>
      db.transaction(() => {
        const year = Number(data.ejercicio);
        if (!Number.isInteger(year) || year < 2020 || year > 2099)
          throw new Error("Ejercicio inválido");
        if (!["RG", "RMT"].includes(data.regimen))
          throw new Error("El borrador anual admite RG o RMT");
        const params = { ...data };
        const adjustments = data.ajustes ?? [];
        if (!Array.isArray(adjustments) || adjustments.length > 200)
          throw new Error("Ajustes inválidos");
        let adiciones = 0,
          deducciones = 0;
        for (const a of adjustments) {
          const n = cents(a.importe);
          if (
            n < 0 ||
            !["adicion", "deduccion"].includes(a.tipo) ||
            !a.concepto ||
            !a.fundamento
          )
            throw new Error(
              "Cada ajuste requiere tipo, importe positivo, concepto y fundamento",
            );
          if (a.tipo === "adicion") adiciones += n;
          else deducciones += n;
        }
        const f = financial(year + "-12-31"),
          utilidad =
            f.utilidad +
            f.balance
              .filter((c) => c.codigo.startsWith("88") && c.clase === "gasto")
              .reduce((s, c) => s + c.ejercicio, 0),
          preliminar = utilidad + adiciones - deducciones;
        const perdidas = cents(data.perdidas ?? "0"),
          pagos = cents(data.pagos ?? "0"),
          creditos = cents(data.creditos ?? "0");
        if (
          [perdidas, pagos, creditos].some((n) => n < 0) ||
          perdidas > Math.max(0, preliminar)
        )
          throw new Error("Pérdidas/créditos inválidos");
        if (perdidas && !data.fundamentoPerdidas)
          throw new Error(
            "Documente el sistema y límite de compensación de pérdidas",
          );
        const base = Math.max(0, preliminar - perdidas),
          uit = cents(data.uit ?? "0");
        if (data.regimen === "RMT" && uit <= 0)
          throw new Error("Ingrese la UIT del ejercicio");
        if (!data.fuenteNormativa)
          throw new Error(
            "Indique la fuente normativa verificada para el ejercicio",
          );
        const impuesto =
          data.regimen === "RG"
            ? rate(base, 2950)
            : rate(Math.min(base, 15 * uit), 1000) +
              rate(Math.max(0, base - 15 * uit), 2950);
        const result = {
          ejercicio: year,
          regimen: data.regimen,
          utilidad,
          adiciones,
          deducciones,
          preliminar,
          perdidas,
          base,
          impuesto,
          pagos,
          creditos,
          saldo: impuesto - pagos - creditos,
          estado: "borrador",
          advertencia:
            "Revisar integridad contable, régimen, tasas del ejercicio, pérdidas y créditos antes de declarar. No es el Formulario 710.",
        };
        run(
          "INSERT INTO ct_renta(contador_id,cliente_id,ejercicio,parametros,resultado) VALUES(?,?,?,?,?) ON CONFLICT(contador_id,cliente_id,ejercicio) DO UPDATE SET parametros=excluded.parametros,resultado=excluded.resultado,actualizado_en=CURRENT_TIMESTAMP",
          year,
          JSON.stringify(params),
          JSON.stringify(result),
        );
        audit("renta_borrador", { ejercicio: year });
        return result;
      })(),
    auditoria: () =>
      all(
        "SELECT evento,detalle,fecha FROM ct_auditoria WHERE contador_id=? AND cliente_id=? ORDER BY id DESC LIMIT 200",
      ),
  };
}
module.exports = { migrate, service, ACCOUNTS };
