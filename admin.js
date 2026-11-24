(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pane = $("#work");
  let me = null, schema = {};

  const api = async (p, o = {}) => {
    const r = await fetch("/api" + p, {
      headers: { "Content-Type": "application/json" }, credentials: "include", ...o,
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error((d && d.error) || "Error");
    return d;
  };
  const toast = (m, bad) => {
    const el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.textContent = m;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  };

  const LABEL = {
    tournaments: "Competiciones", teams: "Equipos", players: "Jugadores", standings: "Clasificaciones",
    matches: "Jornadas", news: "Publicaciones", sponsors: "Patrocinadores", divisions: "Divisiones",
    values_list: "Valores", areas: "Áreas", staff: "Staff", site: "Corporativo", users: "Usuarios", messages: "Mensajes"
  };
  const REF = { division_id: "divisions", team_id: "teams", tournament_id: "tournaments" };
  const RANK = { viewer: 1, editor: 2, admin: 3 };
  const can = (min) => RANK[me.role] >= RANK[min];

  async function boot() {
    try { me = await api("/auth/me"); } catch { return; }
    $("#loginBox").hidden = true;
    pane.hidden = false;
    $("#who").textContent = me.name + " · " + me.role;
    schema = await api("/admin/meta/schema");
    buildMenu();
    overview();
  }

  function buildMenu() {
    const menu = $("#menu");
    menu.innerHTML = "";
    const items = [["__overview", "Resumen"], ...Object.keys(schema).map((k) => [k, LABEL[k] || k])];
    items.forEach(([k, label]) => {
      if (schema[k] && !can(schema[k].min)) return;
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => { markOn(b); k === "__overview" ? overview() : list(k); };
      menu.appendChild(b);
    });
  }
  const markOn = (el) => { $$("#menu button").forEach((b) => b.classList.remove("on")); el.classList.add("on"); };

  async function overview() {
    const d = await api("/admin/overview");
    pane.innerHTML = `<div class="top"><h1>Resumen</h1><div class="tools"><a class="btn btn-xs" href="/">Ver sitio</a></div></div>
      <div class="kpis">
        <div class="kpi"><b>${d.tournaments}</b><span>Competiciones</span></div>
        <div class="kpi"><b>${d.teams}</b><span>Equipos</span></div>
        <div class="kpi"><b>${d.players}</b><span>Jugadores</span></div>
        <div class="kpi"><b>${d.news}</b><span>Publicaciones</span></div>
        <div class="kpi"><b>${d.sponsors}</b><span>Patrocinadores</span></div>
        <div class="kpi"><b>${d.messages}</b><span>Mensajes nuevos</span></div>
      </div>
      <p class="muted">Todo el contenido público se edita desde el menú lateral. Los cambios se reflejan al instante.</p>`;
  }

  async function list(entity) {
    const cfg = schema[entity];
    const rows = await api("/admin/" + entity);
    const cols = cfg.display || Object.keys(cfg.fields).slice(0, 4);
    const canEdit = can("editor");
    const canDelete = can("admin") && !cfg.singleton;
    pane.innerHTML = `<div class="top"><h1>${LABEL[entity] || entity}</h1>
      <div class="tools">${canEdit && !cfg.singleton && entity !== "messages" ? `<button class="btn btn-primary btn-xs" id="new">Nuevo</button>` : ""}</div></div>
      <div class="scroll"><table><thead><tr><th>ID</th>${cols.map((c) => `<th>${c}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.id}</td>
        ${cols.map((c) => `<td>${esc(String(r[c] ?? "").slice(0, 80))}</td>`).join("")}
        <td><div class="act">
          ${entity === "messages" && canEdit ? `<button class="btn btn-xs" data-r="${r.id}" data-v="${r.read ? 0 : 1}">${r.read ? "No leído" : "Leído"}</button>` : ""}
          ${canEdit && entity !== "messages" ? `<button class="btn btn-xs" data-e="${r.id}">Editar</button>` : ""}
          ${canDelete ? `<button class="btn btn-xs btn-danger" data-d="${r.id}">Borrar</button>` : ""}
        </div></td></tr>`).join("")}
      </tbody></table></div>`;
    $("#new")?.addEventListener("click", () => form(entity, null));
    $$("[data-e]").forEach((b) => b.onclick = () => form(entity, rows.find((r) => r.id == b.dataset.e)));
    $$("[data-r]").forEach((b) => b.onclick = async () => {
      try { await api(`/admin/messages/${b.dataset.r}`, { method: "PATCH", body: { read: +b.dataset.v } }); list(entity); }
      catch (err) { toast(err.message, true); }
    });
    $$("[data-d]").forEach((b) => b.onclick = async () => {
      if (!confirm("¿Eliminar el registro?")) return;
      try { await api(`/admin/${entity}/${b.dataset.d}`, { method: "DELETE" }); toast("Eliminado"); list(entity); }
      catch (err) { toast(err.message, true); }
    });
    if (cfg.singleton && rows[0]) form(entity, rows[0]);
  }

  async function form(entity, row) {
    const cfg = schema[entity];
    const refs = {};
    for (const [field, target] of Object.entries(REF)) {
      if (cfg.fields[field]) refs[field] = await api("/admin/" + target);
    }
    const LONG = ["body", "description", "rules", "objectives", "summary", "message", "about", "history", "mission", "vision", "bio"];
    const fieldHtml = (name, type) => {
      if (name === "slug") return "";
      const val = row ? row[name] ?? "" : "";
      if (REF[name]) {
        return `<label>${name}<select name="${name}">${(refs[name] || []).map((o) =>
          `<option value="${o.id}" ${val == o.id ? "selected" : ""}>${esc(o.name || o.title || o.id)}</option>`).join("")}</select></label>`;
      }
      if (LONG.includes(name)) return `<label class="full">${name}<textarea name="${name}">${esc(val)}</textarea></label>`;
      if (name === "role" && entity === "users") {
        return `<label>role<select name="role">${["viewer", "editor", "admin"].map((r) =>
          `<option ${val === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>`;
      }
      if (name === "status") {
        return `<label>status<select name="status">${["proximo", "activo", "finalizado"].map((s) =>
          `<option ${val === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>`;
      }
      if (name === "password") {
        return `<label>password${row ? " (vacío = no cambiar)" : ""}<input name="password" type="password" autocomplete="new-password"></label>`;
      }
      const t = type.startsWith("int") || type === "real" ? "number" : "text";
      return `<label>${name}<input name="${name}" type="${t}" value="${esc(val)}" ${type === "real" ? 'step="0.01"' : ""}></label>`;
    };
    pane.innerHTML = `<div class="top"><h1>${row && !cfg.singleton ? "Editar" : cfg.singleton ? "Editar" : "Nuevo"} · ${LABEL[entity] || entity}</h1></div>
      <form class="panel" id="frm"><div class="form-grid">
        ${Object.entries(cfg.fields).map(([n, t]) => fieldHtml(n, t)).join("")}
      </div>
      <p class="err" id="fErr"></p>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary" type="submit">Guardar</button>
        <button class="btn" type="button" id="cancel">Cancelar</button>
      </div></form>`;
    $("#cancel").onclick = () => cfg.singleton ? overview() : list(entity);
    $("#frm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (entity === "users" && !body.password) delete body.password;
      try {
        if (cfg.singleton) await api(`/admin/${entity}/1`, { method: "PATCH", body });
        else if (row) await api(`/admin/${entity}/${row.id}`, { method: "PATCH", body });
        else await api(`/admin/${entity}`, { method: "POST", body });
        toast("Guardado");
        cfg.singleton ? overview() : list(entity);
      } catch (err) { $("#fErr").textContent = err.message; }
    });
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginErr").textContent = "";
    try {
      me = await api("/auth/login", { method: "POST", body: { email: $("#email").value, password: $("#pass").value } });
      boot();
    } catch (err) { $("#loginErr").textContent = err.message; }
  });

  $("#logout").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    location.reload();
  };

  api("/auth/me").then(boot).catch(() => {});
})();
