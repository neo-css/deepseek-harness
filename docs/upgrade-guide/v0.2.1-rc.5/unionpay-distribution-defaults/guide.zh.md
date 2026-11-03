---
kind: upgrade-guide
description: "UnionPay Profile 默认关闭 DeepSeek 上报、API 密钥接入和网页工具。"
---

# UnionPay 发布默认配置

[English](guide.md) | 中文

## 变更

可选的 `@deepseek-ai/dsh-unionpay-bundle` 默认关闭其[发布默认配置](../../../../packages/bundle/unionpay-bundle/README.zh.md#distribution-defaults)列出的十项集成，包括 DeepSeek 上报、API 密钥接入和网页搜索与抓取。此前，Profile 从基础组合包和 Web 组合包继承这些集成。标准、PTC 和创造预设关闭各自的网页工具，从而在缺少网页服务时保持可用。全新 Desktop Profile 在基础组合包和 Web 组合包之后默认加载企业 Bundle。企业 Web 和 Desktop Profile 直接打开 UPH 工作区，不显示预览版说明或自动凭证引导；Desktop 跳过原生官方欢迎页、登录页和账号订阅。企业模型和自定义模型 API 保持可用。

## 迁移

1. 在企业 Profile 的 `package.json` 中，将 `dsh.profile.bundles` 下的 `@deepseek-ai/dsh-unionpay-bundle` 保持在 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 之后。发布时包含其包清单声明的两个补丁文件。全新 Desktop Profile 自动包含本 Bundle。对于尚未包含本 Bundle 的已有 Desktop Profile，退出 Desktop 后，在 `$DSH_HOME/profiles/desktop/package.json` 的 `dsh.profile.bundles` 末尾加入本 Bundle；更新后的 Desktop 运行时已经包含对应包。
2. 如果部署要求这些集成保持关闭，移除后续 Profile、home 或启动补丁中为它们显式设置的 `disabled: false` 覆盖项，同时移除后续预设覆盖中启用 `tool-web` 的配置。
3. 启动 Profile，检查 **设置 → 内置插件**。十项集成都应显示已停用，标准、PTC 和创造预设应正常加载，不出现缺少网页服务的错误。确认 Desktop 直接进入 UPH 工作区，不显示官方欢迎页或登录页。在 **企业账号** 中配置部署环境的管理服务地址。
