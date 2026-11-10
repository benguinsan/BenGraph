import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, opendir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";

const run = promisify(execFile);
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;

export function normalizeRepositoryUrl(input: string): string {
  const match = /^https:\/\/github\.com\/([a-z\d-]+)\/([a-z\d_.-]+?)(?:\.git)?\/?$/i.exec(input.trim());
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error("Expected a public GitHub repository URL: https://github.com/owner/repo");
  }
  return `https://github.com/${match[1]}/${match[2]}`.toLowerCase();
}

async function githubResponse(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Cartograph" },
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new Error("Repository not found. Check the URL and that the repository is public.");
    throw new Error(`GitHub request failed (HTTP ${response.status})${response.status === 403 || response.status === 429 ? ": access denied or public API rate limit reached" : ""}.`);
  }
  return response;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function checkLinks(root: string, directory = root): Promise<void> {
  for await (const entry of await opendir(directory)) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkLinks(root, file);
    if (!entry.isSymbolicLink()) continue;
    const target = path.resolve(directory, await readlink(file));
    if (!inside(root, target)) throw new Error(`Archive link escapes the repository: ${entry.name}`);
    try {
      if (!inside(root, await realpath(file))) throw new Error(`Archive link resolves outside the repository: ${entry.name}`);
    } catch (error) {
      // The parser already counts dangling source links as skipped.
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

/** Downloads a public archive pinned to the resolved SHA; never runs repository code. */
export async function fetchRepository(repoUrl: string, workspace: string): Promise<string> {
  const repository = normalizeRepositoryUrl(repoUrl).slice("https://github.com/".length);
  const commit: unknown = await (await githubResponse(`https://api.github.com/repos/${repository}/commits/HEAD`)).json();
  if (typeof commit !== "object" || commit === null || !("sha" in commit) || typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new Error("GitHub returned an invalid commit SHA.");
  }
  await mkdir(workspace, { recursive: true });
  const response = await githubResponse(`https://codeload.github.com/${repository}/tar.gz/${commit.sha}`);
  if (!response.body) throw new Error("GitHub returned an empty archive.");
  const body = response.body;
  const archive = path.join(workspace, "repository.tar");
  let compressed = 0;
  let expanded = 0;
  await pipeline(
    async function* () {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          compressed += value.length;
          if (compressed > MAX_ARCHIVE_BYTES) throw new Error("Repository archive exceeds the 50 MiB download limit.");
          yield value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
    createGunzip(),
    async function* (chunks: AsyncIterable<Uint8Array>) {
      for await (const chunk of chunks) {
        expanded += chunk.length;
        if (expanded > MAX_EXTRACTED_BYTES) throw new Error("Repository archive exceeds the 250 MiB extracted limit.");
        yield chunk;
      }
    },
    createWriteStream(archive, { flags: "wx" }),
  );
  const { stdout } = await run("tar", ["-tf", archive], { maxBuffer: 16 * 1024 * 1024 });
  const entries = stdout.trimEnd().split("\n");
  const top = entries[0]?.split("/")[0];
  if (!top || entries.some(entry => entry.startsWith("/") || entry.split("/").includes("..") || entry.split("/")[0] !== top)) {
    throw new Error("Unsafe repository archive paths.");
  }
  const directory = path.join(workspace, "repo");
  await mkdir(directory);
  // System tar also refuses writes through escaping links during extraction.
  await run("tar", ["-xf", archive, "--strip-components=1", "--no-same-owner", "--no-same-permissions", "-C", directory]);
  // Compare real paths on both sides, including macOS's /var -> /private/var.
  await checkLinks(await realpath(directory));
  return commit.sha;
}
