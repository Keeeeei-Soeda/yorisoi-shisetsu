import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

async function main(): Promise<void> {
  loadEnv();

  const { generateSoap } = await import('../lib/generateSoap.ts');
  const { FEW_SHOT_EXAMPLES } = await import('../lib/soapPrompt.ts');

  const example = FEW_SHOT_EXAMPLES[0];
  console.log(`SOAP 生成テスト（Few-shot 例1: ${example.title}）`);
  console.log('--- 入力 ---');
  console.log(example.input);
  console.log('--- 生成中... ---');

  const startedAt = Date.now();
  const soap = await generateSoap({ bulletInput: example.input });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`--- 生成完了（${elapsedSec}秒） ---`);
  console.log(JSON.stringify(soap, null, 2));
}

main().catch((err) => {
  console.error('テスト失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
