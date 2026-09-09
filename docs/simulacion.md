# Simulación contable desde XML, sin API SIRE

En **Crear TODO**, elegir empresa, Desde, Hasta y carpeta, y pulsar **Iniciar**.
Al entrar desde un cliente, su empresa queda seleccionada. La revisión manual,
cuentas y periodos están en **Herramientas de revisión**, un apartado secundario
que no hace falta abrir para generar los archivos.
El botón Elegir carpeta usa el selector existente de Windows;
también admite escribir una ruta absoluta existente. La ruta pertenece al equipo
que ejecuta ContaFácil. Las credenciales SOL del cliente siguen siendo necesarias
para descargar del portal. No requiere credenciales de API SIRE.

## Estructura de salida

Cada ejecución crea una carpeta nueva con empresa, RUC, fechas y un identificador
corto. Repetir el rango no sobreescribe correcciones hechas en archivos anteriores.

```text
Empresa RUC desde a hasta identificador/
  Comprobantes de pago/
    Facturas/
      Emitidas/{XML,PDF,Excel}/
      Recibidas/{XML,PDF,Excel}/
    Notas de credito/
      Emitidas/{XML,PDF,Excel}/
      Recibidas/{XML,PDF,Excel}/
    Notas de debito/
      Emitidas/{XML,PDF,Excel}/
      Recibidas/{XML,PDF,Excel}/
  Registros/
    Ventas/Registro ventas.xlsx
    Compras/Registro compras.xlsx
  Libro Diario/Libro Diario.xlsx
  Libro Mayor/Libro Mayor.xlsx
  Estados financieros/Estados financieros.xlsx
  LEER PRIMERO.txt
```

El motor reutiliza una sesión SOL para buscar FE/NC/ND, emitidas/recibidas, por
meses con los extremos de fecha exactos. Descarga XML y PDF. Los Excel por
comprobante y los informes se calculan únicamente desde los XML del trabajo.
Si falla un formato o hay archivos inválidos, se informa; no se fabrica un PDF
faltante ni se interpreta una descarga vacía como ausencia de operaciones.

La lectura reconoce UTF-8, ISO-8859-1 (Latin-1), Windows-1252, ASCII y UTF-16
según la declaración y marca de bytes del XML. No modifica los archivos originales
ni reemplaza caracteres inválidos. Si no hay declaración, usa UTF-8 según XML;
una codificación desconocida o contradictoria se informa para revisión.

## Archivos editables

Los cinco libros son autónomos: cada uno conserva sus datos y hojas dependientes,
sin enlaces a otros archivos. Abren en la hoja pertinente (registro, Diario,
Mayor o dashboard). **Cambiar uno no actualiza los demás ni la base de ContaFácil.**
Utilice Estados financieros como archivo principal si desea corregir todo junto.

Cada libro contiene Dashboard, Registro ventas, Registro compras, Diario, Mayor,
Balance (comprobación), Balance general, Estado resultados, XML, PCGE
e Instrucciones. Las fórmulas referencian hojas internas y el gráfico nativo se
enlaza al resumen mensual. Excel recalcula al abrir.

- XML conserva emisor/receptor, fecha, tipo, número, moneda, base/IGV/total y ruta
  del original. Las correcciones de base, IGV y total son columnas separadas.
  Vacío conserva el XML y **cero es una corrección válida**.
- Incluir 1/0 permite excluir un documento de los asientos sin borrarlo del registro.
  Cuenta de naturaleza y crédito IGV 1/0 se pueden corregir por documento.
- Si no se guardaron reglas, se propone 70111 para ventas y 6011 para compras,
  sin crédito fiscal. Son supuestos de simulación, no clasificación definitiva.
- Las notas de crédito invierten los importes; las de débito los incrementan.
  La propuesta puede requerir cambiar cuentas o ajustar el motivo de la nota.
- Diario y Mayor contienen movimientos derivados de los comprobantes. Se retiraron
  las cien filas vacías de «Ajuste manual» y su hoja de captura.
- Dashboard filtra por fechas dentro del rango descargado. Mayor y estados usan
  ese rango. Los registros conservan todos los documentos y permiten filtros.
  El balance simula movimientos del rango, sin saldos de apertura.
- El gráfico compara bases netas mensuales en PEN. Incluye registros observados;
  ventas menos compras no equivale a utilidad. El resultado contable procede del
  Diario por clase de cuenta y se muestra por separado.
- Los controles muestran descuadre de partidas, diferencia patrimonial y cuentas
  sin clasificación. No sustituyen revisión de integridad ni de criterio contable.
- Las fórmulas cubren los XML de esta descarga. Para
  ampliar con nuevos comprobantes, generar otro rango; no insertar filas fuera
  de los rangos de fórmula sin adaptarlos.

