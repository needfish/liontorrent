import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup, ErrorBoundary } from "solid-js";
import {
  Window, Sidebar, SidebarItem, SectionLabel, Toolbar, Btn, Field, Select, Bar, Badge,
  StatusBar, Table, Confirm, Toasts, Dialog, Upload, Toggle, Tabs, Menu, Text,
  toast,
} from "@sealion/ui";
import { rpc } from "./rpc";

/* d.* fields polled for the list. Order matches the row mapping below.
 * The cat="$t.multicall=..." forms inline per-torrent tracker/scrape data
 * so the list poll needs no extra requests (same trick as Flood). */
const FIELD_NAMES = [
  "hash", "name", "state", "complete", "size", "done", "down", "up",
  "downTotal", "upTotal", "ratio", "label", "priority",
  "created", "message", "path", "seedsConn", "peers", "tags", "trackers", "seeds", "leech",
];
const FIELDS = [
  "d.hash=", "d.name=", "d.state=", "d.complete=",
  "d.size_bytes=", "d.completed_bytes=", "d.down.rate=", "d.up.rate=",
  "d.down.total=", "d.up.total=", "d.ratio=",
  "d.custom1=", "d.priority=", "d.creation_date=",
  "d.message=", "d.base_path=", "d.peers_complete=", "d.peers_accounted=",
  "d.custom1=", 'cat="$t.multicall=d.hash=,t.is_enabled=,t.url=,cat={|||}"',
  'cat="$t.multicall=d.hash=,t.scrape_complete=,cat={|||}"',
  'cat="$t.multicall=d.hash=,t.scrape_incomplete=,cat={|||}"',
];

const domain = (u) => { try { return new URL(u).hostname; } catch { return u; } };
const decodeRow = (r) => {
  const t = Object.fromEntries(FIELD_NAMES.map((n, i) => [n, r[i]]));
  t.tags = (t.tags || "").split(",").filter(Boolean).map(decodeURIComponent);
  t.trackers = (t.trackers || "").split("|||").filter((s) => s && !s.startsWith("0:"))
    .map((s) => domain(s.slice(2)));
  t.seeds = +String(t.seeds).split("|||")[0] || 0;
  t.leech = +String(t.leech).split("|||")[0] || 0;
  return t;
};

const state = (t) =>
  t.message ? "error" :
  t.state ? (t.complete ? "seeding" : "downloading") : (t.complete ? "done" : "stopped");
const active = (t) => state(t) !== "stopped" && state(t) !== "done" && (t.down || t.up);

const fmt = (n) =>
  n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} GiB` :
  n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MiB` :
  `${(n / 2 ** 10).toFixed(0)} KiB`;
const speed = (n) => (n ? `${fmt(n)}/s` : "—");
const eta = (t) => (t.down <= 0 || t.done >= t.size) ? "∞"
  : `${Math.floor(t.eta / 3600) ? `${Math.floor(t.eta / 3600)}h ` : ""}${Math.round((t.eta % 3600) / 60)}m`;
const prio = ["Ignore", "Low", "Normal", "High"];
const tone = { downloading: "info", seeding: "info", done: "good", stopped: "", error: "bad" };

const filters = [
  { key: "all", name: "All", match: () => true },
  { key: "downloading", name: "Downloading", match: (t) => state(t) === "downloading" },
  { key: "seeding", name: "Completed", match: (t) => !!t.complete },
  { key: "active", name: "Active", match: (t) => !!active(t) },
  { key: "inactive", name: "Inactive", match: (t) => t.state && !t.down && !t.up },
  { key: "error", name: "Error", match: (t) => state(t) === "error" },
];

const sorters = {
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => b.size - a.size,
  done: (a, b) => (b.done / b.size) - (a.done / a.size),
  uploaded: (a, b) => b.upTotal - a.upTotal,
  ratio: (a, b) => b.ratio - a.ratio,
  down: (a, b) => b.down - a.down,
  up: (a, b) => b.up - a.up,
  priority: (a, b) => b.priority - a.priority,
};

