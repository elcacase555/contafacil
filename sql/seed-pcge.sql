-- =============================================================================
-- Semilla mínima PCGE (plantilla global: cliente_id IS NULL)
-- Suficiente para asientos automáticos comunes (caja, CXC, CXP, IGV, ventas, compras)
-- INSERT OR IGNORE / NOT EXISTS para ser idempotente
-- =============================================================================

INSERT INTO plan_cuentas (cliente_id, codigo, nombre, tipo, nivel, padre_codigo, acepta_movimiento)
SELECT NULL, v.codigo, v.nombre, v.tipo, v.nivel, v.padre_codigo, v.acepta_movimiento
FROM (
  SELECT '10' AS codigo, 'Efectivo y equivalentes de efectivo' AS nombre, 'activo' AS tipo, 1 AS nivel, NULL AS padre_codigo, 0 AS acepta_movimiento
  UNION ALL SELECT '101', 'Caja', 'activo', 2, '10', 0
  UNION ALL SELECT '1011', 'Caja MN', 'activo', 3, '101', 1
  UNION ALL SELECT '104', 'Cuentas corrientes en instituciones financieras', 'activo', 2, '10', 0
  UNION ALL SELECT '1041', 'Cuentas corrientes operativas', 'activo', 3, '104', 1
  UNION ALL SELECT '12', 'Cuentas por cobrar comerciales – Terceros', 'activo', 1, NULL, 0
  UNION ALL SELECT '121', 'Facturas, boletas y otros comprobantes por cobrar', 'activo', 2, '12', 0
  UNION ALL SELECT '1212', 'Emitidas en cartera', 'activo', 3, '121', 1
  UNION ALL SELECT '20', 'Mercaderías', 'activo', 1, NULL, 0
  UNION ALL SELECT '201', 'Mercaderías manufacturadas', 'activo', 2, '20', 0
  UNION ALL SELECT '2011', 'Mercaderías manufacturadas', 'activo', 3, '201', 1
  UNION ALL SELECT '40', 'Tributos, contraprestaciones y aportes al sistema de pensiones y de salud por pagar', 'pasivo', 1, NULL, 0
  UNION ALL SELECT '401', 'Gobierno central', 'pasivo', 2, '40', 0
  UNION ALL SELECT '4011', 'IGV', 'pasivo', 3, '401', 0
  UNION ALL SELECT '40111', 'IGV – Cuenta propia', 'pasivo', 4, '4011', 1
  UNION ALL SELECT '42', 'Cuentas por pagar comerciales – Terceros', 'pasivo', 1, NULL, 0
  UNION ALL SELECT '421', 'Facturas, boletas y otros comprobantes por pagar', 'pasivo', 2, '42', 0
  UNION ALL SELECT '4212', 'Emitidas', 'pasivo', 3, '421', 1
  UNION ALL SELECT '50', 'Capital', 'patrimonio', 1, NULL, 0
  UNION ALL SELECT '501', 'Capital social', 'patrimonio', 2, '50', 1
  UNION ALL SELECT '60', 'Compras', 'gasto', 1, NULL, 0
  UNION ALL SELECT '601', 'Mercaderías', 'gasto', 2, '60', 0
  UNION ALL SELECT '6011', 'Mercaderías', 'gasto', 3, '601', 1
  UNION ALL SELECT '61', 'Variación de existencias', 'gasto', 1, NULL, 0
  UNION ALL SELECT '611', 'Mercaderías', 'gasto', 2, '61', 1
  UNION ALL SELECT '63', 'Gastos de servicios prestados por terceros', 'gasto', 1, NULL, 0
  UNION ALL SELECT '631', 'Transporte, correos y gastos de viaje', 'gasto', 2, '63', 0
  UNION ALL SELECT '6311', 'Transporte', 'gasto', 3, '631', 1
  UNION ALL SELECT '634', 'Mantenimiento y reparaciones', 'gasto', 2, '63', 1
  UNION ALL SELECT '636', 'Servicios básicos', 'gasto', 2, '63', 0
  UNION ALL SELECT '6361', 'Energía eléctrica', 'gasto', 3, '636', 1
  UNION ALL SELECT '6363', 'Agua', 'gasto', 3, '636', 1
  UNION ALL SELECT '6364', 'Teléfono', 'gasto', 3, '636', 1
  UNION ALL SELECT '69', 'Costo de ventas', 'gasto', 1, NULL, 0
  UNION ALL SELECT '691', 'Mercaderías', 'gasto', 2, '69', 1
  UNION ALL SELECT '70', 'Ventas', 'ingreso', 1, NULL, 0
  UNION ALL SELECT '701', 'Ventas de mercaderías', 'ingreso', 2, '70', 0
  UNION ALL SELECT '7011', 'Mercaderías manufacturadas', 'ingreso', 3, '701', 1
  UNION ALL SELECT '702', 'Ventas de productos terminados', 'ingreso', 2, '70', 1
  UNION ALL SELECT '703', 'Ventas de servicios', 'ingreso', 2, '70', 1
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM plan_cuentas p
  WHERE p.cliente_id IS NULL AND p.codigo = v.codigo
);
