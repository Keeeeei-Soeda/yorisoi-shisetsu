import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

/** デフォルトの生成モデル（SOAP 整形用途） */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

let client: GoogleGenerativeAI | null = null;

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'GEMINI_API_KEY が設定されていません。.env.local に GEMINI_API_KEY=your_key を追加してください。',
    );
  }
  return apiKey.trim();
}

/** GoogleGenerativeAI クライアント（シングルトン） */
export function getGeminiClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(getApiKey());
  }
  return client;
}

/** 指定モデルの GenerativeModel インスタンスを取得 */
export function getGeminiModel(modelName: string = DEFAULT_GEMINI_MODEL): GenerativeModel {
  return getGeminiClient().getGenerativeModel({ model: modelName });
}

/**
 * Gemini API 接続確認用。
 * 開発時は `npm run test:gemini` でも同様の確認が可能。
 */
export async function testGeminiConnection(): Promise<string> {
  const model = getGeminiModel();
  const result = await model.generateContent('Hello, can you respond in Japanese?');
  const text = result.response.text();
  if (!text) {
    throw new Error('Gemini API から空のレスポンスが返されました');
  }
  return text;
}
