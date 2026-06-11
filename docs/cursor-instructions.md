# Cursor 実装指示書: クイックSOAP整形機能の追加

**対象リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`（`y-mori29/yorisoi-shisetsu` のフォーク）
**前提**: `docs/requirements-soap.md` を読み込んでから着手すること
**進め方**: Phase 0 完了済み → Phase 1 を段階的に実装

---

## ⚠️ リポジトリ運用に関する重要事項（必読）

### この作業は「フォーク先」で行います

- **作業対象**: `Keeeeei-Soeda/yorisoi-shisetsu`（origin）
- **本家**: `y-mori29/yorisoi-shisetsu`（upstream、pull 専用）
- **本家への直接 push は絶対に行わない**

理由：本家リポジトリは別のエンジニア（y-mori29 さん）が作成したもので、副田（渓）は現状編集権限を持たない。本機能の開発はフォーク先で完結させる。

### Git 運用ルール

- 作業ブランチ：`feature/quick-soap`（または機能ごとに切り出し）
- `main` への直接 push 禁止 → PR 経由でマージ
- `git push upstream ...` は絶対に実行しない
- リモート確認コマンド：`git remote -v` で `origin = Keeeeei-Soeda/...` を確認してから push する習慣

### コミットメッセージ

- 日本語可
- 論理的単位で分割
- 例：`feat: lib/geminiClient.ts を追加`、`feat: クイックSOAP入力画面のUI実装`

---

## 全体方針

- このリポジトリは Vite + React 19 + TypeScript + Tailwind CSS の訪問薬剤師向けプロトタイプ
- すでに SOAP 表示・コピー機能（`buildSoapText`/`buildHomeVisitText`）と `ClinicalData` 型は実装済み
- 本機能は **「最初の実働 AI 機能」** として追加する
- **既存のコード規約・スタイル・データ構造に合わせる**こと（独自パターン導入禁止）
- **段階的に実装**し、フェーズごとに必ずレビュー依頼
- TypeScript 型を厳格に。`any` 使用禁止

---

## Phase 0 のレビュー結果（確定事項）

### ナビゲーションタブラベル

- 「録音から作成」「メモから作成」「履歴」 を採用
- 既存ラウンド機能は「録音から作成」タブに対応
- 新規クイックSOAP機能は「メモから作成」タブに対応
- `App.tsx` の mode state は `'recording' | 'memo' | 'history'` とする

### コピー機能

- 既存の `buildSoapText` / `buildHomeVisitText` には**一切手を加えない**
- 新規 `lib/formatters.ts` に `buildQuickSoapText` を実装する
- `buildQuickSoapText` は SOAP 4セクションのみを整形する（`pharmacy_focus` / `alerts` / `meta` は含めない）
- 将来 F-10（薬剤・Red Flags抽出）対応時に `buildQuickSoapTextFull` を別途追加する想定

### 既存ファイルの扱い

- `buildSoapText` / `buildHomeVisitText` の `lib/` への抽出は今回行わない（refactor 範囲外）
- 未使用ファイル（`components/SoapView.tsx`, `components/PatientSidebar.tsx`）は無視（削除しない）

### プロンプト設計の方針

- セクション単位でON/OFF切り替え可能な構造にしておく
- v1（今回）: S/O/A/P のみ生成
- v1.1（将来）: `pharmacy_focus.medications` を追加
- v1.2（将来）: `alerts.red_flags` を追加
- 将来の拡張時にプロンプト全体を書き直さずに済むよう、構造化して書く

---

## Phase 1: クイックSOAP機能の実装

### 実装順序（必ずこの順番で、各ステップ後にユーザー確認）

---

#### ステップ 1: Gemini API 接続セットアップ

調査結果からケース A（Gemini API 未接続）が確定しているため、以下を実装。

**タスク**:

1. **パッケージインストール**
   - `@google/generative-ai` を npm install
   - `package.json` の dependencies に追加

2. **API クライアントの初期化**
   - `lib/` フォルダを新設
   - `lib/geminiClient.ts` を作成
   - `vite.config.ts` で define 済みの `process.env.GEMINI_API_KEY` を読み込む
   - `GoogleGenerativeAI` のインスタンスを作成・export
   - API キー未設定時のエラーを明確に出す

3. **接続確認スクリプト**
   - `lib/geminiClient.ts` に簡単な動作確認用関数を含める（または別ファイル）
   - 例: "Hello, can you respond in Japanese?" を投げてレスポンスを取得する関数
   - 実装後、ユーザーが手動で動作確認できる状態にする

**制約**:
- 既存ファイルの変更は最小限に（`package.json` は当然変更してよい）
- `vite.config.ts` の既存の define 設定は変更しない
- `App.tsx` / `types.ts` は今回変更しない

**完了条件**: Gemini API が呼び出せる状態が確立 + ユーザーレビュー

---

#### ステップ 2: プロンプト定義

**新規ファイル**: `lib/soapPrompt.ts`

- SOAP 生成用のシステムプロンプトを定義
- few-shot 例を 3 つ含める（要件定義書セクション10参照）：
  - 例1: 施設入居者の継続フォロー（80代女性、特養）
  - 例2: 在宅患者の初回訪問（75歳男性、心不全退院後）
  - 例3: 認知症患者の服薬コンプライアンス（85歳女性、GH）
- structured output 用の JSON schema 定義
- S/O/A/P 各セクションの判断基準を明記（訪問薬剤師目線）
- **セクション単位で ON/OFF できる構造**にしておく（将来 F-10 拡張のため）
- ユーザー（渓）がプロンプト中身をレビューしやすいよう、コメント付きで構造化

**完了条件**: ファイル作成 + ユーザーにプロンプト内容のレビュー依頼

---

#### ステップ 3: 生成ロジック実装

**新規ファイル**: `lib/generateSoap.ts`

```typescript
import { ClinicalData } from '../types';

