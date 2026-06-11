import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.0-flash';

function loadApiKey() {
  const envPath = resolve('.env.local');
  if (!existsSync(envPath)) {
    console.error('エラー: .env.local が見つかりません');
    console.error('プロジェクトルートに .env.local を作成し、GEMINI_API_KEY=... を設定してください');
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key.trim() === 'GEMINI_API_KEY') {
      const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  }

  console.error('エラー: .env.local に GEMINI_API_KEY が設定されていません');
  process.exit(1);
}

async function main() {
  const apiKey = loadApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });

  console.log(`Gemini API に接続中... (model: ${DEFAULT_MODEL})`);
  const result = await model.generateContent('Hello, can you respond in Japanese?');
  const text = result.response.text();

  if (!text) {
    console.error('接続失敗: 空のレスポンスが返されました');
    process.exit(1);
  }

  console.log('接続成功! レスポンス:');
  console.log(text);
}

main().catch((err) => {
  console.error('接続失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
