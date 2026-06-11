import { Schema, SchemaType } from '@google/generative-ai';
import { ClinicalData } from '../types';

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
// S/O/A/P 判断基準（訪問薬剤師目線）
// =============================================================================

/**
 * システムプロンプトに埋め込むセクション定義。
 * Few-shot 例と合わせて「S/O の境界判断」を学習させる。
 */
const SOAP_SECTION_CRITERIA = `
## SOAP 各セクションの判断基準（訪問薬剤管理指導）

### S (Subjective) — 主観的情報
- 患者・家族・介護者から聞き取った訴え・申告
- 自覚症状（疼痛、便秘、食欲低下、ふらつきなど）
- 服薬に関する自己申告（飲み忘れ、拒否、副作用の自覚）
- 生活背景・家族構成・介護体制に関する情報（聞き取りベース）

### O (Objective) — 客観的情報
- 測定・確認した数値（血圧、体重、検査値）
- 薬剤師が目視・確認した事実（残薬数、服薬カレンダーの記録、創部所見）
- お薬手帳・カレンダーの記載内容
- 入居施設・在宅環境の観察結果（配置、備品の有無など）

### A (Assessment) — 評価
- 薬剤師としての総合評価・解釈
- 薬学的問題点（DRP）の特定
- 前回訪問からの変化・改善/悪化の判断
- S と O を統合した臨床推論（ここに再掲しない）

### P (Plan) — 計画
- 薬学的介入・服薬指導の具体的内容
- 次回訪問までの確認事項・フォローアップ
- 医師・看護師・ケアマネ・介護スタッフへの申し送り
- 患者・家族への説明・指導事項

## S/O の境界が曖昧な場合の優先ルール
1. **数値・測定値** → 必ず O（例: 血圧120/70、体重○kg）
2. **患者・家族の「訴え」「心配」** → S（例: 便秘がつらい、失禁が不安）
3. **薬剤師が現場で確認した事実** → O（例: 残薬が2週間分、カレンダー未記入）
4. **「〜が必要」「〜を検討」という評価・方針** → A または P（評価なら A、具体行動なら P）
5. 迷った場合は、**薬歴に転記したとき薬剤師が読み返しやすい方**を選ぶ
`.trim();

// =============================================================================
// Few-shot 例（入力 → 期待出力）
// =============================================================================

