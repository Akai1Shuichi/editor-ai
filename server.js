import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const widgetHtml = readFileSync(join(__dirname, "public/editor-widget.html"), "utf8");
const defaultProject = JSON.parse(readFileSync(join(__dirname, "data/default-project.json"), "utf8"));
const TEMPLATE_URI = "ui://video-editor/social-algorithm-v031.html";

const clone = (v) => JSON.parse(JSON.stringify(v));

// v0.3: this dev server is intentionally single-project/single-user.
// ChatGPT model tool calls and widget-originated tools are not guaranteed to
// carry the exact same host/session metadata. A session-keyed in-memory Map can
// therefore split one editor into two different project snapshots.
// Keep one authoritative project on this local MCP process so every caller
// reads/writes the same state. Add auth + durable per-user storage before
// deploying this to multiple users.
let projectStore = clone(defaultProject);
function getProject(_extra) {
  return projectStore;
}
function saveProject(_extra, project) {
  project.version = (projectStore?.version ?? project.version ?? 0) + 1;
  projectStore = project;
  return projectStore;
}

const layerSchema = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number(),
  color: z.string(),
  weight: z.number(),
  align: z.enum(["left", "center", "right"]),
  maxWidth: z.number().optional(),
});
const sceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  duration: z.number(),
  type: z.string(),
  layers: z.array(layerSchema),
});
const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
  scenes: z.array(sceneSchema),
});
const mutationSchema = z.object({
  source: z.enum(["widget", "model", "system", "unknown"]),
  scope: z.enum(["project", "scene", "layer", "read"]),
  scene_id: z.string().optional(),
  layer_id: z.string().optional(),
  version: z.number(),
});
const outputSchema = { project: projectSchema, mutation: mutationSchema.optional() };

const layerPatchSchema = z.object({
  layer_id: z.string(),
  text: z.string().optional(),
  x: z.number().min(0).max(540).optional(),
  y: z.number().min(0).max(960).optional(),
  size: z.number().min(10).max(180).optional(),
  color: z.string().optional(),
  weight: z.number().min(100).max(900).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  maxWidth: z.number().min(60).max(540).optional(),
});

function getMutationSource(args = {}) {
  if (args?.client_origin === "widget") return "widget";
  if (args?.client_origin === "system") return "system";
  return "model";
}

function reply(project, message, mutation) {
  return {
    structuredContent: { project: clone(project), ...(mutation ? { mutation } : {}) },
    content: message ? [{ type: "text", text: message }] : [],
  };
}

