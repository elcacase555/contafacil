// ============================================================
//  EXCEL CONSOLIDADO - Opción 4 del panel de cliente
// ============================================================
//
//  Genera un libro listo para contadores (Perú / PEN):
//   - Hoja "Datos": tabla Excel TablaDatos + formato Contabilidad S/
//   - Hoja "Tabla dinámica": matrices Mes × Tipo con fórmulas SUMIFS/COUNTIFS
//   - Hoja "Dashboard": KPIs y desgloses con fórmulas vinculadas a TablaDatos
//   - Hoja "Tips": tip breve (opcional)
//
// ============================================================

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const ExcelJS = require('exceljs');

// Formato Contabilidad Excel con símbolo S/ (Accounting-style)
const FMT_CONTABILIDAD = '_("S/"* #,##0.00_);_("S/"* (#,##0.00);_("S/"* "-"??_);_(@_)';
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

function estiloMontoFormula(celda, formula) {
  celda.value = { formula };
  celda.numFmt = FMT_CONTABILIDAD;
  celda.font = { name: 'Calibri', size: 10 };
  celda.alignment = { horizontal: 'right' };
  aplicarBordeFino(celda);
}

function estiloNumeroFormula(celda, formula) {
  celda.value = { formula };
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

// ── HOJA 2: Tabla dinámica por fórmulas (referencias a TablaDatos) ──
function crearHojaTablaDinamica(wb, facturas) {
  const ws = wb.addWorksheet('Tabla dinámica');
  ws.getColumn(1).width = 22;

  let fila = 1;
  ws.mergeCells(fila, 1, fila, 8);
  estiloTituloSeccion(ws.getCell(fila, 1), 'TABLA DINÁMICA — valores con fórmulas vinculadas a Datos (TablaDatos)');
  ws.getRow(fila).height = 24;
  fila += 2;

  ws.mergeCells(fila, 1, fila, 8);
  const nota = ws.getCell(fila, 1);
  nota.value = 'Los encabezados (meses/tipos) se listan al generar el archivo; cada celda de importe/cantidad es una fórmula SUMIFS/COUNTIFS sobre TablaDatos. Si editas Datos en Excel, estos totales se recalculan.';
  nota.font = { italic: true, size: 9, color: { argb: 'FF666666' }, name: 'Calibri' };
  nota.alignment = { wrapText: true };
  ws.getRow(fila).height = 32;
  fila += 2;

  const sentidos = [...new Set(facturas.map(f => f.tipo))].sort();
  const mesesOrden = [...new Set(facturas.map(f => f.mes))];
  const tiposDoc = ['FE', 'NC', 'ND'].filter(td => facturas.some(f => f.tipoDoc === td));

  // --- Matriz 1: Mes × Sentido (Importe Total) ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Importe Total por Mes × Sentido (Emitida / Recibida)');
  ws.getRow(fila).height = 22;
  fila += 1;

  const headerSentido = fila;
  estiloEncabezado(ws.getCell(fila, 1), 'Mes');
  sentidos.forEach((s, i) => {
    ws.getColumn(i + 2).width = 16;
    estiloEncabezado(ws.getCell(fila, i + 2), s);
  });
  estiloEncabezado(ws.getCell(fila, sentidos.length + 2), 'Total');
  ws.getColumn(sentidos.length + 2).width = 16;
  fila++;

  const primeraFilaSentido = fila;
  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    sentidos.forEach((s, i) => {
      const colLetter = ws.getCell(headerSentido, i + 2).address.replace(/\d+/, '');
      const formula = `SUMIFS(TablaDatos[Importe Total],TablaDatos[Mes],A${fila},TablaDatos[Tipo],${colLetter}$${headerSentido})`;
      estiloMontoFormula(ws.getCell(fila, i + 2), formula);
    });
    const colInicio = ws.getCell(fila, 2).address;
    const colFin = ws.getCell(fila, sentidos.length + 1).address;
    estiloMontoFormula(ws.getCell(fila, sentidos.length + 2), `SUM(${colInicio}:${colFin})`);
    fila++;
  }
  const ultimaFilaSentido = fila - 1;

  estiloTexto(ws.getCell(fila, 1), 'TOTAL');
  ws.getCell(fila, 1).font = { bold: true, name: 'Calibri', size: 10 };
  sentidos.forEach((s, i) => {
    const colLetter = ws.getCell(headerSentido, i + 2).address.replace(/\d+/, '');
    estiloMontoFormula(ws.getCell(fila, i + 2), `SUM(${colLetter}${primeraFilaSentido}:${colLetter}${ultimaFilaSentido})`);
  });
  {
    const colLetter = ws.getCell(headerSentido, sentidos.length + 2).address.replace(/\d+/, '');
    estiloMontoFormula(ws.getCell(fila, sentidos.length + 2), `SUM(${colLetter}${primeraFilaSentido}:${colLetter}${ultimaFilaSentido})`);
  }
  fila += 3;

  // --- Matriz 2: Mes × Tipo Doc ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Importe Total por Mes × Tipo Doc (FE / NC / ND)');
  ws.getRow(fila).height = 22;
  fila += 1;

  const headerDoc = fila;
  estiloEncabezado(ws.getCell(fila, 1), 'Mes');
  tiposDoc.forEach((td, i) => {
    ws.getColumn(i + 2).width = Math.max(ws.getColumn(i + 2).width || 12, 14);
    estiloEncabezado(ws.getCell(fila, i + 2), td);
  });
  estiloEncabezado(ws.getCell(fila, tiposDoc.length + 2), 'Total');
  fila++;

  const primeraFilaDoc = fila;
  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    tiposDoc.forEach((td, i) => {
      const colLetter = ws.getCell(headerDoc, i + 2).address.replace(/\d+/, '');
      const formula = `SUMIFS(TablaDatos[Importe Total],TablaDatos[Mes],A${fila},TablaDatos[Tipo Doc],${colLetter}$${headerDoc})`;
      estiloMontoFormula(ws.getCell(fila, i + 2), formula);
    });
    const colInicio = ws.getCell(fila, 2).address;
    const colFin = ws.getCell(fila, tiposDoc.length + 1).address;
    estiloMontoFormula(ws.getCell(fila, tiposDoc.length + 2), `SUM(${colInicio}:${colFin})`);
    fila++;
  }
  const ultimaFilaDoc = fila - 1;

  estiloTexto(ws.getCell(fila, 1), 'TOTAL');
  ws.getCell(fila, 1).font = { bold: true, name: 'Calibri', size: 10 };
  tiposDoc.forEach((td, i) => {
    const colLetter = ws.getCell(headerDoc, i + 2).address.replace(/\d+/, '');
    estiloMontoFormula(ws.getCell(fila, i + 2), `SUM(${colLetter}${primeraFilaDoc}:${colLetter}${ultimaFilaDoc})`);
  });
  {
    const colLetter = ws.getCell(headerDoc, tiposDoc.length + 2).address.replace(/\d+/, '');
    estiloMontoFormula(ws.getCell(fila, tiposDoc.length + 2), `SUM(${colLetter}${primeraFilaDoc}:${colLetter}${ultimaFilaDoc})`);
  }
  fila += 3;

  // --- Matriz 3: cantidad Mes × Sentido ---
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Cantidad de comprobantes por Mes × Sentido');
  ws.getRow(fila).height = 22;
  fila += 1;

  const headerCant = fila;
  estiloEncabezado(ws.getCell(fila, 1), 'Mes');
  sentidos.forEach((s, i) => estiloEncabezado(ws.getCell(fila, i + 2), s));
  estiloEncabezado(ws.getCell(fila, sentidos.length + 2), 'Total');
  fila++;

  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    sentidos.forEach((s, i) => {
      const colLetter = ws.getCell(headerCant, i + 2).address.replace(/\d+/, '');
      const formula = `COUNTIFS(TablaDatos[Mes],A${fila},TablaDatos[Tipo],${colLetter}$${headerCant})`;
      estiloNumeroFormula(ws.getCell(fila, i + 2), formula);
    });
    const colInicio = ws.getCell(fila, 2).address;
    const colFin = ws.getCell(fila, sentidos.length + 1).address;
    estiloNumeroFormula(ws.getCell(fila, sentidos.length + 2), `SUM(${colInicio}:${colFin})`);
    fila++;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── HOJA 3: Dashboard profesional (KPIs y desgloses por fórmulas) ──
