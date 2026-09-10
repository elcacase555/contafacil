"use strict";
// Decode bytes without changing the downloaded file or replacing invalid characters.
function decodeXml(bytes) {
  const b = Buffer.from(bytes);
  if (b.length > 2 * 1024 * 1024) throw new Error("XML mayor a 2 MB");
  let detected = null;
  if (b.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    detected = "utf-8";
  else if (b[0] === 0xff && b[1] === 0xfe) detected = "utf-16le";
  else if (b[0] === 0xfe && b[1] === 0xff) detected = "utf-16be";
  else if (b[0] === 0x3c && b[1] === 0 && b[2] === 0x3f && b[3] === 0)
    detected = "utf-16le";
  else if (b[0] === 0 && b[1] === 0x3c && b[2] === 0 && b[3] === 0x3f)
    detected = "utf-16be";
  const head = detected?.startsWith("utf-16")
    ? new TextDecoder(detected).decode(
        b.subarray(0, Math.min(b.length, 1024) & ~1),
      )
    : b.subarray(detected === "utf-8" ? 3 : 0, 1024).toString("latin1");
  const declaration = head
    .replace(/^\uFEFF/, "")
    .match(/^\s*<\?xml\s[\s\S]*?\?>/i)?.[0];
  const label = declaration
    ?.match(/\bencoding\s*=\s*['"]([^'"]+)['"]/i)?.[1]
    .toLowerCase();
  const aliases = {
    "utf-8": "utf-8",
    utf8: "utf-8",
    "utf-16": "utf-16",
    "utf-16le": "utf-16le",
    "utf-16be": "utf-16be",
    "iso-8859-1": "latin1",
    latin1: "latin1",
    "iso_8859-1": "latin1",
    "windows-1252": "windows-1252",
    cp1252: "windows-1252",
    "us-ascii": "ascii",
    ascii: "ascii",
  };
  if (label && !aliases[label])
    throw new Error("Codificación XML no soportada: " + label);
  let encoding = label ? aliases[label] : detected || "utf-8";
  if (encoding === "utf-16") {
    if (!detected?.startsWith("utf-16"))
      throw new Error("XML UTF-16 sin marca de orden de bytes");
    encoding = detected;
  }
  if (detected && encoding !== detected)
    throw new Error(
      "La codificación declarada del XML contradice su marca de bytes",
    );
  let text;
  try {
    if (encoding === "latin1") text = b.toString("latin1");
    else if (encoding === "ascii") {
      if (b.some((v) => v > 127)) throw new Error();
      text = b.toString("ascii");
    } else text = new TextDecoder(encoding, { fatal: true }).decode(b);
  } catch {
    throw new Error(
      "No se pudo leer el XML como " +
        encoding +
        ". Revise su declaración de codificación; el archivo original se conserva.",
    );
  }
  return text.replace(/^\uFEFF/, "");
}
module.exports = { decodeXml };
