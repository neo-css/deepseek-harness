---
kind: upgrade-guide
description: "Models settings displays only user-declared API routes."
---

# Models settings uses custom APIs

English | [中文](guide.zh.md)

## Change

Models settings hides built-in providers and opens the custom API form directly. The `ui-settings-models.customProvidersOnly` option is removed; custom-only behavior is fixed. Existing provider configuration and model execution remain available.

## Migration

1. Remove `customProvidersOnly` from `ui-settings-models` entries in profile patches.
2. Open **Settings → Models** and use **Custom model API** to add a user-declared route. Confirm that saved custom routes remain editable and no built-in provider catalog appears.
