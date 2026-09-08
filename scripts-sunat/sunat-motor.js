// ============================================================
//  SUNAT - MÓDULO DE DESCARGA (PDF / XML / Excel)
// ============================================================
//
//  Basado en sunat_completo.js, pero reorganizado para que cada
//  parte (PDF, XML, Excel) se pueda ejecutar por separado, y
//  recibiendo las credenciales del cliente como parámetros en
//  vez de un CONFIG fijo en el archivo.
//
//  Cada función reporta su progreso llamando a "onProgreso",
//  una función que le pasamos desde afuera (la web), para poder
//  mostrar una barra de progreso en vivo.
// ============================================================

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

const URL_LOGIN = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/4f3b88b3-d9d6-402a-b85d-6a0bc857746a/oauth2/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false&originalUrl=https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm&state=rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==';

function esperar(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Aviso por consola Y hacia la web (si se pasó una función onProgreso)
function avisar(onProgreso, mensaje, extra = {}) {
  console.log(mensaje);
  if (typeof onProgreso === 'function') {
    onProgreso({ mensaje, ...extra });
  }
}

// Clic por ID sin importar visibilidad CSS (necesario para el menú de SUNAT)
async function jsClick(page, id) {
  await page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) throw new Error('Elemento no encontrado: ' + elId);
    el.click();
  }, id);
}

// ── TIPOS DE COMPROBANTE ───────────────────────────────────
// Códigos reales que usa el campo oculto "tipoConsulta" del formulario
// de SUNAT. Confirmados directamente inspeccionando el HTML del sitio.
const CODIGOS_TIPO_CONSULTA = {
  FE: { emitidas: { codigo: '10', texto: 'FE Emitidas' }, recibidas: { codigo: '11', texto: 'FE Recibidas' } },
  NC: { emitidas: { codigo: '13', texto: 'NC Emitidas' }, recibidas: { codigo: '14', texto: 'NC Recibidas' } },
  ND: { emitidas: { codigo: '15', texto: 'ND Emitidas' }, recibidas: { codigo: '16', texto: 'ND Recibidas' } },
};

function obtenerInfoTipoConsulta(paquete, emitidaORecibida) {
  const grupo = CODIGOS_TIPO_CONSULTA[paquete];
  if (!grupo) throw new Error('Paquete no reconocido: ' + paquete);
  const info = grupo[emitidaORecibida];
  if (!info) throw new Error('Tipo no reconocido: ' + emitidaORecibida);
  return info;
}

// Selecciona el tipo de comprobante (ej. "FE Recibidas") en el formulario.
// El campo es un widget Dojo/Dijit, no un <select> normal de HTML: tiene
// un campo de texto visible (id="criterio.tipoConsulta") y un campo oculto
// con el código real que SUNAT procesa (name="tipoConsulta"). Actualizamos
// los dos directamente vía JavaScript, en vez de simular clics en el
// dropdown visual, porque es más confiable y no depende de animaciones
// del widget.
async function seleccionarTipoConsulta(page, paquete, emitidaORecibida) {
  const info = obtenerInfoTipoConsulta(paquete, emitidaORecibida);

  const iframe = page.locator('iframe[name="iframeApplication"]').contentFrame();

  await iframe.locator('[id="criterio.tipoConsulta"]').waitFor({ state: 'visible', timeout: 15000 });

  // FrameLocator no tiene .evaluate() directo en esta versión de Playwright;
  // hay que llamarlo sobre el locator de un elemento específico dentro del
  // frame. Usamos el campo visible como "ancla" y desde ahí, con
  // document, alcanzamos también el campo oculto.
  await iframe.locator('[id="criterio.tipoConsulta"]').evaluate((campoVisible, codigoYTexto) => {
    const campoOculto = campoVisible.parentElement.querySelector('input[name="tipoConsulta"]')
      || document.getElementsByName('tipoConsulta')[0];

    if (!campoOculto) {
      throw new Error('No se encontró el campo oculto de Tipo de Consulta en el formulario.');
    }

    campoVisible.value = codigoYTexto.texto;
    campoOculto.value = codigoYTexto.codigo;

    // Disparamos los eventos que el widget Dojo espera para "darse cuenta"
    // del cambio (algunos widgets antiguos solo reaccionan a 'change', no
    // basta con cambiar el .value directamente).
    campoVisible.dispatchEvent(new Event('change', { bubbles: true }));
    campoOculto.dispatchEvent(new Event('change', { bubbles: true }));
  }, info);

  await esperar(500);
}

