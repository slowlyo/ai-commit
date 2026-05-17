import * as vscode from 'vscode';
import { generateCommitMsg } from './generate-commit-msg';
import { ConfigurationManager } from './config';
import { logError } from './output';
import { t } from './i18n';

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

    this.registerCommand('ai-commit.showAvailableModels', async () => {
      const configManager = ConfigurationManager.getInstance();
      const models = await configManager.getAvailableOpenAIModels();
      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: t('placeholder.selectModel')
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration('ai-commit');
        await config.update(
          'OPENAI_MODEL',
          selected,
          vscode.ConfigurationTarget.Global
        );
      }
    });
  }

  private registerCommand(command: string, handler: (...args: any[]) => any) {
    const disposable = vscode.commands.registerCommand(command, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
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
