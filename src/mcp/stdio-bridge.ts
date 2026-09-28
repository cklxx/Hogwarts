/**
 * stdio <-> HTTP bridge for MCP clients that only speak stdio.
 *   HOGWARTS_URL=http://localhost:7777/mcp HOGWARTS_TOKEN=... npx tsx src/mcp/stdio-bridge.ts
 * It forwards tools/list and tools/call (and resources) to the game server unchanged.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const url = new URL(process.env.HOGWARTS_URL ?? 'http://localhost:7777/mcp');
const token = process.env.HOGWARTS_TOKEN;

const upstream = new Client({ name: 'hogwarts-stdio-bridge', version: '0.1.0' });
await upstream.connect(new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined));

const server = new Server({ name: 'hogwarts', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} }, instructions: upstream.getInstructions() });
server.setRequestHandler(ListToolsRequestSchema, (req) => upstream.listTools(req.params));
server.setRequestHandler(CallToolRequestSchema, (req) => upstream.callTool(req.params));
server.setRequestHandler(ListResourcesRequestSchema, (req) => upstream.listResources(req.params));
server.setRequestHandler(ReadResourceRequestSchema, (req) => upstream.readResource(req.params));
await server.connect(new StdioServerTransport());
