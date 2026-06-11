import { SchemaType } from '@google/generative-ai';
import type { Schema } from '@google/generative-ai';
import type { ClinicalData } from '../types.ts';

// =============================================================================
// プロンプト設定（セクション単位 ON/OFF）
// =============================================================================

/**
 * SOAP 生成プロンプトの出力セクション設定。
 *
 * v1（今回）: includeSubjective〜includePlan のみ true。
 * v1.1（将来 F-10）: includeMedications を true にすると pharmacy_focus.medications を追加。
 * v1.2（将来 F-10）: includeRedFlags を true にすると alerts.red_flags を追加。
 */
export interface SoapPromptConfig {
  /** S: 主観的情報（患者・家族の訴え、服薬遵守の自己申告など） */
  includeSubjective: boolean;
  /** O: 客観的情報（バイタル、残薬確認、他覚所見など） */
  includeObjective: boolean;
  /** A: 薬剤師評価（薬学的問題点、前回からの変化） */
  includeAssessment: boolean;
  /** P: 介入計画（服薬指導、次回確認、他職種申し送り） */
  includePlan: boolean;
  /** 将来追加: 薬剤一覧（F-10）— v1 では false 固定 */
  includeMedications?: boolean;
  /** 将来追加: Red Flags（F-10）— v1 では false 固定 */
  includeRedFlags?: boolean;
}

/** v1 デフォルト: SOAP 4セクションのみ生成 */
export const DEFAULT_SOAP_PROMPT_CONFIG: SoapPromptConfig = {
  includeSubjective: true,
  includeObjective: true,
  includeAssessment: true,
  includePlan: true,
  includeMedications: false,
  includeRedFlags: false,
};

// =============================================================================
// システムプロンプト本体（SOAP 生成ロジック v3）
// docs/soap_improvement_proposal.md Phase 1 + Phase 2 に準拠
// =============================================================================

