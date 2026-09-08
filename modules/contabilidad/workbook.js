"use strict";
const ExcelJS = require("exceljs");
function worksheet(book, name, columns, rows, money = []) {
  const ws = book.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = columns.map(([key, header, width]) => ({
    key,
    header,
    width: width || 22,
  }));
  rows.forEach((r) =>
    ws.addRow(Object.fromEntries(columns.map(([key]) => [key, r[key] ?? ""]))),
  );
  ws.getRow(1).eachCell((c) => {
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF163D31" },
    };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, ws.rowCount), column: columns.length },
  };
  for (const key of money)
    ws.getColumn(key).numFmt = "#,##0.00;[Red](#,##0.00)";
  return ws;
}
async function createWorkbook({
  empresa,
  desde,
  hasta,
  docs,
  sire,
  conciliation,
  entries,
  financial,
  ledger,
  issues,
}) {
  const book = new ExcelJS.Workbook();
  book.creator = "ContaFácil";
  book.created = new Date();
  worksheet(
    book,
    "Leer primero",
    [
      ["concepto", "Concepto", 30],
      ["detalle", "Detalle", 115],
    ],
    [
      {
        concepto: "Empresa",
        detalle: empresa.nombre_cliente + " · " + empresa.ruc,
      },
      { concepto: "Rango inclusivo", detalle: desde + " a " + hasta },
      {
        concepto: "Fuentes",
        detalle:
          "XML SEE-SOL y propuestas oficiales SIRE consultadas. Propuesta no equivale a registro presentado.",
      },
      {
        concepto: "Periodos SIRE",
        detalle:
          "Las hojas SIRE conservan meses completos consultados y sus campos originales. La conciliación y los XML se filtran por fecha de emisión del rango solicitado; fecha de emisión y periodo fiscal pueden diferir.",
      },
      {
        concepto: "Corte contable",
        detalle:
          "Balance acumulado hasta " +
          hasta +
          "; resultados desde el inicio del ejercicio. Diario y Mayor exportan movimientos del rango.",
      },
      {
        concepto: "Proyección",
        detalle:
          "Incluye propuestas equilibradas del rango; no sustituye estados contabilizados. Ver Observaciones y Conciliación.",
      },
      {
        concepto: "Limitaciones",
        detalle:
          "XML/SIRE no aportan apertura, bancos, inventario, costo de ventas, planillas, depreciaciones o ajustes tributarios completos.",
      },
      {
        concepto: "Validación",
        detalle:
          "No se presentan declaraciones ni se acepta/reemplaza la propuesta SIRE.",
      },
    ],
  );
  const columns = [
    ["fecha", "Fecha"],
    ["tipo", "Tipo"],
    ["numero", "Documento"],
    ["emisor", "Emisor"],
    ["receptor", "Receptor"],
    ["moneda", "Moneda"],
    ["base", "Base"],
    ["igv", "IGV"],
    ["total", "Total"],
  ];
  for (const [name, dir] of [
    ["Ventas XML", "venta"],
    ["Compras XML", "compra"],
  ])
    worksheet(
      book,
      name,
      columns,
      docs
        .filter((d) => d.direccion === dir)
        .map((d) => ({
          ...d,
          ...Object.fromEntries(
            ["base", "igv", "total"].map((k) => [
              k,
              (d[k] * (d.tipo === "07" ? -1 : 1)) / 100,
            ]),
          ),
        })),
      ["base", "igv", "total"],
    );
  for (const libro of ["RVIE", "RCE"]) {
    const source = sire.filter((r) => r.libro === libro);
    const rawCols = Array.from(
      {
        length: source.reduce(
          (n, r) => Math.max(n, r.raw.length),
          libro === "RVIE" ? 33 : 37,
        ),
      },
      (_, i) => ["raw" + i, "Campo SUNAT " + (i + 1)],
    );
    worksheet(
      book,
      libro + " SIRE",
      [["periodo", "Periodo"], ["car", "CAR"], ...columns, ...rawCols],
      source.map((r) => ({
        ...r,
        ...Object.fromEntries(r.raw.map((v, i) => ["raw" + i, v])),
        base: r.base / 100,
        igv: r.igv / 100,
        total: r.total / 100,
      })),
      ["base", "igv", "total"],
    );
  }
  worksheet(
    book,
    "Conciliacion",
    [
      ["libro", "Libro"],
      ["numero", "Documento"],
      ["estado", "Resultado"],
      ["detalle", "Diferencias", 45],
      ["moneda", "Moneda"],
      ["xmlTotal", "Total XML"],
      ["sireTotal", "Total SIRE"],
    ],
    conciliation.map((r) => ({
      ...r,
      xmlTotal: r.xmlTotal === null ? "" : r.xmlTotal / 100,
      sireTotal: r.sireTotal === null ? "" : r.sireTotal / 100,
    })),
    ["xmlTotal", "sireTotal"],
  );
  const journal = entries.flatMap((a) =>
    a.apuntes.map((p) => ({
      fecha: a.fecha,
      id: a.id,
      glosa: a.glosa,
      estado: a.estado,
      cuenta: p.cuenta,
      debe: p.debe / 100,
      haber: p.haber / 100,
    })),
  );
  const journalCols = [
    ["fecha", "Fecha"],
    ["id", "Asiento"],
    ["glosa", "Glosa", 40],
    ["estado", "Estado"],
    ["cuenta", "Cuenta"],
    ["debe", "Debe S/"],
    ["haber", "Haber S/"],
  ];
  worksheet(
    book,
    "Diario contabilizado",
    journalCols,
    journal.filter((r) => r.estado === "contabilizado"),
    ["debe", "haber"],
  );
  worksheet(
    book,
    "Asientos propuestos",
    journalCols,
    journal.filter((r) => r.estado === "borrador"),
    ["debe", "haber"],
  );
  worksheet(
    book,
    "Libro Mayor",
    [
      ["cuenta", "Cuenta"],
      ["fecha", "Fecha"],
      ["asiento_id", "Asiento"],
      ["glosa", "Glosa", 40],
      ["debe", "Debe S/"],
      ["haber", "Haber S/"],
      ["saldo", "Saldo acumulado S/"],
    ],
    ledger.map((r) => ({
      ...r,
      debe: r.debe / 100,
      haber: r.haber / 100,
      saldo: r.saldo / 100,
    })),
    ["debe", "haber", "saldo"],
  );
  worksheet(
    book,
    "Balance comprobacion",
    [
      ["codigo", "Cuenta"],
      ["nombre", "Nombre", 40],
      ["debe", "Debe acumulado S/"],
      ["haber", "Haber acumulado S/"],
      ["saldo", "Saldo S/"],
    ],
    financial.balance.map((r) => ({
      ...r,
      debe: r.debe / 100,
      haber: r.haber / 100,
      saldo: r.saldo / 100,
    })),
    ["debe", "haber", "saldo"],
  );
  const statementCols = [
    ["clase", "Clase"],
    ["rubro", "Rubro", 42],
    ["importe", "Importe S/"],
  ];
  worksheet(
    book,
    "Situacion financiera",
    statementCols,
    [
      ...financial.situacion,
      {
        clase: "patrimonio",
        rubro: "Resultado pendiente de cierre",
        importe: financial.resultadoPendiente,
      },
    ].map((r) => ({ ...r, importe: r.importe / 100 })),
    ["importe"],
  );
  worksheet(
    book,
    "Estado de resultados",
    statementCols,
    [
      ...financial.resultados,
      {
        clase: "resultado",
        rubro: "Utilidad del ejercicio",
        importe: financial.utilidad,
      },
    ].map((r) => ({ ...r, importe: r.importe / 100 })),
    ["importe"],
  );
  const projected = new Map(financial.balance.map((r) => [r.codigo, { ...r }]));
  for (const a of entries.filter((a) => a.estado === "borrador")) {
    if (a.apuntes.reduce((s, p) => s + p.debe - p.haber, 0) !== 0) {
      issues.push({
        etapa: "proyeccion",
        documento: String(a.id),
        mensaje: "Borrador descuadrado excluido de la proyección",
      });
      continue;
    }
    for (const p of a.apuntes) {
      const r = projected.get(p.cuenta);
      r.debe += p.debe;
      r.haber += p.haber;
      r.saldo += p.debe - p.haber;
      if (a.clase === "operacion" && a.fecha >= hasta.slice(0, 4) + "-01-01")
        r.ejercicio += p.debe - p.haber;
    }
  }
  worksheet(
    book,
    "Proyeccion con borradores",
    [
      ["codigo", "Cuenta"],
      ["nombre", "Nombre", 40],
      ["clase", "Clase"],
      ["saldo", "Saldo proyectado S/"],
      ["ejercicio", "Movimiento ejercicio S/"],
    ],
    [...projected.values()].map((r) => ({
      ...r,
      saldo: r.saldo / 100,
      ejercicio: r.ejercicio / 100,
    })),
    ["saldo", "ejercicio"],
  );
  const projectedSituation = [],
    projectedIncome = [];
  let pendingResult = 0,
    profit = 0;
  for (const r of projected.values()) {
    const fiscalCredit = r.codigo === "40111" && r.saldo > 0;
    const clase = fiscalCredit ? "activo" : r.clase;
    if (["activo", "pasivo", "patrimonio"].includes(clase))
      projectedSituation.push({
        clase,
        rubro:
          r.codigo + " · " + (fiscalCredit ? "Crédito fiscal IGV" : r.nombre),
        importe: (r.saldo * (clase === "activo" ? 1 : -1)) / 100,
      });
    if (["ingreso", "gasto"].includes(r.clase)) {
      pendingResult -= r.saldo;
      profit -= r.ejercicio;
      projectedIncome.push({
        clase: r.clase,
        rubro: r.codigo + " · " + r.nombre,
        importe: (r.ejercicio * (r.clase === "ingreso" ? -1 : 1)) / 100,
      });
    }
  }
  projectedSituation.push({
    clase: "patrimonio",
    rubro: "Resultado pendiente de cierre",
    importe: pendingResult / 100,
  });
  projectedIncome.push({
    clase: "resultado",
    rubro: "Utilidad proyectada del ejercicio",
    importe: profit / 100,
  });
  worksheet(book, "Situacion proyectada", statementCols, projectedSituation, [
    "importe",
  ]);
  worksheet(book, "Resultados proyectados", statementCols, projectedIncome, [
    "importe",
  ]);
  worksheet(
    book,
    "Observaciones",
    [
      ["etapa", "Etapa"],
      ["documento", "Documento", 30],
      ["mensaje", "Observación", 110],
    ],
    issues,
  );
  return book.xlsx.writeBuffer();
}
module.exports = { createWorkbook };
