const Database = require("better-sqlite3");
const { migrate, service } = require("../modules/contabilidad/service");
function fixture(options = {}) {
  const {
    kind = "Invoice",
    number = "F001-1",
    supplier = "20100000001",
    customer = "20100000002",
    base = "100.00",
    tax = "18.00",
    total = "118.00",
    currency = "PEN",
    reference = "F001-1",
    taxcode = "1000",
  } = options;
  const line = {
      Invoice: "InvoiceLine",
      CreditNote: "CreditNoteLine",
      DebitNote: "DebitNoteLine",
    }[kind],
    mon =
      kind === "DebitNote" ? "RequestedMonetaryTotal" : "LegalMonetaryTotal";
  return `<${kind} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${kind}-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:ID>${number}</cbc:ID><cbc:IssueDate>2026-08-01</cbc:IssueDate><cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">${supplier}</cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>Proveedor SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">${customer}</cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>Cliente SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>${kind !== "Invoice" ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${reference}</cbc:ID><cbc:DocumentTypeCode>01</cbc:DocumentTypeCode></cac:InvoiceDocumentReference></cac:BillingReference>` : ""}<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${tax}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${base}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${tax}</cbc:TaxAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>${taxcode}</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:${mon}><cbc:LineExtensionAmount currencyID="${currency}">${base}</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="${currency}">${total}</cbc:PayableAmount></cac:${mon}><cac:${line}><cbc:LineExtensionAmount currencyID="${currency}">${base}</cbc:LineExtensionAmount><cac:Item><cbc:Description>Servicio</cbc:Description></cac:Item></cac:${line}></${kind}>`;
}
function setup() {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE contadores(id INTEGER PRIMARY KEY,activo INTEGER);CREATE TABLE clientes_sunat(id INTEGER PRIMARY KEY,contador_id INTEGER,ruc TEXT,nombre_cliente TEXT); INSERT INTO contadores VALUES(1,1),(2,1); INSERT INTO clientes_sunat VALUES(1,1,'20100000001','Empresa Uno'),(2,2,'20100000002','Empresa Dos'),(3,1,'20100000003','Empresa Tres')",
  );
  migrate(db);
  return { db, s: service(db, 1, 1) };
}

module.exports = { fixture, setup };
