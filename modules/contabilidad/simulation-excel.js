"use strict";
// Portable application generator. The native chart template is authored with Artifact Tool.
const ExcelJS = require("exceljs"),
  AdmZip = require("adm-zip"),
  path = require("path");
const NOTICE =
  "SIMULACIÓN CONTABLE. Revise y corrija la información antes de utilizarla. Preparada para agilizar el trabajo del contador; no es un registro SUNAT validado.";
const amountFormat = '#,##0.00;[Red](#,##0.00);"-"';
const serial = (s) =>
  Math.round(
    (Date.parse(s + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000,
  );
function f(ws, address, formula, result = 0) {
  ws.getCell(address).value = { formula, result };
  ws.getCell(address).font = {
    name: "Arial",
    size: 10,
    color: { argb: formula.includes("!") ? "FF176348" : "FF202020" },
  };
}
function sheet(w, name, headers, widths = []) {
  const s = w.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
  });
  s.columns = headers.map((h, i) => ({ width: widths[i] || 20 }));
  s.getCell("A2").value = name + " · Simulación";
  s.getCell("A2").font = { name: "Arial", size: 15, bold: true };
  s.getCell("A3").value =
    "Soles, salvo que se indique otra moneda. Consulte Instrucciones.";
  s.getRow(4).values = headers;
  s.getRow(4).height = 34;
  s.getRow(4).eachCell((c) => {
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF163D31" },
    };
    c.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    c.alignment = { wrapText: true, vertical: "middle" };
  });
  return s;
}
function finish(s, money = []) {
  s.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: Math.max(5, s.rowCount), column: s.columnCount },
  };
  for (const col of money) s.getColumn(col).numFmt = amountFormat;
  s.eachRow((r, n) => {
    if (n > 4) {
      r.height = 22;
      r.eachCell((c) => {
        c.font ||= { name: "Arial", size: 10 };
        c.alignment = { vertical: "middle" };
      });
    }
  });
}
function addChart(buffer, index, months) {
  const z = new AdmZip(buffer),
    t = new AdmZip(path.join(__dirname, "templates/dashboard.xlsx"));
  for (const e of t
    .getEntries()
    .filter((e) => /^xl\/(charts|drawings)\//.test(e.entryName))) {
    let data = e.getData();
    if (e.entryName.endsWith(".xml") && e.entryName.includes("/charts/"))
      data = Buffer.from(
        data
          .toString()
          .replace(
            /<c:(?:numCache|strCache)\b[\s\S]*?<\/c:(?:numCache|strCache)>/g,
            "",
          )
          .replace(/\$59/g, "$" + (23 + months))
          .replace(
            /<c:symbol val="none" \/>/g,
            '<c:symbol val="circle"/><c:size val="4"/>',
          ),
      );
    z.addFile(e.entryName, data);
  }
  const templateSheet = t.readAsText("xl/worksheets/sheet1.xml");
  const drawing = templateSheet
    .match(/<(?:\w+:)?drawing\b[^>]*\/>/)[0]
    .replace(/^<\w+:drawing/, "<drawing");
  const file = `xl/worksheets/sheet${index}.xml`;
  z.updateFile(
    file,
    Buffer.from(
      z.readAsText(file).replace("</worksheet>", drawing + "</worksheet>"),
    ),
  );
  z.addFile(
    `xl/worksheets/_rels/sheet${index}.xml.rels`,
    t.readFile("xl/worksheets/_rels/sheet1.xml.rels"),
  );
  const types =
    t
      .readAsText("[Content_Types].xml")
      .match(/<Override[^>]*PartName="\/xl\/(?:charts|drawings)\/[^>]*\/>/g) ||
    [];
  z.updateFile(
    "[Content_Types].xml",
    Buffer.from(
      z
        .readAsText("[Content_Types].xml")
        .replace("</Types>", types.join("") + "</Types>"),
    ),
  );
  return z.toBuffer();
}
async function simulationBook(
  { empresa, desde, hasta, docs, accounts, rules, issues },
  focus = "Dashboard",
) {
  const w = new ExcelJS.Workbook();
  w.creator = "ContaFácil";
  w.calcProperties = { fullCalcOnLoad: true };
  const names = [
    "Dashboard",
    "Registro ventas",
    "Registro compras",
    "Diario",
    "Mayor",
    "Balance",
    "Balance general",
    "Estado resultados",
    "XML",
    "Ajustes",
    "PCGE",
    "Instrucciones",
  ];
  const ordered = [focus, ...names.filter((n) => n !== focus)];
  // All sheets exist before formulas are populated. Dashboard always has a stable sheet name.
  const headers = {
    Dashboard: ["Concepto", "Importe S/"],
    "Registro ventas": [
      "Fecha",
      "Tipo",
      "Documento",
      "Emisor",
      "Receptor",
      "Moneda",
      "Base neta",
      "IGV neto",
      "Total neto",
      "Incluido en asientos",
    ],
    "Registro compras": [
      "Fecha",
      "Tipo",
      "Documento",
      "Emisor",
      "Receptor",
      "Moneda",
      "Base neta",
      "IGV neto",
      "Total neto",
      "Incluido en asientos",
    ],
    Diario: [
      "Fecha",
      "Identificador",
      "Documento",
      "Glosa",
      "Cuenta PCGE",
      "Debe S/",
      "Haber S/",
      "Saldo S/",
      "Clase",
    ],
    Mayor: [
      "Cuenta PCGE",
      "Fecha",
      "Documento",
      "Glosa",
      "Debe S/",
      "Haber S/",
      "Saldo cuenta en rango S/",
    ],
    Balance: [
      "Cuenta",
      "Nombre",
      "Clase",
      "Debe S/",
      "Haber S/",
      "Saldo deudor S/",
      "Saldo acreedor S/",
      "Clase presentación",
      "Importe S/",
    ],
    "Estado resultados": ["Concepto", "Importe S/"],
    "Balance general": ["Concepto", "Importe S/"],
    XML: [
      "Identificador",
      "Fecha XML",
      "Tipo",
      "Documento",
      "Emisor",
      "Receptor",
      "Dirección",
      "Moneda",
      "Base XML",
      "IGV XML",
      "Total XML",
      "Archivo XML",
      "Corregir base",
      "Corregir IGV",
      "Corregir total",
      "Incluir 1/0",
      "Cuenta naturaleza",
      "Crédito IGV 1/0",
      "Observaciones",
      "Base usada",
      "IGV usado",
      "Total usado",
      "Signo",
      "Base neta",
      "IGV neto",
      "Total neto",
    ],
    Ajustes: [
      "Fecha",
      "Glosa",
      "Cuenta PCGE",
      "Debe S/",
      "Haber S/",
      "Revisión",
    ],
    PCGE: ["Código", "Nombre", "Clase"],
    Instrucciones: ["Tema", "Detalle"],
  };
  for (const n of ordered) sheet(w, n, headers[n]);
  const s = (n) => w.getWorksheet(n),
    x = s("XML");
  const sale = rules.cuentaVenta || "70111",
    purchase = rules.cuentaCompra || "6011";
  const lineValues = [];
  docs.forEach((d, i) => {
    const r = i + 5,
      include = d.moneda === "PEN" && !d.warnings.length ? 1 : 0,
      sign = d.tipo === "07" ? -1 : 1;
    const account = d.direccion === "venta" ? sale : purchase,
      credit = rules.creditoFiscal ? 1 : 0;
    x.getRow(r).values = [
      d.key,
      serial(d.fecha),
      d.tipo,
      d.numero,
      d.emisor,
      d.receptor,
      d.direccion,
      d.moneda,
      d.base / 100,
      d.igv / 100,
      d.total / 100,
      d.archivo,
      null,
      null,
      null,
      include,
      account,
      credit,
      d.warnings.join(" · ") || null,
    ];
    for (const [col, raw, over, val] of [
      ["T", "I", "M", d.base],
      ["U", "J", "N", d.igv],
      ["V", "K", "O", d.total],
    ])
      f(
        x,
        col + r,
        `IF(ISBLANK(${over}${r}),${raw}${r},${over}${r})`,
        val / 100,
      );
    f(x, "W" + r, `IF(C${r}="07",-1,1)`, sign);
    for (const [out, source, val] of [
      ["X", "T", d.base],
      ["Y", "U", d.igv],
      ["Z", "V", d.total],
    ])
      f(x, out + r, `${source}${r}*W${r}`, (val / 100) * sign);
    for (const col of ["M", "N", "O", "P", "Q", "R"])
      x.getCell(col + r).font = {
        color: { argb: "FF0000FF" },
        name: "Arial",
        size: 10,
      };
    for (const col of ["P", "R"])
      x.getCell(col + r).dataValidation = {
        type: "whole",
        operator: "between",
        formulae: [0, 1],
        showErrorMessage: true,
        error: "Use 0 o 1",
      };
    const signed = [
      (d.base / 100) * sign,
      (d.igv / 100) * sign,
      (d.total / 100) * sign,
    ];
    const expressions =
      d.direccion === "venta"
        ? [`'XML'!Z${r}`, `-'XML'!X${r}`, `-'XML'!Y${r}`]
        : [
            `'XML'!X${r}+'XML'!Y${r}*(1-'XML'!R${r})`,
            `'XML'!Y${r}*'XML'!R${r}`,
            `-'XML'!Z${r}`,
          ];
    const acc =
      d.direccion === "venta"
        ? ["1212", account, "40111"]
        : [account, "40111", "4212"];
    const nums =
      d.direccion === "venta"
        ? [signed[2], -signed[0], -signed[1]]
        : [
            signed[0] + signed[1] * (1 - credit),
            signed[1] * credit,
            -signed[2],
          ];
    expressions.forEach((expr, k) => {
      const j = s("Diario"),
        jr = lineValues.length + 5;
      f(j, "A" + jr, `'XML'!B${r}`, serial(d.fecha));
      f(j, "B" + jr, `'XML'!A${r}`, d.key);
      f(j, "C" + jr, `'XML'!D${r}`, d.numero);
      j.getCell("D" + jr).value =
        (d.tipo === "07" ? "Reversión propuesta · " : "Propuesta · ") +
        d.direccion;
      if (
        (d.direccion === "venta" && k === 1) ||
        (d.direccion === "compra" && k === 0)
      )
        f(j, "E" + jr, `'XML'!Q${r}`, account);
      else j.getCell("E" + jr).value = acc[k];
      const gate = `AND('XML'!P${r}=1,'XML'!H${r}="PEN")`,
        v = include ? nums[k] : 0;
      f(j, "F" + jr, `IF(${gate},MAX(${expr},0),0)`, Math.max(v, 0));
      f(j, "G" + jr, `IF(${gate},MAX(-(${expr}),0),0)`, Math.max(-v, 0));
      f(j, "H" + jr, `F${jr}-G${jr}`, v);
      lineValues.push({
        fecha: serial(d.fecha),
        account: acc[k],
        debe: Math.max(v, 0),
        haber: Math.max(-v, 0),
      });
    });
  });
  const endX = Math.max(5, docs.length + 4),
    p = s("PCGE");
  accounts.forEach((a, i) => {
    p.getRow(i + 5).values = [a.codigo, a.nombre, a.clase];
  });
  const endP = accounts.length + 4;
  const adj = s("Ajustes");
  for (let i = 5; i < 105; i++) {
    adj.getRow(i).values = [null, null, null, null, null];
    f(
      adj,
      "F" + i,
      `IF(AND(OR(D${i}<>0,E${i}<>0),OR(ISBLANK(A${i}),ISBLANK(C${i}))),"REVISAR","")`,
      "",
    );
    const j = s("Diario"),
      r = lineValues.length + 5;
    for (const [out, src] of [
      ["A", "A"],
      ["D", "B"],
      ["E", "C"],
      ["F", "D"],
      ["G", "E"],
    ])
      f(
        j,
        out + r,
        `IF('Ajustes'!A${i}="",${["D", "E"].includes(out) ? '""' : "0"},'Ajustes'!${src}${i})`,
        ["D", "E"].includes(out) ? "" : 0,
      );
    j.getCell("B" + r).value = "AJ-" + i;
    j.getCell("C" + r).value = "Ajuste manual";
    f(j, "H" + r, `F${r}-G${r}`, 0);
    lineValues.push({ fecha: 0, account: "", debe: 0, haber: 0 });
  }
  const endJ = lineValues.length + 4;
  for (let r = 5; r <= endJ; r++)
    f(
      s("Diario"),
      "I" + r,
      `IF(E${r}="","",IFERROR(VLOOKUP(E${r}&"",'PCGE'!$A$5:$C$${endP},3,FALSE),"REVISAR CUENTA"))`,
      accounts.find((a) => a.codigo === lineValues[r - 5].account)?.clase || "",
    );
  const start = serial(desde),
    end = serial(hasta),
    dash = s("Dashboard");
  dash.getCell("A2").value = empresa.nombre_cliente + " · Simulación contable";
  dash.getCell("A3").value =
    "Edite fechas para filtrar datos descargados. Revise Instrucciones.";
  dash.getCell("A5").value = "Desde";
  dash.getCell("B5").value = start;
  dash.getCell("A6").value = "Hasta";
  dash.getCell("B6").value = end;
  for (const c of ["B5", "B6"]) {
    dash.getCell(c).numFmt = "dd/mm/yyyy";
    dash.getCell(c).font = { color: { argb: "FF0000FF" } };
  }
  const sums = (col, criteria = "") =>
    `SUMIFS('Diario'!$${col}$5:$${col}$${endJ},'Diario'!$A$5:$A$${endJ},">="&'Dashboard'!$B$5,'Diario'!$A$5:$A$${endJ},"<="&'Dashboard'!$B$6${criteria})`;
  const bal = s("Balance");
  const totals = { activo: 0, pasivo: 0, patrimonio: 0, ingreso: 0, gasto: 0 };
  accounts.forEach((a, i) => {
    const r = i + 5,
      rows = lineValues.filter(
        (v) => v.account === a.codigo && v.fecha >= start && v.fecha <= end,
      ),
      debe = rows.reduce((n, v) => n + v.debe, 0),
      haber = rows.reduce((n, v) => n + v.haber, 0),
      net = debe - haber;
    bal.getRow(r).values = [a.codigo, a.nombre, a.clase];
    for (const [out, col, val] of [
      ["D", "F", debe],
      ["E", "G", haber],
    ])
      f(bal, out + r, sums(col, `,'Diario'!$E$5:$E$${endJ},A${r}`), val);
    f(bal, "F" + r, `MAX(D${r}-E${r},0)`, Math.max(net, 0));
    f(bal, "G" + r, `MAX(E${r}-D${r},0)`, Math.max(-net, 0));
    const cls = a.codigo === "40111" && net > 0 ? "activo" : a.clase;
    f(bal, "H" + r, `IF(AND(A${r}="40111",F${r}>0),"activo",C${r})`, cls);
    const value = net * (["activo", "gasto"].includes(cls) ? 1 : -1);
    totals[cls] = (totals[cls] || 0) + value;
    f(
      bal,
      "I" + r,
      `IF(OR(H${r}="activo",H${r}="gasto"),F${r}-G${r},G${r}-F${r})`,
      value,
    );
  });
  const bs = (cl) =>
    `SUMIFS('Balance'!$I$5:$I$${endP},'Balance'!$H$5:$H$${endP},"${cl}")`;
  const income = s("Estado resultados");
  for (const [r, label, formula, v] of [
    [5, "Ingresos", bs("ingreso"), totals.ingreso],
    [6, "Gastos por naturaleza", bs("gasto"), totals.gasto],
    [8, "Resultado del rango", "B5-B6", totals.ingreso - totals.gasto],
  ]) {
    income.getCell("A" + r).value = label;
    f(income, "B" + r, formula, v);
  }
  const metrics = [
    [8, "Activo", bs("activo"), totals.activo],
    [9, "Pasivo", bs("pasivo"), totals.pasivo],
    [10, "Patrimonio aportado / ajustes", bs("patrimonio"), totals.patrimonio],
    [
      11,
      "Resultado del rango",
      "'Estado resultados'!B8",
      totals.ingreso - totals.gasto,
    ],
    [
      12,
      "Patrimonio con resultado",
      "B10+B11",
      totals.patrimonio + totals.ingreso - totals.gasto,
    ],
    [14, "Control: activo menos pasivo y patrimonio", "ROUND(B8-B9-B12,2)", 0],
    [
      16,
      "Control: Debe menos Haber",
      "ROUND(" + sums("F") + "-" + sums("G") + ",2)",
      0,
    ],
  ];
  metrics.forEach(([r, label, formula, v]) => {
    dash.getCell("A" + r).value = label;
    f(dash, "B" + r, formula, v);
  });
  metrics
    .filter(([r]) => r <= 14)
    .forEach(([r, label, formula, v]) => {
      s("Balance general").getCell("A" + r).value = label;
      f(s("Balance general"), "B" + r, `'Dashboard'!B${r}`, v);
    });
  dash.getCell("A17").value = "Cuentas sin clasificar";
  f(dash, "B17", `COUNTIFS('Diario'!I5:I${endJ},"REVISAR CUENTA")`, 0);
  dash.getCell("B17").numFmt = "0";
  dash.getCell("A20").value = "Ajustes con fecha o cuenta faltante";
  f(dash, "B20", `COUNTIFS('Ajustes'!F5:F104,"REVISAR")`, 0);
  adj.getColumn("C").numFmt = "@";
  dash.getCell("A18").value =
    "Estados del rango sin saldos de apertura, salvo ajustes ingresados.";
  dash.getCell("A19").value =
    "Cambie correcciones y cuentas en XML; agregue partidas en Ajustes.";
  dash.getRow(23).values = [
    "Mes",
    "Ventas netas",
    "Compras netas",
    "Resultado",
  ];
  const months =
    (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 +
    Number(hasta.slice(5, 7)) -
    Number(desde.slice(5, 7)) +
    1;
  for (let i = 0; i < months; i++) {
    const r = i + 24,
      dt = new Date(
        Date.UTC(
          Number(desde.slice(0, 4)),
          Number(desde.slice(5, 7)) - 1 + i,
          1,
        ),
      ),
      dstr = dt.toISOString().slice(0, 10),
      a = serial(dstr);
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    const b = serial(dt.toISOString().slice(0, 10));
    dash.getCell("A" + r).value = a;
    dash.getCell("A" + r).numFmt = "mmm-yyyy";
    for (const [col, dir] of [
      ["B", "venta"],
      ["C", "compra"],
    ]) {
      const val = docs
        .filter(
          (d) =>
            d.moneda === "PEN" &&
            d.direccion === dir &&
            serial(d.fecha) >= Math.max(start, a) &&
            serial(d.fecha) < Math.min(end + 1, b),
        )
        .reduce((n, d) => n + (d.base / 100) * (d.tipo === "07" ? -1 : 1), 0);
      f(
        dash,
        col + r,
        `SUMIFS('XML'!$X$5:$X$${endX},'XML'!$G$5:$G$${endX},"${dir}",'XML'!$H$5:$H$${endX},"PEN",'XML'!$B$5:$B$${endX},">="&MAX(A${r},$B$5),'XML'!$B$5:$B$${endX},"<"&MIN(EDATE(A${r},1),$B$6+1))`,
        val,
      );
    }
    f(
      dash,
      "D" + r,
      `B${r}-C${r}`,
      Number(dash.getCell("B" + r).result) -
        Number(dash.getCell("C" + r).result),
    );
  }
  dash.getCell("D23").value = "Ventas menos compras";
  for (const [name, dir] of [
    ["Registro ventas", "venta"],
    ["Registro compras", "compra"],
  ]) {
    const reg = s(name);
    let r = 5;
    docs.forEach((d, i) => {
      if (d.direccion !== dir) return;
      const xr = i + 5;
      for (const [out, src, key] of [
        ["A", "B", "fecha"],
        ["B", "C", "tipo"],
        ["C", "D", "numero"],
        ["D", "E", "emisor"],
        ["E", "F", "receptor"],
        ["F", "H", "moneda"],
        ["G", "X", "base"],
        ["H", "Y", "igv"],
        ["I", "Z", "total"],
        ["J", "P", "include"],
      ]) {
        let v = d[key];
        if (key === "fecha") v = serial(v);
        if (["base", "igv", "total"].includes(key))
          v = (v / 100) * (d.tipo === "07" ? -1 : 1);
        if (key === "include")
          v = d.moneda === "PEN" && !d.warnings.length ? 1 : 0;
        f(reg, out + r, `'XML'!${src}${xr}`, v);
      }
      r++;
    });
    // Totals never mix currencies; filtering is available per document and currency.
    reg.getCell("L4").value = "Moneda";
    reg.getCell("M4").value = "Total neto";
    [
      ...new Set(docs.filter((d) => d.direccion === dir).map((d) => d.moneda)),
    ].forEach((currency, i) => {
      const row = i + 5;
      reg.getCell("L" + row).value = currency;
      f(
        reg,
        "M" + row,
        `SUMIFS(I5:I${Math.max(5, r - 1)},F5:F${Math.max(5, r - 1)},L${row})`,
        docs
          .filter((d) => d.direccion === dir && d.moneda === currency)
          .reduce(
            (n, d) => n + (d.total / 100) * (d.tipo === "07" ? -1 : 1),
            0,
          ),
      );
    });
    finish(reg, ["G", "H", "I", "M"]);
    reg.getColumn("A").numFmt = "dd/mm/yyyy";
  }
  const major = s("Mayor"),
    running = {};
  lineValues.forEach((v, i) => {
    const r = i + 5;
    for (const [out, col, result] of [
      ["A", "E", v.account],
      ["B", "A", v.fecha],
      [
        "C",
        "C",
        s("Diario").getCell("C" + r).result ||
          s("Diario").getCell("C" + r).value,
      ],
      ["D", "D", ""],
      ["E", "F", v.debe],
      ["F", "G", v.haber],
    ])
      f(major, out + r, `'Diario'!${col}${r}`, result);
    if (v.fecha >= start && v.fecha <= end)
      running[v.account] = (running[v.account] || 0) + v.debe - v.haber;
    f(
      major,
      "G" + r,
      `SUMIFS($E$5:E${r},$A$5:A${r},A${r},$B$5:B${r},">="&'Dashboard'!$B$5,$B$5:B${r},"<="&'Dashboard'!$B$6)-SUMIFS($F$5:F${r},$A$5:A${r},A${r},$B$5:B${r},">="&'Dashboard'!$B$5,$B$5:B${r},"<="&'Dashboard'!$B$6)`,
      running[v.account] || 0,
    );
  });
  const notes = [
    ["Aviso", NOTICE],
    ["Empresa", empresa.nombre_cliente + " · " + empresa.ruc],
    [
      "Datos",
      `XML descargados desde ${desde} hasta ${hasta}. No se consultó SIRE. Los originales se conservan en Comprobantes de pago.`,
    ],
    [
      "Cómo corregir",
      "En XML, columnas azules: correcciones de importes (vacío conserva original, cero es válido), incluir 1/0, cuenta de naturaleza y crédito fiscal 1/0.",
    ],
    [
      "Asientos",
      "Las notas de crédito invierten el signo. Los documentos especiales y moneda extranjera se excluyen inicialmente de los asientos; permanecen en registros y observaciones.",
    ],
    [
      "Cuentas",
      "La cuenta de naturaleza es una propuesta. Revise compras de activos, servicios, mercaderías, IGV y motivos de notas.",
    ],
    [
      "Ajustes",
      "Hay 100 líneas editables para partidas adicionales. Ingrese ambos lados y compruebe el control Debe menos Haber. Se requieren fechas y cuentas existentes en PCGE.",
    ],
    [
      "Cobertura",
      "Balance y resultados simulan únicamente los movimientos del rango. Complete apertura, costo de ventas, inventarios, bancos, depreciaciones y ajustes. No es DJ anual.",
    ],
    [
      "Dashboard",
      "Cambie Desde/Hasta dentro del rango descargado. El gráfico compara bases netas en PEN, incluso documentos observados; ventas menos compras no es utilidad contable.",
    ],
    [
      "Archivos",
      "Cada libro es autónomo, sin enlaces externos. Las correcciones en un archivo no se sincronizan con los otros ni con la app. Use Estados financieros como archivo principal de trabajo.",
    ],
    [
      "Más filas",
      "Las fórmulas cubren los XML de esta descarga y 100 líneas de Ajustes. Para nuevos comprobantes, genere otro rango; no pegue nuevas filas fuera de esos límites.",
    ],
    ...issues.map((i) => [i.documento || i.etapa, i.mensaje]),
  ];
  notes.forEach((a, i) => (s("Instrucciones").getRow(i + 5).values = a));
  s("Instrucciones").getColumn("A").width = 26;
  s("Instrucciones").getColumn("B").width = 105;
  s("Instrucciones").eachRow((r, i) => {
    if (i > 4) {
      r.height = 50;
      r.getCell(2).alignment = { wrapText: true, vertical: "middle" };
    }
  });
  for (const [name, money] of [
    ["XML", ["I", "J", "K", "M", "N", "O", "T", "U", "V", "X", "Y", "Z"]],
    ["Diario", ["F", "G", "H"]],
    ["Mayor", ["E", "F", "G"]],
    ["Balance", ["D", "E", "F", "G", "I"]],
    ["Ajustes", ["D", "E"]],
    ["Estado resultados", ["B"]],
    ["PCGE", []],
  ])
    finish(s(name), money);
  for (const name of ["Diario", "Ajustes"])
    s(name).getColumn("A").numFmt = "dd/mm/yyyy;;;";
  x.getColumn("B").numFmt = "dd/mm/yyyy";
  major.getColumn("B").numFmt = "dd/mm/yyyy;;;";
  dash.getColumn("A").width = 48;
  for (const col of ["B", "C", "D"]) {
    dash.getColumn(col).width = 20;
    dash.getColumn(col).numFmt = amountFormat;
  }
  for (const c of ["B5", "B6"]) dash.getCell(c).numFmt = "dd/mm/yyyy";
  for (const c of ["B14", "B16"])
    dash.addConditionalFormatting({
      ref: c,
      rules: [
        {
          type: "cellIs",
          operator: "notEqual",
          formulae: [0],
          style: {
            fill: {
              type: "pattern",
              pattern: "solid",
              bgColor: { argb: "FFFFDDDD" },
            },
            font: { color: { argb: "FFAA0000" } },
          },
        },
      ],
    });
  x.getColumn("L").width = 45;
  x.getColumn("S").width = 55;
  s("Balance").getColumn("B").width = 44;
  s("Estado resultados").getColumn("A").width = 44;
  s("Balance general").getColumn("A").width = 48;
  s("Balance general").getColumn("B").numFmt = amountFormat;
  s("PCGE").getColumn("B").width = 45;
  s("Diario").getColumn("B").width = 34;
  x.getColumn("A").width = 34;
  for (const n of ["Diario", "Mayor"]) s(n).getColumn("D").width = 36;
  for (const [name, columns] of [
    ["XML", ["A", "C", "D", "E", "F", "Q"]],
    ["PCGE", ["A"]],
    ["Balance", ["A"]],
    ["Diario", ["B", "E"]],
    ["Mayor", ["A"]],
    ["Registro ventas", ["B", "C", "D", "E"]],
    ["Registro compras", ["B", "C", "D", "E"]],
  ])
    for (const col of columns) s(name).getColumn(col).numFmt = "@";
  adj.eachRow((row, i) => {
    if (i > 4)
      row.eachCell({ includeEmpty: true }, (c) => {
        c.font = { name: "Arial", size: 10, color: { argb: "FF0000FF" } };
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF5DD" },
        };
      });
  });
  s("Instrucciones").eachRow((row, i) => {
    if (i > 4) {
      row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
      row.height = 60;
    }
  });
  return addChart(
    await w.xlsx.writeBuffer(),
    ordered.indexOf("Dashboard") + 1,
    months,
  );
}
async function invoiceBook(d) {
  const w = new ExcelJS.Workbook();
  w.calcProperties = { fullCalcOnLoad: true };
  const s = sheet(w, "Comprobante", ["Descripción", "Base XML"], [90, 22]);
  s.getCell("A2").value = d.numero + " · " + d.moneda;
  s.getCell("A3").value =
    d.fecha + " · Emisor " + d.emisor + " · Receptor " + d.receptor;
  d.lines.forEach(
    (l, i) => (s.getRow(i + 5).values = [l.descripcion, l.base / 100]),
  );
  const r = d.lines.length + 5;
  s.getCell("A" + r).value = "Suma líneas";
  f(
    s,
    "B" + r,
    `SUM(B5:B${r - 1})`,
    d.lines.reduce((n, l) => n + l.base, 0) / 100,
  );
  s.getRow(r + 1).values = ["Base XML", d.base / 100];
  s.getRow(r + 2).values = ["IGV XML", d.igv / 100];
  s.getRow(r + 3).values = ["Total XML", d.total / 100];
  s.getCell("A" + (r + 4)).value = "Control base más IGV menos total";
  f(
    s,
    "B" + (r + 4),
    `B${r + 1}+B${r + 2}-B${r + 3}`,
    (d.base + d.igv - d.total) / 100,
  );
  s.getCell("A" + (r + 6)).value =
    "Representación Excel derivada del XML. Revise descuentos, cargos y otros tributos.";
  finish(s, ["B"]);
  return w.xlsx.writeBuffer();
}
module.exports = { simulationBook, invoiceBook, NOTICE, serial };
