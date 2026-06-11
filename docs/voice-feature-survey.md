# 参考リポ調査結果: y-mori29/yorisoi-demo

**調査日**: 2026-06-11  
**調査対象**: https://github.com/y-mori29/yorisoi-demo（`main` ブランチ、浅い clone）  
**目的**: 音声録音 → STT → SOAP 生成機能（Phase 1）のバックエンド・フロント実装の参考調査  
**調査実施**: `feature/voice-recording` ブランチ / Phase 0（実装なし）

---

## 調査サマリー（重要）

yorisoi-demo は **Express + WebSocket + Google Cloud Speech-to-Text** の構成を持つが、**本機能 Phase 1 で求める「音声チャンク → WebSocket → STT Streaming API → リアルタイム文字起こし」のパターンは実装されていない**。

| 観点 | yorisoi-demo の実態 | yorisoi-shisetsu Phase 1 の要件 |
|---|---|---|
| STT API | バッチ `recognize`（録音ファイル全体） | **`streamingRecognize`（逐次）** |
| WebSocket 用途 | 文字起こし結果の **配信**（視聴クライアント向け） | 音声バイナリの **受信 + 認識結果返送** |
| 録音 → サーバー | multer アップロード / GCS チャンク PUT（LIFF 版） | WebSocket バイナリ送信（新規） |
| 永続化 | PostgreSQL / in-memory Map | localStorage のみ（Phase 1） |
| SOAP 生成 | なし（Gemini で要約生成のみ） | 既存 `generateSoap` 流用 |

**結論**: 参考リポから流用できるのは **サーバー骨格・認証・MediaRecorder MIME 選択・デプロイパターン** に限られ、**STT ストリーミング本体は新規実装**が必要（`voice-feature-cursor-instructions.md` Phase 1 の設計に従う）。

---

## 1. バックエンド構造

### 1.1 ディレクトリ構成

```
yorisoi-demo/
├── backend/
│   ├── server.ts              # Express + HTTP サーバー + WS 起動
│   ├── ws/
│   │   └── transcription.ts   # WebSocketServer（結果ブロードキャスト）
│   ├── services/
│   │   ├── transcription.ts   # Google Cloud STT（バッチ recognize）
│   │   └── summary.ts         # Gemini 要約（本機能では不使用）
│   ├── routes/
│   │   ├── uploadAudio.ts     # multer で音声一時保存
│   │   ├── transcriptions.ts  # 文字起こし CRUD（REST）
│   │   ├── consent.ts
│   │   └── share.ts
│   ├── db/
│   │   ├── transcriptions.ts  # in-memory ストア
│   │   └── schema.sql
│   ├── utils/
│   │   └── cleanupUploads.ts
│   ├── scripts/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/                  # Next.js（別 UI スタック）
├── index.html                 # LIFF 向けスタンドアロン録音 UI（本番 Cloud Run 向け）
├── package.json
├── .env.example
└── README.md
```

### 1.2 サーバーエントリポイント

`backend/server.ts` が Express アプリを構築し、`http.createServer(app)` で HTTP サーバーを生成、WebSocket を同一ポートにぶら下げる。

```typescript
// backend/server.ts（抜粋）
const app = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.use('/api', uploadAudioRouter);
app.use('/api/transcriptions', transcriptionsRouter);
// ...

const server = http.createServer(app);
startTranscriptionWS(server);

const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
```

**移植方針**:

- `http.Server` + `ws` の統合パターンは **そのまま流用可能**
- ヘルスチェックは demo は `/healthz`、本機能指示書は `/health` → 名称は指示書に合わせる
- Cloud Run 向け `0.0.0.0` + `process.env.PORT` は **必須パターンとして踏襲**

### 1.3 WebSocket 接続管理

`backend/ws/transcription.ts` は **文字起こし ID ごとの視聴クライアント** を管理する。

```typescript
// backend/ws/transcription.ts（抜粋）
const clients: Client[] = [];

export function startTranscriptionWS(server: any) {
  const wss = new WebSocketServer({ server, path: '/ws/transcriptions' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const id = url.pathname.split('/').pop() || '';
    clients.push({ id, ws });
    ws.on('close', () => {
      const idx = clients.findIndex((c) => c.ws === ws);
      if (idx >= 0) clients.splice(idx, 1);
    });
  });
}

export function broadcastSegment(id: string, segment: TranscriptionSegment) {
  const message = JSON.stringify({ segments: [segment] });
  clients.filter((c) => c.id === id).forEach((c) => c.ws.send(message));
}
```

