# Automatización por fechas y conciliación SIRE

## Uso

1. Actualizar la rama `feature/contabilidad-crm`, instalar dependencias con `npm ci`
   y reiniciar con `npm start`. Respaldar la base con el servidor detenido antes
   de actualizar y conservar `.env`, especialmente la clave de cifrado existente.
2. Abrir **Contabilidad y CRM → Descargar y generar Excel**, elegir empresa.
3. En configuración, guardar cuentas de ingresos y naturaleza de compras. Es una
   regla para operaciones homogéneas, no un clasificador universal de gastos,
   mercaderías y activos. Confirmar el tratamiento de crédito fiscal. Es opcional
   aprobar automáticamente nuevas facturas simples que coincidan con SIRE.
4. Para SIRE, registrar Client ID y Client Secret obtenidos en SOL, Credenciales de
   API SUNAT, con acceso SIRE. Se cifran mediante el mecanismo existente, por empresa;
   las consultas de configuración no devuelven secretos. Se utiliza RUC + usuario
   SOL y clave SOL del cliente para autenticarse. No ingresar claves en GitHub.
5. Seleccionar fechas inclusivas desde/hasta (máximo 36 meses) y pulsar el botón.
   El servidor ejecuta FE, NC y ND, emitidas y recibidas, usando el motor original.
   Consultar progreso y descargar Excel. El historial persiste al recargar.

## Qué se obtiene

Un XLSX con 16 hojas: Leer primero, Ventas XML, Compras XML, RVIE SIRE, RCE SIRE,
Conciliacion, Diario contabilizado, Asientos propuestos, Libro Mayor, Balance
comprobacion, Situacion financiera, Estado de resultados, Proyeccion con borradores,
Situacion proyectada, Resultados proyectados y Observaciones.

XML, Diario y movimientos del Mayor se seleccionan por fecha del rango. Los saldos
del Mayor y situación financiera acumulan hasta la fecha final; resultados abarcan
el ejercicio de esa fecha. Las proyecciones añaden los borradores equilibrados del
rango a lo contabilizado, sin modificarlo. Los importes se almacenan como centavos
y se exportan como números en soles. Las hojas de XML/SIRE conservan moneda por fila.

SIRE se consulta por meses completos del rango. Sus hojas conservan los meses
completos, incluyendo campos originales; la conciliación filtra fecha de emisión.
Esto no es conciliación de todos los periodos fiscales: un comprobante puede ser
anotado en un periodo distinto. Se comparan emisor, tipo, serie/número, receptor,
fecha, moneda, base, IGV y total, con signo negativo en notas de crédito. Duplicados
entre periodos quedan observados. No se inventan XML ni asientos para filas solo SIRE.

Las propuestas se generan con reglas guardadas. Solo se contabilizan automáticamente
nuevas facturas tipo 01 simples en PEN que superen las validaciones y coincidan
con SIRE, si el contador activó esa opción. Una coincidencia no prueba aceptación
CDR ni derecho al crédito fiscal; este último depende de la regla del contador.
Las notas y borradores existentes requieren revisión. Periodos cerrados, monedas,
tributos o ajustes no soportados generan observaciones visibles. Reejecutar un
rango no duplica comprobantes/asientos ni aprueba borradores anteriores.

El balance y resultado requieren además apertura, costo de ventas, inventarios,
bancos, nóminas, activos y ajustes para constituir estados completos. La DJ anual
existente sigue siendo un borrador con parámetros tributarios revisados; este flujo
no la declara ni calcula automáticamente ajustes que no provengan de los XML.

## Implementación y operación

- `workflow.js`: coordinación en segundo plano, dos trabajos simultáneos por proceso,
  máximo uno por empresa, aislamiento de trabajos y descargas, historial en SQLite.
- `sire-client.js`: OAuth con credenciales API + SOL, exportación de propuestas,
  consulta de ticket y descarga ZIP limitada; sin aceptar/reemplazar/presentar libros.
- `conciliation.js`: lectura TXT RVIE/RCE del perfil de anexos y comparación exacta.
- `workbook.js`: ExcelJS, montos numéricos, fuente original y estados separados.
- `ct_automatizacion_config` y `ct_trabajos`: migración aditiva en `schema.sql`.
- Archivos privados bajo `data/automatizacion/<contador>/<cliente>/<trabajo>/`,
  excluidos de Git y servidos solo por una ruta autenticada y autorizada.

Rutas bajo `/api/contabilidad/clientes/:id/automatizacion`:

| Método | Sufijo | Uso |
|---|---|---|
| GET / PUT | `/config` | Leer estado / guardar reglas y credenciales |
| POST | vacío | Iniciar con `{desde,hasta,usarSire}` |
| GET | vacío | Últimos 30 trabajos |
| GET | `/:job` | Estado y resultado |
| GET | `/:job/excel` | Archivo XLSX terminado |

Las mutaciones requieren sesión activa y token CSRF. Un reinicio marca los trabajos
en curso como interrumpidos; se pueden volver a ejecutar. No hay cola distribuida
ni reanudación automática. Conservar espacio para XML, fuentes y Excel; no hay aún
política de purga. Fallos de SUNAT, formatos inesperados o tickets que exceden la
espera generan observaciones; nunca se interpretan como ausencia de operaciones.

## Verificación y fuentes

`npm test` cubre fechas parciales/bisiestas, aislación HTTP, importación idempotente,
duplicados, diferencias, aprobación de coincidencias, borradores sin SIRE, importes
Excel y autenticación/ticket/ZIP con respuestas simuladas. `npm run test:browser`
comprueba configuración, botón, descarga Excel, historial y cambio de empresa.
Estas pruebas no usan credenciales SUNAT reales ni certifican la integración viva.
La prueba de aceptación debe hacerse con un rango pequeño y documentos conocidos.

Se implementaron los contratos publicados en:

- [Manual API SIRE Ventas v29, SUNAT](https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Ventas%20v29.pdf).
- [Manual API SIRE Compras v26, SUNAT](https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v26.pdf).

La propuesta oficial descargada no equivale a un registro ya generado o presentado.
No incluye consulta de constancias, CDR/firma ni declaración anual electrónica.
