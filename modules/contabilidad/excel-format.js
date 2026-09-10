"use strict";
function accountingFormat(currency = "PEN") {
  const symbol =
    currency === "PEN"
      ? "S/"
      : currency === "USD"
        ? "US$"
        : /^[A-Z]{3}$/.test(currency)
          ? currency
          : "";
  return `_(${JSON.stringify(symbol)}* #,##0.00_);_(${JSON.stringify(symbol)}* (#,##0.00);_(${JSON.stringify(symbol)}* "-"??_);_(@_)`;
}
module.exports = { accountingFormat };
