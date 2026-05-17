import * as vscode from 'vscode';

const messages = {
  en: {
    'button.configure': 'Configure',
    'button.no': 'No',
    'button.retry': 'Retry',
    'button.yes': 'Yes',
    'error.apiKeyMissing': 'OpenAI-compatible API Key not configured',
    'error.apiKeyMissingConfig':
      'The OPENAI_API_KEY configuration is missing or empty.',
    'error.apiUnauthorized': 'Invalid OpenAI-compatible API key or unauthorized access',
    'error.badRequest': 'OpenAI-compatible Bad Request (400): {message}',
    'error.commandFailed': 'Failed: {message}',
    'error.endpointNotFound':
      'OpenAI-compatible endpoint not found (404). Please check OPENAI_BASE_URL (should end with /v1, do not include /chat/completions).',
    'error.extraBodyInvalid':
      'OPENAI_EXTRA_BODY must be a valid JSON object. Current value: {value}',
    'error.gitExtensionMissing': 'Git extension not found',
    'error.noChanges': 'No git changes found to generate a commit message',
    'error.noStagedChanges':
      "No staged changes found. Stage your changes (git add) or set 'ai-commit.DIFF_SOURCE' to 'unstaged'/'auto'.",
    'error.noUnstagedChanges':
      "No unstaged changes found. Modify files or set 'ai-commit.DIFF_SOURCE' to 'staged'/'auto'.",
    'error.noWorkspaceFolder': 'No workspace folder found',
    'error.nonCompatible400':
      'The endpoint returned a non OpenAI-compatible 400 response (messages/temperature are not recognized). Please check that OPENAI_BASE_URL is an OpenAI-compatible /v1 URL and does not include /chat/completions.',
    'error.nonCompatibleBaseUrl':
      'Current ai-commit.OPENAI_BASE_URL is not OpenAI-compatible: {baseUrl}\nPlease use an OpenAI-compatible /v1 URL and do not include /chat/completions.',
    'error.openaiEmptyResponse': 'OpenAI response is empty or incompatible. {hint}',
    'error.openaiGeneric': 'OpenAI-compatible API error: {message}',
    'error.openaiStatus': 'OpenAI-compatible API error (status {status}): {message}',
    'error.rateLimited': 'Rate limit exceeded. Please try again later',
    'error.requestUnexpected': 'An unexpected error occurred',
    'error.serverError': 'OpenAI-compatible server error. Please try again later',
    'error.serviceUnavailable': 'OpenAI-compatible service is temporarily unavailable',
    'error.scmInputMissing': 'Unable to find the SCM input box',
    'error.stagedDiffFailed': 'Failed to get staged changes: {message}',
    'error.unstagedDiffFailed': 'Failed to get unstaged changes: {message}',
    'error.commitMessageFailed': 'Failed to generate commit message',
    'hint.openaiBaseUrlDefault':
      'For custom endpoints, use a /v1 URL such as https://api.openai.com/v1 and do not include /chat/completions.',
    'hint.openaiBaseUrlCurrent':
      'Please make sure ai-commit.OPENAI_BASE_URL ends at /v1 and does not include /chat/completions. Current value: {baseUrl}',
    'message.configureApiKey':
      'OpenAI-compatible API Key not configured. Would you like to configure it now?',
    'placeholder.selectModel': 'Please select a model',
    'progress.analyzingChanges': 'Analyzing changes...',
    'progress.analyzingChangesWithContext':
      'Analyzing changes with additional context...',
    'progress.generatingCommitMessage': 'Generating commit message...',
    'progress.generatingCommitMessageWithContext':
      'Generating commit message with additional context...',
    'progress.gettingGitChanges': 'Getting git changes...',
    'progress.readingGitHistory': 'Reading git commit history...'
  },
  zh: {
    'button.configure': '配置',
    'button.no': '否',
    'button.retry': '重试',
    'button.yes': '是',
    'error.apiKeyMissing': '未配置 OpenAI 兼容接口 API Key',
    'error.apiKeyMissingConfig': '缺少 OPENAI_API_KEY 配置或配置为空。',
    'error.apiUnauthorized': 'OpenAI 兼容接口 API Key 无效或无访问权限',
    'error.badRequest': 'OpenAI 兼容接口请求错误（400）：{message}',
    'error.commandFailed': '执行失败：{message}',
    'error.endpointNotFound':
      '未找到 OpenAI 兼容接口（404）。请检查 OPENAI_BASE_URL，应填写到 /v1，且不要包含 /chat/completions。',
    'error.extraBodyInvalid': 'OPENAI_EXTRA_BODY 必须是合法 JSON 对象。当前值：{value}',
    'error.gitExtensionMissing': '未找到 Git 扩展',
    'error.noChanges': '没有可用于生成提交信息的 Git 变更',
    'error.noStagedChanges':
      "未找到暂存变更。请先暂存改动（git add），或将 'ai-commit.DIFF_SOURCE' 设置为 'unstaged'/'auto'。",
    'error.noUnstagedChanges':
      "未找到未暂存变更。请先修改文件，或将 'ai-commit.DIFF_SOURCE' 设置为 'staged'/'auto'。",
    'error.noWorkspaceFolder': '未找到工作区文件夹',
    'error.nonCompatible400':
      '接口返回了非 OpenAI 兼容格式的 400（不认识 messages/temperature）。请检查 OPENAI_BASE_URL 是否为 OpenAI 兼容的 /v1 地址，不要包含 /chat/completions。',
    'error.nonCompatibleBaseUrl':
      '当前 ai-commit.OPENAI_BASE_URL 不是 OpenAI 兼容格式：{baseUrl}\n请填写 OpenAI 兼容的 /v1 地址，不要包含 /chat/completions。',
    'error.openaiEmptyResponse': 'OpenAI 响应为空或格式不兼容。{hint}',
    'error.openaiGeneric': 'OpenAI 兼容接口错误：{message}',
    'error.openaiStatus': 'OpenAI 兼容接口错误（状态码 {status}）：{message}',
    'error.rateLimited': '请求频率超限，请稍后重试',
    'error.requestUnexpected': '发生未知错误',
    'error.serverError': 'OpenAI 兼容接口服务异常，请稍后重试',
    'error.serviceUnavailable': 'OpenAI 兼容接口暂时不可用',
    'error.scmInputMissing': '无法找到源代码管理提交信息输入框',
    'error.stagedDiffFailed': '获取暂存变更失败：{message}',
    'error.unstagedDiffFailed': '获取未暂存变更失败：{message}',
    'error.commitMessageFailed': '生成提交信息失败',
    'hint.openaiBaseUrlDefault':
      '如需自定义接口，请填写到 /v1，例如：https://api.openai.com/v1，不要填写 /chat/completions。',
    'hint.openaiBaseUrlCurrent':
      '请确保 ai-commit.OPENAI_BASE_URL 填写到 /v1，不要填写 /chat/completions。当前为：{baseUrl}',
    'message.configureApiKey': '未配置 OpenAI 兼容接口 API Key，是否现在配置？',
    'placeholder.selectModel': '请选择模型',
    'progress.analyzingChanges': '正在分析变更...',
    'progress.analyzingChangesWithContext': '正在结合额外上下文分析变更...',
    'progress.generatingCommitMessage': '正在生成提交信息...',
    'progress.generatingCommitMessageWithContext': '正在结合额外上下文生成提交信息...',
    'progress.gettingGitChanges': '正在读取 Git 变更...',
    'progress.readingGitHistory': '正在读取 Git 提交历史...'
  }
};

type MessageKey = keyof typeof messages.en;

/**
 * 判断当前界面语言是否应使用中文。
 */
function isChineseLocale(): boolean {
  return vscode.env.language.toLowerCase().startsWith('zh');
}

/**
 * 获取本地化文本，并替换模板变量。
 */
export function t(
  key: MessageKey,
  params: Record<string, string | number> = {}
): string {
  const localeMessages = isChineseLocale() ? messages.zh : messages.en;
  let message = localeMessages[key] ?? messages.en[key] ?? key;

  Object.entries(params).forEach(([name, value]) => {
    message = message.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
  });

  return message;
}
