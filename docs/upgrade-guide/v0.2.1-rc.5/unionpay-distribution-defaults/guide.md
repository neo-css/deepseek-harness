---
kind: upgrade-guide
description: "Web and Desktop ship UPH enterprise defaults and require an explicit production download origin."
---

# UnionPay distribution defaults

English | [中文](guide.zh.md)

## Change

Fresh Web and Desktop profiles include `@deepseek-ai/dsh-unionpay-bundle` after the base and Web bundles. It disables the integrations listed in its [distribution defaults](../../../../packages/bundle/unionpay-bundle/README.md#distribution-defaults), including DeepSeek reporting, API-key access, and web search and fetch. The standard, PTC, and creator presets disable their web tools. Both clients enter the UPH workspace without the preview notice or automatic credential onboarding; Desktop skips the native official welcome, login, and account subscription. Enterprise models and custom model APIs remain available.

Desktop application names, menus, tray text, and installer filenames use UPH. Applications are `UPH.app` or `UPH.exe`; release files use the `uph-` prefix. Web document titles and the installable Web application name also use UPH. Production updates require `DOWNLOAD_PROD_ORIGIN` instead of using a fixed official download site. The SDK, ACP, and headless templates keep their existing defaults.

## Migration

1. Rebuild the CLI and desktop clients. Fresh Web and Desktop profiles select the enterprise bundle automatically. Existing profiles retain their selections: append `@deepseek-ai/dsh-unionpay-bundle` after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` under `dsh.profile.bundles` in `$DSH_HOME/profiles/web/package.json` or `$DSH_HOME/profiles/desktop/package.json`. Both installations ship the bundle and its two patch files.
2. Remove later `disabled: false` overrides for the listed integrations and preset overrides that enable `tool-web` if the deployment requires them to stay disabled.
3. For production desktop packaging and upload, set `DOWNLOAD_PROD_ORIGIN` to the deployment's HTTPS download origin. Set the matching `publishing/production.json` origin for retained-release publication. Rebuild update metadata and download references with the UPH filenames; the release tooling accepts only the current names.
4. Install the rebuilt application. Electron uses UPH for its application data and log directory; shared `$DSH_HOME` data remains at its configured path. No application-data directory migration is performed.
5. Start each client and verify UPH branding without the sidebar version badge, no welcome or official login page, and all listed integrations disabled under **Settings → Built-in plugins**. Configure the management service origin under **Enterprise account**.
