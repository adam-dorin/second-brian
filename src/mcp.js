import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "./db.js";
import { startEmbedWorker } from "./embed.js";
import { registerTools } from "./tools.js";

const db = getDb();
startEmbedWorker(db);

const server = new McpServer({ name: "brain", version: "1.0.0" });
registerTools(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
