import React, { useState } from 'react';
import { QuickSoapHistoryList } from './components/QuickSoapHistoryList';
import { QuickSoapPanel } from './components/QuickSoapPanel';
import { RecordingPanel } from './components/RecordingPanel';

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

function App() {
  const [mode, setMode] = useState<AppMode>('recording');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' as 'success' | 'info' });

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 2400);
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
            <p className="text-sm text-gray-500">訪問先・患者を選び、会話を録音して SOAP を生成します</p>
          )}
          {mode === 'memo' && (
            <p className="text-sm text-gray-500">箇条書きメモから SOAP を生成します</p>
          )}
          {mode === 'history' && (
            <p className="text-sm text-gray-500">保存済み SOAP の履歴を確認・編集できます</p>
          )}
        </div>
        {mode === 'recording' && (
          <div className="p-4 flex-1 overflow-y-auto text-sm text-gray-600 space-y-3">
            <p>右側で訪問先・患者を選択し、「録音開始」から SOAP 生成まで進めてください。</p>
            <p className="text-xs text-gray-500">録音停止後、AI が約30秒以内に SOAP を整形します。</p>
          </div>
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
        {mode === 'recording' && <RecordingPanel onToast={showToast} />}
        {mode === 'memo' && <QuickSoapPanel onToast={showToast} />}
        {mode === 'history' && <QuickSoapHistoryList onToast={showToast} />}
      </main>

      <Toast message={toast.message} type={toast.type} show={toast.show} />
    </div>
  );
}

export default App;
