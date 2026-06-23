// ============================================================
//  GESTOR DE PROGRESO EN VIVO (Server-Sent Events)
// ============================================================
//
//  Qué hace:
//   Permite que la web reciba actualizaciones en tiempo real
//   mientras un proceso de descarga está corriendo (sin recargar
//   la página y sin librerías externas - usa SSE, una tecnología
//   nativa del navegador y de Express).
//
//   Cada proceso de descarga tiene un "id de trabajo" (jobId).
//   El navegador se conecta a /api/progreso/:jobId y recibe cada
//   mensaje que el motor de SUNAT vaya reportando.
// ============================================================

const conexionesActivas = new Map(); // jobId -> array de objetos "res" (respuestas HTTP abiertas)

function registrarConexion(jobId, res) {
  if (!conexionesActivas.has(jobId)) {
    conexionesActivas.set(jobId, []);
  }
  conexionesActivas.get(jobId).push(res);
}

function quitarConexion(jobId, res) {
  const lista = conexionesActivas.get(jobId);
  if (!lista) return;
  const index = lista.indexOf(res);
  if (index !== -1) lista.splice(index, 1);
}

// Envía un mensaje de progreso a todos los navegadores conectados a ese jobId
function emitirProgreso(jobId, datos) {
  const lista = conexionesActivas.get(jobId);
  if (!lista) return;

  const linea = `data: ${JSON.stringify(datos)}\n\n`;
  for (const res of lista) {
    res.write(linea);
  }
}

// Avisa a los navegadores conectados que el proceso terminó, y limpia la conexión
function cerrarJob(jobId, datosFinal) {
  emitirProgreso(jobId, { ...datosFinal, finalizado: true });
  const lista = conexionesActivas.get(jobId);
  if (lista) {
    for (const res of lista) res.end();
  }
  conexionesActivas.delete(jobId);
}

module.exports = { registrarConexion, quitarConexion, emitirProgreso, cerrarJob };
