---
description: 暫存並提交所有變更，依邏輯分批並冠上 [Type] 前綴。
---

# /commit — Atomic Commit Guide

Git commit current changes, split into batches if needed.

Review all uncommitted changes (`git status` + `git diff HEAD` 同時涵蓋 staged 與 unstaged)。Group them into logical batches — one concern per commit (e.g. feature code, tests, docs, config). For each batch:

1. Stage only the files belonging to that batch.
2. Write a commit message in the format `[Type] description` — type wrapped in square brackets, first letter capitalized, no scope, no colon after the bracket.
3. Commit.

If all changes form a single coherent unit, make one commit. Never bundle unrelated changes into one commit.

> **只想看 commit 計畫、不要實際執行？** 改用 `/cm`（draft only — 輸出每 batch 一個 `git add ... && git commit -m "..."` 的 bash 區塊讓你 copy-paste，不會自己跑 git）。

## 專案設定

這份檔案設計為可跨專案沿用；下列項目請依實際專案填寫或刪除對應章節：

- **建構系統範例檔**：`[Build]` 類型下方列的檔名請依專案技術棧調整（Node → `package.json`；Python → `requirements.txt` / `pyproject.toml`；Java → `pom.xml` / `build.gradle`；Rust → `Cargo.toml`；Flutter → `pubspec.yaml`；iOS → `Podfile`）。
- **敏感檔名清單**：下方「檔名 pattern」為通用起點，請依專案使用的雲端服務 / 框架補充（例：Firebase 專案補 `firebase_options*.dart`、`google-services.json`；Rails 補 `config/master.key`；一般專案補 `id_rsa`、`.npmrc`、`appsettings*.json`）。
- **加密工具選項**：Secret 處理流程中的「用加密工具處理」選項，僅在專案已設定對應工具（如 git-crypt、sops、git-secret）時提供；若未設定，刪除或改為「請先設定好加密工具再繼續」提示。

## 語言

commit message 一律用**繁體中文**，`[Type]` prefix 保持英文。技術名詞（變數名稱、欄位名、類別名、方法名等）保持原英文，不翻譯。

**不要在 commit message 帶單號 / 票號 / issue 編號**（例如 `PRJ-1295`、`Closes #123`）——
subject 與 footer 都不帶。單號由分支名稱與 MR 承載，commit message 只描述變動本身。

## Format

```text
[Type] short imperative description (≤50 chars)

Optional body, explain what and why (not how).
Wrap each line at 72 chars. Use blank line to separate paragraphs.

- Bullet points OK, hanging indent
- Reference what changed, contrast with previous behavior

Optional footer: BREAKING CHANGE / revert metadata.
```

範例（保持此格式，路徑為示意，請替換為專案實際情境）：

- `[Feat] add user profile export endpoint`
- `[Fix] import required library`
- `[Docs] 更新 API 文件：新增匯出格式說明`
- `[Refactor] extract banner section into widget class`

## Subject line 七大原則（Seven rules）

1. **Subject 與 body 之間留一行空白**（沒 body 就不留）。
2. **Subject ≤ 50 字元**（`[Type]` prefix 含在內，是經驗法則不是硬限；超過代表此 commit 做太多事）。
3. **`[Type]` 首字母大寫**（`[Feat]` 不寫成 `[feat]`）；`[Type]` 後接的 description 採小寫。
4. **Subject 結尾不加句號**。
5. **Subject 用祈使句、現在式**：`add` 不是 `added` / `adds`；測試法則 — 能套進「If applied, this commit will _subject_」就對。
6. **Body 每行 ≤ 72 字元**斷行。
7. **Body 解釋 what & why，不解釋 how**（how 看 diff 即可）。

## 完整結構（Header / Body / Footer）

```text
[Type] subject

Body：詳細描述本次變動。可分多段，段落間留空行。
解釋程式碼變動的「項目」與「原因」，以及與先前行為的對比。

- 重點 1
- 重點 2

Footer：BREAKING CHANGE（可選）。
```

- **Header**（必填）：`[Type] subject`
- **Body**（可選）：複雜變更才加；簡單一行就解釋得清楚的不要硬塞
- **Footer**（可選）：見下方特殊情況

## Footer 特殊情況

### BREAKING CHANGE

不相容變動必須在 footer 以 `BREAKING CHANGE:` 開頭，後接描述、原因、遷移方式：

```text
[Feat] rename port-runner option to runner-port

BREAKING CHANGE: isolate scope bindings definition has changed.

`port-runner` command line option has changed to `runner-port`, so that
it is consistent with the configuration file syntax.

To migrate your project, change all the commands, where you use
`--port-runner` to `--runner-port`.
```

