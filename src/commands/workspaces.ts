import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { workspacesDir } from "../util/paths.js";
import { t } from "../util/i18n/index.js";

export interface WorkspacesCommandOptions {
  user?: string;
  json?: boolean;
  long?: boolean;
}

interface ProjectEntry {
  user: string;
  project: string;
  path: string;
  fileCount: number;
  totalSize: number;
  modifiedAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function scanDir(
  dir: string,
): { fileCount: number; totalSize: number; modifiedAt: string } {
  let fileCount = 0;
  let totalSize = 0;
  let modifiedAt = "";
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        fileCount += 1;
        try {
          const stat = fs.statSync(full);
          totalSize += stat.size;
          const m = stat.mtime.toISOString();
          if (m > modifiedAt) modifiedAt = m;
        } catch {
          // 忽略无法 stat 的文件
        }
      }
    }
  };
  walk(dir);
  return { fileCount, totalSize, modifiedAt };
}

function listProjects(userFilter?: string): ProjectEntry[] {
  const root = workspacesDir();
  const projects: ProjectEntry[] = [];
  if (!fs.existsSync(root)) return projects;
  let userEntries: fs.Dirent[];
  try {
    userEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return projects;
  }
  const users = userEntries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((u) => !userFilter || u === userFilter);
  for (const user of users) {
    const userDir = path.join(root, user);
    let projectEntries: fs.Dirent[];
    try {
      projectEntries = fs.readdirSync(userDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of projectEntries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(userDir, entry.name);
      const { fileCount, totalSize, modifiedAt } = scanDir(projectPath);
      projects.push({
        user,
        project: entry.name,
        path: projectPath,
        fileCount,
        totalSize,
        modifiedAt,
      });
    }
  }
  return projects;
}

function listFilesIndented(dir: string, indent: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // 目录在前、文件在后，各自按名字排序。
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory())
      return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    const suffix = entry.isDirectory() ? "/" : "";
    console.log(`${indent}${entry.name}${suffix}`);
    if (entry.isDirectory()) {
      listFilesIndented(path.join(dir, entry.name), `${indent}  `);
    }
  }
}

export async function workspacesCommand(
  options: WorkspacesCommandOptions,
): Promise<void> {
  const projects = listProjects(options.user);
  const root = workspacesDir();

  if (options.json) {
    console.log(JSON.stringify({ root, projects }, null, 2));
    return;
  }

  console.log(`${t("workspaces.header", { root: pc.dim(root) })}\n`);

  if (projects.length === 0) {
    console.log(
      pc.dim(
        options.user
          ? t("workspaces.empty.user", { user: options.user })
          : t("workspaces.empty.all"),
      ),
    );
    return;
  }

  const byUser = new Map<string, ProjectEntry[]>();
  for (const p of projects) {
    const list = byUser.get(p.user) ?? [];
    list.push(p);
    byUser.set(p.user, list);
  }

  for (const [user, list] of byUser) {
    console.log(pc.cyan(t("workspaces.userLine", { user, n: list.length })));
    list
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .forEach((p) => {
        const time = p.modifiedAt
          ? p.modifiedAt.slice(0, 16).replace("T", " ")
          : "-";
        console.log(
          t("workspaces.row", {
            project: pc.green(p.project.padEnd(14)),
            fileCount: String(p.fileCount).padStart(4),
            size: formatSize(p.totalSize).padStart(9),
            time: pc.dim(time),
          }),
        );
        console.log(pc.dim(`        ${p.path}`));
        if (options.long) {
          listFilesIndented(p.path, "        ");
        }
      });
  }

  console.log(pc.dim(t("workspaces.summary", { n: projects.length })));
}