**特徴**:

- 接続 URL: `ws://host/ws/transcriptions/{transcriptionId}`
- サーバー → クライアントの **一方向配信**（JSON `{ segments: [...] }`）
- クライアントからの音声バイナリ受信は **なし**
- 切断時に clients 配列から削除（シンプルなクリーンアップ）

**本機能への移植方針**:

- 接続管理（接続時 STT セッション開始、切断時 destroy）は **構造を参考**にする
- パスは指示書どおり `/ws/transcribe` に変更
- 各接続ごとに `streamingRecognize` ストリームを 1 本持つ設計に **拡張が必要**

---

## 2. STT 統合の実装パターン

### 2.1 パッケージと認証

```typescript
// backend/services/transcription.ts（抜粋）
import { SpeechClient } from '@google-cloud/speech';

const client = new SpeechClient();
```

- 依存: `@google-cloud/speech` ^6.6.0（backend/package.json）
- 認証: **`GOOGLE_APPLICATION_CREDENTIALS` 環境変数** → Application Default Credentials
- コード内で credentials JSON を直接読み込む処理は **なし**（GCP 標準パターン）
- `.env.example` にパス指定例あり:

```
GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
```

**移植方針**: シングルトン `SpeechClient` 初期化は **そのまま流用**。JSON キーは Git に含めず、渓さんが `~/credentials/` 配下に配置したファイルを `.env` で参照。

### 2.2 実際に使われている API: バッチ `recognize`

```typescript
// backend/services/transcription.ts（抜粋）
export async function transcribeAudio(filePath: string): Promise<TranscriptionRecord> {
  const audio = {
    content: fs.readFileSync(filePath).toString('base64'),
  };

  const config = {
    languageCode: 'ja-JP',
    enableSpeakerDiarization: true,
    enableWordTimeOffsets: true,
    model: 'latest_long',
  } as any;

  const [response] = await client.recognize({ audio, config });
  // ... word 単位で speakerTag ごとに segments 組み立て
  return saveTranscription(segments);
}
```

**設定の要点**:

| 項目 | demo の値 |
|---|---|
| `languageCode` | `'ja-JP'` |
| `model` | `'latest_long'` |
| `enableSpeakerDiarization` | `true` |
| `enableWordTimeOffsets` | `true` |
| `encoding` / `sampleRateHertz` | **未指定**（ファイル形式に依存） |

**エラーハンドリング**: `transcribeAudio` 内に try/catch はなく、呼び出し元に委ね。`summary.ts` では JSON パース失敗時に空オブジェクトを返すフォールバックあり。

### 2.3 demo に存在しない: `streamingRecognize`

リポジトリ全体を検索した結果、**`streamingRecognize` / `streaming` / `WEBM_OPUS` / `ffmpeg` の参照はゼロ**。

本機能 Phase 1 で必要なパターン（指示書 Phase 1 より、**新規実装**）:

```javascript
// 参考: voice-feature-cursor-instructions.md より（demo には未実装）
const recognizeStream = client.streamingRecognize({
  config: {
    encoding: 'WEBM_OPUS',      // Chrome/Edge
    sampleRateHertz: 48000,
    languageCode: 'ja-JP',
    enableAutomaticPunctuation: true,
  },
  interimResults: true,
});

recognizeStream.on('data', (data) => {
  const result = data.results[0];
  const transcript = result.alternatives[0]?.transcript ?? '';
  const isFinal = result.isFinal;
  // WebSocket で { transcript, isFinal } を返送
});

recognizeStream.on('error', (err) => { /* クリーンアップ */ });

// クライアントから受信した Buffer を:
recognizeStream.write(audioChunk);
```

**WebSocket メッセージ形式（本機能で新規定義）**:

```json
{ "transcript": "...", "isFinal": true }
```

demo の `{ segments: [...] }` 形式とは **別プロトコル** とする。

### 2.4 LIFF 版（index.html）の本番 STT フロー

`index.html` は demo の `backend/` とは **別の Cloud Run サービス**（`https://yorisoi-849815845863.asia-northeast1.run.app`）を呼ぶ。

