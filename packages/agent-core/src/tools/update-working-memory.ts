import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { tool } from "ai";
import z from "zod";

const UPDATE_WORKING_MEMORY_DESCRIPTION = [
  "Updates the user's long-term memory by adding, removing, or replacing facts.",
  'Available files are "profile", "projects", and "facts".',
  'Operations are "append", "remove", and "replace".',
].join(" ");

const MEMORY_DIR = resolve("tmp/memory/long-term");

const MEMORY_FILES = {
  profile: "profile.md",
  projects: "projects.md",
  facts: "facts.md",
} as const;

type MemoryFileKey = keyof typeof MEMORY_FILES;

const INITIAL_CONTENT: Record<MemoryFileKey, string> = {
  profile: [
    "# User Profile",
    "",
    "Basic information about the user - name, age, location, occupation, etc.",
    "",
  ].join("\n"),
  projects: ["# User Projects", "", "Information about projects the user is working on.", ""].join(
    "\n",
  ),
  facts: [
    "# Facts & Preferences",
    "",
    "Miscellaneous facts, preferences, and notes about the user.",
    "",
  ].join("\n"),
};

export const updateWorkingMemory = tool({
  description: UPDATE_WORKING_MEMORY_DESCRIPTION,
  inputSchema: z.object({
    file: z
      .enum(["profile", "projects", "facts"])
      .describe('Which memory file to update: "profile", "projects", or "facts"'),
    operation: z
      .enum(["append", "remove", "replace"])
      .describe('The operation to perform: "append", "remove", or "replace"'),
    content: z
      .string()
      .describe(
        'The content to append (for "append"), the line to remove (for "remove"), or the new replacement text (for "replace")',
      ),
    target: z
      .string()
      .optional()
      .describe('Required for "replace" - the existing line to find and replace'),
  }),
  execute: async ({ file, operation, content, target }) => {
    await ensureMemoryDir();

    const current = await readMemoryFile(file);

    switch (operation) {
      case "append": {
        const updated = current.trimEnd() + "\n" + content + "\n";
        await writeMemoryFile(file, updated);
        return { output: `Appended to ${file}: ${content}` };
      }
      case "remove": {
        const lines = current.split("\n");
        const trimmedContent = content.trim();
        const index = lines.findIndex((line) => line.trim() === trimmedContent);

        if (index === -1) {
          return { output: `Could not find line to remove in ${file}: "${content}"` };
        }

        lines.splice(index, 1);
        await writeMemoryFile(file, lines.join("\n"));
        return { output: `Removed from ${file}: ${content}` };
      }
      case "replace": {
        if (!target) {
          return { output: 'The "replace" operation requires a "target" parameter' };
        }

        const lines = current.split("\n");
        const trimmedTarget = target.trim();
        const index = lines.findIndex((line) => line.trim() === trimmedTarget);

        if (index === -1) {
          return { output: `Could not find target line to replace in ${file}: "${target}"` };
        }

        lines[index] = content;
        await writeMemoryFile(file, lines.join("\n"));
        return { output: `Replaced in ${file}: "${target}" -> "${content}"` };
      }
    }
  },
});

async function ensureMemoryDir() {
  await mkdir(MEMORY_DIR, { recursive: true });
}

async function readMemoryFile(key: MemoryFileKey): Promise<string> {
  const filePath = join(MEMORY_DIR, MEMORY_FILES[key]);
  try {
    return await readFile(filePath, "utf8");
  } catch {
    const initial = INITIAL_CONTENT[key];
    await writeFile(filePath, initial, "utf8");
    return initial;
  }
}

async function writeMemoryFile(key: MemoryFileKey, content: string) {
  const filePath = join(MEMORY_DIR, MEMORY_FILES[key]);
  await writeFile(filePath, content, "utf8");
}
