import { tool } from "ai";
import z from "zod";
import { resolve, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import READ_DESCRIPTION from "./read-memory.txt";
import UPDATE_DESCRIPTION from "./update-memory.txt";

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
    "Basic information about the user — name, age, location, occupation, etc.",
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

async function ensureMemoryDir() {
  await mkdir(MEMORY_DIR, { recursive: true });
}

async function readMemoryFile(key: MemoryFileKey): Promise<string> {
  const filePath = join(MEMORY_DIR, MEMORY_FILES[key]);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    const initial = INITIAL_CONTENT[key];
    await writeFile(filePath, initial, "utf-8");
    return initial;
  }
}

async function writeMemoryFile(key: MemoryFileKey, content: string) {
  const filePath = join(MEMORY_DIR, MEMORY_FILES[key]);
  await writeFile(filePath, content, "utf-8");
}

const memoryFileSchema = z.enum(["profile", "projects", "facts", "all"]);

export const readWorkingMemory = tool({
  description: READ_DESCRIPTION,
  inputSchema: z.object({
    file: memoryFileSchema.describe(
      'Which memory file to read: "profile", "projects", "facts", or "all"',
    ),
  }),
  execute: async ({ file }) => {
    await ensureMemoryDir();

    if (file === "all") {
      const keys = Object.keys(MEMORY_FILES) as MemoryFileKey[];
      const sections = await Promise.all(
        keys.map(async (key) => {
          const content = await readMemoryFile(key);
          return content;
        }),
      );

      return {
        output: sections.join("\n---\n\n"),
      };
    }

    const content = await readMemoryFile(file);
    return { output: content };
  },
});

export const updateWorkingMemory = tool({
  description: UPDATE_DESCRIPTION,
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
      .describe('Required for "replace" — the existing line to find and replace'),
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
        return { output: `Replaced in ${file}: "${target}" → "${content}"` };
      }
    }
  },
});
