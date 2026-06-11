import React, { useMemo, useState } from 'react';
import { FACILITIES } from '../data/rounds';
import { audioToSoap, AudioToSoapError } from '../lib/audioToSoap.ts';
import { buildQuickSoapText } from '../lib/formatters.ts';
import {
  createQuickSoapRecord,
  saveQuickSoap,
  updateQuickSoap,
} from '../lib/quickSoapStorage.ts';
import type { ClinicalData } from '../types';
import { QuickSoapEditor } from './QuickSoapEditor';
import { VoiceRecorder } from './VoiceRecorder';
import { VoiceRecorderError } from '../lib/voiceRecorder.ts';

const todayIso = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function formatRecordingLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `[音声録音 ${minutes}分${seconds}秒]`;
  }
  return `[音声録音 ${seconds}秒]`;
}

export interface RecordingPanelProps {
  onToast: (message: string, type?: 'success' | 'info') => void;
}

export const RecordingPanel: React.FC<RecordingPanelProps> = ({ onToast }) => {
  const [facilityId, setFacilityId] = useState(FACILITIES[0]?.id ?? '');
  const [patientMode, setPatientMode] = useState<'roster' | 'new'>('roster');
  const [rosterPatientId, setRosterPatientId] = useState('');
  const [patientNameOverride, setPatientNameOverride] = useState('');
  const [date, setDate] = useState(todayIso);
  const [loading, setLoading] = useState(false);
  const [baselineSoap, setBaselineSoap] = useState<ClinicalData['soap'] | null>(null);
  const [editedSoap, setEditedSoap] = useState<ClinicalData['soap'] | null>(null);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [recorderKey, setRecorderKey] = useState(0);

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

  const formLocked = loading || Boolean(editedSoap);

  const resolveAudioToSoapErrorMessage = (error: AudioToSoapError): string => {
    if (error.code === 'TIMEOUT') {
      return 'SOAP生成がタイムアウトしました。通信環境を確認して再試行してください。';
    }
    if (error.code === 'EMPTY_AUDIO') {
      return '音声データが空です。もう一度録音してください。';
    }
    if (error.code === 'TOO_LARGE') {
      return '音声ファイルが大きすぎます。3分以内で録音してください。';
    }
    if (error.code === 'API_ERROR') {
      return `Gemini API エラー: ${error.message.replace(/^API呼び出しエラー$/, '接続に失敗しました')}`;
    }
    return error.message;
  };

  const resolveRecorderErrorMessage = (error: Error): string => {
    if (error instanceof VoiceRecorderError) {
      return error.message;
    }
    return error.message || '録音中にエラーが発生しました。';
  };

  const runAudioToSoap = async (audioBlob: Blob, durationMs: number) => {
    setLoading(true);
    setRecordedAudio(audioBlob);
    setRecordedDurationMs(durationMs);

    try {
      const soap = await audioToSoap({
        audioBlob,
        patientContext,
      });
      setBaselineSoap(soap);
      setEditedSoap(soap);
      setSavedRecordId(null);
      onToast('SOAP を生成しました', 'success');
    } catch (error) {
      if (error instanceof AudioToSoapError) {
        onToast(resolveAudioToSoapErrorMessage(error), 'info');
      } else {
        onToast('予期しないエラーが発生しました', 'info');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecordingComplete = async (audio: Blob, durationMs: number) => {
    await runAudioToSoap(audio, durationMs);
  };

  const handleRetryGenerate = async () => {
    if (!recordedAudio) {
      onToast('再試行する録音データがありません', 'info');
      return;
    }
    await runAudioToSoap(recordedAudio, recordedDurationMs);
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
      bulletInput: formatRecordingLabel(recordedDurationMs),
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
    setRecordedAudio(null);
    setRecordedDurationMs(0);
    setRecorderKey((key) => key + 1);
    onToast('録音と生成結果をクリアしました', 'info');
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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-2xl font-bold text-gray-900">録音から SOAP 作成</h2>
        <p className="text-sm text-gray-500 mt-1">
          訪問先・患者を選び、会話を録音すると AI が SOAP 4セクションに整形します。
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600">1. 訪問先</label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-500"
              value={facilityId}
              disabled={formLocked}
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
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-500"
              value={date}
              disabled={formLocked}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600">2. 患者選択</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={formLocked}
              onClick={() => setPatientMode('roster')}
              className={`px-3 py-1.5 text-sm rounded border disabled:opacity-50 ${
                patientMode === 'roster'
                  ? 'bg-teal-500 text-white border-teal-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              名簿から選択
            </button>
            <button
              type="button"
              disabled={formLocked}
              onClick={() => setPatientMode('new')}
              className={`px-3 py-1.5 text-sm rounded border disabled:opacity-50 ${
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
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-500"
              value={rosterPatientId}
              disabled={formLocked}
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
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="患者名を入力（例: 山田 太郎）"
              value={patientNameOverride}
              disabled={formLocked}
              onChange={(e) => setPatientNameOverride(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600">4. 録音</label>
          {!editedSoap && !recordedAudio && (
            <VoiceRecorder
              key={recorderKey}
              disabled={loading || formLocked}
              onComplete={handleRecordingComplete}
              onError={(error) => onToast(resolveRecorderErrorMessage(error), 'info')}
              onCancel={() => onToast('録音を破棄しました', 'info')}
            />
          )}
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 flex flex-col items-center gap-3 text-gray-600">
          <div className="h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">SOAP を生成中... 約30秒</p>
          <p className="text-xs text-gray-500">音声を解析しています。しばらくお待ちください。</p>
        </div>
      )}

      {!loading && recordedAudio && !editedSoap && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm p-5 space-y-3">
          <p className="text-sm text-amber-900">
            SOAP の生成に失敗しました。録音データは保持されています。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRetryGenerate}
              className="px-4 py-2 text-sm font-bold rounded border shadow-sm bg-teal-500 text-white border-teal-600"
            >
              SOAP生成を再試行
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-2 text-sm font-medium rounded border bg-white text-gray-700 border-gray-200"
            >
              クリア
            </button>
          </div>
        </div>
      )}

      {!loading && editedSoap && baselineSoap && (
        <div className="space-y-4">
          <QuickSoapEditor value={editedSoap} baseline={baselineSoap} onChange={setEditedSoap} />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-sm font-bold rounded border shadow-sm bg-teal-500 text-white border-teal-600"
            >
              保存
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-2 text-sm font-medium rounded border bg-gray-100 text-gray-600 border-gray-200"
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