const columns = [
  { key: "name", width: "1fr", header: "Name" },
  { key: "state", width: "85px", header: "Status", render: (t) => <Badge tone={tone[state(t)]}>{state(t)}</Badge> },
  { key: "size", width: "75px", header: "Size", className: "size", render: (t) => fmt(t.size) },
  { key: "done", width: "90px", header: "Done", render: (t) =>
    <Bar percent={t.size ? (t.done / t.size) * 100 : 0} hue={t.complete ? "green" : "blue"} /> },
  { key: "downTotal", width: "85px", header: "Downloaded", className: "size", render: (t) => fmt(t.downTotal) },
  { key: "upTotal", width: "85px", header: "Uploaded", className: "size", render: (t) => fmt(t.upTotal) },
  { key: "ratio", width: "60px", header: "Ratio", className: "size", render: (t) => (t.ratio / 1000).toFixed(3) },
  { key: "down", width: "80px", header: "DL", className: "size", render: (t) => speed(t.down) },
  { key: "up", width: "80px", header: "UL", className: "size", render: (t) => speed(t.up) },
  { key: "eta", width: "60px", header: "ETA", className: "size", render: (t) =>
    eta({ ...t, eta: Math.floor((t.size - t.done) / Math.max(t.down, 1)) }) },
  { key: "label", width: "80px", header: "Tags", render: (t) => t.tags.join(", ") },
  { key: "seeds", width: "62px", header: "Seeds", className: "size", render: (t) => `${t.seedsConn} (${t.seeds})` },
  { key: "leech", width: "62px", header: "Leech", className: "size", render: (t) => `${t.peers} (${t.leech})` },
  { key: "priority", width: "60px", header: "Priority", className: "size", render: (t) => prio[t.priority] ?? t.priority },
  { key: "created", width: "75px", header: "Created", className: "date", render: (t) =>
    new Date(t.created * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) },
];

/* Flood-style batched calls: one XML-RPC call per hash, in order. */
const batch = async (methods, hashes) => {
  for (const h of hashes) for (const m of methods) await rpc(m, h);
};

const Detail = (props) => {
  const [tab, setTab] = createSignal("overview");
  const [files, setFiles] = createSignal([]);
  const [trackers, setTrackers] = createSignal([]);
  createEffect(() => {
    const h = props.t?.hash;
    if (!h || tab() === "overview") return;
    (tab() === "files"
      ? rpc("f.multicall", h, "", "f.path=", "f.size_bytes=", "f.completed_chunks=", "f.size_chunks=")
        .then((r) => setFiles(r.map(([path, size, done, total]) => ({ path, size, pct: total ? (done / total) * 100 : 0 }))))
      : rpc("t.multicall", h, "", "t.url=", "t.is_enabled=", "t.group=")
        .then((r) => setTrackers(r.map(([url, on, group]) => ({ url, on, group })))))
      .catch((e) => toast(String(e.message || e), "bad"));
  });
  const t = props.t;
  const stateLine = (text) => <div class="st-line"><Text muted>{text}</Text></div>;
  return (
    <div class="detail">
      <Tabs items={[
        { key: "overview", label: "Overview" }, { key: "files", label: "Files" }, { key: "trackers", label: "Trackers" },
      ]} active={tab()} onSwitch={setTab} />
      <Show when={tab() === "overview"} fallback={
        <Table rowKey="path" data={tab() === "files" ? files() : trackers()} columns={
          tab() === "files" ? [
            { key: "path", width: "1fr", header: "Path" },
            { key: "size", width: "80px", header: "Size", className: "size", render: (f) => fmt(f.size) },
            { key: "pct", width: "140px", header: "Progress", render: (f) => <Bar percent={f.pct} hue="blue" /> },
          ] : [
            { key: "url", width: "1fr", header: "Tracker URL" },
            { key: "state", width: "80px", header: "Enabled", render: (r) => (r.on ? "enabled" : "disabled") },
            { key: "group", width: "60px", header: "Group", className: "size" },
          ]} />} >
        <div class="st-block">
          {stateLine(`Save as: ${t.path}`)}
          {stateLine(`Hash: ${t.hash}`)}
          {stateLine(`Downloaded ${fmt(t.downTotal)} · Uploaded ${fmt(t.upTotal)} · Ratio ${(t.ratio / 1000).toFixed(3)}`)}
          {stateLine(`Speed ↓ ${speed(t.down)} ↑ ${speed(t.up)} · Peers connected: ${t.peers} · ETA ${eta({ ...t, eta: Math.floor((t.size - t.done) / Math.max(t.down, 1)) })}`)}
          {stateLine(`Priority: ${prio[t.priority]} · Created: ${new Date(t.created * 1000).toLocaleString()}`)}
          <Show when={t.message}>{stateLine(`Message: ${t.message}`)}</Show>
        </div>
      </Show>
    </div>
  );
};

