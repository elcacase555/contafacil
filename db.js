// ============================================================
//  BASE DE DATOS - PostgreSQL (Neon)
// ============================================================
//
//  Qué hace:
//   Se conecta a la base de datos PostgreSQL en Neon (usando la
//   variable de entorno DATABASE_URL del archivo .env), crea las
//   tablas si no existen, y expone una API similar a better-sqlite3
//   (db.prepare(sql).get/.all/.run) pero ASÍNCRONA (con await),
//   para minimizar los cambios necesarios en el resto del código.
//
//   IMPORTANTE: a diferencia de la versión SQLite anterior, aquí
//   TODAS las llamadas (.get, .all, .run) devuelven una Promise,
//   así que en el código que las usa hace falta "await" delante.
//
//   Las consultas SQL existentes usaban "?" como marcador de
//   parámetros (estilo SQLite). PostgreSQL usa "$1, $2, $3...".
//   Para no tener que reescribir cada consulta a mano, esta capa
//   traduce automáticamente los "?" a "$1,$2,..." antes de
//   ejecutar la consulta.
// ============================================================

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Falta DATABASE_URL en el archivo .env. Debe ser la cadena de conexión ' +
    'de tu base de datos en Neon (postgresql://...).'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon exige SSL; esto lo acepta sin pedir certificados locales
});

// Convierte una consulta con "?" (estilo SQLite) a "$1,$2,..." (estilo Postgres)
function convertirPlaceholders(sql) {
  let contador = 0;
  return sql.replace(/\?/g, () => {
    contador++;
    return `$${contador}`;
  });
}

// Objeto que imita la API de better-sqlite3: db.prepare(sql).get/.all/.run(...params)
function prepare(sqlOriginal) {
  const sqlConvertido = convertirPlaceholders(sqlOriginal);

  return {
    // Devuelve UNA fila (o undefined si no hay resultados) - como better-sqlite3 .get()
    async get(...params) {
      const resultado = await pool.query(sqlConvertido, params);
      return resultado.rows[0];
    },

    // Devuelve TODAS las filas - como better-sqlite3 .all()
    async all(...params) {
      const resultado = await pool.query(sqlConvertido, params);
      return resultado.rows;
    },

    // Para INSERT/UPDATE/DELETE - como better-sqlite3 .run()
    // Postgres no devuelve "lastInsertRowid" de forma nativa como SQLite;
    // para eso, las consultas INSERT deben agregar "RETURNING id" (ya
    // ajustado en server.js donde se necesita ese valor).
    async run(...params) {
      const resultado = await pool.query(sqlConvertido, params);
      return {
        changes: resultado.rowCount,
        lastInsertRowid: resultado.rows[0]?.id, // disponible solo si la consulta usa RETURNING id
      };
    },
  };
}

// ── CREACIÓN DE TABLAS (equivalente a las de SQLite, sintaxis Postgres) ──
async function inicializarTablas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contadores (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      usuario TEXT NOT NULL UNIQUE,
      clave_hash TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      intentos_fallidos INTEGER NOT NULL DEFAULT 0,
      bloqueado_hasta TIMESTAMP,
      nivel_bloqueo INTEGER NOT NULL DEFAULT 0,
      terminos_aceptados INTEGER NOT NULL DEFAULT 0,
      terminos_aceptados_en TIMESTAMP,
      terminos_version TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes_sunat (
      id SERIAL PRIMARY KEY,
      contador_id INTEGER NOT NULL REFERENCES contadores(id),
      nombre_cliente TEXT NOT NULL,
      ruc TEXT NOT NULL,
      usuario_sol TEXT NOT NULL,
      clave_sol_cifrada TEXT NOT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_seguridad (
      id INTEGER PRIMARY KEY,
      intentos_fallidos INTEGER NOT NULL DEFAULT 0,
      bloqueado_hasta TIMESTAMP,
      nivel_bloqueo INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    INSERT INTO admin_seguridad (id, intentos_fallidos, nivel_bloqueo)
    VALUES (1, 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);
}

// Ejecutamos la inicialización al cargar el módulo. Como esto es async y el
// resto del código espera poder usar "prepare" de inmediato, exponemos una
// promesa que server.js debe esperar antes de aceptar peticiones (ver
// "listoParaUsar" más abajo).
const listoParaUsar = inicializarTablas().catch((err) => {
  console.error('❌ Error inicializando las tablas de la base de datos:', err);
  process.exit(1);
});

module.exports = { prepare, listoParaUsar, pool };
