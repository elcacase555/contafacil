// ============================================================
//  BASE DE DATOS - SQLite
// ============================================================
//
//  Qué hace:
//   Crea (si no existe) el archivo data/contafacil.db con dos tablas:
//
//   contadores      -> los usuarios que TÚ vendes (login del sistema)
//   clientes_sunat  -> los RUC que cada contador administra
//                      (cada fila queda ligada a un contador_id)
//
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
// las agregamos sin tocar los datos que ya hay. SQLite no tiene
// "ADD COLUMN IF NOT EXISTS", así que revisamos primero cuáles faltan.
const columnasExistentes = db.prepare(`PRAGMA table_info(contadores)`).all().map(c => c.name);

if (!columnasExistentes.includes('intentos_fallidos')) {
  db.exec(`ALTER TABLE contadores ADD COLUMN intentos_fallidos INTEGER NOT NULL DEFAULT 0`);
}
if (!columnasExistentes.includes('bloqueado_hasta')) {
  db.exec(`ALTER TABLE contadores ADD COLUMN bloqueado_hasta TEXT`);
}
if (!columnasExistentes.includes('nivel_bloqueo')) {
  db.exec(`ALTER TABLE contadores ADD COLUMN nivel_bloqueo INTEGER NOT NULL DEFAULT 0`);
}
if (!columnasExistentes.includes('terminos_aceptados')) {
  db.exec(`ALTER TABLE contadores ADD COLUMN terminos_aceptados INTEGER NOT NULL DEFAULT 0`);
}
if (!columnasExistentes.includes('terminos_aceptados_en')) {
  db.exec(`ALTER TABLE contadores ADD COLUMN terminos_aceptados_en TEXT`);
}
if (!columnasExistentes.includes('terminos_version')) {
  db.exec(`ALTER TABLE contadores ADD COLUMN terminos_version TEXT`);
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
// (no es una fila de "contadores", así que necesita su propio registro).
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_seguridad (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    nivel_bloqueo INTEGER NOT NULL DEFAULT 0
  );
`);

// Nos asegura que siempre exista exactamente una fila (id=1) para leer/actualizar
db.exec(`
  INSERT OR IGNORE INTO admin_seguridad (id, intentos_fallidos, nivel_bloqueo)
  VALUES (1, 0, 0);
`);

module.exports = db;
