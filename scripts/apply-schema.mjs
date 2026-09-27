// Applies schema.sql to the live (remote) database, one statement at a time,
// via --command (not --file: that uses Cloudflare's D1 import API, which a
// normal `wrangler login` token may not be allowed to use; and one giant
// command can fail as the schema grows). Every statement is
// CREATE ... IF NOT EXISTS, so this is safe to run any time.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const statements = readFileSync(join(root, 'schema.sql'), 'utf8')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join(' ')
  .split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
let failed = 0;
for (const sql of statements) {
  const name = (sql.match(/TABLE IF NOT EXISTS (\w+)/) || [])[1] || sql.slice(0, 30);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { execSync(`npx wrangler d1 execute homie --remote --command "${sql.replace(/"/g, '\\"')}"`, { cwd: root, stdio: 'ignore' }); break; }
    catch { if (attempt === 3) { console.error(`failed: ${name}`); failed++; } }
  }
}
if (failed) process.exit(1);
console.log(`schema applied (${statements.length} statements)`);
