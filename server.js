require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const auth = require("./auth");
const crud = require("./crud");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "300kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });
const cookieOpts = { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 7 * 24 * 3600 * 1000 };

/* Limpieza de sesiones vencidas */
const purge = () => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
purge();
setInterval(purge, 3600 * 1000).unref();

/* ---------- API pública ---------- */
const site = () => db.prepare("SELECT * FROM site WHERE id = 1").get();

app.get("/api/site", (req, res) => res.json(site()));

app.get("/api/home", (req, res) => {
  res.json({
    tournaments: db.prepare(`SELECT t.*, d.name AS division FROM tournaments t
      LEFT JOIN divisions d ON d.id = t.division_id ORDER BY t.starts_at DESC LIMIT 4`).all(),
    news: db.prepare("SELECT slug,title,excerpt,tag,cover,published_at FROM news ORDER BY published_at DESC LIMIT 3").all(),
    standings: db.prepare(`SELECT s.*, t.name AS team, t.logo, tr.name AS tournament
      FROM standings s JOIN teams t ON t.id = s.team_id JOIN tournaments tr ON tr.id = s.tournament_id
      WHERE tr.id = (SELECT id FROM tournaments WHERE status = 'activo' ORDER BY starts_at DESC LIMIT 1)
      ORDER BY s.points DESC LIMIT 8`).all(),
    teams: db.prepare("SELECT slug,name,country,logo FROM teams ORDER BY name LIMIT 8").all(),
    sponsors: db.prepare("SELECT * FROM sponsors ORDER BY ord LIMIT 8").all(),
    divisions: db.prepare("SELECT * FROM divisions ORDER BY ord").all()
  });
});

app.get("/api/divisions", (req, res) => res.json(db.prepare("SELECT * FROM divisions ORDER BY ord").all()));

app.get("/api/divisions/:slug", (req, res) => {
  const d = db.prepare("SELECT * FROM divisions WHERE slug = ?").get(req.params.slug);
  if (!d) return res.status(404).json({ error: "División inexistente." });
  res.json({ ...d, tournaments: db.prepare("SELECT * FROM tournaments WHERE division_id = ? ORDER BY starts_at DESC").all(d.id) });
});

app.get("/api/tournaments", (req, res) => {
  res.json(db.prepare(`SELECT t.*, d.name AS division FROM tournaments t
    LEFT JOIN divisions d ON d.id = t.division_id ORDER BY t.starts_at DESC`).all());
});

app.get("/api/tournaments/:slug", (req, res) => {
  const t = db.prepare(`SELECT t.*, d.name AS division, d.slug AS division_slug
    FROM tournaments t LEFT JOIN divisions d ON d.id = t.division_id WHERE t.slug = ?`).get(req.params.slug);
  if (!t) return res.status(404).json({ error: "Competición inexistente." });
  const standings = db.prepare(`SELECT s.*, tm.name AS team, tm.slug AS team_slug, tm.logo, tm.country
    FROM standings s JOIN teams tm ON tm.id = s.team_id WHERE s.tournament_id = ? ORDER BY s.points DESC`).all(t.id);
  const matches = db.prepare("SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, id").all(t.id);
  matches.forEach((m) => {
    m.results = db.prepare(`SELECT r.*, tm.name AS team, tm.logo FROM match_results r
      JOIN teams tm ON tm.id = r.team_id WHERE r.match_id = ? ORDER BY r.placement`).all(m.id);
  });
  res.json({ ...t, standings, matches });
});

app.get("/api/teams", (req, res) => {
  const q = String(req.query.q || "").trim();
  const rows = q
    ? db.prepare("SELECT slug,name,country,logo FROM teams WHERE name LIKE ? ORDER BY name").all(`%${q}%`)
    : db.prepare("SELECT slug,name,country,logo FROM teams ORDER BY name").all();
  res.json(rows);
});

app.get("/api/teams/:slug", (req, res) => {
  const t = db.prepare("SELECT * FROM teams WHERE slug = ?").get(req.params.slug);
  if (!t) return res.status(404).json({ error: "Equipo inexistente." });
  res.json({
    ...t,
    roster: db.prepare("SELECT nick,role,country,kd FROM players WHERE team_id = ? ORDER BY id").all(t.id),
    history: db.prepare(`SELECT s.*, tr.name AS tournament, tr.slug AS tournament_slug
      FROM standings s JOIN tournaments tr ON tr.id = s.tournament_id
      WHERE s.team_id = ? ORDER BY s.id DESC`).all(t.id)
  });
});

app.get("/api/news", (req, res) => {
  res.json(db.prepare("SELECT slug,title,excerpt,tag,cover,published_at FROM news ORDER BY published_at DESC").all());
});

