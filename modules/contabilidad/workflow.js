"use strict";
const fs = require("fs/promises"),
  path = require("path"),
  crypto = require("crypto");
const { service } = require("./service"),
  { date } = require("./money");
const { parseSire, reconcile } = require("./conciliation"),
  { createWorkbook } = require("./workbook");
const { createSireClient } = require("./sire-client");
const { generarRangoMeses } = require("../../scripts-sunat/rango-meses");
function range(desde, hasta) {
  date(desde);
  date(hasta);
  if (desde > hasta || desde < "2020-01-01" || hasta > "2099-12-31")
    throw new Error("Rango de fechas inválido");
  const [a, m] = desde.split("-").map(Number),
    [b, n] = hasta.split("-").map(Number);
  if ((b - a) * 12 + n - m >= 36) throw new Error("Máximo 36 meses");
  const months = generarRangoMeses(a, m, b, n),
    fmt = (s) => s.split("-").reverse().join("/");
  months[0].desde = fmt(desde);
  months.at(-1).hasta = fmt(hasta);
  return months;
}
function coordinator(db, dependencies = {}) {
  const root =
    dependencies.root || path.join(__dirname, "../../data/automatizacion");
  const encrypt = dependencies.encrypt || require("../../crypto-sol").cifrar,
    decrypt = dependencies.decrypt || require("../../crypto-sol").descifrar;
  const download =
    dependencies.download ||
    require("../../scripts-sunat/sunat-motor").descargarSoloXML;
  const importer =
      dependencies.importer || require("./import-folder").importFolder,
    sireApi = dependencies.sireApi || createSireClient();
  // This factory is created once by the app, so jobs from a previous process are explicit.
  db.prepare(
    "UPDATE ct_trabajos SET estado='interrumpido',progreso='El servidor se reinició. Puede ejecutar nuevamente el rango.' WHERE estado='procesando'",
  ).run();
  const active = new Map();
  const read = (tenant, client, id) => {
    service(db, tenant, client);
    const j = db
      .prepare(
        "SELECT * FROM ct_trabajos WHERE contador_id=? AND cliente_id=? AND id=?",
      )
      .get(tenant, client, id);
    if (!j)
      throw Object.assign(new Error("Trabajo no encontrado"), { status: 404 });
    return { ...j, resultado: j.resultado ? JSON.parse(j.resultado) : null };
  };
  function config(tenant, client) {
    service(db, tenant, client);
    const row = db
      .prepare(
        "SELECT * FROM ct_automatizacion_config WHERE contador_id=? AND cliente_id=?",
      )
      .get(tenant, client);
    return {
      reglas: row
        ? JSON.parse(row.reglas)
        : {
            cuentaVenta: "",
            cuentaCompra: "",
            creditoFiscal: false,
            contabilizar: false,
          },
      sireConfigurado: !!row?.api_cifrada,
    };
  }
  function save(tenant, client, data) {
    const s = service(db, tenant, client);
    const accounts = s.cuentas();
    for (const [key, classes] of [
      ["cuentaVenta", ["ingreso"]],
      ["cuentaCompra", ["gasto", "activo"]],
    ])
      if (
        !accounts.some(
          (c) => c.codigo === data[key] && classes.includes(c.clase),
        )
      )
        throw new Error("Configure cuentas válidas de venta y compra");
    const rules = {
      cuentaVenta: data.cuentaVenta,
      cuentaCompra: data.cuentaCompra,
      creditoFiscal: data.creditoFiscal === true,
      contabilizar: data.contabilizar === true,
    };
    const old = db
      .prepare(
        "SELECT api_cifrada FROM ct_automatizacion_config WHERE contador_id=? AND cliente_id=?",
      )
      .get(tenant, client);
    let secret = old?.api_cifrada ?? null;
    if (data.clientId || data.clientSecret) {
      if (
        !/^[a-zA-Z0-9-]{10,100}$/.test(data.clientId ?? "") ||
        typeof data.clientSecret !== "string" ||
        data.clientSecret.length < 8 ||
        data.clientSecret.length > 1000
      )
        throw new Error("Complete ambas credenciales de API SIRE");
      secret = encrypt(
        JSON.stringify({
          clientId: data.clientId,
          clientSecret: data.clientSecret,
        }),
      );
    }
    db.transaction(() => {
      db.prepare(
        "INSERT INTO ct_automatizacion_config(contador_id,cliente_id,reglas,api_cifrada) VALUES(?,?,?,?) ON CONFLICT(contador_id,cliente_id) DO UPDATE SET reglas=excluded.reglas,api_cifrada=excluded.api_cifrada",
      ).run(tenant, client, JSON.stringify(rules), secret);
      db.prepare(
        "INSERT INTO ct_auditoria(contador_id,cliente_id,evento,detalle) VALUES(?,?,?,?)",
      ).run(tenant, client, "reglas_automaticas", JSON.stringify(rules));
    })();
    return config(tenant, client);
  }
  async function execute(tenant, client, id, options) {
    const s = service(db, tenant, client),
      months = range(options.desde, options.hasta),
      rules = config(tenant, client).reglas;
    const dir = path.join(root, String(tenant), String(client), id),
      issues = [],
      sire = [],
      available = [];
    let stage = "Preparando el trabajo";
    const progress = (message) => {
      stage = String(message).slice(0, 600);
      db.prepare("UPDATE ct_trabajos SET progreso=? WHERE id=?").run(
        String(message).slice(0, 600),
        id,
      );
    };
    try {
      await fs.mkdir(dir, { recursive: true });
      const owner = db
        .prepare("SELECT * FROM clientes_sunat WHERE contador_id=? AND id=?")
        .get(tenant, client);
      const credentials = {
        ruc: owner.ruc,
        usuario: owner.usuario_sol,
        password: decrypt(owner.clave_sol_cifrada),
      };
      if (options.modo === "simulacion") {
        const result = await require("./simulation").simulate({
          empresa: s.cliente,
          desde: options.desde,
          hasta: options.hasta,
          months,
          destination: options.carpetaDestino,
          id,
          credentials,
          accounts: s.cuentas(),
          rules,
          progress,
          exchangeRates: dependencies.exchangeRates,
          download:
            dependencies.downloadOrganized ||
            require("../../scripts-sunat/sunat-motor").descargarOrganizado,
        });
        await fs.copyFile(
          path.join(
            result.carpeta,
            "Estados financieros",
            "Estados financieros.xlsx",
          ),
          path.join(dir, "Contabilidad.xlsx"),
        );
        db.prepare(
          "UPDATE ct_trabajos SET estado=?,progreso=?,resultado=? WHERE id=?",
        ).run(
          result.observaciones.length ? "con_observaciones" : "completado",
          result.aviso,
          JSON.stringify(result),
          id,
        );
        return;
      }
      for (const pack of ["FE", "NC", "ND"]) {
        progress("Descargando " + pack + " emitidos y recibidos…");
        try {
          await download(
            credentials,
            months,
            path.join(dir, "xml"),
            (event) => {
              progress(event?.mensaje || "Descargando " + pack);
              if (event?.etapa === "xml_error")
                issues.push({
                  etapa: "descarga",
                  documento: pack + " " + event.mes,
                  mensaje:
                    "No se descargó uno de los XML encontrados por el motor.",
                });
            },
            pack,
            "ambas",
          );
        } catch {
          issues.push({
            etapa: "descarga",
            documento: pack,
            mensaje:
              "El motor no completó este paquete. Revise acceso SOL y archivos disponibles; no se asume ausencia de comprobantes.",
          });
        }
      }
      progress("Importando XML y comprobando duplicados…");
      await fs.mkdir(path.join(dir, "xml"), { recursive: true });
      const ingesta = await importer(db, tenant, client, path.join(dir, "xml"));
      for (const e of ingesta.errores)
        issues.push({ etapa: "xml", documento: e.archivo, mensaje: e.mensaje });
      const row = db
        .prepare(
          "SELECT api_cifrada FROM ct_automatizacion_config WHERE contador_id=? AND cliente_id=?",
        )
        .get(tenant, client);
      if (options.usarSire && row?.api_cifrada) {
        try {
          const apiCred = JSON.parse(decrypt(row.api_cifrada));
          const token = await sireApi.token({ ...apiCred, ...credentials });
          for (const month of months) {
            const p = month.desde.split("/").reverse().join("").slice(0, 6);
            for (const libro of ["RVIE", "RCE"]) {
              progress(
                "Consultando propuesta oficial " + libro + " " + p + "…",
              );
              try {
                const result = await sireApi.proposal(
                  token,
                  p,
                  libro,
                  progress,
                );
                const parsed = [];
                for (const [i, file] of result.archivos.entries()) {
                  parsed.push(...parseSire(file.texto, libro, owner.ruc, p));
                  await fs.writeFile(
                    path.join(dir, libro + "-" + p + "-" + i + ".txt"),
                    file.texto,
                    "utf8",
                  );
                }
                const keys = new Set();
                for (const d of parsed) {
                  if (keys.has(d.key))
                    throw new Error("SIRE repite documentos entre particiones");
                  keys.add(d.key);
                }
                sire.push(...parsed);
                available.push(libro + ":" + p);
              } catch (e) {
                issues.push({
                  etapa: "sire",
                  documento: libro + " " + p,
                  mensaje: e.message,
                });
              }
            }
          }
        } catch {
          issues.push({
            etapa: "sire",
            mensaje:
              "No se pudo autenticar SIRE. Revise Client ID, Client Secret, acceso API y credenciales SOL.",
          });
        }
      } else
        issues.push({
          etapa: "sire",
          mensaje:
            "SIRE no consultado: no se afirma conciliación ni registro oficial completo.",
        });
      const docs = s
        .comprobantes()
        .filter((d) => d.fecha >= options.desde && d.fecha <= options.hasta);
      const checks = reconcile(
          docs,
          sire,
          options.desde,
          options.hasta,
          available,
        ),
        existing = new Set(s.asientos().map((a) => a.id));
      let proposed = 0,
        posted = 0;
      // All XMLs have already been imported, so notes can find originals within this batch.
      for (const d of docs.sort(
        (a, b) =>
          (a.tipo === "07" || a.tipo === "08") -
          (b.tipo === "07" || b.tipo === "08"),
      )) {
        try {
          progress("Generando asientos: " + d.numero);
          const a = s.proponer(d.id, {
            cuenta:
              d.direccion === "venta" ? rules.cuentaVenta : rules.cuentaCompra,
            creditoFiscal: rules.creditoFiscal,
          });
          if (!existing.has(a.id)) {
            proposed++;
            const match = checks.find((c) => c.xmlId === d.id);
            if (
              rules.contabilizar &&
              match?.estado === "coincide" &&
              d.tipo === "01"
            ) {
              s.contabilizar(a.id);
              posted++;
            }
          }
        } catch (e) {
          issues.push({
            etapa: "asiento",
            documento: d.numero,
            mensaje: e.message,
          });
        }
      }
      for (const c of checks.filter((c) => c.estado !== "coincide"))
        issues.push({
          etapa: "conciliacion",
          documento: c.numero,
          mensaje: c.estado + (c.detalle ? ": " + c.detalle : ""),
        });
      progress("Preparando libros y estados en Excel…");
      const snapshot = db.transaction(() => ({
        entries: s
          .asientos()
          .filter((a) => a.fecha >= options.desde && a.fecha <= options.hasta),
        financial: s.financial(options.hasta),
        ledger: s.mayor(options.hasta).filter((r) => r.fecha >= options.desde),
      }))();
      const pending = snapshot.entries.filter(
        (a) => a.estado === "borrador",
      ).length;
      if (pending)
        issues.push({
          etapa: "revision",
          mensaje:
            pending +
            " asientos pendientes. Consulte las hojas de proyección; los estados contabilizados excluyen borradores.",
        });
      const result = {
        importados: ingesta.importados,
        duplicados: ingesta.duplicados,
        documentos: docs.length,
        propuestos: proposed,
        contabilizados: posted,
        pendientes: pending,
        coinciden: checks.filter((c) => c.estado === "coincide").length,
        fuentesSire: available,
        observaciones: issues,
        conciliacion: checks,
      };
      const buffer = await createWorkbook({
        empresa: s.cliente,
        desde: options.desde,
        hasta: options.hasta,
        docs,
        sire,
        conciliation: checks,
        ...snapshot,
        issues,
      });
      await fs.writeFile(path.join(dir, "Contabilidad.xlsx"), buffer);
      const state = issues.length ? "con_observaciones" : "completado";
      db.prepare(
        "UPDATE ct_trabajos SET estado=?,progreso=?,resultado=? WHERE id=?",
      ).run(
        state,
        "Excel disponible. Revise el resumen de fuentes y observaciones.",
        JSON.stringify(result),
        id,
      );
    } catch (e) {
      const causes = {
        ENOENT:
          "No se encontró una carpeta o archivo necesario. Compruebe la carpeta de destino.",
        EACCES:
          "El programa no tiene permiso para escribir en la carpeta de destino.",
        EPERM:
          "Windows impidió acceder a un archivo. Cierre los Excel abiertos y compruebe los permisos.",
        EBUSY:
          "Un archivo está ocupado. Cierre los Excel abiertos y vuelva a intentar.",
        ENOSPC: "No queda espacio suficiente en el disco de destino.",
        EEXIST:
          "La carpeta de este trabajo ya existe. Inicie un nuevo trabajo.",
      };
      const cause =
        causes[e.code] ||
        (e.message === "Número fiscal inválido"
          ? "Un comprobante tiene una serie o número que no se pudo interpretar."
          : "Ocurrió un error interno. Consulte la referencia de diagnóstico en la consola del programa.");
      // Preserve the failure location without logging XML contents, SOL credentials or request bodies.
      console.error("[ContaFácil] Trabajo fallido", id, {
        tipo: e.name,
        codigo: Object.hasOwn(causes, e.code) ? e.code : "interno",
        ubicaciones: String(e.stack || "")
          .split("\n")
          .slice(1, 7),
      });
      db.prepare(
        "UPDATE ct_trabajos SET estado='error',progreso=?,resultado=? WHERE id=?",
      ).run(
        "No se completó el trabajo. " + cause,
        JSON.stringify({
          observaciones: issues,
          error: cause,
          etapa: stage,
          referencia: id,
        }),
        id,
      );
    }
  }
  return {
    config,
    save,
    start(tenant, client, options) {
      service(db, tenant, client);
      range(options.desde, options.hasta);
      const cfg = config(tenant, client);
      const simulation = options.modo === "simulacion";
      if (
        simulation &&
        (typeof options.carpetaDestino !== "string" ||
          !path.isAbsolute(options.carpetaDestino.trim()) ||
          options.carpetaDestino.includes("\0"))
      )
        throw new Error("Seleccione una carpeta de destino absoluta");
      if (!simulation && (!cfg.reglas.cuentaVenta || !cfg.reglas.cuentaCompra))
        throw new Error("Guarde primero las reglas de la empresa");
      if (!simulation && options.usarSire && !cfg.sireConfigurado)
        throw new Error(
          "Configure las credenciales API SIRE o desactive su consulta",
        );
      if (active.size >= 2)
        throw new Error(
          "Hay dos trabajos en ejecución. Espere a que terminen.",
        );
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO ct_trabajos(id,contador_id,cliente_id,desde,hasta,estado,progreso) VALUES(?,?,?,?,?,'procesando','En cola')",
      ).run(id, tenant, client, options.desde, options.hasta);
      const promise = execute(tenant, client, id, {
        desde: options.desde,
        hasta: options.hasta,
        usarSire: options.usarSire === true,
        modo: simulation ? "simulacion" : "sire",
        carpetaDestino: simulation ? options.carpetaDestino.trim() : undefined,
      }).finally(() => active.delete(id));
      active.set(id, promise);
      return { id };
    },
    read,
    list(tenant, client) {
      service(db, tenant, client);
      return db
        .prepare(
          "SELECT id,desde,hasta,estado,progreso,creado_en FROM ct_trabajos WHERE contador_id=? AND cliente_id=? ORDER BY creado_en DESC,id DESC LIMIT 30",
        )
        .all(tenant, client);
    },
    file(tenant, client, id) {
      const j = read(tenant, client, id);
      if (!["completado", "con_observaciones"].includes(j.estado))
        throw new Error("El archivo todavía no está disponible");
      return path.join(
        root,
        String(tenant),
        String(client),
        j.id,
        "Contabilidad.xlsx",
      );
    },
    async wait(id) {
      await active.get(id);
    },
  };
}
module.exports = { coordinator, range };
