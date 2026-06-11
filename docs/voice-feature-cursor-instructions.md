# Cursor 実装指示書: 音声録音 → 自動 SOAP 生成機能（Phase 1 デモ特化 MVP）

**対象リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`
**ブランチ**: `feature/voice-recording`（新規切り出し）
**前提**: `docs/voice-feature-requirements.md` を読み込んでから着手すること
**参考リポ**: `y-mori29/yorisoi-demo`（Google Cloud STT + WebSocket の参考実装）

---

## ⚠️ 事前準備（渓さんが実施済みであること）

以下は渓さん側で完了している前提で着手してください：

- [x] GCP プロジェクトで Speech-to-Text API 有効化
- [x] サービスアカウント作成、credentials JSON ダウンロード
- [x] credentials JSON のローカルパスが分かっている
- [x] feature/voice-recording ブランチ切り出し済み

未完了の場合は、副田に確認してから進めること。

---

## 全体方針

- このリポジトリは Vite + React 19 + TypeScript + Tailwind CSS のプロトタイプ
- 本機能は **「録音から作成」モードのモック実装を本実装に置き換える** タスク
- バックエンドを **新設** する（既存 yorisoi-shisetsu はフロントオンリーだった）
- 既存「メモから作成」「履歴」モードには **影響を与えない**
- **段階的に実装**し、各 Phase 完了時にレビュー依頼
- TypeScript 型を厳格に。`any` 使用禁止
- コミットは論理的単位で分割、メッセージは日本語可

---

## Phase 0: 参考リポ調査と移植計画の作成

### タスク

`y-mori29/yorisoi-demo` の以下を調査し、`docs/voice-feature-survey.md` にまとめてください。

#### 調査項目

1. **バックエンド構造**
   - `backend/` のディレクトリ構成
   - Express サーバーのエントリポイント
   - WebSocket の確立方法
   - クライアント接続管理

2. **Google Cloud STT 統合**
   - `@google-cloud/speech` パッケージの使い方
   - Streaming API の呼び出し方法
   - 認証方式（GOOGLE_APPLICATION_CREDENTIALS の使い方）
   - エラーハンドリング
   - 言語設定（`languageCode: 'ja-JP'` を使うこと）

3. **フロントエンド構造**
   - 音声録音 UI の実装パターン
   - WebSocket クライアントの実装
   - リアルタイム文字起こし表示の UI

4. **音声フォーマット**
   - 録音時の MIME タイプ
   - WebM / Opus / MP4 / WAV のいずれを使っているか
   - サーバー側での変換処理の有無

5. **デプロイ設定**
   - Dockerfile の内容
   - 環境変数の管理方法
   - Cloud Run デプロイコマンド

### アウトプット

`docs/voice-feature-survey.md` に以下を記載：

```markdown
# 参考リポ調査結果

## バックエンド構造
（yorisoi-demo の backend/ 構成）

## STT 統合の実装パターン
（コード抜粋付き）

## フロント実装パターン
（コード抜粋付き）

## 本機能（yorisoi-shisetsu）への移植方針
- そのまま流用できる部分
- 改修が必要な部分
- 新規実装が必要な部分

## リスクと前提
（実装時に注意すべき点）
```

### 制約

- 既存ファイルの変更は禁止
- 新規ファイルは `docs/voice-feature-survey.md` のみ
- 完了後、副田にレビュー依頼

---

## Phase 1: バックエンド構築

### ステップ 1: backend/ ディレクトリ初期化

**新規作成するファイル**：

```
backend/
├── package.json
├── server.js
├── stt.js
├── .env.example
├── .gitignore
└── README.md
```

#### `backend/package.json`

```json
{
  "name": "yorisoi-shisetsu-backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "@google-cloud/speech": "^6.x",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "ws": "^8.18.0"
  }
}
```

#### `backend/.env.example`

```
GOOGLE_APPLICATION_CREDENTIALS=./credentials.json
PORT=8080
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

