[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Design Copilot

Design Copilot 是面向嘉立創 EDA 的統一工作台擴展，將原理圖檢查、PCB 檢查、網路排查、報告回看與 AI 輔助分析集中到同一個 GUI 中。

## 專案定位

這個專案不取代 EDA 編輯器本身，而是在設計流程中補上一層更適合快速體檢與復盤的工作台：

- 在原理圖階段快速發現位號、封裝、BOM 準備度與 DRC 問題
- 在 PCB 階段集中查看器件、焊盤、過孔、走線、覆銅與熱點網路
- 用統一報告保留多輪檢查結果，方便比較不同迭代
- 用自訂模型接口生成摘要、整改建議、複核清單與問答結果

## 主要功能

- 統一工作台
  首頁、原理圖、PCB 功能表都只保留 `打開工作台` 一個入口，避免功能分散。
- 原理圖檢查
  支援綜合檢查、快速體檢、原理圖 DRC 與選區快照。會統計器件、導線、總線、文字、網路標識、位號前綴分布、缺位號、缺封裝與 BOM 準備度，並輸出評分與建議動作。
- PCB 檢查
  支援綜合檢查、快速體檢、PCB DRC、選區快照與熱點網路分析。會統計器件、焊盤、過孔、走線、圓弧、覆銅、區域與文字，並評估高密網路、供應鏈資訊缺失與過孔風險。
- 網路排查
  可以自動高亮最密網路，也可以從熱點列表點選目標，或依網路名稱直接聚焦，適合排查電源網、地網與關鍵高速網路。
- 報告系統
  綜合檢查、體檢、DRC 與選區快照都會生成統一格式報告。工作台顯示最近結果，並保留最近 8 次歷史記錄。
- AI Copilot
  支援填寫自訂接口地址、模型名、API Key、額外請求頭 JSON、系統提示詞與 Temperature。內建 `總結最近報告`、`生成整改建議`、`生成複核清單` 與 `自訂問答` 四類動作。

## 介面預覽

工作台總覽：
![工作台總覽](image/README/image1.png)

原理圖檢查區：
![原理圖檢查區](image/README/image2.png)

PCB 檢查區：
![PCB 檢查區](image/README/image3.png)

報告舞台與歷史記錄：
![報告舞台與歷史記錄](image/README/image4.png)

參數設定與 AI 區：
![參數設定與 AI 區](image/README/image5.png)

AI 分析結果示例：
![AI 分析結果示例](image/README/image6.png)

## AI 使用說明

- AI 功能本身不綁定任何雲端模型，請求完全使用你填寫的自訂接口
- 目前請求格式依照 OpenAI 相容 `chat/completions` 組織
- 發送給模型的核心內容包括最近報告、當前文檔上下文、熱點網路與目前閾值
- 使用前需要在嘉立創 EDA 中開啟擴展的 `外部互動` 權限

## 開發與打包

```bash
npm install
npm run build
```

打包完成後，安裝包會輸出到 `build/dist/`。

## 參考文件

- 嘉立創 EDA 擴展 API 指南: <https://prodocs.lceda.cn/cn/api/guide/>
- API 呼叫說明: <https://prodocs.lceda.cn/cn/api/guide/invoke-apis.html>

