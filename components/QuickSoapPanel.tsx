import React, { useMemo, useState } from 'react';
import { FACILITIES } from '../data/rounds';
import { buildQuickSoapText } from '../lib/formatters.ts';
import { generateSoap, SoapGenerationError } from '../lib/generateSoap.ts';
import {
  createQuickSoapRecord,
  saveQuickSoap,
  updateQuickSoap,
} from '../lib/quickSoapStorage.ts';
import type { ClinicalData } from '../types';
import { QuickSoapEditor } from './QuickSoapEditor';

const BULLET_PLACEHOLDER = `- 80代女性、特養入居、要介護4
- 処方: アムロジピン5mg 1日1回 朝食後
- 介護スタッフより：便秘増悪、食事量低下
- 残薬確認: 約14日分蓄積
- 看護師と排便コントロール相談予定`;

const todayIso = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export interface QuickSoapPanelProps {
  onToast: (message: string, type?: 'success' | 'info') => void;
}

export const QuickSoapPanel: React.FC<QuickSoapPanelProps> = ({ onToast }) => {
  const [facilityId, setFacilityId] = useState(FACILITIES[0]?.id ?? '');
  const [patientMode, setPatientMode] = useState<'roster' | 'new'>('roster');
  const [rosterPatientId, setRosterPatientId] = useState('');
  const [patientNameOverride, setPatientNameOverride] = useState('');
  const [date, setDate] = useState(todayIso);
  const [bulletInput, setBulletInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [baselineSoap, setBaselineSoap] = useState<ClinicalData['soap'] | null>(null);
  const [editedSoap, setEditedSoap] = useState<ClinicalData['soap'] | null>(null);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);

  const facility = useMemo(
    () => FACILITIES.find((f) => f.id === facilityId) ?? null,
    [facilityId],
  );

  const patientLabel = useMemo(() => {
    if (patientMode === 'new') {
      return patientNameOverride.trim() || '新規患者（未登録）';
    }
    const roster = facility?.roster.find((p) => p.id === rosterPatientId);
    return roster?.name ?? '患者未選択';
  }, [patientMode, patientNameOverride, rosterPatientId, facility]);

  const patientContext = useMemo(
    () => ({
      name: patientLabel,
      facility: facility?.name,
    }),
    [patientLabel, facility],
  );

  const copyText = useMemo(() => {
    if (!editedSoap) return '';
    return buildQuickSoapText(patientLabel, date, editedSoap);
  }, [editedSoap, patientLabel, date]);

  const resolveSoapErrorMessage = (error: SoapGenerationError): string => {
    if (error.code === 'TIMEOUT') {
      return 'SOAP生成がタイムアウトしました。通信環境を確認して再試行してください。';
    }
    if (error.code === 'EMPTY_INPUT') {
      return error.message;
    }
    if (error.message.includes('ネットワーク')) {
      return error.message;
    }
    if (error.code === 'API_ERROR') {
      return `Gemini API エラー: ${error.message.replace(/^API呼び出しエラー$/, '接続に失敗しました')}`;
    }
    return error.message;
  };

  const runGenerate = async () => {
    setLoading(true);
    try {
      const soap = await generateSoap({
        bulletInput,
        patientContext,
      });
      setBaselineSoap(soap);
      setEditedSoap(soap);
      setSavedRecordId(null);
      onToast('SOAP を生成しました', 'success');
    } catch (error) {
      if (error instanceof SoapGenerationError) {
        onToast(resolveSoapErrorMessage(error), 'info');
      } else {
        onToast('予期しないエラーが発生しました', 'info');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!editedSoap || !baselineSoap) {
      onToast('保存する SOAP がありません', 'info');
      return;
    }

    const payload = {
      facilityId: facilityId || null,
      rosterPatientId: patientMode === 'roster' && rosterPatientId ? rosterPatientId : null,
      patientNameOverride:
        patientMode === 'new' && patientNameOverride.trim()
          ? patientNameOverride.trim()
          : undefined,
      date,
      bulletInput: bulletInput.trim(),
      soap: editedSoap,
    };

    if (savedRecordId) {
      const updated = updateQuickSoap(savedRecordId, payload);
      if (!updated) {
        onToast('保存に失敗しました', 'info');
        return;
      }
      onToast('SOAP を更新しました', 'success');
      return;
    }

    const record = createQuickSoapRecord(payload);
    saveQuickSoap(record);
    setSavedRecordId(record.id);
    onToast('SOAP を保存しました', 'success');
  };

  const handleClear = () => {
    setBaselineSoap(null);
    setEditedSoap(null);
    setSavedRecordId(null);
    setBulletInput('');
    onToast('入力と生成結果をクリアしました', 'info');
  };

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      onToast('コピーしました', 'success');
    } catch {
      onToast('クリップボードへのコピーに失敗しました', 'info');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-2xl font-bold text-gray-900">メモから SOAP 作成</h2>
        <p className="text-sm text-gray-500 mt-1">
          訪問メモ（箇条書き）を入力し、AI が SOAP 4セクションに整形します。
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600">1. 訪問先</label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 md:py-2 md:text-sm"
              value={facilityId}
              onChange={(e) => {
                setFacilityId(e.target.value);
                setRosterPatientId('');
              }}
            >
              {FACILITIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600">3. 訪問日</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 md:py-2 md:text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600">2. 患者選択</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPatientMode('roster')}
              className={`min-h-[44px] rounded border px-3 py-2.5 text-sm md:min-h-0 md:py-1.5 ${
                patientMode === 'roster'
                  ? 'bg-teal-500 text-white border-teal-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              名簿から選択
            </button>
            <button
              type="button"
              onClick={() => setPatientMode('new')}
              className={`min-h-[44px] rounded border px-3 py-2.5 text-sm md:min-h-0 md:py-1.5 ${
                patientMode === 'new'
                  ? 'bg-teal-500 text-white border-teal-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              新規・未登録
            </button>
          </div>

          {patientMode === 'roster' ? (
            <select
              className="w-full border border-gray-300 rounded px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 md:py-2 md:text-sm"
              value={rosterPatientId}
              onChange={(e) => setRosterPatientId(e.target.value)}
            >
              <option value="">患者を選択してください</option>
              {facility?.roster.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                  {patient.room ? ` (${patient.room}号室)` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="w-full border border-gray-300 rounded px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 md:py-2 md:text-sm"
              placeholder="患者名を入力（例: 山田 太郎）"
              value={patientNameOverride}
              onChange={(e) => setPatientNameOverride(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600">4. 箇条書きメモ</label>
          <textarea
            className="w-full min-h-[180px] rounded-lg border border-gray-300 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 md:py-2 md:text-sm"
            placeholder={BULLET_PLACEHOLDER}
            value={bulletInput}
            onChange={(e) => setBulletInput(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={runGenerate}
          disabled={loading || bulletInput.trim().length < 10}
          className="min-h-[44px] rounded border px-4 py-3 text-sm font-bold shadow-sm md:min-h-0 md:py-2 bg-teal-500 text-white border-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '生成中…' : 'SOAP生成'}
        </button>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 flex flex-col items-center gap-3 text-gray-600">
          <div className="h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">生成中…（最大30秒）</p>
        </div>
      )}

      {!loading && editedSoap && baselineSoap && (
        <div className="space-y-4">
          <QuickSoapEditor value={editedSoap} baseline={baselineSoap} onChange={setEditedSoap} />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="min-h-[44px] rounded border px-4 py-3 text-sm font-bold shadow-sm md:min-h-0 md:py-2 bg-teal-500 text-white border-teal-600"
            >
              保存
            </button>
            <button
              type="button"
              onClick={runGenerate}
              className="min-h-[44px] rounded border px-4 py-3 text-sm font-medium md:min-h-0 md:py-2 bg-white text-gray-700 border-gray-200"
            >
              再生成
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[44px] rounded border px-4 py-3 text-sm font-medium md:min-h-0 md:py-2 bg-gray-100 text-gray-600 border-gray-200"
            >
              クリア
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-gray-700">SOAP形式（コピー用）</h3>
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 text-xs font-bold rounded border bg-teal-50 text-teal-700 border-teal-200"
              >
                コピー
              </button>
            </div>
            <textarea
              readOnly
              className="w-full h-56 text-sm bg-gray-50 p-3 rounded border border-gray-200 focus:outline-none"
              value={copyText}
            />
          </div>
        </div>
      )}
    </div>
  );
};