#### `backend/.gitignore`

```
node_modules/
.env
credentials.json
*.json.key
```

#### `backend/README.md`

ローカル起動手順とデプロイ手順を記載。

### ステップ 2: Express + WebSocket サーバー実装

`backend/server.js` を実装：

- Express で `/health` エンドポイント（GET）を提供（疎通確認用）
- `ws` パッケージで WebSocket サーバーを Express の HTTP サーバーに統合
- WebSocket エンドポイント: `ws://localhost:8080/ws/transcribe`
- CORS 設定で ALLOWED_ORIGINS のオリジンを許可
- クライアント接続時に STT ストリーミングセッションを開始
- クライアントから受信した音声バイナリチャンクを STT に転送
- STT から得た文字起こしを WebSocket でクライアントに返送
- クライアント切断時に STT セッションをクリーンアップ

### ステップ 3: Google Cloud STT 統合

`backend/stt.js` を実装：

- `@google-cloud/speech` の `SpeechClient` をシングルトンで初期化
- `streamingRecognize` を使ったストリーミング音声認識セッションを返す関数を提供
- 設定:
  - `languageCode: 'ja-JP'`
  - `encoding: 'WEBM_OPUS'`（Chrome/Edge）または `'MP4'`（iOS Safari）
  - `sampleRateHertz: 48000`（WebM/Opus 標準）
  - `interimResults: true`（リアルタイム逐次結果）
  - `enableAutomaticPunctuation: true`
- 認識結果を `{ transcript, isFinal }` 形式でコールバック
- エラーハンドリング（接続切断、タイムアウト等）

### ステップ 4: ローカル動作確認

`scripts/test-backend.mjs` を新規作成し、以下を確認：

- `/health` が 200 を返すか
- WebSocket 接続が確立できるか
- ダミー音声データを送って STT に転送できるか（実音声テストは後）

`package.json`（プロジェクトルート）に以下を追加：

```json
{
  "scripts": {
    "dev:backend": "cd backend && npm run dev",
    "test:backend": "node scripts/test-backend.mjs"
  }
}
```

### 完了報告（Phase 1 完了時）

- backend 起動コマンド
- /health の動作確認結果
- WebSocket 接続テスト結果
- 副田に渡す事前準備チェックリスト（credentials.json の配置等）

---

## Phase 2: フロントエンド実装

### ステップ 5: 録音ユーティリティ

`lib/voiceRecorder.ts` を新規作成：

- `MediaRecorder API` のラッパー
- ブラウザ別の MIME タイプ自動選択（WebM/Opus or MP4）
- 録音開始・停止・一時停止
- 録音中の音量レベルを取得（波形表示用、`AnalyserNode` 使用）
- エラーハンドリング（マイク権限拒否等）

シグネチャ例：

```typescript
export interface VoiceRecorderOptions {
  onChunk: (chunk: Blob) => void;
  onLevelUpdate?: (level: number) => void; // 0-1
  onError: (error: Error) => void;
}

export class VoiceRecorder {
  async start(options: VoiceRecorderOptions): Promise<void>;
  async stop(): Promise<Blob>; // 全体音声を返す
  pause(): void;
  resume(): void;
  getMimeType(): string;
  getDuration(): number; // ms
}
```

### ステップ 6: WebSocket クライアント

`lib/wsClient.ts` を新規作成：

- WebSocket 接続管理
- 音声チャンクを WebSocket で送信
- サーバーからの文字起こし結果を受信
- 自動再接続（指数バックオフ）
- エラーハンドリング

シグネチャ例：

```typescript
export interface TranscribeWsClientOptions {
  url: string;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export class TranscribeWsClient {
  async connect(options: TranscribeWsClientOptions): Promise<void>;
  send(chunk: Blob): void;
  disconnect(): void;
}
```

### ステップ 7: 文字起こし → 箇条書き整形

