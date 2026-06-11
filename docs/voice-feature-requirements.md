# 要件定義書: 音声録音 → 自動 SOAP 生成機能（Phase 1 デモ特化 MVP）

**対象リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`
**ブランチ**: `feature/voice-recording`（新規ブランチ）
**バージョン**: v1.0
**ステータス**: ドラフト

---

## 1. 目的

訪問薬剤師が**スマホで起動 → ボタン押下 → 患者と会話 → 自動的に SOAP 形式の薬歴が記録される**という体験を、Phase 1 として **デモ可能な MVP** として実装する。

これは Elan 提案・β顧客への提示・公式デモ動画素材として活用される。

## 2. 体験設計（理想のユーザーフロー）

```
1. 訪問薬剤師がスマホで yorisoi-shisetsu を開く
   ↓
2. 「録音から作成」モードを選択
   ↓
3. 訪問先（FACILITIES）と対象患者を事前選択
   ↓
4. 「録音開始」ボタンを押す（マイク許可）
   ↓
5. 患者と通常通り会話（30秒〜3分程度）
   ├─ 画面にリアルタイム文字起こしが表示される
   ↓
6. 「録音停止」ボタンを押す
   ↓
7. AI が自動で：
   ├─ 文字起こし完成
   ├─ SOAP 形式に整理（既存 generateSoap 流用）
   └─ 該当患者カルテに保存
   ↓
8. SOAP が画面に表示される（編集可能）
   ↓
