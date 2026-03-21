declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module "turndown" {
  export default class TurndownService {
    constructor(options?: {
      headingStyle?: string;
      hr?: string;
      bulletListMarker?: string;
      codeBlockStyle?: string;
      emDelimiter?: string;
    });

    remove(selectors: string[]): void;
    turndown(input: string): string;
  }
}

interface Response {
  ok: boolean;
  status: number;
  headers: {
    get(name: string): string | null;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare function fetch(
  input: string,
  init?: {
    headers?: Record<string, string>;
  },
): Promise<Response>;

declare class TextDecoder {
  decode(input?: ArrayBuffer): string;
}

declare const Buffer: {
  from(value: ArrayBuffer): {
    toString(encoding: "base64"): string;
  };
};