### Revert

revert 上一個 commit 時，subject 以 `revert:` 開頭並帶上被 revert 的 header；body 必須註明 SHA：

```text
revert: [Feat] add 'graphiteWidth' option

This reverts commit 667ecc1654a317a13331b17617d973392f415f02.
```

## Type options (pick one)

「常用」標記表示大多數專案最常出現；其餘類型遇到對應情境時才使用。

- `[Build]`（常用）— Changes that affect the build system or external dependencies（請依專案技術棧調整範例：Node 的 `package.json`、Python 的 `requirements.txt` / `pyproject.toml`、Java 的 `pom.xml`、Rust 的 `Cargo.toml`、Flutter 的 `pubspec.yaml`、iOS 的 `Podfile` 等）
- `[Chore]` — 建構程序或輔助工具的變動；implementation of an existing feature without fix, configuration files (`.gitignore`, `.gitattributes`), private internal methods — nothing an external user would see。**判準：不改 source**；例：依賴升版、重產 generated files、檔案搬移、刪沒用的 asset
- `[Ci]` — Changes to CI configuration files and scripts (GitHub Actions, GitLab CI, CircleCI, Fastlane 等)
- `[Docs]`（常用）— 文件類型檔案更動（README、CLAUDE.md、spec、註解）
- `[Feat]`（常用）— 新增/修改功能（feature）— correlates with PATCH in semver
- `[Fix]`（常用）— 修補 bug — correlates with MINOR in semver
- `[Hotfix]` — 不影響主版本的更新（緊急修補）
- `[Perf]`（常用）— 改善效能（code change that improves performance）
- `[Refactor]` — 重構（既不是新增功能，也不是修補 bug 的程式碼變動）。**判準：改 source 但不改行為**；例：刪 dead code、抽方法、改命名、調結構
- `[Style]` — 格式（不影響程式碼運行的變動：white-space、formatting、missing semicolons 等）
- `[Test]`（常用）— 增加測試或修正既有測試

## Atomic commit 原則

- 一個 commit 只做一件事（feat + fix 不可合併、refactor 與 config 不可合併）。
- Subject 寫不出 50 字以內 → 八成是這個 commit 做太多事，先拆。
- 每個有意義的異動（issue）獨立成一個 commit，commit 才會跟異動的程式碼有真正關聯。
- Tests 跟著被測 code 走（同一 commit），不單獨拆成 `[Test]` 除非是補測既有功能。
- 不要帶單號 / 票號：即使分支名或 MR 有 `PRJ-xxxx`，commit message 也不重複帶。
- 不要把 Git 當 FTP — 每筆 commit 都要對未來查歷史的人有意義。

## 執行前預檢（pre-flight，必做）

`git commit` 會把**所有 staged 檔案**一起寫進 commit、不只是當下 `git add` 的那些。所以分批 commit 前必須先確認 index 是乾淨的。

跑：

```bash
git diff --cached --name-only
```

- **輸出空** → 沒有遺留 staged 檔，直接進「執行流程」
- **輸出有檔名** → 有檔案在 `git status` 顯示 `M ` / `A ` / `R ` 等（標記在第一欄、第二欄為空格）。此時必須先處理，**不可直接進 batch 流程**——否則第一個 batch 的 `git commit` 會吃掉所有 pre-staged 檔，違反 atomic 原則

### Pre-staged 檔案的處理

對 caller 列出有哪些檔已 staged + diff 摘要，然後問：

```text
偵測到 N 個檔案已 pre-staged（可能是先前 git add / stash checkout / hook 留下的）：

  M  path/to/foo
  A  path/to/bar.md

請選擇：
(A) Unstage 全部，從乾淨狀態重新分批     → 跑 git reset HEAD（保留工作樹改動）
(B) 把這些 pre-staged 檔當第一個 batch    → 視為一個獨立 concern、優先 commit
(C) 我自己處理，先中止                    → 退出，不執行任何 git 動作
```

- `/commit` 模式：**必須**等使用者選 (A) / (B) / (C) 才繼續，不可自動往下
- `/cm` 模式：在輸出的計畫**最前面**列出 pre-staged 警告 + 三選一說明（draft 不執行，由使用者貼指令時自己決定）

### 邊界情況

