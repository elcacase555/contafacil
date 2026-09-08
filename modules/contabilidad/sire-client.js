"use strict";
const AdmZip = require("adm-zip");
const BASE = "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros";
const MASS = BASE + "/rvierce/gestionprocesosmasivos/web/masivo";
async function limited(response, max = 30 * 1024 * 1024) {
  if (!response.ok) throw new Error("SUNAT respondió HTTP " + response.status);
  let size = 0;
  const parts = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max)
      throw new Error("Respuesta SIRE excede el límite de tamaño");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
function unpack(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error("SUNAT no devolvió un ZIP de propuesta");
  const zip = new AdmZip(bytes),
    files = zip
      .getEntries()
      .filter(
        (e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".txt"),
      );
  if (
    !files.length ||
    files.length > 100 ||
    files.reduce((s, e) => s + e.header.size, 0) > 50 * 1024 * 1024
  )
    throw new Error("ZIP SIRE vacío o demasiado grande");
  return files.map((e) => ({
    nombre: e.entryName,
    texto: new TextDecoder("utf-8", { fatal: true }).decode(e.getData()),
  }));
}
function createSireClient({
  fetcher = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 30,
} = {}) {
  async function json(url, opts = {}) {
    const b = await limited(
      await fetcher(url, {
        ...opts,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      }),
      2 * 1024 * 1024,
    );
    try {
      return JSON.parse(b.toString("utf8"));
    } catch {
      throw new Error("Respuesta JSON SIRE inválida");
    }
  }
  return {
    async token({ clientId, clientSecret, ruc, usuario, password }) {
      if (!/^[a-zA-Z0-9-]{10,100}$/.test(clientId))
        throw new Error("Client ID SIRE inválido");
      const out = await json(
        "https://api-seguridad.sunat.gob.pe/v1/clientessol/" +
          clientId +
          "/oauth2/token/",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "password",
            scope: "https://api-sire.sunat.gob.pe",
            client_id: clientId,
            client_secret: clientSecret,
            username: ruc + usuario,
            password,
          }),
        },
      );
      if (typeof out.access_token !== "string")
        throw new Error("SUNAT no autorizó la sesión SIRE");
      return out.access_token;
    },
    async proposal(token, periodo, libro, progress = () => {}) {
      if (
        !/^20\d{2}(0[1-9]|1[0-2])$/.test(periodo) ||
        !["RVIE", "RCE"].includes(libro)
      )
        throw new Error("Consulta SIRE inválida");
      // RCE endpoint is intentionally configured separately from RVIE.
      const endpoint =
        libro === "RVIE"
          ? BASE +
            "/rvie/propuesta/web/propuesta/" +
            periodo +
            "/exportapropuesta"
          : BASE +
            "/rce/propuesta/web/propuesta/" +
            periodo +
            "/exportacioncomprobantepropuesta";
      const headers = {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      };
      const ticket = await json(
        endpoint +
          "?codTipoArchivo=0" +
          (libro === "RCE" ? "&codOrigenEnvio=2" : ""),
        { headers },
      );
      if (!ticket.numTicket)
        throw new Error("SIRE no entregó ticket de propuesta");
      for (let i = 0; i < attempts; i++) {
        const query = new URLSearchParams({
          perIni: periodo,
          perFin: periodo,
          page: "1",
          perPage: "20",
          numTicket: String(ticket.numTicket),
          codLibro: libro === "RVIE" ? "140000" : "080000",
          codOrigenEnvio: "2",
        });
        const state = await json(MASS + "/consultaestadotickets?" + query, {
          headers,
        });
        const row = state.registros?.find(
          (r) => String(r.numTicket) === String(ticket.numTicket),
        );
        const files = row?.archivoReporte;
        if (files?.length) {
          const out = [];
          for (const file of files) {
            const q = new URLSearchParams({
              nomArchivoReporte: file.nomArchivoReporte,
              codTipoArchivoReporte: String(
                file.codTipoArchivoReporte ??
                  file.codTipoAchivoReporte ??
                  "null",
              ),
              codLibro: libro === "RVIE" ? "140000" : "080000",
              perTributario: periodo,
              codProceso: String(row.codProceso),
              numTicket: String(ticket.numTicket),
            });
            const bytes = await limited(
              await fetcher(MASS + "/archivoreporte?" + q, {
                headers,
                redirect: "error",
                signal: AbortSignal.timeout(60000),
              }),
            );
            out.push(...unpack(bytes));
          }
          return { ticket: String(ticket.numTicket), archivos: out };
        }
        if (String(row?.codEstadoProceso) === "03")
          throw new Error("SIRE procesó el ticket con errores");
        progress(
          `${libro} ${periodo}: esperando archivo SUNAT (${i + 1}/${attempts})`,
        );
        await sleep(2000);
      }
      throw new Error(
        "SIRE todavía no preparó la propuesta. Vuelve a intentar más tarde.",
      );
    },
  };
}
module.exports = { createSireClient, unpack };
