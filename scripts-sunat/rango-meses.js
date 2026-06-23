// ============================================================
//  GENERADOR DE RANGO DE MESES
// ============================================================
//
//  Qué hace:
//   Reemplaza el CONFIG.meses escrito a mano del script original.
//   El contador elige en la web "desde qué mes/año" y "hasta qué
//   mes/año", y esta función genera automáticamente cada mes con
//   sus fechas desde/hasta en el formato que Playwright necesita
//   (dd/mm/yyyy), igual que el script original.
//
//  Ejemplo de uso:
//   generarRangoMeses(2026, 1, 2026, 5)
//   -> [
//        { mes: 'Enero 2026',   desde: '01/01/2026', hasta: '31/01/2026' },
//        { mes: 'Febrero 2026', desde: '01/02/2026', hasta: '28/02/2026' },
//        ... hasta Mayo 2026
//      ]
// ============================================================

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function ultimoDiaDelMes(anio, mesIndice1a12) {
  // Día 0 del mes siguiente = último día del mes actual
  return new Date(anio, mesIndice1a12, 0).getDate();
}

function generarRangoMeses(anioDesde, mesDesde, anioHasta, mesHasta) {
  const meses = [];

  let anio = anioDesde;
  let mes = mesDesde;

  while (anio < anioHasta || (anio === anioHasta && mes <= mesHasta)) {
    const ultimoDia = ultimoDiaDelMes(anio, mes);
    const nombreMes = NOMBRES_MES[mes - 1];

    meses.push({
      mes: `${nombreMes} ${anio}`,
      desde: `01/${dosDigitos(mes)}/${anio}`,
      hasta: `${dosDigitos(ultimoDia)}/${dosDigitos(mes)}/${anio}`,
    });

    mes++;
    if (mes > 12) {
      mes = 1;
      anio++;
    }
  }

  return meses;
}

module.exports = { generarRangoMeses, NOMBRES_MES };
