# デプロイ手順（yorisoi-shisetsu）

**対象**: フロントエンド単体（Vite + React）  
**バックエンド**: 不要（Gemini Audio 構成）  
**推奨ホスティング**: [Vercel](https://vercel.com/)  
**リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`  
**デプロイブランチ**: `feature/voice-recording`（マージ前）または `main`（マージ後）

---

## 1. 前提

| 項目 | 内容 |
|---|---|
| Node.js | 18+（Vercel は自動検出） |
| API キー | Google AI Studio の `GEMINI_API_KEY` |
| マイク録音 | **HTTPS 必須**（Vercel は自動で HTTPS） |
| ローカル開発 | `localhost` もマイク利用可 |

**注意**: `GEMINI_API_KEY` を Git にコミットしない。`.env.local` は `.gitignore` 対象。

---

## 2. ローカル開発

```bash
git clone https://github.com/Keeeeei-Soeda/yorisoi-shisetsu.git
cd yorisoi-shisetsu
git checkout feature/voice-recording   # または main

npm install
```

プロジェクトルートに `.env.local` を作成:

```
GEMINI_API_KEY=your_api_key_here
```

起動:

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開く。

### 動作確認チェックリスト

- [ ] 「メモから作成」→ SOAP 生成
- [ ] 「録音から作成」→ 録音 → SOAP 生成（Chrome 推奨）
- [ ] 「履歴」→ 保存済みレコード表示

### テストコマンド（任意）

```bash
npm run test:gemini
npm run test:generate-soap
npm run test:audio-to-soap -- ./fixtures/sample-recording.webm
```

---

## 3. Vercel デプロイ（手動・副田実施）

### 3.1 初回セットアップ

1. [Vercel Dashboard](https://vercel.com/dashboard) にログイン
2. **Add New → Project**
3. GitHub 連携で `Keeeeei-Soeda/yorisoi-shisetsu` を Import
4. **Branch**: `feature/voice-recording` を選択（PR マージ前のデモ用）
5. Framework Preset: **Vite**（`vercel.json` により自動検出）

### 3.2 ビルド設定

| 設定 | 値 |
|---|---|
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

リポジトリルートの `vercel.json` に同内容が記載済み。

### 3.3 環境変数（必須）

Vercel プロジェクト → **Settings → Environment Variables**

| Name | Value | 適用環境 |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio の API キー | Production, Preview, Development |

**重要**: ビルド時に Vite が `GEMINI_API_KEY` をバンドルへ埋め込む（`vite.config.ts` の `define`）。  
キーを変更した場合は **Redeploy（再ビルド）** が必要。

### 3.4 デプロイ実行

- 初回: Import 後 **Deploy**
- 以降: `feature/voice-recording` への push で Preview 自動デプロイ
- Production: Vercel 上で Production Branch を指定、または `main` マージ後に自動

### 3.5 デプロイ後確認

1. 公開 URL（例: `https://yorisoi-shisetsu-xxx.vercel.app`）を **スマホ Chrome** で開く
2. 「録音から作成」→ 訪問先・**患者を選択** → 録音 → SOAP 生成
3. 「メモから作成」「履歴」も動作確認

---

## 4. デモシナリオ（3分）

```
1. 公開 URL をスマホで開く
2. 「録音から作成」タブ
3. さくら苑 / 田中 健 を選択
4. 「録音開始」→ デモ台本を音読（1〜2分）
5. 「停止」→「SOAP生成」
6. SOAP 確認 →「保存」
7. 「履歴」タブで確認
```

---

## 5. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| `GEMINI_API_KEY が設定されていません` | 環境変数未設定 or 再ビルド未実施 | Vercel に `GEMINI_API_KEY` 設定 → Redeploy |
| マイクが起動しない | HTTP でアクセス | HTTPS の Vercel URL を使用 |
| SOAP 生成タイムアウト | ネットワーク / 長時間録音 | 3分以内で再試行 |
| 患者名が「患者未選択」 | UI で患者未選択 | 録音前に名簿から患者を選択 |
| iOS Safari で録音不可 | Phase 1 は Chrome 優先 | デモは Android Chrome / デスクトップ Chrome 推奨 |

---

## 6. コスト目安

| サービス | 目安 |
|---|---|
| Vercel（Hobby） | 無料枠内でデモ可能 |
| Gemini 2.5 Flash（テキスト） | メモ入力: 従量 |
| Gemini Audio | 約 0.4 円/分（3分録音 ≒ 1.2 円/回） |

GCP プロジェクトの **予算アラート** 設定を推奨。

---

## 7. ブランチ運用

| ブランチ | 用途 |
|---|---|
| `feature/voice-recording` | 音声録音機能開発・デモ |
| `feature/quick-soap` | クイックSOAP（メモ入力） |
| `main` | 本番相当（マージ後） |

**push 先**: `origin` = `Keeeeei-Soeda/yorisoi-shisetsu` のみ  
**禁止**: `y-mori29/yorisoi-shisetsu`（upstream）への push

---

## 8. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/voice-feature-requirements.md` | 音声機能要件（v2 Gemini Audio） |
| `docs/voice-feature-cursor-instructions.md` | 実装指示書 |
| `docs/features.md` | 機能一覧・詳細 |
| `docs/requirements-soap.md` | クイックSOAP要件 |

---

## 9. 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-06-12 | 初版（Phase 1 Gemini Audio 構成） |
