# よりそい Pro — 機能一覧・機能詳細

**対象リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`（`y-mori29/yorisoi-shisetsu` のフォーク）  
**ブランチ**: `feature/quick-soap`  
**最終更新**: 2026-06-11  
**用途**: AI・開発者向けの機能カタログ。実装確認・回帰テスト・仕様照合に使用する。

---

## 1. アプリ概要

訪問薬剤師（施設・在宅）向けプロトタイプ。Vite + React 19 + TypeScript + Tailwind（CDN）。ルーティングなし、`App.tsx` の state で 3 モードを切り替える。

| 項目 | 内容 |
|---|---|
| エントリ | `index.tsx` → `App.tsx` |
| 環境変数 | `.env.local` の `GEMINI_API_KEY`（Vite `define` 経由） |
| AI モデル | `gemini-2.5-flash`（`lib/geminiClient.ts`） |
| 永続化 | クイック SOAP のみ `localStorage`（キー: `yorisoi:shisetsu:quick-soaps`） |
| モックデータ | `data/rounds.ts`, `data/mockData.ts`（録音フロー用・静的） |

---

## 2. 機能一覧（サマリ）

| ID | モード | 機能名 | 状態 | 主要ファイル |
|---|---|---|---|---|
| R-01 | 録音から作成 | ラウンド一覧・選択 | 実装済（モック） | `App.tsx`, `data/rounds.ts` |
| R-02 | 録音から作成 | 施設名簿表示 | 実装済（モック） | `App.tsx`, `data/rounds.ts` |
| R-03 | 録音から作成 | 患者ブロック割り当て・確定 | 実装済（非永続） | `App.tsx` |
| R-04 | 録音から作成 | 文字起こしプレビュー | 実装済（モック） | `App.tsx` |
| R-05 | 録音から作成 | SOAP / 訪問診療テキスト表示 | 実装済（readOnly） | `App.tsx`（`buildSoapText`, `buildHomeVisitText`） |
| Q-01 | メモから作成 | 訪問先・患者・日付・メモ入力 | 実装済 | `components/QuickSoapPanel.tsx` |
| Q-02 | メモから作成 | Gemini SOAP 自動生成 | 実装済 | `lib/generateSoap.ts`, `lib/soapPrompt.v3.ts` |
| Q-03 | メモから作成 | SOAP 4 セクション編集 | 実装済 | `components/QuickSoapEditor.tsx` |
| Q-04 | メモから作成 | 保存・再生成・クリア | 実装済 | `QuickSoapPanel.tsx`, `lib/quickSoapStorage.ts` |
| Q-05 | メモから作成 | コピー用テキスト出力 | 実装済 | `lib/formatters.ts`（`buildQuickSoapText`） |
| H-01 | 履歴 | フィルタ・一覧 | 実装済 | `components/QuickSoapHistoryList.tsx` |
| H-02 | 履歴 | 詳細編集・更新・削除 | 実装済 | `QuickSoapHistoryList.tsx` |
| H-03 | 履歴 | コピー | 実装済 | `QuickSoapHistoryList.tsx` |
| C-01 | 共通 | モードタブ切替 | 実装済 | `App.tsx` |
| C-02 | 共通 | Toast 通知 | 実装済 | `App.tsx`（`Toast` コンポーネント内包） |

**未実装・スコープ外（参考）**

| ID | 内容 |
|---|---|
| X-01 | 録音 → 文字起こし → AI 分割（本番 API） |
| X-02 | 患者割り当ての localStorage 永続化 |
| X-03 | F-10: `medications` / `red_flags` の AI 抽出 |
| X-04 | 算定要件 validator（提案4 / Phase 3） |
| X-05 | バックエンド・認証・電子薬歴連携 |

---

## 3. 画面モード（App.tsx）

### 3.1 モード定義

```typescript
type AppMode = 'recording' | 'memo' | 'history';
```

| タブラベル | `mode` 値 | 左サイドバー | メインエリア |
|---|---|---|---|
| 録音から作成 | `recording` | ラウンドカード一覧 | 選択ラウンドの詳細（名簿・セグメント） |
| メモから作成 | `memo` | 操作説明 | `QuickSoapPanel` |
| 履歴 | `history` | 操作説明 | `QuickSoapHistoryList` |

### 3.2 受け入れ確認ポイント（AI 向け）

- [ ] 3 タブがサイドバー上部に表示される
- [ ] タブ切替でメインコンテンツが変わる
- [ ] `recording` モードで既存ラウンド UI が従来どおり動作する
- [ ] `memo` / `history` モードで録音 UI が表示されない
- [ ] Toast は全モードで共有される（`showToast`）

---

## 4. 機能詳細

### 4.1 録音から作成（R-01 〜 R-05）

**目的**: 訪問ラウンド録音を患者ブロックに分割し、施設名簿と突合して SOAP を確認するデモ UI。

**データソース**

- `FACILITIES`: 施設 2 件（`f1` さくら苑、`f2` 個人宅）
- `ROUNDS`: ラウンド 3 件（日付・時間帯・`segments[]`）
- 各 `RoundSegment` に `transcript`, `clinicalData`, `suggestedPatientId`（すべて静的モック）

**ユーザー操作**

1. 左サイドバーでラウンドカードを選択（`selectedRoundId`）
2. メインに施設情報・名簿・セグメント一覧を表示
3. セグメントごとに名簿患者を `<select>` で割り当て（`assignments` state）
4. 「確定する」で status を `confirmed` に変更（リロードで消失）
5. SOAP 形式・訪問診療フォーマットを readOnly textarea で表示

**関連 state（App.tsx）**

| state | 型 | 説明 |
|---|---|---|
| `selectedRoundId` | `string` | 選択中ラウンド ID |
| `assignments` | `Record<key, { rosterPatientId, status }>` | キー: `{roundId}-{segmentId}` |

**制約**

- `buildSoapText` / `buildHomeVisitText` は App.tsx 内関数。**変更禁止**（要件書）
- コピーボタンなし（textarea の手動選択のみ）
- AI 生成なし

---

### 4.2 メモから作成 — クイック SOAP（Q-01 〜 Q-05）

**目的**: 箇条書きメモ → Gemini → SOAP 4 セクション → 編集 → 保存 → 薬歴転記用コピー。

#### Q-01 入力フォーム（QuickSoapPanel）

| 項目 | 実装 |
|---|---|
| 訪問先 | `FACILITIES` から `<select>` |
| 患者 | 「名簿から選択」または「新規・未登録」（自由入力） |
| 訪問日 | `<input type="date">`、デフォルト今日 |
| 箇条書きメモ | `<textarea>`、プレースホルダに Few-shot 例 |
| 生成ボタン | 10 文字未満は disabled |

#### Q-02 SOAP 自動生成

**呼び出し**: `generateSoap({ bulletInput, patientContext })`

| パラメータ | 内容 |
|---|---|
| `bulletInput` | ユーザー入力（trim 後 10 文字以上必須） |
| `patientContext.name` | 患者表示名 |
| `patientContext.facility` | 施設名 |

**生成設定**

| 項目 | 値 |
|---|---|
| モデル | `gemini-2.5-flash` |
| temperature | `0.3` |
| タイムアウト | 30 秒（`SoapGenerationError` code: `TIMEOUT`） |
| 出力 | JSON `{ subjective, objective, assessment, plan }` |

**プロンプト（v3）の主要ルール**

- S: 発言主体タグ `[本人][家族][スタッフ][看護師]` 必須
- O: 薬剤名 + 用量 + 用法必須（「降圧剤継続中」禁止）
- P: Ep / Cp / Op 箇条書き（介護スタッフへの依頼 = Cp）
- Few-shot 3 例（施設フォロー / 在宅初回 / 認知症コンプライアンス）

**エラーコード（SoapGenerationError）**

| code | ユーザー向けメッセージ例 |
|---|---|
| `EMPTY_INPUT` | 入力不足 |
| `TIMEOUT` | 30 秒タイムアウト |
| `API_ERROR` | Gemini API エラー |
| `PARSE_ERROR` / `INVALID_OUTPUT` | パース・形式エラー |

#### Q-03 SOAP 編集（QuickSoapEditor）

- S / O / A / P 各 textarea（文字数表示）
- 「AI出力にリセット」: `baseline` に戻す（編集差分があるときのみ有効）
- 制御コンポーネント: `value`, `baseline`, `onChange`

#### Q-04 保存・再生成・クリア

| 操作 | 動作 |
|---|---|
| 保存 | 新規: `createQuickSoapRecord` + `saveQuickSoap` / 既存: `updateQuickSoap` |
| 再生成 | 同じ `bulletInput` で `generateSoap` 再実行（baseline 更新） |
| クリア | 入力・生成結果・savedRecordId をリセット |

**QuickSoapRecord 型**

```typescript
interface QuickSoapRecord {
  id: string;                    // qs-{uuid}
  facilityId: string | null;
  rosterPatientId: string | null;
  patientNameOverride?: string;
  date: string;                  // YYYY-MM-DD
  bulletInput: string;
  soap: ClinicalData['soap'];
  createdAt: string;             // ISO 8601
  updatedAt: string;
}
```

#### Q-05 コピー用テキスト（buildQuickSoapText）

```
【SOAP】
患者: {name} / 日付: {date}

