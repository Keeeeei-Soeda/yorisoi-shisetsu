import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { ClinicalData } from '../types.ts';

type Soap = ClinicalData['soap'];

interface PlanActions {
  ep: string[];
  cp: string[];
  op: string[];
}

interface CaseEvaluation {
  caseIndex: number;
  title: string;
  elapsedSec: number;
  speakerTags: { pass: boolean; expected: string[]; missing: string[]; extra: string[] };
  drugNames: { pass: boolean; expected: string[]; missing: string[] };
  epCpOp: { pass: boolean; mismatches: string[] };
  primaryProblem: { pass: boolean; expected: string; actualHint: string };
  wordingDiffs: string[];
  generated: Soap;
}

function loadEnv(): void {
  const envPath = resolve('.env.local');
  if (!existsSync(envPath)) {
    console.error('エラー: .env.local が見つかりません');
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key.trim() === 'GEMINI_API_KEY') {
      const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (value) {
        process.env.GEMINI_API_KEY = value;
        process.env.API_KEY = value;
        return;
      }
    }
  }

  console.error('エラー: .env.local に GEMINI_API_KEY が設定されていません');
  process.exit(1);
}

function extractSpeakerTags(text: string): string[] {
  const matches = text.match(/\[[^\]]+\]/g) ?? [];
  return [...new Set(matches)].sort();
}

/** 主体タグの同義グループ（再現テスト用。入力が「介護スタッフ」でも [スタッフ] と同等とみなす） */
const SPEAKER_TAG_ALIASES: Record<string, string> = {
  '[介護スタッフ]': '[スタッフ]',
  '[介護士]': '[スタッフ]',
};

function normalizeSpeakerTag(tag: string): string {
  return SPEAKER_TAG_ALIASES[tag] ?? tag;
}

function normalizeSpeakerTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeSpeakerTag))].sort();
}

function extractDrugNames(objective: string): string[] {
  const drugs: string[] = [];
  const lines = objective.split('\n');
  for (const line of lines) {
    if (!line.includes('処方:')) continue;
    const prescription = line.replace(/^-\s*処方:\s*/, '');
    const parts = prescription.split(/[、,]/);
    for (const part of parts) {
      const trimmed = part.trim();
      const nameMatch = trimmed.match(/^(.+?)(?:\d+(?:\.\d+)?mg|\d+g|\d+錠)/);
      if (nameMatch) {
        drugs.push(nameMatch[1].trim());
      }
    }
  }
  return drugs;
}

function extractPlanActions(plan: string): PlanActions {
  const ep: string[] = [];
  const cp: string[] = [];
  const op: string[] = [];

  for (const line of plan.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- Ep:')) ep.push(trimmed.replace(/^- Ep:\s*/, ''));
    else if (trimmed.startsWith('- Cp:')) cp.push(trimmed.replace(/^- Cp:\s*/, ''));
    else if (trimmed.startsWith('- Op:')) op.push(trimmed.replace(/^- Op:\s*/, ''));
  }

  return { ep, cp, op };
}

function normalizeAction(text: string): string {
  return text
    .replace(/（実行済み）/g, '')
    .replace(/\s+/g, '')
    .slice(0, 24);
}

function comparePlanActions(expected: PlanActions, actual: PlanActions): string[] {
  const mismatches: string[] = [];

  const compareCategory = (label: 'Ep' | 'Cp' | 'Op', exp: string[], act: string[]) => {
    if (exp.length !== act.length) {
      mismatches.push(`${label} 件数不一致: 期待${exp.length}件 / 出力${act.length}件`);
    }
    const maxLen = Math.max(exp.length, act.length);
    for (let i = 0; i < maxLen; i++) {
      const e = exp[i];
      const a = act[i];
      if (!e || !a) continue;
      const eNorm = normalizeAction(e);
      const aNorm = normalizeAction(a);
      if (!aNorm.includes(eNorm.slice(0, 12)) && !eNorm.includes(aNorm.slice(0, 12))) {
        mismatches.push(`${label}[${i + 1}] 分類または内容相違:\n  期待: ${e}\n  出力: ${a}`);
      }
    }
  };

  compareCategory('Ep', expected.ep, actual.ep);
  compareCategory('Cp', expected.cp, actual.cp);
  compareCategory('Op', expected.op, actual.op);

  return mismatches;
}

function checkPrimaryProblem(
  expectedAssessment: string,
  actualAssessment: string,
  primaryProblem: string,
): { pass: boolean; actualHint: string } {
  const firstExpectedLine = expectedAssessment
    .split('\n')
    .find((l) => l.trim().startsWith('-'))
    ?.replace(/^-\s*/, '')
    .trim();

  const keyPhrase =
    primaryProblem.length > 20 ? primaryProblem.slice(0, 20) : primaryProblem;
  const actualFirst = actualAssessment
    .split('\n')
    .find((l) => l.trim().startsWith('-'))
    ?.replace(/^-\s*/, '')
    .trim();

  const pass =
    actualAssessment.includes('主プロブレム') &&
    (actualAssessment.includes(keyPhrase) ||
      (firstExpectedLine !== undefined &&
        actualFirst !== undefined &&
        normalizeAction(actualFirst).includes(normalizeAction(firstExpectedLine).slice(0, 16))));

  return { pass, actualHint: actualFirst ?? '（A 先頭行なし）' };
}

