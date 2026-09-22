import * as vscode from 'vscode';
import { createOpenAIApi } from './openai-utils';
import { t } from './i18n';

/**
 * 模型配置档案接口。
 */
export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  extraBody?: string;
}

/**
 * AI Commit 插件使用的配置键。
 * @constant {Object}
 * @property {string} PROFILES - 多组配置档案列表。
 * @property {string} ACTIVE_PROFILE_ID - 当前生效的配置档案 ID。
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
  PROFILES = 'PROFILES',
  ACTIVE_PROFILE_ID = 'ACTIVE_PROFILE_ID',

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
  private isSyncing = false;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.disposable = vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (this.isSyncing) {
        return;
      }

      if (event.affectsConfiguration('ai-commit')) {
        this.configCache.clear();

        if (
          event.affectsConfiguration('ai-commit.ACTIVE_PROFILE_ID') ||
          event.affectsConfiguration('ai-commit.PROFILES')
        ) {
          const active = this.getActiveProfile();
          this.isSyncing = true;
          try {
            await this.syncProfileToFlatConfig(active);
          } finally {
            this.isSyncing = false;
          }
        } else if (
          event.affectsConfiguration('ai-commit.OPENAI_API_KEY') ||
          event.affectsConfiguration('ai-commit.OPENAI_BASE_URL') ||
          event.affectsConfiguration('ai-commit.OPENAI_MODEL') ||
          event.affectsConfiguration('ai-commit.OPENAI_TEMPERATURE') ||
          event.affectsConfiguration('ai-commit.OPENAI_EXTRA_BODY')
        ) {
          const config = vscode.workspace.getConfiguration('ai-commit');
          const profiles = this.getProfiles();
          const activeId = this.getActiveProfileId();
          const index = profiles.findIndex((p) => p.id === activeId);
          if (index !== -1) {
            profiles[index] = {
              ...profiles[index],
              apiKey: config.get<string>('OPENAI_API_KEY', profiles[index].apiKey),
              baseUrl: config.get<string>('OPENAI_BASE_URL', profiles[index].baseUrl),
              model: config.get<string>('OPENAI_MODEL', profiles[index].model),
              temperature: config.get<number>(
                'OPENAI_TEMPERATURE',
                profiles[index].temperature ?? 0.7
              ),
              extraBody: config.get<string>(
                'OPENAI_EXTRA_BODY',
                profiles[index].extraBody ?? ''
              )
            };
            this.isSyncing = true;
            try {
              await config.update(
                'PROFILES',
                profiles,
                vscode.ConfigurationTarget.Global
              );
            } finally {
              this.isSyncing = false;
            }
          }
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

  /**
   * 从扁平配置创建后备默认档案。
   */
  public createFallbackProfileFromFlatConfig(): ModelProfile {
    const config = vscode.workspace.getConfiguration('ai-commit');
    const apiKey = config.get<string>('OPENAI_API_KEY', '') || '';
    const baseUrl = config.get<string>('OPENAI_BASE_URL', '') || '';
    const model = config.get<string>('OPENAI_MODEL', 'gpt-5-mini') || 'gpt-5-mini';
    const temperature = config.get<number>('OPENAI_TEMPERATURE', 0.7);
    const extraBody = config.get<string>('OPENAI_EXTRA_BODY', '') || '';

    return {
      id: 'default',
      name: 'Default',
      apiKey,
      baseUrl,
      model,
      temperature,
      extraBody
    };
  }

  /**
   * 获取所有配置档案。
   */
  public getProfiles(): ModelProfile[] {
    const config = vscode.workspace.getConfiguration('ai-commit');
    const profiles = config.get<ModelProfile[]>('PROFILES', []);
    if (!Array.isArray(profiles)) {
      return [];
    }
    return profiles.filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' &&
        typeof p.name === 'string'
    );
  }

  /**
   * 获取当前生效档案 ID。
   */
  public getActiveProfileId(): string {
    const config = vscode.workspace.getConfiguration('ai-commit');
    return config.get<string>('ACTIVE_PROFILE_ID', 'default') || 'default';
  }

  /**
   * 获取当前生效配置档案。
   */
  public getActiveProfile(): ModelProfile {
    const profiles = this.getProfiles();
    if (profiles.length === 0) {
      return this.createFallbackProfileFromFlatConfig();
    }
    const activeId = this.getActiveProfileId();
    const active = profiles.find((p) => p.id === activeId);
    return active || profiles[0];
  }

  /**
   * 确保多档案配置已初始化，若为空则由旧扁平配置创建默认档案。
   */
  public async ensureProfilesInitialized(): Promise<void> {
    const config = vscode.workspace.getConfiguration('ai-commit');
    const profiles = this.getProfiles();

    if (profiles.length === 0) {
      const defaultProfile = this.createFallbackProfileFromFlatConfig();
      this.isSyncing = true;
      try {
        await config.update(
          'PROFILES',
          [defaultProfile],
          vscode.ConfigurationTarget.Global
        );
        await config.update(
          'ACTIVE_PROFILE_ID',
          defaultProfile.id,
          vscode.ConfigurationTarget.Global
        );
        await this.syncProfileToFlatConfig(defaultProfile);
      } finally {
        this.isSyncing = false;
      }
      return;
    }

    const activeId = this.getActiveProfileId();
    const hasActive = profiles.some((p) => p.id === activeId);
    if (!hasActive) {
      this.isSyncing = true;
      try {
        await config.update(
          'ACTIVE_PROFILE_ID',
          profiles[0].id,
          vscode.ConfigurationTarget.Global
        );
        await this.syncProfileToFlatConfig(profiles[0]);
      } finally {
        this.isSyncing = false;
      }
    }
  }

  /**
   * 切换当前生效的配置档案 ID，并同步到扁平键。
   */
  public async setActiveProfileId(profileId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('ai-commit');
    const profiles = this.getProfiles();
    const target = profiles.find((p) => p.id === profileId);
    if (!target) {
      throw new Error(`Profile "${profileId}" not found.`);
    }

    this.isSyncing = true;
    try {
      await config.update(
        'ACTIVE_PROFILE_ID',
        profileId,
        vscode.ConfigurationTarget.Global
      );
      await this.syncProfileToFlatConfig(target);
    } finally {
      this.isSyncing = false;
    }
    this.configCache.clear();
  }

  /**
   * 更新当前生效档案的模型，并同步到扁平键。
   */
  public async updateActiveProfileModel(model: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('ai-commit');
    let profiles = this.getProfiles();
    if (profiles.length === 0) {
      await this.ensureProfilesInitialized();
      profiles = this.getProfiles();
    }

    const activeId = this.getActiveProfileId();
    let targetIndex = profiles.findIndex((p) => p.id === activeId);
    if (targetIndex === -1 && profiles.length > 0) {
      targetIndex = 0;
    }

    this.isSyncing = true;
    try {
      if (targetIndex !== -1) {
        profiles[targetIndex] = {
          ...profiles[targetIndex],
          model
        };
        await config.update('PROFILES', profiles, vscode.ConfigurationTarget.Global);
      }
      await config.update('OPENAI_MODEL', model, vscode.ConfigurationTarget.Global);
    } finally {
      this.isSyncing = false;
    }
    this.configCache.clear();
  }

  /**
   * 保存配置档案（新增或更新）。
   */
  public async saveProfile(
    profile: ModelProfile,
    setAsActive: boolean = false
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('ai-commit');
    const profiles = this.getProfiles();
    const index = profiles.findIndex((p) => p.id === profile.id);
    if (index !== -1) {
      profiles[index] = profile;
    } else {
      profiles.push(profile);
    }

    this.isSyncing = true;
    try {
      await config.update('PROFILES', profiles, vscode.ConfigurationTarget.Global);
      if (setAsActive) {
        await config.update(
          'ACTIVE_PROFILE_ID',
          profile.id,
          vscode.ConfigurationTarget.Global
        );
        await this.syncProfileToFlatConfig(profile);
      }
    } finally {
      this.isSyncing = false;
    }
    this.configCache.clear();
  }

  /**
   * 将档案设置同步回写到扁平 OPENAI_* 配置中。
   */
  public async syncProfileToFlatConfig(profile: ModelProfile): Promise<void> {
    const config = vscode.workspace.getConfiguration('ai-commit');
    await config.update(
      'OPENAI_API_KEY',
      profile.apiKey ?? '',
      vscode.ConfigurationTarget.Global
    );
    await config.update(
      'OPENAI_BASE_URL',
      profile.baseUrl ?? '',
      vscode.ConfigurationTarget.Global
    );
    await config.update(
      'OPENAI_MODEL',
      profile.model ?? 'gpt-5-mini',
      vscode.ConfigurationTarget.Global
    );
    await config.update(
      'OPENAI_TEMPERATURE',
      profile.temperature ?? 0.7,
      vscode.ConfigurationTarget.Global
    );
    await config.update(
      'OPENAI_EXTRA_BODY',
      profile.extraBody ?? '',
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * 获取配置值。对于 OpenAI 相关项，优先从当前生效档案返回。
   */
  getConfig<T>(key: string, defaultValue?: T): T {
    const activeProfile = this.getActiveProfile();
    switch (key) {
      case ConfigKeys.OPENAI_API_KEY:
        return (activeProfile.apiKey as unknown as T) ?? defaultValue;
      case ConfigKeys.OPENAI_BASE_URL:
        return (activeProfile.baseUrl as unknown as T) ?? defaultValue;
      case ConfigKeys.OPENAI_MODEL:
        return (activeProfile.model as unknown as T) ?? defaultValue;
      case ConfigKeys.OPENAI_TEMPERATURE:
        return ((activeProfile.temperature ?? 0.7) as unknown as T) ?? defaultValue;
      case ConfigKeys.OPENAI_EXTRA_BODY:
        return ((activeProfile.extraBody ?? '') as unknown as T) ?? defaultValue;
      case ConfigKeys.ACTIVE_PROFILE_ID:
        return (activeProfile.id as unknown as T) ?? defaultValue;
      case ConfigKeys.PROFILES:
        return (this.getProfiles() as unknown as T) ?? defaultValue;
      default:
        if (!this.configCache.has(key)) {
          const config = vscode.workspace.getConfiguration('ai-commit');
          this.configCache.set(key, config.get<T>(key, defaultValue));
        }
        return this.configCache.get(key);
    }
  }

  dispose() {
    this.disposable.dispose();
  }

  /**
   * 强制拉取当前生效档案的可用 OpenAI 兼容模型列表。
   */
  public async fetchAvailableModelsForActiveProfile(): Promise<string[]> {
    const activeProfile = this.getActiveProfile();
    if (!activeProfile.apiKey) {
      throw new Error(t('error.apiKeyMissingProfile', { profile: activeProfile.name }));
    }

    const openai = createOpenAIApi(activeProfile);
    const response = await openai.models.list();
    let modelIds: string[] = [];

    if (Array.isArray(response?.data)) {
      modelIds = response.data.map((item: any) => item.id).filter(Boolean);
    } else if (Array.isArray(response)) {
      modelIds = (response as any[]).map((item: any) => item.id).filter(Boolean);
    }

    modelIds.sort();
    await this.context.globalState.update('availableOpenAIModels', modelIds);
    return modelIds;
  }

  /**
   * 获取可用的 OpenAI 兼容模型列表。
   * @returns {Promise<string[]>} 可用模型列表。
   */
  public async getAvailableOpenAIModels(): Promise<string[]> {
    return this.fetchAvailableModelsForActiveProfile();
  }
}
