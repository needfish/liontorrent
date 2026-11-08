/* Minimal XML-RPC client for rTorrent via ruTorrent's rpc.php proxy.
 * Local dev posts to /rpc (proxied in vite.config.mjs).
 * Deployed on the seedbox it is same-origin, so the browser's saved
 * basic-auth credentials attach automatically. */
let url = import.meta.env.DEV ? "/rpc" : "/user-kitan/rutorrent/plugins/rpc/rpc.php";
export const setEndpoint = (u) => { if (u) url = u; };

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

/* Params are strings by default; {base64: ...} or {i4: ...} request that type. */
const param = (v) => typeof v === "object"
  ? `<${Object.keys(v)[0]}>${esc(Object.values(v)[0])}</${Object.keys(v)[0]}>`
  : `<string>${esc(v)}</string>`;

const value2js = (v) => {
  const c = v.children[0];
  if (!c) return v.textContent;
  switch (c.nodeName) {
    case "array": return [...c.children[0].children].map(value2js);
    case "struct": return Object.fromEntries(
      [...c.children[0].children].map((m) => [m.children[0].textContent, value2js(m.children[1])]));
    case "i4": case "int": case "i8": case "double": return +c.textContent;
    case "boolean": return c.textContent === "1";
    default: return c.textContent;
  }
};

export const rpc = async (method, ...args) => {
  const body = `<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>${method}</methodName><params>${args
    .map((a) => `<param><value>${param(a)}</value></param>`).join("")}</params></methodCall>`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    credentials: "include",
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  if (xml.querySelector("fault")) {
    const fields = [...xml.querySelectorAll("fault > value struct member")];
    const faultCode = fields[0].textContent;
    const faultString = fields[1].textContent;
    throw new Error(`${faultCode}: ${faultString}`);
  }
  return value2js(xml.querySelector("params > param > value"));
};