function isSpeakerTagAliasDiff(expectedLine: string, actualLine: string): boolean {
  const normalizeLineTags = (line: string) =>
    line.replace(/\[[^\]]+\]/g, (tag) => normalizeSpeakerTag(tag));
  return normalizeLineTags(expectedLine) === normalizeLineTags(actualLine);
}

function findWordingDiffs(expected: Soap, actual: Soap): string[] {
  const diffs: string[] = [];

  const compareField = (field: keyof Soap, label: string) => {
    const expLines = expected[field].split('\n').map((l) => l.trim()).filter(Boolean);
    const actLines = actual[field].split('\n').map((l) => l.trim()).filter(Boolean);

    if (expLines.length !== actLines.length) {
      diffs.push(`${label}: 行数相違（期待${expLines.length} / 出力${actLines.length}）`);
    }

    const maxLen = Math.max(expLines.length, actLines.length);
    for (let i = 0; i < maxLen; i++) {
      const e = expLines[i];
      const a = actLines[i];
      if (!e || !a) continue;
      if (e !== a) {
        if (field === 'subjective' && isSpeakerTagAliasDiff(e, a)) continue;
        diffs.push(`${label}[${i + 1}] 文言相違:\n  期待: ${e}\n  出力: ${a}`);
      }
    }
  };

  compareField('subjective', 'S');
  compareField('objective', 'O');
  compareField('assessment', 'A');
  compareField('plan', 'P');

  return diffs;
}

function evaluateCase(
  caseIndex: number,
  title: string,
  primaryProblem: string,
  expected: Soap,
  generated: Soap,
  elapsedSec: number,
): CaseEvaluation {
  const expectedTags = normalizeSpeakerTags(extractSpeakerTags(expected.subjective));
  const actualTags = normalizeSpeakerTags(extractSpeakerTags(generated.subjective));
  const missingTags = expectedTags.filter((t) => !actualTags.includes(t));
  const extraTags = actualTags.filter((t) => !expectedTags.includes(t));

  const expectedDrugs = extractDrugNames(expected.objective);
  const missingDrugs = expectedDrugs.filter((d) => !generated.objective.includes(d));

  const planMismatches = comparePlanActions(
    extractPlanActions(expected.plan),
    extractPlanActions(generated.plan),
  );

  const ppCheck = checkPrimaryProblem(
    expected.assessment,
    generated.assessment,
    primaryProblem,
  );

  const wordingDiffs = findWordingDiffs(expected, generated).filter(
    (d) => !d.includes('行数相違') || d.includes('文言相違'),
  );

  return {
    caseIndex,
    title,
    elapsedSec,
    speakerTags: {
      pass: missingTags.length === 0,
      expected: expectedTags,
      missing: missingTags,
      extra: extraTags,
    },
    drugNames: {
      pass: missingDrugs.length === 0,
      expected: expectedDrugs,
      missing: missingDrugs,
    },
    epCpOp: {
      pass: planMismatches.length === 0,
      mismatches: planMismatches,
    },
    primaryProblem: {
      pass: ppCheck.pass,
      expected: primaryProblem,
      actualHint: ppCheck.actualHint,
    },
    wordingDiffs,
    generated,
  };
}

