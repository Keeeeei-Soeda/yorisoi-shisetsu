import type { ClinicalData } from '../types.ts';

/**
 * クイックSOAP（4セクションのみ生成版）専用のテキスト整形関数。
 *
 * 既存の buildSoapText（App.tsx 内、ClinicalData 全体を要求）とは
 * 別物として実装。pharmacy_focus / alerts / meta を含まないため、
 * 空欄が出ない簡潔な出力になる。
 *
 * 将来 F-10（薬剤・Red Flags 抽出）対応時には buildQuickSoapTextFull を別途追加予定。
 */
export const buildQuickSoapText = (
  patientName: string,
  date: string,
  soap: ClinicalData['soap'],
): string => {
  return `【SOAP】
患者: ${patientName} / 日付: ${date}

S:
${soap.subjective}

O:
${soap.objective}

A:
${soap.assessment}

P:
${soap.plan}`;
};
