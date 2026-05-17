import * as vscode from 'vscode';
import { CommandManager } from './commands';
import { ConfigurationManager } from './config';
import { initOutputChannel, logError } from './output';
import { t } from './i18n';

/**
 * 激活插件并注册命令。
 *
 * @param {vscode.ExtensionContext} context - 插件上下文。
 */
export async function activate(context: vscode.ExtensionContext) {
  try {
    initOutputChannel(context);
    const configManager = ConfigurationManager.getInstance(context);

    const commandManager = new CommandManager(context);
    commandManager.registerCommands();

    context.subscriptions.push({
      dispose: () => {
        configManager.dispose();
        commandManager.dispose();
      }
    });

    const apiKey = configManager.getConfig<string>('OPENAI_API_KEY');
    if (!apiKey) {
      const result = await vscode.window.showWarningMessage(
        t('message.configureApiKey'),
        t('button.yes'),
        t('button.no')
      );

      if (result === t('button.yes')) {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'ai-commit.OPENAI_API_KEY'
        );
      }
    }
  } catch (error) {
    console.error('Failed to activate extension:', error);
    logError(error, '扩展激活失败');
    throw error;
  }
}

/**
 * 停用插件。
 */
export function deactivate() {}
