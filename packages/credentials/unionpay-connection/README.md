---
description: "Sign in to a UnionPay Code enterprise service using browser SSO or a member access code."
kind: "package-reference"
---

# @deepseek-ai/dsh-unionpay-connection

English | [中文](README.zh.md)

## Summary

Sign in to a UnionPay Code enterprise service using browser SSO or a member access code. Your enterprise identity, authorized model directory, projects, and personal monthly usage appear in the enterprise page. Provider credentials remain on the management server; the DSH Host stores only the member session.

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

Saving another origin cancels the active sign-in and model calls. Queued usage remains assigned to its original origin and member.

Install the [enterprise bundle](../../bundle/unionpay-bundle/README.md), open **Plugins → Enterprise connection**, save the HTTP or HTTPS origin, then select enterprise SSO or redeem a member access code. Sign-out retires the local session even when the remote revocation request fails; the page reports that uncertainty.

| Field | Default | Meaning |
|---|---|---|
| `origin` | `''` | Enterprise origin; empty leaves the plugin unconfigured. |
| `requestTimeoutMs` | `30000` | Complete HTTP request deadline. |
| `maxResponseBytes` | `2097152` | Maximum enterprise JSON response bytes. |
| `refreshIntervalMs` | `60000` | Authenticated membership, catalog, and usage refresh interval. |
| `renewBeforeMs` | `60000` | Inference-grant renewal margin. |
| `signInTimeoutMs` | `600000` | Maximum local sign-in attempt lifetime. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Forced catalog refresh waits for an ordinary runtime read and then revalidates the catalog. Invalid catalogs, including duplicate model IDs, withdraw cached routes and expose an unavailable state until a valid refresh succeeds.

One connection owns its credential record, active authorization, and request cancellation. The browser receives typed projections through the service’s own Remote namespace. Every credential replacement invalidates the old request lifetime; cancelled authorization waits for its provider cleanup. Credentials are scoped to the issuing origin, and origin changes never forward an old cookie to another service.

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

None, as enterprise identity and credentials affect HTTP authentication and configuration only.

#### KV Cache effect

No request history or cache prefix is modified.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- One enterprise member per Host and data directory; profiles sharing the same home do not provide member isolation.
- The server remains the authority for seats and model access. Offline state cannot authorize a new model request.
- The SSO integration requires the enterprise service’s device-approval endpoints and an OIDC provider configured there.

<a id="dev-note"></a>
### Dev Note

None.
