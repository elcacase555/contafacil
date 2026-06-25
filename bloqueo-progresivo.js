// ============================================================
//  BLOQUEO PROGRESIVO POR INTENTOS FALLIDOS
// ============================================================
//
//  Qué hace:
//   Cuenta los intentos fallidos de login de un contador. Cada
//   vez que llega a 5 fallos, lo bloquea por un tiempo que va
//   escalando:
//
//   5 fallos -> bloqueado 10 minutos
//   5 fallos más (tras desbloquear) -> bloqueado 30 minutos
//   5 fallos más -> bloqueado 1 hora
//   5 fallos más -> bloqueado 2 horas (sigue duplicando)
//
//   Un login EXITOSO reinicia el contador a cero.
// ============================================================

const FALLOS_PARA_BLOQUEAR = 5;
const MINUTOS_POR_NIVEL = [10, 30, 60]; // a partir del nivel 4, se duplica el último (60 -> 120 -> 240...)

function minutosParaNivel(nivel) {
  if (nivel <= 0) return 0;
  if (nivel <= MINUTOS_POR_NIVEL.length) return MINUTOS_POR_NIVEL[nivel - 1];
  // Niveles más allá del array definido: duplica el último valor conocido
  const extra = nivel - MINUTOS_POR_NIVEL.length;
  return MINUTOS_POR_NIVEL[MINUTOS_POR_NIVEL.length - 1] * Math.pow(2, extra);
}

// Revisa si la fila (contador o admin) está bloqueada en este momento.
// Devuelve { bloqueado: boolean, minutosRestantes: number }
function verificarBloqueo(fila) {
  if (!fila.bloqueado_hasta) {
    return { bloqueado: false, minutosRestantes: 0 };
  }

  // Postgres devuelve bloqueado_hasta como un objeto Date real (a diferencia
  // de SQLite, que lo devolvía como texto). new Date() acepta ambos casos
  // sin problema, así que esto funciona igual venga de uno u otro motor.
  const hasta = new Date(fila.bloqueado_hasta);
  const ahora = new Date();

  if (ahora < hasta) {
    const minutosRestantes = Math.ceil((hasta - ahora) / 60000);
    return { bloqueado: true, minutosRestantes };
  }

  return { bloqueado: false, minutosRestantes: 0 };
}

// Registra un fallo. Si llega al umbral, activa el bloqueo del nivel
// correspondiente y sube el nivel para la próxima vez.
// `actualizar` es una función ASYNC que recibe (cambios) y los guarda en
// la DB (para no atar este módulo a una tabla específica - lo usan tanto
// contadores como el admin).
async function registrarFallo(filaActual, actualizar) {
  const nuevosIntentos = (filaActual.intentos_fallidos || 0) + 1;

  if (nuevosIntentos >= FALLOS_PARA_BLOQUEAR) {
    const nuevoNivel = (filaActual.nivel_bloqueo || 0) + 1;
    const minutos = minutosParaNivel(nuevoNivel);
    const bloqueadoHasta = new Date(Date.now() + minutos * 60000);

    await actualizar({
      intentos_fallidos: 0, // se reinicia el conteo, el bloqueo ya quedó activado
      nivel_bloqueo: nuevoNivel,
      bloqueado_hasta: bloqueadoHasta,
    });

    return { bloqueadoAhora: true, minutos };
  }

  await actualizar({ intentos_fallidos: nuevosIntentos });
  return { bloqueadoAhora: false, intentosRestantes: FALLOS_PARA_BLOQUEAR - nuevosIntentos };
}

// Login exitoso: reinicia todo a cero (intentos, nivel, bloqueo)
async function reiniciarPorExito(actualizar) {
  await actualizar({ intentos_fallidos: 0, nivel_bloqueo: 0, bloqueado_hasta: null });
}

module.exports = { verificarBloqueo, registrarFallo, reiniciarPorExito };