function crearHojaDashboard(wb, facturas) {
  const ws = wb.addWorksheet('Dashboard', {
    properties: { tabColor: { argb: COLOR.azulMedio } },
  });

  [28, 16, 16, 16, 16, 18, 22, 14, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  ws.mergeCells('A1:I1');
  const titulo = ws.getCell('A1');
  titulo.value = 'ContaFácil — Dashboard consolidado';
  titulo.font = { bold: true, size: 18, color: { argb: COLOR.blanco }, name: 'Calibri' };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.azul } };
  titulo.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:I2');
  const sub = ws.getCell('A2');
  sub.value = `Generado: ${new Date().toLocaleString('es-PE')}  ·  Montos: Contabilidad S/  ·  KPIs/desgloses = fórmulas sobre TablaDatos`;
  sub.font = { size: 9, italic: true, color: { argb: 'FF666666' }, name: 'Calibri' };
  ws.getRow(2).height = 18;

  const periodo = periodoLabel(facturas);
  const emitidas = facturas.filter(esEmitida);
  const recibidas = facturas.filter(esRecibida);

  const kpis = [
    {
      label: 'Total emitidas (S/)',
      formula: 'SUMIF(TablaDatos[Tipo],"Emitida",TablaDatos[Importe Total])',
      isMoney: true,
      fill: COLOR.verdeSuave,
    },
    {
      label: 'Total recibidas (S/)',
      formula: 'SUMIF(TablaDatos[Tipo],"Recibida",TablaDatos[Importe Total])',
      isMoney: true,
      fill: COLOR.naranjaSuave,
    },
    {
      label: 'Total neto (S/)',
      formula: 'A5-B5',
      isMoney: true,
      fill: COLOR.azulClaro,
      // A5/B5 se ajustan abajo según col real
      formulaCols: true,
    },
    {
      label: 'Cantidad comprobantes',
      formula: 'COUNTA(TablaDatos[Tipo])',
      isMoney: false,
      fill: COLOR.grisClaro,
    },
    {
      label: 'Periodo',
      value: periodo,
      isText: true,
      fill: COLOR.grisClaro,
    },
  ];

  let col = 1;
  const kpiValueCells = {};
  for (const kpi of kpis) {
    const cLabel = ws.getCell(4, col);
    const cValue = ws.getCell(5, col);
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
      kpiValueCells[kpi.label] = cValue.address;
      cValue.numFmt = FMT_CONTABILIDAD;
      cValue.alignment = { horizontal: 'center', vertical: 'middle' };
    } else {
      cValue.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    cValue.font = { bold: true, size: 14, color: { argb: COLOR.azul }, name: 'Calibri' };
    cValue.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.blanco } };
    aplicarBordeFino(cValue);
    ws.getColumn(col).width = Math.max(ws.getColumn(col).width || 14, 18);
    col += 1;
  }

  // Asignar fórmulas KPI (neto = emitidas - recibidas por dirección de celdas)
  const addrEmit = kpiValueCells['Total emitidas (S/)'];
  const addrRec = kpiValueCells['Total recibidas (S/)'];
  const addrNeto = kpiValueCells['Total neto (S/)'];
  ws.getCell(addrEmit).value = { formula: 'SUMIF(TablaDatos[Tipo],"Emitida",TablaDatos[Importe Total])' };
  ws.getCell(addrRec).value = { formula: 'SUMIF(TablaDatos[Tipo],"Recibida",TablaDatos[Importe Total])' };
  ws.getCell(addrNeto).value = { formula: `${addrEmit}-${addrRec}` };
  // cantidad está en columna 4
  ws.getCell(5, 4).value = { formula: 'COUNTA(TablaDatos[Tipo])' };

  ws.getRow(4).height = 28;
  ws.getRow(5).height = 28;

  ws.mergeCells('A7:E7');
  estiloTituloSeccion(ws.getCell('A7'), 'Área de gráficos (opcional en Excel)');
  ws.getRow(7).height = 22;
  ws.mergeCells('A8:E10');
  const chartHint = ws.getCell('A8');
  chartHint.value = [
    'ExcelJS no inserta gráficos nativos en esta versión.',
    'Sugerencia: selecciona la matriz de "Tabla dinámica" (valores ya son fórmulas) → Insertar → Gráfico.',
    'También puedes agregar más fórmulas en este Dashboard referenciando TablaDatos.',
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

  const mesesOrden = [...new Set(facturas.map(f => f.mes))];
  for (const mes of mesesOrden) {
    estiloTexto(ws.getCell(fila, 1), mes);
    estiloNumeroFormula(ws.getCell(fila, 2), `COUNTIF(TablaDatos[Mes],A${fila})`);
    estiloMontoFormula(ws.getCell(fila, 3), `SUMIFS(TablaDatos[Importe Total],TablaDatos[Mes],A${fila},TablaDatos[Tipo],"Emitida")`);
    estiloMontoFormula(ws.getCell(fila, 4), `SUMIFS(TablaDatos[Importe Total],TablaDatos[Mes],A${fila},TablaDatos[Tipo],"Recibida")`);
    estiloMontoFormula(ws.getCell(fila, 5), `SUMIF(TablaDatos[Mes],A${fila},TablaDatos[Importe Total])`);
    estiloMontoFormula(ws.getCell(fila, 6), `SUMIF(TablaDatos[Mes],A${fila},TablaDatos[IGV])`);
    fila++;
  }

  fila += 2;
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Desglose por tipo de documento (FE / NC / ND)');
  ws.getRow(fila).height = 22;
  fila++;

  ['Tipo Doc', 'N° comprobantes', 'Total S/', 'IGV S/', 'Neto a pagar S/'].forEach((h, i) => {
    estiloEncabezado(ws.getCell(fila, i + 1), h);
  });
  fila++;

  const tiposDoc = ['FE', 'NC', 'ND'].filter(td => facturas.some(f => f.tipoDoc === td));
  for (const td of tiposDoc) {
    estiloTexto(ws.getCell(fila, 1), td);
    estiloNumeroFormula(ws.getCell(fila, 2), `COUNTIF(TablaDatos[Tipo Doc],A${fila})`);
    estiloMontoFormula(ws.getCell(fila, 3), `SUMIF(TablaDatos[Tipo Doc],A${fila},TablaDatos[Importe Total])`);
    estiloMontoFormula(ws.getCell(fila, 4), `SUMIF(TablaDatos[Tipo Doc],A${fila},TablaDatos[IGV])`);
    estiloMontoFormula(ws.getCell(fila, 5), `SUMIF(TablaDatos[Tipo Doc],A${fila},TablaDatos[Neto a Pagar])`);
    fila++;
  }

  fila += 2;
  ws.mergeCells(fila, 1, fila, 5);
  estiloTituloSeccion(ws.getCell(fila, 1), 'Desglose por sentido (Emitida / Recibida)');
  ws.getRow(fila).height = 22;
  fila++;

  ['Tipo', 'N° comprobantes', 'Total S/', 'IGV S/', 'Neto a pagar S/'].forEach((h, i) => {
    estiloEncabezado(ws.getCell(fila, i + 1), h);
  });
  fila++;

  const sentidos = [...new Set(facturas.map(f => f.tipo))].sort();
  for (const tipo of sentidos) {
    estiloTexto(ws.getCell(fila, 1), tipo);
    estiloNumeroFormula(ws.getCell(fila, 2), `COUNTIF(TablaDatos[Tipo],A${fila})`);
    estiloMontoFormula(ws.getCell(fila, 3), `SUMIF(TablaDatos[Tipo],A${fila},TablaDatos[Importe Total])`);
    estiloMontoFormula(ws.getCell(fila, 4), `SUMIF(TablaDatos[Tipo],A${fila},TablaDatos[IGV])`);
    estiloMontoFormula(ws.getCell(fila, 5), `SUMIF(TablaDatos[Tipo],A${fila},TablaDatos[Neto a Pagar])`);
    fila++;
  }

  // Top clientes: esqueleto RUC/razón desde Node; N°/montos por fórmula
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
    if (!topClientes[clave]) topClientes[clave] = { razon: f.razonCliente, total: 0 };
    topClientes[clave].total += f.total;
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
      estiloNumeroFormula(ws.getCell(fila, 3), `COUNTIFS(TablaDatos[Tipo],"Emitida",TablaDatos[RUC Cliente],A${fila})`);
      estiloMontoFormula(ws.getCell(fila, 4), `SUMIFS(TablaDatos[Importe Total],TablaDatos[Tipo],"Emitida",TablaDatos[RUC Cliente],A${fila})`);
      estiloMontoFormula(ws.getCell(fila, 5), `SUMIFS(TablaDatos[IGV],TablaDatos[Tipo],"Emitida",TablaDatos[RUC Cliente],A${fila})`);
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
    if (!topProv[clave]) topProv[clave] = { razon: f.razonEmisor, total: 0 };
    topProv[clave].total += f.total;
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
      estiloNumeroFormula(ws.getCell(fila, 3), `COUNTIFS(TablaDatos[Tipo],"Recibida",TablaDatos[RUC Emisor],A${fila})`);
      estiloMontoFormula(ws.getCell(fila, 4), `SUMIFS(TablaDatos[Importe Total],TablaDatos[Tipo],"Recibida",TablaDatos[RUC Emisor],A${fila})`);
      estiloMontoFormula(ws.getCell(fila, 5), `SUMIFS(TablaDatos[IGV],TablaDatos[Tipo],"Recibida",TablaDatos[RUC Emisor],A${fila})`);
      fila++;
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── HOJA 4: tip breve ───────────────────────────────────────
function crearHojaInstrucciones(wb) {
  const ws = wb.addWorksheet('Tips');
  ws.columns = [{ width: 100 }];

  const pasos = [
    'Tips ContaFácil — Excel consolidado',
    '',
    '• Hoja Datos: tabla Excel "TablaDatos" (fuente de verdad).',
    '• Dashboard y Tabla dinámica: los totales son fórmulas (SUMIF/SUMIFS/COUNTIF) sobre TablaDatos.',
    '• Formato de montos: Contabilidad con S/  →  _("S/"* #,##0.00_);_("S/"* (#,##0.00);_("S/"* "-"??_);_(@_)',
    '• Puedes agregar más fórmulas en Dashboard referenciando TablaDatos[Columna].',
    '• Pivot nativa opcional: Datos → Insertar → Tabla dinámica.',
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
