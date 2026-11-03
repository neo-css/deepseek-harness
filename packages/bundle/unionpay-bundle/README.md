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

The CLI installation ships the bundle and its dependencies. Existing profiles retain their bundle selections; see the [upgrade guide](../../../docs/upgrade-guide/v0.2.1-rc.5/unionpay-distribution-defaults/guide.md) for adding the enterprise defaults.

### Connect and run a task

Click **Enterprise sign-in** in the bottom-left sidebar, or open **Settings → Enterprise account**, enter the management service's HTTP(S) origin without a path, and save it. Select browser SSO and finish the management service's approval page, or redeem a member access code issued by an administrator. The page displays the signed-in member, authorized projects and model count, monthly usage, and pending usage reports. Choose an enterprise model from the normal model selector and submit a task.

The connection page can refresh authorization, retry delivery, or sign out. Signing out removes local authorization even when remote revocation fails; the page reports that failure. Reconnecting with the original member resumes that member's queued reports. The service address is a setting; member cookies, CSRF values, and model grants are Host credentials and never form fields.

Models settings shows only custom APIs; built-in provider cards and the provider catalog are hidden. Personal model APIs remain available under **Settings → Models → Custom model API** and can be selected alongside enterprise models. Personal-provider usage is reported as `byok` by default when management collection is enabled; see the [usage configuration](../../telemetry/unionpay-usage/README.md#use-this-package) to disable personal-model collection.

<a id="distribution-defaults"></a>
### Distribution defaults

Enterprise Web and desktop distributions load this bundle after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`. Its packaged patch files disable these integrations by default on macOS, Linux, and Windows; a fresh profile needs no local disable overrides:

| Integration | Entry ID |
|---|---|
| DeepSeek plugin inventory reporting | `plugin-package-inventory-deepseek` |
| OpenTelemetry reporting service | `otel`, `desktop-product-telemetry` |
| Feedback session-log upload | `session-telemetry-otel` |
| Session feedback command | `command-feedback` |
| Web access service | `web` |
| DeepSeek web search | `web-search-deepseek` |
| DeepSeek Search and Fetch APIs | `web-deepseek-api` |
| Public webpage fetching | `web-fetch-http` |
| Web search and reading tools | `tool-web` |
| DeepSeek API-key access | `llm-deepseek` |

The standard, PTC, and creator presets also disable their web tools, so they load without the web service. The minimal preset has no web tools. Shell tools remain available for direct intranet HTTP requests where the execution environment permits them. Enterprise sign-in, managed models, usage reporting, and custom model APIs remain available. The management service origin defaults to empty and must be configured for the deployment.

Desktop ships this bundle in its production runtime and includes it in fresh profiles. Fresh enterprise Web and Desktop profiles open the UPH workspace directly. The Models plugin disables the Web preview notice (`welcomeNotice: false`) and automatic credential onboarding (`credentialOnboarding: false`), including the native official welcome and login pages, without recording an acknowledgement for the user.

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

Indirectly, through the [managed-model plugin](../../llm/llm-unionpay/README.md#model-experience) for protocol conversion and preset composition for requests without `web_search` or `web_fetch`.

#### KV Cache effect

The disabled web tools are absent from request schemas. Each remaining plugin owns its request-history and cache effects.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The connection represents one member per Host data directory. It does not turn DSH into a multi-tenant server or replace local Host authorization.
- Model authorization follows the management service's union of member projects. Local workspace selection does not establish project-level billing or authorization.
- Work orders, device execution links, remote control, and update distribution need their own integration.
- The management service reports the `cli` or `desktop` carrier with a `dsh-` client version; it has no dedicated DSH product field.
- Local fixture acceptance covers management protocol compatibility. A deployment's TLS, corporate identity provider, and actual model provider require deployment-specific acceptance.

<a id="dev-note"></a>
### Dev Note

None.