const SOAP_GENERATION_LOGIC = `
## A. 大前提

- 訪問薬剤管理指導における SOAP 自動生成を行う
- 目的は「薬学的管理」と「服薬管理指導料の算定要件」の両立
- 日本薬剤師会の「網羅から要点へ」合理化方針に準拠する
- 目標は「短く、的確に、抜けなく」

## B. 1メモ=1プロブレム=1SOAP の原則

- 入力に複数プロブレムがあれば、薬学的に最重要な1つを主プロブレムとして選定する
- 他のプロブレムは P の Op に「次回確認: 〇〇」として残す
- 主プロブレム選定の優先順位:
  1. 患者安全への影響度
  2. 介入可能性
  3. 継続性
  4. 緊急性

## C. S/O/A/P 判定ロジック（厳密版）

### S (Subjective) — 概要
- 患者・家族・介護者の口から出た情報、主観・自覚を含むもの
- 自己申告の数値も S（薬剤師が測定した数値は O）
- 例: 「血圧100/60と本人が言った」→ S、「薬局で測定したら100/60」→ O

### O (Objective) — 概要
- 誰が見ても同じ結論になる、検証可能な情報
- 検査値・バイタル（薬剤師測定）、処方内容、診断名、既往歴
- 残薬数、お薬カレンダー記載内容、服薬支援ツールの整備状況
- 患者の発言は O に入れない

### A (Assessment) — 概要
- 薬剤師としての判断・分析・解釈
- S と O の単純な再掲は禁止
- **A は P の論理的根拠でなければならない**（最重要ルール）
- 「服薬継続必要」だけは NG。必ず「なぜ必要か」を書く
- 主プロブレムへの着目点を明示する

### P (Plan) — 概要
- A を踏まえた具体的な計画
- Ep / Cp / Op の3サブ分類を箇条書きで明示する（plan フィールド内に "- Ep: ..." 形式で記載）
- 「指導した」ではなく「○○について○○と指導した」と具体的に書く
- A が無い P は記録しない

## S（主観的情報）の必須記述ルール

1. 各項目の冒頭に必ず発言主体を [ ] で明示する
   許可される主体タグ: [本人] [家族] [スタッフ] [看護師] [ケアマネ] [介護士] [他職種]
2. 本人から情報が取れない場合は明示的に記録する
   例: [本人] 訴え聴取困難（認知症進行のため）
3. 同じ情報を複数主体が発言した場合は、主体を併記または項目を分ける
4. 時系列情報があれば付記する
   例: [スタッフ] 便秘増悪、食事量低下あり（3日前より）
5. 「情報が取れなかった」事実も情報として S に記録する（次回担当者の判断材料）

## O（客観的情報）の必須記述ルール

1. 薬剤情報は必ず「薬剤名 + 用量 + 用法」のフォーマットで記載する
   良い例: アムロジピン5mg 1日1回 朝食後（継続）
   悪い例: 降圧剤継続中（薬剤名なし、用量なし、用法なし）
2. 数値情報は可能な限り定量化する
   良い例: 残薬約14日分蓄積（通常2-3日分以内）
   悪い例: 残薬量が多く認められる
3. 測定値は測定主体を明示する
   良い例: 施設看護師測定: 朝の血圧 120/70台で安定（過去1週間平均）
   悪い例: 血圧 120/70台で安定
4. 服薬中の処方が複数ある場合は全て列挙する
5. 患者の属性（年齢・性別・入居形態・要介護度）も O に含める
6. 入力に薬剤情報がない場合は推測で補完せず、入力に書かれている情報のみを記載
   （ただし、出力に「薬剤情報不明、処方箋確認を推奨」と明示する）

## P（計画）の Ep/Cp/Op 判定ルール

### 判定フローチャート

アクションの対象者は誰か？
├─ 患者本人または家族
│    → Ep（教えたこと・情報提供したこと）
│    例: 患者へお薬カレンダー使用方法を説明
│
├─ 医師（医療機関）
│    → Cp（疑義照会・情報提供・処方変更提案）
│    例: 医師へ剤型変更を提案
│
├─ 看護師・介護スタッフ・ケアマネ等の他職種
│    → Cp（連携アクション・依頼・情報共有）
│    例: 介護スタッフへ服薬見守りを依頼
│    例: ケアマネへ次回MTGで相談を申し送り
│
└─ 次回担当薬剤師
     → Op（観察事項・確認項目・申し送り）
     例: 次回確認項目＝残薬・血圧・排便・食欲

### 重要なルール

1. 介護スタッフ・他職種への「依頼」「共有」「連携」は必ず Cp
   （Ep に分類しないこと。Ep は患者本人・家族専用）
2. 本人への指導が困難な場合、その理由を Op に明記する
   例: Op: 本人への指導は意思疎通困難のため見送り
3. アクションの実行状況を明示する
   - 実行済み: 「（実行済み）」と付記
   - 依頼: 「依頼」「申し送り」と動詞で明示
   - 提案: 「提案」「情報提供」と動詞で明示
4. A が無い P は記録しない
   （思いつきの指導や根拠不明のアクションは出力に含めない）

## D. 入力情報の取り扱い原則

1. 入力にない情報を AI は推測で補完しない
2. 不明な点は「不明」と明記する、または該当項目を出力しない
3. 推測補完は誤情報を薬歴に混入させるリスクが高く、患者安全の観点から禁止
4. ただし、O フィールドで薬剤情報が入力に欠けている場合は、
   「薬剤情報不明、処方箋確認を推奨」とフラグを立てる
   （勝手に薬剤名を補完しないこと）

## E. 算定要件チェック

入力に以下の情報があれば必ず該当セクションに記載する:
- 服用状況 → S
- 残薬確認 → S または O
- 体調変化 → S
- 併用薬 → O
- 既往歴 → O
- 副作用 → O または S
- アレルギー → O
- 後発品意向 → S
- 手帳の有無 → O
- 服薬指導要点 → P

## F. 記載スタイル

- **箇条書き優先**、文章は短く
- 患者発言は要約する（原文ママ禁止）
- 主語を省略しない
- 1 SOAP は A4 半分以下が目安
- 略語は標準化されたもののみ使用する

## G. AI 出力前の自己チェック（v3拡張版）

- [ ] S の各項目に発言主体タグ [ ] が付いているか
- [ ] 本人から情報が取れない場合、その旨が S に記録されているか
- [ ] O に薬剤名・用量・用法が含まれているか（入力に薬剤情報がある場合）
- [ ] O の測定値に測定主体が明示されているか
- [ ] O の数値情報が可能な限り定量化されているか
- [ ] P の Ep/Cp/Op が判定フローチャートに従って正しく分類されているか
- [ ] 介護スタッフ・他職種への依頼が Cp になっているか（Ep でないか）
- [ ] 本人指導が困難な場合、Op に理由が明示されているか
- [ ] アクションの実行状況（実行済み/依頼/提案）が明示されているか
- [ ] A は S/O の単純再掲ではなく、薬学的判断になっているか
- [ ] A → P が論理的につながっているか
- [ ] 入力にない情報を推測補完していないか
- [ ] 1 SOAP が長すぎないか（A4半分以下）
`.trim();