// ── LOGIN ──────────────────────────────────────────────────
async function login(page, credenciales, onProgreso) {
  avisar(onProgreso, '🔐 Iniciando sesión...', { etapa: 'login' });
  await page.goto(URL_LOGIN);
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'RUC' }).fill(credenciales.ruc);
  await page.getByRole('textbox', { name: 'Usuario' }).fill(credenciales.usuario);
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(credenciales.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForLoadState('networkidle');
  await esperar(4000);
  avisar(onProgreso, '✅ Login exitoso', { etapa: 'login_ok' });
}

// ── NAVEGACIÓN AL FORMULARIO DE CONSULTA ──────────────────
async function navegarAlFormulario(page) {
  await page.locator('#divOpcionServicio2').waitFor({ state: 'attached', timeout: 30000 });

  await jsClick(page, 'divOpcionServicio2');
  await esperar(1200);

  await jsClick(page, 'nivel2_11_5');
  await esperar(1200);

  await jsClick(page, 'nivel3_11_5_3');
  await esperar(1200);

  await jsClick(page, 'nivel4_11_5_3_1_2');
  await esperar(3000);

  await page.locator('iframe[name="iframeApplication"]').waitFor({ state: 'attached', timeout: 15000 });
  const iframe = page.locator('iframe[name="iframeApplication"]').contentFrame();
  await iframe.locator('[id="criterio.fec_desde"]').waitFor({ state: 'visible', timeout: 20000 });
}

// ── BUSCAR FACTURAS DE UN MES (con el tipo de comprobante elegido) ──
async function buscarMes(page, configMes, paquete, emitidaORecibida) {
  const iframe = page.locator('iframe[name="iframeApplication"]').contentFrame();

  await seleccionarTipoConsulta(page, paquete, emitidaORecibida);

  await iframe.locator('[id="criterio.fec_desde"]').click();
  await iframe.locator('[id="criterio.fec_desde"]').fill(configMes.desde);
  await iframe.locator('[id="criterio.fec_hasta"]').click();
  await iframe.locator('[id="criterio.fec_hasta"]').fill(configMes.hasta);

  await iframe.locator('span').nth(1).click();
  await esperar(4000);
}

// ── DESCARGAR TODOS LOS PDF DE UN MES ─────────────────────
async function descargarPDFsDelMes(page, configMes, carpetaMes, onProgreso) {
  const iframe = page.locator('iframe[name="iframeApplication"]').contentFrame();

  const links = await iframe.getByRole('link', { name: 'Descargar PDF' }).all();
  const total = links.length;

  if (total === 0) {
    avisar(onProgreso, `  ⚠️  Sin facturas PDF para ${configMes.mes}`, { etapa: 'pdf_vacio', mes: configMes.mes });
    return 0;
  }
  avisar(onProgreso, `  📄 ${total} PDFs encontrados`, { etapa: 'pdf_total', mes: configMes.mes, total });

  let descargados = 0;
  for (let i = 0; i < total; i++) {
    try {
      const linksActuales = await iframe.getByRole('link', { name: 'Descargar PDF' }).all();
      if (!linksActuales[i]) break;

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        linksActuales[i].click(),
      ]);

      const nombre = download.suggestedFilename() || `factura_${i + 1}.pdf`;
      await download.saveAs(path.join(carpetaMes, nombre));
      descargados++;
      avisar(onProgreso, `  ✅ PDF [${descargados}/${total}] ${nombre}`, {
        etapa: 'pdf_progreso', mes: configMes.mes, descargados, total, nombre,
      });
      await esperar(800);
    } catch (err) {
      avisar(onProgreso, `  ❌ Error PDF #${i + 1}: ${err.message}`, { etapa: 'pdf_error', mes: configMes.mes });
    }
  }
  return descargados;
}

// ── DESCARGAR TODOS LOS XML DE UN MES ─────────────────────
// El texto del link de descarga cambia según el paquete:
//   FE -> "Descargar Factura (XML)"
//   NC -> "Descargar NC (XML)"     (confirmado directamente en SUNAT)
//   ND -> "Descargar ND (XML)"     (mismo patrón que NC)
function textoLinkXML(paquete) {
  if (paquete === 'FE') return 'Descargar Factura (XML)';
  return `Descargar ${paquete} (XML)`; // NC -> "Descargar NC (XML)", ND -> "Descargar ND (XML)"
}

