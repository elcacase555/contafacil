-- =============================================================================
-- ContaFácil — Núcleo contable (SQLite)
-- Multi-tenant: TODAS las filas contables se aíslan por cliente_id
--   cliente_id = clientes_sunat.id  (empresa del contador)
-- Tablas existentes que NO se tocan: contadores, clientes_sunat, admin_seguridad
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Ejercicios fiscales por empresa
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ejercicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  anio INTEGER NOT NULL,                 -- ej. 2026
  cerrado INTEGER NOT NULL DEFAULT 0,    -- 0 abierto, 1 cerrado
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, anio),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id)
);

CREATE INDEX IF NOT EXISTS idx_ejercicios_cliente ON ejercicios(cliente_id);

-- -----------------------------------------------------------------------------
-- Periodos mensuales (opcional; también se puede usar mes en documentos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ejercicio_id INTEGER NOT NULL,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cerrado INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ejercicio_id, mes),
  FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id)
);

CREATE INDEX IF NOT EXISTS idx_periodos_ejercicio ON periodos(ejercicio_id);

-- -----------------------------------------------------------------------------
-- Plan de cuentas (PCGE)
-- cliente_id NULL = plantilla global; NOT NULL = copia / plan propio del cliente
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER,                    -- NULL = plantilla global
  codigo TEXT NOT NULL,                  -- ej. '1011', '40111'
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'orden'
  )),
  nivel INTEGER NOT NULL DEFAULT 1,       -- 1 elemento, 2 cuenta, 3 subcuenta…
  padre_codigo TEXT,                     -- código del padre (misma plantilla/cliente)
  acepta_movimiento INTEGER NOT NULL DEFAULT 1, -- 1 = imputable
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id)
);

-- Unicidad: plantilla global (cliente_id IS NULL) y por cliente
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_cuentas_global
  ON plan_cuentas(codigo) WHERE cliente_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_cuentas_cliente
  ON plan_cuentas(cliente_id, codigo) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_cliente ON plan_cuentas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_padre ON plan_cuentas(padre_codigo);

-- -----------------------------------------------------------------------------
-- Comprobantes (cabecera UBL 2.1 / manual)
-- sentido: emitida (venta) | recibida (compra)
-- tipo_doc: 01 Factura, 03 Boleta, 07 NC, 08 ND, etc.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comprobantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  sentido TEXT NOT NULL CHECK (sentido IN ('emitida', 'recibida')),
  tipo_doc TEXT NOT NULL,                -- '01','03','07','08',...
  serie TEXT NOT NULL,
  numero TEXT NOT NULL,
  fecha_emision TEXT NOT NULL,           -- ISO date YYYY-MM-DD
  fecha_vencimiento TEXT,
  ruc_contraparte TEXT,
  razon_contraparte TEXT,
  moneda TEXT NOT NULL DEFAULT 'PEN',    -- PEN / USD
  tipo_cambio REAL,                     -- NULL si PEN
  gravado REAL NOT NULL DEFAULT 0,
  exonerado REAL NOT NULL DEFAULT 0,
  inafecto REAL NOT NULL DEFAULT 0,
  gratuito REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  isc REAL NOT NULL DEFAULT 0,
  otros REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  xml_path TEXT,
  xml_hash TEXT,                        -- deduplicar re-importaciones
  estado TEXT NOT NULL DEFAULT 'registrado'
    CHECK (estado IN ('registrado', 'contabilizado', 'anulado', 'observado')),
  origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('sunat_download', 'manual', 'import_excel')),
  ejercicio INTEGER,                    -- año derivado de fecha_emision
  mes INTEGER,                          -- 1-12
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, sentido, tipo_doc, serie, numero),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id)
);

CREATE INDEX IF NOT EXISTS idx_comprobantes_cliente_fecha
  ON comprobantes(cliente_id, fecha_emision);
CREATE INDEX IF NOT EXISTS idx_comprobantes_cliente_periodo
  ON comprobantes(cliente_id, ejercicio, mes);
CREATE INDEX IF NOT EXISTS idx_comprobantes_hash
  ON comprobantes(cliente_id, xml_hash);
CREATE INDEX IF NOT EXISTS idx_comprobantes_contraparte
  ON comprobantes(cliente_id, ruc_contraparte);

-- -----------------------------------------------------------------------------
-- Ítems de comprobante (opcional)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comprobante_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comprobante_id INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 1,
  codigo TEXT,
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  unidad TEXT,
  valor_unitario REAL NOT NULL DEFAULT 0,
  valor_venta REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comprobante_items_cab
  ON comprobante_items(comprobante_id);

-- -----------------------------------------------------------------------------
-- Asientos — Libro diario
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,                  -- YYYY-MM-DD
  glosa TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('auto_xml', 'manual', 'ajuste', 'apertura', 'cierre')),
  comprobante_id INTEGER,               -- NULL si asiento manual / ajuste
  correlativo INTEGER,                  -- correlativo diario/anual (app)
  ejercicio INTEGER NOT NULL,           -- año
  mes INTEGER,                          -- 1-12
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'publicado', 'anulado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id),
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id)
);

CREATE INDEX IF NOT EXISTS idx_asientos_cliente_fecha
  ON asientos(cliente_id, fecha);
CREATE INDEX IF NOT EXISTS idx_asientos_cliente_ejercicio
  ON asientos(cliente_id, ejercicio, mes);
CREATE INDEX IF NOT EXISTS idx_asientos_comprobante
  ON asientos(comprobante_id);