9. 「保存」ボタンで履歴に追加
```

## 3. 位置づけ：Phase 1 と Phase 2 の境界

| 項目 | Phase 1（本書） | Phase 2（将来） |
|---|---|---|
| 患者数 | 1セッション = 1患者 | 複数患者の自動分割 |
| 患者選択 | 録音前に手動選択 | 会話中に「タナカさん」等で自動振り分け |
| 録音時間 | 30秒〜3分（短セッション） | 30分〜1時間（訪問丸ごと） |
| 文字起こし | リアルタイム表示 | 同じ |
| SOAP生成 | 録音停止後にバッチ | リアルタイム逐次 |
| ターゲット | デモ・β顧客説明 | 実運用 |
| 工数 | 1〜2週間 | 追加2〜3週間 |

**Phase 2 の患者名自動抽出は本書のスコープ外**。Phase 1 完成後に β 顧客フィードバックを取って判断する。

## 4. ターゲットユーザー

- メインユーザー: 訪問薬剤師（在宅・施設対応）
- デモシーン: Elan 提案、β顧客面談、公式デモ動画

## 5. 機能要件

| ID | 機能 | 優先度 | 受け入れ基準 |
|---|---|---|---|
| V-01 | 訪問先・患者の事前選択 | Must | 既存 FACILITIES の roster から選択可 |
| V-02 | マイク許可・録音開始 | Must | iOS Safari, Chrome, Edge で動作 |
| V-03 | リアルタイム文字起こし表示 | Must | 1-3秒遅延で逐次表示 |
| V-04 | 録音停止ボタン | Must | 押下後に処理に移行 |
| V-05 | 音声→SOAP自動生成 | Must | 30秒以内に SOAP 4セクション出力 |
| V-06 | 既存 SOAP 編集機能との統合 | Must | QuickSoapEditor をそのまま使う |
| V-07 | 履歴保存 | Must | QuickSoapRecord として localStorage に保存 |
| V-08 | 録音中の波形表示 | Should | 音量レベル可視化（任意） |
| V-09 | 録音時間表示 | Should | 経過時間カウンター |
| V-10 | 録音停止後のキャンセル | Should | 「保存せず破棄」も選択可 |

## 6. 非機能要件

| 項目 | 要件 |
|---|---|
| パフォーマンス | 文字起こし遅延 3秒以内、SOAP 生成 30秒以内 |
| ブラウザ対応 | iOS Safari 16+, Android Chrome, デスクトップ Chrome / Edge |
| 通信 | HTTPS 必須（マイク権限の制約） |
| 永続化 | localStorage（Phase 1 は既存パターン踏襲） |
| デプロイ | フロント: Vercel、バックエンド: Google Cloud Run |
| コスト | 月数千円〜（デモ運用なら問題ない範囲） |

## 7. 技術スタック

### フロントエンド（既存 yorisoi-shisetsu に追加）

| 用途 | 採用技術 |
|---|---|
| 録音 API | `MediaRecorder API`（標準） |
| WebSocket クライアント | 標準 `WebSocket` API |
| 音声フォーマット | `audio/webm; codecs=opus`（Chrome/Edge）<br>`audio/mp4`（iOS Safari）|
| UI | 既存 Tailwind パターン |

### バックエンド（新設）

| 用途 | 採用技術 |
|---|---|
| サーバー | Express + WebSocket（`ws` パッケージ） |
| STT | Google Cloud Speech-to-Text（Streaming API） |
| ランタイム | Node.js 20+ |
| デプロイ | Google Cloud Run + Dockerfile |
| 認証 | サービスアカウント JSON（GCP） |

### 参考リポ

`y-mori29/yorisoi-demo` の `backend/` ディレクトリを参考にする。
ただし、既存 yorisoi-shisetsu の構造と整合性を取るため、コピペではなく**再実装**。

## 8. スコープ外（明示）

以下は Phase 1 では実装しない：

- **患者名の自動抽出と振り分け**（Phase 2）
- **複数患者の自動分割**（Phase 2）
- **30分以上の長時間録音**（Phase 2）
- バックエンド側 DB 永続化（Phase 1 は localStorage のみ）
- ユーザー認証・薬局単位のテナント分離
- HIPAA / 医療情報安全管理ガイドライン完全準拠（本番化時）
- 音声ファイルのサーバー保存（リアルタイム処理のみ）
- 多言語対応
- 既存「メモから作成」機能の変更

## 9. 既存資産との関係

| 既存資産 | 本機能での扱い |
|---|---|
| `FACILITIES` / `ROUNDS` (data/rounds.ts) | 患者選択 UI で参照 |
| `ClinicalData` 型 (types.ts) | SOAP 生成結果の格納先 |
| `QuickSoapRecord` 型 | 履歴保存に流用 |
| `lib/generateSoap.ts` | 文字起こし → SOAP 生成に流用 |
| `lib/soapPrompt.v3.ts` | プロンプトそのまま流用 |
| `lib/formatters.ts` | コピー出力に流用 |
| `lib/quickSoapStorage.ts` | 履歴保存に流用 |
| `components/QuickSoapEditor.tsx` | 編集 UI に流用 |
| `components/QuickSoapHistoryList.tsx` | 履歴一覧に流用 |
| 既存「録音から作成」モード（モック） | **本実装に置き換え** |

## 10. ファイル構成（新規 + 変更）

```
yorisoi-shisetsu/
├── backend/                          ← 新設
│   ├── server.js                     ← Express + WebSocket メイン
│   ├── stt.js                        ← Google Cloud STT 統合
│   ├── package.json                  ← バックエンド専用 deps
│   ├── Dockerfile                    ← Cloud Run 用
│   ├── .env.example                  ← GCP 環境変数テンプレ
│   └── .gitignore                    ← credentials JSON 除外
├── lib/                              ← 既存 + 新規追加
│   ├── voiceRecorder.ts              ← 新規: MediaRecorder ラッパー
│   ├── wsClient.ts                   ← 新規: WebSocket クライアント
│   └── transcriptToBullets.ts        ← 新規: 文字起こし → 箇条書き整形
├── components/                       ← 既存 + 新規追加
│   ├── RecordingPanel.tsx            ← 新規: 「録音から作成」モード本体
│   ├── VoiceRecorder.tsx             ← 新規: 録音 UI コンポーネント
│   └── TranscriptDisplay.tsx         ← 新規: リアルタイム表示
├── App.tsx                           ← 変更: 既存「録音から作成」をモック→本実装に切替
└── docs/
    └── voice-feature-cursor-instructions.md   ← Cursor 指示書（別ファイル）
