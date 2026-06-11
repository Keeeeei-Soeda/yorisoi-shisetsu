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
// システムプロンプト本体（SOAP 生成ロジック v2）
// docs/soap-generation-logic.md（ホワイトペーパー）に準拠
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

### S (Subjective)
- 患者・家族・介護者の口から出た情報、主観・自覚を含むもの
- 自己申告の数値も S（薬剤師が測定した数値は O）
- 例: 「血圧100/60と本人が言った」→ S、「薬局で測定したら100/60」→ O

### O (Objective)
- 誰が見ても同じ結論になる、検証可能な情報
- 検査値・バイタル（薬剤師測定）、処方内容、診断名、既往歴
- 残薬数、お薬カレンダー記載内容、服薬支援ツールの整備状況
- 患者の発言は O に入れない

### A (Assessment)
- 薬剤師としての判断・分析・解釈
- S と O の単純な再掲は禁止
- **A は P の論理的根拠でなければならない**（最重要ルール）
- 「服薬継続必要」だけは NG。必ず「なぜ必要か」を書く
- 主プロブレムへの着目点を明示する

### P (Plan)
- A を踏まえた具体的な計画
- Ep / Cp / Op の3サブ分類を箇条書きで明示する（plan フィールド内に "- Ep: ..." 形式で記載）:
  - Ep (Educational Plan): 教えたこと・情報提供したこと
  - Cp (Care Plan): 行ったこと（疑義照会、調剤工夫、ツール準備等）
  - Op (Observational Plan): 次回確認・申し送り・他職種連携
- 「指導した」ではなく「○○について○○と指導した」と具体的に書く
- A が無い P は記録しない

## D. 入力情報の取り扱い原則

- **入力にない情報を AI は推測で補完しない**
- 不明な点は記載しないか「不明」と明記する
- 推測補完は誤情報混入リスクが高く、患者安全の観点から禁止

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

## G. AI 自己チェック（出力前に確認）

- [ ] S と O が混在していないか
- [ ] A は薬剤師の思考であり、S/O の再掲になっていないか
- [ ] P は A から論理的に導けるか
- [ ] 算定必須項目に抜けがないか
- [ ] 入力にない情報を推測で補完していないか
- [ ] 1 SOAP が長すぎないか
`.trim();

// =============================================================================
// Few-shot 例 v2（入力 → 期待出力）
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
    input: `- 80代女性、特養入居
- 降圧剤の血圧コントロール良好（朝120/70台）
- 認知症進行で残薬多め、服薬支援強化が必要
- 食事量低下、便秘の訴え増えてる
- 看護師と次回までに排便コントロール相談予定`,
    expectedOutput: {
      subjective:
        '- 便秘増悪・食事量低下を訴え\n- 服薬への拒否や明確な副作用訴えなし',
      objective:
        '- 80代女性、特養入居\n- 降圧剤継続中、朝の血圧 120/70台で安定\n- 残薬量が通常より多く認められる\n- 認知症進行の経過あり',
      assessment:
        '- 認知症進行による服薬アドヒアランス低下が主プロブレム\n- 残薬蓄積は服薬未実施を示唆、安全性リスク要評価\n- 便秘・食欲低下は薬剤性除外と全身状態評価が必要\n- 降圧療法は良好にコントロール',
      plan:
        '- Ep: 介護スタッフへ服薬見守り・拒否時対応を共有\n- Cp: 残薬回収、次回処方調整を医師に情報提供\n- Op: 看護師と排便コントロール協議（次回訪問までに）\n- Op: 次回確認＝残薬・血圧・排便・食欲',
    },
    judgmentNotes:
      '「便秘の訴え」→患者発言なので S。「血圧120/70」「残薬多め」→薬剤師確認の客観情報なので O。A は単なる S/O 再掲ではなく、薬剤師の薬学的判断を提示。P は Ep/Cp/Op で構造化。',
  },
  {
    id: 'example-2',
    title: '在宅初回訪問（心不全退院後）',
    primaryProblem: '退院後の服薬管理体制が未整備',
    input: `- 75歳男性、心不全で退院後初回訪問
- 妻が服薬管理担当、独居時間あり
- お薬カレンダーまだ未導入
- 利尿剤のタイミングで失禁懸念
- 妻も高齢で服薬管理に不安あり
- ケアマネに次回MTGで相談したい旨報告`,
    expectedOutput: {
      subjective:
        '- 妻（高齢）が服薬管理担当も不安を訴える\n- 本人独居時間あり\n- 利尿剤の服用タイミングと失禁への懸念',
      objective:
        '- 75歳男性、在宅\n- 心不全退院後の初回訪問\n- お薬カレンダー未導入\n- 服薬管理は配偶者依存、独居時間帯あり',
      assessment:
        '- 退院後の服薬管理体制未整備が主プロブレム\n- 高齢配偶者単独の管理は誤投薬・負担増リスク\n- 利尿剤と失禁リスクの関連は QOL 低下・服薬拒否要因になり得る\n- お薬カレンダー導入で可視化・配偶者負担軽減が見込める',
      plan:
        '- Ep: お薬カレンダー導入と使用方法を本人・妻へ説明\n- Ep: 利尿剤の服用タイミング調整（生活リズム・外出時刻と整合）を指導\n- Cp: 次回までにカレンダーを薬局側で準備\n- Op: ケアマネへ次回 MTG で情報共有・相談を申し送り\n- Op: 次回確認＝カレンダー使用状況、失禁有無、妻の負担感',
    },
    judgmentNotes:
      '妻の「不安」「懸念」→主観なので S。カレンダー未導入は薬剤師確認の事実→O。ケアマネ申し送りは Op、薬局でカレンダー準備は Cp。',
  },
  {
    id: 'example-3',
    title: '認知症患者の服薬拒否（GH）',
    primaryProblem: '認知症進行に伴う服薬拒否、抗認知症薬アドヒアランス不安定',
    input: `- 85歳女性、グループホーム入居
