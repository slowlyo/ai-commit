import * as vscode from 'vscode';
import { generateCommitMsg } from './generate-commit-msg';
import { ConfigurationManager, ModelProfile } from './config';
import { logError } from './output';
import { isAbortError } from './openai-utils';
import { t } from './i18n';

interface ProfileQuickPickItem extends vscode.QuickPickItem {
  profileId?: string;
  isAddAction?: boolean;
}

/**
 * 引导用户创建新的配置档案。
 */
async function promptCreateProfile(configManager: ConfigurationManager) {
  const name = await vscode.window.showInputBox({
    title: t('profile.addNewProfile'),
    prompt: t('profile.inputName'),
    placeHolder: t('profile.inputNamePlaceholder'),
    validateInput: (val) => (!val?.trim() ? t('error.nameRequired') : null)
  });
  if (!name) {
    return;
  }

  const baseUrl = await vscode.window.showInputBox({
    title: t('profile.addNewProfile'),
    prompt: t('profile.inputBaseUrl'),
    placeHolder: t('profile.inputBaseUrlPlaceholder')
  });
  if (baseUrl === undefined) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: t('profile.addNewProfile'),
    prompt: t('profile.inputApiKey'),
    placeHolder: t('profile.inputApiKeyPlaceholder'),
    password: true
  });
  if (apiKey === undefined) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: t('profile.addNewProfile'),
    prompt: t('profile.inputModel'),
    placeHolder: t('profile.inputModelPlaceholder'),
    value: 'gpt-5-mini'
  });
  if (model === undefined) {
    return;
  }

  const id = `profile_${Date.now()}`;
  const newProfile: ModelProfile = {
    id,
    name: name.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim() || 'gpt-5-mini'
  };

  await configManager.saveProfile(newProfile, true);
  vscode.window.showInformationMessage(
    t('profile.createdAndActivated', { name: newProfile.name })
  );
}

/**
 * 管理命令注册和释放。
 */
export class CommandManager {
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {}

  registerCommands() {
    this.registerCommand('extension.ai-commit', generateCommitMsg);
    this.registerCommand('extension.configure-ai-commit', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'ai-commit')
    );

    this.registerCommand('ai-commit.selectProfile', async () => {
      const configManager = ConfigurationManager.getInstance();
      await configManager.ensureProfilesInitialized();
      const profiles = configManager.getProfiles();
      const activeProfile = configManager.getActiveProfile();

      const items: ProfileQuickPickItem[] = profiles.map((p) => {
        const isActive = p.id === activeProfile.id;
        return {
          label: `${isActive ? '$(check) ' : '$(gear) '}${p.name}`,
          description: isActive ? `(${t('profile.active')})` : undefined,
          detail: `Model: ${p.model || '-'} | Base URL: ${p.baseUrl || 'default'}`,
          profileId: p.id
        };
      });

      items.push({
        label: `$(plus) ${t('profile.addNewProfile')}`,
        detail: t('profile.addNewProfileDetail'),
        isAddAction: true
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: t('placeholder.selectProfile'),
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (!selected) {
        return;
      }

      if (selected.isAddAction) {
        await promptCreateProfile(configManager);
      } else if (selected.profileId) {
        await configManager.setActiveProfileId(selected.profileId);
        const newlyActive = configManager.getActiveProfile();
        vscode.window.showInformationMessage(
          t('profile.switched', { name: newlyActive.name })
        );
      }
    });

    this.registerCommand('ai-commit.showAvailableModels', async () => {
      const configManager = ConfigurationManager.getInstance();
      await configManager.ensureProfilesInitialized();
      const activeProfile = configManager.getActiveProfile();

      if (!activeProfile.apiKey) {
        const result = await vscode.window.showErrorMessage(
          t('error.apiKeyMissingProfile', { profile: activeProfile.name }),
          t('button.configure')
        );
        if (result === t('button.configure')) {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'ai-commit'
          );
        }
        return;
      }

      let models: string[] = [];
      try {
        models = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('progress.fetchingModels', { profile: activeProfile.name }),
            cancellable: false
          },
          async () => {
            return await configManager.fetchAvailableModelsForActiveProfile();
          }
        );
      } catch (error) {
        logError(error, `获取可用模型失败 [Profile: ${activeProfile.name}]`);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result = await vscode.window.showErrorMessage(
          t('error.fetchModelsFailed', {
            profile: activeProfile.name,
            message: errorMessage
          }),
          t('button.retry'),
          t('button.configure')
        );

        if (result === t('button.retry')) {
          await vscode.commands.executeCommand('ai-commit.showAvailableModels');
        } else if (result === t('button.configure')) {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'ai-commit'
          );
        }
        return;
      }

      const currentModel = activeProfile.model;
      const qp = vscode.window.createQuickPick();
      qp.title = t('placeholder.selectModelWithProfile', {
        profile: activeProfile.name
      });
      qp.placeholder = t('placeholder.searchOrSelectModel');
      qp.matchOnDescription = true;

      const items: vscode.QuickPickItem[] = [];
      if (currentModel && !models.includes(currentModel)) {
        items.push({
          label: currentModel,
          description: t('profile.currentModelCustom')
        });
      }

      for (const m of models) {
        items.push({
          label: m,
          description: m === currentModel ? t('profile.currentModel') : undefined
        });
      }

      qp.items = items;

      const activeItem = items.find((i) => i.label === currentModel);
      if (activeItem) {
        qp.activeItems = [activeItem];
      }

      qp.onDidAccept(async () => {
        const selected = qp.selectedItems[0]?.label || qp.value.trim();
        qp.hide();
        if (selected) {
          await configManager.updateActiveProfileModel(selected);
          vscode.window.showInformationMessage(
            t('message.modelUpdated', {
              profile: activeProfile.name,
              model: selected
            })
          );
        }
      });

      qp.onDidHide(() => qp.dispose());
      qp.show();
    });
  }

  private registerCommand(command: string, handler: (...args: any[]) => any) {
    const disposable = vscode.commands.registerCommand(command, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        if (
          error instanceof vscode.CancellationError ||
          (error as any)?.name === 'CancellationError' ||
          isAbortError(error)
        ) {
          return;
        }
        logError(error, `命令执行失败：${command}`);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result = await vscode.window.showErrorMessage(
          t('error.commandFailed', { message: errorMessage }),
          t('button.retry'),
          t('button.configure')
        );

        if (result === t('button.retry')) {
          await handler(...args);
        } else if (result === t('button.configure')) {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'ai-commit'
          );
        }
      }
    });

    this.disposables.push(disposable);
    this.context.subscriptions.push(disposable);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
