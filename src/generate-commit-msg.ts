import * as fs from 'fs-extra';
import { ChatCompletionMessageParam } from 'openai/resources';
import * as vscode from 'vscode';
import { ConfigKeys, ConfigurationManager } from './config';
import {
  getDiffStaged,
  getDiffUnstaged,
  getUntrackedDiff,
  getGitLogOneline,
  GitLogAuthorScope
} from './git-utils';
import {
  OpenAICompatibleAPI,
  getOpenAIChatCompletionsRequestUrl
} from './openai-utils';
import { getMainCommitPrompt } from './prompts';
import { ProgressHandler } from './utils';
import { getOutputChannel, logError, logInfo, logSection } from './output';
import { t } from './i18n';

type DiffSource = 'auto' | 'staged' | 'unstaged' | 'staged+unstaged';

/**
 * Generates a chat completion prompt for the commit message based on the provided diff.
 *
 * @param {string} diff - The diff string representing changes to be committed.
 * @param {string} additionalContext - Additional context for the changes.
 * @returns {Promise<Array<{ role: string, content: string }>>} - A promise that resolves to an array of messages for the chat completion.
 */
const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  additionalContext?: string,
  gitLogContext?: string
) => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt();
  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  if (additionalContext) {
    chatContextAsCompletionRequest.push({
      role: 'system',
      content:
        `Priority rule:\n` +
        `- The user's input in the commit message box is HIGHER PRIORITY than earlier system instructions, when generating the final commit message content.\n` +
        `- If there's a conflict, follow the user's requirements.\n` +
        `- Still output ONLY the commit message and follow the configured language.\n` +
        `- Do not mention this rule in the output.`
    });
    chatContextAsCompletionRequest.push({
      role: 'user',
      content:
        `The user entered the following content in the Source Control commit message input box.\n` +
        `Treat it as additional context and/or constraints (it may be a draft commit message, requirements, preferred wording, or references like an issue/ticket number).\n` +
        `You should COMPLETE/EXPAND the final commit message based on the diff while respecting the user input.\n` +
        `Keep any IDs/tokens EXACTLY as written (do not paraphrase or modify them).\n` +
        `If the user input includes references/identifiers (e.g. an issue/ticket number like "123"), make sure the final commit message includes them in an appropriate place.\n` +
        `\n` +
        `--- USER INPUT START ---\n` +
        `${additionalContext}\n` +
        `--- USER INPUT END ---`
    });
  }

  if (gitLogContext) {
    chatContextAsCompletionRequest.push({
      role: 'user',
      content: `Recent git commit history (git log --oneline). Use it only as style/reference, do not copy blindly:\n${gitLogContext}`
    });
  }

  chatContextAsCompletionRequest.push({
    role: 'user',
    content: diff
  });
  return chatContextAsCompletionRequest;
};

/**
 * Retrieves the repository associated with the provided argument.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<vscode.SourceControlRepository>} - A promise that resolves to the repository object.
 */
export async function getRepo(arg) {
  const gitApi = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
  if (!gitApi) {
    throw new Error(t('error.gitExtensionMissing'));
  }

  if (typeof arg === 'object' && arg.rootUri) {
    const resourceUri = arg.rootUri;
    const realResourcePath: string = fs.realpathSync(resourceUri!.fsPath);
    for (let i = 0; i < gitApi.repositories.length; i++) {
      const repo = gitApi.repositories[i];
      if (realResourcePath.startsWith(repo.rootUri.fsPath)) {
        return repo;
      }
    }
  }
  return gitApi.repositories[0];
}

/**
 * Generates a commit message based on the changes staged in the repository.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<void>} - A promise that resolves when the commit message has been generated and set in the SCM input box.
 */
