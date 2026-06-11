# コードベース調査レポート（Phase 0）

**調査日**: 2026-06-11  
**対象**: `yorisoi-shisetsu` リポジトリ  
**目的**: クイックSOAP整形機能追加に向けた既存資産の把握

---

## 1. プロジェクト全体構造

### 技術スタック

| 項目 | 内容 |
|---|---|
| ビルド | Vite 6 + `@vitejs/plugin-react` |
| フレームワーク | React 19 + TypeScript 5.8 |
| スタイリング | Tailwind CSS（CDN: `index.html` 内 `<script src="https://cdn.tailwindcss.com">`） |
| ルーティング | なし（React Router 未使用） |
| 状態管理 | `useState` / `useMemo` のみ（外部ライブラリなし） |

### ディレクトリ構成

```
yorisoi-shisetsu/
├── App.tsx              # メインアプリ（画面全体・ユーティリティ・Toast 等を内包）
├── index.tsx            # エントリポイント
├── index.html           # HTML + Tailwind CDN
├── types.ts             # 全型定義
├── vite.config.ts       # ビルド設定 + GEMINI_API_KEY の define
├── data/
│   ├── rounds.ts        # FACILITIES / ROUNDS（施設・ラウンドのモック）
│   └── mockData.ts      # MOCK_PATIENTS + ClinicalData サンプル（大容量）
├── components/
│   ├── SectionHeader.tsx   # セクション見出し（App.tsx で使用中）
│   ├── SoapView.tsx        # SOAP 詳細編集 UI（未使用・レガシー）
│   └── PatientSidebar.tsx  # 患者リストサイドバー（未使用・レガシー）
└── docs/                # 要件定義・指示書
```

**`lib/` / `utils/` フォルダは存在しない。**

### `App.tsx` の役割と画面遷移

- **役割**: アプリ全体を1ファイルに集約。以下をすべて内包している。
  - `Toast` コンポーネント
  - `toDateLabel`, `buildSoapText`, `buildHomeVisitText` ユーティリティ
  - `VisitPill`, `PatientRosterBadge` サブコンポーネント
  - ラウンド一覧サイドバー + メイン詳細ビュー
- **画面遷移**: **state ベース**（ルーターなし）
  - `selectedRoundId` で左サイドバーのラウンドカード選択 → メインエリアに該当ラウンドの詳細表示
  - ラウンド未選択時は「ラウンドを選択してください」プレースホルダ
- **その他 state**:
  - `assignments`: セグメントごとの患者紐付け（`Record<roundId-segmentId, { rosterPatientId, status }>`）
  - `toast`: 通知表示

### `components/` 各コンポーネントの責務

| コンポーネント | 責務 | 使用状況 |
|---|---|---|
| `SectionHeader` | アイコン + タイトルのセクション見出し | **App.tsx で使用中** |
| `SoapView` | ClinicalData 全体の編集 UI（SOAP 4セクション + 薬学的介入 + Red Flags 等） | **未使用**（AI Studio 時代の残骸と推定） |
| `PatientSidebar` | 患者検索・ソート付きサイドバー | **未使用**（同上） |
| `Toast`（App.tsx 内） | 成功/情報トースト（2.4秒自動非表示） | 使用中 |
| `VisitPill`（App.tsx 内） | 施設/個人宅バッジ | 使用中 |
| `PatientRosterBadge`（App.tsx 内） | 名簿患者カード | 使用中 |

### `data/rounds.ts` の中身と型構造

- **`FACILITIES`**: 2施設
  - `f1` さくら苑（施設、`type: 'facility'`）— roster 5名
  - `f2` 個人宅（港区・在宅医療、`type: 'home'`）— roster 3名
- **`ROUNDS`**: 3ラウンド（2025-11-12 午前/午後 @ f1、2025-11-10 午前 @ f2）
- 各 `RoundSegment` は `mockData.ts` の `MOCK_PATIENTS` から `pickRecord()` で `clinicalData` と `transcript` を取得
- **すべて静的ハードコード**。実行時の変更・永続化なし

### `types.ts` の全型定義

