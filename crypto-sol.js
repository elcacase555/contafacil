// ============================================================
//  CIFRADO DE CLAVES SOL (reversible)
// ============================================================
//
//  Por qué esto es distinto al login:
//   La contraseña de LOGIN se guarda con bcrypt (hash, una sola
//   vía, nunca se puede leer de vuelta).
//
//   La clave SOL de cada cliente SÍ necesita poder leerse de
//   vuelta, porque el script de Playwright debe escribirla en
//   el formulario de SUNAT. Por eso usamos cifrado AES, que se
//   puede revertir SOLO si tienes la llave secreta (.env).
//
// ============================================================

const crypto = require('crypto');

const ALGORITMO = 'aes-256-cbc';

function obtenerLlave() {
  const llave = process.env.CLAVE_SECRETA_CIFRADO;
  if (!llave || llave.length < 32) {
    throw new Error(
      'Falta CLAVE_SECRETA_CIFRADO en el archivo .env (debe tener al menos 32 caracteres). ' +
      'Revisa el archivo .env.ejemplo para más detalles.'
    );
  }
  // Normaliza a 32 bytes exactos (AES-256 lo requiere)
  return crypto.createHash('sha256').update(llave).digest();
}

function cifrar(textoPlano) {
  const llave = obtenerLlave();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITMO, llave, iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf-8'), cipher.final()]);
  // Guardamos el IV junto con el texto cifrado, separados por ":"
  return iv.toString('hex') + ':' + cifrado.toString('hex');
}

function descifrar(textoCifrado) {
  const llave = obtenerLlave();
  const [ivHex, datoHex] = textoCifrado.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const dato = Buffer.from(datoHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITMO, llave, iv);
  const descifrado = Buffer.concat([decipher.update(dato), decipher.final()]);
  return descifrado.toString('utf-8');
}

module.exports = { cifrar, descifrar };
