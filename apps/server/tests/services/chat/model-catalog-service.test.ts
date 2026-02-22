import { describe, expect, test } from "bun:test";
import { createEnvironmentChatModelCatalogService } from "../../../src/services/chat/model-catalog-service";

describe("createEnvironmentChatModelCatalogService", () => {
  test("uses fallback default model and no restrictions when environment is empty", () => {
    const catalog = createEnvironmentChatModelCatalogService({});

    expect(catalog.getAllowedModels()).toEqual([]);
    expect(catalog.getDefaultModel()).toBe("gpt-5-nano");
    expect(catalog.resolveModel().model).toBe("gpt-5-nano");
    expect(catalog.resolveModel("claude-sonnet-4").model).toBe("claude-sonnet-4");
  });

  test("resolves request model from configured allow list", () => {
    const catalog = createEnvironmentChatModelCatalogService({
      CHAT_ALLOWED_MODELS: "gpt-4o-mini,gpt-4.1-mini,o3-mini",
      CHAT_DEFAULT_MODEL: "gpt-4.1-mini",
    });

    expect(catalog.getDefaultModel()).toBe("gpt-4.1-mini");
    expect(catalog.resolveModel("o3-mini")).toEqual({ model: "o3-mini" });
  });

  test("uses configured default model when allow list is not set", () => {
    const catalog = createEnvironmentChatModelCatalogService({
      CHAT_DEFAULT_MODEL: "claude-sonnet-4",
    });

    expect(catalog.getDefaultModel()).toBe("claude-sonnet-4");
    expect(catalog.resolveModel().model).toBe("claude-sonnet-4");
    expect(catalog.resolveModel("o3-mini")).toEqual({ model: "o3-mini" });
  });

  test("returns validation error for unsupported model", () => {
    const catalog = createEnvironmentChatModelCatalogService({
      CHAT_ALLOWED_MODELS: "gpt-4o-mini,gpt-4.1-mini",
    });

    const result = catalog.resolveModel("claude-sonnet-4");
    expect(result.model).toBeUndefined();
    expect(result.error).toContain("Unsupported model");
  });
});