async function descargarXMLsDelMes(page, configMes, carpetaMes, onProgreso, paquete) {
  const iframe = page.locator('iframe[name="iframeApplication"]').contentFrame();
  const textoBoton = textoLinkXML(paquete);

  const links = await iframe.getByRole('link', { name: textoBoton }).all();
  const total = links.length;

  if (total === 0) {
    avisar(onProgreso, `  ⚠️  Sin facturas XML para ${configMes.mes}`, { etapa: 'xml_vacio', mes: configMes.mes });
    return 0;
  }
  avisar(onProgreso, `  📦 ${total} XML (zip) encontrados`, { etapa: 'xml_total', mes: configMes.mes, total });

  let descargados = 0;
  for (let i = 0; i < total; i++) {
    try {
      const linksActuales = await iframe.getByRole('link', { name: textoBoton }).all();
      if (!linksActuales[i]) break;

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        linksActuales[i].click(),
      ]);

      const nombre = download.suggestedFilename() || `factura_${i + 1}.zip`;
      await download.saveAs(path.join(carpetaMes, nombre));
      descargados++;
      avisar(onProgreso, `  ✅ XML [${descargados}/${total}] ${nombre}`, {
        etapa: 'xml_progreso', mes: configMes.mes, descargados, total, nombre,
      });
      await esperar(800);
    } catch (err) {
      avisar(onProgreso, `  ❌ Error XML #${i + 1}: ${err.message}`, { etapa: 'xml_error', mes: configMes.mes });
    }
  }
  return descargados;
}

// ── EXTRAER EL .XML DE CADA .ZIP DESCARGADO ───────────────
function extraerXMLsDeZips(carpetaMes, onProgreso) {
  const archivos = fs.readdirSync(carpetaMes);
  const zips = archivos.filter(f => f.toLowerCase().endsWith('.zip'));

  for (const zipFile of zips) {
    try {
      const zip = new AdmZip(path.join(carpetaMes, zipFile));
      const entradas = zip.getEntries();
      const xmls = entradas.filter(e => !e.isDirectory && e.entryName.toUpperCase().endsWith('.XML'));
      if (!xmls.length || xmls.length > 100 || xmls.some(e => e.header.size > 2*1024*1024)) throw new Error('ZIP sin XML o tamaño excedido');
      for (const xmlEntry of xmls) {
        const bytes = zip.readFile(xmlEntry);
        const nombre = path.basename(xmlEntry.entryName.replace(/\\/g,'/')).replace(/[<>:"|?*\x00-\x1f]/g,'_');
        let destino = path.join(carpetaMes, nombre);
        if (fs.existsSync(destino) && !fs.readFileSync(destino).equals(bytes)) destino = path.join(carpetaMes,require('crypto').createHash('sha256').update(bytes).digest('hex').slice(0,12)+'-'+nombre);
        fs.writeFileSync(destino, bytes);
      }
      fs.unlinkSync(path.join(carpetaMes, zipFile));
    } catch (err) {
      console.error(`  ⚠️  No se pudo extraer ${zipFile}: ${err.message}`);
      if (onProgreso) avisar(onProgreso,'No se pudo extraer un ZIP: '+zipFile,{etapa:'xml_error'});
    }
  }
}

// ── LEER UN XML Y SACAR LOS DATOS DE LA FACTURA ───────────
function leerTexto(obj) {
  if (obj === undefined || obj === null) return '';
  if (typeof obj === 'string') return obj.trim();
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'object' && '#text' in obj) return String(obj['#text']).trim();
  return '';
}

function parsearXML(rutaXml) {
  const xmlContent = fs.readFileSync(rutaXml, 'latin1');

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
  });

  const data = parser.parse(xmlContent);

  // UBL (el estándar que usa SUNAT) usa una etiqueta raíz DISTINTA según
  // el tipo de comprobante: las Facturas usan <Invoice>, las Notas de
  // Crédito usan <CreditNote>, y las Notas de Débito usan <DebitNote>.
  // El resto de la estructura (emisor, cliente, totales, IGV) es igual
  // en los tres, solo cambia el nombre de la etiqueta de línea de detalle.
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