S:
{subjective}

O:
{objective}

A:
{assessment}

P:
{plan}
```

- `pharmacy_focus` / `alerts` / `meta` は含まない（F-10 未実装）
- 「コピー」ボタン → `navigator.clipboard.writeText`

---

### 4.3 履歴（H-01 〜 H-03）

**ストレージ**: `localStorage` キー `yorisoi:shisetsu:quick-soaps`

**API（lib/quickSoapStorage.ts）**

| 関数 | 説明 |
|---|---|
| `createQuickSoapRecord` | ID・タイムスタンプ付与 |
| `saveQuickSoap` | 新規追加 or 上書き |
| `getQuickSoap(id)` | 1 件取得 |
| `listQuickSoaps(filter?)` | フィルタ + `updatedAt` 降順 |
| `updateQuickSoap(id, partial)` | 部分更新 |
| `deleteQuickSoap(id)` | 削除 |

**フィルタ（QuickSoapFilter）**

- `facilityId`, `rosterPatientId`, `dateFrom`, `dateTo`

**UI フロー**

1. フィルタ適用 → カード一覧
2. カード選択 → `QuickSoapEditor` で編集
3. 保存 / 削除 / コピー

---

### 4.4 共通（C-01 〜 C-02）

**Toast**

- `type`: `'success' | 'info'`（`error` 型は未追加）
- 2.4 秒で自動非表示
- 固定位置: 画面下部

---

## 5. ファイルマップ（実装 ↔ 機能）

```
App.tsx                          # モード切替、録音フロー、Toast
components/
  QuickSoapPanel.tsx             # Q-01〜Q-05
  QuickSoapEditor.tsx            # Q-03
  QuickSoapHistoryList.tsx       # H-01〜H-03
  SectionHeader.tsx              # 共通見出し
  SoapView.tsx                   # 未使用（レガシー）
  PatientSidebar.tsx             # 未使用（レガシー）
