---
kind: upgrade-guide
description: "模型设置仅展示用户声明的 API 路由。"
---

# 模型设置使用自定义 API

[English](guide.md) | 中文

## 变更

模型设置隐藏内置提供商，直接打开自定义 API 表单。移除 `ui-settings-models.customProvidersOnly` 选项，固定为 custom-only 行为。已有提供商配置和模型执行仍可使用。

## 迁移

1. 从 Profile 补丁的 `ui-settings-models` 条目中删除 `customProvidersOnly`。
2. 打开 **设置 → 模型**，通过 **自定义模型 API** 添加用户声明的路由。确认已保存的自定义路由仍可编辑，且不出现内置提供商目录。
