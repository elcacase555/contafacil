// ============================================================
//  EXCEL CONSOLIDADO - Opción 4 del panel de cliente
// ============================================================
//
//  Genera un libro listo para contadores (Perú / PEN):
//   - Hoja "Datos": tabla Excel con números tipados y formato contabilidad
//   - Hoja "Tabla dinámica (precalculada)": matriz Mes × Tipo (emitida/recibida
//     y FE/NC/ND) calculada en Node (ExcelJS 4.4 no crea PivotTables nativas)
//   - Hoja "Dashboard": KPIs, desgloses y tipografía profesional
//   - Hoja "Cómo crear tabla dinámica": guía corta para pivot nativo en Excel
//
// ============================================================

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const ExcelJS = require('exceljs');

// Formato contabilidad (estilo Excel Accounting, compatible PEN/soles)
const FMT_CONTABILIDAD = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
const FMT_PORCENTAJE = '0.00%';
const FMT_FECHA = 'dd/mm/yyyy';

const COLOR = {
  azul: 'FF1F4E79',
  azulMedio: 'FF2E75B6',
  azulClaro: 'FFD6E3F0',
  grisClaro: 'FFF2F2F2',
  grisBorde: 'FFBFBFBF',
  blanco: 'FFFFFFFF',
  verdeSuave: 'FFE2EFDA',
  naranjaSuave: 'FFFCE4D6',
  kpiBorde: 'FF8FAADC',
};

function leerTexto(obj) {
  if (obj === undefined || obj === null) return '';
  if (typeof obj === 'string') return obj.trim();
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'object' && '#text' in obj) return String(obj['#text']).trim();
  return '';
}

function etiquetaDocumento(raiz) {
  if (raiz === 'CreditNote') return 'NC';
  if (raiz === 'DebitNote') return 'ND';
  return 'FE';
}

function parsearXML(rutaXml, nombreMes, etiquetaTipo) {
  const xmlContent = fs.readFileSync(rutaXml, 'latin1');

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
  });

  const data = parser.parse(xmlContent);

  // UBL: Invoice / CreditNote / DebitNote
  let inv, nombreLinea, raiz;
  if (data.Invoice) {
    inv = data.Invoice;
    nombreLinea = 'InvoiceLine';
    raiz = 'Invoice';
  } else if (data.CreditNote) {
    inv = data.CreditNote;
    nombreLinea = 'CreditNoteLine';
    raiz = 'CreditNote';
  } else if (data.DebitNote) {
    inv = data.DebitNote;
    nombreLinea = 'DebitNoteLine';
    raiz = 'DebitNote';
  } else {
    throw new Error('Formato de XML no reconocido (no es Invoice, CreditNote ni DebitNote).');
  }

  const notes = Array.isArray(inv.Note) ? inv.Note : (inv.Note ? [inv.Note] : []);
  const montoLetras = notes.map(leerTexto).find(n => n.toUpperCase().includes('SON:')) || '';

  const emisor = inv.AccountingSupplierParty?.Party || {};
  const cliente = inv.AccountingCustomerParty?.Party || {};

  const rucEmisor = leerTexto(emisor.PartyIdentification?.ID);
  const razonEmisor = leerTexto(emisor.PartyLegalEntity?.RegistrationName);
  const rucCliente = leerTexto(cliente.PartyIdentification?.ID);
  const razonCliente = leerTexto(cliente.PartyLegalEntity?.RegistrationName);

  const totales = inv.LegalMonetaryTotal || {};
  const subTotal = parseFloat(leerTexto(totales.LineExtensionAmount)) || 0;
  const total = parseFloat(leerTexto(totales.PayableAmount)) || 0;

  const taxTotal = inv.TaxTotal || {};
  const igv = parseFloat(leerTexto(taxTotal.TaxAmount)) || 0;

  const paymentTerms = Array.isArray(inv.PaymentTerms) ? inv.PaymentTerms : (inv.PaymentTerms ? [inv.PaymentTerms] : []);
  const detraccionTerm = paymentTerms.find(p => leerTexto(p.ID) === 'Detraccion');
  const formaPagoTerm = paymentTerms.find(p => leerTexto(p.ID) === 'FormaPago');

  const pctDetraccion = detraccionTerm ? parseFloat(leerTexto(detraccionTerm.PaymentPercent)) || 0 : 0;
  const montoDetraccion = detraccionTerm ? parseFloat(leerTexto(detraccionTerm.Amount)) || 0 : 0;
  const formaPago = formaPagoTerm ? leerTexto(formaPagoTerm.PaymentMeansID) : '';

  const lineas = Array.isArray(inv[nombreLinea]) ? inv[nombreLinea] : (inv[nombreLinea] ? [inv[nombreLinea]] : []);
  const descripciones = lineas.map(l => leerTexto(l.Item?.Description)).filter(Boolean).join(' | ');

  const fechaEmisionStr = leerTexto(inv.IssueDate);
  const fechaEmision = fechaEmisionStr ? new Date(fechaEmisionStr) : null;

  const tipoDoc = etiquetaDocumento(raiz);
  const sentido = String(etiquetaTipo || '').toLowerCase().includes('recib') ? 'Recibida' : 'Emitida';

  return {
    tipo: sentido, // Emitida / Recibida
    tipoDoc, // FE / NC / ND
    mes: nombreMes,
    archivo: path.basename(rutaXml),
    nroFactura: leerTexto(inv.ID),
    fechaEmision,
    moneda: leerTexto(inv.DocumentCurrencyCode),
    rucEmisor,
    razonEmisor,
    rucCliente,
    razonCliente,
    formaPago,
    descripcion: descripciones,
    subTotal,
    igv,
    total,
    pctDetraccion,
    montoDetraccion,
    netoPagar: total - montoDetraccion,
    montoLetras,
  };
}

