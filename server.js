import { createServer } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { getEditHtml } from "./project-storage.js";

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

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    return sendJson(response, 200, {
      name: "youtube-html-editor",
      mcpEndpoint: "/mcp",
    });
  }

  const previewMatch = url.pathname.match(/^\/projects\/([^/]+)\/preview$/);
  if (request.method === "GET" && previewMatch) {
    try {
      const html = await getEditHtml(decodeURIComponent(previewMatch[1]));

      if (html === null) {
        return sendHtml(response, 404, "<!doctype html><title>Chưa có bản edit HTML</title><p>Chưa có bản edit HTML cho project này.</p>");
      }

      return sendHtml(response, 200, html);
    } catch (error) {
      if (error instanceof TypeError || error instanceof URIError) {
        return sendJson(response, 404, { error: "Project not found" });
      }
      console.error("Failed to load project preview:", error);
      return sendJson(response, 500, { error: "Unable to load preview" });
    }
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
