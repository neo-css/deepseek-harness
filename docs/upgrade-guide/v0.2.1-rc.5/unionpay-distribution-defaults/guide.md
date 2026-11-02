---
kind: upgrade-guide
description: "UnionPay profiles disable DeepSeek reporting, API-key access, and web tools by default."
---

# UnionPay distribution defaults

English | [中文](guide.zh.md)

## Change

The optional `@deepseek-ai/dsh-unionpay-bundle` disables the ten integrations listed in its [distribution defaults](../../../../packages/bundle/unionpay-bundle/README.md#distribution-defaults), including DeepSeek reporting, API-key access, and web search and fetch. Previously, profiles inherited those integrations from the base and Web bundles. The standard, PTC, and creator presets disable their web tools so they remain usable without the web service. Enterprise models and custom model APIs remain available.

## Migration

1. Keep `@deepseek-ai/dsh-unionpay-bundle` after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` in the enterprise profile's `package.json` under `dsh.profile.bundles`. Distribute both bundle patch files named by its package manifest.
2. Remove explicit `disabled: false` overrides for these integrations from later profile, home, or invocation patches if the deployment requires them to stay disabled. Also remove later preset overrides that enable `tool-web`.
3. Start the profile and check **Settings → Built-in plugins**. All ten integrations must show disabled; the standard, PTC, and creator presets must load without missing-web-service errors. Configure the deployment's management service origin under **Enterprise account**.
