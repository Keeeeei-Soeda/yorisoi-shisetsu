import type { ClinicalData } from '../types.ts';
import { getGeminiModel } from './geminiClient.ts';
import {
  buildSoapPrompt,
  DEFAULT_SOAP_PROMPT_CONFIG,
} from './soapPrompt.ts';

const TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const AUDIO_USER_INSTRUCTIONS = `以下は訪問薬剤師と患者・介護者の会話音声です。
この会話から SOAP 形式の薬歴を生成してください。
- 会話に登場する薬剤名・用量・用法は可能な限り正確に O に記載
- 発言主体タグ [本人][家族][スタッフ][看護師] は音声から判断
- 訴え・症状の発言は S、薬剤師の確認事実は O
- 音声で聞き取れない部分は無理に補完しない`;

export interface AudioToSoapInput {
  audioBlob: Blob;
  patientContext?: {
    name?: string;
    facility?: string;
    age?: number;
    conditions?: string[];
  };
}

export type GeneratedSoap = ClinicalData['soap'];

export class AudioToSoapError extends Error {
  code: 'API_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'EMPTY_AUDIO' | 'TOO_LARGE' | 'INVALID_OUTPUT';
  originalError?: unknown;

  constructor(
    message: string,
    code: 'API_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'EMPTY_AUDIO' | 'TOO_LARGE' | 'INVALID_OUTPUT',
    originalError?: unknown,
  ) {
    super(message);
    this.name = 'AudioToSoapError';
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

function validateAudioBlob(blob: Blob): void {
  if (blob.size <= 0) {
    throw new AudioToSoapError('音声データが空です', 'EMPTY_AUDIO');
  }
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new AudioToSoapError(
      `音声ファイルが大きすぎます（上限 ${MAX_AUDIO_BYTES / (1024 * 1024)}MB）`,
      'TOO_LARGE',
    );
  }
}

function resolveMimeType(blob: Blob): string {
  const type = blob.type.trim();
  if (type.startsWith('audio/') || type.startsWith('video/')) {
    return type;
  }
  return 'audio/webm';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(arrayBuffer).toString('base64');
  }

  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildAudioSoapUserMessage(
  patientContext?: AudioToSoapInput['patientContext'],
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

  return `${contextBlock}${AUDIO_USER_INSTRUCTIONS}

上記音声から主プロブレムを1つ選定し、SOAP 形式の JSON に整形してください。`;
}

function parseSoapResponse(text: string): GeneratedSoap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AudioToSoapError('AIレスポンスのパースに失敗', 'PARSE_ERROR', error);
  }
  if (!isGeneratedSoap(parsed)) {
    throw new AudioToSoapError('AIレスポンスのフォーマットが不正', 'INVALID_OUTPUT');
  }
  return parsed;
}

/**
 * 会話音声から SOAP 4セクションを Gemini Audio + structured output で生成する。
 */
export async function audioToSoap(input: AudioToSoapInput): Promise<GeneratedSoap> {
  validateAudioBlob(input.audioBlob);

  const config = DEFAULT_SOAP_PROMPT_CONFIG;
  const { systemPrompt, jsonSchema } = buildSoapPrompt(config);
  const userMessage = buildAudioSoapUserMessage(input.patientContext);
  const mimeType = resolveMimeType(input.audioBlob);
  const base64Audio = await blobToBase64(input.audioBlob);

  const model = getGeminiModel();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new AudioToSoapError('SOAP生成がタイムアウトしました（60秒）', 'TIMEOUT')),
      TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      model.generateContent({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Audio } },
              { text: userMessage },
            ],
          },
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
      throw new AudioToSoapError('AIレスポンスのフォーマットが不正', 'INVALID_OUTPUT');
    }

    return parseSoapResponse(text);
  } catch (error) {
    if (error instanceof AudioToSoapError) {
      throw error;
    }
    throw new AudioToSoapError('API呼び出しエラー', 'API_ERROR', error);
  }
}
