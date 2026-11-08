package main

/* tnt server: static dist + single-password gate + seedbox profiles (sqlite) + rpc forwarding */

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

/* sha256 hex of the one password; unset = open (dev) */
var passHash = os.Getenv("LIONTORRENT_PASS_HASH")
var staticRoot = os.Getenv("STATIC_ROOT")

func authed(r *http.Request) bool {
	if passHash == "" {
		return true
	}
	scheme, b64, cut := strings.Cut(r.Header.Get("Authorization"), " ")
	if scheme != "Basic" || !cut {
		return false
	}
	userpass, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return false
	}
	_, pass, _ := strings.Cut(string(userpass), ":")
	sum := sha256.Sum256([]byte(pass))
	want, err := hex.DecodeString(passHash)
	if err != nil {
		return false
	}
	return len(want) == len(sum) && subtle.ConstantTimeCompare(want, sum[:]) == 1
}

type boxRow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

var db *sql.DB

func listBoxes() []boxRow {
	rows, err := db.Query("SELECT id, name, url FROM boxes ORDER BY name")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []boxRow
	for rows.Next() {
		var b boxRow
		_ = rows.Scan(&b.ID, &b.Name, &b.URL)
		out = append(out, b)
	}
	return out
}

func boxesJSON(w http.ResponseWriter) {
	if w == nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(mustJSON(listBoxes()))
}

func saveBox(w http.ResponseWriter, r *http.Request) {
	in := map[string]string{}
	_ = json.NewDecoder(r.Body).Decode(&in)
	id := in["id"]
	if id == "" {
		id = randID()
	}
	_, err := db.Exec("INSERT OR REPLACE INTO boxes (id, name, url, user, pass) VALUES (?, ?, ?, ?, ?)",
		id, in["name"], in["url"], in["user"], in["pass"])
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	boxesJSON(w)
}

func deleteBox(w http.ResponseWriter, id string) {
	_, _ = db.Exec("DELETE FROM boxes WHERE id = ?", id)
	boxesJSON(w)
}

func forward(w http.ResponseWriter, r *http.Request, id string) {
	var url, user, pass string
	err := db.QueryRow("SELECT url, user, pass FROM boxes WHERE id = ?", id).Scan(&url, &user, &pass)
	if err != nil {
		http.Error(w, "unknown seedbox", 404)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	req.Header.Set("Content-Type", "text/xml")
	req.SetBasicAuth(user, pass)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

/* static: served from STATIC_ROOT on disk; SPA fallback */

func root(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" || name == "api" {
		name = "index.html"
	}
	if strings.HasPrefix(name, "api/") {
		api(w, r)
		return
	}
	clean := path.Clean("/" + name)
	if data, err := os.ReadFile(path.Join(staticRoot, clean)); err == nil {
		w.Header().Set("Content-Type", mime(path.Ext(clean)))
		_, _ = w.Write(data)
		return
	}
	data, err := os.ReadFile(path.Join(staticRoot, "index.html"))
	if err != nil {
		http.Error(w, "no dist available: build the client first", 500)
		return
	}
	w.WriteHeader(200)
	_, _ = w.Write(data)
}

func mime(ext string) string {
	switch ext {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css"
	case ".js", ".mjs":
		return "text/javascript"
	case ".svg":
		return "image/svg+xml"
	case ".woff2":
		return "font/woff2"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".json":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}

func api(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/")
	switch {
	case strings.HasPrefix(rest, "rpc/"):
		forward(w, r, strings.TrimPrefix(rest, "rpc/"))
	case rest == "profiles" && r.Method == http.MethodGet:
		boxesJSON(w)
	case rest == "profiles" && r.Method == http.MethodPost:
		saveBox(w, r)
	case rest == "profiles" && r.Method == http.MethodDelete:
		deleteBox(w, r.URL.Query().Get("id"))
	default:
		http.Error(w, "not found", 404)
	}
}

func randID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func mustJSON(v []boxRow) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("[]")
	}
	return b
}

func authed2(next http.Handler) http.Handler {
	x := func(w http.ResponseWriter, r *http.Request) {
		if !authed(r) {
			w.Header().Set("WWW-Authenticate", `Basic realm="tnt"`)
			http.Error(w, "unauthorized", 401)
			return
		}
		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(x)
}

func main() {
	if staticRoot == "" {
		staticRoot = "/srv/dist"
	}
	sq := os.Getenv("TNT_DB")
	if sq == "" {
		sq = "/srv/data/tnt.db"
	}
	d, err := sql.Open("sqlite", sq)
	if err != nil {
		log.Fatal(err)
	}
	db = d
	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS boxes (id TEXT PRIMARY KEY, name TEXT, url TEXT, user TEXT, pass TEXT)"); err != nil {
		log.Fatal(err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8420"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", root)
	mux.HandleFunc("/api/", root)
	log.Println("tnt on :", port)
	host := os.Getenv("LISTEN_HOST")
	if host == "" {
		host = "0.0.0.0" /* container loopback is enforced by the docker -p 127.0.0.1 mapping */
	}
	log.Fatal(http.ListenAndServe(host+":"+port, authed2(mux)))
}