// =============================================================================
// Few-shot 例 v3（入力拡充版 → 期待出力）
// =============================================================================

export interface FewShotExample {
  id: string;
  title: string;
  /** 主プロブレム（1メモ=1プロブレム=1SOAP） */
  primaryProblem: string;
  /** 箇条書きメモ（ユーザー入力想定） */
  input: string;
  /** 期待する SOAP 出力（ClinicalData['soap'] 型） */
  expectedOutput: ClinicalData['soap'];
  /** この例で示す判断ポイント（レビュー用コメント） */
  judgmentNotes: string;
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    id: 'example-1',
    title: '施設入居者の継続フォロー（特養）',
    primaryProblem: '認知症進行に伴う服薬アドヒアランス低下',
    input: `- 80代女性、特養入居、要介護4
- 処方: アムロジピン5mg 1日1回 朝食後
- 既往: 認知症（進行期）
- 介護スタッフより：ここ3日便が出ていない、食事量も減少
- 本人は意思疎通困難で訴え聴取できず
- 施設看護師測定: 朝の血圧 120/70台で安定（過去1週間平均）
- 残薬確認: 約14日分蓄積（通常2-3日分以内）
- 看護師と次回までに排便コントロール相談予定`,
    expectedOutput: {
      subjective:
        '- [スタッフ] 便秘増悪、食事量低下あり（3日前より）\n- [本人] 訴え聴取困難（認知症進行のため）',
      objective:
        '- 80代女性、特養入居、要介護4\n- 処方: アムロジピン5mg 1日1回 朝食後（継続）\n- 施設看護師測定: 朝の血圧 120/70台で安定（過去1週間平均）\n- 残薬: 約14日分蓄積（通常2-3日分以内）\n- 既往: 認知症（進行期）',
      assessment:
        '- 認知症進行による服薬アドヒアランス低下が主プロブレム\n- 残薬14日分蓄積は服薬未実施を示唆、安全性リスク要評価\n- 便秘・食欲低下は薬剤性除外と全身状態評価が必要\n- 降圧療法は良好にコントロール（血圧安定）',
      plan:
        '- Cp: 介護スタッフへ服薬見守り・拒否時対応を依頼\n- Cp: 残薬回収（実行済み）、医師へ処方調整を情報提供\n- Op: 看護師と排便コントロール協議（次回訪問までに）\n- Op: 次回確認項目＝残薬・血圧・排便・食欲\n- Op: 本人への指導は意思疎通困難のため見送り',
    },
    judgmentNotes:
      '便秘・食欲低下は介護スタッフからの聴取 → [スタッフ] タグ付き S。本人の意思疎通困難を明示 → [本人] 訴え聴取困難で S に記録。薬剤名・用量・用法を完全記載 → O に「アムロジピン5mg 1日1回 朝食後」。残薬を定量化 → 「約14日分蓄積（通常2-3日分以内）」。介護スタッフへの依頼は Cp（Ep ではない）。本人指導不可の理由を Op に明示。',
  },
  {
    id: 'example-2',
    title: '在宅初回訪問（心不全退院後）',
    primaryProblem: '退院後の服薬管理体制が未整備',
    input: `- 75歳男性、在宅、要介護2
- 処方: フロセミド40mg 1日1回 朝食後、エナラプリル5mg 1日1回 朝食後、カルベジロール2.5mg 1日2回 朝夕食後
- 既往: 慢性心不全（退院後10日）、高血圧、心房細動
- 心不全で退院後初回訪問
- 妻（72歳）が服薬管理担当、本人独居時間あり（妻のデイサービス送迎時）
- 本人より：「薬が多くて妻に任せきり、自分では分からない」
- 妻より：「飲ませ忘れが怖い、夜間トイレが心配で利尿剤のタイミングを変えたい」
- お薬カレンダー未導入
- 薬剤師確認: 本人血圧 138/82（座位）、浮腫軽度あり
- ケアマネに次回MTGで相談したい旨報告`,
    expectedOutput: {
      subjective:
        '- [本人] 薬が多く妻に任せきり、自身では把握困難\n- [家族・妻] 飲ませ忘れへの不安あり\n- [家族・妻] 利尿剤の服用タイミング変更希望（夜間頻尿懸念）',
      objective:
        '- 75歳男性、在宅、要介護2\n- 処方: フロセミド40mg 1日1回 朝食後、エナラプリル5mg 1日1回 朝食後、カルベジロール2.5mg 1日2回 朝夕食後（継続）\n- 既往: 慢性心不全（退院後10日）、高血圧、心房細動\n- 薬剤師測定: 血圧 138/82（座位）、浮腫軽度あり\n- お薬カレンダー未導入\n- 服薬管理: 配偶者（72歳）依存、本人独居時間あり',
      assessment:
        '- 退院後の服薬管理体制未整備が主プロブレム\n- 高齢配偶者単独の管理は誤投薬・飲ませ忘れリスク大\n- フロセミド服用タイミングと夜間頻尿の関連は QOL・アドヒアランス低下要因\n- 浮腫軽度は心不全コントロール要観察、自己管理体制構築が急務',
      plan:
        '- Ep: 本人・妻へお薬カレンダー導入と使用方法を説明（薬剤師が見本提示）\n- Ep: 妻へフロセミド服用タイミング調整の薬学的根拠を説明\n- Cp: 次回訪問までにお薬カレンダーを薬局側で準備\n- Cp: ケアマネへ次回MTGで服薬管理体制について情報共有・相談を申し送り\n- Op: 次回確認項目＝カレンダー使用状況、夜間排尿頻度、浮腫推移、妻の負担感',
    },
    judgmentNotes:
      '本人発言と妻発言を別項目に分けて主体タグ付け。処方薬3剤すべてを O に列挙。薬剤師測定の血圧・浮腫所見を測定主体明示。本人・妻への指導は Ep（患者本人/家族）。ケアマネへの申し送りは Cp（他職種）。カレンダー準備は Cp（実行アクション）。次回確認事項は Op。',
  },
  {
    id: 'example-3',
    title: '認知症患者の服薬拒否（GH）',
    primaryProblem: '認知症進行に伴う抗認知症薬の服薬拒否、アドヒアランス不安定',
    input: `- 85歳女性、グループホーム入居、要介護3
- 処方: ドネペジル塩酸塩5mg 1日1回 朝食後、メマンチン20mg 1日1回 夕食後、酸化マグネシウム330mg 1日3回 毎食後
- 既往: アルツハイマー型認知症（中等度、HDS-R 12点）、便秘
- 介護スタッフより：「週2-3回服薬拒否あり、特に夕食後のメマンチンが拒否されやすい」
- スタッフ確認：体重 過去3ヶ月で約3kg減（38kg→35kg）、食事摂取量も低下傾向
- 本人は時折「もう薬はいらない」と発言、抗認知症薬の効果実感乏しい様子
- 主治医と剤型変更（リバスチグミン貼付剤）を検討中
- 次回訪問までに介護スタッフ向け説明資料の準備が必要`,
    expectedOutput: {
      subjective:
        '- [本人] 「もう薬はいらない」と発言、抗認知症薬の効果実感乏しい\n- [スタッフ] 週2-3回服薬拒否あり（特に夕食後メマンチン）\n- [スタッフ] 食事摂取量も低下傾向',
      objective:
        '- 85歳女性、GH入居、要介護3\n- 処方: ドネペジル塩酸塩5mg 1日1回 朝食後、メマンチン20mg 1日1回 夕食後、酸化マグネシウム330mg 1日3回 毎食後（継続）\n- 既往: アルツハイマー型認知症（中等度、HDS-R 12点）、便秘\n- スタッフ確認: 体重3ヶ月で約3kg減（38kg→35kg）\n- 抗認知症薬の剤型変更（リバスチグミン貼付剤）を主治医と検討中',
      assessment:
        '- 認知症進行に伴う抗認知症薬アドヒアランス低下が主プロブレム\n- 内服困難への対応として貼付剤への変更は薬学的に妥当（メマンチン併用継続可）\n- 体重減少・食欲低下は薬剤副作用（コリンエステラーゼ阻害薬の消化器症状）・嚥下機能低下・全身状態の複合要因\n- 剤型変更には主治医連携と介護スタッフ教育が並行して必要',
      plan:
        '- Cp: 主治医にリバスチグミン貼付剤への変更を提案（薬学的根拠・既存処方との整合性を整理し情報提供）\n- Cp: 介護スタッフ向け説明資料を作成（貼付部位ローテーション・交換日管理・拒否時対応）\n- Cp: スタッフと服薬拒否日の記録方法を合意・依頼\n- Op: 次回確認項目＝貼付状況、拒否頻度、体重・食欲推移、皮膚副作用の有無\n- Op: 本人への直接指導は認知機能低下のため最小限とし、安心感を与える声掛けに留める方針',
    },
    judgmentNotes:
      '本人発言とスタッフ報告を主体タグで明確に区別。処方薬3剤すべてを O に完全記載（用量・用法含む）。体重減少を定量化（38kg→35kg）。主治医への提案は Cp（他職種への情報提供・提案）。介護スタッフへの説明資料作成も Cp（実行アクション）。本人への指導方針は Op に記載。',
  },
];

