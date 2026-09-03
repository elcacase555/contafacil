// ============================================================
//  BLOQUEO PROGRESIVO POR INTENTOS FALLIDOS (versión SQLite)
// ============================================================
//
//  5 fallos -> bloqueado 10 minutos
//  5 fallos más (tras desbloquear) -> bloqueado 30 minutos
//  5 fallos más -> bloqueado 1 hora
//  5 fallos más -> bloqueado 2 horas (sigue duplicando)
//
//  Un login EXITOSO reinicia el contador a cero.
// ============================================================

const FALLOS_PARA_BLOQUEAR = 5;
const MINUTOS_POR_NIVEL = [10, 30, 60];

function minutosParaNivel(nivel) {
  if (nivel <= 0) return 0;
  if (nivel <= MINUTOS_POR_NIVEL.length) return MINUTOS_POR_NIVEL[nivel - 1];
  const extra = nivel - MINUTOS_POR_NIVEL.length;
  return MINUTOS_POR_NIVEL[MINUTOS_POR_NIVEL.length - 1] * Math.pow(2, extra);
}

function verificarBloqueo(fila) {
  if (!fila.bloqueado_hasta) {
    return { bloqueado: false, minutosRestantes: 0 };
  }

  const hasta = new Date(fila.bloqueado_hasta + 'Z'); // 'Z' porque SQLite guarda UTC
  const ahora = new Date();

  if (ahora < hasta) {
    const minutosRestantes = Math.ceil((hasta - ahora) / 60000);
    return { bloqueado: true, minutosRestantes };
  }

  return { bloqueado: false, minutosRestantes: 0 };
}

function registrarFallo(filaActual, actualizar) {
  const nuevosIntentos = (filaActual.intentos_fallidos || 0) + 1;

  if (nuevosIntentos >= FALLOS_PARA_BLOQUEAR) {
    const nuevoNivel = (filaActual.nivel_bloqueo || 0) + 1;
    const minutos = minutosParaNivel(nuevoNivel);
    const bloqueadoHasta = new Date(Date.now() + minutos * 60000).toISOString().replace('Z', '');

    actualizar({
      intentos_fallidos: 0,
      nivel_bloqueo: nuevoNivel,
      bloqueado_hasta: bloqueadoHasta,
    });

    return { bloqueadoAhora: true, minutos };
  }

  actualizar({ intentos_fallidos: nuevosIntentos });
  return { bloqueadoAhora: false, intentosRestantes: FALLOS_PARA_BLOQUEAR - nuevosIntentos };
}

function reiniciarPorExito(actualizar) {
  actualizar({ intentos_fallidos: 0, nivel_bloqueo: 0, bloqueado_hasta: null });
}

module.exports = { verificarBloqueo, registrarFallo, reiniciarPorExito };
