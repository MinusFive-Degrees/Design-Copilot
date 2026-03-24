[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Design Copilot

Design Copilot 是面向嘉立创 EDA 的统一工作台插件，把原理图检查、PCB 检查、网络排查、报告回看和 AI 辅助分析集中到一个 GUI 中。

## 插件定位

这个项目不替代 EDA 本体，而是在设计流程里补一层更适合复盘和快速排查的工作台：

- 原理图阶段快速发现位号、封装、BOM 准备度和 DRC 风险
- PCB 阶段集中查看器件、焊盘、过孔、走线、覆铜和热点网络
- 用统一报告保留多轮检查结果，方便比较不同迭代
- 用自定义模型接口生成总结、整改建议、复核清单和问答结果

## 主要功能

- 统一工作台
  首页、原理图、PCB 菜单都只保留 `打开工作台` 一个入口，减少功能分散。
- 原理图检查
  支持综合检查、快速体检、原理图 DRC、选区快照。会统计器件、导线、总线、文本、网络标识、位号前缀分布、缺位号、缺封装和 BOM 准备度，并输出评分和建议动作。
- PCB 检查
  支持综合检查、快速体检、PCB DRC、选区快照和热点网络分析。会统计器件、焊盘、过孔、走线、圆弧、覆铜、区域和文本，识别高密网络、供应链信息缺失和过孔风险。
- 网络排查
  可以自动高亮最密网络，也可以从热点列表中点选网络，或按网络名直接聚焦，适合排查电源网、地网和关键高速网。
- 报告系统
  综合检查、体检、DRC 和选区快照都会生成统一格式报告。工作台显示最近结果，并保留最近 8 次历史记录。
- AI Copilot
  支持填写自定义接口地址、模型名、API Key、额外请求头 JSON、系统提示词和 Temperature。内置 `总结最近报告`、`生成整改建议`、`生成复核清单` 和 `自定义问答` 四类动作。

## 界面预览

工作台总览：
![工作台总览](image/README/image1.png)

原理图检查区：
![原理图检查区](image/README/image2.png)

PCB 检查区：
![PCB 检查区](image/README/image3.png)

报告舞台与历史记录：
![报告舞台与历史记录](image/README/image4.png)

参数设置与 AI 区：
![参数设置与 AI 区](image/README/image5.png)

AI 分析结果示例：
![AI 分析结果示例](image/README/image6.png)

## AI 使用说明

- AI 能力默认不绑定任何云服务，模型调用完全依赖你填写的自定义接口
- 当前请求格式按 OpenAI 兼容 `chat/completions` 组织
- 发送给模型的核心内容包括最近报告、当前文档上下文、热点网络和当前阈值
- 使用前需要在嘉立创 EDA 中打开扩展的 `外部交互` 权限

## 开发与打包

```bash
npm install
npm run build
```

打包完成后，安装包会输出到 `build/dist/`。

## 参考文档

- 嘉立创 EDA 扩展 API 指南: <https://prodocs.lceda.cn/cn/api/guide/>
- API 调用说明: <https://prodocs.lceda.cn/cn/api/guide/invoke-apis.html>