- **Stash checkout (`git checkout stash@{0} -- <file>`)** → 會自動 stage，是常見的 pre-staged 來源
- **`git add -p` 中斷** → 部分 hunk 已 stage，可能是預期行為，問清楚比自動處理安全
- **自動化 hook 產出的檔**（例如文件同步腳本、code generator 在 Stop/PostToolUse 階段寫入的檔案）→ 通常不會被 stage，但若有發現也走同流程；請依專案實際的 hook 設定調整判斷依據

## 執行流程（直接判斷、直接 commit）

`/commit` 的定位：**自動分批 + 立即執行**，不等使用者確認。

1. 跑 `git status` + `git diff HEAD` 取狀態（含 staged / unstaged / untracked）。
2. **若變更中出現任何大型資料檔案（如 `.jsonl`、資料庫 dump、二進位快取等，請依專案實際情況定義），必須通知使用者** — 列出相關檔案，然後完全略過，照常繼續其餘 commit；只有在使用者明確指定檔名並要求時，才對這些檔案執行 git 操作（commit、discard 等）。
3. 依 concern 分組（一個 concern = 一個 batch）。
   - **`.gitignore` 優先原則**：若變更中包含 `.gitignore`（或 `.gitignore_global`），必須將其單獨作為**第一個 batch** commit，再處理其餘變更。Type 用 `[Chore]`。
4. 對每個 batch 依序執行：
   a. **暫存前預檢**：先跑 `git status`，確認是否有不屬於本 batch 的 staged 檔（左欄顯示 `M`/`A`/`D`）。有的話先跑 `git restore --staged <file>` 移出 index，避免被誤帶進 commit。
   b. **決定每個檔案的暫存策略**：
      - **所有 hunk 屬於同一 concern** → `git add <file>`（整檔暫存）
      - **Hunk 橫跨多個 concern** → 用 patch 只暫存屬於本 batch 的 hunk：
        1. `git diff <file>` — 取得完整 diff
        2. 萃取本 batch 的 hunk（保留 file header 行與正確的 `@@ … @@` context 行）
        3. 將 partial patch 寫入暫存檔，再跑 `git apply --cached <tmpfile>`
        4. Commit；剩餘 hunk 留給後續 batch 處理
   c. 寫 compliant commit message，執行 `git commit -m "[Type] description"`（不用 `-A` / `.`）
5. 每跑一個 batch 前，先在對話輸出**一行 intent note + 即將執行的命令**，讓使用者邊看邊追蹤；**不要**等待確認。
6. **唯一會打斷自動執行的條件**：Secret 偵測命中（見下節）—— 此時必須停下、列出敏感檔、提供選項給使用者選，等明確指示後才繼續。

範例執行軌跡（路徑為示意，請替換為專案實際檔案）：

```text
Batch 1 — 修正圖片元件在系統字體放大時被裁切
$ git add path/to/component.ext
$ git commit -m "[Fix] center image with alignment for large font"
[main abc1234] [Fix] center image with alignment for large font

Batch 2 — 補上元件測試
$ git add path/to/component_test.ext
$ git commit -m "[Test] cover alignment in 3 font scales"
[main def5678] [Test] cover alignment in 3 font scales
```

> **想先看計畫、再決定要不要跑？** 改用 `/cm`（draft only — 列出每 batch 的 intent + 對應 bash 區塊讓你 copy-paste，不會自己跑 git）。

## 安全規範（沿用 `/cm`）

- **不要**在 commit message 加 `🤖 Generated with Claude Code` 或任何 AI 產出 trailer。
- description 內若含雙引號，必須 escape（`\"`），讓 shell 命令可直接 paste。
- **不要**用 `git add -A` / `git add .`：每個 batch 一律 `git add <具體檔案>`，避免把暫存檔、IDE 產物、`.DS_Store` 等帶進 commit。
- **明顯的 tooling artifact / 不該 commit 的檔案**（IDE local settings、build output、log）→ 純文字標出，不產生 `git add`。
- **不要 `--no-verify`** 跳 hook、不要 `--amend` 既有 commit、不要 force push（除非使用者明確要求且該 branch 安全）。

### Secret / 敏感資訊偵測（必做，不可略過）

**掃描範圍：檔名 + diff 新增行內容（兩層都要看）。**

#### 檔名 pattern（命中即視為敏感；以下為通用起點，請依專案技術棧補充）

