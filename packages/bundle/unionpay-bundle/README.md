---
description: "Add enterprise sign-in, authorized models, and member usage reporting to a DSH Web or desktop profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-unionpay-bundle

English | [中文](README.zh.md)

## Summary

Connect one member's DSH instance to the existing UnionPay Code management service. This bundle provides enterprise account entry, browser SSO or access-code login, authorized models, and durable usage delivery. It disables DeepSeek official account sign-in, onboarding, and account-backed models in that profile. Fresh Web and Desktop profiles enable it by default. Provider API keys stay on the management server; each member needs a separate DSH data directory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install from this checkout

Build this workspace with its required Node version and dependencies. Fresh Web profiles include the bundle. Set `DSH_HOME` to an isolated directory before launch:

```sh
export DSH_HOME="$HOME/.dsh-unionpay"
pnpm run build
pnpm dsh web --no-open
```

The CLI installation ships the bundle and its dependencies.

### Connect and run a task

Click **Enterprise sign-in** in the bottom-left sidebar, or open **Settings → Enterprise account**, enter the management service's HTTP(S) origin without a path, and save it. Select browser SSO and finish the management service's approval page, or redeem a member access code issued by an administrator. The page displays the signed-in member, authorized projects and model count, monthly usage, and pending usage reports. Choose an enterprise model from the normal model selector and submit a task.

The connection page can refresh authorization, retry delivery, or sign out. Signing out removes local authorization even when remote revocation fails; the page reports that failure. Reconnecting with the original member resumes that member's queued reports. The service address is a setting; member cookies, CSRF values, and model grants are Host credentials and never form fields.

