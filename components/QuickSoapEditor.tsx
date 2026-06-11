import React from 'react';
import type { ClinicalData } from '../types';
import { SectionHeader } from './SectionHeader';

export type QuickSoapValue = ClinicalData['soap'];

interface SoapSectionConfig {
  key: keyof QuickSoapValue;
  letter: string;
  title: string;
  description: string;
  color: string;
}

const SOAP_SECTIONS: SoapSectionConfig[] = [
  {
    key: 'subjective',
    letter: 'S',
    title: 'Subjective（主観的情報）',
    description: '患者・家族・スタッフからの訴え。各項目に [本人][スタッフ] 等の主体タグを付ける',
    color: 'bg-sky-500',
  },
  {
    key: 'objective',
    letter: 'O',
    title: 'Objective（客観的情報）',
    description: '薬剤名・用量・用法、測定値、残薬確認など検証可能な事実',
    color: 'bg-rose-500',
  },
  {
    key: 'assessment',
    letter: 'A',
    title: 'Assessment（評価）',
    description: '薬剤師としての判断・解釈。S/O の再掲ではなく P の論理的根拠となる内容',
    color: 'bg-amber-500',
  },
  {
    key: 'plan',
    letter: 'P',
    title: 'Plan（計画）',
    description: 'Ep / Cp / Op 形式の箇条書き（- Ep: ... / - Cp: ... / - Op: ...）',
    color: 'bg-emerald-500',
  },
];

export interface QuickSoapEditorProps {
  value: QuickSoapValue;
  baseline: QuickSoapValue;
  onChange: (soap: QuickSoapValue) => void;
}

interface SoapSectionEditorProps {
  section: SoapSectionConfig;
  value: string;
  onChange: (next: string) => void;
}

const SoapSectionEditor: React.FC<SoapSectionEditorProps> = ({ section, value, onChange }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold text-white ${section.color}`}
        >
          {section.letter}
        </span>
        <div>
          <div className="text-sm font-bold text-gray-800">{section.title}</div>
          <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
        </div>
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap">{value.length} 文字</span>
    </div>
    <textarea
      className="w-full min-h-[140px] resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 text-base leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400 md:text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={section.title}
    />
  </div>
);

export const QuickSoapEditor: React.FC<QuickSoapEditorProps> = ({ value, baseline, onChange }) => {
  const isDirty =
    value.subjective !== baseline.subjective ||
    value.objective !== baseline.objective ||
    value.assessment !== baseline.assessment ||
    value.plan !== baseline.plan;

  const handleSectionChange = (key: keyof QuickSoapValue, next: string) => {
    onChange({ ...value, [key]: next });
  };

  const handleReset = () => {
    onChange({ ...baseline });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          title="SOAP 記録（編集可）"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          }
        />
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty}
          className={`px-3 py-2 text-sm font-medium rounded border transition ${
            isDirty
              ? 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50'
              : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
          }`}
        >
          AI出力にリセット
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {SOAP_SECTIONS.map((section) => (
          <SoapSectionEditor
            key={section.key}
            section={section}
            value={value[section.key]}
            onChange={(next) => handleSectionChange(section.key, next)}
          />
        ))}
      </div>
    </div>
  );
};
