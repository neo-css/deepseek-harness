---
kind: upgrade-guide
description: "UnionPay profiles disable DeepSeek reporting, API-key access, and web tools by default."
---

# UnionPay distribution defaults

English | [中文](guide.zh.md)

## Change

The optional `@deepseek-ai/dsh-unionpay-bundle` disables the ten integrations listed in its [distribution defaults](../../../../packages/bundle/unionpay-bundle/README.md#distribution-defaults), including DeepSeek reporting, API-key access, and web search and fetch. Previously, profiles inherited those integrations from the base and Web bundles. The standard, PTC, and creator presets disable their web tools so they remain usable without the web service. Fresh Desktop profiles now include the enterprise bundle after the base and Web bundles. Enterprise Web and Desktop profiles open the UPH workspace without the preview notice or automatic credential onboarding; Desktop skips its native official welcome, login, and account subscription. Enterprise models and custom model APIs remain available.

## Migration

1. Keep `@deepseek-ai/dsh-unionpay-bundle` after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` in the enterprise profile's `package.json` under `dsh.profile.bundles`. Distribute both bundle patch files named by its package manifest. Fresh Desktop profiles include this bundle automatically. For an existing Desktop profile that omits this bundle, quit Desktop and append the bundle to `dsh.profile.bundles` in `$DSH_HOME/profiles/desktop/package.json`; the updated Desktop runtime already includes its package.
2. Remove explicit `disabled: false` overrides for these integrations from later profile, home, or invocation patches if the deployment requires them to stay disabled. Also remove later preset overrides that enable `tool-web`.
3. Start the profile and check **Settings → Built-in plugins**. All ten integrations must show disabled; the standard, PTC, and creator presets must load without missing-web-service errors. Confirm Desktop enters the UPH workspace without an official welcome or login page. Configure the deployment's management service origin under **Enterprise account**.
