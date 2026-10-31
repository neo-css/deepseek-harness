---
description: "Use models assigned to your enterprise member without receiving provider API keys."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-unionpay

English | [中文](README.zh.md)

## Summary

Use models assigned to your enterprise member without receiving provider API keys. Authorized models appear in the existing DSH model selector and use the enterprise gateway for Chat Completions, Responses, or Anthropic Messages. Missing provider usage remains unknown, and reported cache and reasoning counts retain their original meaning.

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

Mount this plugin with the [enterprise connection](../../credentials/unionpay-connection/README.md), or install the [enterprise bundle](../../bundle/unionpay-bundle/README.md). Sign in, select an authorized model, and send a task. The stable provider route is `unionpay-<enterprise-model-uuid>`; its model id comes from the server catalog. Direct requests remain subject to server authorization even while a cached catalog is displayed.

| Field | Default | Meaning |
|---|---|---|
| `streamIdleTimeoutMs` | `300000` | Maximum interval between provider stream chunks. |
| `requestImagePixelBudget` | `4194304` | Pixel limit per request image. |
| `requestImageMaxBytes` | `1048576` | Raw-byte target per request image. |
| `maxRequestImageBytes` | `20971520` | Aggregate encoded image-byte limit. |
| `maxRetries` | `2` | Additional retries for eligible transient failures. |
| `maxUsageEventChars` | `4194304` | Maximum SSE parser buffer for usage observation. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers reversible model routes and delegates protocol conversion to `PiAiAdapter`. A prepared call binds the enterprise member and cancellation lifetime. Its HTTP observer passes response bytes through unchanged and projects only usage counters; it does not retain messages or tool arguments. Complete counts enter the normal DSH stream, and the enterprise usage event also preserves partial or absent counts.

See [`src/index.ts`](src/index.ts) for lifecycle and service ownership.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise bundle](../../bundle/unionpay-bundle/README.md) — installation and the complete member workflow.
- [Architecture](../../../docs/architecture.md) — plugin composition and request execution.

-----

<a id="model-experience"></a>
## Model Experience

### Enterprise model request

#### What the model sees

The selected model receives `GenerateOptions.messages` and `GenerateOptions.tools` through the authorized protocol. Enterprise credentials travel only in HTTP headers; no enterprise prompt is added.

#### Token effect

Protocol conversion is delegated to pi-ai. The plugin adds no prompt tokens; usage reports preserve observed input, output, cache, and reasoning counters.

#### KV Cache effect

Selecting another model uses that provider’s cache behavior. Authentication refresh does not rewrite the Session history or add a request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Project authorization follows the server’s member-wide model set; choosing a local workspace does not enforce a separate project grant.
- The selector advertises text and declared image input supported by pi-ai. Native video and PDF capability flags are not advertised by this adapter.
- Reported usage is operational data, not a billing proof or a token-budget enforcement mechanism.

<a id="dev-note"></a>
### Dev Note

None.
