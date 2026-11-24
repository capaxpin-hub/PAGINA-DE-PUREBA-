const db = require("./db");
const bcrypt = require("bcryptjs");

const slugify = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);

const ENTITIES = {
  tournaments: {
    table: "tournaments", min: "editor", slugFrom: "name",
    fields: { slug: "text", name: "text!", division_id: "int", format: "text", prize: "text",
      rules: "text", status: "text", starts_at: "text", ends_at: "text", slots: "int",
      cover: "text", summary: "text" }
  },
  teams: {
    table: "teams", min: "editor", slugFrom: "name",
    fields: { slug: "text", name: "text!", country: "text", logo: "text", founded: "text", description: "text" }
  },
  players: {
    table: "players", min: "editor",
    fields: { team_id: "int!", nick: "text!", role: "text", country: "text", kd: "real" }
  },
  standings: {
    table: "standings", min: "editor",
    fields: { tournament_id: "int!", team_id: "int!", played: "int", kills: "int", booyahs: "int", points: "int" }
  },
  matches: {
    table: "matches", min: "editor",
    fields: { tournament_id: "int!", round: "int", map: "text", played_at: "text", status: "text" }
  },
  news: {
    table: "news", min: "editor", slugFrom: "title",
    fields: { slug: "text", title: "text!", excerpt: "text", body: "text", tag: "text", cover: "text", published_at: "text" }
  },
  sponsors: {
    table: "sponsors", min: "editor",
    fields: { name: "text!", url: "text", logo: "text", tier: "text", ord: "int" }
  },
  divisions: {
    table: "divisions", min: "admin", slugFrom: "name",
    fields: { slug: "text", name: "text!", claim: "text", description: "text", objectives: "text", color: "text", ord: "int" }
  },
  values_list: { table: "values_list", min: "editor", fields: { title: "text!", body: "text", ord: "int" } },
  areas: { table: "areas", min: "editor", fields: { title: "text!", body: "text", ord: "int" } },
  staff: { table: "staff", min: "editor", fields: { name: "text!", role: "text", area: "text", bio: "text", ord: "int" } },
  site: { table: "site", min: "admin", singleton: true,
    fields: { org_name: "text", tagline: "text", about: "text", history: "text", mission: "text",
      vision: "text", email: "text", phone: "text", address: "text", instagram: "text", x: "text",
      discord: "text", youtube: "text" } },
  users: { table: "users", min: "admin", secret: true, display: ["name", "email", "role"],
    fields: { name: "text!", email: "text!", password: "text", role: "text" } },
  messages: { table: "messages", min: "viewer", fields: { read: "int" },
    display: ["name", "company", "email", "type", "message", "created_at", "read"] }
};

const ROLES = ["viewer", "editor", "admin"];

const coerce = (type, value) => {
  if (value === "" || value === undefined || value === null) return null;
  if (type.startsWith("int")) return parseInt(value, 10) || 0;
  if (type === "real") return parseFloat(value) || 0;
  return String(value).trim().slice(0, 8000);
};

const clean = (row) => {
  if (!row) return row;
  const { pass_hash, ...rest } = row;
  return rest;
};

function cfgOf(entity) {
  const cfg = ENTITIES[entity];
  if (!cfg) throw new Error("Entidad inexistente");
  return cfg;
}

function uniqueSlug(table, base, excludeId) {
  const candidate = slugify(base) || "registro";
  let slug = candidate, n = 1;
  const q = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`);
  while (q.get(slug, excludeId || 0)) slug = `${candidate}-${++n}`;
  return slug;
}

function list(entity, q) {
  const cfg = cfgOf(entity);
  if (cfg.singleton) return [db.prepare(`SELECT * FROM ${cfg.table} WHERE id = 1`).get()];
  const searchable = Object.keys(cfg.fields)
    .filter((f) => cfg.fields[f].startsWith("text") && f !== "password");
  let sql = `SELECT * FROM ${cfg.table}`;
  const params = [];
  if (q && searchable.length) {
    sql += ` WHERE ${searchable.map((f) => `${f} LIKE ?`).join(" OR ")}`;
    searchable.forEach(() => params.push(`%${q}%`));
  }
  sql += ` ORDER BY id DESC LIMIT 300`;
  return db.prepare(sql).all(...params).map(clean);
}

function create(entity, body) {
  const cfg = cfgOf(entity);

  if (cfg.singleton) {
    const cols = Object.keys(cfg.fields).filter((f) => body[f] !== undefined);
    if (cols.length) {
      db.prepare(`UPDATE ${cfg.table} SET ${cols.map((c) => `${c}=?`).join(",")} WHERE id = 1`)
        .run(...cols.map((c) => coerce(cfg.fields[c], body[c])));
    }
    return db.prepare(`SELECT * FROM ${cfg.table} WHERE id = 1`).get();
  }

  const cols = Object.keys(cfg.fields).filter((f) => body[f] !== undefined && f !== "password" && f !== "slug");
  const vals = cols.map((c) => coerce(cfg.fields[c], body[c]));

  if (cfg.slugFrom) {
    cols.push("slug");
    vals.push(uniqueSlug(cfg.table, body.slug || body[cfg.slugFrom]));
  }

  if (entity === "users") {
    const i = cols.indexOf("email");
    if (i >= 0 && vals[i]) vals[i] = String(vals[i]).toLowerCase();
    const r = cols.indexOf("role");
    if (r >= 0 && !ROLES.includes(vals[r])) vals[r] = "viewer";
    if (r < 0) { cols.push("role"); vals.push("viewer"); }
    cols.push("pass_hash");
    vals.push(bcrypt.hashSync(String(body.password || "Cambiar123!"), 10));
  }

  const info = db.prepare(`INSERT INTO ${cfg.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...vals);
  return clean(db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(info.lastInsertRowid));
}

function update(entity, id, body) {
  const cfg = cfgOf(entity);
  if (cfg.singleton) return create(entity, body);

  const cols = Object.keys(cfg.fields).filter((f) => body[f] !== undefined && f !== "password" && f !== "slug");
  const vals = cols.map((c) => coerce(cfg.fields[c], body[c]));

  if (entity === "users") {
    const i = cols.indexOf("email");
    if (i >= 0 && vals[i]) vals[i] = String(vals[i]).toLowerCase();
    const r = cols.indexOf("role");
    if (r >= 0 && !ROLES.includes(vals[r])) vals[r] = "viewer";
    if (body.password) {
      db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(String(body.password), 10), id);
    }
  }

  if (cfg.slugFrom && body.slug !== undefined) {
    const s = slugify(body.slug);
    if (s) { cols.push("slug"); vals.push(uniqueSlug(cfg.table, s, id)); }
  }

  if (cols.length) {
    db.prepare(`UPDATE ${cfg.table} SET ${cols.map((c) => `${c}=?`).join(",")} WHERE id = ?`).run(...vals, id);
  }
  return clean(db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id));
}

function remove(entity, id) {
  const cfg = cfgOf(entity);
  if (cfg.singleton) throw new Error("No se puede borrar este registro");
  db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
  return { ok: true };
}

module.exports = { ENTITIES, list, create, update, remove, slugify };
