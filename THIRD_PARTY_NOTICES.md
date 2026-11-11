# 第三方声明

## lm-detector / lmfpd

- 出处：https://github.com/Ikaleio/lm-detector （MIT）
- 用途：数值指纹（把「数数」样本的统计纹理对到具体型号）。
- 随包放在 `lib/lmfpd/`，许可证原文见 `lib/lmfpd/LICENSE`。

## Veridrop

- 出处：https://github.com/canarybyte/veridrop （AGPL-3.0）
- 用途：**只参考它的检测维度与方法**（回声一致性 / usage 记账 / 函数调用 / 结构化输出 / 流式一致性）。
- AGPL-3.0 与 MIT 不兼容，所以 `lib/relay.mjs` 是照公开方法用 JavaScript 重新实现的，**没有复制它的任何代码**。

## Codex 应用图标

- 文件：`ui/brand/codex.png`（128×128），用来在供应商列表里标识 Codex 这个渠道。
- 出处：Codex 桌面端安装包内自带的 `Contents/Resources/icon-codex-dark.png`（应用版本 26.928.21956，bundle `com.openai.codex`）。OpenAI 未单独发布 Codex 的 logo 文件，`openai/codex` 仓库中也没有该资源，故取应用自带图标。
- 归属：该标识属于 OpenAI，此处的使用仅为指代 Codex 这一应用/渠道，不代表 OpenAI 的背书。