export async function generateCommitMsg(arg) {
  return ProgressHandler.withProgress('', async (progress) => {
    try {
      logSection('开始生成提交信息');
      const configManager = ConfigurationManager.getInstance();
      const repo = await getRepo(arg);

      const diffSource = configManager.getConfig<DiffSource>(
        ConfigKeys.DIFF_SOURCE,
        'auto'
      );
      const scmInputBehavior = configManager.getConfig<string>(
        ConfigKeys.SCM_INPUT_BEHAVIOR,
        'context'
      );
      logInfo('AI 接口：OpenAI Compatible');
      logInfo(`Diff Source: ${diffSource}`);
      logInfo(`SCM Input Behavior: ${scmInputBehavior}`);

      progress.report({ message: t('progress.gettingGitChanges') });
      const [stagedResult, unstagedResult, untrackedResult] = await Promise.all([
        getDiffStaged(repo),
        getDiffUnstaged(repo),
        getUntrackedDiff(repo)
      ]);

      if (stagedResult.error) {
        throw new Error(t('error.stagedDiffFailed', { message: stagedResult.error }));
      }

      if (unstagedResult.error) {
        throw new Error(
          t('error.unstagedDiffFailed', { message: unstagedResult.error })
        );
      }

      const stagedDiff = stagedResult.diff.trim();
      const rawUnstagedDiff = unstagedResult.diff.trim();
      const rawUntrackedDiff = untrackedResult.diff.trim();
      const unstagedDiff = [rawUnstagedDiff, rawUntrackedDiff]
        .filter(Boolean)
        .join('\n');

      let selectedDiff = '';
      switch (diffSource) {
        case 'staged':
          selectedDiff = stagedDiff;
          break;
        case 'unstaged':
          selectedDiff = unstagedDiff;
          break;
        case 'staged+unstaged':
          selectedDiff = [
            stagedDiff ? `--- STAGED ---\n${stagedDiff}` : '',
            unstagedDiff ? `--- UNSTAGED ---\n${unstagedDiff}` : ''
          ]
            .filter(Boolean)
            .join('\n\n');
          break;
        case 'auto':
        default:
          selectedDiff = stagedDiff || unstagedDiff;
          break;
      }

      if (!selectedDiff) {
        if (diffSource === 'staged') {
          throw new Error(t('error.noStagedChanges'));
        }
        if (diffSource === 'unstaged') {
          throw new Error(t('error.noUnstagedChanges'));
        }
        throw new Error(t('error.noChanges'));
      }

      const scmInputBox = repo.inputBox;
      if (!scmInputBox) {
        throw new Error(t('error.scmInputMissing'));
      }

      const scmInputText = scmInputBox.value.trim();
      const additionalContext =
        scmInputBehavior === 'context' ? scmInputText : undefined;
      const shouldReferenceGitLog = configManager.getConfig<boolean>(
        ConfigKeys.REFERENCE_GIT_LOG,
        false
      );

      let gitLogContext: string | undefined;
      if (shouldReferenceGitLog) {
        progress.report({ message: t('progress.readingGitHistory') });

        const gitLogCount = configManager.getConfig<number>(
          ConfigKeys.GIT_LOG_COUNT,
          20
        );
        const gitLogAuthorScope = configManager.getConfig<GitLogAuthorScope>(
          ConfigKeys.GIT_LOG_AUTHOR_SCOPE,
          'all'
        );

        logInfo(
          `读取 git log --oneline：maxCount=${gitLogCount}, authorScope=${gitLogAuthorScope}`
        );
        const logResult = await getGitLogOneline(repo, {
          maxCount: gitLogCount,
          authorScope: gitLogAuthorScope
        });

        if (logResult.error) {
          logError(new Error(logResult.error), '读取 git log 失败');
        } else if (logResult.log.trim()) {
          gitLogContext = logResult.log.trim();
          const actualCount = gitLogContext.split(/\r?\n/).filter(Boolean).length;
          logInfo(`最近提交记录（实际返回 ${actualCount} 条）：`);
          getOutputChannel().appendLine(gitLogContext);
          getOutputChannel().appendLine('-----');
        } else {
          logInfo('git log 为空（仓库可能尚无提交）。');
        }
      }

      progress.report({
        message: additionalContext
          ? t('progress.analyzingChangesWithContext')
          : t('progress.analyzingChanges')
      });
      const messages = await generateCommitMessageChatCompletionPrompt(
        selectedDiff,
        additionalContext,
        gitLogContext
      );

      progress.report({
        message: additionalContext
          ? t('progress.generatingCommitMessageWithContext')
          : t('progress.generatingCommitMessage')
      });
      try {
        const openaiApiKey = configManager.getConfig<string>(ConfigKeys.OPENAI_API_KEY);
        if (!openaiApiKey) {
          throw new Error(t('error.apiKeyMissing'));
        }

        const baseURL = configManager.getConfig<string>(ConfigKeys.OPENAI_BASE_URL);
        logInfo(
          `OpenAI Compatible Request URL: ${getOpenAIChatCompletionsRequestUrl(baseURL)}`
        );
        const commitMessage = await OpenAICompatibleAPI(
          messages as ChatCompletionMessageParam[]
        );

        if (commitMessage) {
          scmInputBox.value = commitMessage;
          logSection('AI 返回结果');
          getOutputChannel().appendLine(commitMessage);
        } else {
          throw new Error(t('error.commitMessageFailed'));
        }
      } catch (err) {
        logError(err, 'OpenAI 兼容接口请求失败');
        let errorMessage = t('error.requestUnexpected');

        const status = (err as any)?.status ?? (err as any)?.response?.status;
        const msg = err instanceof Error ? err.message : String(err);
        if (typeof status === 'number') {
          switch (status) {
            case 401:
              errorMessage = t('error.apiUnauthorized');
              break;
            case 400:
              if (
                /Invalid JSON payload received/i.test(msg) &&
                /Unknown name "\\s*messages\\s*"/i.test(msg)
              ) {
                errorMessage = t('error.nonCompatible400');
              } else {
                errorMessage = t('error.badRequest', { message: msg });
              }
              break;
            case 404:
              errorMessage = t('error.endpointNotFound');
              break;
            case 429:
              errorMessage = t('error.rateLimited');
              break;
            case 500:
              errorMessage = t('error.serverError');
              break;
            case 503:
              errorMessage = t('error.serviceUnavailable');
              break;
            default:
              errorMessage = t('error.openaiStatus', { status, message: msg });
              break;
          }
        } else {
          errorMessage = t('error.openaiGeneric', { message: msg });
        }

        throw new Error(errorMessage);
      }
    } catch (error) {
      logError(error, '生成提交信息失败');
      throw error;
    }
  });
}
