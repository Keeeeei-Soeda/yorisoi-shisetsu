# 要件定義書: 音声録音 → 自動 SOAP 生成機能（Gemini Audio版）

**対象リポジトリ**: `Keeeeei-Soeda/yorisoi-shisetsu`
**ブランチ**: `feature/voice-recording`
**バージョン**: v2.0（Gemini Audio構成）
**ステータス**: ドラフト

---

## 1. 目的

訪問薬剤師がスマホで起動 → ボタン押下 → 患者と会話 → 自動的に SOAP 形式の薬歴が記録される体験を、Phase 1 として **デモ可能な MVP** として実装する。

これは Elan 提案・β顧客への提示・公式デモ動画素材として活用される。

## 2. アーキテクチャ（v2: Gemini Audio版）

### v1（旧案）からの変更点

| 項目 | v1（旧案） | v2（採用） |
|---|---|---|
| 文字起こし方式 | Google Cloud STT バッチ | **Gemini Audio**（音声→SOAP直接） |
| バックエンド | Express + Cloud Run 必須 | **不要** |
| WebSocket | 結果配信に使用 | **不要** |
| 認証 | サービスアカウント JSON | **既存 GEMINI_API_KEY 流用** |
| 工数 | 1-2週間 | **4-5日** |
| メンテ対象 | フロント + バックエンド | **フロントのみ** |

### システム構成

```
[スマホ] マイクボタン押下
   ↓
[録音開始] MediaRecorder API
   ↓ (録音中表示、波形or時間カウンタ)
[録音停止]
   ↓
[音声Blob] WebM/Opus (Chrome) or MP4 (iOS)
   ↓ base64化
[既存 Gemini API] inlineData で音声 + プロンプト送信
   ↓
[SOAP JSON] structured output
   ↓
[既存 QuickSoapEditor] 表示・編集
   ↓
[既存 quickSoapStorage] 履歴保存
```

## 3. 体験設計（ユーザーフロー）

```
1. 訪問薬剤師がスマホで yorisoi-shisetsu を開く
   ↓
2. 「録音から作成」モードを選択
   ↓
3. 訪問先（FACILITIES）と対象患者を事前選択
   ↓
4. 「録音開始」ボタンを押す（マイク許可）
   ↓
5. 患者と会話（30秒〜3分程度）
   ├─ 画面に「録音中 mm:ss」と経過時間表示
   └─ 任意: 音量レベルの波形表示
   ↓
6. 「録音停止」ボタンを押す
   ↓
7. 自動処理（10-30秒）
   ├─ 音声を base64 化
   ├─ Gemini Audio に送信
   ├─ ローディング「SOAP を生成中...」
   └─ SOAP JSON を受信
   ↓
8. SOAP が画面に表示される（既存 QuickSoapEditor で編集可能）
   ↓
9. 「保存」ボタンで履歴に追加
```

## 4. Phase 1 と Phase 2 の境界

| 項目 | Phase 1（本書） | Phase 2（将来） |
|---|---|---|
| 患者数 | 1セッション = 1患者 | 複数患者の自動分割 |
| 患者選択 | 録音前に手動選択 | 会話中の患者名で自動振り分け |
| 録音時間 | 30秒〜3分 | 30分〜1時間 |
| 文字起こし表示 | なし（録音中は時間のみ） | リアルタイム逐次表示（要 Streaming STT 移行） |
| SOAP生成 | 録音停止後にバッチ | 同 |
| ターゲット | デモ・β顧客説明 | 実運用 |
| 工数 | **4-5日** | 追加 1-2週間 |

## 5. ターゲットユーザー

- メインユーザー: 訪問薬剤師（在宅・施設対応）
- デモシーン: Elan 提案、β顧客面談、公式デモ動画

## 6. 機能要件

| ID | 機能 | 優先度 | 受け入れ基準 |
|---|---|---|---|
| V-01 | 訪問先・患者の事前選択 | Must | 既存 FACILITIES の roster から選択可 |
| V-02 | マイク許可・録音開始 | Must | Chrome / iOS Safari で動作 |
| V-03 | 録音中の経過時間表示 | Must | mm:ss 形式でリアルタイム更新 |
| V-04 | 録音停止ボタン | Must | 押下後に処理に移行 |
| V-05 | 音声→SOAP自動生成 | Must | 30秒以内に SOAP 4セクション出力 |
| V-06 | 既存 SOAP 編集機能との統合 | Must | QuickSoapEditor をそのまま使う |
| V-07 | 履歴保存 | Must | QuickSoapRecord として localStorage 保存 |
| V-08 | 録音中の音量レベル可視化 | Should | 簡易バーまたは波形（任意） |
| V-09 | 録音停止後のキャンセル | Should | 「保存せず破棄」も選択可 |
| V-10 | エラー時のフォールバック | Must | API エラー時は明確なメッセージ + 録音音声は保持 |

## 7. 非機能要件

| 項目 | 要件 |
|---|---|
| パフォーマンス | SOAP 生成 30秒以内（3分録音の場合） |
| ブラウザ対応 | Chrome（最優先）、Edge、iOS Safari 16+（Phase 1.5） |
| 通信 | HTTPS 必須（マイク権限の制約、localhost は例外） |
| 永続化 | localStorage（既存パターン踏襲） |
| デプロイ | フロント単体: Vercel（バックエンド不要） |
| コスト | 月数百円〜（Gemini Audio は1分あたり約0.4円） |

