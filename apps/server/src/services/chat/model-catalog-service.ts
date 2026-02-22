const DEFAULT_MODEL = "gpt-5-nano";

const parseAllowedModels = (raw: string | undefined) => {
  const configured = raw
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!configured || configured.length === 0) {
    return;
  }

  return [...new Set(configured)];
};

export interface ResolveChatModelResult {
  model?: string;
  error?: string;
}

export interface ChatModelCatalogService {
  getAllowedModels(): string[];
  getDefaultModel(): string;
  resolveModel(requestedModel?: string): ResolveChatModelResult;
}

export const createEnvironmentChatModelCatalogService = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const allowedModels = parseAllowedModels(environment.CHAT_ALLOWED_MODELS);
  const allowedModelSet = allowedModels ? new Set(allowedModels) : undefined;
  const hasAllowList = Boolean(allowedModels && allowedModels.length > 0);

  const configuredDefaultModel = environment.CHAT_DEFAULT_MODEL?.trim();
  const defaultModel = hasAllowList
    ? configuredDefaultModel && allowedModelSet?.has(configuredDefaultModel)
      ? configuredDefaultModel
      : (allowedModels?.[0] ?? DEFAULT_MODEL)
    : (configuredDefaultModel ?? DEFAULT_MODEL);

  const resolveModel = (requestedModel?: string) => {
    const normalizedRequestedModel = requestedModel?.trim();
    if (!normalizedRequestedModel) {
      return { model: defaultModel } satisfies ResolveChatModelResult;
    }

    if (hasAllowList && !allowedModelSet?.has(normalizedRequestedModel)) {
      return {
        error: `Unsupported model. Allowed models: ${allowedModels?.join(", ")}`,
      } satisfies ResolveChatModelResult;
    }

    return {
      model: normalizedRequestedModel,
    } satisfies ResolveChatModelResult;
  };

  return {
    getAllowedModels: () => {
      return allowedModels ? [...allowedModels] : [];
    },
    getDefaultModel: () => {
      return defaultModel;
    },
    resolveModel,
  } satisfies ChatModelCatalogService;
};
