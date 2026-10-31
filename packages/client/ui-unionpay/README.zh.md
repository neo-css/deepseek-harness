---
description: "从侧栏登录企业账号，在设置中管理企业连接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-unionpay

[English](README.md) | 中文

## 概述

从侧栏登录企业账号，在设置中管理企业连接。查看当前成员、授权项目与模型、本人月度用量和待投递记录。浏览器 SSO 打开企业授权页面；成员接入码提交后会从表单中清除。

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

在 Web 或 Desktop Profile 中启用[企业 Bundle](../../bundle/unionpay-bundle/README.zh.md)，点击左下角侧栏的 **企业登录**，或打开 **设置 → 企业账号**。登录后侧栏显示成员姓名。侧栏折叠时，旁边的设置按钮仍可使用。启动任一登录流程前先保存企业服务地址。请求失败时保留已显示的数据，持续的投递问题与待上报数量一起显示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

侧栏弹窗和设置页面共享连接插件的配置表单，并分别跟随身份和投递的类型化 Host 流。组件通过注入接收窄范围操作与可观察视图。反馈使用共享应用浮层，页面跳转不会移除操作通知。Cookie、Bearer 凭据和供应商 Key 不进入页面状态。

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

无，因为此页面仅修改配置并报告状态，不提交模型输入。

#### KV Cache 影响

不修改请求历史或缓存前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 页面管理每个 Host 的一个成员连接，不提供管理员权限、工单执行或远程设备控制。

<a id="dev-note"></a>
### 开发备注

无。
