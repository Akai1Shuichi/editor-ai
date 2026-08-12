import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, "data", "projects");
const PROJECT_FILE_NAME = "project.json";
const EDIT_HTML_FILE_NAME = "edit.html";
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ensureProjectsDirectory() {
  await mkdir(PROJECTS_DIR, { recursive: true });
}

function assertProjectId(projectId) {
  if (!UUID_PATTERN.test(String(projectId))) {
    throw new TypeError("projectId must be a UUID.");
  }
}

function projectFilePath(projectId) {
  assertProjectId(projectId);
  return join(PROJECTS_DIR, projectId, PROJECT_FILE_NAME);
}

function editHtmlFilePath(projectId) {
  assertProjectId(projectId);
  return join(PROJECTS_DIR, projectId, EDIT_HTML_FILE_NAME);
}

export function validateYouTubeUrl(sourceUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(String(sourceUrl));
  } catch {
    throw new TypeError("sourceUrl must be a valid YouTube URL.");
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !YOUTUBE_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new TypeError("sourceUrl must use a supported YouTube hostname.");
  }

  return parsedUrl.toString();
}

export async function createProject(title, sourceUrl) {
  const normalizedTitle = String(title ?? "").trim();

  if (!normalizedTitle) {
    throw new TypeError("title is required.");
  }

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const project = {
    id,
    title: normalizedTitle,
    sourceUrl: validateYouTubeUrl(sourceUrl),
    status: "created",
    createdAt: timestamp,
    updatedAt: timestamp,
    previewUrl: null,
  };

  await saveProject(project);
  return project;
}

export async function getProject(projectId) {
  const path = projectFilePath(projectId);

  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function getEditHtml(projectId) {
  const path = editHtmlFilePath(projectId);

  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function listProjects() {
  await ensureProjectsDirectory();
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
    .map((entry) => getProject(entry.name)));

  return projects
    .filter((project) => project !== null)
    .sort((first, second) => String(second.updatedAt).localeCompare(String(first.updatedAt)));
}

export async function saveProject(project) {
  if (!project || typeof project !== "object") {
    throw new TypeError("project must be an object.");
  }

  assertProjectId(project.id);
  const path = projectFilePath(project.id);
  const storedProject = {
    ...project,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(storedProject, null, 2)}\n`, "utf8");
  return storedProject;
}

export { PROJECTS_DIR };
