---
description: "在现有企业管理端查看 DSH 模型用量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-unionpay-usage

[English](README.md) | 中文

## 概述

在现有企业管理端查看 DSH 模型用量。已完成的报告先保存到本地，仅在服务端确认整批记录后删除。断网重试和 Host 重启保留请求 ID 与设备身份；切换账号不会把队列中的用量改记给新成员。

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

安装[企业 Bundle](../../bundle/unionpay-bundle/README.zh.md)。**插件 → 企业连接** 显示待上报记录、投递错误和重试操作。报告以 `dsh-<version>` 标识客户端版本，默认使用服务端的 `cli` 载体类型。观察到管理员关闭采集后停止创建新记录，并保留已有队列。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `includePersonalModels` | `true` | 将个人模型调用按 BYOK 采集；设为 `false` 时仅采集企业模型。 |
| `app` | `cli` | 载体标签；桌面部署可选择 `desktop`。 |
| `flushIntervalMs` | `15000` | 有界投递尝试的间隔。 |
| `collectionRefreshMs` | `60000` | 观察管理员采集开关的间隔。 |
| `maxQueueRecords` | `50000` | 本地已完成报告的容量上限。 |
| `batchSize` | `50` | 每批需确认的记录上限。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`unionpay_usage` 存储域保存持久设备 ID，并为每份报告保存一个文档。企业调用提供实际请求凭据对应的成员；个人模型调用在流式执行前捕获成员。投递路径将采集票据与该身份核对，匿名记录始终保持匿名。回执丢失时使用同一个请求 ID 重试。存储故障和容量导致的丢失同时显示在页面与日志中，不改变模型结果。

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

无，因为插件仅观察用量，不产生模型输入或工具。

#### KV Cache 影响

不修改请求历史或缓存前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 调用结束前进程崩溃或移除插件可能遗漏该次调用；持久保证从队列写入提交后开始。
- 属于其他成员或服务地址的报告等待原连接恢复。队列满或存储损坏需要处理，不会静默删除记录。
- 绕过 DSH 模型调用链路的外部 agent 需要自己的用量来源；服务端保留期限和接收时间窗口仍然适用。

<a id="dev-note"></a>
### 开发备注

无。
