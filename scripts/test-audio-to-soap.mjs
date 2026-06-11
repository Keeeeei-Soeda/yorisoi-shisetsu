import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';

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

function guessMimeType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.webm':
      return 'audio/webm';
    case '.mp4':
    case '.m4a':
      return 'audio/mp4';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
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
    if (error?.name !== 'AudioToSoapError' || error?.code !== expectedCode) {
      console.error(`❌ ${label}: 期待 code=${expectedCode}, 実際=${error?.code ?? error?.name}`);
      process.exit(1);
    }
    console.log(`✅ ${label}: AudioToSoapError('${expectedCode}')`);
  }
}

async function main() {
  const audioPathArg = process.argv[2];

  loadEnv();

  const { audioToSoap, AudioToSoapError } = await import('../lib/audioToSoap.ts');

  console.log('=== テスト1: 空音声 ===');
  await expectError(
    () => audioToSoap({ audioBlob: new Blob([], { type: 'audio/webm' }) }),
    'EMPTY_AUDIO',
    'テスト1（空音声）',
  );

  console.log('\n=== テスト2: サイズ超過 ===');
  const oversized = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'audio/webm' });
  await expectError(
    () => audioToSoap({ audioBlob: oversized }),
    'TOO_LARGE',
    'テスト2（サイズ超過）',
  );

  if (!audioPathArg) {
    console.log('\n=== テスト3: 実音声（スキップ） ===');
    console.log('⏭️  音声ファイル未指定のためスキップ');
    console.log('   使い方: npm run test:audio-to-soap -- ./fixtures/sample-recording.webm');
    console.log('\n=== バリデーションテスト完了 ===');
    return;
  }

  const audioPath = resolve(audioPathArg);
  if (!existsSync(audioPath)) {
    console.error(`❌ 音声ファイルが見つかりません: ${audioPath}`);
    console.error('   fixtures/sample-recording.webm を配置してから再実行してください。');
    process.exit(1);
  }

  console.log('\n=== テスト3: 実音声 → SOAP 生成 ===');
  const buffer = readFileSync(audioPath);
  const mimeType = guessMimeType(audioPath);
  const audioBlob = new Blob([buffer], { type: mimeType });

  console.log(`   ファイル: ${audioPath}`);
  console.log(`   サイズ: ${(audioBlob.size / 1024).toFixed(1)} KB`);
  console.log(`   MIME: ${mimeType}`);

  const startedAt = Date.now();
  const soap = await audioToSoap({
    audioBlob,
    patientContext: {
      name: '田中 健',
      facility: 'さくら苑',
    },
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  assert(typeof soap.subjective === 'string' && soap.subjective.length > 0, 'subjective が非空');
  assert(typeof soap.objective === 'string' && soap.objective.length > 0, 'objective が非空');
  assert(typeof soap.assessment === 'string' && soap.assessment.length > 0, 'assessment が非空');
  assert(typeof soap.plan === 'string' && soap.plan.length > 0, 'plan が非空');
  console.log(`✅ テスト3（実音声）: SOAP 生成成功（${elapsedSec}秒）`);
  console.log(JSON.stringify(soap, null, 2));

  if (!(AudioToSoapError.prototype instanceof Error)) {
    console.error('❌ AudioToSoapError の定義が不正です');
    process.exit(1);
  }

  console.log('\n=== 全テスト完了 ===');
}

main().catch((err) => {
  console.error('テスト失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