- `.env`（本機機密 override；**不含**以下視為可 commit 的 template / 環境配置：`.env.example`、`.env.sample`、`.env.template`、`.env.<env>` 例 `.env.uat` / `.env.prod` / `.env.staging` / `.env.dev`。這些檔案仍會走下方「內容 pattern」掃描，若不慎寫入真 secret 仍會被攔下）
- `*credentials*`, `*secret*`, `*token*`, `*password*`
- `*.pem`, `*.key`, `*.p12`, `*.keystore`, `*.jks`, `id_rsa`, `id_ed25519`
- `.npmrc`（可能含 auth token）
- 雲端服務設定檔（請依專案使用的服務補充，例：Firebase 的 `firebase_options*.dart` / `google-services.json` / `GoogleService-Info.plist`；Rails 的 `config/master.key`；.NET 的 `appsettings.*.json`）
- `*service-account*.json`, `*.kdbx`

#### 內容 pattern（在 `git diff HEAD` 的 `+` 新增行 grep）

- `api[-_]?key`, `apikey`, `access[-_]?token`, `auth[-_]?token`, `bearer\s+[A-Za-z0-9._-]{20,}`
- `aws[-_]?(access|secret)`、`AKIA[0-9A-Z]{16}`（AWS Access Key）
- `xox[baprs]-[0-9a-zA-Z-]+`（Slack token）
- `gh[pousr]_[A-Za-z0-9]{36,}`（GitHub PAT）
- `sk-[A-Za-z0-9]{20,}`（OpenAI / Anthropic-style key）
- `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`（JWT）
- `-----BEGIN [A-Z ]*PRIVATE KEY-----`
- `password\s*[:=]\s*["'][^"']{6,}["']`、`secret\s*[:=]\s*["'][^"']{12,}["']`
- 連續 ≥32 字 hex / base64-like，且鄰近 `password` / `secret` / `token` / `key` 等關鍵字

#### 處理流程（命中後必走）

1. **完全跳過**該檔案：不產生它的 `git add` 與 commit。
2. 在 plan **最前面**用醒目區塊列出（不要藏在最後）：

   ```text
   ⚠️ 偵測到疑似敏感資訊，已從本次 commit 略過：

   - path/to/secrets_config.ext
     觸發：內容 pattern `sk-[A-Za-z0-9]{20,}`
     片段：`const _apiKey = "sk-prod-xxxx…REDACTED…xxxx";`（已 mask 中段）
   - .env.production
     觸發：檔名 pattern `.env.*`
   ```

3. **mask 明文**：列出觸發片段時，中段以 `…REDACTED…` 取代，僅保留前後 4 字以利使用者辨識。**不要在輸出中重印完整 secret**。
4. 提供處理選項，等使用者明確指示後才動作（不要主動改檔、不要主動 `.gitignore`、不要主動 unstage）：

   ```text
   請選擇處理方式：
   (A) 這是 placeholder / mock 值，請繼續 commit
   (B) 加入 .gitignore（我會幫你寫進去並從 index 移除：git rm --cached <file>）
   (C) 用專案既有的加密工具處理（若已設定 git-crypt / sops / git-secret 等）
   (D) 我自己處理，先別動
   ```

5. 使用者若選 (A)（false positive）→ 僅在**本次對話**內豁免，繼續 commit；**不要**把豁免存進 memory，避免下次誤放行。
6. 使用者若選 (B) → 把檔案加入 `.gitignore`，再 `git rm --cached <file>`，把這兩個動作合成一個 `[Chore]` commit；原本的敏感變更**永遠不進 commit**。
7. 處理完敏感檔後，剩餘檔案才進入正常分批 commit 流程。

#### 邊界情況

- **檔案是現有的、本次沒改但被 stage 進來** → 一樣套用此規則（避免歷史敏感檔被誤 commit）。
- **`.gitignore` / `.gitattributes` 本身的變更** → 即使內容含 `*key*` 字樣也不算 secret，視為正常 config 變更。
- **測試 fixture 內的假 token**（如 `"fake-token-for-test"`、`"sk-test-1234"`）→ 仍會命中內容 pattern；此時走 (A) 豁免，但**只豁免本次**。
- **commit 已經跑出去了才發現** → 不要 `--amend` 自行修補，停下來告訴使用者「已 commit，建議 `git reset` 或 BFG / git-filter-repo 清史」，由使用者決定。

## 防呆檢查（commit 前自問）

- [ ] Subject 是否 ≤ 50 字元、`[Type]` 首字母大寫、結尾無句號、祈使現在式？
- [ ] 「If applied, this commit will _subject_」念起來通順？
- [ ] 每個 batch 是否只動「同一個 concern」的檔案？
- [ ] 有 body 時，subject 與 body 是否隔一行空白、body 每行 ≤ 72 字元？
- [ ] 有不相容變動時，是否在 footer 加 `BREAKING CHANGE:`？
- [ ] Subject 與 footer 是否都沒有帶單號 / 票號 / issue 編號？