// ── CREAR UN EXCEL POR FACTURA (formato ficha, igual al original) ──
async function crearExcel(datos, rutaExcel) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Factura');

  ws.columns = [{ width: 32 }, { width: 55 }];

  const azul = 'FF1F4E79';
  const gris = 'FFD9E1F2';

  ws.mergeCells('A1:B1');
  const titulo = ws.getCell('A1');
  titulo.value = 'FACTURA ELECTRÓNICA - SUNAT (desde XML)';
  titulo.font = { bold: true, size: 13, color: { argb: 'FF1F4E79' }, name: 'Arial' };
  titulo.alignment = { horizontal: 'center' };
  ws.getRow(1).height = 26;

  const secciones = [
    ['DATOS GENERALES', [
      ['Archivo XML', datos.archivo],
      ['N° Factura', datos.nroFactura],
      ['Fecha de Emisión', datos.fechaEmision],
      ['Forma de Pago', datos.formaPago],
      ['Moneda', datos.moneda],
      ['Monto en Letras', datos.montoLetras],
    ]],
    ['EMISOR', [
      ['Razón Social', datos.razonEmisor],
      ['RUC', datos.rucEmisor],
    ]],
    ['CLIENTE', [
      ['Razón Social', datos.razonCliente],
      ['RUC', datos.rucCliente],
    ]],
    ['DESCRIPCIÓN DEL SERVICIO', [
      ['Descripción', datos.descripcion],
    ]],
    ['IMPORTES', [
      ['Sub Total (S/)', datos.subTotal],
      ['IGV 18% (S/)', datos.igv],
      ['Importe Total (S/)', datos.total],
      ['% Detracción', datos.pctDetraccion / 100],
      ['Monto Detracción (S/)', datos.montoDetraccion],
      ['Neto a Pagar (S/)', datos.netoPagar],
    ]],
  ];

  const montos = new Set(['Sub Total (S/)', 'IGV 18% (S/)', 'Importe Total (S/)', 'Monto Detracción (S/)', 'Neto a Pagar (S/)']);
  const porcentajes = new Set(['% Detracción']);

  let fila = 2;
  for (const [tituloSec, campos] of secciones) {
    ws.mergeCells(`A${fila}:B${fila}`);
    const c = ws.getCell(`A${fila}`);
    c.value = tituloSec;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } };
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
    c.alignment = { horizontal: 'center' };
    ws.getRow(fila).height = 18;
    fila++;

    for (const [label, valor] of campos) {
      const cl = ws.getCell(`A${fila}`);
      const cv = ws.getCell(`B${fila}`);

      cl.value = label;
      cl.font = { bold: true, name: 'Arial', size: 10 };
      cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gris } };
      cl.alignment = { wrapText: true, vertical: 'top' };
      cl.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

      cv.value = valor;
      cv.font = { name: 'Arial', size: 10 };
      cv.alignment = { wrapText: true, vertical: 'top' };
      cv.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

      if (montos.has(label) && typeof valor === 'number') cv.numFmt = '#,##0.00';
      if (porcentajes.has(label) && typeof valor === 'number') cv.numFmt = '0.00%';

      ws.getRow(fila).height = label === 'Descripción' ? 45 : 18;
      fila++;
    }
  }

  await wb.xlsx.writeFile(rutaExcel);
}

async function convertirXMLsAExcel(carpetaXmlMes, carpetaExcelMes, onProgreso, mesLabel) {
  if (!fs.existsSync(carpetaExcelMes)) fs.mkdirSync(carpetaExcelMes, { recursive: true });

  const archivos = fs.readdirSync(carpetaXmlMes).filter(f => f.toUpperCase().endsWith('.XML'));
  let convertidos = 0;

  for (const xmlFile of archivos) {
    try {
      const rutaXml = path.join(carpetaXmlMes, xmlFile);
      const datos = parsearXML(rutaXml);
      const nombreExcel = xmlFile.replace(/\.XML$/i, '.xlsx');
      const rutaExcel = path.join(carpetaExcelMes, nombreExcel);
      await crearExcel(datos, rutaExcel);
      convertidos++;
      avisar(onProgreso, `  ✅ Excel [${convertidos}/${archivos.length}] ${nombreExcel}`, {
        etapa: 'excel_progreso', mes: mesLabel, convertidos, total: archivos.length,
      });
    } catch (err) {
      avisar(onProgreso, `  ❌ Error convirtiendo ${xmlFile}: ${err.message}`, { etapa: 'excel_error', mes: mesLabel });
    }
  }
  return convertidos;
}

// ============================================================
//  FUNCIONES PÚBLICAS - una por cada opción del botón en la web
// ============================================================

