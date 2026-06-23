// ============================================================
//  SERVIDOR PRINCIPAL - ContaFácil (multi-usuario)
//  Uso: node server.js
// ============================================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { cifrar, descifrar } = require('./crypto-sol');
const { elegirCarpeta } = require('./elegir-carpeta');
const { generarRangoMeses } = require('./scripts-sunat/rango-meses');
const { descargarSoloPDF, descargarSoloXML, descargarSoloExcel, descargarTodo, tiposAProcesar, etiquetaPaqueteTipo } = require('./scripts-sunat/sunat-motor');
const { generarExcelConsolidado } = require('./scripts-sunat/excel-consolidado');
const { registrarConexion, quitarConexion, emitirProgreso, cerrarJob } = require('./progreso-sse');
const { verificarBloqueo, registrarFallo, reiniciarPorExito } = require('./bloqueo-progresivo');
const crypto = require('crypto');

const app = express();
const PUERTO = process.env.PUERTO || 3000;
const EN_PRODUCCION = process.env.NODE_ENV === 'production';

// Cuando el servidor corre detrás de un proxy/balanceador (como en Render,
// Railway, u otros hostings), Express necesita saber esto para leer la IP
// REAL del visitante (si no, todo el rate limiting por IP vería siempre
// la IP del proxy, no la del atacante real, y la protección no serviría).
if (EN_PRODUCCION) {
  app.set('trust proxy', 1);
}

// ── CABECERAS DE SEGURIDAD: protege contra varios ataques comunes
// (clickjacking, sniffing de tipo de contenido, XSS básico, etc.) ──
// CSP (Content Security Policy) queda desactivado por ahora: las vistas
// actuales usan onclick="" y <script> inline en varios lugares, y CSP
// estricto los bloquearía por defecto. Activarlo bien requeriría primero
// migrar esos manejadores a addEventListener() en todas las vistas.
// Queda anotado como mejora futura, no es urgente para el lanzamiento.
app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(express.json({ limit: '100kb' })); // límite generoso para esta app (no se suben archivos por aquí), evita payloads gigantes
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── LÍMITE GLOBAL ANTI-DDOS: protege toda la aplicación de una IP que
// intente saturar el servidor con peticiones masivas, sin importar a
// qué ruta apunten. Es la primera línea de defensa contra DDoS básico
// a nivel de aplicación (no sustituye protección a nivel de red/hosting,
// pero ayuda mucho contra ataques simples o bots automatizados). ──
const limitadorGlobal = rateLimit({
  windowMs: 1 * 60 * 1000, // ventana de 1 minuto
  max: 120, // máximo 120 peticiones por IP por minuto (generoso para uso normal, corta abuso)
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiadas solicitudes. Espera un momento.' },
});
app.use(limitadorGlobal);

// ── LÍMITE ESTRICTO PARA DESCARGAS: cada descarga abre un navegador
// Playwright real, que consume bastante CPU/RAM. Sin este límite, alguien
// podría lanzar muchas descargas seguidas y tumbar el servidor (un DoS
// "de bajo costo" usando la propia función pesada de la app contra sí
// misma), incluso con una sola cuenta válida. ──
const limitadorDescargas = rateLimit({
  windowMs: 5 * 60 * 1000, // ventana de 5 minutos
  max: 10, // máximo 10 descargas iniciadas por IP en 5 minutos
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Has iniciado demasiadas descargas en poco tiempo. Espera unos minutos antes de iniciar otra.' },
});

// ── LÍMITE DE INTENTOS POR IP: capa adicional de protección, distinta
// al bloqueo progresivo por cuenta. Esta protege contra un atacante que
// pruebe muchos USUARIOS distintos desde la misma IP (el bloqueo
// progresivo por cuenta no alcanza a cubrir ese caso, porque cada
// usuario probado tiene su propio contador de fallos). ──
const limitadorPorIP = rateLimit({
  windowMs: 15 * 60 * 1000, // ventana de 15 minutos
  max: 30, // máximo 30 intentos de login por IP en esa ventana (suma de todos los usuarios probados)
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiados intentos desde esta conexión. Espera unos minutos.' },
});

