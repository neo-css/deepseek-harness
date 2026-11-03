---
description: "为 DSH Web 或桌面 Profile 添加企业登录、授权模型和成员用量上报。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-unionpay-bundle

[English](README.md) | 中文

## 概述

将一位成员的 DSH 实例连接到现有 UnionPay Code 管理服务。这个 Bundle 提供企业账号入口、浏览器 SSO 或接入码登录、授权模型和持久化用量上报，并关闭该 Profile 中的 DeepSeek 官方账号登录、引导和账号模型。全新 Web 和 Desktop Profile 默认启用它。供应商 API Key 保留在管理端；每位成员需要独立的 DSH 数据目录。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 从当前检出目录安装

使用工作区要求的 Node 版本和依赖完成构建。全新 Web Profile 已包含此 Bundle。启动前将 `DSH_HOME` 设置为独立目录：

```sh
export DSH_HOME="$HOME/.dsh-unionpay"
pnpm run build
pnpm dsh web --no-open
```

CLI 安装随附此 Bundle 及其依赖。已有 Profile 保留原有 Bundle 选择；添加企业默认配置的方法见[升级指南](../../../docs/upgrade-guide/v0.2.1-rc.5/unionpay-distribution-defaults/guide.zh.md)。

### 连接并运行任务

点击左下角侧栏的 **企业登录**，或打开 **设置 → 企业账号**，填写不带路径的管理服务 HTTP(S) origin 并保存。选择浏览器 SSO，在管理端审批页完成确认；也可以兑换管理员签发的成员接入码。页面显示登录成员、授权项目与模型数量、本月用量和待上报记录。在常规模型选择器中选择企业模型并提交任务。

连接页支持刷新授权、重试上报和退出。即使远端撤销失败，退出也会移除本地授权，并在页面显示失败原因。使用原成员重新登录后会继续上报该成员的队列记录。服务地址属于设置；成员 Cookie、CSRF 值和模型授权凭据属于 Host 凭据，不会作为表单字段展示。

