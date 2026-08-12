import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import {
  createProject,
  getEditHtml,
  getProject,
  listProjects,
  saveEditHtml,
  saveProject,
} from "./project-storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const MAX_HTML_BYTES = 1_000_000;
const APP_RESOURCE_URI = "ui://youtube-html-editor/app.html";
const APP_HTML_PATH = join(__dirname, "public", "app.html");
const EMPTY_WIDGET_PATH = join(__dirname, "public", "editor-widget.html");
const APP_CSP = {
  frameDomains: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
};
const projectSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sourceUrl: z.string().url(),
  status: z.enum(["created", "html_ready"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  previewUrl: z.string().nullable(),
});
const projectsSchema = z.array(projectSchema);
const openAppStateSchema = z.object({
  project: projectSchema.nullable(),
  projects: projectsSchema,
});

function htmlScriptSafeString(value) {
  return JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
}

async function renderAppHtml() {
  const [templateHtml, appBundle] = await Promise.all([
    readFile(APP_HTML_PATH, "utf8"),
    readFile(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8"),
  ]);

  return templateHtml.replace(
    "\"__MCP_APPS_BUNDLE__\"",
    () => htmlScriptSafeString(appBundle),
  );
}

function toolResult(structuredContent, message) {
  return {
    structuredContent,
    content: [{ type: "text", text: message }],
  };
}

function toolError(message) {
  return {
    isError: true,
    structuredContent: { error: message },
    content: [{ type: "text", text: message }],
  };
}

async function buildOpenAppState(projectId) {
  const projects = await listProjects();

  if (!projectId) {
    return {
      project: projects[0] ?? null,
      projects,
    };
  }

  const project = await getProject(projectId);

  if (!project) {
    throw new TypeError(`Project ${projectId} was not found.`);
  }

  return { project, projects };
}

function createMcpServer() {
  const server = new McpServer({
    name: "youtube-html-editor",
    version: "0.1.0",
    instructions: [
      "When the user provides a YouTube URL, analyze the video yourself in the ChatGPT conversation.",
      "This MCP server only stores projects and HTML. It does not download, scrape, or analyze YouTube videos.",
      "When the user asks for an edit in HTML, create one complete self-contained responsive HTML document, including all required CSS and JavaScript.",
      "The HTML is an edit mockup or plan, not a rendered MP4 video. It may show a 9:16 video frame, captions, shot list or timeline, effects, and a CTA.",
      "Do not merely paste HTML code into the conversation. You must call save_edit_html with the full document for the correct project_id.",
      "If the project_id is not known, call get_project or list_projects first.",
      "Only tell the user that the edit is ready after save_edit_html succeeds.",
    ].join("\n"),
  });

  registerAppResource(
    server,
    "YouTube HTML Editor App",
    APP_RESOURCE_URI,
    {
      description: "Create a YouTube project and ask ChatGPT to analyze the video in the current conversation.",
      _meta: { ui: { csp: APP_CSP, prefersBorder: true } },
    },
    async () => ({
      contents: [
        {
          uri: APP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          _meta: { ui: { csp: APP_CSP } },
          text: await renderAppHtml(),
        },
      ],
    }),
  );

  registerAppTool(server, "open_app", {
    title: "Open app",
    description: "Open the YouTube HTML Editor app and preload project data for the widget.",
    inputSchema: {
      project_id: z.string().uuid().optional(),
    },
    outputSchema: openAppStateSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: {
        resourceUri: APP_RESOURCE_URI,
      },
    },
  }, async ({ project_id }) => {
    try {
      const appState = await buildOpenAppState(project_id);
      const selectedProjectId = appState.project?.id ?? "none";
      return toolResult(appState, `Opened app with project ${selectedProjectId}.`);
    } catch (error) {
      return toolError(error.message);
    }
  });

  server.registerTool("create_project", {
    title: "Create project",
    description: "Create a project from a title and a valid YouTube URL.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      source_url: z.string().trim().url(),
    },
    outputSchema: { project: projectSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ title, source_url }) => {
    try {
      const project = await createProject(title, source_url);
      return toolResult({ project }, `Created project ${project.id}.`);
    } catch (error) {
      return toolError(error.message);
    }
  });

  server.registerTool("get_project", {
    title: "Get project",
    description: "Get project metadata and preview URL.",
    inputSchema: { project_id: z.string().uuid() },
    outputSchema: { project: projectSchema.nullable() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ project_id }) => {
    const project = await getProject(project_id);
    return project
      ? toolResult({ project }, `Loaded project ${project.id}.`)
      : toolError(`Project ${project_id} was not found.`);
  });

  server.registerTool("list_projects", {
    title: "List projects",
    description: "List stored projects for selection.",
    outputSchema: { projects: projectsSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const projects = await listProjects();
    return toolResult({ projects }, `Found ${projects.length} project(s).`);
  });

  server.registerTool("save_edit_html", {
    title: "Save edit HTML",
    description: "Save a complete, self-contained HTML edit mockup for one project.",
    inputSchema: {
      project_id: z.string().uuid(),
      html: z.string().trim().min(1).max(MAX_HTML_BYTES),
      title: z.string().trim().min(1).max(200).optional(),
    },
    outputSchema: { project: projectSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ project_id, html, title }) => {
    const project = await getProject(project_id);

    if (!project) {
      return toolError(`Project ${project_id} was not found.`);
    }

    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      return toolError(`html must not exceed ${MAX_HTML_BYTES} bytes.`);
    }

    await saveEditHtml(project_id, html);
    const savedProject = await saveProject({
      ...project,
      ...(title ? { title } : {}),
      status: "html_ready",
      previewUrl: `/projects/${project_id}/preview`,
    });
    return toolResult({ project: savedProject }, `Saved edit HTML for project ${project_id}.`);
  });

  return server;
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

function sendText(response, statusCode, text, contentType) {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(text);
}

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    return sendJson(response, 200, {
      name: "youtube-html-editor",
      mcpEndpoint: "/mcp",
    });
  }

  if (request.method === "GET" && url.pathname === "/app") {
    try {
      return sendHtml(response, 200, await renderAppHtml());
    } catch (error) {
      console.error("Failed to render app widget:", error);
      return sendJson(response, 500, { error: "Unable to load app widget" });
    }
  }

  if (request.method === "GET" && url.pathname === "/editor-widget.html") {
    try {
      const html = await readFile(EMPTY_WIDGET_PATH, "utf8");
      return sendText(response, 200, html, "text/html; charset=utf-8");
    } catch {
      return sendJson(response, 404, { error: "Not found" });
    }
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
