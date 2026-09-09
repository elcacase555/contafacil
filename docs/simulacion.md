# Simulación contable desde XML, sin API SIRE

En Contabilidad y CRM, pestaña Descargar y generar Excel, elegir empresa, Desde,
Hasta y carpeta. El botón Elegir carpeta usa el selector existente de Windows;
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

## Archivos editables

Los cinco libros son autónomos: cada uno conserva sus datos y hojas dependientes,
sin enlaces a otros archivos. Abren en la hoja pertinente (registro, Diario,
Mayor o dashboard). **Cambiar uno no actualiza los demás ni la base de ContaFácil.**
Utilice Estados financieros como archivo principal si desea corregir todo junto.

Cada libro contiene Dashboard, Registro ventas, Registro compras, Diario, Mayor,
Balance (comprobación), Balance general, Estado resultados, XML, Ajustes, PCGE
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
- Ajustes ofrece 100 filas para partidas adicionales, incluidos saldos de apertura.
  Ingrese fecha, glosa, cuenta PCGE existente, Debe y Haber, y complete ambos lados.
- Dashboard filtra por fechas dentro del rango descargado. Mayor y estados usan
  ese rango. Los registros conservan todos los documentos y permiten filtros.
  El balance simula movimientos del rango, con apertura solo si fue ingresada.
- El gráfico compara bases netas mensuales en PEN. Incluye registros observados;
  ventas menos compras no equivale a utilidad. El resultado contable procede del
  Diario por clase de cuenta y se muestra por separado.
- Los controles muestran descuadre de partidas, diferencia patrimonial y cuentas
  sin clasificación. No sustituyen revisión de integridad ni de criterio contable.
- Las fórmulas cubren los XML de esta descarga y las 100 filas de ajustes. Para
  ampliar con nuevos comprobantes, generar otro rango; no insertar filas fuera
  de los rangos de fórmula sin adaptarlos.

Los documentos en moneda extranjera y operaciones especiales quedan en registros,
pero se excluyen inicialmente de los asientos automáticos. Los totales de registros
se separan por moneda. Los importes de soles no incluyen una conversión inventada.
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
