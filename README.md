# ContaFácil

Aplicación local multiusuario para descargar comprobantes SUNAT y preparar la
contabilidad de clientes con Node.js, Express y SQLite.

## Inicio

```sh
npm ci
npm start
```

Usa la configuración `.env` existente para sesión y cifrado de credenciales SOL.
No cambies la clave de cifrado de una instalación con clientes guardados. Antes
de actualizar una instalación con datos, realiza una copia consistente de la base.

## Contabilidad y CRM

### Descargar y generar Excel

**Modo actual sin API SIRE:** selecciona fechas y carpeta de destino. Se crean
subcarpetas por empresa/rango y por tipo/dirección/formato de comprobante, además de
registros de ventas/compras, Diario, Mayor y estados financieros en Excel con
fórmulas y dashboard editable. Todo se presenta como simulación para revisión.
No necesita configuración de API ni contabiliza en la aplicación.
Consulta [estructura y uso de la simulación](docs/simulacion.md).

### Integración SIRE anterior (API opcional)

El adaptador SIRE de la versión anterior permanece en el backend para futuras
consultas, pero el botón actual ejecuta la simulación sin SIRE. La API anterior
requiere cuentas configuradas y Client ID/Client Secret, además de SOL.

El motor existente descarga FE, NC y ND emitidas/recibidas, importa XML sin duplicar,
consulta propuestas RVIE/RCE por ticket, compara los documentos y prepara un XLSX
con registros, Diario, Mayor, balance, situación financiera, resultados, proyecciones
y observaciones. Las hojas SIRE incluyen todos los campos de las fuentes recibidas.

La aprobación automática es opcional: solo nuevas facturas simples conciliadas,
según las cuentas guardadas. Las notas, diferencias y borradores anteriores siguen
pendientes; sus propuestas equilibradas se reflejan en hojas de proyección.
Consulta [uso, alcance y endpoints](docs/automatizacion.md).

Abre **Contabilidad y CRM** desde el inicio o desde un cliente. Incluye importación
UBL 2.1, propuestas de asientos, aprobación/reversión, Diario, Mayor, registros de
ventas/compras, balance de comprobación, situación financiera y resultados,
borradores RG/RMT, tareas y vencimientos mensuales 2026.

- [Modelo entidad-relación, arquitectura, ejemplos y límites](docs/contabilidad.md)
- [DDL SQLite aplicado automáticamente al inicio](modules/contabilidad/schema.sql)
- [Parser XML](modules/contabilidad/parser.js)

El exportador TXT propio sigue siendo preliminar. La nueva descarga de propuestas
SIRE sirve para conciliación; una propuesta no equivale a un registro presentado.
La DJ es un papel de trabajo: no se presentan declaraciones.

```sh
npm test
npm run test:browser
```

La segunda prueba requiere Microsoft Edge y utiliza datos sintéticos en una base
desechable. El diseño mantiene la instalación local; consultar los requisitos
pendientes de un despliegue SaaS distribuido en la documentación.
