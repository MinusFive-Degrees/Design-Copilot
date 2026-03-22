[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Design Copilot

Design Copilot is a unified workbench extension for JLCEDA. It brings schematic inspection, PCB inspection, net debugging, report review, and AI-assisted analysis into a single GUI.

## What This Project Does

This project is not a replacement for the EDA editor itself. Its role is to add a fast inspection and review layer to the design workflow:

- detect designator, footprint, BOM readiness, and DRC risks during schematic work
- analyze components, pads, vias, tracks, copper areas, and dense nets during PCB work
- keep reusable reports for multi-round review and comparison
- use an AI agent to summarize reports, suggest fixes, build review checklists, and answer custom prompts

## Current Features

- Unified workbench
  Home, schematic, and PCB menus all expose only `Open Workbench`. Inspection actions, net tools, report review, settings, and AI features are all grouped into the same GUI instead of being split across many menu items.
- Schematic tools
  Includes integrated check, quick audit, schematic DRC, and selection snapshot. The audit collects component, wire, bus, text, and net-marker counts, tracks designator prefix distribution, BOM readiness, missing designators, missing footprints, and produces a score with suggested actions.
- PCB tools
  Includes integrated check, quick audit, PCB DRC, selection snapshot, and dense-net analysis. The audit counts components, pads, vias, tracks, arcs, pours, fills, regions, and text objects, analyzes hot nets, evaluates supplier/manufacturer completeness, via-risk level, and produces a design score.
- Net debugging tools
  In PCB context, the workbench can highlight the densest net automatically, let the user pick from the current dense-net list, or focus directly by net name. This is useful for power rails, ground nets, and high-speed routing review.
- Report system
  Every integrated check, audit, DRC run, and selection snapshot generates a unified report. The workbench shows the latest report in the report stage and keeps the latest 8 history entries for multi-round comparison and review.
- Parameter management
  The GUI can directly edit `Top Net Count`, `Dense Net Threshold`, `Selection Preview Limit`, and `Via Risk Threshold`. These values affect hot-net ranking, snapshot previews, and PCB risk prompts in reports.
- AI assistant
  Supports a custom endpoint, model name, API key, extra header JSON, system prompt, and temperature. Built-in actions include `Summarize Latest Report`, `Suggest Fixes`, `Build Review Checklist`, and `Custom Prompt`, and each request automatically includes the latest report, current document context, dense-net information, and active thresholds.

## Data Sources

- Design statistics come from the `eda.sch_*`, `eda.pcb_*`, and `eda.dmt_*` API families
- Latest reports, history, settings, and AI config are stored with `eda.sys_Storage`
- AI requests are sent through `eda.sys_ClientUrl.request`

> Before using the AI assistant, enable the extension's external interaction permission in JLCEDA and make sure the target endpoint allows CORS. The current request payload follows an OpenAI-compatible `chat/completions` format.

## Build And Package

```bash
npm install
npm run build
```

## References

- JLCEDA Pro API Guide: [https://prodocs.lceda.cn/cn/api/guide/](https://prodocs.lceda.cn/cn/api/guide/)
- API Invocation Guide: [https://prodocs.lceda.cn/cn/api/guide/invoke-apis.html](https://prodocs.lceda.cn/cn/api/guide/invoke-apis.html)