| 型名 | 概要 |
|---|---|
| `Medication` | 薬剤名・用量・経路・頻度・ステータス・備考 |
| `PharmacyFocus` | 薬剤一覧・アドヒアランス・副作用・DRP・検査・指導・フォローアップ |
| `Soap` | `{ subjective, objective, assessment, plan }` |
| `Alerts` | `red_flags`, `need_to_contact_physician` |
| `Meta` | `main_problems`, `note_for_pharmacy` |
| **`ClinicalData`** | **`{ soap, pharmacy_focus, alerts, meta }`** — 本機能の生成結果の上位型 |
| `Record` | 患者1件分の診療記録（id, date, transcript, clinicalData, status）※名前が JS の `Record` と紛らわしい |
| `Patient` | 患者マスタ（id, name, kana, birthDate, age, gender, avatarColor, records[]） |
| `VisitType` | `'facility' \| 'home'` |
| **`RosterPatient`** | **`{ id, name, kana, room?, note? }`** — 施設名簿の1行 |
| **`Facility`** | **`{ id, name, type, address?, roster[] }`** |
| **`RoundSegment`** | **`{ id, order, predictedName, transcript, clinicalData, suggestedPatientId? }`** |
| **`Round`** | **`{ id, date, timeframe, facilityId, segments[] }`** |

---

## 2. ルーティング・画面遷移

### 現状の画面構成

```
┌─────────────────────┬──────────────────────────────────────────┐
│ 左サイドバー (md:w-96) │ メインビュー (flex-1)                      │
│                     │                                          │
│ ヘッダー             │ ラウンド未選択 → プレースホルダ              │
│ 「訪問診療ラウンド一覧」│ 選択時 → 施設情報 + 名簿 + セグメント一覧    │
│                     │   各セグメント: 患者紐付け + SOAPコピー欄   │
│ ラウンドカード一覧    │                                          │
│ (ROUNDS.map)        │                                          │
│                     │                                          │
│ フッター説明文       │                                          │
└─────────────────────┴──────────────────────────────────────────┘
                              Toast (fixed bottom)
```

- レスポンシブ: サイドバー `w-full md:w-96`、メイン `max-w-6xl mx-auto`
- 背景: `bg-slate-50`（全体）、カード `bg-white rounded-xl border border-gray-200 shadow-sm`

### 新規画面（クイックSOAP）追加パターン提案

**推奨: サイドバー上部にモード切替タブ**（指示書 Phase 1 ステップ9 と一致）

```typescript
type AppMode = 'rounds' | 'quick' | 'history';
const [mode, setMode] = useState<AppMode>('rounds');
```

| モード | サイドバー | メインビュー |
|---|---|---|
| `rounds` | 現状のラウンドカード一覧 | 現状のセグメント詳細 |
| `quick` | 簡易ナビ or 空 | `QuickSoapPanel` |
| `history` | フィルタ UI | `QuickSoapHistoryList` + 詳細 |

**併存方針**:
- `selectedRoundId` / `assignments` は `mode === 'rounds'` 時のみ参照。既存ラウンド機能の state は触らない
- `Toast` は App レベルで共有（現状どおり App.tsx 内）
- タブ UI 例: サイドバーヘッダー直下に `[ラウンド一覧] [クイックSOAP] [履歴]` ボタン群（teal アクセントで選択状態表示）

**代替案（非推奨）**:
- モーダル起動: 既存フローを遮らないが、履歴閲覧・編集には不向き
- 別ルート（React Router）: スコープ外・過剰

---

## 3. Gemini API 呼び出し（最重要）

### 結論: **新規実装が必要（ケース A）**

| 調査項目 | 結果 |
|---|---|
| コード内で Gemini API を呼んでいるか | **いいえ** — `App.tsx` も他ファイルも API 呼び出しなし |
| `@google/generative-ai` パッケージ | **未インストール**（`package.json` に記載なし） |
| 環境変数設定 | `vite.config.ts` で `process.env.GEMINI_API_KEY` / `process.env.API_KEY` を `define` 済み |
| `.env.local` | リポジトリに存在しない（`.gitignore` で `*.local` 除外）。README に設定手順のみ |
| structured output | **未使用** — 参考実装なし |
| モックデータ | `segment.clinicalData` は `data/mockData.ts` から静的取得 |

### 既存の環境変数パターン

```typescript
// vite.config.ts
define: {
  'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
}
```

- Vite の `loadEnv(mode, '.', '')` で `.env.local` 等を読み込み
- ビルド時に `define` でインライン化 → クライアント側から `process.env.GEMINI_API_KEY` で参照可能
- **注意**: API キーがフロントエンドバンドルに含まれる（プロトタイプとして許容、本番では要バックエンド化）

### Phase 1 ステップ1 で必要な作業

1. `npm install @google/generative-ai`
2. `.env.local` に `GEMINI_API_KEY=...` を設定（開発者ローカル）
3. `lib/geminiClient.ts` 等で初期化パターン確立
4. structured output（JSON schema）で `{ subjective, objective, assessment, plan }` を取得
5. 30秒タイムアウトを `generateSoap.ts` 側で実装

---

## 4. UI / UX パターン

