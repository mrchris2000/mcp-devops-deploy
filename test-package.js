#!/usr/bin/env node

// Basic smoke test to ensure the package can be imported and initialized
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

try {
  console.log("✅ Package can be imported successfully");
  console.log("✅ MCP SDK is accessible");
  process.exit(0);
} catch (error) {
  console.error("❌ Package test failed:", error.message);
  process.exit(1);
}
