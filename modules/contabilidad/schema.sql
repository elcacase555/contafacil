-- SQLite: migration additive. Tenant = contador; empresa = cliente SUNAT.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_tenant ON clientes_sunat(contador_id,id);
CREATE TABLE IF NOT EXISTS ct_periodos (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, periodo TEXT NOT NULL,
 cerrado INTEGER NOT NULL DEFAULT 0 CHECK(cerrado IN (0,1)),
 PRIMARY KEY(contador_id,cliente_id,periodo),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_cuentas (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, codigo TEXT NOT NULL,
 nombre TEXT NOT NULL, clase TEXT NOT NULL CHECK(clase IN ('activo','pasivo','patrimonio','ingreso','gasto','control')),
 rubro TEXT NOT NULL, version TEXT NOT NULL DEFAULT 'PCGE-2019',
 PRIMARY KEY(contador_id,cliente_id,codigo),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_comprobantes (
 id INTEGER PRIMARY KEY, contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
 tipo TEXT NOT NULL, numero TEXT NOT NULL, emisor TEXT NOT NULL, receptor TEXT NOT NULL,
 direccion TEXT NOT NULL CHECK(direccion IN ('venta','compra')), fecha TEXT NOT NULL,
 moneda TEXT NOT NULL, base INTEGER NOT NULL, igv INTEGER NOT NULL, total INTEGER NOT NULL,
 original TEXT, sha256 TEXT NOT NULL, xml TEXT NOT NULL, datos TEXT NOT NULL,
 creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(contador_id,cliente_id,id), UNIQUE(contador_id,cliente_id,emisor,tipo,numero),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_asientos (
 id INTEGER PRIMARY KEY, contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
 comprobante_id INTEGER, periodo TEXT NOT NULL, fecha TEXT NOT NULL, glosa TEXT NOT NULL,
 estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','contabilizado')),
 clase TEXT NOT NULL DEFAULT 'operacion' CHECK(clase IN ('operacion','apertura','cierre')),
 reversion_de INTEGER, clave TEXT NOT NULL, aprobado_en TEXT, regla TEXT,
 UNIQUE(contador_id,cliente_id,id), UNIQUE(contador_id,cliente_id,clave),
 UNIQUE(contador_id,cliente_id,reversion_de),
 CHECK(substr(fecha,1,7)=periodo),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id),
 FOREIGN KEY(contador_id,cliente_id,periodo) REFERENCES ct_periodos(contador_id,cliente_id,periodo),
 FOREIGN KEY(contador_id,cliente_id,comprobante_id) REFERENCES ct_comprobantes(contador_id,cliente_id,id),
 FOREIGN KEY(contador_id,cliente_id,reversion_de) REFERENCES ct_asientos(contador_id,cliente_id,id)
);
CREATE TABLE IF NOT EXISTS ct_apuntes (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, asiento_id INTEGER NOT NULL,
 linea INTEGER NOT NULL, cuenta TEXT NOT NULL, debe INTEGER NOT NULL DEFAULT 0,
 haber INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(contador_id,cliente_id,asiento_id,linea),
 CHECK(typeof(debe)='integer' AND typeof(haber)='integer'),
 CHECK((debe>0 AND haber=0) OR (haber>0 AND debe=0)),
 FOREIGN KEY(contador_id,cliente_id,asiento_id) REFERENCES ct_asientos(contador_id,cliente_id,id),
 FOREIGN KEY(contador_id,cliente_id,cuenta) REFERENCES ct_cuentas(contador_id,cliente_id,codigo)
);
CREATE INDEX IF NOT EXISTS ct_apuntes_cuenta ON ct_apuntes(contador_id,cliente_id,cuenta);
CREATE TABLE IF NOT EXISTS ct_registros (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, comprobante_id INTEGER NOT NULL,
 periodo TEXT NOT NULL, revisado INTEGER NOT NULL DEFAULT 0 CHECK(revisado IN (0,1)),
 credito_fiscal INTEGER NOT NULL DEFAULT 0 CHECK(credito_fiscal IN (0,1)),
 estado_sunat TEXT NOT NULL DEFAULT 'sin_verificar',
 PRIMARY KEY(contador_id,cliente_id,comprobante_id),
 FOREIGN KEY(contador_id,cliente_id,comprobante_id) REFERENCES ct_comprobantes(contador_id,cliente_id,id),
 FOREIGN KEY(contador_id,cliente_id,periodo) REFERENCES ct_periodos(contador_id,cliente_id,periodo)
);
CREATE TABLE IF NOT EXISTS ct_renta (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, ejercicio INTEGER NOT NULL,
 parametros TEXT NOT NULL, resultado TEXT NOT NULL, actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(contador_id,cliente_id,ejercicio),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_tareas (
 id INTEGER PRIMARY KEY, contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
 titulo TEXT NOT NULL, vence TEXT NOT NULL, completada INTEGER NOT NULL DEFAULT 0 CHECK(completada IN (0,1)),
 notas TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_perfil (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
 grupo TEXT NOT NULL DEFAULT 'regular' CHECK(grupo IN ('regular','buen_contribuyente')),
 PRIMARY KEY(contador_id,cliente_id),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_vencimientos (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, periodo TEXT NOT NULL,
 fecha TEXT NOT NULL, fuente TEXT NOT NULL, motivo TEXT NOT NULL,
 PRIMARY KEY(contador_id,cliente_id,periodo),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_auditoria (
 id INTEGER PRIMARY KEY, contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
 evento TEXT NOT NULL, detalle TEXT NOT NULL, fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE VIEW IF NOT EXISTS ct_mayor AS
 SELECT a.contador_id,a.cliente_id,a.id asiento_id,a.fecha,a.periodo,a.glosa,a.clase,
 p.linea,p.cuenta,p.debe,p.haber FROM ct_asientos a JOIN ct_apuntes p
 ON p.contador_id=a.contador_id AND p.cliente_id=a.cliente_id AND p.asiento_id=a.id
 WHERE a.estado='contabilizado';

CREATE TRIGGER IF NOT EXISTS ct_solo_borradores BEFORE INSERT ON ct_asientos
 WHEN NEW.estado<>'borrador' BEGIN SELECT RAISE(ABORT,'Crear primero un borrador'); END;
CREATE TRIGGER IF NOT EXISTS ct_asiento_inmutable BEFORE UPDATE ON ct_asientos
 WHEN OLD.estado='contabilizado' BEGIN SELECT RAISE(ABORT,'Asiento contabilizado inmutable; use reversion'); END;
CREATE TRIGGER IF NOT EXISTS ct_no_borrar_asiento BEFORE DELETE ON ct_asientos
 WHEN OLD.estado='contabilizado' BEGIN SELECT RAISE(ABORT,'Asiento contabilizado inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_validar_partida BEFORE UPDATE OF estado ON ct_asientos
 WHEN NEW.estado='contabilizado' BEGIN
 SELECT CASE WHEN NEW.aprobado_en IS NULL THEN RAISE(ABORT,'Falta aprobacion') END;
 SELECT CASE WHEN (SELECT cerrado FROM ct_periodos WHERE contador_id=NEW.contador_id AND cliente_id=NEW.cliente_id AND periodo=NEW.periodo)<>0 THEN RAISE(ABORT,'Periodo cerrado') END;
 SELECT CASE WHEN (SELECT count(*) FROM ct_apuntes WHERE contador_id=NEW.contador_id AND cliente_id=NEW.cliente_id AND asiento_id=NEW.id)<2 THEN RAISE(ABORT,'Se requieren dos apuntes') END;
 SELECT CASE WHEN (SELECT sum(debe-haber) FROM ct_apuntes WHERE contador_id=NEW.contador_id AND cliente_id=NEW.cliente_id AND asiento_id=NEW.id)<>0 THEN RAISE(ABORT,'Asiento descuadrado') END;
 END;
CREATE TRIGGER IF NOT EXISTS ct_apunte_insert BEFORE INSERT ON ct_apuntes
 WHEN EXISTS(SELECT 1 FROM ct_asientos WHERE id=NEW.asiento_id AND estado='contabilizado')
 BEGIN SELECT RAISE(ABORT,'Asiento contabilizado inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_apunte_update BEFORE UPDATE ON ct_apuntes
 WHEN EXISTS(SELECT 1 FROM ct_asientos WHERE id IN (OLD.asiento_id,NEW.asiento_id) AND estado='contabilizado')
 BEGIN SELECT RAISE(ABORT,'Asiento contabilizado inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_apunte_delete BEFORE DELETE ON ct_apuntes
 WHEN EXISTS(SELECT 1 FROM ct_asientos WHERE id=OLD.asiento_id AND estado='contabilizado')
 BEGIN SELECT RAISE(ABORT,'Asiento contabilizado inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_xml_update BEFORE UPDATE ON ct_comprobantes
 BEGIN SELECT RAISE(ABORT,'Comprobante original inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_xml_delete BEFORE DELETE ON ct_comprobantes
 BEGIN SELECT RAISE(ABORT,'Comprobante original inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_auditoria_update BEFORE UPDATE ON ct_auditoria
 BEGIN SELECT RAISE(ABORT,'Auditoria inmutable'); END;
CREATE TRIGGER IF NOT EXISTS ct_auditoria_delete BEFORE DELETE ON ct_auditoria
 BEGIN SELECT RAISE(ABORT,'Auditoria inmutable'); END;

CREATE TABLE IF NOT EXISTS ct_automatizacion_config (
 contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, reglas TEXT NOT NULL,
 api_cifrada TEXT, PRIMARY KEY(contador_id,cliente_id),
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE TABLE IF NOT EXISTS ct_trabajos (
 id TEXT PRIMARY KEY, contador_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
 desde TEXT NOT NULL, hasta TEXT NOT NULL, estado TEXT NOT NULL,
 progreso TEXT NOT NULL DEFAULT '', resultado TEXT, creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(contador_id,cliente_id) REFERENCES clientes_sunat(contador_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ct_un_trabajo_activo ON ct_trabajos(contador_id,cliente_id)
 WHERE estado='procesando';
