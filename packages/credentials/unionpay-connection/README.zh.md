---
description: "通过浏览器 SSO 或成员接入码登录银联智码企业服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-unionpay-connection

[English](README.md) | 中文

## 概述

通过浏览器 SSO 或成员接入码登录银联智码企业服务。企业页面显示成员身份、授权模型目录、项目和本人月度用量。供应商凭据保留在管理端，DSH Host 仅保存成员会话。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

保存另一个服务地址会取消当前登录流程和模型调用。待上报用量仍归属于原服务地址与成员。

安装[企业 Bundle](../../bundle/unionpay-bundle/README.zh.md)，打开 **插件 → 企业连接**，保存 HTTP 或 HTTPS 服务地址，再选择企业统一登录或兑换成员接入码。退出时即使远端撤销请求失败，本地会话仍会停用；页面会显示这一未确认状态。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `origin` | `''` | 企业服务地址；空值表示尚未配置。 |
| `requestTimeoutMs` | `30000` | 完整 HTTP 请求的截止时间。 |
| `maxResponseBytes` | `2097152` | 企业 JSON 响应的字节上限。 |
| `refreshIntervalMs` | `60000` | 成员身份、目录与用量的刷新间隔。 |
| `renewBeforeMs` | `60000` | 模型调用凭据到期前的更新窗口。 |
| `signInTimeoutMs` | `600000` | 本地登录尝试的最长持续时间。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

强制刷新目录会等待普通运行时读取完成，再重新校验目录。目录无效（包括模型 ID 重复）时撤下缓存路由，并显示不可用状态，直到有效刷新成功。

一个连接实例负责凭据记录、当前授权和请求取消。浏览器通过该服务自己的 Remote 命名空间读取类型化视图。凭据替换会终止旧请求的有效期；取消授权会等待提供方完成清理。凭据绑定签发服务地址，地址变更不会把旧 Cookie 发给另一服务。

生命周期和服务归属见 [`src/index.ts`](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [企业 Bundle](../../bundle/unionpay-bundle/README.zh.md)——安装与完整成员流程。
- [架构](../../../docs/architecture.zh.md)——插件组合与请求执行。

-----

<a id="model-experience"></a>
## 模型体验

无，因为企业身份和凭据仅影响 HTTP 认证与配置。

#### KV Cache 影响

不修改请求历史或缓存前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 每个 Host 和数据目录仅对应一个企业成员；共享同一 home 的 Profile 不提供成员隔离。
- 席位和模型访问以服务端为准；离线状态不能授予新的模型调用权限。
- SSO 接入依赖企业服务的设备授权接口，以及管理端配置的 OIDC 提供方。

<a id="dev-note"></a>
### 开发备注

无。
