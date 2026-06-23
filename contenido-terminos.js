// ============================================================
//  CONTENIDO DE TÉRMINOS Y CONDICIONES
// ============================================================
//
//  IMPORTANTE: Este texto es un BORRADOR funcional, generado para
//  poder construir la pantalla de aceptación. NO ha sido revisado
//  por un abogado. Antes de cobrarle a un contador real por el
//  servicio, se recomienda que un abogado especializado en derecho
//  digital/protección de datos (Perú) revise y ajuste este contenido.
//
//  VERSION_TERMINOS: cuando cambies el contenido de fondo, sube este
//  número. Eso permite, en el futuro, volver a pedir aceptación a
//  todos los contadores si los términos cambian de forma importante
//  (hoy el sistema solo pide aceptación una vez, pero el campo
//  terminos_version ya queda guardado en cada contador para eso).
// ============================================================

const VERSION_TERMINOS = '1.0';

const TITULO = 'Términos y Condiciones, Política de Privacidad y Uso de IA — ContaFácil';

const CONTENIDO_HTML = `
<h3>1. Aceptación de los términos</h3>
<p>Al usar ContaFácil ("el Servicio", "la Plataforma"), usted ("el Usuario", "el Contador") acepta íntegramente estos Términos y Condiciones, la Política de Privacidad y el Anexo de Uso de Inteligencia Artificial descritos a continuación. Si no está de acuerdo, no debe usar el Servicio.</p>

<h3>2. Descripción del Servicio</h3>
<p>ContaFácil es una herramienta de automatización que permite acceder al portal SUNAT Operaciones en Línea (SOL) usando las credenciales que el Usuario ingresa para cada cliente, descargar comprobantes de pago electrónicos (facturas, notas de crédito, notas de débito) en formatos PDF, XML y Excel, y generar reportes consolidados.</p>
<p>El Servicio <strong>no constituye asesoría contable, tributaria o legal</strong>, no reemplaza ningún sistema oficial de SUNAT, y no garantiza el cumplimiento de obligaciones tributarias del Usuario o de sus clientes.</p>

<h3>3. Naturaleza de la relación con SUNAT</h3>
<p>ContaFácil no tiene afiliación, autorización ni relación oficial con SUNAT. El Usuario declara y garantiza que cuenta con autorización expresa de cada cliente cuyas credenciales (RUC, usuario SOL, Clave SOL) ingresa en la Plataforma, y que es el único responsable frente a sus clientes y frente a SUNAT por el uso que haga de la información obtenida.</p>
<p>El Operador no es responsable si SUNAT modifica, suspende, bloquea o restringe el acceso al portal SOL, ni de las consecuencias que ello tenga sobre la disponibilidad del Servicio.</p>

<h3>4. Responsabilidad del Usuario sobre la información</h3>
<p>El Usuario es responsable de verificar la exactitud de los datos descargados antes de utilizarlos para fines de declaración tributaria, contable o de cualquier otra índole. ContaFácil entrega información de respaldo y organización; no certifica su exactitud frente a SUNAT.</p>

<h3>5. Limitación de responsabilidad</h3>
<p>El Servicio se presta "tal como está", sin garantías de disponibilidad ininterrumpida, exactitud absoluta o ausencia de errores. El Operador no será responsable por errores originados en el propio portal de SUNAT, cambios en dicho portal que afecten el funcionamiento de la automatización, decisiones contables o tributarias tomadas con base en los reportes generados, ni por pérdidas económicas, multas o sanciones derivadas del uso del Servicio.</p>
<p>En la máxima medida permitida por la ley peruana, la responsabilidad total del Operador frente al Usuario no excederá el monto efectivamente pagado por el Usuario en los últimos tres (3) meses de suscripción.</p>

<h3>6. Resolución de controversias - Arbitraje</h3>
<p>Cualquier controversia, discrepancia o reclamo derivado de estos Términos, su interpretación, cumplimiento o terminación, se resolverá mediante arbitraje, conforme a la Ley de Arbitraje peruana (Decreto Legislativo N.º 1071), renunciando las partes a recurrir a la vía judicial ordinaria, salvo en los casos en que la ley no permita esta renuncia.</p>

<h3>7. Manejo de información y base de datos</h3>
<p>Para prestar el Servicio, el Operador mantiene una base de datos que incluye: datos de la cuenta del Usuario; razón social y RUC de los clientes que el Usuario registra; usuario y Clave SOL de dichos clientes (almacenados de forma cifrada); y los comprobantes electrónicos descargados (montos, fechas, razón social de contrapartes, RUC, conceptos, IGV, etc.).</p>
<p>El acceso a esta información está separado por cuenta: ningún Usuario puede ver los datos, clientes o archivos de otro Usuario. El Operador no vende, alquila ni comparte esta información con terceros ajenos al Servicio, salvo obligación legal.</p>
<p>El Usuario (contador) actúa como responsable del tratamiento de los datos de sus propios clientes frente a ellos, y declara contar con el consentimiento o base legal correspondiente para el tratamiento de dichos datos (incluida la Clave SOL) a través de ContaFácil. ContaFácil actúa, respecto de esos datos, como encargado de tratamiento.</p>

<h3>8. Uso de Inteligencia Artificial</h3>
<p>El Servicio puede incluir un módulo de soporte basado en inteligencia artificial para responder preguntas frecuentes sobre el uso de la Plataforma. Este módulo de IA <strong>no brinda asesoría contable, tributaria ni legal</strong>, no tiene acceso a las Claves SOL de los clientes del Usuario, y no toma decisiones automáticas que afecten cuentas, pagos o accesos sin posibilidad de revisión humana.</p>
<p>El Usuario no debe ingresar credenciales ni Claves SOL en ningún chat de soporte, bajo ninguna circunstancia. Las respuestas generadas por IA pueden contener imprecisiones; el Operador no garantiza su exactitud absoluta.</p>

<h3>9. Conservación y eliminación de datos</h3>
<p>Mientras la cuenta esté activa, los datos del Usuario y de sus clientes se conservan para permitir el funcionamiento del Servicio. Si el Usuario cancela su cuenta, sus datos y los de sus clientes se eliminan conforme a los plazos que el Operador determine, salvo obligación legal de conservarlos por más tiempo.</p>

<h3>10. Uso bajo su propio riesgo</h3>
<p>El Usuario reconoce que utiliza el Servicio bajo su propio riesgo y criterio profesional, y que es el responsable final de las consecuencias del uso de la información obtenida a través de la Plataforma.</p>

<h3>11. Modificaciones</h3>
<p>El Operador puede modificar estos Términos en cualquier momento. Los cambios relevantes se notificarán dentro de la Plataforma.</p>

<h3>12. Ley aplicable</h3>
<p>Estos Términos se rigen por las leyes de la República del Perú.</p>
`;

module.exports = { VERSION_TERMINOS, TITULO, CONTENIDO_HTML };
