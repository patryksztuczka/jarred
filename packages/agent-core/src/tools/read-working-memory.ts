import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { tool } from "ai";
import z from "zod";

const READ_WORKING_MEMORY_DESCRIPTION = [
  "Reads the contents of the user's long-term memory files.",
  "Use it to recall stored information about the user, their projects, preferences, and facts.",
  'Available files are "profile", "projects", "facts", and "all".',
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

const memoryFileSchema = z.enum(["profile", "projects", "facts", "all"]);

export const readWorkingMemory = tool({
  description: READ_WORKING_MEMORY_DESCRIPTION,
  inputSchema: z.object({
    file: memoryFileSchema.describe(
      'Which memory file to read: "profile", "projects", "facts", or "all"',
    ),
  }),
  execute: async ({ file }) => {
    await ensureMemoryDir();

    if (file === "all") {
      const keys = Object.keys(MEMORY_FILES) as MemoryFileKey[];
      const sections = await Promise.all(keys.map(async (key) => readMemoryFile(key)));

      return {
        output: sections.join("\n---\n\n"),
      };
    }

    return { output: await readMemoryFile(file) };
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
