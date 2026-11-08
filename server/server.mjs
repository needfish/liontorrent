import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto, { createHash, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/* tnt server: static dist + single-password gate + seedbox profiles (sqlite) + rpc forwarding */
const PORT = +(process.env.PORT || 8420);
const ROOT = process.env.STATIC_ROOT || "/srv/dist"; /* built client */
const DATA = process.env.DATA_DIR || "/srv/data";
const PASS_HASH = process.env.LIONTORRENT_PASS_HASH; /* sha256 hex of the one password; unset = open */

fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, "tnt.db"));
db.exec("CREATE TABLE IF NOT EXISTS boxes (id TEXT PRIMARY KEY, name TEXT, url TEXT, user TEXT, pass TEXT)");

const ok = (r, x, ct = "application/json") => { r.writeHead(200, { "Content-Type": ct }); r.end(x); };
const bad = (r, c, m) => { r.writeHead(c, { "Content-Type": "text/plain" }); r.end(m); };

const authed = (req) => {
  if (!PASS_HASH) return true;
  const h = req.headers.authorization || "";
  const [scheme, b64] = h.split(" ");
  if (scheme !== "Basic" || !b64) return false;
  const pass = Buffer.from(b64, "base64").toString().split(":").slice(1).join(":");
  const a = createHash("sha256").update(pass).digest();
  return timingSafeEqual(a, Buffer.from(PASS_HASH, "hex"));
};

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json",
};

const serveStatic = (url, res) => {
  const rel = url.replace(/^\/+/, "") || "index.html";
  let file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return bad(res, 403, "forbidden");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(ROOT, "index.html"); /* SPA routes */
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
};

/* POST /api/rpc/:id forwards the XML-RPC body to that seedbox, injecting its basic auth */
const forward = async (res, id, body) => {
  const box = db.prepare("SELECT url, user, pass FROM boxes WHERE id = ?").get(id);
  if (!box) return bad(res, 404, "unknown seedbox");
  const r = await fetch(box.url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      Authorization: `Basic ${Buffer.from(`${box.user}:${box.pass}`).toString("base64")}`,
    },
    body,
  });
  res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "text/xml" });
  res.end(Buffer.from(await r.arrayBuffer()));
};

http.createServer(async (req, res) => {
  if (!authed(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="tnt"', "Content-Type": "text/plain" });
    return res.end("unauthorized");
  }
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/api\/rpc\/([\w-]+)$/);
  if (req.method === "POST" && m) return forward(res, m[1], Buffer.from(await req.arrayBuffer()));
  if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);
  const rows = () => db.prepare("SELECT id, name, url FROM boxes ORDER BY name").all();
  if (req.method === "GET" && url.pathname === "/api/profiles") return ok(res, JSON.stringify(rows()));
  if (req.method === "DELETE" && url.pathname === "/api/profiles") {
    db.prepare("DELETE FROM boxes WHERE id = ?").run(url.searchParams.get("id"));
    return ok(res, "[]");
  }
  if (req.method === "POST" && url.pathname === "/api/profiles") {
    const p = JSON.parse(await new Promise((ok2, err) => {
      let c = "";
      req.on("data", (d) => (c += d));
      req.on("end", () => { try { ok2(JSON.parse(c)); } catch (e) { err(e); } });
    }));
    const id = p.id || crypto.randomUUID().slice(0, 8);
    db.prepare("INSERT OR REPLACE INTO boxes (id, name, url, user, pass) VALUES (?, ?, ?, ?, ?)")
      .run(id, p.name || "unnamed", p.url, p.user || "", p.pass || "");
    return ok(res, JSON.stringify(rows()));
  }
  bad(res, 404, "not found");
}).listen(PORT, "127.0.0.1", () => console.log(`tnt on :${PORT}`));
