import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';
import { t } from './i18n';

type ExtraBody = Record<string, unknown>;

export function getOpenAIChatCompletionsRequestUrl(
  baseURL: string | undefined
): string {
  const effectiveBaseURL = (baseURL && baseURL.trim()) || 'https://api.openai.com/v1';

  try {
    const url = new URL(effectiveBaseURL);
    url.pathname = joinUrlPath(url.pathname, 'chat/completions');
    return url.toString();
  } catch {
    return `${effectiveBaseURL.replace(/\/+$/, '')}/chat/completions`;
  }
}

function joinUrlPath(basePath: string, suffix: string): string {
  const a = (basePath || '').replace(/\/+$/, '');
  const b = (suffix || '').replace(/^\/+/, '');
  if (!a) {
    return `/${b}`;
  }
  return `${a}/${b}`;
}

function getOpenAIBaseURLHint(baseURL: string | undefined): string {
  const trimmed = (baseURL || '').trim();
  if (!trimmed) {
    return t('hint.openaiBaseUrlDefault');
  }
  return t('hint.openaiBaseUrlCurrent', { baseUrl: trimmed });
}

/**
 * 解析 OpenAI 兼容接口额外请求体参数。
 */
function getOpenAIExtraBody(rawValue: string | undefined): ExtraBody {
  const trimmed = (rawValue || '').trim();

  // 空值表示不追加任何 provider 专有参数。
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);

    // 额外参数必须是对象，避免数组或基础类型覆盖请求体语义。
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(t('error.extraBodyInvalid', { value: trimmed }));
    }

    return parsed as ExtraBody;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(t('error.extraBodyInvalid', { value: trimmed }));
    }
    throw error;
  }
}

/**
 * 创建 OpenAI 兼容接口配置。
 * @returns {Object} OpenAI 兼容接口配置。
 * @throws {Error} 缺少 API Key 时抛出错误。
 */
function getOpenAIConfig() {
  const configManager = ConfigurationManager.getInstance();
  const apiKey = configManager.getConfig<string>(ConfigKeys.OPENAI_API_KEY);
  const baseURL = configManager.getConfig<string>(ConfigKeys.OPENAI_BASE_URL);

  if (!apiKey) {
    throw new Error(t('error.apiKeyMissingConfig'));
  }

  const config: {
    apiKey: string;
    baseURL?: string;
  } = {
    apiKey
  };

  if (baseURL) {
    if (looksLikeNonOpenAICompatibleEndpoint(baseURL)) {
      throw new Error(
        t('error.nonCompatibleBaseUrl', {
          baseUrl: baseURL
        })
      );
    }
    config.baseURL = baseURL;
  }

  return config;
}

/**
 * 创建 OpenAI 兼容接口实例。
 * @returns {OpenAI} OpenAI 兼容接口实例。
 */
export function createOpenAIApi() {
  const config = getOpenAIConfig();
  return new OpenAI(config);
}

/**
 * 发送 OpenAI 兼容聊天补全请求。
 * @param {Array<Object>} messages - 请求消息。
 * @returns {Promise<string>} 模型返回内容。
 */
export async function OpenAICompatibleAPI(messages: ChatCompletionMessageParam[]) {
  const openai = createOpenAIApi();
  const configManager = ConfigurationManager.getInstance();
  const model = configManager.getConfig<string>(ConfigKeys.OPENAI_MODEL);
  const temperature = configManager.getConfig<number>(
    ConfigKeys.OPENAI_TEMPERATURE,
    0.7
  );
  const baseURL = configManager.getConfig<string>(ConfigKeys.OPENAI_BASE_URL);
  const extraBody = getOpenAIExtraBody(
    configManager.getConfig<string>(ConfigKeys.OPENAI_EXTRA_BODY, '')
  );

  const completion = await openai.chat.completions.create({
    model,
    messages: messages as ChatCompletionMessageParam[],
    temperature,
    ...extraBody
  } as any);

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    const hint = getOpenAIBaseURLHint(baseURL);
    throw new Error(t('error.openaiEmptyResponse', { hint }));
  }

  return content;
}

function looksLikeNonOpenAICompatibleEndpoint(url: string): boolean {
  const lower = (url || '').toLowerCase();
  return (
    lower.includes('generativelanguage.googleapis.com') ||
    lower.includes('aiplatform.googleapis.com') ||
    (lower.includes('googleapis.com') && lower.includes('v1beta')) ||
    lower.includes('/models/')
  );
}