// Abre el navegador y hace login. Devuelve { browser, page } para
// que la función que llamó pueda seguir usándolos y cerrarlos al final.
//
// El modo headless (navegador visible o invisible) se controla desde
// el .env con MODO_NAVEGADOR_VISIBLE=true/false, para poder alternarlo
// sin tener que editar este archivo.
async function abrirYLoguear(credenciales, onProgreso) {
  const modoVisible = process.env.MODO_NAVEGADOR_VISIBLE === 'true';
  const browser = await chromium.launch({ headless: !modoVisible });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1366, height: 768 }, // mismo tamaño en visible e invisible
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await login(page, credenciales, onProgreso);
  return { browser, page };
}

// ── AUXILIAR: descarga PDFs de todos los meses para UN tipo específico
// (ej. FE Emitidas). Devuelve { total, carpeta }. ──
async function descargarPDFsPorTipo(page, meses, carpetaBase, paquete, emitidaORecibida, etiquetaCarpeta, onProgreso) {
  const carpetaTipo = path.join(carpetaBase, `${etiquetaCarpeta} PDF`);
  if (!fs.existsSync(carpetaTipo)) fs.mkdirSync(carpetaTipo, { recursive: true });

  let total = 0;
  for (const configMes of meses) {
    avisar(onProgreso, `📅 ${etiquetaCarpeta} - ${configMes.mes}`, { etapa: 'mes_inicio', mes: configMes.mes });
    const carpetaMes = path.join(carpetaTipo, `Facturas ${configMes.mes}`);
    if (!fs.existsSync(carpetaMes)) fs.mkdirSync(carpetaMes, { recursive: true });

    await navegarAlFormulario(page);
    await buscarMes(page, configMes, paquete, emitidaORecibida);
    total += await descargarPDFsDelMes(page, configMes, carpetaMes, onProgreso);
    await esperar(1000);
  }

  return { total, carpeta: carpetaTipo };
}

// ── AUXILIAR: descarga XMLs de todos los meses para UN tipo específico ──
async function descargarXMLsPorTipo(page, meses, carpetaBase, paquete, emitidaORecibida, etiquetaCarpeta, onProgreso) {
  const carpetaTipo = path.join(carpetaBase, `${etiquetaCarpeta} XML`);
  if (!fs.existsSync(carpetaTipo)) fs.mkdirSync(carpetaTipo, { recursive: true });

  let total = 0;
  for (const configMes of meses) {
    avisar(onProgreso, `📅 ${etiquetaCarpeta} - ${configMes.mes}`, { etapa: 'mes_inicio', mes: configMes.mes });
    const carpetaMes = path.join(carpetaTipo, `Facturas ${configMes.mes}`);
    if (!fs.existsSync(carpetaMes)) fs.mkdirSync(carpetaMes, { recursive: true });

    await navegarAlFormulario(page);
    await buscarMes(page, configMes, paquete, emitidaORecibida);
    const descargadosZip = await descargarXMLsDelMes(page, configMes, carpetaMes, onProgreso, paquete);

    if (descargadosZip > 0) {
      avisar(onProgreso, '  📂 Extrayendo XML de los .zip...', { etapa: 'extrayendo', mes: configMes.mes });
      extraerXMLsDeZips(carpetaMes);
    }

    total += descargadosZip;
    await esperar(1000);
  }

  return { total, carpeta: carpetaTipo };
}

// ── AUXILIAR: dado tipoComprobante ('emitidas'|'recibidas'|'ambas'),
// devuelve la lista de tipos a procesar en esta descarga. ──
function tiposAProcesar(tipoComprobante) {
  if (tipoComprobante === 'ambas') return ['emitidas', 'recibidas'];
  return [tipoComprobante];
}

// ── AUXILIAR: etiqueta de carpeta para un paquete+tipo, ej. "FE Emitidas" ──
function etiquetaPaqueteTipo(paquete, emitidaORecibida) {
  const textoTipo = emitidaORecibida === 'emitidas' ? 'Emitidas' : 'Recibidas';
  return `${paquete} ${textoTipo}`;
}

