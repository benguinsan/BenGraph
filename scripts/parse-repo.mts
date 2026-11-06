import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRepository } from "../lib/parser/index.mts";

const args = process.argv.slice(2);
const outputFlag = args.indexOf("--out");
const output = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
const directory = args[0];
if (!directory || (outputFlag >= 0 && (!output || outputFlag !== 1 || args.length !== 3)) || (outputFlag < 0 && args.length !== 1)) {
  console.error("Usage: pnpm parse:repo <directory> [--out <result.json>]");
  process.exitCode = 1;
} else {
  try {
    const result = await parseRepository(directory);
    const coverage = result.coverage;
    const reExports = result.imports.filter((item) => item.kind === "re-export");
    console.log(`Files found: ${coverage.filesFound}; parsed: ${coverage.filesParsed}; skipped: ${coverage.filesSkipped}`);
    console.log(`Folders: ${new Set(result.files.map((file) => file.folder)).size}; edges: ${result.edges.length}`);
    console.log(`Imports: ${coverage.importsSeen}; resolved: ${coverage.importsResolved}; outside: ${coverage.importsOutside}; excluded: ${coverage.importsExcluded}; unresolved: ${coverage.importsUnresolved}`);
    console.log(`Re-exports: ${reExports.length}; resolved: ${reExports.filter((item) => item.status === "resolved").length}`);
    for (const item of reExports.filter((entry) => entry.status !== "resolved")) {
      console.log(`Re-export ${item.from} -> ${item.specifier}: ${item.status} (${item.reason})`);
    }
    for (const skipped of coverage.skipped) console.log(`Skipped ${skipped.path}: ${skipped.reason}`);
    for (const item of result.imports.filter((entry) => entry.status === "unresolved").slice(0, 10)) {
      console.log(`Unresolved ${item.from} -> ${item.specifier}: ${item.reason}`);
    }
    if (output) {
      await writeFile(path.resolve(output), JSON.stringify(result, null, 2) + "\n");
      console.log(`Wrote ${path.resolve(output)}`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
