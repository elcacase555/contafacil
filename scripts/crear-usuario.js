// ============================================================
//  AGREGAR UN CONTADOR NUEVO (solo lo ejecutas tú, el dueño del sistema)
//  Uso: node scripts/crear-usuario.js
// ============================================================

require('dotenv').config();
const bcrypt = require('bcrypt');
const readline = require('readline');
const db = require('../db');

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(texto, respuesta => {
      rl.close();
      resolve(respuesta.trim());
    });
  });
}

async function main() {
  console.log('\n=== Agregar nuevo contador al sistema ===\n');

  const nombre = await preguntar('Nombre del contador (ej: Juan Pérez): ');
  const usuario = await preguntar('Usuario que va a usar para entrar: ');
  const clave = await preguntar('Contraseña que le vas a dar: ');

  if (!nombre || !usuario || !clave) {
    console.log('\n❌ Todos los campos son obligatorios.\n');
    return;
  }

  const yaExiste = db.prepare('SELECT id FROM contadores WHERE usuario = ?').get(usuario);
  if (yaExiste) {
    console.log(`\n❌ Ya existe un contador con el usuario "${usuario}". Elige otro usuario.\n`);
    return;
  }

  const claveHash = await bcrypt.hash(clave, 10);

  db.prepare(`
    INSERT INTO contadores (nombre, usuario, clave_hash)
    VALUES (?, ?, ?)
  `).run(nombre, usuario, claveHash);

  console.log('\n✅ Contador agregado correctamente.');
  console.log('\n   Datos para entregarle:');
  console.log(`   Usuario:    ${usuario}`);
  console.log(`   Contraseña: ${clave}`);
  console.log('\n   (la contraseña real no queda guardada en texto plano en ningún lado)\n');
}

main();