// ── SESIÓN: mantiene al contador "logueado" mientras usa la app ──
app.use(session({
  secret: process.env.CLAVE_SECRETA_SESION || 'pon-una-clave-en-tu-.env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // la sesión dura 8 horas
    httpOnly: true, // la cookie no es accesible desde JavaScript del navegador (protege contra robo vía XSS)
    secure: EN_PRODUCCION, // exige HTTPS para enviar la cookie, solo cuando esté en producción
    sameSite: 'lax', // evita que la cookie se envíe desde sitios externos (protección CSRF básica)
  },
}));

// ── MIDDLEWARE: bloquea cualquier ruta si no ha iniciado sesión ──
function requiereLogin(req, res, next) {
  if (req.session && req.session.contadorId) {
    return next();
  }
  return res.redirect('/login');
}

// ── MIDDLEWARE: bloquea el panel de administrador si no es admin ──
function requiereAdmin(req, res, next) {
  if (req.session && req.session.esAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
}

// ── RUTA: pantalla de login ───────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// ── RUTA: procesar el login ───────────────────────────────
app.post('/login', limitadorPorIP, async (req, res) => {
  const { usuario, clave } = req.body;

  const contador = db.prepare(
    'SELECT * FROM contadores WHERE usuario = ? AND activo = 1'
  ).get(usuario);

  if (!contador) {
    return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos.' });
  }

  // Revisa si esta cuenta está actualmente bloqueada por demasiados fallos
  const estadoBloqueo = verificarBloqueo(contador);
  if (estadoBloqueo.bloqueado) {
    return res.status(429).json({
      ok: false,
      mensaje: `Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en ${estadoBloqueo.minutosRestantes} minuto(s).`,
    });
  }

  const claveCorrecta = await bcrypt.compare(clave, contador.clave_hash);

  const actualizarContador = (cambios) => {
    const campos = Object.keys(cambios).map(c => `${c} = ?`).join(', ');
    const valores = Object.values(cambios);
    db.prepare(`UPDATE contadores SET ${campos} WHERE id = ?`).run(...valores, contador.id);
  };

  if (!claveCorrecta) {
    const resultado = registrarFallo(contador, actualizarContador);

    if (resultado.bloqueadoAhora) {
      return res.status(429).json({
        ok: false,
        mensaje: `Demasiados intentos fallidos. Cuenta bloqueada por ${resultado.minutos} minuto(s).`,
      });
    }

    return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos.' });
  }

  // Login exitoso: se reinician los contadores de fallos y bloqueo
  reiniciarPorExito(actualizarContador);

  // Regeneramos el ID de sesión antes de asignar los datos del usuario.
  // Esto previene ataques de "fijación de sesión" (session fixation),
  // donde un atacante podría intentar reutilizar un ID de sesión conocido
  // de antes del login para suplantar a la cuenta tras la autenticación.
  req.session.regenerate((err) => {
    if (err) {
      console.error('Error regenerando sesión:', err);
      return res.status(500).json({ ok: false, mensaje: 'Ocurrió un error al iniciar sesión. Intenta de nuevo.' });
    }

    req.session.contadorId = contador.id;
    req.session.contadorNombre = contador.nombre;

    res.json({ ok: true });
  });
});

// ── RUTA: cerrar sesión ────────────────────────────────────
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

const { VERSION_TERMINOS, TITULO: TITULO_TERMINOS, CONTENIDO_HTML: CONTENIDO_TERMINOS } = require('./contenido-terminos');

// ── RUTA: datos del contador logueado (para mostrar su nombre en pantalla) ──
app.get('/api/mi-sesion', requiereLogin, (req, res) => {
  const contador = db.prepare('SELECT terminos_aceptados, terminos_version FROM contadores WHERE id = ?').get(req.session.contadorId);

  res.json({
    contadorId: req.session.contadorId,
    nombre: req.session.contadorNombre,
    // El contador debe aceptar términos si nunca los aceptó, O si aceptó
    // una versión anterior a la actual (por si en el futuro se actualizan).
    debeAceptarTerminos: !contador.terminos_aceptados || contador.terminos_version !== VERSION_TERMINOS,
  });
});

// ── RUTA: obtener el contenido de los Términos y Condiciones ──────
app.get('/api/terminos', requiereLogin, (req, res) => {
  res.json({ titulo: TITULO_TERMINOS, contenidoHtml: CONTENIDO_TERMINOS, version: VERSION_TERMINOS });
});

// ── RUTA: registrar que el contador aceptó los Términos y Condiciones ──
app.post('/api/terminos/aceptar', requiereLogin, (req, res) => {
  db.prepare(`
    UPDATE contadores
    SET terminos_aceptados = 1, terminos_aceptados_en = datetime('now'), terminos_version = ?
    WHERE id = ?
  `).run(VERSION_TERMINOS, req.session.contadorId);

  res.json({ ok: true });
});

// ── RUTA: el contador RECHAZA los términos -> se cierra la sesión y se le niega el acceso ──
app.post('/api/terminos/rechazar', requiereLogin, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ── RUTAS PROTEGIDAS: todo lo de aquí para abajo requiere login ──
app.get('/', requiereLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'principal.html'));
});