function printCaseResult(ev: CaseEvaluation): void {
  const tagIcon = ev.speakerTags.pass ? '✅' : '❌';
  const drugIcon = ev.drugNames.pass ? '✅' : '❌';
  const planIcon = ev.epCpOp.pass ? '✅' : '❌';
  const ppIcon = ev.primaryProblem.pass ? '✅' : '❌';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Case ${ev.caseIndex + 1}: ${ev.title}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`生成時間: ${ev.elapsedSec.toFixed(1)}秒`);
  console.log(`${tagIcon} 主体タグ一致: ${ev.speakerTags.pass ? '合格' : '不合格'}`);
  if (!ev.speakerTags.pass) {
    console.log(`   不足: ${ev.speakerTags.missing.join(', ') || 'なし'}`);
    console.log(`   余分: ${ev.speakerTags.extra.join(', ') || 'なし'}`);
  }
  console.log(`   期待タグ: ${ev.speakerTags.expected.join(', ')}`);

  console.log(`${drugIcon} 薬剤名一致: ${ev.drugNames.pass ? '合格' : '不合格'}`);
  if (!ev.drugNames.pass) {
    console.log(`   不足: ${ev.drugNames.missing.join(', ')}`);
  }
  console.log(`   期待薬剤: ${ev.drugNames.expected.join(', ')}`);

  console.log(`${planIcon} Ep/Cp/Op 分類一致: ${ev.epCpOp.pass ? '合格' : '不合格'}`);
  if (!ev.epCpOp.pass) {
    for (const m of ev.epCpOp.mismatches) console.log(`   - ${m.replace(/\n/g, '\n     ')}`);
  }

  console.log(`${ppIcon} 主プロブレム特定: ${ev.primaryProblem.pass ? '合格' : '不合格'}`);
  console.log(`   期待: ${ev.primaryProblem.expected}`);
  console.log(`   出力A先頭: ${ev.primaryProblem.actualHint}`);

  if (ev.wordingDiffs.length > 0) {
    console.log(`⚠️  文言相違（意味同等の可能性あり）:`);
    for (const d of ev.wordingDiffs.slice(0, 8)) {
      console.log(`   - ${d.replace(/\n/g, '\n     ')}`);
    }
    if (ev.wordingDiffs.length > 8) {
      console.log(`   ... 他 ${ev.wordingDiffs.length - 8} 件`);
    }
  } else {
    console.log('⚠️  文言相違: なし（完全一致）');
  }

  const casePass =
    ev.speakerTags.pass && ev.drugNames.pass && ev.epCpOp.pass && ev.primaryProblem.pass;
  console.log(`\nケース判定: ${casePass ? '✅ 合格' : '❌ 不合格'}`);
}

async function main(): Promise<void> {
  loadEnv();

  const { generateSoap } = await import('../lib/generateSoap.ts');
  const { FEW_SHOT_EXAMPLES } = await import('../lib/soapPrompt.v3.ts');

  const evaluations: CaseEvaluation[] = [];

  for (let i = 0; i < FEW_SHOT_EXAMPLES.length; i++) {
    const example = FEW_SHOT_EXAMPLES[i];
    console.log(`\n>>> 生成中 Case ${i + 1}: ${example.title} ...`);

    const startedAt = Date.now();
    const generated = await generateSoap({ bulletInput: example.input });
    const elapsedSec = (Date.now() - startedAt) / 1000;

    const ev = evaluateCase(
      i,
      example.title,
      example.primaryProblem,
      example.expectedOutput,
      generated,
      elapsedSec,
    );
    evaluations.push(ev);
    printCaseResult(ev);
  }

  const totalChecks = evaluations.length * 4;
  const passedChecks = evaluations.reduce((sum, ev) => {
    return (
      sum +
      (ev.speakerTags.pass ? 1 : 0) +
      (ev.drugNames.pass ? 1 : 0) +
      (ev.epCpOp.pass ? 1 : 0) +
      (ev.primaryProblem.pass ? 1 : 0)
    );
  }, 0);

  const allCasesPass = evaluations.every(
    (ev) =>
      ev.speakerTags.pass &&
      ev.drugNames.pass &&
      ev.epCpOp.pass &&
      ev.primaryProblem.pass,
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log('サマリー');
  console.log(`${'='.repeat(60)}`);
  for (const ev of evaluations) {
    const pass =
      ev.speakerTags.pass &&
      ev.drugNames.pass &&
      ev.epCpOp.pass &&
      ev.primaryProblem.pass;
    console.log(`Case ${ev.caseIndex + 1} (${ev.title}): ${pass ? '✅ 合格' : '❌ 不合格'}`);
  }
  console.log(`\n全体一貫性スコア: ${passedChecks}/${totalChecks} 項目合格`);
  console.log(
    `総合判定: ${allCasesPass ? '✅ 全ケース合格' : passedChecks >= totalChecks * 0.75 ? '⚠️ 部分合格' : '❌ 不合格'}`,
  );

  if (!allCasesPass) {
    console.log('\n不合格項目の原因仮説:');
    for (const ev of evaluations) {
      if (!ev.speakerTags.pass) {
        console.log(`- Case ${ev.caseIndex + 1}: 主体タグ不足 → Few-shot の S 形式が出力に反映されていない可能性`);
      }
      if (!ev.drugNames.pass) {
        console.log(`- Case ${ev.caseIndex + 1}: 薬剤名欠落 → O の処方列挙ルールが未遵守、または省略`);
      }
      if (!ev.epCpOp.pass) {
        console.log(`- Case ${ev.caseIndex + 1}: Ep/Cp/Op 相違 → 他職種連携の Cp 判定が不安定`);
      }
      if (!ev.primaryProblem.pass) {
        console.log(`- Case ${ev.caseIndex + 1}: 主プロブレム不一致 → 1メモ=1プロブレム選定のブレ`);
      }
    }
  }

  process.exit(allCasesPass ? 0 : 1);
}

main().catch((err) => {
  console.error('テスト失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
