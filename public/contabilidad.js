"use strict";
const $ = (id) => document.getElementById(id),
  api = "/api/contabilidad";
let token = "",
  cuentas = [],
  asientos = [],
  editId = null,
  tab = "crm",
  version = 0;
const msg = (s, error = false) => {
  $("mensaje").textContent = s;
  $("mensaje").classList.toggle("error", error);
};
const money = (n) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    n / 100,
  );
const val = (n) => (n / 100).toFixed(2);
const fields = (form) => Object.fromEntries(new FormData(form));
const endpoint = (p) => api + "/clientes/" + $("cliente").value + p;
async function request(url, method = "GET", data, xml = false) {
  const r = await fetch(url, {
    method,
    headers: {
      "X-CSRF-Token": token,
      ...(method === "GET"
        ? {}
        : { "Content-Type": xml ? "application/xml" : "application/json" }),
    },
    body: method === "GET" ? undefined : xml ? data : JSON.stringify(data),
  });
  const out = await r.json();
  if (!r.ok) {
    if (r.status === 401) location.href = "/login";
    throw new Error(out.mensaje || "No se pudo completar la operación");
  }
  return out;
}
async function action(fn) {
  try {
    await fn();
  } catch (e) {
    msg(e.message, true);
  }
}
function button(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.onclick = () =>
    action(async () => {
      b.disabled = true;
      try {
        await fn();
      } finally {
        b.disabled = false;
      }
    });
  return b;
}
function table(id, headers, rows) {
  const target = typeof id === "string" ? $(id) : id;
  target.replaceChildren();
  if (!rows.length) {
    const p = document.createElement("p");
    p.textContent = "Todavía no hay registros.";
    target.append(p);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const t = document.createElement("table");
  const head = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  });
  const thead = document.createElement("thead");
  thead.append(head);
  t.append(thead);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((v) => {
      const td = document.createElement("td");
      if (v instanceof Node) td.append(v);
      else td.textContent = v ?? "";
      tr.append(td);
    });
    body.append(tr);
  });
  t.append(body);
  wrap.append(t);
  target.append(wrap);
}
function select(options, value) {
  const s = document.createElement("select");
  for (const [v, l] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    s.append(o);
  }
  if (value !== undefined) s.value = value;
  return s;
}
function input(type, value = "") {
  const i = document.createElement("input");
  i.type = type;
  i.value = value;
  return i;
}
function switchTab(name) {
  tab = name;
  document
    .querySelectorAll("section.panel")
    .forEach((s) => (s.hidden = s.id !== name));
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
function resetEntry() {
  editId = null;
  $("editorTitulo").textContent = "Asiento manual / saldos de apertura";
  $("asientoForm").reset();
  $("asientoForm").elements.fecha.value = $("corte").value;
  $("asientoForm").elements.fecha.disabled = false;
  $("asientoForm").elements.glosa.disabled = false;
  $("asientoForm").elements.clase.disabled = false;
  $("lineas").replaceChildren();
  addLine();
  addLine();
}
function addLine(p = {}) {
  const row = document.createElement("div");
  row.className = "row";
  const s = select(
    cuentas.map((c) => [c.codigo, c.codigo + " · " + c.nombre]),
    p.cuenta,
  );
  s.setAttribute("aria-label", "Cuenta");
  const d = input("number", p.debe === undefined ? "0" : val(p.debe)),
    h = input("number", p.haber === undefined ? "0" : val(p.haber));
  d.step = h.step = "0.01";
  d.min = h.min = "0";
  d.setAttribute("aria-label", "Debe en soles");
  h.setAttribute("aria-label", "Haber en soles");
  row.append(
    s,
    d,
    h,
    button("Quitar", () => row.remove()),
  );
  $("lineas").append(row);
}
function addAdjustment() {
  const row = document.createElement("div");
  row.className = "row";
  const s = select([
      ["adicion", "Adición"],
      ["deduccion", "Deducción"],
    ]),
    n = input("number", "0"),
    c = input("text"),
    f = input("text");
  n.step = "0.01";
  n.min = "0";
  c.placeholder = "Concepto";
  f.placeholder = "Fundamento y evidencia";
  [s, n, c, f].forEach((e, i) =>
    e.setAttribute(
      "aria-label",
      ["Tipo", "Importe", "Concepto", "Fundamento"][i],
    ),
  );
  row.append(
    s,
    n,
    c,
    f,
    button("Quitar", () => row.remove()),
  );
  $("ajustes").append(row);
}
function renderStatements(f, mayor) {
  table(
    "situacion",
    ["Clase", "Rubro", "Importe"],
    [
      ...f.situacion
        .filter((r) => r.importe)
        .map((r) => [r.clase, r.rubro, money(r.importe)]),
      [
        "patrimonio",
        "Resultado pendiente de cierre",
        money(f.resultadoPendiente),
      ],
    ],
  );
  table(
    "resultados",
    ["Clase", "Rubro", "Importe"],
    [
      ...f.resultados
        .filter((r) => r.importe)
        .map((r) => [r.clase, r.rubro, money(r.importe)]),
      ["resultado", "Utilidad / pérdida del ejercicio", money(f.utilidad)],
    ],
  );
  $("indicadores").replaceChildren();
  for (const [name, n] of [
    ["Activos", f.activo],
    ["Pasivos", f.pasivo],
    ["Patrimonio registrado", f.patrimonio],
    ["Resultado pendiente de cierre", f.resultadoPendiente],
    ["Ingresos del ejercicio", f.ingresos],
    ["Gastos del ejercicio", f.gastos],
    ["Utilidad del ejercicio", f.utilidad],
    ["Diferencia de balance", f.diferencia],
  ]) {
    const box = document.createElement("div");
    box.className = "card";
    const label = document.createElement("span");
    label.textContent = name;
    const value = document.createElement("strong");
    value.textContent = money(n);
    box.append(label, value);
    $("indicadores").append(box);
  }
  table(
    "balance",
    ["Cuenta", "Nombre", "Rubro", "Debe", "Haber", "Saldo deudor"],
    f.balance
      .filter((r) => r.debe || r.haber)
      .map((r) => [
        r.codigo,
        r.nombre,
        r.rubro,
        money(r.debe),
        money(r.haber),
        money(r.saldo),
      ]),
  );
  table(
    "mayor",
    ["Cuenta", "Fecha", "Asiento", "Glosa", "Debe", "Haber", "Saldo acumulado"],
    mayor.map((r) => [
      r.cuenta,
      r.fecha,
      r.asiento_id,
      r.glosa,
      money(r.debe),
      money(r.haber),
      money(r.saldo),
    ]),
  );
}
function renderEntries() {
  table(
    "asientos",
    ["N.º", "Fecha", "Glosa", "Estado", "Detalle y acciones"],
    asientos.map((a) => {
      const box = document.createElement("div"),
        details = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = "Ver partida doble";
      details.append(summary);
      const div = document.createElement("div");
      table(
        div,
        ["Cuenta", "Debe", "Haber"],
        a.apuntes.map((p) => [p.cuenta, money(p.debe), money(p.haber)]),
      );
      details.append(div);
      box.append(details);
      if (a.estado === "borrador") {
        box.append(
          button("Editar", () => {
            editId = a.id;
            $("editorTitulo").textContent = "Editar borrador " + a.id;
            $("asientoForm").elements.fecha.value = a.fecha;
            $("asientoForm").elements.glosa.value = a.glosa;
            $("asientoForm").elements.clase.value = a.clase;
            for (const k of ["fecha", "glosa", "clase"])
              $("asientoForm").elements[k].disabled = true;
            $("lineas").replaceChildren();
            a.apuntes.forEach(addLine);
            $("asientoForm").scrollIntoView({ behavior: "smooth" });
          }),
          button("Contabilizar", async () => {
            await request(
              endpoint("/asientos/" + a.id + "/contabilizar"),
              "POST",
              {},
            );
            msg("Asiento contabilizado.");
            await refresh();
          }),
        );
      } else
        box.append(
          button("Revertir al corte seleccionado", async () => {
            await request(endpoint("/asientos/" + a.id + "/revertir"), "POST", {
              fecha: $("corte").value,
            });
            msg("Reversión creada como borrador. Revísala y contabilízala.");
            await refresh();
          }),
        );
      return [a.id, a.fecha, a.glosa, a.estado, box];
    }),
  );
}
function renderDocs(docs) {
  table(
    "comprobantes",
    [
      "Fecha",
      "Documento",
      "Operación",
      "Moneda / total",
      "Revisión",
      "Propuesta PCGE",
    ],
    docs.map((d) => {
      const box = document.createElement("div");
      const account = select([
        ["", "Seleccione la naturaleza"],
        ...cuentas
          .filter((c) =>
            d.direccion === "compra"
              ? ["activo", "gasto"].includes(c.clase)
              : c.clase === "ingreso",
          )
          .map((c) => [c.codigo, c.codigo + " · " + c.nombre]),
      ]);
      account.setAttribute("aria-label", "Cuenta de la operación");
      const credit = input("checkbox");
      const label = document.createElement("label");
      label.append(credit, document.createTextNode("Crédito fiscal revisado"));
      box.append(account);
      if (d.direccion === "compra") box.append(label);
      const b = button("Proponer asiento", async () => {
        if (!account.value) throw new Error("Seleccione una cuenta");
        await request(endpoint("/comprobantes/" + d.id + "/proponer"), "POST", {
          cuenta: account.value,
          creditoFiscal: credit.checked,
        });
        msg("Propuesta creada. Revísala en Libro Diario.");
        await refresh();
        switchTab("diario");
      });
      b.disabled = d.datos.warnings.length > 0;
      box.append(b);
      return [
        d.fecha,
        d.tipo + " / " + d.numero,
        d.direccion,
        d.moneda + " " + val(d.total),
        d.datos.warnings.join(" ") || "Pendiente de clasificación y revisión",
        box,
      ];
    }),
  );
}
function renderRegisters(rows) {
  table(
    "listaRegistros",
    [
      "Documento",
      "Operación",
      "Emisión",
      "Base",
      "IGV",
      "Total",
      "Revisión fiscal",
    ],
    rows.map((r) => {
      const box = document.createElement("div"),
        p = input("month", r.periodo),
        state = select(
          [
            ["sin_verificar", "Sin verificar"],
            ["aceptado", "Aceptado (verificado por contador)"],
            ["anulado", "Anulado"],
            ["rechazado", "Rechazado"],
          ],
          r.estado_sunat,
        ),
        credit = input("checkbox");
      credit.checked = !!r.credito_fiscal;
      const l = document.createElement("label");
      l.append(credit, document.createTextNode("Crédito fiscal válido"));
      box.append(
        p,
        state,
        l,
        button("Guardar revisión", async () => {
          await request(endpoint("/registros/" + r.id), "PUT", {
            periodo: p.value,
            estadoSunat: state.value,
            creditoFiscal: credit.checked,
          });
          msg("Revisión fiscal guardada.");
          await refresh();
        }),
      );
      return [
        r.tipo + " " + r.numero,
        r.direccion,
        r.fecha,
        r.moneda + " " + val(r.base * r.signo),
        val(r.igv * r.signo),
        val(r.total * r.signo),
        box,
      ];
    }),
  );
}
function renderRenta(r) {
  table(
    "resultadoRenta",
    ["Concepto", "Soles"],
    Object.entries(r)
      .filter(([k, v]) => typeof v === "number" && k !== "ejercicio")
      .map(([k, v]) => [k, money(v)]),
  );
}
function renderSire(rows) {
  const box = $("sirePanel");
  box.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = "SIRE · archivo preliminar para validación";
  const note = document.createElement("p");
  note.textContent =
    "Perfil base RVIE (anexo 3) / RCE (anexo 11), operaciones nacionales simples en soles. Sin prorrata, exportaciones ni regímenes especiales. Verifica la razón social legal del cliente, concilia la propuesta y valida con PVSIRE. No se envía a SUNAT.";
  box.append(title, note);
  const choices = {};
  for (const r of rows.filter((x) => x.direccion === "compra")) {
    const l = document.createElement("label");
    l.textContent = r.numero + " · clasificación de compra";
    const s = select([
      ["", "Seleccione"],
      ["1", "Mercaderías / insumos"],
      ["2", "Activo fijo"],
      ["3", "Otros activos"],
      ["4", "Educación, representación, viaje y otros del numeral 4"],
      ["5", "Otros gastos"],
    ]);
    choices[r.id] = s;
    box.append(l);
    l.append(s);
  }
  for (const libro of ["RVIE", "RCE"])
    box.append(
      button("Preparar " + libro, async () => {
        const result = await request(endpoint("/sire"), "POST", {
          libro,
          periodo: $("periodo").value,
          clasificacion: Object.fromEntries(
            Object.entries(choices).map(([id, s]) => [id, s.value]),
          ),
        });
        const blob = new Blob([result.contenido], {
            type: "text/plain;charset=utf-8",
          }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = result.archivo;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        msg(result.advertencia);
        await refresh();
      }),
    );
}
async function refresh() {
  const rev = ++version;
  if (!$("cliente").value) {
    msg("Añade primero un cliente SUNAT desde el inicio.");
    return;
  }
  const p = $("periodo").value,
    cut = $("corte").value;
  const result = await Promise.all([
    request(endpoint("/cuentas")),
    request(endpoint("/comprobantes")),
    request(endpoint("/asientos")),
    request(endpoint("/registros?periodo=" + p)),
    request(endpoint("/estados?corte=" + cut)),
    request(endpoint("/mayor?corte=" + cut)),
    request(api + "/crm?periodo=" + p),
    request(endpoint("/periodos")),
    request(endpoint("/auditoria")),
    request(endpoint("/renta")),
  ]);
  if (rev !== version) return;
  const [
    accounts,
    docs,
    entries,
    registers,
    f,
    ledger,
    crm,
    periods,
    audit,
    rentas,
  ] = result;
  cuentas = accounts;
  asientos = entries;
  renderDocs(docs);
  renderEntries();
  renderRegisters(registers);
  renderSire(registers);
  renderStatements(f, ledger);
  table(
    "cuentas",
    ["Cuenta", "Nombre", "Clase", "Rubro"],
    cuentas.map((c) => [c.codigo, c.nombre, c.clase, c.rubro]),
  );
  table(
    "periodos",
    ["Periodo", "Estado"],
    periods.map((p) => [p.periodo, p.cerrado ? "Cerrado" : "Abierto"]),
  );
  table(
    "auditoria",
    ["Fecha", "Evento", "Detalle"],
    audit.map((a) => [a.fecha, a.evento, a.detalle]),
  );
  table(
    "clientesCrm",
    ["Cliente", "RUC", "Vencimiento mensual", "Alerta", "Borradores"],
    crm.map((c) => [
      button(c.nombre_cliente, async () => {
        $("cliente").value = c.id;
        await changeClient();
      }),
      c.ruc,
      c.fecha || "Sin cronograma cargado",
      c.alerta.replaceAll("_", " "),
      c.pendientes,
    ]),
  );
  const current = crm.find((c) => String(c.id) === $("cliente").value);
  $("perfilForm").elements.grupo.value = current?.grupo || "regular";
  table(
    "tareas",
    ["Tarea", "Vence", "Notas", "Estado"],
    (current?.tareas || []).map((t) => [
      t.titulo,
      t.vence,
      t.notas,
      button(
        t.completada ? "Completada · reabrir" : "Pendiente · completar",
        async () => {
          await request(endpoint("/tareas/" + t.id), "PUT", {
            completada: !t.completada,
          });
          await refresh();
        },
      ),
    ]),
  );
  table(
    "rentasGuardadas",
    ["Ejercicio", "Régimen", "Saldo por regularizar", "Actualizado", "Detalle"],
    rentas.map((r) => [
      r.ejercicio,
      r.resultado.regimen,
      money(r.resultado.saldo),
      r.actualizado_en,
      button("Ver borrador", () => renderRenta(r.resultado)),
    ]),
  );
  if (!$("lineas").children.length) resetEntry();
}
async function changeClient() {
  editId = null;
  $("lineas").replaceChildren();
  $("importacion").replaceChildren();
  $("resultadoRenta").replaceChildren();
  $("ajustes").replaceChildren();
  $("rentaForm").reset();
  $("rentaForm").elements.ejercicio.value = $("periodo").value.slice(0, 4);
  await refresh();
  resetEntry();
}
function form(id, fn) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const b = e.submitter;
      b.disabled = true;
      try {
        await fn(e.target);
        await refresh();
      } finally {
        b.disabled = false;
      }
    });
  };
}
form("xmlForm", async () => {
  const files = [...$("archivos").files];
  if (files.length > 100) throw new Error("Seleccione hasta 100 archivos");
  const target = endpoint("/xml");
  $("importacion").replaceChildren();
  for (const file of files) {
    const p = document.createElement("p");
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Supera 2 MB");
      const r = await request(target, "POST", await file.text(), true);
      p.textContent =
        file.name +
        ": " +
        (r.duplicado ? "ya importado" : "importado") +
        (r.advertencias?.length ? " · " + r.advertencias.join(" ") : "");
    } catch (e) {
      p.textContent = file.name + ": " + e.message;
      p.className = "notice";
    }
    $("importacion").append(p);
  }
  msg("Lote procesado; revisa el resultado de cada archivo.");
});
form("asientoForm", async (f) => {
  const data = fields(f);
  data.apuntes = [...$("lineas").children].map((row) => ({
    cuenta: row.children[0].value,
    debe: row.children[1].value,
    haber: row.children[2].value,
  }));
  await request(
    endpoint("/asientos" + (editId ? "/" + editId : "")),
    editId ? "PUT" : "POST",
    data,
  );
  msg("Borrador guardado.");
  resetEntry();
});
form("tareaForm", async (f) => {
  await request(endpoint("/tareas"), "POST", fields(f));
  f.reset();
  msg("Tarea guardada.");
});
form("perfilForm", async (f) => {
  await request(endpoint("/perfil"), "PUT", fields(f));
  msg("Condición actualizada.");
});
form("vencimientoForm", async (f) => {
  await request(endpoint("/vencimiento"), "PUT", {
    ...fields(f),
    periodo: $("periodo").value,
  });
  msg("Vencimiento especial guardado.");
});
form("cuentaForm", async (f) => {
  await request(endpoint("/cuentas"), "POST", fields(f));
  f.reset();
  msg("Cuenta creada.");
});
form("rentaForm", async (f) => {
  const data = fields(f);
  data.ajustes = [...$("ajustes").children].map((r) => ({
    tipo: r.children[0].value,
    importe: r.children[1].value,
    concepto: r.children[2].value,
    fundamento: r.children[3].value,
  }));
  renderRenta(await request(endpoint("/renta"), "POST", data));
  msg("Borrador anual guardado para revisión.");
});
$("agregarLinea").onclick = () => addLine();
$("nuevoAsiento").onclick = resetEntry;
$("agregarAjuste").onclick = addAdjustment;
$("cliente").onchange = () => action(changeClient);
$("actualizar").onclick = () => action(refresh);
$("corte").onchange = () => action(refresh);
$("periodo").onchange = () =>
  action(async () => {
    const [y, m] = $("periodo").value.split("-").map(Number);
    $("corte").value = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    await refresh();
  });