lib/
  geminiClient.ts                # Gemini 接続
  generateSoap.ts                # Q-02 生成ロジック
  soapPrompt.v3.ts               # プロンプト本体
  soapPrompt.ts                  # v3 re-export
  quickSoapStorage.ts            # H-* 永続化
  formatters.ts                  # buildQuickSoapText
data/
  rounds.ts                      # FACILITIES, ROUNDS
  mockData.ts                    # ClinicalData モック
types.ts                         # 全型（QuickSoapRecord 含む）
```

---

## 6. テストコマンド（AI 回帰確認用）

| コマンド | 確認内容 |
|---|---|
| `npm run test:gemini` | API キー・接続 |
| `npm run test:generate-soap` | 単一生成・パース |
| `npm run test:soap-examples` | Few-shot 3 例 + 再現テスト（12 項目） |
| `npm run test:storage` | localStorage CRUD（8 項目） |
| `npm run build` | TypeScript + Vite ビルド |

**前提**: `.env.local` に有効な `GEMINI_API_KEY`

---

## 7. 要件 ID との対応（requirements-soap.md）

| 要件 ID | 機能 | 状態 |
|---|---|---|
| F-01 | メモから作成タブ | ✅ |
| F-02 | 患者選択（名簿 / 新規） | ✅ |
| F-03 | 訪問先・日付 | ✅ |
| F-04 | 箇条書き入力 | ✅ |
| F-05 | SOAP 自動生成（30 秒以内） | ✅ |
| F-06 | SOAP 編集 | ✅ |
| F-07 | 保存・履歴 | ✅ |
| F-08 | buildQuickSoapText コピー | ✅ |
| F-09 | 再生成 | ✅ |
| F-10 | 薬学的フォーカス補完 | ❌ 未実装 |

---

## 8. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/requirements-soap.md` | 要件定義書 |
| `docs/codebase-survey.md` | Phase 0 調査 |
| `docs/prompt-changelog.md` | プロンプト v1/v2/v3 履歴 |
| `docs/soap_improvement_proposal.md` | 品質改善提案（validator = Phase 3） |
| `docs/soap-generation-logic.md` | 生成ロジック詳細 |
| `docs/soap_guideline_for_ai.md` | AI 向け SOAP ガイドライン |

---

## 9. AI 確認チェックリスト（E2E）

### メモから作成

1. `npm run dev` で起動
2. 「メモから作成」タブを選択
3. 訪問先・患者・日付を設定
4. 箇条書きメモ（10 文字以上）を入力 → 「SOAP生成」
5. S/O/A/P が表示され、各セクションを編集できる
6. 「保存」→ Toast「SOAP を保存しました」
7. 「コピー」→ クリップボードに `【SOAP】` 形式テキスト

### 履歴

1. 「履歴」タブを選択
2. 保存したレコードが一覧に表示される
3. 選択 → 編集 → 保存
4. 削除 → 一覧から消える

### 録音から作成（回帰）

1. 「録音から作成」タブを選択
2. ラウンド選択 → 名簿・セグメント表示
3. 患者割り当て → 確定 → Toast 表示
4. SOAP / 訪問診療 textarea にテキストが入る
