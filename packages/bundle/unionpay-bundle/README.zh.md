---
description: "为 DSH Web 或桌面 Profile 添加企业登录、授权模型和成员用量上报。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-unionpay-bundle

[English](README.md) | 中文

## 概述

将一位成员的 DSH 实例连接到现有 UnionPay Code 管理服务。这个可选 Bundle 提供企业账号入口、浏览器 SSO 或接入码登录、授权模型和持久化用量上报，并关闭该 Profile 中的 DeepSeek 官方账号登录、引导和账号模型。内置 Profile 默认不启用它。供应商 API Key 保留在管理端；每位成员需要独立的 DSH 数据目录。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 从当前检出目录安装

使用工作区要求的 Node 版本和依赖完成构建。从当前检出目录进行开发时，请使用工作区中的本地 Bundle 路径安装。安装和启动前都要将 `DSH_HOME` 设置为独立目录：

```sh
export DSH_HOME="$HOME/.dsh-unionpay"
pnpm run build
pnpm dsh plugin --profile web add "link:$PWD/packages/bundle/unionpay-bundle"
pnpm dsh web --no-open
```

插件管理器会把 Bundle 加入 Profile 的包清单并激活其补丁层。pnpm 可能警告链接包不会从目标 Profile 获取 peer dependencies；当前检出目录中安装的工作区依赖提供这些包。使用链接期间请保留检出目录及其依赖。

### 连接并运行任务

点击左下角侧栏的 **企业登录**，或打开 **设置 → 企业账号**，填写不带路径的管理服务 HTTP(S) origin 并保存。选择浏览器 SSO，在管理端审批页完成确认；也可以兑换管理员签发的成员接入码。页面显示登录成员、授权项目与模型数量、本月用量和待上报记录。在常规模型选择器中选择企业模型并提交任务。

连接页支持刷新授权、重试上报和退出。即使远端撤销失败，退出也会移除本地授权，并在页面显示失败原因。使用原成员重新登录后会继续上报该成员的队列记录。服务地址属于设置；成员 Cookie、CSRF 值和模型授权凭据属于 Host 凭据，不会作为表单字段展示。

模型设置仅显示自定义 API，隐藏内置提供商卡片和提供商目录。个人模型 API 仍可在 **设置 → 模型 → 自定义模型 API** 中配置，并与企业模型一起选择使用。管理端开启采集时，个人供应商用量默认以 `byok` 上报；关闭个人模型采集的方法见[用量配置](../../telemetry/unionpay-usage/README.zh.md#use-this-package)。

### 配置部署限制

Bundle 插入 `unionpay-connection`、`llm-unionpay`、`unionpay-usage` 和 `ui-unionpay` 四个节点。在 Profile 的 `cordis.patch.yml` 中配置各包文档列出的字段。[连接](../../credentials/unionpay-connection/README.zh.md)、[模型](../../llm/llm-unionpay/README.zh.md)与[用量](../../telemetry/unionpay-usage/README.zh.md)包分别说明默认值和失败处理。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 装配独立的 Host、模型、上报和 UI 插件。企业 Remote 方法由客户端插件挂载；内置 API 控制器和 Agent 循环没有企业专用分支。[`tests/enterprise.e2e.ts`](tests/enterprise.e2e.ts) 使用明确指定的 UnionPay Code 检出目录中的原始管理路由和持久化逻辑，并使用本地 OIDC 与模型提供方。运行该定向 e2e 文件前，将 `UNIONPAY_CODE_ROOT` 指向该检出目录，将 `UNIONPAY_NODE_MODULES_ROOT` 指向可解析其服务端依赖的安装目录。缺少任一值时测试跳过，不能据此断言与未指定部署兼容。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [企业连接](../../credentials/unionpay-connection/README.zh.md) — 身份验证与续期。
- [企业模型](../../llm/llm-unionpay/README.zh.md) — 支持的协议与模型能力。
- [用量上报](../../telemetry/unionpay-usage/README.zh.md) — 上报归属和重试限制。
- [企业页面](../../client/ui-unionpay/README.zh.md) — 客户端配置和状态。

-----

<a id="model-experience"></a>
## 模型体验

通过[受管模型插件](../../llm/llm-unionpay/README.zh.md#model-experience)间接影响模型，由该插件完成协议转换，不添加企业提示词。

#### KV Cache 影响

Bundle 自身不改变请求历史或缓存前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 每个 Host 数据目录的连接代表一位成员。它不会把 DSH 变成多租户服务，也不替代本地 Host 授权。
- 模型权限沿用管理服务对成员所属项目的并集授权。本地工作区选择不会建立项目级计费或授权。
- 工单、设备执行关联、远控和更新分发需要分别适配。
- 管理服务记录 `cli` 或 `desktop` 载体及带 `dsh-` 前缀的客户端版本，没有独立的 DSH 产品字段。
- 本地测试服务验收覆盖管理协议兼容性。部署环境的 TLS、企业身份提供方和实际模型提供方仍需要在目标环境中验收。

<a id="dev-note"></a>
### 开发备注

无。
