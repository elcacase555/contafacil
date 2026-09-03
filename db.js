// ============================================================
//  BASE DE DATOS - SQLite (versión LOCAL, sin internet)
// ============================================================
//
//  Qué hace:
//   Crea (si no existe) el archivo data/contafacil.db con las
//   tablas necesarias. Esta es la versión 100% local, sin Neon
//   ni Render - para seguir trabajando en tu PC mientras se
//   termina la versión web con selector de carpeta real.
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');

const RUTA_DB = path.join(__dirname, 'data', 'contafacil.db');

const db = new Database(RUTA_DB);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS contadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    clave_hash TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    nivel_bloqueo INTEGER NOT NULL DEFAULT 0,
    terminos_aceptados INTEGER NOT NULL DEFAULT 0,
    terminos_aceptados_en TEXT,
    terminos_version TEXT
  );
`);

// Migración segura: si la tabla ya existía de antes (sin estas columnas),
// las agregamos sin tocar los datos que ya hay.
const columnasExistentes = db.prepare(`PRAGMA table_info(contadores)`).all().map(c => c.name);

const columnasNuevas = [
  ['intentos_fallidos', 'INTEGER NOT NULL DEFAULT 0'],
  ['bloqueado_hasta', 'TEXT'],
  ['nivel_bloqueo', 'INTEGER NOT NULL DEFAULT 0'],
  ['terminos_aceptados', 'INTEGER NOT NULL DEFAULT 0'],
  ['terminos_aceptados_en', 'TEXT'],
  ['terminos_version', 'TEXT'],
];

for (const [nombre, tipo] of columnasNuevas) {
  if (!columnasExistentes.includes(nombre)) {
    db.exec(`ALTER TABLE contadores ADD COLUMN ${nombre} ${tipo}`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes_sunat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contador_id INTEGER NOT NULL,
    nombre_cliente TEXT NOT NULL,
    ruc TEXT NOT NULL,
    usuario_sol TEXT NOT NULL,
    clave_sol_cifrada TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (contador_id) REFERENCES contadores(id)
  );
`);

// Tabla separada para rastrear el bloqueo del login de administrador
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_seguridad (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    nivel_bloqueo INTEGER NOT NULL DEFAULT 0
  );
`);

db.exec(`
  INSERT OR IGNORE INTO admin_seguridad (id, intentos_fallidos, nivel_bloqueo)
  VALUES (1, 0, 0);
`);

module.exports = db;
