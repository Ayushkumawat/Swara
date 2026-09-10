import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getDb, nowIso, uid } from "./db";
import { hashPassword } from "./seed";

/**
 * Sessions, hand-rolled on purpose.
 *
 * The whole requirement is: password in, cookie out, user row back on every
 * request, logins recorded. That is ~100 lines of scrypt and one table. An
 * auth framework would add OAuth plumbing, adapter interfaces and its own
 * session semantics for a product whose users are ops staff logging in with a
 * work email. Google SSO can be added later as a second way to *create* a
 * session without touching how sessions work.
 *
 * Security posture: scrypt with per-user salt, constant-time compare, and only
 * the SHA-256 of the session token in the database — the cookie holds the only
 * copy of the raw token, so the sessions table is useless to an attacker who
 * can read it.
 */

const COOKIE = "swara_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
};

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function login(
  email: string,
  password: string,
  userAgent?: string,
): Promise<SessionUser | null> {
  const db = getDb();
  const user = db
    .prepare("SELECT * FROM users WHERE email = ? AND status = 'active'")
    .get(email.toLowerCase().trim()) as
    | { id: string; org_id: string; name: string; email: string; role: string; department_id: string | null; password_hash: string | null }
    | undefined;

  // Same failure for "no such user" and "wrong password" — anything else lets
  // a caller enumerate which emails have accounts.
  if (!user?.password_hash || !verifyPassword(password, user.password_hash)) return null;

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).run(tokenHash(token), user.id, nowIso(), expires.toISOString(), userAgent ?? null);
  db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(nowIso(), user.id);
  db.prepare(
    "INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, ?, 'login', ?, ?)",
  ).run(user.org_id, user.id, userAgent ?? "", nowIso());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  return toSessionUser(user);
}

export async function signup(orgName: string, name: string, email: string, password: string) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (existing) return { error: "An account with this email already exists" } as const;

  const orgId = uid("org");
  const now = nowIso();
  db.prepare("INSERT INTO orgs (id, name, plan, created_at) VALUES (?, ?, 'starter', ?)").run(orgId, orgName, now);
  db.prepare(
    `INSERT INTO users (id, org_id, department_id, name, email, password_hash, role, status, last_active_at, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, 'owner', 'active', ?, ?)`,
  ).run(uid("usr"), orgId, name, email.toLowerCase().trim(), hashPassword(password), now, now);

  // Voices, default departments and an empty playbook — so Setup is a form,
  // not a blank page, on the first login.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { provisionWorkspace } = require("./workspace") as typeof import("./workspace");
  provisionWorkspace(orgId);

  return { error: null } as const;
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.org_id, u.name, u.email, u.role, u.department_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .get(tokenHash(token), nowIso()) as
    | { id: string; org_id: string; name: string; email: string; role: string; department_id: string | null }
    | undefined;

  return row ? toSessionUser(row) : null;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    jar.delete(COOKIE);
  }
}

function toSessionUser(row: {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: string;
  department_id: string | null;
}): SessionUser {
  const dept = row.department_id
    ? (getDb().prepare("SELECT name FROM departments WHERE id = ?").get(row.department_id) as
        | { name: string }
        | undefined)
    : undefined;
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    email: row.email,
    role: row.role,
    departmentId: row.department_id,
    departmentName: dept?.name ?? null,
  };
}
