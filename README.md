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

Abre **Contabilidad y CRM** desde el inicio o desde un cliente. Incluye importación
UBL 2.1, propuestas de asientos, aprobación/reversión, Diario, Mayor, registros de
ventas/compras, balance de comprobación, situación financiera y resultados,
borradores RG/RMT, tareas y vencimientos mensuales 2026.

- [Modelo entidad-relación, arquitectura, ejemplos y límites](docs/contabilidad.md)
- [DDL SQLite aplicado automáticamente al inicio](modules/contabilidad/schema.sql)
- [Parser XML](modules/contabilidad/parser.js)

Los registros SIRE se exportan como archivos preliminares de un perfil base
delimitado, pendientes de conciliación y validación oficial. La DJ es un papel de
trabajo: no se presentan declaraciones ni se envía información a SUNAT.

```sh
npm test
npm run test:browser
```

La segunda prueba requiere Microsoft Edge y utiliza datos sintéticos en una base
desechable. El diseño mantiene la instalación local; consultar los requisitos
pendientes de un despliegue SaaS distribuido en la documentación.