export interface GenerateSoapInput {
  bulletInput: string;
  patientContext?: {
    name?: string;
    facility?: string;
    age?: number;
    conditions?: string[];
  };
}

export type GeneratedSoap = ClinicalData['soap'];

export async function generateSoap(
  input: GenerateSoapInput
): Promise<GeneratedSoap>
```

- ステップ1で確立した `geminiClient` を使用
- structured output を使用
- エラー時は適切な Error を throw（呼び出し側でハンドリング）
- タイムアウト 30 秒を設ける
- レスポンスは既存 `ClinicalData['soap']` 型と完全一致させる

**完了条件**: ファイル作成 + 簡単な手動テスト（コンソールで生成結果確認）

---

#### ステップ 4: フォーマッタとストレージ

**新規ファイル**: `lib/formatters.ts`

```typescript
import { ClinicalData } from '../types';

export const buildQuickSoapText = (
  patientName: string,
  date: string,
  soap: ClinicalData['soap']
): string => {
  return `【SOAP】
患者: ${patientName} / 日付: ${date}
S: ${soap.subjective}
O: ${soap.objective}
A: ${soap.assessment}
P: ${soap.plan}`;
};
```

**新規ファイル**: `lib/quickSoapStorage.ts`

以下の関数を提供：
- `saveQuickSoap(record: QuickSoapRecord): void`
- `getQuickSoap(id: string): QuickSoapRecord | null`
- `listQuickSoaps(filter?: { facilityId?: string; rosterPatientId?: string; dateFrom?: string; dateTo?: string }): QuickSoapRecord[]`
- `deleteQuickSoap(id: string): void`
- `updateQuickSoap(id: string, partial: Partial<QuickSoapRecord>): QuickSoapRecord | null`

localStorage キー: `yorisoi:shisetsu:quick-soaps`

**完了条件**: 全関数実装 + 簡単な手動テスト

---

#### ステップ 5: 型定義の追加

**変更ファイル**: `types.ts` に以下を追加

```typescript
export interface QuickSoapRecord {
  id: string;
  facilityId: string | null;  // 既存FACILITIES の id
  rosterPatientId: string | null;  // 既存rosterPatient の id（新規患者の場合はnull）
  patientNameOverride?: string;  // 新規・未登録患者の場合の名前
  date: string;  // ISO 8601
  bulletInput: string;
  soap: ClinicalData['soap'];  // 既存型を流用
  createdAt: string;
  updatedAt: string;
}
```

既存型の変更は行わない（追加のみ）。

**完了条件**: 既存の型定義スタイルに合わせて追加完了

---

#### ステップ 6: SOAP 編集コンポーネント

**新規ファイル**: `components/QuickSoapEditor.tsx`

- 4 セクション（S/O/A/P）それぞれ独立した textarea
- 各セクションに見出しと説明
- 文字数表示
- 「リセット」ボタン（元の AI 出力に戻す）
- props で初期値と onChange を受ける制御コンポーネント
- 既存 Tailwind パターン（slate系背景 + teal系アクセント）に合わせる

**完了条件**: 単体で動作確認可能な状態

---

#### ステップ 7: メモから作成パネル（メインビュー）

**新規ファイル**: `components/QuickSoapPanel.tsx`

UI 構成（既存 `App.tsx` のスタイルに合わせた構造）：

```
┌─────────────────────────────────────────┐
│ ヘッダー：「メモから SOAP 作成」         │
├─────────────────────────────────────────┤
│ 1. 訪問先選択（既存FACILITIES）         │
│ 2. 患者選択（roster or 新規入力）       │
│ 3. 日付指定（デフォルト今日）           │
│ 4. 箇条書き入力 textarea                │
│    （プレースホルダで訪問特化の例示）   │
│ 5. [SOAP生成] ボタン                    │
├─────────────────────────────────────────┤
│ ローディング中：スピナー + 「生成中…」  │
├─────────────────────────────────────────┤
│ 生成後：QuickSoapEditor                 │
│   + [保存][再生成][クリア] ボタン       │
│   + buildQuickSoapText でのテキスト表示 │
│     + コピーボタン                      │
└─────────────────────────────────────────┘
```

エラーハンドリング:
- API エラー時は既存 Toast コンポーネント流用
- ネットワークエラーと API エラーを区別

**完了条件**: 一連のフローが動く + ユーザーレビュー依頼

---

#### ステップ 8: 履歴一覧コンポーネント

**新規ファイル**: `components/QuickSoapHistoryList.tsx`

- 保存済み QuickSoap の一覧表示
- 施設・患者・日付でフィルタ
- クリックで詳細表示（`QuickSoapEditor` で再編集可能）
- 削除機能
- 既存の `PatientRosterBadge` パターンを参考にしたカード表示

**完了条件**: 一覧→詳細→編集→保存の一連動作確認

---

#### ステップ 9: ナビゲーション統合

**変更ファイル**: `App.tsx`

既存の左サイドバー（訪問診療ラウンド一覧）の上部に、モード切り替えタブを追加：

```
[録音から作成] [メモから作成] [履歴]
```

実装方針：
- 既存ラウンド機能は触らない（state レベルで分離）
- `App.tsx` に `mode: 'recording' | 'memo' | 'history'` の state を追加
- モードに応じてサイドバーとメインビューの表示を切り替え
- 既存の Toast コンポーネントは全モードで共有

**完了条件**: 既存機能が壊れていないことを確認 + 新機能への遷移確認

---

### 全体の受け入れ基準（Phase 1 完了条件）

- [ ] 訪問先・患者・日付を選択し、箇条書き入力 → 30秒以内に SOAP 4セクション表示
- [ ] 4セクションそれぞれ独立して編集可能
- [ ] 編集内容が localStorage に保存される
- [ ] ページリロード後も履歴が残っている
- [ ] 施設・患者・日付フィルタで履歴検索できる
- [ ] 既存ラウンド画面のスタイル・トーンと完全に一致している
- [ ] エラー時に Toast で適切なメッセージ表示
- [ ] TypeScript エラー 0、`any` 使用 0
- [ ] 既存機能（訪問ラウンド一覧、患者割り当て）が壊れていない
- [ ] `buildQuickSoapText` を活用したコピー機能が動く
- [ ] **すべてのコミットが `feature/quick-soap` ブランチ（または派生）に乗っており、`origin (= Keeeeei-Soeda/yorisoi-shisetsu)` に push されている**

---

## ⚠️ してはいけないこと

- 大規模リファクタリング（既存コードの書き直し）
- 新しい依存ライブラリの追加（`@google/generative-ai` を除く / 事前相談）
- バックエンド追加・DB 追加（スコープ外）
- 認証実装（スコープ外）
- Tailwind の代わりに別の CSS フレームワーク導入
- 既存の `ClinicalData` 型を変更すること（必要なら相談）
- 既存ラウンド機能の挙動変更
- Claude API への差し替え（スコープ外）
- 既存 `buildSoapText` / `buildHomeVisitText` の修正・抽出
- 未使用ファイル（`components/SoapView.tsx`, `PatientSidebar.tsx`）の削除
- **`upstream`（本家 `y-mori29/yorisoi-shisetsu`）への push**
- **`main` ブランチへの直接 push**

---

## レビューサイクル

各ステップ完了時、以下のフォーマットでユーザーに報告：

```
## ステップ X 完了報告

### 実装内容
- xxx

### 変更ファイル
- 新規: xxx
- 変更: xxx

### コミット
- xxx（コミットハッシュとメッセージ）

### 動作確認方法
- xxx（ユーザーが手元で確認する手順）

### 確認してほしいこと
- xxx

### 質問・判断が必要な点
- xxx（あれば）
```

ユーザー（渓）の承認後、次のステップに進む。

---

## 補足: 既存資産との接続性

本機能は **将来的に既存のラウンド機能と統合できる設計** にしておく：

- `QuickSoapRecord.soap` は `ClinicalData['soap']` 型を流用
- → 将来「クイック入力したSOAPをラウンドSegmentに昇格」機能を追加する場合、型変換不要
- `facilityId`・`rosterPatientId` も既存型を参照
- → 既存の施設名簿・患者データと自然に連携可能

これにより、プロトタイプ → 本格展開時の改修コストを最小化する。
