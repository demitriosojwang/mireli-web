import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Container build: `prisma generate` + `next build --webpack`.
 *
 * Identical to `npm run build`, except the Prisma client is generated from a
 * copy of the schema that also declares the Linux engine Prisma ships in the
 * image (Debian / OpenSSL 3). Without it the generator falls back to a legacy
 * engine name and the server cannot reach PostgreSQL at runtime. The
 * developer's own prisma/schema.prisma is left untouched, so local preview and
 * Vercel builds keep their existing behaviour.
 */
const root = process.cwd();
const source = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const patched = source.replace(
  /generator client \{/,
  'generator client {\n  binaryTargets = ["native", "debian-openssl-3.0.x"]',
);
if (patched === source) {
  throw new Error("generator client block was not found in prisma/schema.prisma");
}
const directory = join(root, ".docker-build");
mkdirSync(directory, { recursive: true });
const schemaPath = join(directory, "schema.prisma");
writeFileSync(schemaPath, patched);

const commands = [
  ["node_modules/prisma/build/index.js", ["generate", "--schema", schemaPath]],
  ["node_modules/next/dist/bin/next", ["build", "--webpack"]],
];
for (const [command, args] of commands) {
  const result = spawnSync(process.execPath, [join(root, command), ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