function createVideoEditorServer() {
  const server = new McpServer(
    { name: "chatgpt-video-editor", version: "0.3.1" },
    {
      instructions:
        "This plugin edits a short-form video project. When the user asks to change a screen/scene, use update_text_layer for targeted text/style edits or update_scene for duration/multi-layer edits. Preserve scene IDs and layer IDs. Keep Vietnamese copy concise for 9:16 short video. The ~200 distribution ladder is an illustrative model, not a universal platform rule.",
    },
  );

  registerAppResource(
    server,
    "video-editor-widget",
    TEMPLATE_URI,
    {},
    async () => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: {
                connectDomains: ["https://unpkg.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
                resourceDomains: ["https://unpkg.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
              },
            },
            "openai/widgetDescription": "Interactive 9:16 video editor. Optimized for fullscreen editing; inline mode is compact. Users can edit text directly and ask ChatGPT to rewrite the selected scene without an API key.",
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "open_video_editor",
    {
      title: "Open video editor",
      description: "Open the interactive short-video editor and show the current project state.",
      inputSchema: {},
      outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: TEMPLATE_URI },
        "openai/toolInvocation/invoking": "Opening video editor…",
        "openai/toolInvocation/invoked": "Video editor ready",
      },
    },
    async (_args, extra) => reply(getProject(extra), "Opened the current video project."),
  );

  registerAppTool(
    server,
    "get_video_project",
    {
      title: "Get video project",
      description: "Read the complete current video project, including scene durations and all text layers. Use this before broad multi-scene edits.",
      inputSchema: {},
      outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      // registerAppTool currently expects an _meta object even when this tool
      // does not render a UI resource. Omitting it crashes tool discovery.
      _meta: {
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
      },
    },
    async (_args, extra) =>
      reply(getProject(extra), "Current video project loaded.", {
        source: "system",
        scope: "read",
        version: getProject(extra).version,
      }),
  );

  registerAppTool(
    server,
    "update_text_layer",
    {
      title: "Update text layer",
      description: "Update one text layer in one scene. Best for rewriting a headline, keyword, size, position, weight, alignment, or color without disturbing other layers.",
      inputSchema: {
        scene_id: z.string(),
        layer_id: z.string(),
        client_origin: z.enum(["widget", "system"]).optional(),
        text: z.string().optional(),
        x: z.number().min(0).max(540).optional(),
        y: z.number().min(0).max(960).optional(),
        size: z.number().min(10).max(180).optional(),
        color: z.string().optional(),
        weight: z.number().min(100).max(900).optional(),
        align: z.enum(["left", "center", "right"]).optional(),
        maxWidth: z.number().min(60).max(540).optional(),
      },
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: {
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Updating text…",
        "openai/toolInvocation/invoked": "Text updated",
      },
    },
    async (args, extra) => {
      const project = clone(getProject(extra));
      const scene = project.scenes.find((s) => s.id === args.scene_id);
      if (!scene) return reply(project, `Scene ${args.scene_id} was not found.`);
      const layer = scene.layers.find((l) => l.id === args.layer_id);
      if (!layer) return reply(project, `Layer ${args.layer_id} was not found in ${args.scene_id}.`);
      for (const key of ["text", "x", "y", "size", "color", "weight", "align", "maxWidth"]) {
        if (args[key] !== undefined) layer[key] = args[key];
      }
      const saved = saveProject(extra, project);
      return reply(saved, `Updated ${args.scene_id}/${args.layer_id}.`, {
        source: getMutationSource(args),
        scope: "layer",
        scene_id: args.scene_id,
        layer_id: args.layer_id,
        version: saved.version,
      });
    },
  );

  registerAppTool(
    server,
    "update_scene",
    {
      title: "Update scene",
      description: "Update a scene duration/title/type and/or multiple existing text layers at once. Preserve the scene ID and existing layer IDs.",
      inputSchema: {
        scene_id: z.string(),
        client_origin: z.enum(["widget", "system"]).optional(),
        title: z.string().optional(),
        duration: z.number().min(0.5).max(30).optional(),
        type: z.string().optional(),
        layer_updates: z.array(layerPatchSchema).max(20).optional(),
      },
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: {
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Updating scene…",
        "openai/toolInvocation/invoked": "Scene updated",
      },
    },
    async (args, extra) => {
      const project = clone(getProject(extra));
      const scene = project.scenes.find((s) => s.id === args.scene_id);
      if (!scene) return reply(project, `Scene ${args.scene_id} was not found.`);
      if (args.title !== undefined) scene.title = args.title;
      if (args.duration !== undefined) scene.duration = args.duration;
      if (args.type !== undefined) scene.type = args.type;
      for (const patch of args.layer_updates || []) {
        const layer = scene.layers.find((l) => l.id === patch.layer_id);
        if (!layer) continue;
        for (const key of ["text", "x", "y", "size", "color", "weight", "align", "maxWidth"]) {
          if (patch[key] !== undefined) layer[key] = patch[key];
        }
      }
      const saved = saveProject(extra, project);
      return reply(saved, `Updated scene ${args.scene_id}.`, {
        source: getMutationSource(args),
        scope: "scene",
        scene_id: args.scene_id,
        version: saved.version,
      });
    },
  );

  registerAppTool(
    server,
    "reset_video_project",
    {
      title: "Reset video project",
      description: "Reset the current video project to the original 8-scene social-algorithm template.",
      inputSchema: {},
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
      _meta: {
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Resetting project…",
        "openai/toolInvocation/invoked": "Project reset",
      },
    },
    async (_args, extra) => {
      const project = clone(defaultProject);
      const saved = saveProject(extra, project);
      return reply(saved, "Video project reset to the original template.", {
        source: "system",
        scope: "project",
        version: saved.version,
      });
    },
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const httpServer = createServer(async (req, res) => {
  if (!req.url) return res.writeHead(400).end("Missing URL");
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end("ChatGPT Video Editor MCP server\n/mcp - MCP endpoint\n/editor - standalone editor\n");
  }

  if (req.method === "GET" && url.pathname === "/editor") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(widgetHtml);
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = createVideoEditorServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`ChatGPT Video Editor MCP: http://localhost:${port}${MCP_PATH}`);
  console.log(`Standalone editor: http://localhost:${port}/editor`);
});
