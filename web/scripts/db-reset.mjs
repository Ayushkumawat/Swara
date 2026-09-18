#!/usr/bin/env node
/**
 * Wipe the SQLite file (and its WAL/SHM sidecars). The next request to the
 * app recreates the schema at the current version and seeds the demo
 * workspace — see src/lib/server/db.ts. Stop `next dev` first: an open
 * connection keeps writing to the deleted inode and you get a ghost database.
 *
 *   npm run db:reset
 *   SWARA_DB_DIR=/somewhere npm run db:reset
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const dir = process.env.SWARA_DB_DIR ?? path.join(process.cwd(), "data");
let removed = 0;
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const file = path.join(dir, `swara.db${suffix}`);
  if (existsSync(file)) {
    rmSync(file, { force: true });
    removed += 1;
    console.log(`removed ${path.relative(process.cwd(), file)}`);
  }
}
console.log(removed ? "Database reset. Start the app to re-seed the demo workspace." : `Nothing to remove in ${dir}.`);
