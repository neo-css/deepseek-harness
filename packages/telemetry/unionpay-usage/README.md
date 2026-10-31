---
description: "See DSH model usage in the existing enterprise management service."
kind: "package-reference"
---

# @deepseek-ai/dsh-unionpay-usage

English | [中文](README.zh.md)

## Summary

See DSH model usage in the existing enterprise management service. Completed reports are saved locally before delivery and removed only after the server acknowledges the full batch. Offline retries and Host restarts preserve request ids and device identity; changing accounts never reassigns queued usage to the new member.

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

Install the [enterprise bundle](../../bundle/unionpay-bundle/README.md). **Plugins → Enterprise connection** shows pending records, delivery failures, and a retry action. Reports identify the client version as `dsh-<version>` and use the server’s `cli` carrier by default. Administrator-disabled collection pauses new capture after the next settings observation and retains existing queued reports.

| Field | Default | Meaning |
|---|---|---|
| `includePersonalModels` | `true` | Collect personal-provider calls as BYOK; set to `false` to collect only enterprise calls. |
| `app` | `cli` | Carrier label; desktop deployments may choose `desktop`. |
| `flushIntervalMs` | `15000` | Interval between bounded delivery attempts. |
| `collectionRefreshMs` | `60000` | Interval for observing the administrator switch. |
| `maxQueueRecords` | `50000` | Local completed-report capacity. |
| `batchSize` | `50` | Maximum rows per acknowledged batch. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `unionpay_usage` storage domain owns a persistent device id and one document per report. An enterprise call supplies its actual request credential owner; personal calls capture their member before streaming. The delivery path validates the collection ticket against that owner and keeps anonymous records anonymous. Lost receipts repeat the same request id. Storage failures and capacity loss are visible in both the page and logs without changing the model result.

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

None, as the plugin observes usage and emits no model input or tools.

#### KV Cache effect

No request history or cache prefix is modified.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- A process loss or plugin removal before a call settles can omit that call; durability starts after its outbox write commits.
- Reports for another member or server wait for that original connection. Queue-full and malformed-storage states require attention rather than silent deletion.
- External agents that bypass DSH model calls need their own usage source. Server retention and intake windows still apply.

<a id="dev-note"></a>
### Dev Note

None.