// ── OPCIÓN 1: Solo PDF ─────────────────────────────────────
// paquete: 'FE' | 'NC' | 'ND'
// tipoComprobante: 'emitidas' | 'recibidas' | 'ambas'
async function descargarSoloPDF(credenciales, meses, carpetaDestino, onProgreso, paquete, tipoComprobante) {
  const { browser, page } = await abrirYLoguear(credenciales, onProgreso);
  const resultadosPorTipo = {};

  try {
    for (const tipo of tiposAProcesar(tipoComprobante)) {
      const etiqueta = etiquetaPaqueteTipo(paquete, tipo);
      const carpetaBase = path.join(carpetaDestino, `${etiqueta} ${new Date().getFullYear()}`);
      if (!fs.existsSync(carpetaBase)) fs.mkdirSync(carpetaBase, { recursive: true });

      resultadosPorTipo[tipo] = await descargarPDFsPorTipo(page, meses, carpetaBase, paquete, tipo, etiqueta, onProgreso);
    }
  } finally {
    await browser.close();
  }

  const total = Object.values(resultadosPorTipo).reduce((suma, r) => suma + r.total, 0);
  avisar(onProgreso, `🎉 PDF completado: ${total} archivos`, { etapa: 'completado', total });
  return { total, resultadosPorTipo, carpeta: carpetaDestino };
}

// ── OPCIÓN 2: Solo XML ─────────────────────────────────────
async function descargarSoloXML(credenciales, meses, carpetaDestino, onProgreso, paquete, tipoComprobante) {
  const { browser, page } = await abrirYLoguear(credenciales, onProgreso);
  const resultadosPorTipo = {};

  try {
    for (const tipo of tiposAProcesar(tipoComprobante)) {
      const etiqueta = etiquetaPaqueteTipo(paquete, tipo);
      const carpetaBase = path.join(carpetaDestino, `${etiqueta} ${new Date().getFullYear()}`);
      if (!fs.existsSync(carpetaBase)) fs.mkdirSync(carpetaBase, { recursive: true });

      resultadosPorTipo[tipo] = await descargarXMLsPorTipo(page, meses, carpetaBase, paquete, tipo, etiqueta, onProgreso);
    }
  } finally {
    await browser.close();
  }

  const total = Object.values(resultadosPorTipo).reduce((suma, r) => suma + r.total, 0);
  avisar(onProgreso, `🎉 XML completado: ${total} archivos`, { etapa: 'completado', total });
  return { total, resultadosPorTipo, carpeta: carpetaDestino };
}

// ── OPCIÓN 3: Solo Excel (un Excel por factura, requiere los XML) ──
// Descarga los XML primero (a una carpeta temporal por tipo) y genera
// el Excel por factura a partir de esos XML, para cada tipo elegido.
async function descargarSoloExcel(credenciales, meses, carpetaDestino, onProgreso, paquete, tipoComprobante) {
  const { browser, page } = await abrirYLoguear(credenciales, onProgreso);
  const resultadosPorTipo = {};

  try {
    for (const tipo of tiposAProcesar(tipoComprobante)) {
      const etiqueta = etiquetaPaqueteTipo(paquete, tipo);
      const carpetaBase = path.join(carpetaDestino, `${etiqueta} ${new Date().getFullYear()}`);
      if (!fs.existsSync(carpetaBase)) fs.mkdirSync(carpetaBase, { recursive: true });

      // XML temporal, solo para poder generar el Excel por factura
      const carpetaXmlTemp = path.join(carpetaBase, '_xml_temporal');
      if (!fs.existsSync(carpetaXmlTemp)) fs.mkdirSync(carpetaXmlTemp, { recursive: true });

      let totalXmlTipo = 0;
      for (const configMes of meses) {
        avisar(onProgreso, `📅 ${etiqueta} - ${configMes.mes}`, { etapa: 'mes_inicio', mes: configMes.mes });
        const carpetaMesXml = path.join(carpetaXmlTemp, `Facturas ${configMes.mes}`);
        if (!fs.existsSync(carpetaMesXml)) fs.mkdirSync(carpetaMesXml, { recursive: true });

        await navegarAlFormulario(page);
        await buscarMes(page, configMes, paquete, tipo);
        const descargadosZip = await descargarXMLsDelMes(page, configMes, carpetaMesXml, onProgreso, paquete);
        if (descargadosZip > 0) extraerXMLsDeZips(carpetaMesXml);
        totalXmlTipo += descargadosZip;
        await esperar(1000);
      }

      const carpetaExcelTipo = path.join(carpetaBase, `${etiqueta} Excel`);
      let totalExcelTipo = 0;
      for (const configMes of meses) {
        const carpetaMesXml = path.join(carpetaXmlTemp, `Facturas ${configMes.mes}`);
        if (!fs.existsSync(carpetaMesXml)) continue;

        const carpetaMesExcel = path.join(carpetaExcelTipo, `Facturas ${configMes.mes}`);
        totalExcelTipo += await convertirXMLsAExcel(carpetaMesXml, carpetaMesExcel, onProgreso, configMes.mes);
      }

      fs.rmSync(carpetaXmlTemp, { recursive: true, force: true });

      resultadosPorTipo[tipo] = { total: totalExcelTipo, carpeta: carpetaExcelTipo };
    }
  } finally {
    await browser.close();
  }

  const total = Object.values(resultadosPorTipo).reduce((suma, r) => suma + r.total, 0);
  avisar(onProgreso, `🎉 Excel completado: ${total} archivos`, { etapa: 'completado', total });
  return { total, resultadosPorTipo, carpeta: carpetaDestino };
}