```
録音開始 → 10秒チャンク → sign-upload → GCS PUT → 録音停止 → finalize → jobs/{id} ポーリング
```

- リアルタイム文字起こし UI は **なし**（処理中アニメーション + ジョブ完了待ち）
- STT 実装は **このリポジトリ外**（ソース非公開）

---

## 3. フロントエンド構造

demo には **2 系統** のフロントがある。

### 3.1 Next.js フロント（`frontend/`）

| ファイル | 役割 |
|---|---|
| `hooks/useRecorder.ts` | MediaRecorder ラッパー |
| `components/RecorderControls.tsx` | 開始 / 一時停止 / 終了ボタン |
| `components/RecordingIndicator.tsx` | 録音中インジケータ |
| `TranscriptionView.tsx` | WebSocket + REST で segments 表示 |

#### useRecorder.ts（MediaRecorder パターン）

```typescript
// frontend/hooks/useRecorder.ts（抜粋）
stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const mediaRecorder = new MediaRecorder(stream);  // MIME 未指定
mediaRecorder.ondataavailable = (e) => {
  if (e.data.size > 0) chunksRef.current.push(e.data);
};
mediaRecorder.start();
// stop 時: Blob(chunks, { type: 'audio/webm' }) → FormData → POST /api/uploadAudio
```

**課題**: MIME タイプ未指定、iOS Safari 非対応、`ondataavailable` を `start()` 時に timeslice 未指定（停止時に一括取得）。

#### TranscriptionView.tsx（WebSocket クライアント）

```typescript
// frontend/TranscriptionView.tsx（抜粋）
const wsBaseUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000";
const ws = new WebSocket(`${wsBaseUrl}/ws/transcriptions/${transcriptionId}`);
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  setSegments((prev) => [...prev, ...(data.segments || [])]);
};
// 5秒間隔で REST GET /api/transcriptions/{id} もポーリング
```

**移植方針**:

- WebSocket 接続・JSON パース・`useEffect` クリーンアップ（`ws.close()`）は **参考になる**
- 本機能では **送信側**（`ws.send(blob)`）と **interim/final 表示** が追加必要
- REST ポーリングは Phase 1 では **不要**（WebSocket のみで十分）

### 3.2 LIFF 版（`index.html`）— 録音実装のベストプラクティス

こちらが **ブラウザ別 MIME 選択** の参考実装。

```javascript
// index.html（抜粋）
function isIphone() { return /iPhone/.test(navigator.userAgent); }

function pickMime() {
  const cand = ['audio/mp4', 'video/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  for (const t of cand) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function startRec() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    inflightUploads.push(uploadChunk(ev.data));
  };
  recorder.start(10000); // 10秒チャンク
}
```

**移植方針**:

- `pickMime()` の優先順位（**iOS: mp4 優先**）は **本機能 `lib/voiceRecorder.ts` に採用**
- `recorder.start(timeslice)` でチャンク分割するパターンは WebSocket 送信に **そのまま適用可能**
- iPhone 警告表示（`warn-iphone`）も UX 参考になる
- GCS アップロード部分は **本機能では WebSocket 送信に置き換え**

---

## 4. 音声フォーマット・変換

### 4.1 ブラウザ別 MIME タイプ（demo 実績）

| ソース | 優先 MIME | 備考 |
|---|---|---|
| `index.html` `pickMime()` | `audio/mp4` → `video/mp4` → `audio/webm;codecs=opus` → `audio/webm` | iOS Safari 対応意識 |
| `useRecorder.ts` | 未指定（ブラウザデフォルト） | stop 後 `audio/webm` 固定 |
| `uploadChunk()` | `blob.type \|\| 'audio/webm'` | Content-Type をサーバーに伝達 |

### 4.2 サーバー側変換

- demo `backend/` 内に **ffmpeg 等の変換処理なし**
- バッチ `recognize` は base64 音声をそのまま API に送信（encoding 未指定で自動判定に依存）

### 4.3 STT との対応（本機能 Phase 1 設計）

| ブラウザ | 録音 MIME | STT encoding（指示書） | 変換 |
|---|---|---|---|
| Chrome / Edge | `audio/webm;codecs=opus` | `WEBM_OPUS`, 48000 Hz | 不要 |
| iOS Safari | `audio/mp4` | `MP4` または PCM 変換 | **ffmpeg 等が必要な可能性** |
| Firefox | `audio/webm;codecs=opus` | `WEBM_OPUS` | 不要 |

