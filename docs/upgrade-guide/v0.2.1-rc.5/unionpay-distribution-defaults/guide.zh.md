---
kind: upgrade-guide
description: "UnionPay Profile 默认关闭 DeepSeek 上报、API 密钥接入和网页工具。"
---

# UnionPay 发布默认配置

[English](guide.md) | 中文

## 变更

可选的 `@deepseek-ai/dsh-unionpay-bundle` 默认关闭其[发布默认配置](../../../../packages/bundle/unionpay-bundle/README.zh.md#distribution-defaults)列出的十项集成，包括 DeepSeek 上报、API 密钥接入和网页搜索与抓取。此前，Profile 从基础组合包和 Web 组合包继承这些集成。标准、PTC 和创造预设关闭各自的网页工具，从而在缺少网页服务时保持可用。企业模型和自定义模型 API 保持可用。

## 迁移

1. 在企业 Profile 的 `package.json` 中，将 `dsh.profile.bundles` 下的 `@deepseek-ai/dsh-unionpay-bundle` 保持在 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 之后。发布时包含其包清单声明的两个补丁文件。
2. 如果部署要求这些集成保持关闭，移除后续 Profile、home 或启动补丁中为它们显式设置的 `disabled: false` 覆盖项，同时移除后续预设覆盖中启用 `tool-web` 的配置。
3. 启动 Profile，检查 **设置 → 内置插件**。十项集成都应显示已停用，标准、PTC 和创造预设应正常加载，不出现缺少网页服务的错误。在 **企业账号** 中配置部署环境的管理服务地址。
