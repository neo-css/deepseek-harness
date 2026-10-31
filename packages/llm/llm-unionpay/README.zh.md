---
description: "无需取得供应商 API Key，即可使用分配给企业成员的模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-unionpay

[English](README.md) | 中文

## 概述

无需取得供应商 API Key，即可使用分配给企业成员的模型。授权模型出现在 DSH 现有模型选择器中，通过企业网关使用 Chat Completions、Responses 或 Anthropic Messages。供应商未返回的用量保持未知，缓存和推理计数保留原始含义。

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

将此插件与[企业连接](../../credentials/unionpay-connection/README.zh.md)一起挂载，或安装[企业 Bundle](../../bundle/unionpay-bundle/README.zh.md)。登录后选择授权模型并发送任务。稳定的提供方路由为 `unionpay-<enterprise-model-uuid>`，模型 ID 来自服务端目录。即使页面显示缓存目录，直接调用仍需通过服务端授权。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `streamIdleTimeoutMs` | `300000` | 提供方流片段之间的最长间隔。 |
| `requestImagePixelBudget` | `4194304` | 每张请求图片的像素上限。 |
| `requestImageMaxBytes` | `1048576` | 每张请求图片的原始字节目标。 |
| `maxRequestImageBytes` | `20971520` | 编码后图片的总字节上限。 |
| `maxRetries` | `2` | 符合条件的临时故障可追加的重试次数。 |
| `maxUsageEventChars` | `4194304` | 用量观察器的 SSE 解析缓冲区字符上限。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件注册可撤销的模型路由，并将协议转换交给 `PiAiAdapter`。准备好的调用绑定企业成员及取消生命周期。HTTP 观察器原样传递响应字节，仅提取用量计数，不保留消息或工具参数。完整计数进入正常的 DSH 流，企业用量事件同时保留部分计数或缺失状态。

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

### 企业模型请求

#### 模型看到的内容

选定模型通过授权协议接收 `GenerateOptions.messages` 和 `GenerateOptions.tools`。企业凭据仅通过 HTTP 请求头传递，不额外添加企业提示词。

#### Token 影响

协议转换交给 pi-ai。插件不添加提示词 Token，用量报告保留实际观察到的输入、输出、缓存和推理计数。

#### KV Cache 影响

切换模型后使用对应提供方的缓存行为。认证刷新不重写 Session 历史，也不添加请求前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 项目授权沿用服务端的成员可用模型集合；选择本地工作区不会建立独立的项目授权。
- 选择器仅展示 pi-ai 支持的文本和已声明图片输入；此适配器不宣称支持原生视频或 PDF 能力。
- 上报用量用于运行统计，不是计费凭证，也不提供 Token 预算强制拦截。

<a id="dev-note"></a>
### 开发备注

无。
