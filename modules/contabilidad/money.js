"use strict";
// Amounts are integer cents. No binary floating point in monetary parsing.
function cents(value) {
  const s = String(value ?? "0");
  if (!/^-?\d{1,11}(\.\d{1,2})?$/.test(s))
    throw new Error("Importe inválido: usar hasta dos decimales");
  const [a, b = ""] = s.replace("-", "").split(".");
  return (
    Number(BigInt(a) * 100n + BigInt(b.padEnd(2, "0"))) *
    (s.startsWith("-") ? -1 : 1)
  );
}
function amount(n) {
  if (!Number.isSafeInteger(n)) throw new Error("Importe fuera de rango");
  return (
    (n < 0 ? "-" : "") +
    Math.floor(Math.abs(n) / 100) +
    "." +
    String(Math.abs(n) % 100).padStart(2, "0")
  );
}
function rate(n, bps) {
  return Number((BigInt(n) * BigInt(bps) + 5000n) / 10000n);
}
function date(s) {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new Error("Fecha inválida");
  return s;
}
function period(s) {
  if (typeof s !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(s))
    throw new Error("Periodo inválido (AAAA-MM)");
  return s;
}
module.exports = { cents, amount, rate, date, period };