for (const [id, closed] of [
  ["cerrarPeriodo", true],
  ["abrirPeriodo", false],
])
  $(id).onclick = () =>
    action(async () => {
      await request(endpoint("/periodos"), "POST", {
        periodo: $("periodo").value,
        cerrado: closed,
      });
      msg(
        closed
          ? "Periodo cerrado."
          : "Periodo reabierto; cambio registrado en historial.",
      );
      await refresh();
    });
document.querySelectorAll("[data-export]").forEach(
  (b) =>
    (b.onclick = () => {
      location.href = endpoint(
        "/exportar?libro=" +
          b.dataset.export +
          "&periodo=" +
          $("periodo").value +
          "&corte=" +
          $("corte").value,
      );
    }),
);
action(async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  $("periodo").value = today.slice(0, 7);
  $("corte").value = today;
  $("rentaForm").elements.ejercicio.value = today.slice(0, 4);
  token = (await request(api + "/csrf")).token;
  const clients = await request("/api/clientes");
  for (const c of clients) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.nombre_cliente + " · " + c.ruc;
    $("cliente").append(o);
  }
  const id = new URLSearchParams(location.search).get("cliente");
  if (clients.some((c) => String(c.id) === id)) $("cliente").value = id;
  switchTab("crm");
  await refresh();
});
