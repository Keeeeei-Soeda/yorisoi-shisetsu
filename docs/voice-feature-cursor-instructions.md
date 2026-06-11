# Cursor 実装指示書: 音声録音 → 自動 SOAP 生成機能（Gemini Audio版）

**対象リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`
**ブランチ**: `feature/voice-recording`
**前提**: `docs/voice-feature-requirements.md` を読み込んでから着手すること
**Phase 0 調査結果**: `docs/voice-feature-survey.md` を参考にする（ただし v1 案ベース、v2 では構成変更）

---

## ⚠️ Phase 0 からの変更点（重要）

Phase 0 調査では Google Cloud STT + Express + WebSocket バックエンドを想定していたが、
**v2 では Gemini Audio API を直接使う構成に変更** された。

**変更理由**:
- yorisoi-demo に Streaming STT が実装されておらず、ゼロからの新規実装が必要だった
- リアルタイム文字起こしは Phase 1 必須ではないと判明
- バックエンド不要にすることで工数を 1-2週間 → 4-5日 に短縮
- 既存の Gemini API キーをそのまま流用できる

**Phase 0 で出した backend/ 構築計画は破棄**し、本書の方針に従うこと。

---

## 全体方針

- Gemini 2.5 Flash の音声入力機能（inlineData）を使い、**音声 → SOAP を 1 ステップで生成**
- バックエンド・WebSocket・STTサービス独立、**すべて不要**
- 既存「メモから作成」「履歴」モードには **影響を与えない**
- TypeScript 型を厳格に。`any` 使用禁止
- コミットは論理的単位で分割、メッセージは日本語可
- 各ステップ完了時に副田にレビュー依頼

---

## ステップ 1: 音声録音ユーティリティ

### 新規ファイル: `lib/voiceRecorder.ts`

`MediaRecorder API` のラッパークラスを実装する。

#### 機能要件

- ブラウザ別の MIME タイプ自動選択（pickMime パターン、yorisoi-demo の LIFF index.html を参考）
- 録音開始・停止・一時停止
- 録音中の経過時間取得
- 録音中の音量レベル取得（`AnalyserNode` 使用、任意機能）
- エラーハンドリング（マイク権限拒否、デバイス未接続等）

#### シグネチャ

```typescript
export interface VoiceRecorderOptions {
  /** チャンク受信時のコールバック（任意、デフォルトは録音完了時に全体を渡す） */
  onChunk?: (chunk: Blob) => void;
  /** 音量レベル更新コールバック（0-1） */
  onLevelUpdate?: (level: number) => void;
  /** エラー発生時のコールバック */
  onError: (error: VoiceRecorderError) => void;
}

export class VoiceRecorderError extends Error {
  constructor(
    message: string,
    public code: 'PERMISSION_DENIED' | 'NO_DEVICE' | 'NOT_SUPPORTED' | 'UNKNOWN',
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'VoiceRecorderError';
  }
}

export class VoiceRecorder {
  /** 録音開始 */
  async start(options: VoiceRecorderOptions): Promise<void>;
  
  /** 録音停止、全体音声を Blob で返す */
  async stop(): Promise<Blob>;
  
  /** 一時停止 */
  pause(): void;
  
  /** 再開 */
  resume(): void;
  
  /** 現在の MIME タイプ取得 */
  getMimeType(): string;
  
  /** 経過時間（ミリ秒） */
  getDuration(): number;
  
  /** 録音状態 */
  getState(): 'inactive' | 'recording' | 'paused';
}
```

#### 内部実装の要点

- MIME タイプ候補（優先順）:
  1. `'audio/webm;codecs=opus'` (Chrome/Edge)
  2. `'audio/mp4'` (iOS Safari)
  3. `'audio/webm'` (Firefox)
- `MediaRecorder.isTypeSupported()` で動的選択
- `getUserMedia({ audio: true })` でストリーム取得
- マイク権限拒否時は `VoiceRecorderError('PERMISSION_DENIED')` を throw

### 動作確認

ブラウザコンソールで動作確認するためのテストファイルは作成不要。
ステップ3の VoiceRecorder.tsx を経由して動作確認する。

### 完了条件

- ファイル作成
- TypeScript 型チェック通過（`npx tsc --noEmit`）
- 副田レビュー後、ステップ2に進む

---

## ステップ 2: 音声 → SOAP 生成ロジック

### 新規ファイル: `lib/audioToSoap.ts`

Gemini Audio に音声 + プロンプトを送信し、SOAP を生成する関数。

#### 設計方針

既存 `lib/generateSoap.ts`（テキスト入力版）と並列に新規実装。
既存ファイルは変更しない。プロンプトは既存の `lib/soapPrompt.v3.ts` を流用する。

ただし、**音声入力用のプロンプト調整**が必要：
- 「箇条書きメモから」→「会話音声から」に文脈変更
- 音声では薬剤名・用量が口頭で言われる前提（手動入力ほど明確ではない）
- 発言主体タグ [本人][スタッフ] 等は引き続き必須

#### シグネチャ

```typescript
import { ClinicalData } from '../types';

