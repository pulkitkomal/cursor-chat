import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOST = process.env.TUNNEL_HOST || "brief.k4mik4ge.xyz";
const PREVIOUS_HOST = process.env.TUNNEL_PREVIOUS_HOST || "cursor-chat.k4mik4ge.xyz";
const SERVICE = process.env.TUNNEL_ORIGIN || "http://127.0.0.1:3847";
const ZONE_NAME = process.env.TUNNEL_ZONE || "k4mik4ge.xyz";

function readEnvFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function env(name) {
  if (process.env[name]) return process.env[name].trim();
  const files = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../mental-health-coach/.env"),
  ];
  for (const file of files) {
    const line = readEnvFile(file)
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${name}=`));
    if (line) {
      return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

const token = env("CLOUDFLARE_API_TOKEN");
if (!token) {
  console.error("Missing CLOUDFLARE_API_TOKEN");
  process.exit(1);
}

async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(`${init.method || "GET"} ${path} failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result;
}

const accounts = await cf("/accounts");
const account = accounts.find((item) => item.name) ?? accounts[0];
if (!account) throw new Error("No Cloudflare account on this token");

const tunnels = await cf(`/accounts/${account.id}/cfd_tunnel?is_deleted=false`);
let chosen = null;
let config = null;
for (const tunnel of tunnels) {
  const current = await cf(`/accounts/${account.id}/cfd_tunnel/${tunnel.id}/configurations`);
  const ingress = current?.config?.ingress ?? [];
  if (ingress.some((rule) => rule.hostname?.endsWith(`.${ZONE_NAME}`))) {
    chosen = tunnel;
    config = current;
    break;
  }
}
if (!chosen || !config) throw new Error(`Could not find an existing ${ZONE_NAME} tunnel`);

const ingress = [...(config.config?.ingress ?? [])].filter(
  (rule) => rule.hostname !== PREVIOUS_HOST || PREVIOUS_HOST === HOST,
);
const existing = ingress.findIndex((rule) => rule.hostname === HOST);
const rule = { hostname: HOST, service: SERVICE };
if (existing >= 0) {
  ingress[existing] = rule;
} else {
  const catchAll = ingress.findIndex((entry) => !entry.hostname);
  if (catchAll === -1) ingress.push(rule, { service: "http_status:404" });
  else ingress.splice(catchAll, 0, rule);
}

await cf(`/accounts/${account.id}/cfd_tunnel/${chosen.id}/configurations`, {
  method: "PUT",
  body: JSON.stringify({ config: { ...config.config, ingress } }),
});

const zones = await cf(`/zones?name=${ZONE_NAME}`);
const zone = zones[0];
if (!zone) throw new Error(`Zone ${ZONE_NAME} not found`);

const target = `${chosen.id}.cfargotunnel.com`;
const payload = { type: "CNAME", name: HOST, content: target, proxied: true };
const records = await cf(`/zones/${zone.id}/dns_records?type=CNAME&name=${HOST}`);
if (records[0]) {
  if (records[0].content !== target || !records[0].proxied) {
    await cf(`/zones/${zone.id}/dns_records/${records[0].id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }
} else {
  await cf(`/zones/${zone.id}/dns_records`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

if (PREVIOUS_HOST && PREVIOUS_HOST !== HOST) {
  const stale = await cf(`/zones/${zone.id}/dns_records?type=CNAME&name=${PREVIOUS_HOST}`);
  for (const record of stale) {
    await cf(`/zones/${zone.id}/dns_records/${record.id}`, { method: "DELETE" });
  }
}

const hostnames = (ingress ?? [])
  .filter((rule) => rule.hostname)
  .map((rule) => `${rule.hostname} → ${rule.service}`);

console.log(`Ready: https://${HOST} → ${SERVICE}`);
console.log(`Tunnel: ${chosen.name}`);
console.log(hostnames.join("\n"));
