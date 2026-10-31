## 网页案例交付与视觉解析 · 2026-10-30

本机原生会话配置增加无附件 HTML 模式。模型只通过最终文本返回完整 HTML，网站后台验证完整文档并保存 index.html；没有给普通网页案例开放本机读写、命令或额外搜索工具。非 HTML 的说明文字会明确失败，不能假装成网页产物。旧的文本写作、会话与授权通道保留。

视频解析仍走按任务限定的 read_media。真实测试中 WorkBuddy hy4-preview 表示未辨识画面，只能作为文字整理；WorkBuddy 接入的 kimi-k3.1-pro 已读取六个真实关键帧，并描述可核对的控制面板与水箱布局。型号能被目录列出不等于具备可用视觉能力。新草稿同时记录工具读取与模型是否确认辨识画面，文字整理有明确状态。

## 写作联网与配图 · 2026-10-29 补充

仅 `scene=writing` 的 WorkBuddy 执行开放 WebSearch、WebFetch 与项目内 `writing_web.read_public_page`。腾讯 CLI 的非交互工具调用需在当前进程显式授权；同时以 `--tools` 限制内置工具、禁用命令及文件工具，并用 `--strict-mcp-config` 只加载本项目的只读网页工具。普通案例和其他执行器沿用原有权限。没有修改用户的全局权限、桌面程序或账户登录配置。

内置 WebFetch 会省略网页图片链接，因此新增的 MCP 从公开 HTML 提取 `og:image` 和 `img` 候选，设置 `defer_loading=false` 并显式 NoDefer，确保首轮可见。它不使用登录 Cookie，不读取本机文件；地址解析与每次重定向均验证公开网络，并固定已验证的 DNS 地址。图片须下载、校验格式并注册为本篇本地媒体后才进入正文。保护不意味着来源内容可被自动当作事实，写作仍需保留归属与真实引用。

已用本机 WorkBuddy 的 `deepseek-v4.1-flash` 读取 Python 官网、取得真实 PNG 链接，随后在隔离库完成真实知识库写稿与配图导入。读取 6 篇参考文章，完整流程约 63.2 秒，输入 49,924、输出 682 Token；本地图片 15,770 字节，生成正文中的媒体节点及来源记录。候选不等于每种网站和模型都可用；登录页、禁止抓取、动态页面和失效图片会返回具体失败信息，不伪造成功。

