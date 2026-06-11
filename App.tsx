import React, { useMemo, useState } from 'react';
import { FACILITIES, ROUNDS } from './data/rounds';
import { ClinicalData, Facility, Round, RoundSegment, RosterPatient } from './types';
import { SectionHeader } from './components/SectionHeader';
import { QuickSoapHistoryList } from './components/QuickSoapHistoryList';
import { QuickSoapPanel } from './components/QuickSoapPanel';

type AppMode = 'recording' | 'memo' | 'history';

const Toast = ({ message, type, show }: { message: string; type: 'success' | 'info'; show: boolean }) => {
  return (
    <div
      className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg text-white font-bold transition-all duration-300 z-50 flex items-center gap-2 ${show ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none'} ${type === 'success' ? 'bg-teal-500' : 'bg-gray-600'}`}
    >
      {type === 'success' ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
      )}
      {message}
    </div>
  );
};

const toDateLabel = (iso: string) => {
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日 (${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`;
};

const buildSoapText = (patientName: string, date: string, data: ClinicalData) => {
  const { soap, pharmacy_focus, alerts, meta } = data;
  return `【SOAP】\n患者: ${patientName} / 日付: ${date}\nS: ${soap.subjective}\nO: ${soap.objective}\nA: ${soap.assessment}\nP: ${soap.plan}\n\n【薬学的フォーカス】\n薬剤: ${pharmacy_focus.medications
    .map((m) => `${m.name} ${m.dose} ${m.route} ${m.frequency} (${m.status})`)
    .join(' / ')}\nRed Flags: ${alerts.red_flags.join(', ')}\n主な問題点: ${meta.main_problems.join(', ')}`;
};

const buildHomeVisitText = (
  patientLabel: string,
  facility: Facility,
  round: Round,
  data: ClinicalData,
  room?: string
) => {
  return [
    `【基本情報】`,
    `日付: ${round.date} / 時間帯: ${round.timeframe} / 訪問先: ${facility.name}${room ? ` (${room}号室)` : ''}`,
    `患者名: ${patientLabel}`,
    `\n【主訴・訴え】`,
    data.soap.subjective,
    `\n【本日の観察・処置】`,
    data.soap.objective,
    `\n【薬剤・指示】`,
    data.soap.plan,
    `\n【次回予定・申し送り】`,
    data.meta.note_for_pharmacy,
  ].join('\n');
};

const VisitPill = ({ type }: { type: Facility['type'] }) => {
  const color = type === 'facility' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100';
  const label = type === 'facility' ? '施設' : '個人宅';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>{label}</span>;
};

const PatientRosterBadge: React.FC<{ patient: RosterPatient }> = ({ patient }) => (
  <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center justify-between text-sm">
    <div>
      <div className="font-semibold text-gray-800">{patient.name}</div>
      <div className="text-gray-500 text-xs flex gap-2">
        <span>{patient.kana}</span>
        {patient.room && <span className="font-mono">{patient.room}号室</span>}
      </div>
    </div>
    {patient.note && <span className="text-[11px] text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">{patient.note}</span>}
  </div>
);

function App() {
  const [mode, setMode] = useState<AppMode>('recording');
  const [selectedRoundId, setSelectedRoundId] = useState<string>(ROUNDS[0]?.id ?? '');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' as 'success' | 'info' });
  const [assignments, setAssignments] = useState<Record<string, { rosterPatientId: string | null; status: 'unconfirmed' | 'confirmed' }>>(() => {
    const initial: Record<string, { rosterPatientId: string | null; status: 'unconfirmed' | 'confirmed' }> = {};
    ROUNDS.forEach((round) => {
      round.segments.forEach((segment) => {
        initial[`${round.id}-${segment.id}`] = {
          rosterPatientId: segment.suggestedPatientId ?? null,
          status: 'unconfirmed',
        };
      });
    });
    return initial;
  });

  const selectedRound = useMemo(() => ROUNDS.find((r) => r.id === selectedRoundId), [selectedRoundId]);
  const currentFacility = useMemo(() => FACILITIES.find((f) => f.id === selectedRound?.facilityId), [selectedRound?.facilityId]);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 2400);
  };

  const updateAssignment = (roundId: string, segmentId: string, rosterPatientId: string | null) => {
    setAssignments((prev) => ({
      ...prev,
      [`${roundId}-${segmentId}`]: { rosterPatientId, status: 'unconfirmed' },
    }));
  };

  const confirmAssignment = (roundId: string, segmentId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [`${roundId}-${segmentId}`]: {
        rosterPatientId: prev[`${roundId}-${segmentId}`]?.rosterPatientId ?? null,
        status: 'confirmed',
      },
    }));
    showToast('患者割り当てを確定しました', 'success');
  };

  const revertAssignment = (roundId: string, segmentId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [`${roundId}-${segmentId}`]: {
        rosterPatientId: prev[`${roundId}-${segmentId}`]?.rosterPatientId ?? null,
        status: 'unconfirmed',
      },
    }));
    showToast('確認待ちに戻しました', 'info');
  };

  const selectedStats = useMemo(() => {
    if (!selectedRound) return { total: 0, confirmed: 0 };
    const total = selectedRound.segments.length;
    const confirmed = selectedRound.segments.filter((s) => assignments[`${selectedRound.id}-${s.id}`]?.status === 'confirmed').length;
    return { total, confirmed };
  }, [selectedRound, assignments]);

  const renderRoundCard = (round: Round) => {
    const facility = FACILITIES.find((f) => f.id === round.facilityId);
    const total = round.segments.length;
    const confirmed = round.segments.filter((s) => assignments[`${round.id}-${s.id}`]?.status === 'confirmed').length;

    return (
      <button
        key={round.id}
        onClick={() => setSelectedRoundId(round.id)}
        className={`w-full text-left p-4 rounded-lg border transition-all shadow-sm hover:shadow-md ${selectedRoundId === round.id ? 'border-teal-400 bg-teal-50' : 'border-gray-200 bg-white'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VisitPill type={facility?.type ?? 'facility'} />
            <span className="text-xs text-gray-500">{toDateLabel(round.date)}</span>
            <span className="text-sm font-bold text-gray-800">{round.timeframe}</span>
          </div>
          <div className="text-xs text-gray-500">{facility?.name}</div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">患者候補 {total}名</span>
          <span className="px-2 py-0.5 bg-emerald-50 rounded text-emerald-600 border border-emerald-100">確定 {confirmed}/{total}</span>
        </div>
      </button>
    );
  };

  const rosterSelect = (roundId: string, segment: RoundSegment) => {
    if (!currentFacility) return null;
    const key = `${roundId}-${segment.id}`;
    const current = assignments[key];

    return (
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-gray-600">施設の患者名簿から紐付け</label>
        <select
          className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          value={current?.rosterPatientId ?? ''}
          onChange={(e) => updateAssignment(roundId, segment.id, e.target.value || null)}
        >
          <option value="">未選択（あとで紐付け）</option>
          {currentFacility.roster.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.name} {patient.room ? `(${patient.room}号室)` : ''}
            </option>
          ))}
        </select>
        <div className="flex gap-2 text-xs text-gray-500">
          <span className="px-2 py-1 bg-gray-100 rounded">推定候補: {segment.predictedName}</span>
        </div>
      </div>
    );
  };

  const transcriptPreview = (segment: RoundSegment) => (
    <div className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono leading-relaxed border border-slate-700">
      <div className="flex items-center justify-between text-slate-400 mb-2">
        <span>録音の抜粋（最初の数行）</span>
        <button className="flex items-center gap-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 4l12 6-12 6V4z" />
          </svg>
          15秒プレビュー
        </button>
      </div>
      <pre className="whitespace-pre-wrap line-clamp-5">{segment.transcript}</pre>
    </div>
  );

  const patientLabel = (rosterId: string | null): { name: string; room?: string; kana?: string } => {
    if (!currentFacility || !rosterId) return { name: '未確定', room: undefined };
    const roster = currentFacility.roster.find((p) => p.id === rosterId);
    return roster ? { name: roster.name, room: roster.room, kana: roster.kana } : { name: '未確定' };
  };

  const modeTabClass = (target: AppMode) =>
    `flex-1 px-2 py-2 text-xs font-bold rounded border transition ${
      mode === target
        ? 'bg-teal-500 text-white border-teal-600'
        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
    }`;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800">
      <aside className="w-full md:w-96 border-r border-gray-200 bg-white flex flex-col h-full overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-200 bg-gradient-to-br from-teal-50 to-white space-y-3">
          <h1 className="text-xl font-bold text-gray-800">よりそい Pro</h1>
          <div className="flex gap-1">
            <button type="button" className={modeTabClass('recording')} onClick={() => setMode('recording')}>
              録音から作成
            </button>
            <button type="button" className={modeTabClass('memo')} onClick={() => setMode('memo')}>
              メモから作成
            </button>
            <button type="button" className={modeTabClass('history')} onClick={() => setMode('history')}>
              履歴
            </button>
          </div>
          {mode === 'recording' && (
            <p className="text-sm text-gray-500">日付・施設から対象ラウンドを選択してください</p>
          )}
          {mode === 'memo' && (
            <p className="text-sm text-gray-500">箇条書きメモから SOAP を生成します</p>
          )}
          {mode === 'history' && (
            <p className="text-sm text-gray-500">保存済み SOAP の履歴を確認・編集できます</p>
          )}
        </div>
        {mode === 'recording' && (
          <>
            <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-3">
              {ROUNDS.map(renderRoundCard)}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
              録音から自動分割された患者ブロックを、施設名簿と突合して確定するフローです。
            </div>
          </>
        )}
        {mode === 'memo' && (
          <div className="p-4 flex-1 overflow-y-auto text-sm text-gray-600 space-y-3">
            <p>右側のフォームで訪問先・患者・メモを入力し、「SOAP生成」を押してください。</p>
            <p className="text-xs text-gray-500">生成後は各セクションを編集して保存できます。</p>
          </div>
        )}
        {mode === 'history' && (
          <div className="p-4 flex-1 overflow-y-auto text-sm text-gray-600 space-y-3">
            <p>右側で施設・患者・日付を絞り込み、履歴を選択して編集できます。</p>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto">
        {mode === 'memo' && <QuickSoapPanel onToast={showToast} />}
        {mode === 'history' && <QuickSoapHistoryList onToast={showToast} />}
        {mode === 'recording' && (
          !selectedRound || !currentFacility ? (
            <div className="h-full flex items-center justify-center text-gray-400">ラウンドを選択してください</div>
          ) : (
          <div className="max-w-6xl mx-auto p-6 space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <VisitPill type={currentFacility.type} />
                    <span>{toDateLabel(selectedRound.date)}</span>
                    <span className="font-bold text-gray-800">{selectedRound.timeframe}</span>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mt-1">{currentFacility.name}</h2>
                  <p className="text-sm text-gray-500">{currentFacility.address}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-teal-600">{selectedStats.total}</div>
                    <div className="text-xs text-gray-500">候補患者</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-emerald-600">{selectedStats.confirmed}</div>
                    <div className="text-xs text-gray-500">確定済み</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <SectionHeader
                title="施設の患者名簿（インポート済み）"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-1 4l-3 3m0 0l-3-3m3 3V3" /></svg>}
              />
              <div className="grid md:grid-cols-2 gap-3">
                {currentFacility.roster.map((p) => (
                  <PatientRosterBadge key={p.id} patient={p} />
                ))}
              </div>
              <p className="text-xs text-gray-500">CSV/Excel でインポート済みの患者名簿をそのまま活用し、各ブロックと突合します。</p>
            </div>

            <div className="space-y-4">
              {selectedRound.segments.map((segment) => {
                const key = `${selectedRound.id}-${segment.id}`;
                const current = assignments[key];
                const rosterInfo = patientLabel(current?.rosterPatientId ?? null);
                const isConfirmed = current?.status === 'confirmed';

                return (
                  <div key={segment.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-full bg-teal-100 text-teal-700 font-bold flex items-center justify-center">{segment.order}</span>
                        <div>
                          <div className="text-xs text-gray-500">推定: {segment.predictedName}</div>
                          <div className="text-lg font-bold text-gray-900">{rosterInfo.name}</div>
                          {rosterInfo.kana && <div className="text-xs text-gray-500">{rosterInfo.kana}</div>}
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-bold border ${isConfirmed ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                        {isConfirmed ? '確定済み' : '要確認'}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="space-y-3">
                        {rosterSelect(selectedRound.id, segment)}
                        <div className="flex gap-2">
                          <button
                            className={`flex-1 px-3 py-2 text-sm font-bold rounded border shadow-sm transition ${isConfirmed ? 'bg-white text-gray-600 border-gray-200' : 'bg-teal-500 text-white border-teal-600'}`}
                            onClick={() => (isConfirmed ? revertAssignment(selectedRound.id, segment.id) : confirmAssignment(selectedRound.id, segment.id))}
                            disabled={!current?.rosterPatientId && !isConfirmed}
                          >
                            {isConfirmed ? '修正モードに戻す' : '確定する'}
                          </button>
                          <button
                            className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded border border-gray-200"
                            onClick={() => updateAssignment(selectedRound.id, segment.id, segment.suggestedPatientId ?? null)}
                          >
                            推定に戻す
                          </button>
                        </div>
                        {rosterInfo.room && <div className="text-xs text-gray-500">居室: {rosterInfo.room}号室</div>}
                        {transcriptPreview(segment)}
                      </div>

                      <div className="space-y-3 md:col-span-2">
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            AIサマリー
                          </h3>
                          <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                            <li>{segment.clinicalData.soap.assessment}</li>
                            <li>計画: {segment.clinicalData.soap.plan}</li>
                            <li>警告: {segment.clinicalData.alerts.red_flags.join(' / ') || '特記事項なし'}</li>
                          </ul>
                        </div>

                        <div className="grid md:grid-cols-2 gap-3">
                          <div className="border border-gray-200 rounded-lg p-3 bg-white">
                            <div className="text-xs font-semibold text-gray-500 mb-1">SOAP形式（コピー用）</div>
                            <textarea
                              readOnly
                              className="w-full h-44 text-sm bg-gray-50 p-2 rounded border border-gray-200 focus:outline-none"
                              value={buildSoapText(rosterInfo.name, selectedRound.date, segment.clinicalData)}
                            />
                          </div>
                          <div className="border border-gray-200 rounded-lg p-3 bg-white">
                            <div className="text-xs font-semibold text-gray-500 mb-1">訪問診療フォーマット</div>
                            <textarea
                              readOnly
                              className="w-full h-44 text-sm bg-gray-50 p-2 rounded border border-gray-200 focus:outline-none"
                              value={buildHomeVisitText(rosterInfo.name, currentFacility, selectedRound, segment.clinicalData, rosterInfo.room)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )
        )}
      </main>

      <Toast message={toast.message} type={toast.type} show={toast.show} />
    </div>
  );
}

export default App;
