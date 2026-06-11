import type { ClinicalData } from '../types.ts';
import { getGeminiModel } from './geminiClient.ts';
import {
  buildSoapPrompt,
  buildSoapUserMessage,
  DEFAULT_SOAP_PROMPT_CONFIG,
} from './soapPrompt.ts';
import type { SoapPromptConfig } from './soapPrompt.ts';

/** SOAP 生成のタイムアウト（要件: 30秒以内） */
export const GENERATE_SOAP_TIMEOUT_MS = 30_000;

export interface GenerateSoapInput {
  bulletInput: string;
  patientContext?: {
    name?: string;
    facility?: string;
    age?: number;
    conditions?: string[];
  };
}

export type GeneratedSoap = ClinicalData['soap'];

export interface GenerateSoapOptions {
  promptConfig?: SoapPromptConfig;
  timeoutMs?: number;
}

function isGeneratedSoap(value: unknown): value is GeneratedSoap {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.subjective === 'string' &&
    typeof record.objective === 'string' &&
    typeof record.assessment === 'string' &&
    typeof record.plan === 'string'
  );
}

function parseSoapResponse(text: string): GeneratedSoap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini API のレスポンスを JSON として解析できませんでした');
  }
  if (!isGeneratedSoap(parsed)) {
    throw new Error(
      'Gemini API のレスポンスが SOAP 形式（subjective / objective / assessment / plan）と一致しません',
    );
  }
  return parsed;
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`SOAP 生成が ${timeoutMs / 1000} 秒以内に完了しませんでした`);
  error.name = 'GenerateSoapTimeoutError';
  return error;
}

function isNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('socket')
  );
}

function wrapGenerateSoapError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === 'GenerateSoapTimeoutError') return error;
    if (error.message.includes('GEMINI_API_KEY')) return error;
    if (error.message.includes('箇条書きメモが空')) return error;
    if (error.message.includes('JSON として解析') || error.message.includes('SOAP 形式')) return error;

    if (isNetworkError(error.message)) {
      return new Error(`ネットワークエラー: Gemini API に接続できませんでした（${error.message}）`);
    }

    return new Error(`Gemini API エラー: ${error.message}`);
  }
  return new Error('SOAP 生成中に不明なエラーが発生しました');
}

/**
 * 箇条書きメモから SOAP 4セクションを Gemini structured output で生成する。
 */
export async function generateSoap(
  input: GenerateSoapInput,
  options: GenerateSoapOptions = {},
): Promise<GeneratedSoap> {
  const trimmedInput = input.bulletInput.trim();
  if (!trimmedInput) {
    throw new Error('箇条書きメモが空です');
  }

  const promptConfig = options.promptConfig ?? DEFAULT_SOAP_PROMPT_CONFIG;
  const timeoutMs = options.timeoutMs ?? GENERATE_SOAP_TIMEOUT_MS;
  const { systemPrompt, jsonSchema } = buildSoapPrompt(promptConfig);
  const userMessage = buildSoapUserMessage(trimmedInput, input.patientContext);

  const model = getGeminiModel();
  const generatePromise = model.generateContent({
    contents: [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'user', parts: [{ text: userMessage }] },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: jsonSchema,
    },
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    const result = await Promise.race([generatePromise, timeoutPromise]);
    const text = result.response.text();
    if (!text) {
      throw new Error('Gemini API から空のレスポンスが返されました');
    }
    return parseSoapResponse(text);
  } catch (error) {
    throw wrapGenerateSoapError(error);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