export interface AudioToSoapInput {
  audioBlob: Blob;
  patientContext?: {
    name?: string;
    facility?: string;
    age?: number;
    conditions?: string[];
  };
}

export type GeneratedSoap = ClinicalData['soap'];

export class AudioToSoapError extends Error {
  constructor(
    message: string,
    public code: 'API_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'EMPTY_AUDIO' | 'TOO_LARGE' | 'INVALID_OUTPUT',
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'AudioToSoapError';
  }
}

export async function audioToSoap(
  input: AudioToSoapInput
): Promise<GeneratedSoap>;
```

#### 実装要件

1. **入力バリデーション**
   - audioBlob のサイズが 0 → `EMPTY_AUDIO`
   - audioBlob のサイズが 20MB 超 → `TOO_LARGE`

2. **音声を base64 化**
   - `FileReader.readAsDataURL()` でBlob → data URL → base64 部分のみ抽出

3. **Gemini API 呼び出し**
   - 既存 `getGeminiModel()` を使用
   - `contents` の parts に inlineData（音声）+ text（プロンプト）を含める
   - `responseMimeType: 'application/json'`
   - `responseSchema: buildSoapJsonSchema(DEFAULT_SOAP_PROMPT_CONFIG)` を流用
   - `temperature: 0.3`
   - タイムアウト 60秒（音声処理は時間がかかる）

4. **プロンプト構築**
   - 既存 `buildSoapPrompt(DEFAULT_SOAP_PROMPT_CONFIG)` の systemPrompt を流用
   - そこに「音声会話の文字起こしから SOAP を生成する」旨を追加
   - patientContext があれば「対象患者: 〇〇、訪問先: 〇〇」をユーザーメッセージに

5. **エラーハンドリング**
   - try-catch で全体を包む
   - Gemini API のエラーは AudioToSoapError でラップ

#### 動作確認スクリプト

`scripts/test-audio-to-soap.mjs` を新規作成（Node.js で実行可能な形）。
ただし、Node 環境でブラウザ録音はできないため、**事前に録音済みの音声ファイル**を使う設計：

```javascript
// scripts/test-audio-to-soap.mjs
import fs from 'fs';
// audioToSoap を Node 環境でも動かせるように、Blob のような薄いインターフェースを満たす

// テストケース:
// 1. fixtures/sample-recording.webm を読む（事前に副田が録音して配置）
// 2. audioToSoap に渡す
// 3. SOAP が返ることを確認
```

サンプル音声は副田が手動で用意。`fixtures/` フォルダに配置する旨を README に記載。

`package.json` に追加：
```json
{
  "scripts": {
    "test:audio-to-soap": "node scripts/test-audio-to-soap.mjs"
  }
}
```

### 完了条件

- `lib/audioToSoap.ts` 作成
- `scripts/test-audio-to-soap.mjs` 作成
- TypeScript 型チェック通過
- 副田レビュー後、ステップ3に進む

---

## ステップ 3: 録音 UI コンポーネント

### 新規ファイル: `components/VoiceRecorder.tsx`

録音操作の UI コンポーネント。

#### Props

```typescript
export interface VoiceRecorderProps {
  /** 録音完了時のコールバック（音声 Blob と録音時間を渡す） */
  onComplete: (audio: Blob, durationMs: number) => void;
  
  /** エラー時のコールバック */
  onError: (error: Error) => void;
  
  /** 録音をキャンセル */
  onCancel?: () => void;
  
