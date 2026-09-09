const test = require("node:test"),
  assert = require("node:assert/strict");
const { decodeXml } = require("../modules/contabilidad/xml-encoding");
const { parseUBL } = require("../modules/contabilidad/parser");
const { fixture } = require("./helpers");
const xml = fixture().replace("Proveedor SAC", "Muñoz y compañía");
test("XML decoding preserves accents and monetary data in Latin-1, Windows-1252 and UTF-8", () => {
  for (const [decl, encoding] of [
    ["ISO-8859-1", "latin1"],
    ["Windows-1252", "latin1"],
    ["UTF-8", "utf8"],
  ]) {
    const bytes = Buffer.from(
        `<?xml version="1.0" encoding="${decl}"?>` + xml,
        encoding,
      ),
      copy = Buffer.from(bytes);
    const d = parseUBL(decodeXml(bytes), "20100000001");
    assert.equal(d.emisor_nombre, "Muñoz y compañía");
    assert.equal(d.total, 11800);
    assert.deepEqual(bytes, copy);
  }
  const cp = Buffer.from(
    '<?xml version="1.0" encoding="windows-1252"?><t>\x80</t>',
    "latin1",
  );
  assert.ok(decodeXml(cp).includes("€"));
});
test("XML decoding recognizes UTF-16 BOM and byte order", () => {
  assert.equal(
    parseUBL(
      decodeXml(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('<?xml version="1.0" encoding="UTF-8"?>' + xml),
        ]),
      ),
      "20100000001",
    ).total,
    11800,
  );
  const b = Buffer.from(
    '<?xml version="1.0" encoding="UTF-16"?>' + xml,
    "utf16le",
  );
  for (const [bom, body] of [
    [[0xff, 0xfe], b],
    [[0xfe, 0xff], Buffer.from(b).swap16()],
  ])
    assert.equal(
      parseUBL(
        decodeXml(Buffer.concat([Buffer.from(bom), body])),
        "20100000001",
      ).total,
      11800,
    );
});
test("invalid, unsupported and contradictory encodings are explicit errors", () => {
  assert.throws(() => decodeXml(Buffer.from(xml, "latin1")), /No se pudo leer/);
  assert.throws(
    () => decodeXml(Buffer.from('<?xml encoding="unknown"?><a/>')),
    /no soportada/,
  );
  assert.throws(
    () =>
      decodeXml(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('<?xml encoding="iso-8859-1"?><a/>'),
        ]),
      ),
    /contradice/,
  );
});
