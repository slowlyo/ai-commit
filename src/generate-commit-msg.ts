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
  getOpenAIChatCompletionsRequestUrl,
  isAbortError
} from './openai-utils';
import { getMainCommitPrompt } from './prompts';
import { ProgressHandler } from './utils';
import { getOutputChannel, logError, logInfo, logSection } from './output';
import { t } from './i18n';

type DiffSource = 'auto' | 'staged' | 'unstaged' | 'staged+unstaged';

/**
 * 移除模型输出末尾的空白行，保留提交信息正文内部换行。
 */
function trimTrailingBlankLines(message: string): string {
  return message.replace(/(?:\r?\n[ \t]*)+$/g, '');
}

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
const MAX_DIFF_LENGTH = 30000;
const TRUNCATE_HEAD_LENGTH = 20000;
const TRUNCATE_TAIL_LENGTH = 5000;

/**
 * 若 diff 过大，保留头尾并安全截断，避免模型请求拖慢或超时。
 */
function truncateDiffIfNeeded(diff: string): string {
  if (diff.length <= MAX_DIFF_LENGTH) {
    return diff;
  }

  const omittedCount = diff.length - TRUNCATE_HEAD_LENGTH - TRUNCATE_TAIL_LENGTH;
  logInfo(
    t('info.diffTruncated', {
      length: diff.length,
      limit: MAX_DIFF_LENGTH
    })
  );

  const head = diff.slice(0, TRUNCATE_HEAD_LENGTH);
  const tail = diff.slice(-TRUNCATE_TAIL_LENGTH);

  return `${head}\n\n... [Diff truncated by AI Commit: original length ${diff.length} chars exceeded limit of ${MAX_DIFF_LENGTH}. Omitted ${omittedCount} characters to optimize performance.] ...\n\n${tail}`;
}

/**
 * 根据 DIFF_SOURCE 按需收集 Git 变更，减少无用调用。
 */
async function collectGitDiff(
  repo: any,
  diffSource: DiffSource,
  token?: vscode.CancellationToken
): Promise<string> {
  if (token?.isCancellationRequested) {
    return '';
  }

  let selectedDiff = '';

  switch (diffSource) {
    case 'staged': {
      logInfo('按需读取 Git 变更：仅读取暂存区 (staged)');
      const stagedResult = await getDiffStaged(repo);
      if (token?.isCancellationRequested) {
        return '';
      }
      if (stagedResult.error) {
        throw new Error(t('error.stagedDiffFailed', { message: stagedResult.error }));
      }
      selectedDiff = stagedResult.diff.trim();
      if (!selectedDiff) {
        throw new Error(t('error.noStagedChanges'));
      }
      break;
    }

    case 'unstaged': {
      logInfo('按需读取 Git 变更：仅读取未暂存和未跟踪文件 (unstaged + untracked)');
      const [unstagedResult, untrackedResult] = await Promise.all([
        getDiffUnstaged(repo),
        getUntrackedDiff(repo)
      ]);
      if (token?.isCancellationRequested) {
        return '';
      }
      if (unstagedResult.error) {
        throw new Error(
          t('error.unstagedDiffFailed', { message: unstagedResult.error })
        );
      }
      const rawUnstagedDiff = unstagedResult.diff.trim();
      const rawUntrackedDiff = untrackedResult.diff.trim();
      selectedDiff = [rawUnstagedDiff, rawUntrackedDiff].filter(Boolean).join('\n');
      if (!selectedDiff) {
        throw new Error(t('error.noUnstagedChanges'));
      }
      break;
    }

    case 'staged+unstaged': {
      logInfo(
        '按需读取 Git 变更：同时读取暂存区与未暂存区 (staged + unstaged + untracked)'
      );
      const [stagedResult, unstagedResult, untrackedResult] = await Promise.all([
        getDiffStaged(repo),
        getDiffUnstaged(repo),
        getUntrackedDiff(repo)
      ]);
      if (token?.isCancellationRequested) {
        return '';
      }
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

      selectedDiff = [
        stagedDiff ? `--- STAGED ---\n${stagedDiff}` : '',
        unstagedDiff ? `--- UNSTAGED ---\n${unstagedDiff}` : ''
      ]
        .filter(Boolean)
        .join('\n\n');

      if (!selectedDiff) {
        throw new Error(t('error.noChanges'));
      }
      break;
    }

    case 'auto':
    default: {
      logInfo('按需读取 Git 变更：auto 模式优先读取暂存区 (staged)');
      const stagedResult = await getDiffStaged(repo);
      if (token?.isCancellationRequested) {
        return '';
      }
      if (stagedResult.error) {
        throw new Error(t('error.stagedDiffFailed', { message: stagedResult.error }));
      }
      const stagedDiff = stagedResult.diff.trim();
      if (stagedDiff) {
        logInfo('auto 模式：检测到暂存区变更，跳过未暂存及未跟踪文件拉取');
        selectedDiff = stagedDiff;
      } else {
        logInfo('auto 模式：暂存区为空，回退拉取未暂存及未跟踪文件');
        const [unstagedResult, untrackedResult] = await Promise.all([
          getDiffUnstaged(repo),
          getUntrackedDiff(repo)
        ]);
        if (token?.isCancellationRequested) {
          return '';
        }
        if (unstagedResult.error) {
          throw new Error(
            t('error.unstagedDiffFailed', { message: unstagedResult.error })
          );
        }
        const rawUnstagedDiff = unstagedResult.diff.trim();
        const rawUntrackedDiff = untrackedResult.diff.trim();
        selectedDiff = [rawUnstagedDiff, rawUntrackedDiff].filter(Boolean).join('\n');
      }

      if (!selectedDiff) {
        throw new Error(t('error.noChanges'));
      }
      break;
    }
  }

  return selectedDiff;
}

