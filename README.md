# liontorrent

A lightweight torrent web client for ruTorrent seedboxes.
SolidJS + Vite frontend, Go static/rpc gate server, optional PHP file manager.

## Features

- single-password gate with HMAC cookie sessions (90 days)
- multi-profile seedbox management (sqlite)
- RPC forwarding to ruTorrent
- saveBox credential storage

## Dev

```sh
npm install
LIONTORRENT_BOX=https://seedbox.example.com LIONTORRENT_USER=me LIONTORRENT_PASS=secret npm run dev
```

## Server

```sh
npm run build
cd server && docker build -t tnt -f Dockerfile ..
docker run -p 8420:8420 -v tnt-data:/srv/data -e LIONTORRENT_PASS_HASH=<sha256-hex> tnt
```

## Config

| Var | Use |
| --- | --- |
| LIONTORRENT_BOX | seedbox base url for dev rpc proxy |
| LIONTORRENT_USER / LIONTORRENT_PASS | seedbox basic auth for dev proxy |
| LIONTORRENT_PASS_HASH | sha256 hex of the server gate password |
| STATIC_ROOT | static file dir |
