/* Minimal XML-RPC client. Dev posts to /rpc (vite proxy); deployed, transit goes
 * through tnt: /api/rpc/<active profile id>, which forwards with the profile's
 * upstream basic auth. The active profile id lives in localStorage. */
const url = () => import.meta.env.DEV
  ? "/rpc"
  : `/api/rpc/${localStorage.getItem("activeId")}`;

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
  const res = await fetch(url(), {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    credentials: "include",
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  if (xml.querySelector("fault")) {
    const fields = [...xml.querySelectorAll("fault > value struct member")];
    throw new Error(`${fields[0].textContent}: ${fields[1].textContent}`);
  }
  const value = xml.querySelector("params > param > value");
  if (!value) throw new Error("bad rpc response");
  return value2js(value);
};