/**
 * Generates a commit message based on the changes staged in the repository.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<void>} - A promise that resolves when the commit message has been generated and set in the SCM input box.
 */
export async function generateCommitMsg(arg) {
  return ProgressHandler.withProgress('', async (progress, token) => {
    let cancellationHandled = false;
    const notifyCancelled = () => {
      if (!cancellationHandled) {
        cancellationHandled = true;
        logInfo(t('message.generationCancelled'));
        vscode.window.showInformationMessage(t('message.generationCancelled'));
      }
    };

    try {
      logSection('开始生成提交信息');
      if (token.isCancellationRequested) {
        notifyCancelled();
        return;
      }

      const configManager = ConfigurationManager.getInstance();
      const repo = await getRepo(arg);

      if (token.isCancellationRequested) {
        notifyCancelled();
        return;
      }

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
      const rawDiff = await collectGitDiff(repo, diffSource, token);

      if (token.isCancellationRequested) {
        notifyCancelled();
        return;
      }

      const selectedDiff = truncateDiffIfNeeded(rawDiff);

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
        if (token.isCancellationRequested) {
          notifyCancelled();
          return;
        }
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

        if (token.isCancellationRequested) {
          notifyCancelled();
          return;
        }

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

      if (token.isCancellationRequested) {
        notifyCancelled();
        return;
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

      if (token.isCancellationRequested) {
        notifyCancelled();
        return;
      }

      progress.report({
        message: additionalContext
          ? t('progress.generatingCommitMessageWithContext')
          : t('progress.generatingCommitMessage')
      });
      try {
        const activeProfile = configManager.getActiveProfile();
        const openaiApiKey = activeProfile.apiKey;
        if (!openaiApiKey) {
          throw new Error(
            t('error.apiKeyMissingProfile', { profile: activeProfile.name })
          );
        }

        const baseURL = activeProfile.baseUrl;
        logInfo(`Active Profile: ${activeProfile.name} (${activeProfile.id})`);
        logInfo(`Model: ${activeProfile.model}`);
        logInfo(
          `OpenAI Compatible Request URL: ${getOpenAIChatCompletionsRequestUrl(baseURL)}`
        );
        const commitMessage = trimTrailingBlankLines(
          await OpenAICompatibleAPI(messages as ChatCompletionMessageParam[], {
            cancellationToken: token
          })
        );

        if (token.isCancellationRequested) {
          notifyCancelled();
          return;
        }

        if (commitMessage) {
          scmInputBox.value = commitMessage;
          logSection('AI 返回结果');
          getOutputChannel().appendLine(commitMessage);
        } else {
          throw new Error(t('error.commitMessageFailed'));
        }
      } catch (err) {
        if (token.isCancellationRequested || isAbortError(err)) {
          notifyCancelled();
          return;
        }
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
      if (token?.isCancellationRequested || isAbortError(error)) {
        notifyCancelled();
        return;
      }
      logError(error, '生成提交信息失败');
      throw error;
    }
  });
}
