#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, projectFromArgs } from '../src/server.js';

try {
  const server = createServer(projectFromArgs(process.argv.slice(2)));
  await server.connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`unity-agent-kit-mcp: ${error.message}\n`);
  process.exitCode = 1;
}
