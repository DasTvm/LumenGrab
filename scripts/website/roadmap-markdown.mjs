import { readFile, writeFile } from "node:fs/promises";
import { validateRoadmap } from "./project-data-model.mjs";

const roadmap = validateRoadmap(
  JSON.parse(await readFile(new URL("../../docs/website-roadmap.json", import.meta.url), "utf8")),
);
const lines = [
  "# Roadmap",
  "",
  "Work happens in small milestones. A milestone is done once it is finished and tested.",
  "",
  "Generated from [website-roadmap.json](website-roadmap.json). Edit that file, then run `node scripts/website/roadmap-markdown.mjs`.",
  "",
];
for (const milestone of roadmap.milestones) {
  lines.push(
    `- [${milestone.status === "done" ? "x" : " "}] **${milestone.id} ${milestone.title}**: ${milestone.description}`,
    `  - Status: ${milestone.status}${milestone.finishedAt ? `; finished ${milestone.finishedAt}` : ""}.`,
  );
  for (const task of milestone.tasks) lines.push(`  - [${task.done ? "x" : " "}] ${task.title}`);
}
lines.push("", "Later: " + roadmap.later.map((idea) => idea.title).join(", ") + ".", "");
const target = new URL("../../docs/ROADMAP.md", import.meta.url);
const output = lines.join("\n");
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== output) {
    throw new Error(
      "Roadmap documentation is stale. Run node scripts/website/roadmap-markdown.mjs and commit both roadmap files.",
    );
  }
} else {
  await writeFile(target, output);
}
