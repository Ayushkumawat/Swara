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

  return createSession(user, "login", userAgent);
}

type UserRow = {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: string;
  department_id: string | null;
};

/**
 * The one place a session is minted. Password login and Google sign-in both
 * end here, which is what keeps "how sessions work" independent of "how the
 * person proved who they are".
 */
async function createSession(user: UserRow, event: "login" | "google_login", userAgent?: string) {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).run(tokenHash(token), user.id, nowIso(), expires.toISOString(), userAgent ?? null);
  db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(nowIso(), user.id);
  db.prepare(
    "INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, ?, ?, ?, ?)",
  ).run(user.org_id, user.id, event, userAgent ?? "", nowIso());

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

/** Creates the org, its owner and the workspace defaults. Password may be
 *  null for Google-only accounts. Returns the new user row. */
function createWorkspace(params: {
  orgName: string;
  name: string;
  email: string;
  passwordHash: string | null;
  googleSub?: string;
  avatarUrl?: string;
}): UserRow {
  const db = getDb();
  const orgId = uid("org");
  const userId = uid("usr");
  const now = nowIso();
  const email = params.email.toLowerCase().trim();
  db.prepare("INSERT INTO orgs (id, name, plan, created_at) VALUES (?, ?, 'starter', ?)").run(orgId, params.orgName, now);
  db.prepare(
    `INSERT INTO users (id, org_id, department_id, name, email, password_hash, google_sub, avatar_url, role, status, last_active_at, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'owner', 'active', ?, ?)`,
  ).run(userId, orgId, params.name, email, params.passwordHash, params.googleSub ?? null, params.avatarUrl ?? null, now, now);

  // Voices, a General department and an empty playbook — so Setup is a form,
  // not a blank page, on the first login.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { provisionWorkspace } = require("./workspace") as typeof import("./workspace");
  provisionWorkspace(orgId);

  return { id: userId, org_id: orgId, name: params.name, email, role: "owner", department_id: null };
}

export async function signup(orgName: string, name: string, email: string, password: string) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (existing) return { error: "An account with this email already exists" } as const;

  createWorkspace({ orgName, name, email, passwordHash: hashPassword(password) });
  return { error: null } as const;
}

/* ── Google ─────────────────────────────────────────────────────────────── */

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
  /** Google Workspace domain, when the account belongs to one. */
  hostedDomain?: string;
};

export type GoogleSignInResult =
  | { user: SessionUser; created: boolean }
  | { error: "unverified_email" | "no_account" | "email_in_use_by_other_google" };

/**
 * Google proved who the person is; decide which account that maps to.
 *
 *  - A user already linked to this Google id → sign them in.
 *  - A user with the same (verified) email → link the Google id, sign in.
 *    This is how an owner who signed up with a password starts using the
 *    Google button without a second account appearing.
 *  - Nobody → in signup mode create a workspace; in login mode say so, and
 *    let the login page send them to signup rather than silently creating an
 *    org they did not ask for.
 */
export async function googleSignIn(
  profile: GoogleProfile,
  mode: "login" | "signup",
  userAgent?: string,
): Promise<GoogleSignInResult> {
  if (!profile.emailVerified) return { error: "unverified_email" };
  const db = getDb();
  const email = profile.email.toLowerCase().trim();

  const bySub = db
    .prepare("SELECT id, org_id, name, email, role, department_id FROM users WHERE google_sub = ? AND status = 'active'")
    .get(profile.sub) as UserRow | undefined;
  if (bySub) {
    if (profile.picture) db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(profile.picture, bySub.id);
    return { user: await createSession(bySub, "google_login", userAgent), created: false };
  }

  const byEmail = db
    .prepare("SELECT id, org_id, name, email, role, department_id, google_sub FROM users WHERE email = ? AND status IN ('active','invited')")
    .get(email) as (UserRow & { google_sub: string | null }) | undefined;
  if (byEmail) {
    if (byEmail.google_sub && byEmail.google_sub !== profile.sub) return { error: "email_in_use_by_other_google" };
    // Invited teammates accept the invite by signing in with the invited
    // address — no password step needed.
    db.prepare("UPDATE users SET google_sub = ?, avatar_url = COALESCE(?, avatar_url), status = 'active' WHERE id = ?")
      .run(profile.sub, profile.picture ?? null, byEmail.id);
    return { user: await createSession(byEmail, "google_login", userAgent), created: false };
  }

  if (mode === "login") return { error: "no_account" };

  const orgName = profile.hostedDomain
    ? profile.hostedDomain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase())
    : `${profile.name.split(" ")[0] || "My"}'s workspace`;
  const user = createWorkspace({
    orgName,
    name: profile.name || email.split("@")[0],
    email,
    passwordHash: null,
    googleSub: profile.sub,
    avatarUrl: profile.picture,
  });
  return { user: await createSession(user, "google_login", userAgent), created: true };
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