**Phase 1 優先順位**（指示書）: まず Chrome で `streamingRecognize` + `WEBM_OPUS` を完成 → iOS Safari は Phase 1.5。

**リスク**: demo では iOS 向け STT 連携が検証されていない。MP4 ストリームを STT Streaming がそのまま受け付けるか、Phase 1 実装時に GCP ドキュメントと実機テストで確認が必要。

---

## 5. デプロイ設定

### 5.1 Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV PORT=8080
CMD ["npm", "start"]
```

| 項目 | 内容 |
|---|---|
| ベースイメージ | `node:20-slim` |
| ビルド | TypeScript → `dist/`（`npm run build`） |
| 起動 | `npm start` → `node dist/server.js` |
| ポート | `ENV PORT=8080`（Cloud Run が上書き） |

**本機能への移植方針**:

- demo は TypeScript、指示書 Phase 1 は **JavaScript（server.js / stt.js）** → Dockerfile から `npm run build` を除く簡略版に
- `node:20-slim` + `PORT` + `0.0.0.0` リッスンは踏襲

### 5.2 環境変数

**demo `.env.example`**:

| 変数 | 用途 |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | STT サービスアカウント JSON パス |
| `GOOGLE_API_KEY` | Gemini 要約（本機能ではフロントの `GEMINI_API_KEY` を継続使用） |
| `DATABASE_URL` | PostgreSQL（本機能 Phase 1 では不要） |
| `NEXT_PUBLIC_WS_URL` | フロント WebSocket URL |

**本機能 `backend/.env`（指示書）**:

```
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/credentials.json
PORT=8080
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
```

**フロント `.env.local`（Phase 2 以降）**:

```
VITE_WS_URL=ws://localhost:8080/ws/transcribe
```

### 5.3 Cloud Run デプロイコマンド（demo README）

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/yorisoi-backend backend/
gcloud run deploy yorisoi-backend \
  --image gcr.io/PROJECT_ID/yorisoi-backend \
  --region REGION \
  --set-env-vars GOOGLE_API_KEY=YOUR_KEY,DATABASE_URL=YOUR_DB_URL
```

**本機能向け改修点**:

- サービス名: `yorisoi-shisetsu-backend`
- リージョン: `asia-northeast1`（指示書）
- `--allow-unauthenticated`（デモ用）
- `--set-env-vars=NODE_ENV=production,ALLOWED_ORIGINS=https://your-vercel-app.vercel.app`
- Cloud Run サービスアカウントに **Speech Client** ロール（または Workload Identity）
- **`GOOGLE_APPLICATION_CREDENTIALS`**: Cloud Run では JSON ファイルマウントより **サービスアカウント直接割当** が推奨（Phase 1 ローカルは JSON パスで OK）

### 5.4 その他

- `.dockerignore`: `node_modules`, `dist`, `logs`, `data`, `*.log`
- ヘルスチェック: `/healthz`（Cloud Run プローブに利用可能）
- 一時ファイル: `uploads/` + 1 時間ごと `cleanupUploads()`（本機能 Phase 1 は音声ファイル保存しないため **不要**）

---

## 6. 本機能（yorisoi-shisetsu）への移植方針

### 6.1 そのまま流用できる部分

| 項目 | 参考元 |
|---|---|
| Express + `http.Server` + `ws` 統合 | `backend/server.ts` |
| Cloud Run 待受（`0.0.0.0`, `PORT`） | `backend/server.ts` |
| `SpeechClient` シングルトン + `GOOGLE_APPLICATION_CREDENTIALS` | `backend/services/transcription.ts` |
| `languageCode: 'ja-JP'` | 同上 |
| MediaRecorder + `getUserMedia` 基本フロー | `frontend/hooks/useRecorder.ts` |
| ブラウザ別 MIME 選択（`pickMime`） | `index.html` |
| チャンク録音（`recorder.start(timeslice)`） | `index.html` |
| WebSocket 接続 / 切断クリーンアップ | `backend/ws/transcription.ts`, `TranscriptionView.tsx` |
| Dockerfile / gcloud デプロイ手順の骨格 | `backend/Dockerfile`, `README.md` |
| SOAP 生成・保存・編集 | **既存 yorisoi-shisetsu**（`generateSoap`, `QuickSoapEditor`, `quickSoapStorage`） |

