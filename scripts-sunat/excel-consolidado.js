// ============================================================
//  EXCEL CONSOLIDADO - Opción 4 del panel de cliente
// ============================================================
//
//  Basado en consolidar_excel.js, adaptado para:
//   - Recibir UNA o VARIAS carpetas de XML (cada una con su etiqueta
//     de tipo, ej. "FE Emitidas" o "FE Recibidas") y combinarlas en
//     una sola tabla con columna "Tipo" para poder filtrar/segmentar
//   - Agregar una hoja de RESUMEN con totales por mes, cliente y tipo
//   - Agregar una hoja de INSTRUCCIONES para crear una tabla
//     dinámica real de Excel en 3 clics (ExcelJS no puede crear
//     pivot tables nativas, así que dejamos los datos listos y
//     el camino más corto para que el contador la cree él mismo)
//
// ============================================================

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const ExcelJS = require('exceljs');

function leerTexto(obj) {
  if (obj === undefined || obj === null) return '';
  if (typeof obj === 'string') return obj.trim();
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'object' && '#text' in obj) return String(obj['#text']).trim();
  return '';
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

  // UBL usa una etiqueta raíz distinta según el tipo de comprobante:
  // Facturas -> <Invoice>, Notas de Crédito -> <CreditNote>,
  // Notas de Débito -> <DebitNote>. El resto de la estructura es igual.
  let inv, nombreLinea;
  if (data.Invoice) {
    inv = data.Invoice;
    nombreLinea = 'InvoiceLine';
  } else if (data.CreditNote) {
    inv = data.CreditNote;
    nombreLinea = 'CreditNoteLine';
  } else if (data.DebitNote) {
    inv = data.DebitNote;
    nombreLinea = 'DebitNoteLine';
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

  return {
    tipo: etiquetaTipo, // "Emitida" o "Recibida" - para poder filtrar/segmentar
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

// ── HOJA 1: la tabla con todas las facturas, incluyendo columna "Tipo" ──
function crearHojaTabla(wb, facturas) {
  const ws = wb.addWorksheet('Facturas');

  const columnasDef = [
    { name: 'Tipo', width: 12 },
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
    { name: 'Sub Total', width: 13 },
    { name: 'IGV', width: 12 },
    { name: 'Importe Total', width: 14 },
    { name: '% Detracción', width: 12 },
    { name: 'Monto Detracción', width: 15 },
    { name: 'Neto a Pagar', width: 14 },
    { name: 'Archivo XML', width: 30 },
  ];

  columnasDef.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const filas = facturas.map(f => [
    f.tipo, f.mes, f.nroFactura, f.fechaEmision, f.rucEmisor, f.razonEmisor,
    f.rucCliente, f.razonCliente, f.descripcion, f.moneda, f.formaPago,
    f.subTotal, f.igv, f.total, f.pctDetraccion / 100, f.montoDetraccion,
    f.netoPagar, f.archivo,
  ]);

  // Índices de columnas con montos para suma automática (ahora desplazados +1 por la columna Tipo)
  const indicesMontos = [11, 12, 13, 15, 16];

  ws.addTable({
    name: 'TablaFacturas',
    ref: 'A1',
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium9', showRowStripes: true },
    columns: columnasDef.map((c, i) => {
      const col = { name: c.name, filterButton: true };
      if (indicesMontos.includes(i)) col.totalsRowFunction = 'sum';
      return col;
    }),
    rows: filas,
  });

  const totalFilas = filas.length;
  for (let r = 2; r <= totalFilas + 1; r++) {
    ws.getCell(`D${r}`).numFmt = 'dd/mm/yyyy';
    ws.getCell(`L${r}`).numFmt = '#,##0.00';
    ws.getCell(`M${r}`).numFmt = '#,##0.00';
    ws.getCell(`N${r}`).numFmt = '#,##0.00';
    ws.getCell(`O${r}`).numFmt = '0.00%';
    ws.getCell(`P${r}`).numFmt = '#,##0.00';
    ws.getCell(`Q${r}`).numFmt = '#,##0.00';
  }
  const filaTotales = totalFilas + 2;
  ['L', 'M', 'N', 'P', 'Q'].forEach(col => {
    ws.getCell(`${col}${filaTotales}`).numFmt = '#,##0.00';
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── HOJA 2: resumen automático por mes, por cliente, y por tipo ──
function crearHojaResumen(wb, facturas, hayMultiplesTipos) {
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 22 }, { width: 14 }, { width: 16 }, { width: 16 }];

  const azul = 'FF1F4E79';
  const blanco = 'FFFFFFFF';
  const grisClaro = 'FFF2F2F2';

  function tituloSeccion(fila, texto, colSpan = 4) {
    ws.mergeCells(fila, 1, fila, colSpan);
    const c = ws.getCell(fila, 1);
    c.value = texto;
    c.font = { bold: true, color: { argb: blanco }, size: 12 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(fila).height = 22;
  }

  function encabezados(fila, textos) {
    textos.forEach((t, i) => {
      const c = ws.getCell(fila, i + 1);
      c.value = t;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: grisClaro } };
      c.border = { bottom: { style: 'thin' } };
    });
  }

  let fila = 1;

  // Si hay más de un tipo (ej. Emitidas + Recibidas juntas), agregamos
  // primero un resumen específico por tipo - es el dato más relevante
  // cuando se combinan ambos.
  if (hayMultiplesTipos) {
    tituloSeccion(fila, 'RESUMEN POR TIPO DE COMPROBANTE');
    fila += 2;
    encabezados(fila, ['Tipo', 'N° Facturas', 'Total S/', 'IGV S/']);
    fila++;

    const porTipo = {};
    for (const f of facturas) {
      if (!porTipo[f.tipo]) porTipo[f.tipo] = { cantidad: 0, total: 0, igv: 0 };
      porTipo[f.tipo].cantidad++;
      porTipo[f.tipo].total += f.total;
      porTipo[f.tipo].igv += f.igv;
    }

    for (const [tipo, datos] of Object.entries(porTipo)) {
      ws.getCell(fila, 1).value = tipo;
      ws.getCell(fila, 2).value = datos.cantidad;
      ws.getCell(fila, 3).value = datos.total;
      ws.getCell(fila, 3).numFmt = '#,##0.00';
      ws.getCell(fila, 4).value = datos.igv;
      ws.getCell(fila, 4).numFmt = '#,##0.00';
      fila++;
    }

    fila += 2;
  }

  tituloSeccion(fila, 'RESUMEN POR MES');
  fila += 2;
  encabezados(fila, ['Mes', 'N° Facturas', 'Total S/', 'IGV S/']);
  fila++;

  const porMes = {};
  for (const f of facturas) {
    if (!porMes[f.mes]) porMes[f.mes] = { cantidad: 0, total: 0, igv: 0 };
    porMes[f.mes].cantidad++;
    porMes[f.mes].total += f.total;
    porMes[f.mes].igv += f.igv;
  }

  for (const [mes, datos] of Object.entries(porMes)) {
    ws.getCell(fila, 1).value = mes;
    ws.getCell(fila, 2).value = datos.cantidad;
    ws.getCell(fila, 3).value = datos.total;
    ws.getCell(fila, 3).numFmt = '#,##0.00';
    ws.getCell(fila, 4).value = datos.igv;
    ws.getCell(fila, 4).numFmt = '#,##0.00';
    fila++;
  }

  fila += 2;
  tituloSeccion(fila, 'RESUMEN POR CLIENTE (RUC EMISOR)');
  fila += 2;
  encabezados(fila, ['RUC Emisor', 'Razón Social', 'N° Facturas', 'Total S/']);
  fila++;

  const porCliente = {};
  for (const f of facturas) {
    const clave = f.rucEmisor || 'Sin RUC';
    if (!porCliente[clave]) porCliente[clave] = { razon: f.razonEmisor, cantidad: 0, total: 0 };
    porCliente[clave].cantidad++;
    porCliente[clave].total += f.total;
  }

  for (const [ruc, datos] of Object.entries(porCliente)) {
    ws.getCell(fila, 1).value = ruc;
    ws.getCell(fila, 2).value = datos.razon;
    ws.getCell(fila, 3).value = datos.cantidad;
    ws.getCell(fila, 4).value = datos.total;
    ws.getCell(fila, 4).numFmt = '#,##0.00';
    fila++;
  }
}

// ── HOJA 3: instrucciones para crear la tabla dinámica real ──
function crearHojaInstrucciones(wb, hayMultiplesTipos) {
  const ws = wb.addWorksheet('Cómo crear tabla dinámica');
  ws.columns = [{ width: 90 }];

  const pasos = [
    'CÓMO CREAR UNA TABLA DINÁMICA CON ESTOS DATOS (3 pasos, 10 segundos)',
    '',
    '1. Ve a la hoja "Facturas" y haz clic en cualquier celda dentro de la tabla.',
    '2. En el menú de arriba, ve a Insertar → Tabla dinámica → Aceptar.',
    '3. En el panel de la derecha, arrastra los campos que quieras revisar:',
    '   - Arrastra "Mes" o "Razón Social Cliente" a la sección FILAS',
    '   - Arrastra "Importe Total" o "IGV" a la sección VALORES',
    '   - Para filtrar por fecha o cliente, arrastra ese campo a la sección FILTROS',
  ];

  if (hayMultiplesTipos) {
    pasos.push('   - Arrastra "Tipo" a FILTROS o COLUMNAS para separar Emitidas de Recibidas');
  }

  pasos.push(
    '',
    'Con eso ya tienes una tabla dinámica real de Excel, que puedes actualizar',
    'cuando quieras (botón derecho → Actualizar) si agregas más facturas a la hoja.',
    '',
    'La hoja "Resumen" de este archivo ya te muestra automáticamente los totales',
    'por mes y por cliente, sin que tengas que hacer nada - úsala si solo necesitas',
    'una vista rápida sin crear la tabla dinámica.'
  );

  pasos.forEach((texto, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = texto;
    c.alignment = { wrapText: true };
    if (i === 0) c.font = { bold: true, size: 13 };
  });
}

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────
// fuentes: array de { carpetaXml, etiquetaTipo } - una entrada por cada
// tipo a combinar. Ej: [{ carpetaXml: '.../FE Emitidas XML', etiquetaTipo: 'Emitida' }]
// o dos entradas si se combinan Emitidas + Recibidas.
async function generarExcelConsolidado(fuentes, carpetaDestino, onProgreso, nombreArchivoBase = 'Excel Consolidado') {
  function avisar(mensaje, extra = {}) {
    console.log(mensaje);
    if (typeof onProgreso === 'function') onProgreso({ mensaje, ...extra });
  }

  // Compatibilidad: si se llama con la firma antigua (un solo string de
  // carpeta), lo convertimos al nuevo formato de "fuentes" automáticamente.
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

  const hayMultiplesTipos = fuentes.length > 1;

  const wb = new ExcelJS.Workbook();
  crearHojaTabla(wb, facturas);
  crearHojaResumen(wb, facturas, hayMultiplesTipos);
  crearHojaInstrucciones(wb, hayMultiplesTipos);

  const nombreArchivo = `${nombreArchivoBase} ${new Date().getFullYear()}.xlsx`;
  const rutaFinal = path.join(carpetaDestino, nombreArchivo);
  await wb.xlsx.writeFile(rutaFinal);

  avisar(`🎉 Consolidado creado: ${facturas.length} facturas en ${rutaFinal}`, {
    etapa: 'completado', total: facturas.length, carpeta: carpetaDestino, archivo: rutaFinal,
  });

  return { total: facturas.length, carpeta: carpetaDestino, archivo: rutaFinal };
}

module.exports = { generarExcelConsolidado };
