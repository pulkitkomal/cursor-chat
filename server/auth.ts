import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "cursor_chat_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function configured() {
  return Boolean(process.env.AUTH_USERNAME?.trim() && process.env.AUTH_PASSWORD);
}

function secret() {
  return process.env.AUTH_SECRET?.trim() || process.env.AUTH_PASSWORD || "cursor-chat-dev";
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encodeSession(username: string, expiresAt: number) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: expiresAt })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

function decodeSession(token: string | undefined): { username: string } | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: string;
      exp?: number;
    };
    if (!data.u || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
}

function cookieHeader(value: string, req: Request, clear = false) {
  const secure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  const parts = [
    `${COOKIE}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (clear) {
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Clear both Secure and non-Secure variants so HTTPS proxies cannot leave a stale cookie. */
function clearSessionCookies(req: Request) {
  const base = [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  const insecure = base.join("; ");
  const secure = [...base, "Secure"].join("; ");
  const https =
    req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  return https ? [secure, insecure] : [insecure, secure];
}

export function currentUser(req: Request) {
  return decodeSession(readCookie(req, COOKIE));
}

export function authEnabled() {
  return configured();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!configured()) {
    next();
    return;
  }
  if (
    req.path === "/api/health" ||
    req.path === "/api/login" ||
    req.path === "/api/logout" ||
    req.path === "/api/session"
  ) {
    next();
    return;
  }
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }
  if (currentUser(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
}

export function loginHandler(req: Request, res: Response) {
  if (!configured()) {
    res.json({ ok: true, authRequired: false });
    return;
  }
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const expectedUser = process.env.AUTH_USERNAME!.trim();
  const expectedPass = process.env.AUTH_PASSWORD!;
  if (!safeEqual(username, expectedUser) || !safeEqual(password, expectedPass)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const token = encodeSession(username, Date.now() + MAX_AGE_MS);
  res.setHeader("Set-Cookie", cookieHeader(token, req));
  res.json({ ok: true, username });
}

export function logoutHandler(req: Request, res: Response) {
  res.setHeader("Set-Cookie", clearSessionCookies(req));
  res.json({ ok: true });
}

export function sessionHandler(req: Request, res: Response) {
  if (!configured()) {
    res.json({ ok: true, authRequired: false, username: null });
    return;
  }
  const user = currentUser(req);
  if (!user) {
    // 200 so the client can clear UI state without treating logout races as hard errors.
    res.json({ ok: true, authRequired: true, username: null });
    return;
  }
  res.json({ ok: true, authRequired: true, username: user.username });
}

