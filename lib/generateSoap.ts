import type { ClinicalData } from '../types.ts';
import { getGeminiModel } from './geminiClient.ts';
import {
  buildSoapPrompt,
  buildSoapUserMessage,
  DEFAULT_SOAP_PROMPT_CONFIG,
} from './soapPrompt.ts';

const TIMEOUT_MS = 30_000;

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

export class SoapGenerationError extends Error {
  code: 'API_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'EMPTY_INPUT' | 'INVALID_OUTPUT';
  originalError?: unknown;

  constructor(
    message: string,
    code: 'API_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'EMPTY_INPUT' | 'INVALID_OUTPUT',
    originalError?: unknown,
  ) {
    super(message);
    this.name = 'SoapGenerationError';
    this.code = code;
    this.originalError = originalError;
  }
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

function validateInput(bulletInput: string): string {
  const trimmed = bulletInput.trim();
  if (!trimmed) {
    throw new SoapGenerationError('入力が空です', 'EMPTY_INPUT');
  }
  if (trimmed.length < 10) {
    throw new SoapGenerationError('入力が短すぎます', 'EMPTY_INPUT');
  }
  return trimmed;
}

function parseSoapResponse(text: string): GeneratedSoap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SoapGenerationError('AIレスポンスのパースに失敗', 'PARSE_ERROR', error);
  }
  if (!isGeneratedSoap(parsed)) {
    throw new SoapGenerationError('AIレスポンスのフォーマットが不正', 'INVALID_OUTPUT');
  }
  return parsed;
}

/**
 * 箇条書きメモから SOAP 4セクションを Gemini structured output で生成する。
 */
export async function generateSoap(input: GenerateSoapInput): Promise<GeneratedSoap> {
  const trimmedInput = validateInput(input.bulletInput);

  const config = DEFAULT_SOAP_PROMPT_CONFIG;
  const { systemPrompt, jsonSchema } = buildSoapPrompt(config);
  const userMessage = buildSoapUserMessage(trimmedInput, input.patientContext);

  const model = getGeminiModel();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new SoapGenerationError('SOAP生成がタイムアウトしました（30秒）', 'TIMEOUT')),
      TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      model.generateContent({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: jsonSchema,
          temperature: 0.3,
        },
      }),
      timeoutPromise,
    ]);

    const text = result.response.text();
    if (!text) {
      throw new SoapGenerationError('AIレスポンスのフォーマットが不正', 'INVALID_OUTPUT');
    }

    return parseSoapResponse(text);
  } catch (error) {
    if (error instanceof SoapGenerationError) {
      throw error;
    }
    throw new SoapGenerationError('API呼び出しエラー', 'API_ERROR', error);
  }
}
