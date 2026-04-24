#!/usr/bin/env node
import { copyFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const now = new Date();
const day = String(now.getDate()).padStart(2, "0");
const month = String(now.getMonth() + 1).padStart(2, "0");
const year = now.getFullYear();
const backupDir = join(root, ".backup", `${day}-${month}-${year}`);

mkdirSync(backupDir, { recursive: true });

const sqliteFiles = readdirSync(root).filter((f) => f.endsWith(".sqlite"));

if (sqliteFiles.length === 0) {
  console.error("No .sqlite files found in project root.");
  process.exit(1);
}

for (const file of sqliteFiles) {
  const src = join(root, file);
  copyFileSync(src, join(backupDir, file));

  for (const ext of [".sqlite-wal", ".sqlite-shm"]) {
    const companion = join(root, basename(file, ".sqlite") + ext);
    if (existsSync(companion)) {
      copyFileSync(companion, join(backupDir, basename(companion)));
    }
  }

  console.log(`Backed up: ${file}`);
}

console.log(`Destination: ${backupDir}`);