// ── OPCIÓN 4 (usada por server.js junto a excel-consolidado.js): ──
// El propio server.js llama a descargarSoloXML y luego a
// generarExcelConsolidado con los XML de cada tipo. No se duplica
// esa lógica aquí — ver server.js para el flujo de "consolidado".

// ── OPCIÓN 5: Todo lo anterior (PDF + XML + Excel + Consolidado) ──
// Hace login UNA sola vez y reutiliza los mismos XML descargados
// para generar el Excel por factura y el consolidado, en vez de
// volver a entrar a SUNAT o descargar los XML dos veces.
// Repite el ciclo completo por cada tipo elegido (1 o 2 veces si es 'ambas').
async function descargarTodo(credenciales, meses, carpetaDestino, onProgreso, paquete, tipoComprobante) {
  const anio = new Date().getFullYear();
  const { browser, page } = await abrirYLoguear(credenciales, onProgreso);
  const resultadosPorTipo = {};

  try {
    for (const tipo of tiposAProcesar(tipoComprobante)) {
      const etiqueta = etiquetaPaqueteTipo(paquete, tipo);
      const carpetaBase = path.join(carpetaDestino, `${etiqueta} ${anio}`);
      const carpetaPDF = path.join(carpetaBase, `${etiqueta} PDF`);
      const carpetaXML = path.join(carpetaBase, `${etiqueta} XML`);
      const carpetaExcel = path.join(carpetaBase, `${etiqueta} Excel`);
      const carpetaConsolidado = path.join(carpetaBase, `Consolidacion de Facturas Excel ${anio}`);

      [carpetaBase, carpetaPDF, carpetaXML, carpetaExcel, carpetaConsolidado].forEach(c => {
        if (!fs.existsSync(c)) fs.mkdirSync(c, { recursive: true });
      });

      let totalPDF = 0;
      let totalXML = 0;

      // FASE 1: PDF de todos los meses
      avisar(onProgreso, `📄 ${etiqueta} - FASE 1: Descargando PDFs`, { etapa: 'fase', fase: 'pdf' });
      for (const configMes of meses) {
        avisar(onProgreso, `📅 ${etiqueta} - ${configMes.mes}`, { etapa: 'mes_inicio', mes: configMes.mes, fase: 'pdf' });
        const carpetaMesPdf = path.join(carpetaPDF, `Facturas ${configMes.mes}`);
        if (!fs.existsSync(carpetaMesPdf)) fs.mkdirSync(carpetaMesPdf, { recursive: true });

        await navegarAlFormulario(page);
        await buscarMes(page, configMes, paquete, tipo);
        totalPDF += await descargarPDFsDelMes(page, configMes, carpetaMesPdf, onProgreso);
        await esperar(1000);
      }

      // FASE 2: XML de todos los meses (se reutilizan después, no se vuelven a descargar)
      avisar(onProgreso, `📦 ${etiqueta} - FASE 2: Descargando XML`, { etapa: 'fase', fase: 'xml' });
      for (const configMes of meses) {
        avisar(onProgreso, `📅 ${etiqueta} - ${configMes.mes}`, { etapa: 'mes_inicio', mes: configMes.mes, fase: 'xml' });
        const carpetaMesXml = path.join(carpetaXML, `Facturas ${configMes.mes}`);
        if (!fs.existsSync(carpetaMesXml)) fs.mkdirSync(carpetaMesXml, { recursive: true });

        await navegarAlFormulario(page);
        await buscarMes(page, configMes, paquete, tipo);
        const descargadosZip = await descargarXMLsDelMes(page, configMes, carpetaMesXml, onProgreso, paquete);

        if (descargadosZip > 0) {
          avisar(onProgreso, '  📂 Extrayendo XML de los .zip...', { etapa: 'extrayendo', mes: configMes.mes });
          extraerXMLsDeZips(carpetaMesXml);
        }

        totalXML += descargadosZip;
        await esperar(1000);
      }

      // FASE 3: Excel por factura, a partir de los XML ya descargados (sin volver a entrar a SUNAT)
      avisar(onProgreso, `📊 ${etiqueta} - FASE 3: Convirtiendo XML a Excel`, { etapa: 'fase', fase: 'excel' });
      let totalExcel = 0;
      for (const configMes of meses) {
        const carpetaMesXml = path.join(carpetaXML, `Facturas ${configMes.mes}`);
        if (!fs.existsSync(carpetaMesXml)) continue;

        const carpetaMesExcel = path.join(carpetaExcel, `Facturas ${configMes.mes}`);
        totalExcel += await convertirXMLsAExcel(carpetaMesXml, carpetaMesExcel, onProgreso, configMes.mes);
      }

      // FASE 4: Excel consolidado, a partir de los mismos XML (sin volver a entrar a SUNAT)
      avisar(onProgreso, `📋 ${etiqueta} - FASE 4: Generando Excel consolidado`, { etapa: 'fase', fase: 'consolidado' });
      const { generarExcelConsolidado } = require('./excel-consolidado');
      const etiquetaTipoTexto = tipo === 'emitidas' ? 'Emitida' : 'Recibida';

      let totalConsolidado = 0;
      try {
        const resultadoConsolidado = await generarExcelConsolidado(
          [{ carpetaXml: carpetaXML, etiquetaTipo: etiquetaTipoTexto }],
          carpetaConsolidado,
          onProgreso
        );
        totalConsolidado = resultadoConsolidado.total;
      } catch (errConsolidado) {
        // No hay comprobantes de este tipo en el rango elegido: no es un
        // error real del proceso (PDF y XML ya se completaron bien), así
        // que solo lo avisamos y seguimos, en vez de interrumpir todo.
        avisar(onProgreso, `  📭 ${etiqueta}: sin comprobantes en este rango, no se generó consolidado.`, { etapa: 'consolidado_vacio' });
      }

      resultadosPorTipo[tipo] = {
        totalPDF, totalXML, totalExcel,
        totalConsolidado,
        carpeta: carpetaBase,
      };
    }
  } finally {
    await browser.close();
  }

  avisar(onProgreso, '🎉 PROCESO COMPLETO TERMINADO', { etapa: 'completado_total', resultadosPorTipo });

  return { resultadosPorTipo, carpeta: carpetaDestino };
}