`lib/transcriptToBullets.ts` を新規作成：

文字起こしテキストを既存 `generateSoap` が処理しやすい箇条書き形式に変換する関数。

- 入力: 改行・句読点を含む生テキスト
- 出力: 箇条書き形式（`- ` 始まり）
- 既存 `generateSoap` の `bulletInput` パラメータに渡せる形式

簡単な実装：句読点で区切って各文を `- ` プレフィックス付きで返す程度で十分。
LLM を使った高度な整形は Phase 2 で検討。

### ステップ 8: 録音 UI コンポーネント

`components/VoiceRecorder.tsx` を新規作成：

- 「録音開始」「録音停止」ボタン
- 録音中の経過時間表示（mm:ss）
- 音量レベルの可視化（簡易バーまたは波形）
- マイク権限エラー時の表示
- props で onComplete (audio: Blob, transcript: string) コールバック

`components/TranscriptDisplay.tsx` を新規作成：

- リアルタイム文字起こし結果の表示
- 確定済みテキスト（`isFinal: true`）と暫定テキスト（`isFinal: false`）を視覚的に区別
- 自動スクロール

### ステップ 9: 「録音から作成」モードの本実装パネル

`components/RecordingPanel.tsx` を新規作成：

UI 構成：

```
┌─────────────────────────────────────────┐
│ ヘッダー：「録音から SOAP 作成」          │
├─────────────────────────────────────────┤
│ 1. 訪問先選択（既存 FACILITIES）          │
│ 2. 患者選択（既存 roster）                │
│ 3. 録音セクション                         │
│    ├─ VoiceRecorder（録音 UI）            │
│    └─ TranscriptDisplay（リアルタイム表示）│
├─────────────────────────────────────────┤
│ ローディング: 「SOAP を生成中...」        │
├─────────────────────────────────────────┤
│ 生成後: QuickSoapEditor                   │
│   + [保存][再生成][クリア] ボタン         │
│   + buildQuickSoapText でのコピー表示    │
└─────────────────────────────────────────┘
```

フロー：

1. 訪問先・患者を選択
2. 録音開始 → リアルタイム文字起こし表示
3. 録音停止 → 文字起こし完成
4. 自動で `transcriptToBullets` で箇条書き化
5. `generateSoap` 呼び出し（既存ロジック流用）
6. SOAP 表示・編集
7. `QuickSoapRecord` として `saveQuickSoap` で保存
8. 履歴に追加（既存 storage に保存）

### ステップ 10: App.tsx の統合

既存 `App.tsx` の変更：

- `mode === 'recording'` の時の表示を、既存モック UI から `RecordingPanel` に置き換え
- ただし、**既存のラウンド一覧 UI は別タブとして残す**（モックデータも保持）
- もしくはサイドバー上部に「録音 / モック表示」のサブタブを追加するか相談

**最小変更原則**: `App.tsx` の変更は10〜30行程度に収める。
大きな変更が必要な場合は、`RecordingPanel` 側で吸収する設計にする。

### 環境変数

フロント側で WebSocket URL を環境変数化：

`.env.local` に追加：

```
VITE_WS_URL=ws://localhost:8080/ws/transcribe
```

`vite.config.ts` で define する。

---

## Phase 3: 動作確認・デプロイ

### ステップ 11: ローカル E2E 動作確認

ローカル環境（macOS Safari, Chrome）で以下を確認：

1. `npm run dev:backend` でバックエンド起動
2. `npm run dev` でフロント起動
3. ブラウザでアクセス
4. 録音開始 → リアルタイム文字起こし表示
5. 録音停止 → SOAP 生成
6. 保存 → 履歴に追加
7. 既存「メモから作成」「履歴」が動作することを確認

### ステップ 12: デプロイ準備

