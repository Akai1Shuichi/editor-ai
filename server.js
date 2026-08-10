import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const widgetHtml = readFileSync(join(__dirname, "public/editor-widget.html"), "utf8");
const defaultProject = JSON.parse(readFileSync(join(__dirname, "data/default-project.json"), "utf8"));
const styleEditPreset = JSON.parse(readFileSync(join(__dirname, "data/style-edit.json"), "utf8"));
const TEMPLATE_URI = "ui://video-editor/project-studio-v040.html";
const PROJECTS_DIR = join(__dirname, "data", "projects");
const ACTIVE_FILE = join(PROJECTS_DIR, ".active");
mkdirSync(PROJECTS_DIR, { recursive: true });

const clone = (v) => JSON.parse(JSON.stringify(v));

const safeId = (value) => String(value || "project").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "project";
const projectPath = (id) => join(PROJECTS_DIR, `${safeId(id)}.json`);
function readProject(id) {
  const path = projectPath(id);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}
function initialProject() {
  const project = clone(defaultProject);
  project.updatedAt = new Date().toISOString();
  project.workflow = project.workflow || { status: "ready", script: "", sourceUrl: "", contentPlan: [], styleEdit: clone(styleEditPreset) };
  return project;
}
function emptyProject() {
  return {
    id: "project",
    title: "Untitled Project",
    version: 0,
    scenes: [],
    updatedAt: new Date().toISOString(),
    workflow: {
      status: "planning",
      script: "",
      sourceUrl: "",
      contentPlan: [],
      styleEdit: clone(styleEditPreset),
    },
  };
}
if (!existsSync(projectPath(defaultProject.id))) writeFileSync(projectPath(defaultProject.id), JSON.stringify(initialProject(), null, 2));
let activeProjectId = existsSync(ACTIVE_FILE) ? readFileSync(ACTIVE_FILE, "utf8").trim() : defaultProject.id;
if (!existsSync(projectPath(activeProjectId))) activeProjectId = defaultProject.id;
let projectStore = JSON.parse(readFileSync(projectPath(activeProjectId), "utf8"));
function listProjects() {
  return readdirSync(PROJECTS_DIR).filter((name) => name.endsWith(".json")).map((name) => {
    const p = JSON.parse(readFileSync(join(PROJECTS_DIR, name), "utf8"));
    return { id: p.id, title: p.title, version: p.version, updatedAt: p.updatedAt, status: p.workflow?.status || "ready", sceneCount: p.scenes?.length || 0 };
  }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function getProject(_extra) {
  return projectStore;
}
function saveProject(_extra, project) {
  const stored = readProject(project.id);
  project.version = (stored?.version ?? project.version ?? 0) + 1;
  project.updatedAt = new Date().toISOString();
  projectStore = project;
  activeProjectId = project.id;
  writeFileSync(projectPath(project.id), JSON.stringify(project, null, 2));
  writeFileSync(ACTIVE_FILE, project.id);
  return projectStore;
}
function selectProject(id) {
  const path = projectPath(id);
  if (!existsSync(path)) return null;
  projectStore = JSON.parse(readFileSync(path, "utf8"));
  activeProjectId = projectStore.id;
  writeFileSync(ACTIVE_FILE, activeProjectId);
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
  updatedAt: z.string().optional(),
  workflow: z.object({
    status: z.string(),
    script: z.string(),
    sourceUrl: z.string().optional(),
    contentPlan: z.array(z.object({ id: z.string(), title: z.string(), purpose: z.string(), content: z.string(), duration: z.number() })),
    styleEdit: z.object({
      name: z.string(),
      version: z.string(),
      summary: z.string(),
      prompt: z.string(),
    }).optional(),
  }).optional(),
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
        "This app manages durable JSON short-video projects. The default project is only a sample/template; new projects must not reuse its scenes unless explicitly requested. For a new project, call create_video_project first, then analyze its workflow.script and workflow.sourceUrl while following workflow.styleEdit.prompt, and call set_project_content_plan for that exact project_id. Stop there so the user can edit and confirm the proposed screen copy. Only after explicit confirmation call generate_project_edit with complete scenes and layers, still following workflow.styleEdit.prompt. Describing a change never updates the JSON: call update_text_layer or update_scene for later edits. Preserve project, scene, and layer IDs. Keep Vietnamese copy concise for 9:16 video and always write tool results back to the project JSON.",
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
    // IMPORTANT: this tool is polled repeatedly by the widget to detect when the
    // model finishes an edit (see startAiWatch in editor-widget.html). It must
    // NOT attach a mutation object — doing so overwrites the widget's record of
    // the real "model" mutation with a fake "system/read" one on every poll,
    // which breaks completion detection. Reads stay silent; only real writes
    // (update_text_layer/update_scene/reset_video_project) report a mutation.
    async (_args, extra) => reply(getProject(extra), "Current video project loaded."),
  );

  registerAppTool(
    server,
    "update_text_layer",
    {
      title: "Update text layer",
      description: "Update one text layer in one scene. Best for rewriting, translating, shortening, or restyling (size/position/weight/align/color) a headline or keyword without disturbing other layers. You MUST call this tool to actually apply any text change — including translations — the user's video is not updated until you do. Call it once per layer that needs to change.",
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
      description: "Update a scene duration/title/type and/or multiple existing text layers at once (e.g. translating every layer in a scene in one call via layer_updates). Preserve the scene ID and existing layer IDs. You MUST call this tool (or update_text_layer) to actually apply the change — the user's video is not updated until you do.",
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
      description: "Reset the current project. The default sample project returns to its original 8-scene template; generated projects keep their own workflow/script/style data and clear generated scenes.",
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
      const current = clone(getProject(extra));
      const project = current.id === defaultProject.id ? initialProject() : emptyProject();
      project.id = current.id;
      project.title = current.title;
      project.workflow = {
        ...(project.workflow || {}),
        ...(current.workflow || {}),
        status: current.id === defaultProject.id ? "ready" : ((current.workflow?.contentPlan?.length || 0) ? "review" : "planning"),
      };
      const saved = saveProject(extra, project);
      return reply(saved, current.id === defaultProject.id ? "Video project reset to the original template." : "Generated scenes cleared. Workflow/script/style were kept for this project.", {
        source: "system",
        scope: "project",
        version: saved.version,
      });
    },
  );

  registerAppTool(server, "list_video_projects", {
    title: "List video projects",
    description: "List every JSON video project stored by the editor.",
    inputSchema: {},
    outputSchema: { projects: z.array(z.object({ id: z.string(), title: z.string(), version: z.number(), updatedAt: z.string().optional(), status: z.string(), sceneCount: z.number() })), activeProjectId: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  }, async () => ({ structuredContent: { projects: listProjects(), activeProjectId }, content: [] }));

  registerAppTool(server, "create_video_project", {
    title: "Create video project",
    description: "Create a durable JSON project for a new video. New projects start empty and are later filled by AI using the styleEdit prompt plus the provided script/source link.",
    inputSchema: { title: z.string().min(1).max(120), script: z.string().optional(), source_url: z.string().optional() }, outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  }, async (args, extra) => {
    const script = String(args.script || "").trim();
    const sourceUrl = String(args.source_url || "").trim();
    if (script.length < 20 && !sourceUrl) return reply(getProject(extra), "Provide either a source script of at least 20 characters or a source video URL.");
    let id = safeId(args.title), suffix = 2;
    while (existsSync(projectPath(id))) id = `${safeId(args.title)}-${suffix++}`;
    const project = emptyProject();
    project.id = id; project.title = args.title; project.version = 0;
    project.workflow = { status: "planning", script, sourceUrl, contentPlan: [], styleEdit: clone(styleEditPreset) };
    const saved = saveProject(extra, project);
    return reply(saved, `Created ${id}. Analyze workflow.script/workflow.sourceUrl while following workflow.styleEdit, then call set_project_content_plan.`);
  });

  registerAppTool(server, "select_video_project", {
    title: "Select video project", description: "Select and load one stored JSON project.",
    inputSchema: { project_id: z.string() }, outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  }, async (args) => {
    const project = selectProject(args.project_id);
    return project ? reply(project, `Loaded ${project.title}.`) : reply(getProject(), `Project ${args.project_id} was not found.`);
  });

  const planItemSchema = z.object({ id: z.string(), title: z.string(), purpose: z.string(), content: z.string(), duration: z.number().min(1).max(30) });
  registerAppTool(server, "set_project_content_plan", {
    title: "Set project content plan",
    description: "Save AI-proposed, editable content for every screen. Do not create layout layers yet; the user reviews this plan first.",
    inputSchema: { project_id: z.string(), content_plan: z.array(planItemSchema).min(1).max(20) }, outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  }, async (args, extra) => {
    if (getProject().id !== args.project_id) selectProject(args.project_id);
    const project = clone(getProject(extra));
    project.workflow = { ...(project.workflow || {}), status: "review", contentPlan: args.content_plan };
    return reply(saveProject(extra, project), "Content plan saved. Ask the user to review and confirm it before generating the edit.");
  });

  registerAppTool(server, "generate_project_edit", {
    title: "Generate project edit",
    description: "Generate the final edit frame after user confirmation. Replace scenes with complete 9:16 scene/layer definitions based on the reviewed content plan.",
    inputSchema: { project_id: z.string(), content_plan: z.array(planItemSchema).min(1).max(20), scenes: z.array(sceneSchema).min(1).max(20) }, outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
  }, async (args, extra) => {
    if (getProject().id !== args.project_id) selectProject(args.project_id);
    const project = clone(getProject(extra));
    project.scenes = args.scenes;
    project.workflow = { ...(project.workflow || {}), status: "ready", contentPlan: args.content_plan };
    const saved = saveProject(extra, project);
    return reply(saved, "Final edit generated and saved to the project JSON.", { source: "model", scope: "project", version: saved.version });
  });

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
function sendJson(res, status, payload) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
async function readJson(req) {
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) throw new Error("Request too large"); }
  return body ? JSON.parse(body) : {};
}
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

  if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, { projects: listProjects(), activeProjectId });
  if (req.method === "POST" && url.pathname === "/api/projects") {
    try {
      const args = await readJson(req);
      const title = String(args.title || "").trim();
      const script = String(args.script || "").trim();
      const sourceUrl = String(args.source_url || "").trim();
      if (!title || (script.length < 20 && !sourceUrl)) return sendJson(res, 400, { error: "Cần tên project và ít nhất một trong hai: kịch bản từ 20 ký tự hoặc link nguồn video." });
      let id = safeId(args.title), suffix = 2;
      while (existsSync(projectPath(id))) id = `${safeId(args.title)}-${suffix++}`;
      const project = emptyProject();
      project.id = id; project.title = title; project.version = 0;
      project.workflow = { status: "planning", script, sourceUrl, contentPlan: [], styleEdit: clone(styleEditPreset) };
      return sendJson(res, 201, { project: saveProject(null, project) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    const project = selectProject(decodeURIComponent(projectMatch[1]));
    return project ? sendJson(res, 200, { project }) : sendJson(res, 404, { error: "Project không tồn tại." });
  }
  if (projectMatch && req.method === "PUT") {
    try {
      const { project } = await readJson(req);
      if (!project || safeId(project.id) !== safeId(decodeURIComponent(projectMatch[1]))) return sendJson(res, 400, { error: "Project không hợp lệ." });
      if (getProject().id !== project.id) selectProject(project.id);
      return sendJson(res, 200, { project: saveProject(null, project) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
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
