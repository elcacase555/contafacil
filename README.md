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

En **Contabilidad y CRM → Descargar y generar Excel**, selecciona empresa y
fechas desde/hasta. Guarda una vez las cuentas de ventas/compras y, para consultar
SIRE, el Client ID y Client Secret de API SUNAT de esa empresa. Se utilizan además
las credenciales SOL ya guardadas. Después basta pulsar **Descargar XML y generar
Excel**; el proceso sigue en el servidor aunque cierres la pestaña.

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
