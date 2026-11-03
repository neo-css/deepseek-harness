---
kind: upgrade-guide
description: "Web 和 Desktop 随附 UPH 企业默认配置，生产更新要求显式提供下载地址。"
---

# UnionPay 发布默认配置

[English](guide.md) | 中文

## 变更

全新 Web 和 Desktop Profile 在基础与 Web 组合包之后依次加载 `dsh-ops` 和 `@deepseek-ai/dsh-unionpay-bundle`。它停用[发布默认配置](../../../../packages/bundle/unionpay-bundle/README.zh.md#distribution-defaults)列出的集成，包括 DeepSeek 上报、桌面端使用统计、API Key 接入以及网页搜索和获取。标准、PTC 和创造预设关闭各自的网页工具。两个客户端直接进入 UPH 工作区，不显示预览说明或自动凭证引导；Desktop 跳过原生官方欢迎页、登录页和账号订阅。企业模型与自定义模型 API 保持可用。

桌面应用名称、菜单、托盘文案和安装包文件名使用 UPH。应用为 `UPH.app` 或 `UPH.exe`，发布文件使用 `uph-` 前缀。Web 文档标题和可安装 Web 应用名称也使用 UPH。生产更新要求配置 `DOWNLOAD_PROD_ORIGIN`，不再使用固定的官方下载站。SDK、ACP 和 headless 模板保留原有默认配置。

两个客户端还通过企业组合包随附并默认启用 `dsh-context@0.80.2`。其 Token 统计读取本地模型用量，也支持企业模型；组合包 README 说明[估算与价格限制](../../../../packages/bundle/unionpay-bundle/README.zh.md#distribution-defaults)。

两种安装均固定使用 `dsh-ops@0.4.4`，默认启用四种预设模式和 discovery，保持兼容、采集面板与 TUI 关闭。Standard 和 Cordis 替换原有读取与搜索工具；Windows 使用 OPS Bash，POSIX 保留 Host Bash。平台限制见组合包 README。

企业组合包还通过 `michengai-btw` 启用 `@michengai/dsh-btw@1.3.2`。`/btw` 使用所选模型，基于当前上下文在独立气泡中回答旁问。默认工具白名单为空，旁问会额外消耗 Token。

## 迁移

1. 重新构建 CLI 和桌面客户端。全新 Web 和 Desktop Profile 自动选择这两个组合包。已有 Profile 保留原有选择：在 `$DSH_HOME/profiles/web/package.json` 或 `$DSH_HOME/profiles/desktop/package.json` 的 `dsh.profile.bundles` 中，将 `dsh-ops` 和 `@deepseek-ai/dsh-unionpay-bundle` 依次添加到 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app` 之后。两种安装均随附这两个组合包及其中的企业补丁文件。
2. 若部署要求这些集成保持关闭，移除后续针对它们的 `disabled: false` 覆盖项，以及启用 `tool-web` 的预设覆盖项。
3. 生产桌面打包与上传时，将 `DOWNLOAD_PROD_ORIGIN` 设置为部署的 HTTPS 下载 origin。保留产物发布的 `publishing/production.json` 也要设置相同 origin。使用 UPH 文件名重新生成更新清单和下载引用；发布工具只接受当前名称。
4. 安装重新构建的应用。Electron 使用 UPH 作为应用数据与日志目录名称；共享 `$DSH_HOME` 数据仍位于其配置路径。不执行应用数据目录迁移。
5. 启动每种客户端，确认显示 UPH、侧栏不带版本号、不出现欢迎页或官方登录页、**设置 → 内置插件** 中列出的集成均已停用，**上下文洞察** 入口可用，并已启用 OPS。在 **企业账号** 中配置管理服务 origin 并登录，选择企业模型后运行文件读取任务，确认执行 `ops_read_files`，并在 **Context（上下文）** 标签页核对用量。输入 `/btw` 并提问，确认出现独立回答气泡。
