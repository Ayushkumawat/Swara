import "server-only";

/** Tiny leaf module so seed.ts and db.ts can share these without a cycle. */

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
