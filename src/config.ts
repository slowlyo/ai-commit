import * as vscode from 'vscode';
import { createOpenAIApi } from './openai-utils';

/**
 * AI Commit 插件使用的配置键。
 * @constant {Object}
 * @property {string} OPENAI_API_KEY - OpenAI 兼容接口密钥。
 * @property {string} OPENAI_BASE_URL - OpenAI 兼容接口地址。
 * @property {string} OPENAI_MODEL - OpenAI 兼容模型名称。
 * @property {string} AI_COMMIT_LANGUAGE - 提交信息语言。
 * @property {string} USE_GITMOJI - 是否在提交信息中使用 Gitmoji。
 * @property {string} SYSTEM_PROMPT - 生成提交信息时使用的系统提示词。
 * @property {string} SYSTEM_PROMPT_MODE - 自定义系统提示词的使用方式。
 * @property {string} OPENAI_TEMPERATURE - OpenAI 兼容接口 temperature 参数。
 * @property {string} OPENAI_EXTRA_BODY - OpenAI 兼容接口额外请求体参数。
 */
export enum ConfigKeys {
  OPENAI_API_KEY = 'OPENAI_API_KEY',
  OPENAI_BASE_URL = 'OPENAI_BASE_URL',
  OPENAI_MODEL = 'OPENAI_MODEL',
  AI_COMMIT_LANGUAGE = 'AI_COMMIT_LANGUAGE',
  USE_GITMOJI = 'USE_GITMOJI',
  SYSTEM_PROMPT = 'AI_COMMIT_SYSTEM_PROMPT',
  SYSTEM_PROMPT_MODE = 'AI_COMMIT_SYSTEM_PROMPT_MODE',
  OPENAI_TEMPERATURE = 'OPENAI_TEMPERATURE',
  OPENAI_EXTRA_BODY = 'OPENAI_EXTRA_BODY',
  DIFF_SOURCE = 'DIFF_SOURCE',

  SCM_INPUT_BEHAVIOR = 'SCM_INPUT_BEHAVIOR',

  REFERENCE_GIT_LOG = 'REFERENCE_GIT_LOG',
  GIT_LOG_COUNT = 'GIT_LOG_COUNT',
  GIT_LOG_AUTHOR_SCOPE = 'GIT_LOG_AUTHOR_SCOPE'
}

/**
 * 管理 AI Commit 插件配置。
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private configCache: Map<string, any> = new Map();
  private disposable: vscode.Disposable;
  private context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ai-commit')) {
        this.configCache.clear();

        if (
          event.affectsConfiguration('ai-commit.OPENAI_BASE_URL') ||
          event.affectsConfiguration('ai-commit.OPENAI_API_KEY')
        ) {
          this.updateOpenAIModelList();
        }
      }
    });
  }

  static getInstance(context?: vscode.ExtensionContext): ConfigurationManager {
    if (!this.instance && context) {
      this.instance = new ConfigurationManager(context);
    }
    return this.instance;
  }

  getConfig<T>(key: string, defaultValue?: T): T {
    if (!this.configCache.has(key)) {
      const config = vscode.workspace.getConfiguration('ai-commit');
      this.configCache.set(key, config.get<T>(key, defaultValue));
    }
    return this.configCache.get(key);
  }

  dispose() {
    this.disposable.dispose();
  }

  /**
   * 更新可用的 OpenAI 兼容模型列表。
   */
  private async updateOpenAIModelList() {
    try {
      const openai = createOpenAIApi();
      const models = await openai.models.list();

      await this.context.globalState.update(
        'availableOpenAIModels',
        models.data.map((model) => model.id)
      );

      const config = vscode.workspace.getConfiguration('ai-commit');
      const currentModel = config.get<string>('OPENAI_MODEL');

      const availableModels = models.data.map((model) => model.id);
      if (!availableModels.includes(currentModel)) {
        await config.update(
          'OPENAI_MODEL',
          'gpt-5-mini',
          vscode.ConfigurationTarget.Global
        );
      }
    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error);
    }
  }

  /**
   * 获取可用的 OpenAI 兼容模型列表。
   * @returns {Promise<string[]>} 可用模型列表。
   */
  public async getAvailableOpenAIModels(): Promise<string[]> {
    if (!this.context.globalState.get<string[]>('availableOpenAIModels')) {
      await this.updateOpenAIModelList();
    }
    return this.context.globalState.get<string[]>('availableOpenAIModels', []);
  }
}