// ── RUTA: listar los clientes SUNAT del contador logueado ──────
app.get('/api/clientes', requiereLogin, (req, res) => {
  const clientes = db.prepare(`
    SELECT id, nombre_cliente, ruc, usuario_sol, creado_en
    FROM clientes_sunat
    WHERE contador_id = ?
    ORDER BY nombre_cliente ASC
  `).all(req.session.contadorId);

  // Nunca se devuelve la clave SOL cifrada al navegador, ni para
  // este listado ni en ninguna otra respuesta - se queda en el servidor.
  res.json(clientes);
});

// ── RUTA: agregar un cliente SUNAT nuevo, ligado al contador logueado ──
app.post('/api/clientes', requiereLogin, (req, res) => {
  const { nombreCliente, ruc, usuarioSol, claveSol } = req.body;

  if (!nombreCliente || !ruc || !usuarioSol || !claveSol) {
    return res.status(400).json({ ok: false, mensaje: 'Todos los campos son obligatorios.' });
  }

  const nombreLimpio = String(nombreCliente).trim();
  const usuarioLimpio = String(usuarioSol).trim();

  // Límites de longitud razonables, evita abuso con strings extremadamente largos
  if (nombreLimpio.length === 0 || nombreLimpio.length > 150) {
    return res.status(400).json({ ok: false, mensaje: 'El nombre del cliente debe tener entre 1 y 150 caracteres.' });
  }
  if (usuarioLimpio.length === 0 || usuarioLimpio.length > 100) {
    return res.status(400).json({ ok: false, mensaje: 'El usuario SOL no es válido.' });
  }
  if (String(claveSol).length > 200) {
    return res.status(400).json({ ok: false, mensaje: 'La clave SOL no es válida.' });
  }

  const rucLimpio = String(ruc).trim();
  if (!/^\d{11}$/.test(rucLimpio)) {
    return res.status(400).json({ ok: false, mensaje: 'El RUC debe tener 11 dígitos.' });
  }

  const claveCifrada = cifrar(claveSol);

  const resultado = db.prepare(`
    INSERT INTO clientes_sunat (contador_id, nombre_cliente, ruc, usuario_sol, clave_sol_cifrada)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.contadorId, nombreLimpio, rucLimpio, usuarioLimpio, claveCifrada);

  res.json({ ok: true, id: resultado.lastInsertRowid });
});

// ── RUTA: eliminar un cliente SUNAT (solo si pertenece al contador logueado) ──
app.delete('/api/clientes/:id', requiereLogin, (req, res) => {
  const resultado = db.prepare(`
    DELETE FROM clientes_sunat WHERE id = ? AND contador_id = ?
  `).run(req.params.id, req.session.contadorId);

  if (resultado.changes === 0) {
    return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado.' });
  }

  res.json({ ok: true });
});

// ── RUTA: pantalla del panel de opciones de un cliente ────
app.get('/cliente/:id', requiereLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'cliente.html'));
});

// ── RUTA: pantalla del selector de fechas + carpeta para una opción ──
app.get('/cliente/:id/:opcion', requiereLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'descargar.html'));
});

// ── RUTA: obtener los datos de un cliente (sin la clave SOL) ──
app.get('/api/clientes/:id', requiereLogin, (req, res) => {
  const cliente = db.prepare(`
    SELECT id, nombre_cliente, ruc, usuario_sol
    FROM clientes_sunat
    WHERE id = ? AND contador_id = ?
  `).get(req.params.id, req.session.contadorId);

  if (!cliente) {
    return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado.' });
  }

  res.json(cliente);
});

// ── RUTA: abrir el explorador de Windows para elegir carpeta ──
app.post('/api/elegir-carpeta', requiereLogin, async (req, res) => {
  try {
    const ruta = await elegirCarpeta();
    res.json({ ok: true, ruta }); // ruta será null si el contador canceló
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'No se pudo abrir el explorador de carpetas.' });
  }
});

// ── RUTA: conexión de progreso en vivo (Server-Sent Events) ──
// ── RUTA: conexión de progreso en vivo (Server-Sent Events) ──
// Protegida con un límite de tiempo de vida máximo, para que una conexión
// olvidada/abusiva no quede consumiendo recursos del servidor para siempre.
app.get('/api/progreso/:jobId', requiereLogin, (req, res) => {
  // Validamos que el jobId tenga formato de UUID real (el único formato
  // que el propio servidor genera) antes de registrar la conexión.
  const formatoUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!formatoUUID.test(req.params.jobId)) {
    return res.status(400).json({ ok: false, mensaje: 'Identificador de proceso no válido.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  registrarConexion(req.params.jobId, res);

  // Tiempo máximo de vida de la conexión: 30 minutos. Cualquier descarga
  // real debería completarse mucho antes; esto evita conexiones colgadas
  // indefinidamente si algo queda mal cerrado.
  const limiteTiempo = setTimeout(() => {
    quitarConexion(req.params.jobId, res);
    res.end();
  }, 30 * 60 * 1000);

  req.on('close', () => {
    clearTimeout(limiteTiempo);
    quitarConexion(req.params.jobId, res);
  });
});

// ── RUTA: iniciar una descarga (las 5 opciones llegan aquí, con "tipo" distinto) ──
app.post('/api/descargar', requiereLogin, limitadorDescargas, async (req, res) => {
  const { clienteId, tipo, carpetaDestino, anioDesde, mesDesde, anioHasta, mesHasta, paquete, tipoComprobante } = req.body;

  // Validación estricta del tipo de descarga: solo se acepta uno de estos 5 valores exactos
  const TIPOS_VALIDOS = ['pdf', 'xml', 'excel', 'consolidado', 'todo'];
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: 'Tipo de descarga no válido.' });
  }

  // Validación del paquete (FE/NC/ND) y tipo de comprobante (emitidas/recibidas/ambas)
  const PAQUETES_VALIDOS = ['FE', 'NC', 'ND'];
  const TIPOS_COMPROBANTE_VALIDOS = ['emitidas', 'recibidas', 'ambas'];

  if (!PAQUETES_VALIDOS.includes(paquete)) {
    return res.status(400).json({ ok: false, mensaje: 'Paquete de comprobante no válido.' });
  }
  if (!TIPOS_COMPROBANTE_VALIDOS.includes(tipoComprobante)) {
    return res.status(400).json({ ok: false, mensaje: 'Tipo de comprobante no válido.' });
  }

  // clienteId debe ser un número entero válido (evita inyecciones o IDs malformados)
  const clienteIdNum = Number(clienteId);
  if (!Number.isInteger(clienteIdNum) || clienteIdNum <= 0) {
    return res.status(400).json({ ok: false, mensaje: 'Cliente no válido.' });
  }

  const cliente = db.prepare(`
    SELECT * FROM clientes_sunat WHERE id = ? AND contador_id = ?
  `).get(clienteIdNum, req.session.contadorId);

  if (!cliente) {
    return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado.' });
  }

  if (!carpetaDestino || typeof carpetaDestino !== 'string' || carpetaDestino.trim().length === 0) {
    return res.status(400).json({ ok: false, mensaje: 'Debes elegir una carpeta de destino.' });
  }

  const credenciales = {
    ruc: cliente.ruc,
    usuario: cliente.usuario_sol,
    password: descifrar(cliente.clave_sol_cifrada),
  };

  // Validación estricta del rango de fechas: deben ser números enteros
  // dentro de rangos razonables (evita valores absurdos o no numéricos
  // que podrían generar bucles largos o comportamiento inesperado).
  const anioDesdeNum = Number(anioDesde);
  const mesDesdeNum = Number(mesDesde);
  const anioHastaNum = Number(anioHasta);
  const mesHastaNum = Number(mesHasta);

  const anioMinimo = 2018; // SUNAT no tiene facturación electrónica masiva antes de esto
  const anioMaximo = new Date().getFullYear() + 1;

  const fechasValidas =
    Number.isInteger(anioDesdeNum) && anioDesdeNum >= anioMinimo && anioDesdeNum <= anioMaximo &&
    Number.isInteger(anioHastaNum) && anioHastaNum >= anioMinimo && anioHastaNum <= anioMaximo &&
    Number.isInteger(mesDesdeNum) && mesDesdeNum >= 1 && mesDesdeNum <= 12 &&
    Number.isInteger(mesHastaNum) && mesHastaNum >= 1 && mesHastaNum <= 12;

  if (!fechasValidas) {
    return res.status(400).json({ ok: false, mensaje: 'El rango de fechas no es válido.' });
  }

  const meses = generarRangoMeses(anioDesdeNum, mesDesdeNum, anioHastaNum, mesHastaNum);

  if (meses.length === 0) {
    return res.status(400).json({ ok: false, mensaje: 'El rango de fechas no generó ningún mes.' });
  }

  if (meses.length > 36) {
    return res.status(400).json({ ok: false, mensaje: 'El rango es demasiado amplio (máximo 36 meses por descarga).' });
  }

  // Insertamos una carpeta con el nombre del cliente entre la carpeta que
  // eligió el contador y las carpetas que crea el motor (PDF/XML/Excel/etc),
  // así todo queda ordenado por cliente: "Carpeta elegida/Nombre Cliente/...".
  const nombreCarpetaCliente = cliente.nombre_cliente
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-'); // quita caracteres no válidos en nombres de carpeta de Windows

  const carpetaCliente = path.join(carpetaDestino, nombreCarpetaCliente);

  // Generamos un ID único para este trabajo, así el navegador puede
  // conectarse a /api/progreso/:jobId y seguirlo en tiempo real.
  const jobId = crypto.randomUUID();
  res.json({ ok: true, jobId });

  // A partir de aquí, el proceso sigue en segundo plano. Cada función
  // del motor de SUNAT llama a onProgreso(datos) en cada paso, y eso
  // se reenvía al navegador conectado a este jobId.
  const onProgreso = (datos) => emitirProgreso(jobId, datos);

  try {
    let resultado;

    switch (tipo) {
      case 'pdf':
        resultado = await descargarSoloPDF(credenciales, meses, carpetaCliente, onProgreso, paquete, tipoComprobante);
        break;
      case 'xml':
        resultado = await descargarSoloXML(credenciales, meses, carpetaCliente, onProgreso, paquete, tipoComprobante);
        break;
      case 'excel':
        resultado = await descargarSoloExcel(credenciales, meses, carpetaCliente, onProgreso, paquete, tipoComprobante);
        break;
      case 'consolidado': {
        // El consolidado necesita los XML primero. Si el contador eligió
        // "ambas", se descargan Emitidas Y Recibidas (en la misma sesión
        // de login) y se COMBINAN en una sola tabla con columna "Tipo",
        // a diferencia de "Todo lo anterior" que genera consolidados
        // separados por tipo.
        const tiposElegidos = tiposAProcesar(tipoComprobante);
        const fuentesConsolidado = [];
        let carpetaBaseConsolidado = carpetaCliente;

        for (const tipoUno of tiposElegidos) {
          // Descargamos los XML para este tipo específico (una llamada
          // por tipo; cada llamada abre y cierra su propia sesión, ya que
          // descargarSoloXML está diseñado para un solo "tipoComprobante").
          const sesionXml = await descargarSoloXML(credenciales, meses, carpetaCliente, onProgreso, paquete, tipoUno);
          const etiqueta = etiquetaPaqueteTipo(paquete, tipoUno);
          const etiquetaTipoTexto = tipoUno === 'emitidas' ? 'Emitida' : 'Recibida';

          fuentesConsolidado.push({
            carpetaXml: sesionXml.resultadosPorTipo[tipoUno].carpeta,
            etiquetaTipo: etiquetaTipoTexto,
          });

          carpetaBaseConsolidado = path.join(carpetaCliente, `${etiqueta} ${new Date().getFullYear()}`);
        }

        // Si se combinaron ambos tipos, el consolidado va en una carpeta
        // común a nivel del cliente (no dentro de "FE Emitidas" ni "FE Recibidas",
        // porque mezcla ambas). Si fue solo un tipo, queda dentro de su carpeta.
        const carpetaConsolidadoFinal = tiposElegidos.length > 1
          ? path.join(carpetaCliente, `${paquete} Consolidado (Emitidas + Recibidas) ${new Date().getFullYear()}`)
          : path.join(carpetaBaseConsolidado, `Consolidacion de Facturas Excel ${new Date().getFullYear()}`);

        resultado = await generarExcelConsolidado(fuentesConsolidado, carpetaConsolidadoFinal, onProgreso);
        break;
      }
      case 'todo':
        resultado = await descargarTodo(credenciales, meses, carpetaCliente, onProgreso, paquete, tipoComprobante);
        break;
      default:
        throw new Error('Tipo de descarga no reconocido: ' + tipo);
    }

    // Calculamos si el resultado fue "vacío" (0 archivos en total), sin
    // importar qué opción se eligió, para avisar con un mensaje claro en
    // vez de decir "completado" cuando en realidad no se encontró nada.
    function calcularTotalGeneral(tipoDescarga, res) {
      if (!res) return 0;
      if (typeof res.total === 'number') return res.total; // pdf, xml, excel, consolidado
      if (res.resultadosPorTipo) {
        // 'todo': suma totalPDF + totalXML + totalExcel + totalConsolidado de cada tipo procesado
        return Object.values(res.resultadosPorTipo).reduce((suma, r) => {
          return suma + (r.totalPDF || 0) + (r.totalXML || 0) + (r.totalExcel || 0) + (r.totalConsolidado || 0);
        }, 0);
      }
      return 0;
    }

    const totalGeneral = calcularTotalGeneral(tipo, resultado);

    if (totalGeneral === 0) {
      cerrarJob(jobId, {
        ok: true,
        mensaje: '📭 Proceso terminado: no se encontraron comprobantes de este tipo en el rango de fechas elegido.',
        resultado,
      });
    } else {
      cerrarJob(jobId, { ok: true, mensaje: '🎉 Proceso completado correctamente.', resultado });
    }
  } catch (err) {
    // El detalle técnico completo se queda SOLO en la consola del servidor.
    console.error('Error en el proceso de descarga:', err);

    // Caso especial: no es un error real, simplemente no había comprobantes
    // en el rango de fechas elegido (ej. NC o ND sin movimientos ese mes).
    // Le damos un mensaje claro en vez del genérico de "verifica credenciales".
    const sinComprobantes =
      err.message && err.message.includes('No se encontró ninguna factura XML para consolidar');

    if (sinComprobantes) {
      cerrarJob(jobId, {
        ok: false,
        mensaje: '📭 No se encontraron comprobantes de este tipo en el rango de fechas elegido. Revisa el periodo o el tipo de comprobante seleccionado.',
      });
      return;
    }

    cerrarJob(jobId, { ok: false, mensaje: '❌ Ocurrió un error durante la descarga. Verifica las credenciales del cliente o vuelve a intentarlo.' });
  }
});

// ============================================================
//  PANEL DE ADMINISTRADOR (solo para ti, el dueño del sistema)
// ============================================================

// ── RUTA: pantalla de login de administrador ──────────────
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-login.html'));
});

// ── RUTA: procesar el login de administrador ──────────────
app.post('/admin/login', limitadorPorIP, (req, res) => {
  const { clave } = req.body;
  const claveAdmin = process.env.CLAVE_ADMIN;

  if (!claveAdmin) {
    return res.status(500).json({ ok: false, mensaje: 'No se configuró CLAVE_ADMIN en el archivo .env.' });
  }

  const estadoSeguridad = db.prepare('SELECT * FROM admin_seguridad WHERE id = 1').get();

  const estadoBloqueo = verificarBloqueo(estadoSeguridad);
  if (estadoBloqueo.bloqueado) {
    return res.status(429).json({
      ok: false,
      mensaje: `Acceso bloqueado temporalmente por demasiados intentos fallidos. Intenta de nuevo en ${estadoBloqueo.minutosRestantes} minuto(s).`,
    });
  }

  const actualizarAdmin = (cambios) => {
    const campos = Object.keys(cambios).map(c => `${c} = ?`).join(', ');
    const valores = Object.values(cambios);
    db.prepare(`UPDATE admin_seguridad SET ${campos} WHERE id = 1`).run(...valores);
  };

  if (clave !== claveAdmin) {
    const resultado = registrarFallo(estadoSeguridad, actualizarAdmin);

    if (resultado.bloqueadoAhora) {
      return res.status(429).json({
        ok: false,
        mensaje: `Demasiados intentos fallidos. Acceso bloqueado por ${resultado.minutos} minuto(s).`,
      });
    }

    return res.status(401).json({ ok: false, mensaje: 'Contraseña de administrador incorrecta.' });
  }

  reiniciarPorExito(actualizarAdmin);

  // Misma protección anti session-fixation que en el login de contadores
  req.session.regenerate((err) => {
    if (err) {
      console.error('Error regenerando sesión de admin:', err);
      return res.status(500).json({ ok: false, mensaje: 'Ocurrió un error al iniciar sesión. Intenta de nuevo.' });
    }

    req.session.esAdmin = true;
    res.json({ ok: true });
  });
});

// ── RUTA: cerrar sesión de administrador ──────────────────
app.post('/admin/logout', (req, res) => {
  req.session.esAdmin = false;
  res.json({ ok: true });
});

// ── RUTA: pantalla principal del panel de administrador ───
app.get('/admin', requiereAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ── RUTA: listar todos los contadores, con su cantidad de clientes ──
app.get('/api/admin/contadores', requiereAdmin, (req, res) => {
  const contadores = db.prepare(`
    SELECT
      c.id, c.nombre, c.usuario, c.activo, c.creado_en,
      c.terminos_aceptados, c.terminos_aceptados_en,
      (SELECT COUNT(*) FROM clientes_sunat WHERE contador_id = c.id) AS total_clientes
    FROM contadores c
    ORDER BY c.creado_en DESC
  `).all();

  res.json(contadores);
});

// ── RUTA: crear un contador nuevo desde el panel ──────────
app.post('/api/admin/contadores', requiereAdmin, async (req, res) => {
  const { nombre, usuario, clave } = req.body;

  if (!nombre || !usuario || !clave) {
    return res.status(400).json({ ok: false, mensaje: 'Todos los campos son obligatorios.' });
  }

  if (String(clave).length < 8) {
    return res.status(400).json({ ok: false, mensaje: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  const yaExiste = db.prepare('SELECT id FROM contadores WHERE usuario = ?').get(usuario);
  if (yaExiste) {
    return res.status(400).json({ ok: false, mensaje: `Ya existe un contador con el usuario "${usuario}".` });
  }

  const claveHash = await bcrypt.hash(clave, 10);

  const resultado = db.prepare(`
    INSERT INTO contadores (nombre, usuario, clave_hash)
    VALUES (?, ?, ?)
  `).run(nombre.trim(), usuario.trim(), claveHash);

  res.json({ ok: true, id: resultado.lastInsertRowid });
});

// ── RUTA: activar / desactivar un contador (sin borrarlo) ──
app.patch('/api/admin/contadores/:id/activo', requiereAdmin, (req, res) => {
  const { activo } = req.body; // true o false

  const resultado = db.prepare(`
    UPDATE contadores SET activo = ? WHERE id = ?
  `).run(activo ? 1 : 0, req.params.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ ok: false, mensaje: 'Contador no encontrado.' });
  }

  res.json({ ok: true });
});

// ── RUTA: cambiar la contraseña de un contador existente ───
app.patch('/api/admin/contadores/:id/clave', requiereAdmin, async (req, res) => {
  const { clave } = req.body;

  if (!clave) {
    return res.status(400).json({ ok: false, mensaje: 'Debes indicar la nueva contraseña.' });
  }

  const claveHash = await bcrypt.hash(clave, 10);

  const resultado = db.prepare(`
    UPDATE contadores SET clave_hash = ? WHERE id = ?
  `).run(claveHash, req.params.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ ok: false, mensaje: 'Contador no encontrado.' });
  }

  res.json({ ok: true });
});

// ── RUTA: eliminar un contador y todos sus clientes SUNAT ──
app.delete('/api/admin/contadores/:id', requiereAdmin, (req, res) => {
  // Primero borramos sus clientes SUNAT (por la relación de llave foránea),
  // luego al contador mismo.
  db.prepare('DELETE FROM clientes_sunat WHERE contador_id = ?').run(req.params.id);
  const resultado = db.prepare('DELETE FROM contadores WHERE id = ?').run(req.params.id);

  if (resultado.changes === 0) {
    return res.status(404).json({ ok: false, mensaje: 'Contador no encontrado.' });
  }

  res.json({ ok: true });
});

// ── MANEJADOR GLOBAL DE ERRORES ───────────────────────────
// Si cualquier ruta lanza un error no controlado, esto evita que
// Express muestre la página de error por defecto (que en desarrollo
// incluye el stack trace completo - información valiosa para un
// atacante). El detalle completo solo queda en la consola del servidor.
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(500).json({ ok: false, mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.' });
});

app.listen(PUERTO, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PUERTO}\n`);
});