- 認知症中等度、服薬拒否の日あり
- 抗認知症薬の貼付剤に変更検討中
- 食欲低下、体重減少傾向
- 主治医に剤型変更提案する方針
- 介護スタッフへの説明資料も準備必要`,
    expectedOutput: {
      subjective:
        '- 服薬拒否の日あり（介護スタッフから聴取）\n- 食欲低下・体重減少傾向（スタッフ確認）',
      objective:
        '- 85歳女性、GH 入居\n- 認知症中等度\n- 現行抗認知症薬は内服剤\n- 体重減少傾向・食欲低下を認める',
      assessment:
        '- 認知症進行による服薬拒否で抗認知症薬アドヒアランス不安定が主プロブレム\n- 内服困難への対応として貼付剤への変更は薬学的に妥当\n- 食欲低下・体重減少は薬剤副作用・嚥下機能低下・全身状態の複合要因\n- 剤型変更には主治医連携と介護スタッフ教育が並行して必要',
      plan:
        '- Ep: 介護スタッフへ貼付剤使用方法（貼付部位・交換日・拒否時対応）の説明資料準備\n- Cp: 主治医に貼付剤変更を提案（薬学的根拠を整理して情報提供）\n- Op: スタッフと服薬拒否日の記録方法を合意\n- Op: 次回確認＝貼付状況、拒否頻度、体重・食欲、副作用の有無',
    },
    judgmentNotes:
      '介護スタッフからの聴取情報も S（代弁含む）。主治医への剤型変更提案は Cp（行ったこと）。スタッフへの説明資料準備は Ep（教えること）。',
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
 *
 * @example Step 3 での呼び出しイメージ
 * ```typescript
 * const { systemPrompt, jsonSchema } = buildSoapPrompt(DEFAULT_SOAP_PROMPT_CONFIG);
 * const model = getGeminiModel();
 * const result = await model.generateContent({
 *   contents: [
 *     { role: 'user', parts: [{ text: systemPrompt }] },
 *     { role: 'user', parts: [{ text: userMessage }] },
 *   ],
 *   generationConfig: {
 *     responseMimeType: 'application/json',
 *     responseSchema: jsonSchema,
 *   },
 * });
 * ```
 */
export function buildSoapPrompt(config: SoapPromptConfig = DEFAULT_SOAP_PROMPT_CONFIG): SoapPromptResult {
  assertSoapSectionsEnabled(config);

  const outputFields: string[] = [];
  if (config.includeSubjective) outputFields.push('- subjective (S)');
  if (config.includeObjective) outputFields.push('- objective (O)');
  if (config.includeAssessment) outputFields.push('- assessment (A)');
  if (config.includePlan) outputFields.push('- plan (P) — Ep/Cp/Op を "- Ep: ..." 形式の箇条書きで記載');
  if (config.includeMedications) outputFields.push('- medications（薬剤一覧）');
  if (config.includeRedFlags) outputFields.push('- red_flags（Red Flags）');

  const fewShotBlock = FEW_SHOT_EXAMPLES.map(formatFewShotBlock).join('\n\n');

  const systemPrompt = `
あなたは訪問薬剤管理指導における SOAP 記録作成アシスタントです。
訪問中に取った箇条書きメモを、薬歴転記・服薬管理指導料算定に適した SOAP 形式に整理してください。

## 出力形式
- 必ず JSON のみを出力する（説明文・Markdown・コードブロックは付けない）
- 出力フィールド:
${outputFields.join('\n')}
- 各フィールドは箇条書き（"- " 始まり）を優先し、短く的確に記載する
- plan フィールド内では Ep / Cp / Op を "- Ep: ..." / "- Cp: ..." / "- Op: ..." 形式で明示する

${SOAP_GENERATION_LOGIC}

## 参考例（入力 → 期待出力）
以下の例に従い、主プロブレム選定・S/O 分類・A/P 連鎖・Ep/Cp/Op 構造で出力すること。

${fewShotBlock}
`.trim();

  return {
    systemPrompt,
    jsonSchema: buildSoapJsonSchema(config),
  };
}

/**
 * ユーザーメッセージ（箇条書きメモ + 任意の患者コンテキスト）を組み立てる。
 * Step 3 generateSoap.ts から利用予定。
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
