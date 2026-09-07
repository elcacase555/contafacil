"use strict";
const { date, period } = require("./money");
const fuente =
  "https://www.sunat.gob.pe/orientacion/cronogramas/2026/cObligacionMensual2026.html";
// Snapshot del cronograma mensual 2026 consultado 2026-09-07.
// Columnas: 0,1,2/3,4/5,6/7,8/9,buenos contribuyentes y UESP.
const days = [
  [16, 17, 18, 19, 20, 23, 24],
  [16, 17, 18, 19, 20, 23, 24],
  [17, 20, 21, 22, 23, 24, 27],
  [18, 19, 20, 21, 22, 25, 26],
  [15, 16, 17, 18, 19, 22, 23],
  [15, 16, 17, 20, 21, 22, 24],
  [18, 19, 20, 21, 24, 25, 26],
  [15, 16, 17, 18, 21, 22, 23],
  [16, 19, 20, 21, 22, 23, 26],
  [16, 17, 18, 19, 20, 23, 24],
  [17, 18, 21, 22, 23, 24, 28],
  [18, 19, 20, 21, 22, 25, 26],
];
function due(ruc, p, group = "regular") {
  period(p);
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido");
  if (!p.startsWith("2026-")) return null;
  const digit = Number(ruc.slice(-1)),
    col =
      group === "buen_contribuyente"
        ? 6
        : digit < 2
          ? digit
          : Math.floor(digit / 2) + 1,
    m = Number(p.slice(5));
  return `${m === 12 ? 2027 : 2026}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${days[m - 1][col]}`;
}
function dashboard(db, tenant, p, today) {
  period(p);
  date(today);
  return db
    .prepare(
      `SELECT c.id,c.nombre_cliente,c.ruc,COALESCE(f.grupo,'regular') grupo
  FROM clientes_sunat c LEFT JOIN ct_perfil f ON f.contador_id=c.contador_id AND f.cliente_id=c.id
  WHERE c.contador_id=? ORDER BY c.nombre_cliente`,
    )
    .all(tenant)
    .map((c) => {
      const override = db
        .prepare(
          "SELECT fecha,fuente,motivo FROM ct_vencimientos WHERE contador_id=? AND cliente_id=? AND periodo=?",
        )
        .get(tenant, c.id, p);
      const fecha = override?.fecha ?? due(c.ruc, p, c.grupo);
      const pendientes = db
        .prepare(
          "SELECT count(*) n FROM ct_asientos WHERE contador_id=? AND cliente_id=? AND estado='borrador'",
        )
        .get(tenant, c.id).n;
      const tareas = db
        .prepare(
          "SELECT * FROM ct_tareas WHERE contador_id=? AND cliente_id=? ORDER BY completada,vence,id",
        )
        .all(tenant, c.id);
      return {
        ...c,
        periodo: p,
        fecha,
        fuente: override?.fuente ?? fuente,
        motivo:
          override?.motivo ??
          "Cronograma mensual general; revisar prórrogas y supuestos especiales",
        alerta: !fecha
          ? "sin_cronograma"
          : fecha < today
            ? "vencimiento_transcurrido"
            : fecha <=
                new Date(Date.parse(today) + 7 * 86400000)
                  .toISOString()
                  .slice(0, 10)
              ? "vence_pronto"
              : "programado",
        pendientes,
        tareas,
      };
    });
}
module.exports = { due, dashboard, fuente };