模型设置仅显示自定义 API，隐藏内置提供商卡片和提供商目录。个人模型 API 仍可在 **设置 → 模型 → 自定义模型 API** 中配置，并与企业模型一起选择使用。管理端开启采集时，个人供应商用量默认以 `byok` 上报；关闭个人模型采集的方法见[用量配置](../../telemetry/unionpay-usage/README.zh.md#use-this-package)。

<a id="distribution-defaults"></a>
### 发布默认配置

企业 Web 和桌面发行版依次加载 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-ops` 和此组合包。随包发布的补丁文件在 macOS、Linux 和 Windows 上默认关闭以下集成，新 Profile 无需添加本地停用覆盖项：

| 集成 | 配置项 ID |
|---|---|
| DeepSeek 插件清单上报 | `plugin-package-inventory-deepseek` |
| DeepSeek 会话日志上传 | `session-log-deepseek` |
| 会话日志上传设置 | `ui-settings-session-log` |
| OpenTelemetry 上报服务 | `otel`、`desktop-product-telemetry` |
| 反馈会话日志上传 | `session-telemetry-otel` |
| 会话反馈命令 | `command-feedback` |
| 消息反馈记录 | `message-feedback` |
| 消息反馈界面 | `ui-message-feedback` |
| 网页访问服务 | `web` |
| DeepSeek 网页搜索 | `web-search-deepseek` |
| DeepSeek 网页搜索与抓取 API | `web-deepseek-api` |
| 公开网页获取 | `web-fetch-http` |
| 网页搜索与读取工具 | `tool-web` |
| DeepSeek API 密钥接入 | `llm-deepseek` |

标准、PTC 和创造预设也关闭各自的网页工具，从而在缺少网页服务时正常加载。最小预设不包含网页工具。执行环境允许时，仍可使用 Shell 工具直接请求内网 HTTP。企业登录、受管模型、用量上报和自定义模型 API 保持可用。管理服务地址默认为空，需要按部署环境配置。

Desktop 的生产运行时包含本 Bundle，并在全新 Profile 中默认加载它。全新的企业 Web 和 Desktop Profile 直接进入 UPH 工作区。Models 插件通过 `welcomeNotice: false` 关闭 Web 预览版说明，通过 `credentialOnboarding: false` 关闭自动凭证引导，包括原生官方欢迎页和登录页，不会代替用户写入已确认记录。

两个客户端均随附并默认启用 `0.80.2` 版 [dsh-context](https://github.com/bowenliang123/dsh-context)。其 **Context（上下文）** 标签页和 **上下文洞察** 页面显示会话统计与上下文组成。实际输入、输出和缓存总量来自所配置模型返回的用量，经 DSH 本地 Session 投影提供；企业模型无需 DeepSeek 官方 API Key 或会话日志上传。各类别大小属于估算，提供方缺少计数字段时无法提供精确用量。费用使用 models.dev 公开价格估算，可能不包含私有模型 ID 或企业结算价格。在后续 Profile 补丁中停用 `dsh-context` 节点即可关闭该插件。

Desktop 解包 OPS 包，并在签名后更新内核校验值；这些发布步骤由[打包流程](../../../apps/desktop/packaging/README.zh.md#runtime-file-selection)负责。

两个客户端固定使用 `0.4.4` 版 [dsh-ops](https://github.com/T-Auto/dsh-ops/releases/tag/v0.4.4)，直接加载其发布包中的 Bundle。Minimal、Standard、PTC、Cordis 和 discovery 节点默认启用，兼容、采集面板与 TUI 节点保持关闭。Standard 和 Cordis 使用 OPS 读取与搜索工具替换 `read`、`glob` 和 `grep`。PTC 提供常驻 API，并按需加载高级 API。此版本仅在 Windows 上将 Shell 替换为 OPS Bash；POSIX 保留 Host Bash 工具。这些本地工具可供企业模型使用，无需 DeepSeek 官方 API Key。后续 Profile 补丁可停用各 OPS 节点。

### 配置部署限制

Bundle 插入 `dsh-context`、`unionpay-connection`、`llm-unionpay`、`unionpay-usage` 和 `ui-unionpay` 节点。在 Profile 的 `cordis.patch.yml` 中配置各包文档列出的字段。[连接](../../credentials/unionpay-connection/README.zh.md)、[模型](../../llm/llm-unionpay/README.zh.md)与[用量](../../telemetry/unionpay-usage/README.zh.md)包分别说明默认值和失败处理。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 装配独立的 Host、模型、上报和 UI 插件。企业 Remote 方法由客户端插件挂载；内置 API 控制器和 Agent 循环没有企业专用分支。[`tests/enterprise.e2e.ts`](tests/enterprise.e2e.ts) 使用明确指定的 UnionPay Code 检出目录中的原始管理路由和持久化逻辑，并使用本地 OIDC 与模型提供方。运行该定向 e2e 文件前，将 `UNIONPAY_CODE_ROOT` 指向该检出目录，将 `UNIONPAY_NODE_MODULES_ROOT` 指向可解析其服务端依赖的安装目录。缺少任一值时测试跳过，不能据此断言与未指定部署兼容。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [企业连接](../../credentials/unionpay-connection/README.zh.md) — 身份验证与续期。
- [企业模型](../../llm/llm-unionpay/README.zh.md) — 支持的协议与模型能力。
- [用量上报](../../telemetry/unionpay-usage/README.zh.md) — 上报归属和重试限制。
- [企业页面](../../client/ui-unionpay/README.zh.md) — 客户端配置和状态。

-----

<a id="model-experience"></a>
## 模型体验

通过负责协议转换的[受管模型插件](../../llm/llm-unionpay/README.zh.md#model-experience)，以及让请求不包含 `web_search` 和 `web_fetch` 的预设装配间接影响模型。OPS 组合包负责其工具定义、使用说明和动态 API 发布。

#### KV Cache 影响

被停用的网页工具不出现在请求的工具定义中。OPS 添加工具定义和说明，动态选择会改变后续请求。其余插件分别负责各自对请求历史和缓存的影响。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 每个 Host 数据目录的连接代表一位成员。它不会把 DSH 变成多租户服务，也不替代本地 Host 授权。
- 模型权限沿用管理服务对成员所属项目的并集授权。本地工作区选择不会建立项目级计费或授权。
- 工单、设备执行关联、远控和更新分发需要分别适配。
- 管理服务记录 `cli` 或 `desktop` 载体及带 `dsh-` 前缀的客户端版本，没有独立的 DSH 产品字段。
- OPS `0.4.4` 在当前 RC.5 运行时中，PTC 按需选择的 API 从下一步骤起可调用，但其类型声明延后一轮请求才发送给模型。原生 Standard 工具不受影响。
- OPS `0.4.4` 随附 macOS arm64/x64、Linux x64 与 Windows x64 内核，不包含 Windows 和 Linux ARM64 内核。其 Windows Bash 可选依赖解压后约增加 411 MB，仍需在目标平台验收运行行为。
- 本地测试服务验收覆盖管理协议兼容性。部署环境的 TLS、企业身份提供方和实际模型提供方仍需要在目标环境中验收。

<a id="dev-note"></a>
### 开发备注

无。