-- -----------------------------------------------------------------------------
-- Líneas de asiento (partida doble: validar SUM(debe)=SUM(haber) en app)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asiento_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asiento_id INTEGER NOT NULL,
  cuenta_codigo TEXT NOT NULL,
  debe REAL NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber REAL NOT NULL DEFAULT 0 CHECK (haber >= 0),
  centro_costo TEXT,                    -- opcional
  glosa_linea TEXT,
  -- Una línea no debe tener debe y haber > 0 a la vez (regla blanda; app)
  FOREIGN KEY (asiento_id) REFERENCES asientos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asiento_lineas_asiento ON asiento_lineas(asiento_id);
CREATE INDEX IF NOT EXISTS idx_asiento_lineas_cuenta ON asiento_lineas(cuenta_codigo);

-- -----------------------------------------------------------------------------
-- Registro de Ventas (RRVV) — columnas orientadas a SIRE / RVIE
-- Se llena por servicio de posting (no solo vista)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  comprobante_id INTEGER,
  periodo TEXT NOT NULL,                -- YYYYMM
  fecha_emision TEXT NOT NULL,
  tipo_doc TEXT NOT NULL,
  serie TEXT NOT NULL,
  numero TEXT NOT NULL,
  tipo_doc_cliente TEXT,                -- 6=RUC, 1=DNI…
  num_doc_cliente TEXT,
  razon_social TEXT,
  base_gravada REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  exonerado REAL NOT NULL DEFAULT 0,
  inafecto REAL NOT NULL DEFAULT 0,
  exportacion REAL NOT NULL DEFAULT 0,
  otros REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  tipo_cambio REAL,
  estado TEXT NOT NULL DEFAULT 'activo',
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id),
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id)
);

CREATE INDEX IF NOT EXISTS idx_reg_ventas_cliente_periodo
  ON registro_ventas(cliente_id, periodo);
CREATE INDEX IF NOT EXISTS idx_reg_ventas_comprobante
  ON registro_ventas(comprobante_id);

-- -----------------------------------------------------------------------------
-- Registro de Compras (RRCC) — columnas orientadas a SIRE / RCE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  comprobante_id INTEGER,
  periodo TEXT NOT NULL,                -- YYYYMM
  fecha_emision TEXT NOT NULL,
  fecha_vencimiento TEXT,
  tipo_doc TEXT NOT NULL,
  serie TEXT NOT NULL,
  numero TEXT NOT NULL,
  tipo_doc_proveedor TEXT,
  num_doc_proveedor TEXT,
  razon_social TEXT,
  base_gravada REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  no_gravado REAL NOT NULL DEFAULT 0,
  isc REAL NOT NULL DEFAULT 0,
  otros REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  tipo_cambio REAL,
  credito_fiscal REAL NOT NULL DEFAULT 0, -- IGV que da derecho a crédito
  estado TEXT NOT NULL DEFAULT 'activo',
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id),
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id)
);

CREATE INDEX IF NOT EXISTS idx_reg_compras_cliente_periodo
  ON registro_compras(cliente_id, periodo);
CREATE INDEX IF NOT EXISTS idx_reg_compras_comprobante
  ON registro_compras(comprobante_id);

-- -----------------------------------------------------------------------------
-- Alertas tributarias (CRM de vencimientos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alertas_tributarias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,                   -- 'IGV','PDT','PLAME','DJ_ANUAL',...
  fecha_vencimiento TEXT NOT NULL,
  digito_ruc TEXT,                      -- último dígito RUC (calendario)
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'cumplida', 'vencida', 'omitida')),
  mensaje TEXT,
  periodo TEXT,                         -- YYYYMM o anio
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id)
);

CREATE INDEX IF NOT EXISTS idx_alertas_cliente_estado
  ON alertas_tributarias(cliente_id, estado, fecha_vencimiento);

-- -----------------------------------------------------------------------------
-- DJ anual (stubs Fase 4)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dj_anual (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  utilidad_contable REAL DEFAULT 0,
  renta_neta REAL DEFAULT 0,
  impuesto_calculado REAL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'presentada', 'observada')),
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, anio),
  FOREIGN KEY (cliente_id) REFERENCES clientes_sunat(id)
);

CREATE TABLE IF NOT EXISTS dj_anual_ajustes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dj_anual_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('adicion', 'deduccion')),
  concepto TEXT NOT NULL,
  monto REAL NOT NULL DEFAULT 0,
  cuenta_ref TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dj_anual_id) REFERENCES dj_anual(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dj_ajustes_dj ON dj_anual_ajustes(dj_anual_id);

-- =============================================================================
-- VISTAS
-- =============================================================================

-- Libro mayor: movimientos por cuenta (asientos publicados)
DROP VIEW IF EXISTS v_libro_mayor;
CREATE VIEW v_libro_mayor AS
SELECT
  a.cliente_id,
  a.ejercicio,
  a.mes,
  a.fecha,
  a.id AS asiento_id,
  a.correlativo,
  a.glosa,
  a.origen,
  a.comprobante_id,
  l.cuenta_codigo,
  l.debe,
  l.haber,
  l.centro_costo,
  l.glosa_linea
FROM asientos a
JOIN asiento_lineas l ON l.asiento_id = a.id
WHERE a.estado = 'publicado';

-- Balance de comprobación (esqueleto): sumas debe/haber por cuenta y ejercicio
DROP VIEW IF EXISTS v_balance_comprobacion;
CREATE VIEW v_balance_comprobacion AS
SELECT
  a.cliente_id,
  a.ejercicio,
  l.cuenta_codigo,
  SUM(l.debe) AS suma_debe,
  SUM(l.haber) AS suma_haber,
  SUM(l.debe) - SUM(l.haber) AS saldo_deudor_neto
FROM asientos a
JOIN asiento_lineas l ON l.asiento_id = a.id
WHERE a.estado = 'publicado'
GROUP BY a.cliente_id, a.ejercicio, l.cuenta_codigo;
