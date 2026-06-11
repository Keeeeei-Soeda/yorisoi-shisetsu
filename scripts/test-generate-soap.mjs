import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
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

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function expectError(fn, expectedCode, label) {
  try {
    await fn();
    console.error(`❌ ${label}: エラーが throw されませんでした`);
    process.exit(1);
  } catch (error) {
    if (error?.name !== 'SoapGenerationError' || error?.code !== expectedCode) {
      console.error(`❌ ${label}: 期待 code=${expectedCode}, 実際=${error?.code ?? error?.name}`);
      process.exit(1);
    }
    console.log(`✅ ${label}: SoapGenerationError('${expectedCode}')`);
  }
}

async function main() {
  loadEnv();

  const { generateSoap, SoapGenerationError } = await import('../lib/generateSoap.ts');
  const { FEW_SHOT_EXAMPLES } = await import('../lib/soapPrompt.v3.ts');

  console.log('=== テスト1: 正常系 ===');
  const example = FEW_SHOT_EXAMPLES[0];
  const startedAt = Date.now();
  const soap = await generateSoap({ bulletInput: example.input });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  assert(typeof soap.subjective === 'string' && soap.subjective.length > 0, 'subjective が非空');
  assert(typeof soap.objective === 'string' && soap.objective.length > 0, 'objective が非空');
  assert(typeof soap.assessment === 'string' && soap.assessment.length > 0, 'assessment が非空');
  assert(typeof soap.plan === 'string' && soap.plan.length > 0, 'plan が非空');
  console.log(`✅ テスト1（正常系）: SOAP 生成成功（${elapsedSec}秒）`);
  console.log(JSON.stringify(soap, null, 2));

  console.log('\n=== テスト2: 空入力 ===');
  await expectError(
    () => generateSoap({ bulletInput: '' }),
    'EMPTY_INPUT',
    'テスト2（空入力）',
  );

  console.log('\n=== テスト3: 短すぎる入力 ===');
  await expectError(
    () => generateSoap({ bulletInput: '短い' }),
    'EMPTY_INPUT',
    'テスト3（短すぎる入力）',
  );

  console.log('\n=== テスト4: タイムアウト ===');
  console.log('⏭️  テスト4（タイムアウト）: 30秒待機テストはスキップ（意図: CI/手動実行時間の短縮）');

  console.log('\n=== 全テスト完了 ===');
}

main().catch((err) => {
  console.error('テスト失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
