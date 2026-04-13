#!/usr/bin/env node
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const src = process.env.BRAIN_DB_PATH ?? join(root, "brain.sqlite");
const backupDir = join(root, ".backup");

if (!existsSync(src)) {
  console.error(`Database not found: ${src}`);
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = join(backupDir, `brain-${timestamp}.sqlite`);

copyFileSync(src, dest);
console.log(`Backed up to ${dest}`);