参考：[官方非交互授权](https://www.codebuddy.ai/docs/cli/headless)、[官方 MCP 配置与延迟加载](https://www.codebuddy.cn/docs/cli/mcp)。验证在忽略的 `output/writing-reliability-20261029/`。

# 当前电脑接入验收 · 2026-10-29

本节对应 `/Users/a1234/WorkBuddy/测评网站`，覆盖下方同事 Mac 的路径与授权描述。知识库由同事的 Mac 经局域网提供；不能复用同事机器的 CLI 授权记录。

- 本机安装腾讯官方完整 CodeBuddy CLI，独立登录已完成。初始安装版本 2.177.1，SHA-256 与下方历史安装记录一致；官方客户端自动更新后，本次实际运行版本为 2.178.1。
- 私有 `apps/web/.env.local` 将 `CASEBENCH_WORKBUDDY_PROGRAM` 指向本项目 `tools/codebuddy-cli/codebuddy`，`WORKBUDDY_CONFIG_DIR` 指向 `.casebench/agents/workbuddy-cli/config`。这些路径、授权状态与凭据不提交到仓库。未修改 WorkBuddy 桌面安装包。
- 本机 `hy4-preview` 真实短文本返回“WorkBuddy连接成功”，执行器报告输入 7,809、输出 92 Token，约 11.4 秒（含客户端上下文与思考用量）。
- 真实局域网知识库 + 同一执行器完整写作验收通过：读取 6 篇参考文章，仅 `articles` 进入生成上下文；正文直接保存、版本生成、引用说明留在助手。端到端约 112.4 秒，输入 22,073、输出 2,617 Token。测试使用隔离数据库，不写入正式文章库。
- 隔离网页通过真实 WorkBuddy 对话将已有文稿缩写并直接更新，保存修改前后版本；本轮约 90.5 秒，输入 22,560、输出 1,814 Token，浏览器无错误。并发人工编辑保护另有回归验证。
- 登录后动态目录返回 16 个模型；目录可随版本和账户变化，不等于每个型号已验证。网页接入的是官方 CLI，不代表任务同步到 WorkBuddy 桌面会话。
- 执行健康记录按实际程序路径隔离，旧自定义接口的成功不能证明当前内置模型授权。完整 CLI 不设置桌面 lite bundle 开关。官方登录回调需保持客户端运行；如中断，在上述同一配置目录重新登录。

验证产物保存在忽略的 `output/writing-articles-20261029/`。以下为同事电脑的历史记录，不代表本机其他型号已验证；旧蓝图写作协议已由当前文章参考方式替代。

# 本机 GPT 与腾讯内置模型接入 · 2026-10-28

当前网站已接通 GPT/Codex 与腾讯内置模型。保持现有前端布局、样式和交互。

## 当前执行入口

| 网页选项 | 执行程序 | 登录与可用性 |
| --- | --- | --- |
| GPT 桌面端 | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` | 用户通过官方流程重新登录；账户类型为 ChatGPT，8 个模型候选 |
| WorkBuddy | 项目内 `tools/codebuddy-cli/codebuddy`，腾讯官方 CodeBuddy Code 2.177.1 | 用户通过腾讯国内站授权完整 CLI，19 个内置模型候选 |

WorkBuddy 安装包内的精简后台 CLI 未取得桌面加密凭据的独立调用权限，Auto 实测失败。按照用户“使用原生自带模型”的要求，采用腾讯官方完整 CLI 的独立登录通道；它使用腾讯内置模型，不经过旧豆包自定义 API。实际通过的内置型号为 `hy4-preview` 和 `glm-5.1`。这不是 WorkBuddy 桌面会话同步验收，也没有证明桌面套餐与 CLI 额度的具体共用规则；用量、权限和费用以腾讯账号及执行器实际返回为准。

CLI 从腾讯官方安装脚本指向的发布地址获取，固定版本 2.177.1，下载包 SHA-256 为 `ec8c95cd6d167299ecab035b0ee8ee76d811884ed9a624c91287a4bbe0295552`，校验通过后解压到项目目录。安装包已清理，本机程序及 vendor 资源保留；没有全局安装。

## 本机私有配置

`apps/web/.env.local` 仅配置以下本机运行入口，已被 Git 忽略：

```dotenv
CASEBENCH_WORKBUDDY_PROGRAM=/Users/mac/Documents/Codex/2026-10-22/wo/eval-bench/tools/codebuddy-cli/codebuddy
WORKBUDDY_CONFIG_DIR=/Users/mac/Documents/Codex/2026-10-22/wo/eval-bench/.casebench/agents/workbuddy-cli/config
```

网站和独立 Runner 通过既有环境变量传递使用同一程序和配置目录。登录凭据由官方客户端管理；网站没有保存额外的模型 API 密钥。执行入口和设置写入项目的本机配置，原 WorkBuddy 桌面安装包未修改。

网页使用时刷新页面，在“写作设置”中选择 Agent 和实际型号。已验证 GPT 的 `gpt-6.1-sol`、腾讯内置的 `glm-5.1`；候选目录不代表每个型号都已逐一生成验收。

GPT 如需重新登录，可运行本机 Codex 的 `login`。腾讯 CLI 如需重新授权，在本项目目录运行：

```sh
CODEBUDDY_CONFIG_DIR="$PWD/.casebench/agents/workbuddy-cli/config" ./tools/codebuddy-cli/codebuddy
```

在官方客户端中使用 `/login` 完成账号授权。当前账户已登录，日常使用不需要重复登录。

## 验证记录

- GPT `gpt-6.1-sol` 真实短文本返回“GPT连接成功”，执行器报告输入 29,119、输出 7 Token（包含客户端自身上下文）。
- 腾讯 `hy4-preview` 真实短文本返回“WorkBuddy连接成功”，输入 7,148、输出 7 Token。
- GPT + 真实 Haystack 知识库：取回 6 篇案例，单次真实生成，返回写作 JSON 并保存成正文；端到端约 60 秒。
- 腾讯 `glm-5.1` + 相同真实知识库：取回 6 篇案例，单次真实生成，返回写作 JSON 并保存成正文；端到端约 54 秒。
- 两次写作验收都包含 Humanizer 和完整叙事蓝图上下文，使用隔离临时数据库；测试稿与资料没有进入正式文章库。耗时包含本机检索和执行器启动，不能作为长期性能承诺。
- 既有适配器、原生会话和独立 Runner 的 5 项回归测试通过。
- 旧精简执行器的授权错误及旧豆包账户欠费记录保存在验收输出，当前健康记录对应新执行入口。

结果与原始指标在 `output/local-agents-20261028/`。模型候选仍通过执行器动态读取，不写死到前端。

## 参考

- [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Docs：身份验证](https://learn.chatgpt.com/docs/auth)
- [腾讯官方 CLI 快速入门](https://www.codebuddy.ai/docs/cli/quickstart)
- [腾讯官方 CLI 登录命令](https://www.codebuddy.ai/docs/cli/slash-commands)

只读检查 WorkBuddy 安装包时使用了 REA 技能，确认内置后台仅有 lite bundle。该静态检查仅用于选择接入路径；最终可用性来自上面的真实生成结果。没有修改安装包或启用其内部评测接口。
