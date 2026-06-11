import React, { useMemo, useState } from 'react';
import { FACILITIES } from '../data/rounds';
import { buildQuickSoapText } from '../lib/formatters.ts';
import {
  deleteQuickSoap,
  getQuickSoap,
  listQuickSoaps,
  updateQuickSoap,
} from '../lib/quickSoapStorage.ts';
import type { QuickSoapRecord } from '../types';
import { QuickSoapEditor } from './QuickSoapEditor';

export interface QuickSoapHistoryListProps {
  onToast: (message: string, type?: 'success' | 'info') => void;
}

function resolvePatientName(record: QuickSoapRecord): string {
  if (record.patientNameOverride) return record.patientNameOverride;
  if (record.rosterPatientId && record.facilityId) {
    const facility = FACILITIES.find((f) => f.id === record.facilityId);
    const roster = facility?.roster.find((p) => p.id === record.rosterPatientId);
    if (roster) return roster.name;
  }
  return '患者未設定';
}

function resolveFacilityName(facilityId: string | null): string {
  if (!facilityId) return '訪問先未設定';
  return FACILITIES.find((f) => f.id === facilityId)?.name ?? facilityId;
}

export const QuickSoapHistoryList: React.FC<QuickSoapHistoryListProps> = ({ onToast }) => {
  const [facilityFilter, setFacilityFilter] = useState('');
  const [patientFilter, setPatientFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editedSoap, setEditedSoap] = useState<QuickSoapRecord['soap'] | null>(null);
  const [baselineSoap, setBaselineSoap] = useState<QuickSoapRecord['soap'] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const records = useMemo(() => {
    void refreshKey;
    return listQuickSoaps({
      facilityId: facilityFilter || undefined,
      rosterPatientId: patientFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  }, [facilityFilter, patientFilter, dateFrom, dateTo, refreshKey]);

  const selectedRecord = useMemo(
    () => (selectedId ? getQuickSoap(selectedId) : null),
    [selectedId, refreshKey],
  );

  const rosterOptions = useMemo(() => {
    if (!facilityFilter) {
      return FACILITIES.flatMap((f) => f.roster.map((p) => ({ ...p, facilityName: f.name })));
    }
    const facility = FACILITIES.find((f) => f.id === facilityFilter);
    return (facility?.roster ?? []).map((p) => ({ ...p, facilityName: facility?.name ?? '' }));
  }, [facilityFilter]);

  const openRecord = (record: QuickSoapRecord) => {
    setSelectedId(record.id);
    setEditedSoap(record.soap);
    setBaselineSoap(record.soap);
  };

  const handleSaveDetail = () => {
    if (!selectedRecord || !editedSoap) return;
    const updated = updateQuickSoap(selectedRecord.id, { soap: editedSoap });
    if (!updated) {
      onToast('更新に失敗しました', 'info');
      return;
    }
    setBaselineSoap(editedSoap);
    setRefreshKey((k) => k + 1);
    onToast('履歴を更新しました', 'success');
  };

  const handleDelete = (id: string) => {
    deleteQuickSoap(id);
    if (selectedId === id) {
      setSelectedId(null);
      setEditedSoap(null);
      setBaselineSoap(null);
    }
    setRefreshKey((k) => k + 1);
    onToast('履歴を削除しました', 'info');
  };

  const handleCopy = async () => {
    if (!selectedRecord || !editedSoap) return;
    const text = buildQuickSoapText(
      resolvePatientName(selectedRecord),
      selectedRecord.date,
      editedSoap,
    );
    try {
      await navigator.clipboard.writeText(text);
      onToast('コピーしました', 'success');
    } catch {
      onToast('クリップボードへのコピーに失敗しました', 'info');
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-2xl font-bold text-gray-900">SOAP 履歴</h2>
        <p className="text-sm text-gray-500 mt-1">保存済みのクイック SOAP を検索・編集できます。</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700">フィルタ</h3>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          <select
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            value={facilityFilter}
            onChange={(e) => {
              setFacilityFilter(e.target.value);
              setPatientFilter('');
            }}
          >
            <option value="">すべての施設</option>
            {FACILITIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            value={patientFilter}
            onChange={(e) => setPatientFilter(e.target.value)}
          >
            <option value="">すべての患者</option>
            {rosterOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="開始日"
          />
          <input
            type="date"
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="終了日"
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          {records.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-sm text-gray-400">
              該当する履歴がありません
            </div>
          ) : (
            records.map((record) => {
              const patientName = resolvePatientName(record);
              const isSelected = selectedId === record.id;
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => openRecord(record)}
                  className={`w-full text-left px-4 py-3 bg-white border rounded-lg shadow-sm transition ${
                    isSelected
                      ? 'border-teal-400 bg-teal-50'
                      : 'border-gray-200 hover:border-teal-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-800">{patientName}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {resolveFacilityName(record.facilityId)} / {record.date}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 line-clamp-2">
                        {record.soap.assessment.split('\n')[0]?.replace(/^-\s*/, '')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(record.id);
                      }}
                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div>
          {!selectedRecord || !editedSoap || !baselineSoap ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-sm text-gray-400 h-full flex items-center justify-center">
              履歴を選択すると詳細を編集できます
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-sm text-gray-600">
                <div className="font-bold text-gray-800">{resolvePatientName(selectedRecord)}</div>
                <div className="text-xs mt-1">
                  {resolveFacilityName(selectedRecord.facilityId)} / {selectedRecord.date}
                </div>
              </div>

              <QuickSoapEditor
                value={editedSoap}
                baseline={baselineSoap}
                onChange={setEditedSoap}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveDetail}
                  className="px-4 py-2 text-sm font-bold rounded border shadow-sm bg-teal-500 text-white border-teal-600"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-4 py-2 text-sm font-medium rounded border bg-teal-50 text-teal-700 border-teal-200"
                >
                  コピー
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
