import { createServer } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);

function createMcpServer() {
  return new McpServer({
    name: "youtube-html-editor",
    version: "0.1.0",
  });
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body.length === 0 ? undefined : JSON.parse(body);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    return sendJson(response, 200, {
      name: "youtube-html-editor",
      mcpEndpoint: "/mcp",
    });
  }

  if (url.pathname !== "/mcp") {
    return sendJson(response, 404, { error: "Not found" });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  }

  try {
    const body = await readJsonBody(request);
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    await server.connect(transport);
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  } catch (error) {
    console.error("Failed to handle MCP request:", error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`YouTube HTML Editor MCP server listening on http://localhost:${PORT}`);
});

export { httpServer };