### カラーパレット

| 用途 | Tailwind クラス例 |
|---|---|
| ページ背景 | `bg-slate-50 text-slate-800` |
| カード | `bg-white rounded-xl border border-gray-200 shadow-sm` |
| プライマリボタン | `bg-teal-500 text-white border-teal-600` |
| 選択中（サイドバー） | `border-teal-400 bg-teal-50` |
| 成功・確定 | `bg-emerald-50 text-emerald-600 border-emerald-100` |
| 警告・要確認 | `bg-orange-50 text-orange-600 border-orange-100` |
| 施設バッジ | `bg-indigo-50 text-indigo-600 border-indigo-100` |
| 個人宅バッジ | `bg-emerald-50 text-emerald-600 border-emerald-100` |
| 録音プレビュー | `bg-slate-900 text-slate-100` |
| ヘッダーグラデ | `bg-gradient-to-br from-teal-50 to-white` |

### ボタンスタイル

- **プライマリ**: `px-3 py-2 text-sm font-bold rounded border shadow-sm bg-teal-500 text-white border-teal-600`
- **セカンダリ**: `px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded border border-gray-200`
- **disabled 条件**: 例）患者未選択時に確定ボタン disabled

### カード・モーダル・トースト

- **カード**: `rounded-xl` / `rounded-lg` + `border border-gray-200` + `p-5` or `p-4`
- **モーダル**: 現状なし
- **Toast**: App.tsx 内、`fixed bottom-4 left-1/2 -translate-x-1/2`、`success` = teal、`info` = gray

### 流用可能コンポーネント

| コンポーネント | 流用方法 |
|---|---|
| `SectionHeader` | クイックSOAP画面の各セクション見出しにそのまま使用 |
| `PatientRosterBadge`（App.tsx 内） | 履歴一覧カードの参考。必要なら `components/` へ抽出 |
| `VisitPill`（App.tsx 内） | 施設種別表示に流用 |
| `SoapView` の `EditableSoapBlock` | QuickSoapEditor の UI 参考（S/O/A/P 色分け: sky/rose/amber/emerald） |
| `Toast`（App.tsx 内） | 保存・エラー通知。Phase 1 で `type: 'error'` 追加を検討 |

### フォーム要素

- **select**: `border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400`
- **textarea（読取）**: `w-full h-44 text-sm bg-gray-50 p-2 rounded border border-gray-200`
- **textarea（編集）**: `focus:ring-2 focus:ring-teal-400 focus:outline-none resize-y`（SoapView 参照）
- **input（検索）**: `focus:ring-1 focus:ring-teal-500`（PatientSidebar 参照）

---

## 5. 状態管理

### 既存パターン

- すべて **React ローカル state**（Context / Redux なし）
- **`useMemo`**: 派生値（`selectedRound`, `currentFacility`, `selectedStats`）
- **複雑なオブジェクト state**: `assignments` を `Record<string, {...}>` で管理
  - キー形式: `` `${roundId}-${segmentId}` ``
  - 更新: スプレッドでイミュータブル更新 `setAssignments(prev => ({ ...prev, [key]: {...} }))`
- **初期化**: `useState(() => { ... })` 関数形式で ROUNDS から assignments 初期化

### 新機能での推奨

- QuickSoap 入力 state は `QuickSoapPanel` 内で完結
- 履歴は `quickSoapStorage.ts`（localStorage）+ `useState` で一覧再読込
- App レベルは `mode` state のみ追加（最小変更）

---

## 6. 永続化

### localStorage

- **現状: 使用箇所なし**
- 新機能で初めて導入。キー: `yorisoi:shisetsu:quick-soaps`（指示書指定）

### 既存データ管理

| データ | 管理方法 |
|---|---|
| `FACILITIES` / `ROUNDS` | `data/rounds.ts` 静的 export |
| `MOCK_PATIENTS` / `ClinicalData` | `data/mockData.ts` 静的 |
| `assignments` | メモリのみ（リロードで初期状態に戻る） |

---

## 7. ユーティリティ関数

### 現状（すべて `App.tsx` 内、非 export）

| 関数 | 役割 |
|---|---|
| `toDateLabel(iso)` | ISO 日付 → `M月D日 (曜)` 表示 |
| `buildSoapText(patientName, date, data: ClinicalData)` | SOAP + 薬学的フォーカス + Red Flags + 主な問題点のコピー用テキスト |
| `buildHomeVisitText(patientLabel, facility, round, data, room?)` | 訪問診療フォーマット（基本情報 + 主訴 + 観察 + 薬剤 + 申し送り） |

### 新機能での扱い