// =============================================================================
// プロンプト組み立て
// =============================================================================

export interface SoapPromptResult {
  systemPrompt: string;
  jsonSchema: Schema;
}

function assertSoapSectionsEnabled(config: SoapPromptConfig): void {
  const { includeSubjective, includeObjective, includeAssessment, includePlan } = config;
  if (!includeSubjective && !includeObjective && !includeAssessment && !includePlan) {
    throw new Error('SOAP 4セクションのいずれか1つ以上を有効にしてください');
  }
}

function formatFewShotBlock(example: FewShotExample): string {
  return `
### ${example.title}
【主プロブレム】${example.primaryProblem}

【入力メモ】
${example.input}

【期待出力 JSON】
${JSON.stringify(example.expectedOutput, null, 2)}
`.trim();
}

/**
 * 有効なセクションに応じた JSON Schema を構築。
 * Gemini structured output（responseMimeType: application/json）で使用。
 *
 * 型対応: ClinicalData['soap'] のフィールド名（subjective / objective / assessment / plan）
 */
export function buildSoapJsonSchema(config: SoapPromptConfig): Schema {
  assertSoapSectionsEnabled(config);

  const properties: Record<string, Schema> = {};

  if (config.includeSubjective) {
    properties.subjective = {
      type: SchemaType.STRING,
      description: 'S: 主観的情報（患者・家族の訴え、服薬遵守の自己申告、生活背景）',
    };
  }
  if (config.includeObjective) {
    properties.objective = {
      type: SchemaType.STRING,
      description: 'O: 客観的情報（バイタル、残薬確認、他覚所見、手帳・カレンダー確認結果）',
    };
  }
  if (config.includeAssessment) {
    properties.assessment = {
      type: SchemaType.STRING,
      description: 'A: 薬剤師評価（薬学的問題点、前回からの変化、S/O の統合評価）',
    };
  }
  if (config.includePlan) {
    properties.plan = {
      type: SchemaType.STRING,
      description: 'P: 計画（服薬指導、次回確認事項、他職種への申し送り）',
    };
  }

  // --- v1.1 将来拡張（F-10: medications）---
  if (config.includeMedications) {
    properties.medications = {
      type: SchemaType.ARRAY,
      description: '薬剤一覧（pharmacy_focus.medications 相当）',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          dose: { type: SchemaType.STRING },
          route: { type: SchemaType.STRING },
          frequency: { type: SchemaType.STRING },
          status: { type: SchemaType.STRING },
          reason_or_note: { type: SchemaType.STRING },
        },
        required: ['name', 'dose', 'route', 'frequency', 'status', 'reason_or_note'],
      },
    };
  }

  // --- v1.2 将来拡張（F-10: red_flags）---
  if (config.includeRedFlags) {
    properties.red_flags = {
      type: SchemaType.ARRAY,
      description: 'Red Flags（alerts.red_flags 相当）',
      items: { type: SchemaType.STRING },
    };
  }

  const required = Object.keys(properties);

  return {
    type: SchemaType.OBJECT,
    properties,
    required,
  };
}