app.get("/api/news/:slug", (req, res) => {
  const n = db.prepare("SELECT * FROM news WHERE slug = ?").get(req.params.slug);
  if (!n) return res.status(404).json({ error: "Publicación inexistente." });
  res.json(n);
});

app.get("/api/sponsors", (req, res) => res.json(db.prepare("SELECT * FROM sponsors ORDER BY ord").all()));
app.get("/api/staff", (req, res) => res.json(db.prepare("SELECT * FROM staff ORDER BY ord").all()));
app.get("/api/areas", (req, res) => res.json(db.prepare("SELECT * FROM areas ORDER BY ord").all()));
app.get("/api/values", (req, res) => res.json(db.prepare("SELECT * FROM values_list ORDER BY ord").all()));

app.post("/api/contact", rateLimit({ windowMs: 10 * 60 * 1000, max: 12 }), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  const email = String(b.email || "").trim().slice(0, 120);
  const message = String(b.message || "").trim().slice(0, 3000);
  if (name.length < 2) return res.status(400).json({ error: "Indicá tu nombre." });
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return res.status(400).json({ error: "Correo inválido." });
  if (message.length < 15) return res.status(400).json({ error: "Contanos un poco más." });
  db.prepare("INSERT INTO messages (name,company,email,type,message) VALUES (?,?,?,?,?)")
    .run(name, String(b.company || "").slice(0, 80), email, String(b.type || "general").slice(0, 40), message);
  res.status(201).json({ ok: true });
});

/* ---------- AUTH ---------- */
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const user = await auth.login(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: "Credenciales incorrectas." });
  res.cookie("nt_session", auth.createSession(user.id), cookieOpts);
  res.json({ id: user.id, name: user.name, role: user.role });
});

app.post("/api/auth/logout", (req, res) => {
  if (req.cookies.nt_session) auth.destroySession(req.cookies.nt_session);
  res.clearCookie("nt_session");
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return res.status(401).json({ error: "Sin sesión." });
  res.json(u);
});

/* ---------- ADMIN ---------- */
const RANK = { viewer: 1, editor: 2, admin: 3 };

/* Exige el rol mínimo que declara cada entidad (y al menos `floor`). */
const guard = (floor) => (req, res, next) => {
  const cfg = crud.ENTITIES[req.params.entity];
  if (!cfg) return res.status(404).json({ error: "Entidad inexistente." });
  const need = RANK[cfg.min] > RANK[floor] ? cfg.min : floor;
  return auth.requireRole(need)(req, res, next);
};

const fail = (res, e) => {
  console.error("[admin]", e.message);
  const m = String(e.message);
  if (/UNIQUE/i.test(m)) return res.status(409).json({ error: "Ya existe un registro con ese valor único." });
  if (/NOT NULL|FOREIGN KEY|CHECK/i.test(m)) return res.status(400).json({ error: "Datos incompletos o inválidos." });
  res.status(400).json({ error: "No se pudo completar la operación." });
};

app.get("/api/admin/overview", auth.requireRole("viewer"), (req, res) => {
  const c = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  res.json({
    tournaments: c("tournaments"), teams: c("teams"), players: c("players"),
    news: c("news"), sponsors: c("sponsors"), messages: db.prepare("SELECT COUNT(*) n FROM messages WHERE read = 0").get().n
  });
});

app.get("/api/admin/meta/schema", auth.requireRole("viewer"), (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(crud.ENTITIES)) {
    out[k] = { fields: v.fields, min: v.min, singleton: !!v.singleton, display: v.display || null };
  }
  res.json(out);
});

app.get("/api/admin/:entity", guard("viewer"), (req, res) => {
  try { res.json(crud.list(req.params.entity, req.query.q)); }
  catch (e) { fail(res, e); }
});

app.post("/api/admin/:entity", guard("editor"), (req, res) => {
  try { res.status(201).json(crud.create(req.params.entity, req.body || {})); }
  catch (e) { fail(res, e); }
});

app.patch("/api/admin/:entity/:id", guard("editor"), (req, res) => {
  try { res.json(crud.update(req.params.entity, +req.params.id, req.body || {})); }
  catch (e) { fail(res, e); }
});

app.delete("/api/admin/:entity/:id", guard("admin"), (req, res) => {
  try { res.json(crud.remove(req.params.entity, +req.params.id)); }
  catch (e) { fail(res, e); }
});

app.all("/api/*", (req, res) => res.status(404).json({ error: "Ruta inexistente." }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.listen(PORT, () => console.log(`NATIONAL TOURNAMENTS en http://localhost:${PORT}`));