function aplicarBordeFino(celda) {
  celda.border = {
    top: { style: 'thin', color: { argb: COLOR.grisBorde } },
    bottom: { style: 'thin', color: { argb: COLOR.grisBorde } },
    left: { style: 'thin', color: { argb: COLOR.grisBorde } },
    right: { style: 'thin', color: { argb: COLOR.grisBorde } },
  };
}

function estiloTituloSeccion(celda, texto) {
  celda.value = texto;
  celda.font = { bold: true, color: { argb: COLOR.blanco }, size: 12, name: 'Calibri' };
  celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.azul } };
  celda.alignment = { horizontal: 'left', vertical: 'middle' };
}

function estiloEncabezado(celda, texto) {
  celda.value = texto;
  celda.font = { bold: true, name: 'Calibri', size: 10, color: { argb: COLOR.azul } };
  celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.azulClaro } };
  celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  aplicarBordeFino(celda);
}

function estiloMonto(celda, valor) {
  celda.value = typeof valor === 'number' ? valor : 0;
  celda.numFmt = FMT_CONTABILIDAD;
  celda.font = { name: 'Calibri', size: 10 };
  celda.alignment = { horizontal: 'right' };
  aplicarBordeFino(celda);
}

function estiloNumero(celda, valor) {
  celda.value = typeof valor === 'number' ? valor : 0;
  celda.font = { name: 'Calibri', size: 10 };
  celda.alignment = { horizontal: 'center' };
  aplicarBordeFino(celda);
}

function estiloTexto(celda, valor) {
  celda.value = valor == null ? '' : valor;
  celda.font = { name: 'Calibri', size: 10 };
  aplicarBordeFino(celda);
}

function esEmitida(f) {
  return String(f.tipo || '').toLowerCase().includes('emit');
}

function esRecibida(f) {
  return String(f.tipo || '').toLowerCase().includes('recib');
}