```

## 11. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| iOS Safari の音声フォーマット制約 | WebM/Opus 未対応 | サーバー側で ffmpeg 変換、または audio/mp4 出力 |
| マイク権限が取れない | HTTPS 必須 | Vercel HTTPS デプロイ、ローカルは localhost で OK |
| WebSocket 切断 | ネットワーク不安定 | 自動再接続ロジック実装 |
| STT 認識精度 | 環境音・方言 | デモは静かな環境で実施、Phase 2 で精度向上 |
| GCP 設定の複雑さ | サービスアカウント等 | 渓さん側で事前準備、Cursor は実装に集中 |
| 既存機能への影響 | 「録音から作成」モックの置き換え | feature/voice-recording ブランチで分離 |
| コスト爆発 | STT は従量課金 | デモのみ運用、月額アラート設定 |

## 12. 渓さんが事前に準備すること

Cursor 実装着手前に、**渓さんが GCP 側でセットアップする必要があります**：

### 12.1 Google Cloud プロジェクト準備

- [ ] [Google Cloud Console](https://console.cloud.google.com/) で既存プロジェクト確認、または新規作成
- [ ] Speech-to-Text API を有効化
- [ ] 課金有効化（Gemini API キーで使ったプロジェクトを流用すると楽）

### 12.2 サービスアカウント作成

- [ ] IAM & 管理 → サービスアカウント → 新規作成
- [ ] 役割: 「Cloud Speech クライアント」を付与
- [ ] キーをJSONでダウンロード（`~/yorisoi-shisetsu-gcp-credentials.json` 等で保管）
- [ ] **このJSONファイルは絶対にGitにコミットしない**

### 12.3 ローカル環境変数設定

`backend/.env`（後で Cursor が作成）に以下を設定：

```
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/credentials.json
PORT=8080
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
```

### 12.4 Cloud Run デプロイ準備（デモ時のみ必要）

- [ ] `gcloud` CLI インストール
- [ ] `gcloud auth login` 実行
- [ ] デプロイ手順は Cursor が `backend/README.md` に記載

## 13. 成功指標

Phase 1 完了の基準：

- [ ] スマホ（iOS Safari）でマイクが起動する
- [ ] 録音開始後、リアルタイム（3秒遅延以内）で文字起こしが表示される
- [ ] 録音停止後、30秒以内に SOAP 4セクションが生成される
- [ ] 既存の「メモから作成」「履歴」モードに影響がない
- [ ] localhost で完全に動作する
- [ ] Cloud Run + Vercel でデプロイ可能、公開 URL でデモ実施可能
- [ ] Elan提案・β顧客面談で「これいいね」のリアクションを取れる

## 14. デモシナリオ（参考）

```
1. iPhone で公開 URL を開く
2. 「録音から作成」タブ
3. さくら苑 / 田中健さん を選択
4. 「録音開始」ボタン
5. 話す: 「田中さん、最近どうですか？」
   患者役: 「血圧が高めで、頭痛があるんです。最近薬を飲み忘れることもあって...」
   話す: 「お薬カレンダー導入を提案します」
6. 「録音停止」ボタン
7. 10秒待つ
8. 画面に SOAP 形式の薬歴が表示される
   - S: [本人] 頭痛あり、服薬忘れの自覚
   - O: 田中健、特養入居...
   - A: 血圧コントロール要評価、服薬アドヒアランス低下
   - P: Ep: お薬カレンダー導入提案...
9. 「保存」→ 履歴に追加
10. 「履歴」タブで確認
```

このシナリオを **3分以内** で実演できる状態が Phase 1 ゴール。