Models settings shows only custom APIs; built-in provider cards and the provider catalog are hidden. Personal model APIs remain available under **Settings → Models → Custom model API** and can be selected alongside enterprise models. Personal-provider usage is reported as `byok` by default when management collection is enabled; see the [usage configuration](../../telemetry/unionpay-usage/README.md#use-this-package) to disable personal-model collection.

<a id="distribution-defaults"></a>
### Distribution defaults

Enterprise Web and desktop distributions load `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-ops`, `dsh-context`, `@michengai/dsh-btw`, `dsh-mnemon`, `@michengai/dsh-skills-manager`, and this bundle in that order. Its packaged patch files disable these integrations by default on macOS, Linux, and Windows; a fresh profile needs no local disable overrides:

| Integration | Entry ID |
|---|---|
| DeepSeek plugin inventory reporting | `plugin-package-inventory-deepseek` |
| DeepSeek session-log upload | `session-log-deepseek` |
| Session-log upload settings | `ui-settings-session-log` |
| OpenTelemetry reporting service | `otel`, `desktop-product-telemetry` |
| Desktop usage analytics | `product-analytics` |
| Feedback session-log upload | `session-telemetry-otel` |
| Session feedback command | `command-feedback` |
| Message feedback recording | `message-feedback` |
| Message feedback UI | `ui-message-feedback` |
| Web access service | `web` |
| DeepSeek web search | `web-search-deepseek` |
| DeepSeek Search and Fetch APIs | `web-deepseek-api` |
| Public webpage fetching | `web-fetch-http` |
| Web search and reading tools | `tool-web` |
| DeepSeek API-key access | `llm-deepseek` |

The standard, PTC, and creator presets also disable their web tools, so they load without the web service. The minimal preset has no web tools. Shell tools remain available for direct intranet HTTP requests where the execution environment permits them. Enterprise sign-in, managed models, usage reporting, and custom model APIs remain available. The management service origin defaults to empty and must be configured for the deployment.

Desktop ships this bundle in its production runtime and includes it in fresh profiles. Fresh enterprise Web and Desktop profiles open the UPH workspace directly. The Models plugin disables the Web preview notice (`welcomeNotice: false`) and automatic credential onboarding (`credentialOnboarding: false`), including the native official welcome and login pages, without recording an acknowledgement for the user.

Both clients ship and enable [dsh-context](https://github.com/bowenliang123/dsh-context) at version `0.80.2`. Its **Context** tab and **Context Insights** page show session statistics and context composition. Actual input, output, and cache totals come from the configured model's reported usage through DSH's local Session projections; enterprise models do not require a DeepSeek official API key or session-log upload. Category sizes are estimates, and missing provider counters cannot supply exact usage. Cost estimates use models.dev public prices, which may not cover private model IDs or enterprise billing rates. Each community bundle has its own card under **Plugins → Installed plugins**, including bundled copies; its switch changes profile selection. Bundled files remain installed when disabled and have no uninstall action.

Both clients ship and enable [DSH BTW](https://github.com/MichengAI/dsh-btw) at version `1.3.2` through the `michengai-btw` row. Enter `/btw your question` in a conversation to ask about its context in a separate answer bubble, using the selected enterprise or custom model. The default tool whitelist is empty. Answers stay outside the main conversation unless explicitly sent back. Each side question makes an additional model request and consumes tokens. Use its bundle card to turn it off.

Both clients pin [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) to `0.5.39` as a separate bundle. It supplies layered runtime memory, document recall, and Memory Spaces through the selected model. Mnemon Native stores memory locally under `~/.mnemon` by default, independently of `DSH_HOME`; third-party providers require configuration. The automatic-capture strategy and skill self-evolution remain off by default. Memory instructions, recalled content, and background work can consume additional model tokens.

Both clients pin [Skills Manager](https://github.com/MichengAI/dsh-skills-manager) to `1.2.28` as a separate bundle. **Settings → Skills** manages local and project skills and external sources. The enterprise patch sets `skills-manager.updater: false`; plugin versions follow the application release. Public markets and GitHub installation need their corresponding network access.

Desktop unpacks the OPS package and updates worker checksums after signing; [packaging](../../../apps/desktop/packaging/README.md#runtime-file-selection) owns these release steps.

Both clients pin [dsh-ops](https://github.com/T-Auto/dsh-ops/releases/tag/v0.4.4) to `0.4.4` and load its published Bundle directly. Its Minimal, Standard, PTC, Cordis, and discovery rows start enabled; compatibility, capture panel, and TUI rows stay disabled. Standard and Cordis use OPS readers and search in place of `read`, `glob`, and `grep`. PTC exposes resident APIs and loads advanced APIs on demand. This version replaces the shell with OPS Bash only on Windows; POSIX keeps the Host Bash tool. These local tools work with enterprise models and need no DeepSeek official API key. Later profile patches can disable individual OPS rows.

### Configure deployment limits

The bundle inserts rows named `unionpay-connection`, `llm-unionpay`, `unionpay-usage`, and `ui-unionpay`. Configure their documented fields in the profile's `cordis.patch.yml`. The [connection](../../credentials/unionpay-connection/README.md), [model](../../llm/llm-unionpay/README.md), and [usage](../../telemetry/unionpay-usage/README.md) packages own their defaults and failure behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) composes independent Host, model, reporting, and UI plugins. Enterprise Remote methods are mounted by the client plugin; the built-in API controllers and Agent loop have no enterprise branches. [`tests/enterprise.e2e.ts`](tests/enterprise.e2e.ts) runs an explicitly selected UnionPay Code checkout's original management routes and persistence, with local OIDC and model providers. Set `UNIONPAY_CODE_ROOT` to that checkout and `UNIONPAY_NODE_MODULES_ROOT` to a directory whose installation resolves its server dependencies before running that focused e2e file. Without both values the test skips; it does not prove compatibility with an unspecified deployment.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise connection](../../credentials/unionpay-connection/README.md) — authentication and renewal.
- [Enterprise models](../../llm/llm-unionpay/README.md) — supported protocols and model capabilities.
- [Usage reporting](../../telemetry/unionpay-usage/README.md) — delivery ownership and retry limits.
- [Enterprise page](../../client/ui-unionpay/README.md) — client configuration and state.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [managed-model plugin](../../llm/llm-unionpay/README.md#model-experience) for protocol conversion and preset composition for requests without `web_search` or `web_fetch`. The OPS bundle owns its tool schemas, usage guidance, and dynamic API publication. BTW owns its child-session prompt and tool restrictions. Mnemon owns memory instructions, recall, and memory tools. Skills Manager supplies additional skill sources and its skill-creation tool.

#### KV Cache effect

The disabled web tools are absent from request schemas. OPS adds tool schemas and guidance; dynamic selections change subsequent requests. BTW adds a side request with inherited history and an additional user message. Memory and skill changes can alter subsequent request contents. Each remaining plugin owns its request-history and cache effects.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The connection represents one member per Host data directory. It does not turn DSH into a multi-tenant server or replace local Host authorization.
- Model authorization follows the management service's union of member projects. Local workspace selection does not establish project-level billing or authorization.
- Work orders, device execution links, remote control, and update distribution need their own integration.
- The management service reports the `cli` or `desktop` carrier with a `dsh-` client version; it has no dedicated DSH product field.
- BTW `1.3.2` requests up to 32,000 output tokens when the parent has no explicit output budget; the model catalog default does not cap that request. Verify this budget against the deployed model provider.
- With OPS `0.4.4` on this RC.5 runtime, a PTC SDK selection becomes callable on the next step, but its declarations reach the model one request later. Native Standard tools are unaffected.
- OPS `0.4.4` ships workers for macOS arm64/x64, Linux x64, and Windows x64. Windows and Linux ARM64 workers are not included. Its Windows Bash optional dependency adds about 411 MB unpacked. Target-platform runtime acceptance remains necessary.
- Local fixture acceptance covers management protocol compatibility. A deployment's TLS, corporate identity provider, and actual model provider require deployment-specific acceptance.

<a id="dev-note"></a>
### Dev Note

None.