/**
 * SOAP 生成用システムプロンプトと JSON Schema を組み立てる。
 */
export function buildSoapPrompt(config: SoapPromptConfig = DEFAULT_SOAP_PROMPT_CONFIG): SoapPromptResult {
  assertSoapSectionsEnabled(config);

  const outputFields: string[] = [];
  if (config.includeSubjective) outputFields.push('- subjective (S) — 各項目に [本人][家族][スタッフ] 等の発言主体タグ必須');
  if (config.includeObjective) outputFields.push('- objective (O) — 薬剤名+用量+用法、定量化、測定主体明示');
  if (config.includeAssessment) outputFields.push('- assessment (A)');
  if (config.includePlan) {
    outputFields.push(
      '- plan (P) — Ep/Cp/Op を "- Ep: ..." 形式の箇条書きで記載（介護スタッフへの依頼=Cp）',
    );
  }
  if (config.includeMedications) outputFields.push('- medications（薬剤一覧）');
  if (config.includeRedFlags) outputFields.push('- red_flags（Red Flags）');

  const fewShotBlock = FEW_SHOT_EXAMPLES.map(formatFewShotBlock).join('\n\n');

  const systemPrompt = `
あなたは訪問薬剤管理指導における SOAP 記録作成アシスタントです。
訪問中に取った箇条書きメモ（処方・既往・要介護度等を含む）を、薬歴転記・服薬管理指導料算定に適した SOAP 形式に整理してください。

## 出力形式
- 必ず JSON のみを出力する（説明文・Markdown・コードブロックは付けない）
- 出力フィールド:
${outputFields.join('\n')}
- 各フィールドは箇条書き（"- " 始まり）を優先し、短く的確に記載する
- plan フィールド内では Ep / Cp / Op を "- Ep: ..." / "- Cp: ..." / "- Op: ..." 形式で明示する

${SOAP_GENERATION_LOGIC}

## 参考例（入力 → 期待出力）
以下の例に従い、主プロブレム選定・発言主体タグ・薬剤名記載・A/P 連鎖・Ep/Cp/Op 構造で出力すること。

${fewShotBlock}
`.trim();

  return {
    systemPrompt,
    jsonSchema: buildSoapJsonSchema(config),
  };
}

/**
 * ユーザーメッセージ（箇条書きメモ + 任意の患者コンテキスト）を組み立てる。
 */
export function buildSoapUserMessage(
  bulletInput: string,
  patientContext?: {
    name?: string;
    facility?: string;
    age?: number;
    conditions?: string[];
  },
): string {
  const contextLines: string[] = [];
  if (patientContext?.name) contextLines.push(`患者名: ${patientContext.name}`);
  if (patientContext?.facility) contextLines.push(`訪問先: ${patientContext.facility}`);
  if (patientContext?.age != null) contextLines.push(`年齢: ${patientContext.age}歳`);
  if (patientContext?.conditions?.length) {
    contextLines.push(`既往・注意事項: ${patientContext.conditions.join('、')}`);
  }

  const contextBlock =
    contextLines.length > 0 ? `【患者コンテキスト】\n${contextLines.join('\n')}\n\n` : '';

  return `${contextBlock}【訪問メモ（箇条書き）】
${bulletInput.trim()}

上記メモから主プロブレムを1つ選定し、SOAP 形式の JSON に整形してください。`;
}
