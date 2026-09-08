"use strict";
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { service } = require("./service");
const { dashboard } = require("./crm");
const { date, period, amount } = require("./money");
const { buildSire } = require("./sire");
function routes(db, workflowOptions = {}) {
  const r = express.Router();
  const workflow = require("./workflow").coordinator(db, workflowOptions);
  r.use((req, res, next) => {
    if (!req.session?.contadorId)
      return res.status(401).json({ mensaje: "Inicie sesión" });
    const active = db
      .prepare("SELECT activo FROM contadores WHERE id=?")
      .get(req.session.contadorId);
    if (!active?.activo)
      return res.status(401).json({ mensaje: "Cuenta inactiva" });
    next();
  });
  r.get("/csrf", (req, res) => {
    req.session.ctCsrf ??= crypto.randomBytes(32).toString("hex");
    res.json({ token: req.session.ctCsrf });
  });
  r.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.session.ctCsrf || req.get("X-CSRF-Token") !== req.session.ctCsrf)
    )
      return res
        .status(403)
        .json({ mensaje: "Sesión caducada: recargue la página" });
    next();
  });
  const handle = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  r.get(
    "/crm",
    handle((req) =>
      dashboard(
        db,
        req.session.contadorId,
        req.query.periodo || today().slice(0, 7),
        today(),
      ),
    ),
  );
  r.use("/clientes/:id", (req, res, next) => {
    try {
      if (!/^\d+$/.test(req.params.id)) throw new Error("Cliente inválido");
      req.ct = service(db, req.session.contadorId, Number(req.params.id));
      req.ctId = Number(req.params.id);
      next();
    } catch (e) {
      next(e);
    }
  });
  r.get(
    "/clientes/:id/cuentas",
    handle((req) => req.ct.cuentas()),
  );
  r.get(
    "/clientes/:id/automatizacion/config",
    handle((req) => workflow.config(req.session.contadorId, req.ctId)),
  );
  r.put(
    "/clientes/:id/automatizacion/config",
    handle((req) => workflow.save(req.session.contadorId, req.ctId, req.body)),
  );
  r.post(
    "/clientes/:id/automatizacion",
    handle((req) => workflow.start(req.session.contadorId, req.ctId, req.body)),
  );
  r.get(
    "/clientes/:id/automatizacion",
    handle((req) => workflow.list(req.session.contadorId, req.ctId)),
  );
  r.get(
    "/clientes/:id/automatizacion/:job",
    handle((req) =>
      workflow.read(req.session.contadorId, req.ctId, req.params.job),
    ),
  );
  r.get("/clientes/:id/automatizacion/:job/excel", (req, res, next) => {
    try {
      const file = workflow.file(
        req.session.contadorId,
        req.ctId,
        req.params.job,
      );
      res.download(
        file,
        "ContaFacil-" + req.ct.cliente.ruc + ".xlsx",
        (error) => {
          if (error && !res.headersSent) next(error);
        },
      );
    } catch (error) {
      next(error);
    }
  });
  r.post(
    "/clientes/:id/cuentas",
    handle((req) => req.ct.cuenta(req.body)),
  );
  r.get(
    "/clientes/:id/comprobantes",
    handle((req) => req.ct.comprobantes()),
  );
  r.post(
    "/clientes/:id/xml",
    express.text({ type: ["application/xml", "text/xml"], limit: "2mb" }),
    handle((req) => req.ct.importar(req.body)),
  );
  r.post(
    "/clientes/:id/comprobantes/:doc/proponer",
    handle((req) => req.ct.proponer(Number(req.params.doc), req.body)),
  );
  r.get(
    "/clientes/:id/asientos",
    handle((req) => req.ct.asientos()),
  );
  r.post(
    "/clientes/:id/asientos",
    handle((req) => req.ct.manual(req.body)),
  );
  r.put(
    "/clientes/:id/asientos/:entry",
    handle((req) => req.ct.editar(Number(req.params.entry), req.body.apuntes)),
  );
  r.post(
    "/clientes/:id/asientos/:entry/contabilizar",
    handle((req) => req.ct.contabilizar(Number(req.params.entry))),
  );
  r.post(
    "/clientes/:id/asientos/:entry/revertir",
    handle((req) => req.ct.revertir(Number(req.params.entry), req.body.fecha)),
  );
  r.get(
    "/clientes/:id/mayor",
    handle((req) => req.ct.mayor(req.query.corte || today())),
  );
  r.get(
    "/clientes/:id/estados",
    handle((req) => req.ct.financial(req.query.corte || today())),
  );
  r.get(
    "/clientes/:id/periodos",
    handle((req) => req.ct.periodos()),
  );
  r.post(
    "/clientes/:id/periodos",
    handle((req) =>
      req.ct.periodo(req.body.periodo, req.body.cerrado === true),
    ),
  );
  r.get(
    "/clientes/:id/registros",
    handle((req) => req.ct.registros(req.query.periodo || today().slice(0, 7))),
  );
  r.put(
    "/clientes/:id/registros/:doc",
    handle((req) => req.ct.revisar(Number(req.params.doc), req.body)),
  );
  r.post(
    "/clientes/:id/renta",
    handle((req) => req.ct.renta(req.body)),
  );
  r.get(
    "/clientes/:id/renta",
    handle((req) =>
      db
        .prepare(
          "SELECT ejercicio,parametros,resultado,actualizado_en FROM ct_renta WHERE contador_id=? AND cliente_id=? ORDER BY ejercicio DESC",
        )
        .all(req.session.contadorId, req.ctId)
        .map((x) => ({
          ...x,
          parametros: JSON.parse(x.parametros),
          resultado: JSON.parse(x.resultado),
        })),
    ),
  );
  r.get(
    "/clientes/:id/auditoria",
    handle((req) => req.ct.auditoria()),
  );
  r.post(
    "/clientes/:id/sire",
    handle((req) => {
      const result = buildSire({
        libro: req.body.libro,
        periodo: req.body.periodo,
        empresa: req.ct.cliente,
        rows: req.ct.registros(req.body.periodo),
        originals: req.ct.comprobantes(),
        clasificacion: req.body.clasificacion,
      });
      db.prepare(
        "INSERT INTO ct_auditoria(contador_id,cliente_id,evento,detalle) VALUES(?,?,?,?)",
      ).run(
        req.session.contadorId,
        req.ctId,
        "sire_preliminar",
        JSON.stringify({
          version: result.version,
          periodo: req.body.periodo,
          sha256: crypto
            .createHash("sha256")
            .update(result.contenido)
            .digest("hex"),
          filas: result.filas,
        }),
      );
      return result;
    }),
  );
  r.post(
    "/clientes/:id/tareas",
    handle((req) => {
      const d = req.body;
      date(d.vence);
      if (
        typeof d.titulo !== "string" ||
        !d.titulo.trim() ||
        d.titulo.length > 200 ||
        String(d.notas ?? "").length > 2000
      )
        throw new Error("Tarea inválida");
      return db
        .prepare(
          "INSERT INTO ct_tareas(contador_id,cliente_id,titulo,vence,notas) VALUES(?,?,?,?,?)",
        )
        .run(
          req.session.contadorId,
          req.ctId,
          d.titulo,
          d.vence,
          d.notas ?? "",
        );
    }),
  );
  r.put(
    "/clientes/:id/tareas/:task",
    handle((req) => {
      const result = db
        .prepare(
          "UPDATE ct_tareas SET completada=? WHERE contador_id=? AND cliente_id=? AND id=?",
        )
        .run(
          req.body.completada === true ? 1 : 0,
          req.session.contadorId,
          req.ctId,
          Number(req.params.task),
        );
      if (!result.changes)
        throw Object.assign(new Error("Tarea no encontrada"), { status: 404 });
    }),
  );
  r.put(
    "/clientes/:id/perfil",
    handle((req) => {
      if (!["regular", "buen_contribuyente"].includes(req.body.grupo))
        throw new Error("Grupo inválido");
      db.prepare(
        "INSERT INTO ct_perfil(contador_id,cliente_id,grupo) VALUES(?,?,?) ON CONFLICT(contador_id,cliente_id) DO UPDATE SET grupo=excluded.grupo",
      ).run(req.session.contadorId, req.ctId, req.body.grupo);
    }),
  );
  r.put(
    "/clientes/:id/vencimiento",
    handle((req) => {
      const d = req.body;
      period(d.periodo);
      date(d.fecha);
      if (
        !d.fuente ||
        !d.motivo ||
        !/^https:\/\/(?:[\w-]+\.)*(?:sunat\.gob\.pe|gob\.pe)\//.test(d.fuente)
      )
        throw new Error("Indique fuente oficial y motivo de la fecha especial");
      db.prepare(
        "INSERT INTO ct_vencimientos(contador_id,cliente_id,periodo,fecha,fuente,motivo) VALUES(?,?,?,?,?,?) ON CONFLICT(contador_id,cliente_id,periodo) DO UPDATE SET fecha=excluded.fecha,fuente=excluded.fuente,motivo=excluded.motivo",
      ).run(
        req.session.contadorId,
        req.ctId,
        d.periodo,
        d.fecha,
        d.fuente,
        d.motivo,
      );
    }),
  );
  r.get(
    "/clientes/:id/exportar",
    handle((req, res) => {
      const type = req.query.libro;
      let rows, columns;
      if (type === "mayor") {
        rows = req.ct.mayor(req.query.corte || today());
        columns = [
          "fecha",
          "asiento_id",
          "cuenta",
          "glosa",
          "debe",
          "haber",
          "saldo",
        ];
      } else if (type === "balance") {
        rows = req.ct.financial(req.query.corte || today()).balance;
        columns = [
          "codigo",
          "nombre",
          "clase",
          "rubro",
          "debe",
          "haber",
          "saldo",
        ];
      } else if (["ventas", "compras"].includes(type)) {
        rows = req.ct
          .registros(req.query.periodo || today().slice(0, 7))
          .filter(
            (r) => r.direccion === (type === "ventas" ? "venta" : "compra"),
          )
          .map((r) => ({
            ...r,
            base: r.base * r.signo,
            igv: r.igv * r.signo,
            total: r.total * r.signo,
          }));
        columns = [
          "periodo",
          "fecha",
          "tipo",
          "numero",
          "emisor",
          "receptor",
          "moneda",
          "base",
          "igv",
          "total",
          "revisado",
          "estado_sunat",
        ];
      } else throw new Error("Libro inválido");
      const numeric = new Set([
        "base",
        "igv",
        "total",
        "debe",
        "haber",
        "saldo",
      ]);
      const escape = (v) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@-]/, "'")
          .replace(/"/g, '""') +
        '"';
      const csv =
        "\uFEFF" +
        [
          columns.join(";"),
          ...rows.map((row) =>
            columns
              .map((k) => (numeric.has(k) ? amount(row[k]) : escape(row[k])))
              .join(";"),
          ),
        ].join("\r\n");
      res
        .attachment(type + "-revision.csv")
        .type("text/csv")
        .send(csv);
    }),
  );
  r.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const known = err.status || err.code?.startsWith("SQLITE_CONSTRAINT");
    res.status(err.status || 400).json({
      mensaje:
        known && err.code
          ? "Operación incompatible con los datos contables: " + err.message
          : err.message || "No se pudo completar la operación",
    });
  });
  return r;
}
module.exports = { routes };
