import React, { useEffect, useRef, useState } from 'react';
import {
  VoiceRecorder as VoiceRecorderEngine,
  VoiceRecorderError,
} from '../lib/voiceRecorder.ts';

export interface VoiceRecorderProps {
  /** 録音完了時のコールバック（音声 Blob と録音時間を渡す） */
  onComplete: (audio: Blob, durationMs: number) => void;
  /** エラー時のコールバック */
  onError: (error: Error) => void;
  /** 録音をキャンセル */
  onCancel?: () => void;
  /** 操作無効化 */
  disabled?: boolean;
}

type UiPhase = 'idle' | 'recording' | 'review';

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onComplete,
  onError,
  onCancel,
  disabled = false,
}) => {
  const engineRef = useRef<VoiceRecorderEngine | null>(null);
  const [phase, setPhase] = useState<UiPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);

  useEffect(() => {
    if (phase !== 'recording') {
      return;
    }

    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        setElapsedMs(engine.getDuration());
        setIsPaused(engine.getState() === 'paused');
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 200);
    return () => window.clearInterval(intervalId);
  }, [phase]);

  useEffect(() => {
    return () => {
      engineRef.current = null;
    };
  }, []);

  const resetToIdle = () => {
    engineRef.current = null;
    setPhase('idle');
    setElapsedMs(0);
    setLevel(0);
    setIsPaused(false);
    setRecordedBlob(null);
    setRecordedDurationMs(0);
  };

  const handleStart = async () => {
    if (disabled || isStarting || phase !== 'idle') {
      return;
    }

    setIsStarting(true);
    const engine = new VoiceRecorderEngine();
    engineRef.current = engine;

    try {
      await engine.start({
        onLevelUpdate: (nextLevel) => setLevel(nextLevel),
        onError: (error) => onError(error),
      });
      setPhase('recording');
      setElapsedMs(0);
      setLevel(0);
      setIsPaused(false);
    } catch (error) {
      engineRef.current = null;
      if (error instanceof VoiceRecorderError) {
        onError(error);
      } else if (error instanceof Error) {
        onError(error);
      } else {
        onError(new Error('録音の開始に失敗しました。'));
      }
    } finally {
      setIsStarting(false);
    }
  };

  const handlePauseToggle = () => {
    const engine = engineRef.current;
    if (!engine || phase !== 'recording') {
      return;
    }

    if (engine.getState() === 'paused') {
      engine.resume();
      setIsPaused(false);
    } else {
      engine.pause();
      setIsPaused(true);
      setLevel(0);
    }
    setElapsedMs(engine.getDuration());
  };

  const handleStop = async () => {
    const engine = engineRef.current;
    if (!engine || phase !== 'recording') {
      return;
    }

    try {
      const blob = await engine.stop();
      const durationMs = engine.getDuration();
      setRecordedBlob(blob);
      setRecordedDurationMs(durationMs);
      setPhase('review');
      engineRef.current = null;
      setLevel(0);
    } catch (error) {
      engineRef.current = null;
      resetToIdle();
      if (error instanceof VoiceRecorderError) {
        onError(error);
      } else if (error instanceof Error) {
        onError(error);
      } else {
        onError(new Error('録音の停止に失敗しました。'));
      }
    }
  };

  const handleConfirm = () => {
    if (!recordedBlob) {
      return;
    }
    onComplete(recordedBlob, recordedDurationMs);
  };

  const handleDiscard = () => {
    resetToIdle();
    onCancel?.();
  };

  if (phase === 'idle') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled || isStarting}
          className="flex min-h-[44px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-red-600 bg-red-500 px-6 py-8 text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 md:py-8"
        >
          <span className="text-3xl" aria-hidden>
            🎤
          </span>
          <span className="text-lg font-bold">{isStarting ? '準備中…' : '録音開始'}</span>
          <span className="text-xs font-normal text-red-100">
            マイクの利用許可が必要です
          </span>
        </button>
      </div>
    );
  }

  if (phase === 'recording') {
    const levelPercent = Math.round(level * 100);

    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-red-700">
            <span
              className={`inline-block h-3 w-3 rounded-full bg-red-500 ${isPaused ? '' : 'animate-pulse'}`}
              aria-hidden
            />
            <span className="text-sm font-bold">{isPaused ? '一時停止中' : '録音中'}</span>
          </div>
          <span className="font-mono text-2xl font-bold text-gray-800">{formatDuration(elapsedMs)}</span>
        </div>

        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-red-100">
            <div
              className="h-full rounded-full bg-teal-500 transition-[width] duration-100"
              style={{ width: `${levelPercent}%` }}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={levelPercent}
              aria-label="音量レベル"
            />
          </div>
          <p className="text-xs text-gray-500">音量レベル</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePauseToggle}
            disabled={disabled}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 md:min-h-0 md:py-2"
          >
            {isPaused ? '再開' : '一時停止'}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={disabled}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded border border-gray-700 bg-gray-700 px-4 py-3 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50 md:min-h-0 md:py-2"
          >
            停止
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-center">
        <p className="text-sm font-bold text-gray-800">
          録音完了（{formatDuration(recordedDurationMs)}）
        </p>
        <p className="mt-1 text-xs text-gray-500">
          内容を確認して SOAP 生成に進むか、破棄してやり直してください。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={disabled || !recordedBlob}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded border border-teal-600 bg-teal-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-teal-600 disabled:opacity-50 md:min-h-0 md:py-2"
        >
          SOAP生成
        </button>
        <button
          type="button"
          onClick={handleDiscard}
          disabled={disabled}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 md:min-h-0 md:py-2"
        >
          破棄してやり直し
        </button>
      </div>
    </div>
  );
};