### 6.2 改修が必要な部分

| 項目 | demo | 本機能での改修 |
|---|---|---|
| WebSocket プロトコル | segments 配信のみ | 音声バイナリ受信 + `{ transcript, isFinal }` 返送 |
| STT API | `recognize`（バッチ） | **`streamingRecognize`** |
| STT config | `latest_long` + diarization | `WEBM_OPUS` + `interimResults` + 句読点（Phase 1 は話者分離不要） |
| フロント STT 連携 | アップロード後ポーリング | 録音中 WebSocket 逐次送信・表示 |
| 言語 / フレームワーク | Next.js + TS backend | Vite React 19 + JS backend（指示書） |
| CORS | 未設定（同一オリイン想定） | `ALLOWED_ORIGINS` 明示（Vite dev + Vercel） |
| ヘルスチェック | `/healthz` | `/health`（指示書） |

### 6.3 新規実装が必要な部分

| ファイル（指示書） | 内容 |
|---|---|
| `backend/server.js` | WS `/ws/transcribe`、音声 chunk → STT 転送 |
| `backend/stt.js` | `streamingRecognize` セッション管理 |
| `backend/Dockerfile` | JS 版（tsc なし） |
| `lib/voiceRecorder.ts` | MIME 自動選択、音量レベル、チャンク callback |
| `lib/wsClient.ts` | 送信・再接続・interim/final 受信 |
| `lib/transcriptToBullets.ts` | 文字起こし → 箇条書き |
| `components/VoiceRecorder.tsx` | 録音 UI |
| `components/TranscriptDisplay.tsx` | リアルタイム表示 |
| `components/RecordingPanel.tsx` | 録音モード本体 + generateSoap 連携 |
| `App.tsx` | モック → RecordingPanel 切替（最小変更） |
| `scripts/test-backend.mjs` | バックエンド疎通テスト |

---

## 7. リスクと前提

| リスク | 詳細 | 対策 |
|---|---|---|
| **demo に Streaming STT がない** | 最大のギャップ。コピペ不可 | Phase 1 指示書 + GCP 公式ドキュメントで新規実装 |
| iOS Safari + MP4 + Streaming | demo 未検証 | Phase 1 は Chrome 優先。Safari は Phase 1.5 |
| WebSocket + Cloud Run | アイドルタイムアウト（最大 60 分） | Phase 1 の 3 分録音以内なら問題なし |
| STT コスト | 従量課金 | デモ運用のみ、GCP 予算アラート |
| 認証情報漏洩 | JSON キー | `.gitignore` + 絶対コミットしない |
| 既存機能破壊 | メモ/履歴モード | `feature/voice-recording` ブランチ分離、録音モードのみ変更 |
| demo WS パス不一致 | `/ws/transcriptions/{id}` vs `/ws/transcribe` | 本機能は指示書パスに統一 |
| demo の DB / Gemini 要約 | 本機能不要 | 依存追加しない |
| HTTPS / マイク権限 | 本番 Vercel HTTPS 必須 | ローカルは localhost で可 |
| encoding 不一致 | クライアント MIME と STT config の不一致 | 接続時にクライアントから MIME を通知するプロトコル拡張を検討 |

---

## 8. Phase 1 実装順序（調査に基づく推奨）

1. **backend/** — Express + `/health` + WS `/ws/transcribe` + `streamingRecognize`（Chrome / WEBM_OPUS）
2. **scripts/test-backend.mjs** — 疎通・ダミー chunk テスト
3. **lib/voiceRecorder.ts** + **lib/wsClient.ts** — `index.html` の MIME 選択を TS 化
4. **components/** — VoiceRecorder, TranscriptDisplay, RecordingPanel
5. **App.tsx** — 録音モード差し替え（メモ/履歴は不触）
6. **実機 E2E** — Chrome → iOS Safari 順

---

## 9. 参考リンク

- 調査リポ: https://github.com/y-mori29/yorisoi-demo
- 本機能要件: `docs/voice-feature-requirements.md`
- 実装指示: `docs/voice-feature-cursor-instructions.md`
- GCP Speech-to-Text Streaming: https://cloud.google.com/speech-to-text/docs/streaming-recognize