module.exports = {
  descargarOrganizado,
  descargarSoloPDF,
  descargarSoloXML,
  descargarSoloExcel,
  descargarTodo,
  tiposAProcesar,
  etiquetaPaqueteTipo,
};

// Explicit destinations supplied by the simulation coordinator; one SOL login.
async function descargarOrganizado(credenciales, meses, carpeta, onProgreso) {
  const { browser, page } = await abrirYLoguear(credenciales, onProgreso);
  try {
    for (const [pack, label] of [['FE','Facturas'],['NC','Notas de credito'],['ND','Notas de debito']]) {
      for (const [tipo, direction] of [['emitidas','Emitidas'],['recibidas','Recibidas']]) {
        const base = path.join(carpeta,'Comprobantes de pago',label,direction);
        for (const format of ['XML','PDF','Excel']) fs.mkdirSync(path.join(base,format),{recursive:true});
        for (const mes of meses) {
          const cb = event => avisar(onProgreso,event.mensaje,{...event,paquete:pack,tipo,mes:mes.mes});
          avisar(onProgreso, `${label} ${direction}: ${mes.mes}`,{etapa:'mes_inicio'});
          try {
            await navegarAlFormulario(page);
            await buscarMes(page,mes,pack,tipo);
            await descargarXMLsDelMes(page,mes,path.join(base,'XML'),cb,pack);
            extraerXMLsDeZips(path.join(base,'XML'),cb);
          } catch {
            avisar(onProgreso,`${label} ${direction}: descarga XML incompleta`,{etapa:'xml_error'});
          }
          try {
            await navegarAlFormulario(page);
            await buscarMes(page,mes,pack,tipo);
            await descargarPDFsDelMes(page,mes,path.join(base,'PDF'),cb);
          } catch {
            avisar(onProgreso,`${label} ${direction}: descarga PDF incompleta`,{etapa:'pdf_error'});
          }
        }
      }
    }
  } finally { await browser.close(); }
}
