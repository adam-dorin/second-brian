#!/usr/bin/env node
/**
 * Prints MCP setup instructions tailored to this project's location.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const PROJECT_DIR = dirname(fileURLToPath(import.meta.url));
const envPath = join(PROJECT_DIR, ".env").replace(/\\/g, "/");
const mcpPath = join(PROJECT_DIR, "src", "mcp.js").replace(/\\/g, "/");

const desktopConfigPath = join(
  homedir(),
  "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude_desktop_config.json",
).replace(/\\/g, "/");

console.log(`
╔══════════════════════════════════════════════════════════╗
║              Second Brain — MCP Setup Instructions       ║
╚══════════════════════════════════════════════════════════╝

── Claude Code CLI (user scope) ─────────────────────────────

  claude mcp add -s user brain -- node --env-file="${envPath}" "${mcpPath}"

── Claude Desktop ───────────────────────────────────────────

  File: ${desktopConfigPath}

  Add to mcpServers:

  {
    "mcpServers": {
      "brain": {
        "command": "node",
        "args": [
          "--env-file=${envPath}",
          "${mcpPath}"
        ]
      }
    }
  }

── VSCode Extension ──────────────────────────────────────────

  Same as Claude Code CLI — runs once the entry is in
  ~/.claude/settings.json. Type /mcp in the chat panel to verify.

─────────────────────────────────────────────────────────────
`);