  /** 操作無効化 */
  disabled?: boolean;
}
```

#### UI 構成

3つの状態:

**状態1: 待機中（録音前）**
```
┌─────────────────────────────┐
│        🎤 録音開始           │
│        (大きなボタン)         │
└─────────────────────────────┘
```

**状態2: 録音中**
```
┌─────────────────────────────┐
│   ●  録音中  00:42          │
│   ━━━━━━━━━━━━━━━ (音量バー)│
│   [一時停止] [停止]         │
└─────────────────────────────┘
```

**状態3: 録音停止後の確認**
```
┌─────────────────────────────┐
│   録音完了 (3分12秒)         │
│   [SOAP生成] [破棄してやり直し]│
└─────────────────────────────┘
```

#### スタイル

既存 Tailwind パターンに準拠:
- 録音ボタン（待機中）: `bg-red-500 text-white` で赤系、目立たせる
- 録音中表示: `bg-red-50 border-red-200`
- 停止ボタン: `bg-gray-700 text-white`
- 音量バー: `bg-teal-500` で teal 系（既存配色）

#### 内部実装

`lib/voiceRecorder.ts` の `VoiceRecorder` クラスをラップ。
React の useState / useRef / useEffect で状態管理。

### 完了条件

- `components/VoiceRecorder.tsx` 作成
- 単体動作確認はステップ4と統合して実施
- TypeScript 型チェック通過

---

## ステップ 4: 録音から作成パネル（メインビュー）

### 新規ファイル: `components/RecordingPanel.tsx`

「録音から作成」モードのメインコンポーネント。

#### UI 構成

```
┌─────────────────────────────────────────┐
│ ヘッダー：「録音から SOAP 作成」          │
├─────────────────────────────────────────┤
│ 1. 訪問先選択（既存FACILITIES）          │
│ 2. 患者選択（既存roster or 新規入力）    │
│ 3. 日付指定（デフォルト今日）            │
├─────────────────────────────────────────┤
│ VoiceRecorder コンポーネント            │
├─────────────────────────────────────────┤
│ ローディング: 「SOAP を生成中... 約30秒」│
├─────────────────────────────────────────┤
│ 生成後: QuickSoapEditor                  │
│   + [保存][クリア] ボタン                │
│   + buildQuickSoapText でのコピー表示    │
└─────────────────────────────────────────┘
```

#### フロー

1. 訪問先・患者・日付を選択
2. VoiceRecorder で録音開始 → 経過時間表示
3. 録音停止 → 「SOAP生成」ボタンで実行
4. ローディング表示
5. `audioToSoap` 呼び出し
6. SOAP を `QuickSoapEditor` で表示・編集
7. `QuickSoapRecord` として `saveQuickSoap` で保存
8. 履歴に追加（既存 storage）

#### 既存パターンとの一貫性

既存 `components/QuickSoapPanel.tsx` の構造を**ほぼそのまま流用**。
違いは VoiceRecorder + audioToSoap だけ。

### 完了条件

- `components/RecordingPanel.tsx` 作成
- 一連フローが localhost で動作
- TypeScript 型チェック通過
- 副田レビュー後、ステップ5に進む

---

## ステップ 5: App.tsx の統合

### 変更ファイル: `App.tsx`

既存「録音から作成」モード（`mode === 'recording'`）の表示を、モック UI から `RecordingPanel` に置き換える。

#### 変更方針

**最小変更原則**: `App.tsx` の変更は **30 行程度** に収める。
既存の record モックUI（ラウンド一覧・名簿・セグメント）は、サブモードとして残すか、丸ごと差し替えるか相談。

#### 推奨アプローチ

```typescript
// App.tsx の該当箇所
{mode === 'recording' && (
  <RecordingPanel 
    onSaved={(record) => {
      showToast('success', 'SOAPを保存しました');
      // 必要なら履歴タブに自動遷移
    }}
  />
)}
```

これにより、既存のモックUI は不要になる。ただし、**急に消すと参照が壊れる可能性**があるので、慎重に。

#### モックUI の扱い

選択肢:
- A. モックUIは完全削除（クリーンだが、過去資産を捨てる）
- B. モックUIは別パスで残す（mode を `'recording-mock'` 等に変更、サイドバーに切替UI追加）
- C. モックUIは残すが、訪問薬剤師向けデモでは表示しない（display: none）

**推奨は A**: 録音機能が完成したら、モックUIの存在価値は薄い。
ただし、既存の `data/rounds.ts`, `data/mockData.ts` は他で参照されている可能性があるので、削除は控える。

### 完了条件

- `App.tsx` 変更
- localhost で「録音から作成」モードが新実装に切り替わる
- 既存「メモから作成」「履歴」モードが影響を受けない
- TypeScript 型チェック通過
- 副田レビュー

---

## ステップ 6: デプロイ準備

### Vercel デプロイ

バックエンド不要なので、フロントをそのまま Vercel にデプロイ。

#### 設定

- Vercel プロジェクト作成（or 既存があれば連携）
- 環境変数 `GEMINI_API_KEY` を Vercel に設定
- リポジトリ連携 → 自動デプロイ

#### `vercel.json`（必要なら）

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

#### `docs/deploy.md` を新規作成

Vercel デプロイ手順を文書化（副田が手動で実施するため）。

### 完了条件

- `docs/deploy.md` 作成
- Vercel 設定の指示書記載
- 実デプロイは副田が実施

---

## 想定スケジュール

| ステップ | 内容 | 工数目安 |
|---|---|---|
| ステップ1 | voiceRecorder.ts | 半日 |
| ステップ2 | audioToSoap.ts | 1日 |
| ステップ3 | VoiceRecorder.tsx | 半日 |
| ステップ4 | RecordingPanel.tsx | 1日 |
| ステップ5 | App.tsx 統合 | 半日 |
| ステップ6 | デプロイ準備 | 半日 |
| **合計** | | **4-5日** |

---

## ⚠️ してはいけないこと

- 既存「メモから作成」「履歴」モードの挙動変更
- 既存 lib/ ファイル（`generateSoap.ts`, `soapPrompt.v3.ts`, `formatters.ts`, `quickSoapStorage.ts`）の機能変更
- 既存 `components/` ファイル（`QuickSoapEditor.tsx`, `QuickSoapPanel.tsx`, `QuickSoapHistoryList.tsx`）の機能変更
- 既存 `types.ts` の型変更
- 大規模リファクタリング
- バックエンド構築（Phase 0 で出した backend/ 計画は破棄）
- WebSocket 実装
- Google Cloud STT との接続
- credentials.json 等の機密ファイルを Git にコミット
- main ブランチへの直接 push
- upstream（y-mori29/yorisoi-shisetsu）への push

---

## 既存資産の活用ルール

| 既存ファイル | 活用方法 |
|---|---|
| `lib/geminiClient.ts` | そのまま流用（getGeminiModel） |
| `lib/soapPrompt.v3.ts` | プロンプト構造をそのまま流用、音声用にメッセージ調整 |
| `lib/generateSoap.ts` | 触らない（テキスト版として残す） |
| `lib/formatters.ts` | buildQuickSoapText をそのまま使用 |
| `lib/quickSoapStorage.ts` | 履歴保存にそのまま使用 |
| `components/QuickSoapEditor.tsx` | SOAP編集UIとして再利用 |
| `types.ts` の `QuickSoapRecord` | 履歴データ型として流用 |
| 既存 Tailwind パターン（teal/slate/red） | 新規UIも同じ配色 |
| 既存 Toast コンポーネント | 通知に使用 |

---

## 完了報告フォーマット（各ステップ）

```
## ステップ N 完了報告

### 実装内容
- xxx

### 変更ファイル
- 新規: xxx
- 変更: xxx

### コミット
- ハッシュとメッセージ

### 動作確認結果
- xxx

### 確認してほしいこと
- xxx

### 質問・判断が必要な点
- xxx
```

各ステップ完了時に副田にレビュー依頼。承認後に次ステップへ進む。

---

## 補足: Phase 0 調査結果の活用範囲

`docs/voice-feature-survey.md` の調査結果は以下の範囲で参考にする：

- ✅ MIME タイプ選択パターン（pickMime）→ ステップ1で活用
- ✅ MediaRecorder の使い方 → ステップ1で活用
- ❌ Express + WebSocket バックエンド → v2 では不要
- ❌ Google Cloud STT 統合 → v2 では不要
- ❌ Cloud Run デプロイ → v2 では Vercel に変更

つまり、フロント側のパターンのみ参考にする。バックエンド側は完全に破棄。