const TorrentUi = () => {
  const [torrents, setTorrents] = createSignal([]);
  const [filterKey, setFilterKey] = createSignal("all");
  const [label, setLabel] = createSignal(null);
  const [tracker, setTracker] = createSignal(null);
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal("name");
  const [selectedIds, setSelectedIds] = createSignal([]);
  const [at, setAt] = createSignal(null);
  const [addOpen, setAddOpen] = createSignal(false);
  const [addMode, setAddMode] = createSignal("url");
  const [magnet, setMagnet] = createSignal("");
  const [startNow, setStartNow] = createSignal(true);
  const [confirmOpen, setConfirmOpen] = createSignal(false);
const [error, setError] = createSignal("");
  const [page, setPage] = createSignal("torrents");

  const menus = [
    { label: "Torrents", onTopClick: () => setPage("torrents") },
    { label: "Files", onTopClick: () => setPage("files") },
    { label: "ruTorrent ↗", onTopClick: () =>
      window.open("https://le6-3-34virmire.pulsedmedia.com/user-kitan/") },
  ];

  let timer;
  const poll = async () => {
    try {
      const rows = await rpc("d.multicall2", "", "main", ...FIELDS);
      setTorrents(rows.map(decodeRow));
      setError("");
    } catch (e) {
      setError(String(e.message || e).slice(0, 80));
    }
  };
  onMount(() => { poll(); timer = setInterval(poll, 2000); });
  onCleanup(() => clearInterval(timer));

  const labels = createMemo(() => [...new Set(torrents().flatMap((t) => t.tags))]);
  const trackerNames = createMemo(() => [...new Set(torrents().flatMap((t) => t.trackers))]);
  const counts = (key) => torrents().filter(filters.find((f) => f.key === key).match).length;
  const shown = createMemo(() => torrents()
    .filter(filters.find((f) => f.key === filterKey()).match)
    .filter((t) => (label() == null || t.tags.includes(label()) ||
      (label() === "" && !t.tags.length)))
    .filter((t) => (tracker() == null || t.trackers.includes(tracker())))
    .filter((t) => t.name.toLowerCase().includes(query().toLowerCase()))
    .sort(sorters[sort()]));
  const order = () => shown().map((t) => t.hash);
  const isSel = (h) => selectedIds().includes(h);
  const selected = createMemo(() => torrents().find((t) => t.hash === selectedIds()[0]));

  const select = (h, e) => {
    if (e?.shiftKey || e?.metaKey || e?.ctrlKey)
      setSelectedIds(isSel(h) ? selectedIds().filter((x) => x !== h) : [...selectedIds(), h]);
    else setSelectedIds([h]);
  };
  const clear = () => { setSelectedIds([]); setAt(null); };

  const run = async (methods, text) => {
    if (!selectedIds().length) return;
    try {
      await batch(methods, selectedIds());
      toast(`${text} · ${selectedIds().length} torrent(s)`, "good");
    } catch (e) { toast(String(e.message || e), "bad"); }
    poll();
  };

  const addTorrent = async () => {
    setAddOpen(false);
    try {
      await rpc(startNow() ? "load.start" : "load.normal", "", magnet());
      toast("Torrent added", "good");
    } catch (e) { toast(String(e.message || e), "bad"); }
    setMagnet(""); poll();
  };
  const addFile = async ([file]) => {
    setAddOpen(false);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let b64 = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      b64 += btoa(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
    try {
      await rpc(startNow() ? "load.raw_start" : "load.raw", "", { base64: b64 });
      toast(`${file.name} added`, "good");
    } catch (e) { toast(String(e.message || e), "bad"); }
    poll();
  };

  const menuItems = () => [
    { label: "Start", onClick: () => run(["d.open", "d.start"], "Started") },
    { label: "Stop", onClick: () => run(["d.stop", "d.close"], "Stopped") },
    { label: "Check hash", onClick: () => run(["d.check_hash"], "Check queued") },
    { label: "Force reannounce", onClick: () => run(["d.tracker_announce"], "Reannounce sent") },
    { divider: true },
    { label: "Delete", onClick: () => setConfirmOpen(true) },
  ];

  onMount(() => {
    const onClick = (e) => e.target.closest(".fileitem, .menu, .toolbar, .detail") || clear();
    const onKey = (e) => {
      if (e.target.closest("input, textarea, dialog")) return;
      const i = order().findIndex((h) => selectedIds()[0] === h);
      if (e.key === "Escape") return clear();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const next = Math.max(0, Math.min(order().length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        if (next !== i) return select(order()[next]);
      }
      if (e.key === " " && i >= 0) {
        const allRunning = selectedIds().every((h) => torrents().find((t) => t.hash === h)?.state);
        return allRunning ? run(["d.stop", "d.close"], "Stopped") : run(["d.open", "d.start"], "Started");
      }
      if (e.key === "Delete" && i >= 0) return setConfirmOpen(true);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const totals = createMemo(() => {
    const d = torrents().reduce((s, t) => s + t.down, 0);
    const u = torrents().reduce((s, t) => s + t.up, 0);
    return `${shown().length} items · ↓ ${speed(d)} · ↑ ${speed(u)}`;
  });

  return (
    <Window menus={menus}>
      <Show when={page() === "torrents"} fallback={
        <iframe title="File manager"
          src={(import.meta.env.DEV ? "/user-kitan" : "") + "/filemanager.php"}
          style={{ flex: 1, border: "none" }} />}>{/* torrents */}      <Sidebar>
        <SectionLabel>State</SectionLabel>
        <For each={filters}>{(f) => (
          <SidebarItem selected={f.key === filterKey()} count={counts(f.key)}
            onClick={() => { setFilterKey(f.key); setLabel(null); }}>
            {f.name}
          </SidebarItem>
        )}</For>
        <SectionLabel>Tags</SectionLabel>
        <SidebarItem selected={label() == null} count={torrents().length} onClick={() => setLabel(null)}>
          All
        </SidebarItem>
        <For each={labels()}>{(l) => (
          <SidebarItem selected={l === label()} count={torrents().filter((t) => t.tags.includes(l)).length}
            onClick={() => { setTracker(null); setLabel(l); }}>{l}</SidebarItem>
        )}</For>
        <SectionLabel>Trackers</SectionLabel>
        <For each={trackerNames()}>{(s) => (
          <SidebarItem selected={s === tracker()} count={torrents().filter((t) => t.trackers.includes(s)).length}
            onClick={() => { setLabel(null); setTracker(s); }}>{s}</SidebarItem>
        )}</For>
      </Sidebar>

      <main class="content">
        <Toolbar>
          <Btn onClick={() => setAddOpen(true)}>Add</Btn>
          <Show when={selectedIds().length}>
            <Btn onClick={() => run(["d.open", "d.start"], "Started")}>Start</Btn>
            <Btn onClick={() => run(["d.pause"], "Paused")}>Pause</Btn>
            <Menu label="More" items={menuItems()} />
            <Btn danger onClick={() => setConfirmOpen(true)}>Delete</Btn>
          </Show>
          <Field type="search" placeholder="Search" value={query()} onInput={setQuery} />
          <div style={{ "margin-left": "auto" }}>
            <Select value={sort()} onChange={setSort} options={[
              { value: "name", label: "Sort: Name" },
              { value: "size", label: "Sort: Size" },
              { value: "done", label: "Sort: Progress" },
              { value: "uploaded", label: "Sort: Uploaded" },
              { value: "ratio", label: "Sort: Ratio" },
              { value: "down", label: "Sort: Down speed" },
              { value: "up", label: "Sort: Up speed" },
              { value: "priority", label: "Sort: Priority" },
            ]} />
          </div>
        </Toolbar>

        <div class="list torrent" style={{ "max-height": selected() ? "45%" : "none" }}>
          <Table columns={columns} data={shown()} rowKey="hash" selectedKeys={selectedIds()}
            onSelect={(t, e) => select(t.hash, e)}
            onContextMenu={(t, e) => { e.preventDefault(); select(t.hash, e); setAt({ x: e.clientX, y: e.clientY }); }}
            empty={<div class="empty"><div>{shown().length ? "No torrents" : "Add a torrent to begin"}</div></div>} />
        </div>

        <Show when={selected() && selectedIds().length === 1}><Detail t={selected()} /></Show>

        <Show when={at()}>
          <div class="menu fixed" style={{ left: `${at().x}px`, top: `${at().y}px` }}>
            <For each={menuItems()}>{(item) => item.divider
              ? <div class="divider" /> :
              <div class="menu-item" onClick={() => { clear(); item.onClick(); }}>{item.label}</div>}
            </For>
          </div>
        </Show>

        <StatusBar>{totals()}</StatusBar>
      </main>
      </Show>

      <Dialog open={addOpen()} onClose={() => setAddOpen(false)} title="Add Torrent">
        <Tabs items={[{ key: "url", label: "Magnet / URL" }, { key: "file", label: ".torrent file" }]}
          active={addMode()} onSwitch={setAddMode} />
        <Show when={addMode() === "url"} fallback={<Upload onFiles={addFile} />}>
          <Field placeholder="magnet:?xt=..." value={magnet()} onInput={setMagnet} onEnter={addTorrent} />
        </Show>
        <div class="actions">
          <Toggle checked={startNow()} onChange={setStartNow} label="Start after add" />
          <Btn onClick={() => setAddOpen(false)}>Cancel</Btn>
          <Btn disabled={!magnet()} onClick={addTorrent}>Add</Btn>
        </div>
      </Dialog>

      <Confirm open={confirmOpen()} message="Remove selected torrent(s) from rTorrent? Files stay on disk."
        confirmLabel="Delete"
        onConfirm={() => { setConfirmOpen(false); run(["d.erase"], "Deleted"); setSelectedIds([]); }}
        onCancel={() => setConfirmOpen(false)} />
      <Toasts />
      {error() && <div class="alert bad">{error()}</div>}
    </Window>
  );
};

export default (props) => (
  <ErrorBoundary fallback={(e) => <div class="alert bad">{String(e.message)}</div>}>
    <TorrentUi {...props} />
  </ErrorBoundary>
);