## 8. 技術スタック

### フロントエンド（既存 yorisoi-shisetsu に追加）

| 用途 | 採用技術 |
|---|---|
| 録音 API | `MediaRecorder API`（標準） |
| 音声フォーマット | `audio/webm; codecs=opus`（Chrome/Edge）<br>`audio/mp4`（iOS Safari） |
| AI | **既存 Gemini 2.5 Flash + inlineData**（音声直接送信） |
| UI | 既存 Tailwind パターン |

### バックエンド

**不要**。フロント完結。

### Gemini Audio の使い方

```typescript
// 音声を Gemini に直接送信
const result = await model.generateContent({
  contents: [{
    role: 'user',
    parts: [
      { 
        inlineData: { 
          mimeType: 'audio/webm', 
          data: base64Audio 
        } 
      },
      { text: systemPrompt + userMessage }
    ]
  }],
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: buildSoapJsonSchema(config),
    temperature: 0.3,
  }
});
```

## 9. スコープ外（明示）

以下は Phase 1 では実装しない：

- リアルタイム文字起こし表示（Phase 2）
- 患者名の自動抽出と振り分け（Phase 2）
- 複数患者の自動分割（Phase 2）
- 30分以上の長時間録音（Phase 2）
- バックエンド・DB・認証
- HIPAA / 医療情報安全管理ガイドライン完全準拠（本番化時）
- 音声ファイルのサーバー保存
- 多言語対応
- 既存「メモから作成」「履歴」機能の変更

## 10. 既存資産との関係

| 既存資産 | 本機能での扱い |
|---|---|
| `lib/geminiClient.ts` | **そのまま流用**（getGeminiModel） |
| `lib/soapPrompt.v3.ts` | **拡張流用**（音声入力用バージョン追加） |
| `lib/generateSoap.ts` | テキスト用は維持、音声用は新規 audioToSoap.ts として作成 |
| `lib/formatters.ts` | そのまま流用 |
| `lib/quickSoapStorage.ts` | そのまま流用 |
| `types.ts` の `QuickSoapRecord` | そのまま流用 |
| `components/QuickSoapEditor.tsx` | そのまま流用 |
| `components/QuickSoapHistoryList.tsx` | そのまま流用 |
| 既存「録音から作成」モード（モック） | **本実装に置き換え** |

## 11. ファイル構成（新規 + 変更）

```
yorisoi-shisetsu/
├── lib/
│   ├── voiceRecorder.ts             ← 新規: MediaRecorder ラッパー
│   ├── audioToSoap.ts               ← 新規: Gemini Audio 経由のSOAP生成
│   └── (既存ファイルは変更なし)
├── components/
│   ├── VoiceRecorder.tsx            ← 新規: 録音 UI コンポーネント
│   └── RecordingPanel.tsx           ← 新規: 「録音から作成」モード本体
├── App.tsx                          ← 変更: 「録音から作成」モードを本実装に切替
└── docs/
    ├── voice-feature-requirements.md      ← 本書
    └── voice-feature-cursor-instructions.md  ← 別ファイル
```

## 12. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| Gemini Audio の医療用語精度 | 薬剤名等の認識精度 | 既存 v3 プロンプトを音声用に調整、Few-shot 追加 |
| 音声ファイルサイズ上限 | 20MB | 3分以下なら問題なし（実測200-300KB/分） |
| ブラウザ互換性 | iOS Safari の MIME | Phase 1 は Chrome 優先、iOS は Phase 1.5 |
| マイク権限 | HTTPS 必須 | Vercel デプロイ + localhost 開発 |
| API レスポンス時間 | 30秒超 | タイムアウト 60秒、進捗表示 |
| 既存機能への影響 | モック置き換え | feature/voice-recording ブランチで分離 |
| コスト爆発 | Audio は1分0.4円程度 | 月額アラート設定で監視 |

## 13. 成功指標

Phase 1 完了の基準：

- [ ] スマホ（Chrome）でマイクが起動する
- [ ] 録音3分で SOAP 生成が30秒以内
- [ ] 生成された SOAP が薬剤師目線で違和感ない品質
- [ ] 既存の「メモから作成」「履歴」モードに影響がない
- [ ] localhost で完全に動作する
- [ ] Vercel デプロイで公開 URL でデモ実施可能
- [ ] Elan提案・β顧客面談で「これいいね」のリアクション

## 14. デモシナリオ（参考）

```
1. スマホで公開 URL を開く
2. 「録音から作成」タブ
3. さくら苑 / 田中健さん を選択
4. 「録音開始」ボタン
5. 話す（例）:
   "田中さんの今日の様子です。
    血圧は120/70台で安定。降圧剤アムロジピン5mgを朝食後に継続服用中。
    認知症が進行していて、本人からの訴えはほぼ聴取困難。
    介護スタッフから、ここ3日便が出ていない、食事量も減少と報告。
    残薬を確認すると約14日分蓄積している。
    服薬支援を強化する必要がある。
    次回までに看護師と排便コントロールを協議予定。"
6. 「録音停止」ボタン
7. 20秒待つ
8. SOAP が画面表示される（v3 と同等品質を期待）
9. 「保存」→ 履歴に追加
```

3分以内で実演完了が Phase 1 ゴール。
