---
description: "Sign in to your enterprise account from the sidebar and manage its connection in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-unionpay

English | [中文](README.zh.md)

## Summary

Sign in to your enterprise account from the sidebar and manage its connection in Settings. View the current member, authorized projects and models, personal monthly usage, and pending usage delivery. Browser SSO opens the enterprise approval page; member access codes are cleared from the form when submitted.

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

Enable the [enterprise bundle](../../bundle/unionpay-bundle/README.md) in the Web or Desktop profile and click **Enterprise sign-in** in the bottom-left sidebar, or open **Settings → Enterprise account**. The sidebar displays the member name after sign-in. The adjacent settings button remains available when the sidebar is collapsed. Save the enterprise origin before starting either login flow. Request failures preserve the displayed data, and persistent delivery issues remain visible beside the pending count.

Click **Enterprise SSO** to open the login page automatically: Web uses a new browser tab and Desktop opens the system browser. If the browser blocks the tab, use **Open sign-in page** in the pending login panel. Failed or cancelled attempts close the tab opened by Web; successful login leaves its completion page open.

The enterprise sidebar displays the shared UPH artwork and **UPH** without a version badge. The New Session heading uses the same artwork. The enterprise bundle disables the official brand occupant so release builds use the same name.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The sidebar dialog and settings section share the connection plugin’s configuration form and follows separate typed Host streams for identity and delivery. Components receive narrow injected actions and observable views. Feedback uses the shared app overlay, so navigation does not remove an operation notice. Cookies, bearer grants, and provider keys never enter the page state.

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

None, as this page changes configuration and reports state without submitting model input.

#### KV Cache effect

No request history or cache prefix is modified.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The page manages one member connection per Host. It does not provide administrator access, work-item execution, or remote device control.

<a id="dev-note"></a>
### Dev Note

None.
