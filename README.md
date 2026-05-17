<a name="readme-top"></a>

<div align="center">

<img height="120" src="https://github.com/slowlyo/ai-commit/blob/main/images/logo.png?raw=true">

<h1>Commit Message AI</h1>

使用 OpenAI (兼容) 应用程序接口审核代码版本管理变更内容，生成符合规范的标准化提交信息，简化提交流程，统一代码提交规范。

**简体中文** · [插件市场][vscode-marketplace-link] · [报告问题][github-issues-link] · [请求功能][github-issues-link]

<!-- SHIELD GROUP -->

</div>

## ✨ 特性

- 🤯 支持使用 OpenAI (兼容) 应用程序接口基于 git diffs 生成提交信息。
- 🗺️ 支持多语言提交信息。
- 😜 支持添加 Gitmoji。
- 🛠️ 支持自定义系统提示词。
- 📝 支持 Conventional Commits 规范。

---

**本项目 Fork 自 [lainbo/ai-commit](https://github.com/lainbo/ai-commit)，并新增以下功能：**

- ✅ 更改 AI 来源为 OpenAI (兼容) 应用程序接口
- ✅ 支持通过 `ai-commit.OPENAI_EXTRA_BODY` 自定义 Chat Completions 请求体参数

## 📦 安装

1. 在 VSCode 中搜索 "AI Commit" 并点击 "Install" 按钮。
2. 从 [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lainbo.nota-ai-commit-lainbo) 直接安装。

> **Note**\
> 请确保 Node.js 版本 >= 16

### ⚙️ 配置

在 VSCode 设置中，找到 "ai-commit" 配置项，并按需配置：

| 配置                 |  类型  |    默认    | 必填 | 说明                                                                                                |
| :------------------- | :----: | :--------: | :--: | :-------------------------------------------------------------------------------------------------- |
| DIFF_SOURCE          | string |    auto    |  否  | 使用哪些改动：`auto`（优先暂存）、`staged`、`unstaged`、`staged+unstaged`（会增加分隔符）。         |
| SCM_INPUT_BEHAVIOR   | string |  context   |  否  | 生成时如何处理输入框：`ignore`（始终忽略），`context`（作为额外上下文/约束发送，例如 Bug ID）。     |
| REFERENCE_GIT_LOG    |  bool  |   false    |  否  | 是否把最近的 `git log --oneline` 提交历史作为额外上下文提供给模型参考（默认关闭）。                 |
| GIT_LOG_COUNT        | number |     20     |  否  | 提供给模型参考的最近提交条数（1-50）。                                                              |
| GIT_LOG_AUTHOR_SCOPE | string |    all     |  否  | 提交历史包含哪些作者：`all` 或 `self`（`self` 使用 `git config user.name` 过滤）。                  |
| OPENAI_API_KEY       | string |    None    |  是  | OpenAI (兼容) API Key。[OpenAI token](https://platform.openai.com/account/api-keys)                 |
| OPENAI_BASE_URL      | string |    None    |  否  | OpenAI (兼容) Base URL。请填写到 `/v1`，例如 `https://api.openai.com/v1`。                          |
| OPENAI_MODEL         | string | gpt-5-mini |  是  | OpenAI (兼容) 模型；你可以运行 `Show Available OpenAI Models` 命令从列表中选择一个模型。            |
| OPENAI_TEMPERATURE   | number |    0.7     |  否  | 控制输出随机性。范围：0-2。值越低越集中，值越高越有创造性。                                         |
| OPENAI_EXTRA_BODY    | string |    None    |  否  | OpenAI (兼容) Chat Completions 额外请求体参数，必须是 JSON 对象。例如：`{"reasoning_split":true}`。 |
| AI_COMMIT_LANGUAGE   | string |     en     |  是  | 支持 19 种语言                                                                                      |
| SYSTEM_PROMPT        | string |    None    |  否  | 自定义系统提示词                                                                                    |

---

## 📝 许可证

本项目使用 [MIT](./license) 许可证。

<!-- LINK GROUP -->

[github-issues-link]: https://github.com/slowlyo/ai-commit/issues
[vscode-marketplace-link]: https://marketplace.visualstudio.com/items?itemName=lainbo.nota-ai-commit-lainbo