**バックエンド**:
- `backend/Dockerfile` を作成（Cloud Run 用）
- `backend/README.md` にデプロイコマンド記載：

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/yorisoi-shisetsu-backend backend/
gcloud run deploy yorisoi-shisetsu-backend \
  --image gcr.io/PROJECT_ID/yorisoi-shisetsu-backend \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=production,ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

**フロント**:
- Vercel デプロイ手順を `docs/deploy.md` に記載
- 環境変数 `VITE_WS_URL` を本番 Cloud Run URL に書き換え

実際のデプロイは副田が手動で実施するため、Cursor はドキュメント作成までで OK。

---

## 完了報告フォーマット（各 Phase）

```
## Phase N 完了報告

### 実装内容
- xxx

### 変更ファイル
- 新規: xxx
- 変更: xxx

### コミット
- ハッシュとメッセージ

### 動作確認結果
- xxx（手動 or 自動テスト結果）

### 確認してほしいこと
- xxx

### 質問・判断が必要な点
- xxx
```

各 Phase 完了時に副田にレビュー依頼。承認後に次 Phase へ進む。

---

## ⚠️ してはいけないこと

- 既存「メモから作成」「履歴」モードの挙動変更
- 既存ファイル（`lib/generateSoap.ts`, `lib/soapPrompt.v3.ts`, `lib/formatters.ts`, `lib/quickSoapStorage.ts`）の機能変更
  - インポート追加・型追加は可だが、既存関数の挙動は変えない
- 既存 `types.ts` の型変更（QuickSoapRecord 等はそのまま）
- App.tsx の大規模リファクタリング（最小変更原則）
- 認証実装（Phase 1 スコープ外）
- DB 永続化（Phase 1 スコープ外）
- credentials.json を Git にコミット
- mainブランチへの直接 push（必ず feature/voice-recording ブランチで作業）
- upstream（y-mori29/yorisoi-shisetsu）への push

---

## 既存資産の活用ルール

| 既存ファイル | 活用方法 |
|---|---|
| `lib/generateSoap.ts` | 文字起こし → SOAP 生成にそのまま使う |
| `lib/formatters.ts` | コピーテキスト生成にそのまま使う |
| `lib/quickSoapStorage.ts` | 履歴保存にそのまま使う |
| `components/QuickSoapEditor.tsx` | SOAP 編集 UI として再利用 |
| `types.ts` の `QuickSoapRecord` | 履歴データ型として流用 |
| 既存 Tailwind パターン（teal/slate） | 新規 UI も同じ配色 |
| 既存 Toast コンポーネント | エラー通知・保存通知に使用 |

---

## 補足: 音声フォーマットの取り扱い

ブラウザ別の挙動：

| ブラウザ | デフォルト MIME |
|---|---|
| Chrome / Edge | `audio/webm; codecs=opus` |
| Firefox | `audio/webm; codecs=opus` |
| iOS Safari 16+ | `audio/mp4` |
| Android Chrome | `audio/webm; codecs=opus` |

Phase 1 では Chrome / iOS Safari 対応を最優先。
`MediaRecorder.isTypeSupported()` で動的に選択。

サーバー側（STT）の対応：
- WebM/Opus → そのまま受け付け可能
- MP4 → ffmpeg で WAV/PCM に変換が必要

ffmpeg 統合は Phase 1 では「Chrome/Edge 限定で OK」とし、
iOS Safari 対応は Phase 1.5 として別途扱う。
**Phase 1 ではまず Chrome で動かす**。

---

## 想定スケジュール

| Phase | 内容 | 工数目安 |
|---|---|---|
| Phase 0 | 参考リポ調査 | 1日 |
| Phase 1 | バックエンド構築（ステップ1-4） | 3-4日 |
| Phase 2 | フロント実装（ステップ5-10） | 4-5日 |
| Phase 3 | 動作確認・デプロイ準備（ステップ11-12） | 2-3日 |
| **合計** | | **10-13日（約2週間）** |

各 Phase 完了時に副田レビューを挟むため、暦日換算で **2〜3週間** を見込む。