**流用すべき** — ただし現状 App.tsx 内に閉じているため、Phase 1 で以下いずれかが必要:

1. **推奨**: `lib/formatters.ts` 等へ抽出して App.tsx と QuickSoapPanel の両方から import
2. **最小 diff**: QuickSoapPanel から App 経由で props 渡し（非推奨・結合度高）

### 重要な型ギャップ

- `generateSoap` は `ClinicalData['soap']`（4フィールド）のみ返す設計
- **`buildSoapText` は `ClinicalData` 全体を要求**（`pharmacy_focus`, `alerts`, `meta` 必須）
- **`buildHomeVisitText` は `data.soap` + `data.meta.note_for_pharmacy` を使用**

**Phase 1 での対応案**:
- MVP: SOAP 4セクション生成のみ → コピー用に空の stub `ClinicalData` を組み立てるヘルパー（例: `soapToClinicalData(soap): ClinicalData`）
- Could（F-10）: AI で `medications` / `red_flags` も抽出し stub を置き換え

---

## 8. 新機能の配置案

### 新規ファイル（Phase 1 想定）

```
lib/
├── geminiClient.ts      # Gemini 初期化（ステップ1）
├── soapPrompt.ts        # プロンプト + few-shot + JSON schema（ステップ2）
├── generateSoap.ts      # 生成ロジック + タイムアウト（ステップ3）
├── quickSoapStorage.ts  # localStorage CRUD（ステップ5）
└── formatters.ts        # buildSoapText 等の抽出（推奨・ステップ7前後）

components/
├── QuickSoapEditor.tsx      # S/O/A/P 編集（ステップ6）
├── QuickSoapPanel.tsx       # メイン入力画面（ステップ7）
└── QuickSoapHistoryList.tsx # 履歴一覧（ステップ8）
```

### 既存ファイル変更箇所（最小限）

| ファイル | 変更内容 |
|---|---|
| `App.tsx` | `mode` state、タブ UI、QuickSoap コンポーネントの条件 render |
| `types.ts` | `QuickSoapRecord` 型追加 |
| `package.json` | `@google/generative-ai` 追加 |
| `.env.local` | 開発者ローカルで API キー設定（git 管理外） |

**変更しない**: `data/rounds.ts`, `data/mockData.ts`, 既存ラウンド UI ロジック

### ナビゲーション統合

サイドバーヘッダー（`p-4 border-b` ブロック）内、タイトル下にタブを追加:

```
訪問診療ラウンド一覧  →  「よりそい Pro」等にリネーム検討（任意）
[ラウンド一覧] [クイックSOAP] [履歴]
```

- 選択中タブ: `bg-teal-500 text-white` または `border-b-2 border-teal-500`
- 非選択: `text-gray-600 hover:bg-gray-100`

### 流用すべき既存資産まとめ

- **データ**: `FACILITIES`, 各 `roster`
- **型**: `ClinicalData`, `Soap`, `Facility`, `RosterPatient`
- **UI**: `SectionHeader`, Tailwind パターン, Toast
- **参考**: `SoapView` の EditableSoapBlock レイアウト

### 未使用レガシーについて

- `SoapView.tsx`, `PatientSidebar.tsx` は import されていない
- 新機能では **参照のみ**（パターン借用）。統合や削除は Phase 1 スコープ外

---

## 付録: 実装時の注意点

1. **API キー**: フロントエンド露出はプロトタイプ限定。デモ前にキー漏洩リスクを周知
2. **型名 `Record`**: `types.ts` の `Record` と TS 組み込み `Record<K,V>` が混在しうる。`QuickSoapRecord` 追加時は import 注意
3. **Tailwind CDN**: JIT は CDN 経由のため、使用クラスは JSX 内に文字列として存在する必要あり
4. **`buildSoapText` 抽出**: 指示書 F-08 達成のため、生成 SOAP のみでは不十分 — stub 組み立て or 生成範囲拡大を Phase 1 内で判断
5. **Gemini structured output**: 公式 SDK の `responseSchema` / JSON mode を `soapPrompt.ts` で定義

---

## Phase 0 完了チェック

- [x] プロジェクト全体構造の把握
- [x] ルーティング・画面遷移の把握と追加パターン提案
- [x] Gemini API: **新規実装が必要**と結論
- [x] UI/UX パターンの整理
- [x] 状態管理パターンの整理
- [x] 永続化: localStorage 未使用 → 新規導入
- [x] ユーティリティ関数の役割と流用方針
- [x] 新機能配置案・変更ファイル一覧

**次ステップ**: ユーザー（渓）レビュー後 → Phase 1 ステップ1（Gemini API 接続セットアップ）
