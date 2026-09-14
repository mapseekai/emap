# Agent 設定審計（2026-09-14）

本紀錄是審計證據，不是每次任務需載入的操作規範。

## 範圍與依據

審計目前 checkout 的 `AGENTS.md`、`CLAUDE.md`、雙語 README、
`SECURITY.md`、發布清單、CI / npm 發布工作流程、`package.json`、
`skills-lock.json`，以及架構決策、歷史計畫中的 Agent 指令引用。
盤點包含隱藏與忽略的設定目錄；排除依賴、生成物、索引及 `.worktrees/`
中的其他 checkout，避免改動其他任務。

目前沒有專案內的 `SKILL.md`、獨立 Prompt 或 `.claude` / `.agents` /
`.codex` / `.cursor` 設定。`skills-lock.json` 的 15 筆 agentmemory 項目是
外部來源與雜湊，並非 Skill 本文。本次保留鎖檔，不修改全域個人 Skills
或安裝的插件快取，也不聲稱已逐一重構這些外部 Skills。

依據已讀取的官方 [GPT-6 Astra 指引](https://developers.openai.com/api/docs/guides/latest-model)、
[Skill 文件](https://learn.chatgpt.com/docs/build-skills) 與
[AGENTS.md 文件](https://learn.chatgpt.com/docs/agent-configuration/agents-md)，
採用明確完成條件、範圍內自主執行、適度驗證與按需載入。未更改模型、
API 參數或專案功能。

## 已完成的修改

| 檔案 | 修改 |
| --- | --- |
| `AGENTS.md` | 271 行縮為 103 行；保留專案硬性規則，加入條件式文件入口、自主執行及完成標準 |
| `CLAUDE.md` | 49 行縮為 6 行，以 `@AGENTS.md` 共用唯一規則來源 |
| `docs/agent-tools.md` | 按需載入 GitNexus / CodeGraph 操作與 Skill 選用、維護規則 |
| `README.md`、`README.zh-CN.md` | 檢查命令改為按改動選用；操作效果分類回指單一規則來源 |
| `docs/release-checklist.md` | 區分純 Agent 指令修改、產品文件修改與發布完整驗證 |

移除重複 GitNexus 區塊、互相矛盾的索引數字、失效的 `.claude/skills/`
路徑、大量無關 RTK 命令表、固定 `master` 比較假設，以及不確定就停下
詢問的廣泛要求。圖工具優先與修改前影響分析仍保留，但工具不可用時可
檢查來源、呼叫者和測試繼續處理，不必為一般修改安裝全域工具。

沒有既有專案 Skill 可搬移；漸進式載入實際用於工具細節、架構、DuckDB、
安全及發布文件。沒有新增為了形式而存在的 Skill。

## 保留的邊界

六區架構、domain 隔離、原生 Cordis、測試佈局、EventDispatcher、
AffineTransform、LayerRegistry、延後 render 副作用、COMMAND_EFFECTS、
mapshaper 匯入限制、API 契約，以及歷史、交易、選擇還原與過期結果保護
均保留。發布完整驗證、依賴審計失敗阻擋及其限時例外未放寬。

本機修改及驗證可持續執行；Production、發布、破壞性資料操作、憑證變更
與外部寫入須有涵蓋該動作的授權。漏洞遵循 `SECURITY.md` 私密通報，
避免一般 Multica 建單要求造成公開揭露。無法建單時保留本機紀錄並報告
阻礙，不以追蹤工具失效作為放棄其他工作的理由。

## 驗證

- 六份操作文件的 51 個本機連結／錨點與 44 個 package script 引用通過。
- `git diff --check` 通過。
- `pnpm run test-layout:check` 通過：143 個同名 colocated 單元測試。
- `pnpm run architecture:check` 通過：410 個 production modules，無 runtime cycle。
- `pnpm exec vitest run test/docs/checkers.test.ts` 通過：17 個測試。
- 與本次開始時的檔案快照比對，雙語 README 及發布清單僅修改操作指引；
  不回滾原有未提交的架構遷移。
- 人工情境審閱：純指令修改只檢查文件；公開型別修改跑契約檢查；發布跑
  完整 gate 並確認動作授權；圖工具不可用有替代流程；漏洞走私密通報；
  普通 GIS 任務不觸發記憶管理或部署 Skill。這是規則審閱，非模型行為評測。

本次未修改 production code、API、套件或 CI，故未執行完整 build、
瀏覽器矩陣或發布驗證。沒有已知尚未處理的本次範圍問題，無需人工決策。
