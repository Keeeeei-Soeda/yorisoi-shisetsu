import React, { useState } from 'react';
import { QuickSoapHistoryList } from './components/QuickSoapHistoryList';
import { QuickSoapPanel } from './components/QuickSoapPanel';
import { RecordingPanel } from './components/RecordingPanel';

type AppMode = 'recording' | 'memo' | 'history';

const Toast = ({ message, type, show }: { message: string; type: 'success' | 'info'; show: boolean }) => {
  return (
    <div
      className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 transform items-center gap-2 rounded-lg px-6 py-3 font-bold text-white shadow-lg transition-all duration-300 ${show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-8 opacity-0'} ${type === 'success' ? 'bg-teal-500' : 'bg-gray-600'}`}
    >
      {type === 'success' ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
      )}
      {message}
    </div>
  );
};

const MODE_DESCRIPTION: Record<AppMode, string> = {
  recording: '訪問先・患者を選び、会話を録音して SOAP を生成します',
  memo: '箇条書きメモから SOAP を生成します',
  history: '保存済み SOAP の履歴を確認・編集できます',
};

function App() {
  const [mode, setMode] = useState<AppMode>('recording');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' as 'success' | 'info' });

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 2400);
  };

  const modeTabClass = (target: AppMode, layout: 'horizontal' | 'vertical') =>
    `rounded border font-bold transition ${
      layout === 'horizontal'
        ? 'min-h-[44px] flex-1 px-1.5 py-3 text-[11px] sm:px-2 sm:text-xs'
        : 'w-full px-3 py-2 text-left text-xs'
    } ${
      mode === target
        ? 'border-teal-600 bg-teal-500 text-white'
        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
    }`;

  const modeTabsHorizontal = (
    <div className="flex gap-1">
      <button type="button" className={modeTabClass('recording', 'horizontal')} onClick={() => setMode('recording')}>
        録音から作成
      </button>
      <button type="button" className={modeTabClass('memo', 'horizontal')} onClick={() => setMode('memo')}>
        メモから作成
      </button>
      <button type="button" className={modeTabClass('history', 'horizontal')} onClick={() => setMode('history')}>
        履歴
      </button>
    </div>
  );

  const modeTabsVertical = (
    <div className="flex flex-col gap-1.5">
      <button type="button" className={modeTabClass('recording', 'vertical')} onClick={() => setMode('recording')}>
        録音から作成
      </button>
      <button type="button" className={modeTabClass('memo', 'vertical')} onClick={() => setMode('memo')}>
        メモから作成
      </button>
      <button type="button" className={modeTabClass('history', 'vertical')} onClick={() => setMode('history')}>
        履歴
      </button>
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-50 text-slate-800 md:flex-row">
      <header className="shrink-0 border-b border-gray-200 bg-white shadow-sm md:hidden">
        <div className="space-y-2 bg-gradient-to-br from-teal-50 to-white p-3">
          <h1 className="text-lg font-bold text-gray-800">よりそい Pro</h1>
          {modeTabsHorizontal}
          <p className="text-xs leading-relaxed text-gray-500">{MODE_DESCRIPTION[mode]}</p>
        </div>
      </header>

      <aside className="hidden h-full w-60 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white shadow-sm md:flex lg:w-64">
        <div className="space-y-3 border-b border-gray-200 bg-gradient-to-br from-teal-50 to-white p-3">
          <h1 className="text-lg font-bold text-gray-800">よりそい Pro</h1>
          {modeTabsVertical}
          <p className="text-xs leading-relaxed text-gray-500">{MODE_DESCRIPTION[mode]}</p>
        </div>
        {mode === 'recording' && (
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs leading-relaxed text-gray-600">
            <p>右側で訪問先・患者を選択し、「録音開始」から SOAP 生成まで進めてください。</p>
            <p className="text-xs text-gray-500">録音停止後、AI が約30秒以内に SOAP を整形します。</p>
          </div>
        )}
        {mode === 'memo' && (
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs leading-relaxed text-gray-600">
            <p>右側のフォームで訪問先・患者・メモを入力し、「SOAP生成」を押してください。</p>
            <p className="text-xs text-gray-500">生成後は各セクションを編集して保存できます。</p>
          </div>
        )}
        {mode === 'history' && (
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs leading-relaxed text-gray-600">
            <p>右側で施設・患者・日付を絞り込み、履歴を選択して編集できます。</p>
          </div>
        )}
      </aside>

      <main className="min-h-0 w-full flex-1 overflow-y-auto overscroll-y-contain">
        {mode === 'recording' && <RecordingPanel onToast={showToast} />}
        {mode === 'memo' && <QuickSoapPanel onToast={showToast} />}
        {mode === 'history' && <QuickSoapHistoryList onToast={showToast} />}
      </main>

      <Toast message={toast.message} type={toast.type} show={toast.show} />
    </div>
  );
}

export default App;