function periodoLabel(facturas) {
  const fechas = facturas.map(f => f.fechaEmision).filter(Boolean).sort((a, b) => a - b);
  if (fechas.length === 0) {
    const meses = [...new Set(facturas.map(f => f.mes).filter(Boolean))];
    return meses.length ? meses.join(', ') : 'N/D';
  }
  const fmt = (d) => {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  const a = fmt(fechas[0]);
  const b = fmt(fechas[fechas.length - 1]);
  return a === b ? a : `${a} — ${b}`;
}

// ── HOJA 1: Datos (tabla con formato contabilidad) ──────────
function crearHojaDatos(wb, facturas) {
  const ws = wb.addWorksheet('Datos');

  const columnasDef = [
    { name: 'Tipo', width: 11 },
    { name: 'Tipo Doc', width: 10 },
    { name: 'Mes', width: 18 },
    { name: 'N° Factura', width: 14 },
    { name: 'Fecha Emisión', width: 14 },
    { name: 'RUC Emisor', width: 13 },
    { name: 'Razón Social Emisor', width: 38 },
    { name: 'RUC Cliente', width: 13 },
    { name: 'Razón Social Cliente', width: 38 },
    { name: 'Descripción', width: 50 },
    { name: 'Moneda', width: 9 },
    { name: 'Forma de Pago', width: 14 },
    { name: 'Sub Total', width: 14 },
    { name: 'IGV', width: 13 },
    { name: 'Importe Total', width: 14 },
    { name: '% Detracción', width: 12 },
    { name: 'Monto Detracción', width: 15 },
    { name: 'Neto a Pagar', width: 14 },
    { name: 'Archivo XML', width: 30 },
  ];

  columnasDef.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const filas = facturas.map(f => [
    f.tipo, f.tipoDoc, f.mes, f.nroFactura, f.fechaEmision, f.rucEmisor, f.razonEmisor,
    f.rucCliente, f.razonCliente, f.descripcion, f.moneda, f.formaPago,
    f.subTotal, f.igv, f.total, f.pctDetraccion / 100, f.montoDetraccion,
    f.netoPagar, f.archivo,
  ]);

  // Índices 0-based de columnas de montos (para totales de tabla)
  const indicesMontos = [12, 13, 14, 16, 17];

  ws.addTable({
    name: 'TablaDatos',
    ref: 'A1',
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columnasDef.map((c, i) => {
      const col = { name: c.name, filterButton: true };
      if (indicesMontos.includes(i)) col.totalsRowFunction = 'sum';
      if (i === 0) col.totalsRowLabel = 'Totales';
      return col;
    }),
    rows: filas,
  });

  const totalFilas = filas.length;
  for (let r = 2; r <= totalFilas + 1; r++) {
    ws.getCell(`E${r}`).numFmt = FMT_FECHA;
    ws.getCell(`M${r}`).numFmt = FMT_CONTABILIDAD;
    ws.getCell(`N${r}`).numFmt = FMT_CONTABILIDAD;
    ws.getCell(`O${r}`).numFmt = FMT_CONTABILIDAD;
    ws.getCell(`P${r}`).numFmt = FMT_PORCENTAJE;
    ws.getCell(`Q${r}`).numFmt = FMT_CONTABILIDAD;
    ws.getCell(`R${r}`).numFmt = FMT_CONTABILIDAD;
  }
  const filaTotales = totalFilas + 2;
  ['M', 'N', 'O', 'Q', 'R'].forEach(col => {
    ws.getCell(`${col}${filaTotales}`).numFmt = FMT_CONTABILIDAD;
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = undefined; // ya viene con filterButton de la tabla
}

// ── HOJA 2: Tabla dinámica precalculada (Mes × Tipo Doc / Sentido) ──
function crearHojaTablaDinamica(wb, facturas) {
  const ws = wb.addWorksheet('Tabla dinámica (precalculada)');
  ws.getColumn(1).width = 22;

  let fila = 1;
  ws.mergeCells(fila, 1, fila, 8);
  estiloTituloSeccion(ws.getCell(fila, 1), 'TABLA DINÁMICA (PRECALCULADA) — se regenera al volver a descargar');
  ws.getRow(fila).height = 24;
  fila += 2;

  ws.mergeCells(fila, 1, fila, 8);
  const nota = ws.getCell(fila, 1);
  nota.value = 'Nota: ExcelJS no crea PivotTables nativas de Excel. Esta hoja es una matriz agregada en Node (Mes × Tipo). Para una pivot real: ve a Datos → Insertar → Tabla dinámica.';
  nota.font = { italic: true, size: 9, color: { argb: 'FF666666' }, name: 'Calibri' };
  nota.alignment = { wrapText: true };
  ws.getRow(fila).height = 32;
  fila += 2;

  // --- Matriz 1: Mes × Sentido (Emitida/Recibida) con Importe Total ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Importe Total por Mes × Sentido (Emitida / Recibida)');
  ws.getRow(fila).height = 22;
  fila += 1;

  const sentidos = [...new Set(facturas.map(f => f.tipo))].sort();
  const mesesOrden = [...new Set(facturas.map(f => f.mes))];

  const matrixSentido = {};
  for (const f of facturas) {
    if (!matrixSentido[f.mes]) matrixSentido[f.mes] = {};
    if (!matrixSentido[f.mes][f.tipo]) matrixSentido[f.mes][f.tipo] = { total: 0, cantidad: 0 };
    matrixSentido[f.mes][f.tipo].total += f.total;
    matrixSentido[f.mes][f.tipo].cantidad += 1;
  }

  estiloEncabezado(ws.getCell(fila, 1), 'Mes');
  sentidos.forEach((s, i) => {
    ws.getColumn(i + 2).width = 16;
    estiloEncabezado(ws.getCell(fila, i + 2), s);
  });
  estiloEncabezado(ws.getCell(fila, sentidos.length + 2), 'Total');
  ws.getColumn(sentidos.length + 2).width = 16;
  fila++;

  const totalesColSentido = {};
  sentidos.forEach(s => { totalesColSentido[s] = 0; });
  let granTotalSentido = 0;

  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    let filaTotal = 0;
    sentidos.forEach((s, i) => {
      const v = (matrixSentido[mes] && matrixSentido[mes][s]) ? matrixSentido[mes][s].total : 0;
      estiloMonto(ws.getCell(fila, i + 2), v);
      totalesColSentido[s] += v;
      filaTotal += v;
    });
    estiloMonto(ws.getCell(fila, sentidos.length + 2), filaTotal);
    granTotalSentido += filaTotal;
    fila++;
  }

  estiloTexto(ws.getCell(fila, 1), 'TOTAL');
  ws.getCell(fila, 1).font = { bold: true, name: 'Calibri', size: 10 };
  sentidos.forEach((s, i) => estiloMonto(ws.getCell(fila, i + 2), totalesColSentido[s]));
  estiloMonto(ws.getCell(fila, sentidos.length + 2), granTotalSentido);
  fila += 3;

  // --- Matriz 2: Mes × Tipo Doc (FE/NC/ND) ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Importe Total por Mes × Tipo Doc (FE / NC / ND)');
  ws.getRow(fila).height = 22;
  fila += 1;

  const tiposDoc = ['FE', 'NC', 'ND'].filter(td => facturas.some(f => f.tipoDoc === td));
  const matrixDoc = {};
  for (const f of facturas) {
    if (!matrixDoc[f.mes]) matrixDoc[f.mes] = {};
    if (!matrixDoc[f.mes][f.tipoDoc]) matrixDoc[f.mes][f.tipoDoc] = 0;
    matrixDoc[f.mes][f.tipoDoc] += f.total;
  }

  estiloEncabezado(ws.getCell(fila, 1), 'Mes');
  tiposDoc.forEach((td, i) => {
    ws.getColumn(i + 2).width = Math.max(ws.getColumn(i + 2).width || 12, 14);
    estiloEncabezado(ws.getCell(fila, i + 2), td);
  });
  estiloEncabezado(ws.getCell(fila, tiposDoc.length + 2), 'Total');
  fila++;

  const totalesColDoc = {};
  tiposDoc.forEach(td => { totalesColDoc[td] = 0; });
  let granTotalDoc = 0;

  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    let filaTotal = 0;
    tiposDoc.forEach((td, i) => {
      const v = (matrixDoc[mes] && matrixDoc[mes][td]) ? matrixDoc[mes][td] : 0;
      estiloMonto(ws.getCell(fila, i + 2), v);
      totalesColDoc[td] += v;
      filaTotal += v;
    });
    estiloMonto(ws.getCell(fila, tiposDoc.length + 2), filaTotal);
    granTotalDoc += filaTotal;
    fila++;
  }

  estiloTexto(ws.getCell(fila, 1), 'TOTAL');
  ws.getCell(fila, 1).font = { bold: true, name: 'Calibri', size: 10 };
  tiposDoc.forEach((td, i) => estiloMonto(ws.getCell(fila, i + 2), totalesColDoc[td]));
  estiloMonto(ws.getCell(fila, tiposDoc.length + 2), granTotalDoc);
  fila += 3;

  // --- Matriz 3: cantidad de comprobantes Mes × Sentido ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Cantidad de comprobantes por Mes × Sentido');
  ws.getRow(fila).height = 22;
  fila += 1;

  estiloEncabezado(ws.getCell(fila, 1), 'Mes');
  sentidos.forEach((s, i) => estiloEncabezado(ws.getCell(fila, i + 2), s));
  estiloEncabezado(ws.getCell(fila, sentidos.length + 2), 'Total');
  fila++;

  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    let filaCant = 0;
    sentidos.forEach((s, i) => {
      const v = (matrixSentido[mes] && matrixSentido[mes][s]) ? matrixSentido[mes][s].cantidad : 0;
      estiloNumero(ws.getCell(fila, i + 2), v);
      filaCant += v;
    });
    estiloNumero(ws.getCell(fila, sentidos.length + 2), filaCant);
    fila++;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── HOJA 3: Dashboard profesional ───────────────────────────
function crearHojaDashboard(wb, facturas) {
  const ws = wb.addWorksheet('Dashboard', {
    properties: { tabColor: { argb: COLOR.azulMedio } },
  });

  [28, 16, 16, 16, 16, 18, 22, 14, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // Título
  ws.mergeCells('A1:I1');
  const titulo = ws.getCell('A1');
  titulo.value = 'ContaFácil — Dashboard consolidado';
  titulo.font = { bold: true, size: 18, color: { argb: COLOR.blanco }, name: 'Calibri' };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.azul } };
  titulo.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:I2');
  const sub = ws.getCell('A2');
  sub.value = `Generado: ${new Date().toLocaleString('es-PE')}  ·  Formato montos: Contabilidad (PEN)  ·  Fuente: hoja Datos`;
  sub.font = { size: 9, italic: true, color: { argb: 'FF666666' }, name: 'Calibri' };
  ws.getRow(2).height = 18;

  // KPIs
  const emitidas = facturas.filter(esEmitida);
  const recibidas = facturas.filter(esRecibida);
  const totalEmitidas = emitidas.reduce((s, f) => s + f.total, 0);
  const totalRecibidas = recibidas.reduce((s, f) => s + f.total, 0);
  const totalNeto = totalEmitidas - totalRecibidas;
  const cantidad = facturas.length;
  const periodo = periodoLabel(facturas);

  const kpis = [
    { label: 'Total emitidas (S/)', value: totalEmitidas, isMoney: true, fill: COLOR.verdeSuave },
    { label: 'Total recibidas (S/)', value: totalRecibidas, isMoney: true, fill: COLOR.naranjaSuave },
    { label: 'Total neto (S/)', value: totalNeto, isMoney: true, fill: COLOR.azulClaro },
    { label: 'Cantidad comprobantes', value: cantidad, isMoney: false, fill: COLOR.grisClaro },
    { label: 'Periodo', value: periodo, isMoney: false, fill: COLOR.grisClaro, isText: true },
  ];

  let col = 1;
  for (const kpi of kpis) {
    const cLabel = ws.getCell(4, col);
    const cValue = ws.getCell(5, col);
    ws.mergeCells(4, col, 4, col);
    cLabel.value = kpi.label;
    cLabel.font = { bold: true, size: 9, color: { argb: COLOR.azul }, name: 'Calibri' };
    cLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.fill } };
    cLabel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    aplicarBordeFino(cLabel);

    if (kpi.isText) {
      cValue.value = kpi.value;
      cValue.numFmt = '@';
      cValue.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    } else if (kpi.isMoney) {
      cValue.value = kpi.value;
      cValue.numFmt = FMT_CONTABILIDAD;
      cValue.alignment = { horizontal: 'center', vertical: 'middle' };
    } else {
      cValue.value = kpi.value;
      cValue.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    cValue.font = { bold: true, size: 14, color: { argb: COLOR.azul }, name: 'Calibri' };
    cValue.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.blanco } };
    aplicarBordeFino(cValue);
    ws.getColumn(col).width = Math.max(ws.getColumn(col).width || 14, 18);
    col += 1;
  }
  ws.getRow(4).height = 28;
  ws.getRow(5).height = 28;

  // Área de gráficos (ExcelJS 4.4 no genera charts nativos)
  ws.mergeCells('A7:E7');
  estiloTituloSeccion(ws.getCell('A7'), 'Área de gráficos (opcional en Excel)');
  ws.getRow(7).height = 22;
  ws.mergeCells('A8:E10');
  const chartHint = ws.getCell('A8');
  chartHint.value = [
    'ExcelJS no inserta gráficos nativos en esta versión.',
    'Sugerencia rápida: selecciona la matriz de "Tabla dinámica (precalculada)" → Insertar → Gráfico de columnas o barras.',
    'También puedes usar Insertar → Tabla dinámica sobre la hoja Datos para segmentadores (slicers).',
  ].join('\n');
  chartHint.alignment = { wrapText: true, vertical: 'top' };
  chartHint.font = { size: 9, name: 'Calibri', color: { argb: 'FF555555' } };
  chartHint.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
  aplicarBordeFino(chartHint);

  // --- Por mes ---
  let fila = 12;
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Desglose por mes');
  ws.getRow(fila).height = 22;
  fila++;

  ['Mes', 'N° comprobantes', 'Emitidas S/', 'Recibidas S/', 'Total S/', 'IGV S/'].forEach((h, i) => {
    estiloEncabezado(ws.getCell(fila, i + 1), h);
  });
  fila++;

  const porMes = {};
  for (const f of facturas) {
    if (!porMes[f.mes]) porMes[f.mes] = { cantidad: 0, emitidas: 0, recibidas: 0, total: 0, igv: 0 };
    porMes[f.mes].cantidad++;
    porMes[f.mes].total += f.total;
    porMes[f.mes].igv += f.igv;
    if (esEmitida(f)) porMes[f.mes].emitidas += f.total;
    if (esRecibida(f)) porMes[f.mes].recibidas += f.total;
  }

  for (const [mes, d] of Object.entries(porMes)) {
    estiloTexto(ws.getCell(fila, 1), mes);
    estiloNumero(ws.getCell(fila, 2), d.cantidad);
    estiloMonto(ws.getCell(fila, 3), d.emitidas);
    estiloMonto(ws.getCell(fila, 4), d.recibidas);
    estiloMonto(ws.getCell(fila, 5), d.total);
    estiloMonto(ws.getCell(fila, 6), d.igv);
    fila++;
  }

  fila += 2;
  // --- Por tipo doc ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Desglose por tipo de documento (FE / NC / ND)');
  ws.getRow(fila).height = 22;
  fila++;

  ['Tipo Doc', 'N° comprobantes', 'Total S/', 'IGV S/', 'Neto a pagar S/'].forEach((h, i) => {
    estiloEncabezado(ws.getCell(fila, i + 1), h);
  });
  fila++;

  const porDoc = {};
  for (const f of facturas) {
    const k = f.tipoDoc || 'FE';
    if (!porDoc[k]) porDoc[k] = { cantidad: 0, total: 0, igv: 0, neto: 0 };
    porDoc[k].cantidad++;
    porDoc[k].total += f.total;
    porDoc[k].igv += f.igv;
    porDoc[k].neto += f.netoPagar;
  }
  for (const [td, d] of Object.entries(porDoc)) {
    estiloTexto(ws.getCell(fila, 1), td);
    estiloNumero(ws.getCell(fila, 2), d.cantidad);
    estiloMonto(ws.getCell(fila, 3), d.total);
    estiloMonto(ws.getCell(fila, 4), d.igv);
    estiloMonto(ws.getCell(fila, 5), d.neto);
    fila++;
  }

  fila += 2;
  // --- Por sentido ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Desglose por sentido (Emitida / Recibida)');
  ws.getRow(fila).height = 22;
  fila++;

  ['Tipo', 'N° comprobantes', 'Total S/', 'IGV S/', 'Neto a pagar S/'].forEach((h, i) => {
    estiloEncabezado(ws.getCell(fila, i + 1), h);
  });
  fila++;

  const porTipo = {};
  for (const f of facturas) {
    if (!porTipo[f.tipo]) porTipo[f.tipo] = { cantidad: 0, total: 0, igv: 0, neto: 0 };
    porTipo[f.tipo].cantidad++;
    porTipo[f.tipo].total += f.total;
    porTipo[f.tipo].igv += f.igv;
    porTipo[f.tipo].neto += f.netoPagar;
  }
  for (const [tipo, d] of Object.entries(porTipo)) {
    estiloTexto(ws.getCell(fila, 1), tipo);
    estiloNumero(ws.getCell(fila, 2), d.cantidad);
    estiloMonto(ws.getCell(fila, 3), d.total);
    estiloMonto(ws.getCell(fila, 4), d.igv);
    estiloMonto(ws.getCell(fila, 5), d.neto);
    fila++;
  }

  // Top clientes (emitidas → razón cliente) y top proveedores (recibidas → razón emisor)
  fila += 2;
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Top 10 clientes (comprobantes emitidos)');
  ws.getRow(fila).height = 22;
  fila++;
  ['RUC', 'Razón social', 'N°', 'Total S/', 'IGV S/'].forEach((h, i) => estiloEncabezado(ws.getCell(fila, i + 1), h));
  fila++;

  const topClientes = {};
  for (const f of emitidas) {
    const clave = f.rucCliente || 'Sin RUC';
    if (!topClientes[clave]) topClientes[clave] = { razon: f.razonCliente, cantidad: 0, total: 0, igv: 0 };
    topClientes[clave].cantidad++;
    topClientes[clave].total += f.total;
    topClientes[clave].igv += f.igv;
  }
  const rankingClientes = Object.entries(topClientes)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  if (rankingClientes.length === 0) {
    estiloTexto(ws.getCell(fila, 1), '(Sin emitidas en este consolidado)');
    fila++;
  } else {
    for (const [ruc, d] of rankingClientes) {
      estiloTexto(ws.getCell(fila, 1), ruc);
      estiloTexto(ws.getCell(fila, 2), d.razon);
      estiloNumero(ws.getCell(fila, 3), d.cantidad);
      estiloMonto(ws.getCell(fila, 4), d.total);
      estiloMonto(ws.getCell(fila, 5), d.igv);
      fila++;
    }
  }

  fila += 2;
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Top 10 proveedores (comprobantes recibidos)');
  ws.getRow(fila).height = 22;
  fila++;
  ['RUC', 'Razón social', 'N°', 'Total S/', 'IGV S/'].forEach((h, i) => estiloEncabezado(ws.getCell(fila, i + 1), h));
  fila++;

  const topProv = {};
  for (const f of recibidas) {
    const clave = f.rucEmisor || 'Sin RUC';
    if (!topProv[clave]) topProv[clave] = { razon: f.razonEmisor, cantidad: 0, total: 0, igv: 0 };
    topProv[clave].cantidad++;
    topProv[clave].total += f.total;
    topProv[clave].igv += f.igv;
  }
  const rankingProv = Object.entries(topProv)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  if (rankingProv.length === 0) {
    estiloTexto(ws.getCell(fila, 1), '(Sin recibidas en este consolidado)');
    fila++;
  } else {
    for (const [ruc, d] of rankingProv) {
      estiloTexto(ws.getCell(fila, 1), ruc);
      estiloTexto(ws.getCell(fila, 2), d.razon);
      estiloNumero(ws.getCell(fila, 3), d.cantidad);
      estiloMonto(ws.getCell(fila, 4), d.total);
      estiloMonto(ws.getCell(fila, 5), d.igv);
      fila++;
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── HOJA 4: instrucciones para pivot nativo ─────────────────
function crearHojaInstrucciones(wb) {
  const ws = wb.addWorksheet('Cómo crear tabla dinámica');
  ws.columns = [{ width: 95 }];

  const pasos = [
    'CÓMO CREAR UNA TABLA DINÁMICA NATIVA DE EXCEL (opcional)',
    '',
    'Este archivo ya incluye:',
    '  • Hoja "Datos" — tabla filtrable con formato contabilidad',
    '  • Hoja "Tabla dinámica (precalculada)" — matrices Mes × Tipo listas para usar',
    '  • Hoja "Dashboard" — KPIs y desgloses profesionales',
    '',
    'Si además quieres una PivotTable nativa de Excel (con segmentadores):',
    '1. Ve a la hoja "Datos" y haz clic en cualquier celda de la tabla.',
    '2. Insertar → Tabla dinámica → Aceptar (elige hoja nueva).',
    '3. En el panel de campos:',
    '   - FILAS: Mes o Razón Social Cliente / Emisor',
    '   - COLUMNAS: Tipo o Tipo Doc',
    '   - VALORES: Importe Total (o IGV / Neto a Pagar)',
    '   - FILTROS: Tipo, Tipo Doc, Moneda',
    '4. (Excel Windows/Mac) Insertar → Segmentación de datos para filtros visuales.',
    '',
    'Los montos usan formato Contabilidad: _(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
    'La hoja precalculada se actualiza al volver a ejecutar la descarga consolidada.',
  ];

  pasos.forEach((texto, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = texto;
    c.alignment = { wrapText: true };
    c.font = { name: 'Calibri', size: i === 0 ? 13 : 10, bold: i === 0 };
    if (i === 0) c.font.color = { argb: COLOR.azul };
  });
}

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────
async function generarExcelConsolidado(fuentes, carpetaDestino, onProgreso, nombreArchivoBase = 'Excel Consolidado') {
  function avisar(mensaje, extra = {}) {
    console.log(mensaje);
    if (typeof onProgreso === 'function') onProgreso({ mensaje, ...extra });
  }

  if (typeof fuentes === 'string') {
    fuentes = [{ carpetaXml: fuentes, etiquetaTipo: 'Emitida' }];
  }

  avisar('🚀 Generando Excel consolidado...', { etapa: 'inicio' });

  if (!fs.existsSync(carpetaDestino)) fs.mkdirSync(carpetaDestino, { recursive: true });

  const facturas = [];

  for (const fuente of fuentes) {
    const { carpetaXml, etiquetaTipo } = fuente;

    if (!fs.existsSync(carpetaXml)) {
      avisar(`⚠️  No existe la carpeta de XML: ${carpetaXml}`, { etapa: 'carpeta_faltante' });
      continue;
    }

    const carpetasMes = fs.readdirSync(carpetaXml)
      .filter(c => fs.statSync(path.join(carpetaXml, c)).isDirectory())
      .sort();

    for (const carpetaMes of carpetasMes) {
      const rutaCarpetaMes = path.join(carpetaXml, carpetaMes);
      const xmls = fs.readdirSync(rutaCarpetaMes).filter(f => f.toUpperCase().endsWith('.XML'));

      if (xmls.length === 0) {
        avisar(`⚠️  Sin XML en: ${etiquetaTipo} - ${carpetaMes}`, { etapa: 'mes_vacio', mes: carpetaMes });
        continue;
      }

      avisar(`📁 ${etiquetaTipo} - ${carpetaMes} (${xmls.length} XML)`, { etapa: 'mes_inicio', mes: carpetaMes, total: xmls.length });

      for (const xmlFile of xmls) {
        try {
          const rutaXml = path.join(rutaCarpetaMes, xmlFile);
          const datos = parsearXML(rutaXml, carpetaMes, etiquetaTipo);
          facturas.push(datos);
        } catch (err) {
          avisar(`  ❌ Error leyendo ${xmlFile}: ${err.message}`, { etapa: 'error', mes: carpetaMes });
        }
      }
    }
  }

  if (facturas.length === 0) {
    throw new Error('No se encontró ninguna factura XML para consolidar.');
  }

  facturas.sort((a, b) => {
    if (!a.fechaEmision) return 1;
    if (!b.fechaEmision) return -1;
    return a.fechaEmision - b.fechaEmision;
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFácil';
  wb.created = new Date();

  crearHojaDatos(wb, facturas);
  crearHojaTablaDinamica(wb, facturas);
  crearHojaDashboard(wb, facturas);
  crearHojaInstrucciones(wb);

  const nombreArchivo = `${nombreArchivoBase} ${new Date().getFullYear()}.xlsx`;
  const rutaFinal = path.join(carpetaDestino, nombreArchivo);
  await wb.xlsx.writeFile(rutaFinal);

  avisar(`🎉 Consolidado creado: ${facturas.length} facturas en ${rutaFinal}`, {
    etapa: 'completado', total: facturas.length, carpeta: carpetaDestino, archivo: rutaFinal,
  });

  return { total: facturas.length, carpeta: carpetaDestino, archivo: rutaFinal };
}

module.exports = { generarExcelConsolidado, FMT_CONTABILIDAD };