Los importes monetarios utilizan formato contable de Excel: símbolo, separación de
miles, dos decimales, negativos entre paréntesis y cero como guion. Fechas, tasas y
contadores conservan sus propios formatos. Los originales USD siguen identificados
en sus columnas de origen; registros, diario, mayor y estados calculan soles.

## Conversión automática USD/PEN

Se consulta la serie **PD04640PD, TC Sistema bancario SBS — Venta**, mediante el
[API oficial del BCRP](https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/api).
No requiere API key ni acceso a SIRE. Una consulta cubre las fechas necesarias del
trabajo. El proveedor se valida por serie, fechas y tasas positivas; se preservan
fecha de cotización, fecha base de conversión, tasa y URL en XML (AA:AE).

El modo de simulación toma la fecha de emisión como fecha de la operación. Para
notas de crédito y débito toma la fecha de la factura referenciada, obtenida del
XML original disponible o de IssueDate de BillingReference. Comprueba emisor,
receptor, moneda y consistencia de fechas cuando el original está disponible.
Las notas sin referencia verificable no reciben una tasa supuesta. Si no existe
cotización del día, se utiliza la última anterior con un límite de siete días
para evitar series desactualizadas. Fechas futuras y consultas fallidas quedan
pendientes y se señala que los reportes están incompletos; no se suman dólares
como si fueran soles ni se muestra un cero como conversión de un importe faltante.

Cada importe se convierte con aritmética entera y redondeo a céntimos; los Excel
contienen ROUND(importe_original \* tipo_cambio, 2). La diferencia entre total
convertido y base más IGV se muestra aparte y genera una partida explícita en
6599/7599 (subcuentas propuestas de redondeo), conservando el signo de las notas.
No se modifica el XML ni se altera el IGV para forzar un cuadre.

El tipo venta para IGV y uso del último publicado se sustentan en el
[Informe SUNAT 200-2009](https://www.sunat.gob.pe/legislacion/oficios/2009/oficios/i200-2009.htm).
La fecha original en notas de crédito está descrita en el
[Oficio SUNAT 024-2000](https://www.sunat.gob.pe/legislacion/oficios/2000/oficios/o0242000.htm).
La serie utiliza fecha de cotización SBS; no se confunde con la fecha de publicación
del día siguiente que muestra el portal de consulta SUNAT. La fecha de obligación
tributaria/devengo puede diferir de la emisión y requiere revisión del contador.
Este modo no revalúa saldos impagos al cierre, no calcula diferencias de cambio de
cobros/pagos ni reemplaza el tratamiento de renta. No dispone de esos movimientos
únicamente a partir de XML.

Otras monedas y documentos con inconsistencias permanecen visibles en registros,
con el motivo concreto de la exclusión. Las correcciones siguen siendo opcionales.
Las claves fiscales duplicadas se deduplican; XML distintos con la misma clave
quedan observados y la propuesta se excluye hasta revisión.

Al terminar, la app y LEER PRIMERO muestran: **SIMULACIÓN CONTABLE. Revise y corrija
la información antes de utilizarla. Preparada para agilizar el trabajo del contador;
no es un registro SUNAT validado.** No se presentan libros ni DJ anual. Complete
apertura, inventarios, costo de ventas, bancos, nómina, depreciaciones y ajustes
para obtener estados completos. Este modo no publica asientos en la base contable.

## Implementación y pruebas

POST `/api/contabilidad/clientes/:id/automatizacion` con
`{modo:"simulacion",desde,hasta,carpetaDestino}`. Mantiene autenticación, CSRF,
historial y aislamiento de empresas. GET `/:job/excel` entrega una copia privada
del archivo principal; las demás salidas están en la carpeta elegida.

`simulation.js` coordina la descarga/lectura del trabajo y las salidas.
`simulation-excel.js` genera fórmulas portátiles mediante ExcelJS. El gráfico nativo
procede de `templates/dashboard.xlsx`, creado con Artifact Tool; se conservan sus
referencias a Dashboard al incorporarlo al paquete XLSX. No se requieren herramientas
de Codex ni nuevas dependencias en la instalación del usuario.

Pruebas con fixtures sintéticos: fechas, XML/NC, estructura de carpetas, duplicación
de ejecuciones sin sobrescritura, fórmulas/cachés, gráfico, ausencia de contabilización
y recorrido en navegador. Se verificó además recálculo con Artifact Tool al editar
importes, corregir a cero y filtrar fechas. La descarga real depende del portal SOL
y debe comprobarse con un rango pequeño; no se usaron credenciales reales en pruebas.

La integración SBS/BCRP se comprobó con una consulta pública real de agosto de
2025, incluido fin de semana y día sin cotización. Las pruebas de regresión cubren
USD emitidos/recibidos, notas, tasa original, fallo de red, redondeo, conservación
de importes fuente, formato contable y ausencia de filas ficticias. Se verificó
recálculo de fórmulas al cambiar tasa, dejarla vacía y corregir importes a cero.
