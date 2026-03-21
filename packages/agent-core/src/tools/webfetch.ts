import { tool } from "ai";
import TurndownService from "turndown";
import z from "zod";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

const WEBFETCH_DESCRIPTION = [
  "Fetches content from a specified URL.",
  "Takes a URL and optional format as input.",
  "Fetches the URL content and returns text, markdown, or html.",
  "Use this tool when you need to retrieve and analyze web content.",
  "The URL must be fully formed and start with http:// or https://.",
].join(" ");

export const webfetch = tool({
  description: WEBFETCH_DESCRIPTION,
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html)."),
  }),
  execute: async (params) => {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://");
    }

    const acceptHeader = getAcceptHeader(params.format);
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
    };

    const initialResponse = await fetch(params.url, { headers });
    const response =
      initialResponse.status === 403 && initialResponse.headers.get("cf-mitigated") === "challenge"
        ? await fetch(params.url, { headers: { ...headers, "User-Agent": "opencode" } })
        : initialResponse;

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const contentType = response.headers.get("content-type") || "";
    const mime = contentType.split(";")[0]?.trim().toLowerCase() || "";
    const title = `${params.url} (${contentType})`;
    const isImage =
      mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet";

    if (isImage) {
      const base64Content = Buffer.from(arrayBuffer).toString("base64");
      return {
        title,
        output: "Image fetched successfully",
        metadata: {},
        attachments: [
          {
            type: "file",
            mime,
            url: `data:${mime};base64,${base64Content}`,
          },
        ],
      };
    }

    const content = new TextDecoder().decode(arrayBuffer);

    switch (params.format) {
      case "markdown": {
        return {
          output: contentType.includes("text/html") ? convertHtmlToMarkdown(content) : content,
          title,
          metadata: {},
        };
      }
      case "text": {
        return {
          output: contentType.includes("text/html") ? await extractTextFromHtml(content) : content,
          title,
          metadata: {},
        };
      }
      case "html": {
        return {
          output: content,
          title,
          metadata: {},
        };
      }
    }
  },
});

function getAcceptHeader(format: "text" | "markdown" | "html") {
  switch (format) {
    case "markdown": {
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    }
    case "text": {
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    }
    case "html": {
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
    }
  }
}

async function extractTextFromHtml(html: string) {
  return html
    .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replaceAll(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replaceAll(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function convertHtmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndownService.remove(["script", "style", "meta", "link"]);
  return turndownService.turndown(html);
}