export interface FewShotExample {
  id: string;
  title: string;
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
    title: '施設入居者の継続フォロー（80代女性、特養）',
    input: `- 80代女性、特養入居
- 降圧剤の血圧コントロール良好（朝120/70台）
- 認知症進行で残薬多め、服薬支援強化が必要
- 食事量低下、便秘の訴え増えてる
- 看護師と次回までに排便コントロール相談予定`,
    expectedOutput: {
      subjective:
        '食事量の低下を自覚。便秘の訴えが増加している。認知症の進行に伴い、本人の服薬管理が困難になっている可能性あり（介護者・施設スタッフからの情報を含む）。',
      objective:
        '80代女性、特別養護老人ホーム入居。朝の血圧120/70台で降圧剤による血圧コントロールは良好。残薬確認にて通常量より多めの残薬を認め、服薬支援の必要性を示唆。',
      assessment:
        '降圧療法は良好にコントロールされている。一方、認知症進行に伴う残薬増加が服薬アドヒアランス低下のリスク因子。食事量低下と便秘訴えの増加は、脱水・薬剤性便秘・全身状態悪化など複合要因を考慮し評価が必要。',
      plan:
        '残薬管理の見直しと服薬支援の強化（服薬見守り・残余薬回収）。便秘に関する非薬療法・薬剤関連の確認、必要時は医師への情報提供を検討。看護師と次回訪問までに排便コントロールについて協議。次回確認：残薬量、排便状況、食事摂取量、血圧推移。',
    },
    judgmentNotes:
      '血圧120/70→O（測定値）。便秘・食事量低下の「訴え」→S。残薬多め→O（確認事実）。服薬支援強化の必要性→A/P に分離。',
  },
  {
    id: 'example-2',
    title: '在宅患者の初回訪問（75歳男性、心不全退院後）',
    input: `- 75歳男性、心不全で退院後初回訪問
- 妻が服薬管理担当、独居時間あり
- お薬カレンダーまだ未導入
- 利尿剤のタイミングで失禁懸念
- 妻も高齢で服薬管理に不安あり
- ケアマネに次回MTGで相談したい旨報告`,
    expectedOutput: {
      subjective:
        '心不全で退院後、初回の訪問薬剤管理指導。配偶者（妻）が服薬管理を担当しているが、本人独居時間あり。利尿剤服用タイミングに関連した失禁への懸念あり。配偶者も高齢で服薬管理に不安を訴える。',
      objective:
        '75歳男性、在宅。心不全退院後初回訪問。お薬カレンダーは未導入。服薬管理は配偶者が担当、本人独居時間帯あり。現時点でカレンダー・服薬支援ツールの整備状況は未整備。',
      assessment:
        '退院後初回訪問のため、服薬管理体制の構築が最優先課題。高齢配偶者による服薬管理は負担・ミスリスクが高く、利尿剤タイミングと失禁リスクの関連も考慮が必要。お薬カレンダー未導入はアドヒアランス・安全性リスク因子。',
      plan:
        'お薬カレンダーまたは同等の服薬支援ツールの導入を提案・設定支援。利尿剤の服用タイミングと生活リズム（失禁対策）について服薬指導。配偶者への服薬管理負担軽減策を説明。ケアマネージャーへ次回カンファレンスでの情報共有・相談を申し送り。次回確認：カレンダー使用状況、服薬遵守、失禁の有無、配偶者の負担感。',
    },
    judgmentNotes:
      '失禁「懸念」→S（不安・訴え）。カレンダー未導入→O（確認事実）。ケアマネへの相談→P（申し送り）。妻の不安→S。',
  },
  {
    id: 'example-3',
    title: '認知症患者の服薬コンプライアンス（85歳女性、GH）',
    input: `- 85歳女性、グループホーム入居
- 認知症中等度、服薬拒否の日あり
- 抗認知症薬の貼付剤に変更検討中
- 食欲低下、体重減少傾向
- 主治医に剤型変更提案する方針
- 介護スタッフへの説明資料も準備必要`,
    expectedOutput: {
      subjective:
        '認知症中等度。服薬拒否の日があるとの情報。食欲低下、体重減少傾向。抗認知症薬の内服継続に困難を感じている（スタッフ・家族からの聞き取りを含む）。',
      objective:
        '85歳女性、グループホーム入居。認知症中等度。服薬拒否が散見される。体重減少傾向・食欲低下を認める。現行抗認知症薬は内服剤、貼付剤への変更を検討中。',
      assessment:
        '認知症に伴う服薬拒否により抗認知症薬のアドヒアランスが不安定。内服から貼付剤への変更は適切な選択肢の一つ。食欲低下・体重減少は薬剤副作用・全身状態・嚥下問題など多因子を考慮し、主治医との連携が必要。',
      plan:
        '主治医に貼付剤変更を提案（剤型変更の薬学的根拠を整理）。介護スタッフ向け説明資料を作成し、貼付部位・交換日・拒否時の対応を共有。服薬拒否日の記録方法をスタッフと合意。次回確認：貼付状況、拒否頻度、体重・食欲、副作用の有無。',
    },
    judgmentNotes:
      '服薬拒否・食欲低下→S（訴え・行動報告）と O（観察された傾向）に分離。剤型変更「方針」→P。評価・多因子考察→A。',
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
  if (config.includePlan) outputFields.push('- plan (P)');
  if (config.includeMedications) outputFields.push('- medications（薬剤一覧）');
  if (config.includeRedFlags) outputFields.push('- red_flags（Red Flags）');

  const fewShotBlock = FEW_SHOT_EXAMPLES.map(formatFewShotBlock).join('\n\n');

  const systemPrompt = `
あなたは訪問薬剤師（在宅・施設訪問）向けの SOAP 記録作成アシスタントです。
訪問中に取った箇条書きメモを、薬歴転記に適した SOAP 形式に整理してください。

## 出力形式
- 必ず JSON のみを出力する（説明文・Markdown・コードブロックは付けない）
- 出力フィールド:
${outputFields.join('\n')}
- 各フィールドは日本語の自然な文章（1〜3文程度、必要に応じて箇条書き可）
- 入力にない情報は推測で補完しない。不明な点は記載しない
- 薬剤師が薬歴ソフトへ転記しやすい、簡潔で専門的な文体を用いる

${SOAP_SECTION_CRITERIA}

## 参考例（入力 → 期待出力）
以下の例に従い、同じ情報の S/O 分類基準で出力すること。

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

上記メモを SOAP 形式の JSON に整形してください。`;
}
