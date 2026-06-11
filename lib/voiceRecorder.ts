const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
] as const;

const CHUNK_INTERVAL_MS = 1000;

export interface VoiceRecorderOptions {
  /** チャンク受信時のコールバック（任意。未指定時は stop() で全体 Blob を返す） */
  onChunk?: (chunk: Blob) => void;
  /** 音量レベル更新コールバック（0-1） */
  onLevelUpdate?: (level: number) => void;
  /** エラー発生時のコールバック */
  onError: (error: VoiceRecorderError) => void;
}

export class VoiceRecorderError extends Error {
  code: 'PERMISSION_DENIED' | 'NO_DEVICE' | 'NOT_SUPPORTED' | 'UNKNOWN';
  originalError?: unknown;

  constructor(
    message: string,
    code: 'PERMISSION_DENIED' | 'NO_DEVICE' | 'NOT_SUPPORTED' | 'UNKNOWN',
    originalError?: unknown,
  ) {
    super(message);
    this.name = 'VoiceRecorderError';
    this.code = code;
    this.originalError = originalError;
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function mapGetUserMediaError(error: unknown): VoiceRecorderError {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return new VoiceRecorderError(
        'マイクの利用が許可されていません。ブラウザの設定でマイク権限を有効にしてください。',
        'PERMISSION_DENIED',
        error,
      );
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return new VoiceRecorderError(
        'マイクが見つかりません。デバイスが接続されているか確認してください。',
        'NO_DEVICE',
        error,
      );
    }
    if (error.name === 'NotSupportedError') {
      return new VoiceRecorderError(
        'このブラウザでは音声録音がサポートされていません。',
        'NOT_SUPPORTED',
        error,
      );
    }
  }

  return new VoiceRecorderError(
    'マイクの取得中に予期しないエラーが発生しました。',
    'UNKNOWN',
    error,
  );
}

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private options: VoiceRecorderOptions | null = null;
  private recordingStartedAt = 0;
  private pausedAccumulatedMs = 0;
  private pauseStartedAt = 0;
  private lastDurationMs = 0;
  private state: 'inactive' | 'recording' | 'paused' = 'inactive';

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelAnimationId: number | null = null;
  private levelBuffer: Uint8Array | null = null;

  async start(options: VoiceRecorderOptions): Promise<void> {
    if (this.state !== 'inactive') {
      throw new VoiceRecorderError('録音は既に開始されています。', 'UNKNOWN');
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const error = new VoiceRecorderError(
        'この環境では MediaRecorder API が利用できません。',
        'NOT_SUPPORTED',
      );
      options.onError(error);
      throw error;
    }

    const selectedMime = pickMimeType();
    if (!selectedMime) {
      const error = new VoiceRecorderError(
        'このブラウザではサポートされている音声形式がありません。',
        'NOT_SUPPORTED',
      );
      options.onError(error);
      throw error;
    }

    this.options = options;
    this.mimeType = selectedMime;
    this.chunks = [];
    this.pausedAccumulatedMs = 0;
    this.pauseStartedAt = 0;
    this.lastDurationMs = 0;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const mapped = mapGetUserMediaError(error);
      options.onError(mapped);
      throw mapped;
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: selectedMime });
    } catch (error) {
      this.cleanupStream();
      const mapped = new VoiceRecorderError(
        'MediaRecorder の初期化に失敗しました。',
        'NOT_SUPPORTED',
        error,
      );
      options.onError(mapped);
      throw mapped;
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size <= 0) {
        return;
      }
      this.chunks.push(event.data);
      this.options?.onChunk?.(event.data);
    };

    this.mediaRecorder.onerror = (event) => {
      const mapped = new VoiceRecorderError(
        '録音中にエラーが発生しました。',
        'UNKNOWN',
        event,
      );
      this.options?.onError(mapped);
    };

    this.recordingStartedAt = Date.now();
    this.state = 'recording';

    if (options.onChunk) {
      this.mediaRecorder.start(CHUNK_INTERVAL_MS);
    } else {
      this.mediaRecorder.start();
    }

    if (options.onLevelUpdate) {
      this.startLevelMonitoring(options.onLevelUpdate);
    }
  }

  async stop(): Promise<Blob> {
    if (this.state === 'inactive' || !this.mediaRecorder) {
      throw new VoiceRecorderError('録音が開始されていません。', 'UNKNOWN');
    }

    this.lastDurationMs = this.computeDurationMs();
    this.state = 'inactive';

    const recorder = this.mediaRecorder;
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener(
        'stop',
        () => {
          const type = this.mimeType || recorder.mimeType || 'audio/webm';
          resolve(new Blob(this.chunks, { type }));
        },
        { once: true },
      );
      recorder.addEventListener(
        'error',
        () => {
          reject(new VoiceRecorderError('録音の停止中にエラーが発生しました。', 'UNKNOWN'));
        },
        { once: true },
      );

      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        const type = this.mimeType || recorder.mimeType || 'audio/webm';
        resolve(new Blob(this.chunks, { type }));
      }
    });

    this.stopLevelMonitoring();
    this.cleanupStream();
    this.mediaRecorder = null;
    this.options = null;

    return blob;
  }

  pause(): void {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      return;
    }
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
    this.pauseStartedAt = Date.now();
    this.state = 'paused';
    this.stopLevelMonitoring();
  }

  resume(): void {
    if (this.state !== 'paused' || !this.mediaRecorder) {
      return;
    }
    if (this.pauseStartedAt > 0) {
      this.pausedAccumulatedMs += Date.now() - this.pauseStartedAt;
      this.pauseStartedAt = 0;
    }
    if (this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }
    this.state = 'recording';

    const onLevelUpdate = this.options?.onLevelUpdate;
    if (onLevelUpdate) {
      this.startLevelMonitoring(onLevelUpdate);
    }
  }

  getMimeType(): string {
    return this.mimeType || this.mediaRecorder?.mimeType || '';
  }

  getDuration(): number {
    if (this.state === 'inactive') {
      return this.lastDurationMs;
    }
    return this.computeDurationMs();
  }

  getState(): 'inactive' | 'recording' | 'paused' {
    return this.state;
  }

  private computeDurationMs(): number {
    if (this.recordingStartedAt <= 0) {
      return 0;
    }

    if (this.state === 'paused' && this.pauseStartedAt > 0) {
      return Math.max(0, this.pauseStartedAt - this.recordingStartedAt - this.pausedAccumulatedMs);
    }

    return Math.max(0, Date.now() - this.recordingStartedAt - this.pausedAccumulatedMs);
  }

  private startLevelMonitoring(onLevelUpdate: (level: number) => void): void {
    if (!this.stream) {
      return;
    }

    this.stopLevelMonitoring();

    const AudioContextCtor =
      typeof window !== 'undefined'
        ? window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;

    if (!AudioContextCtor) {
      return;
    }

    this.audioContext = new AudioContextCtor();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this.levelBuffer = new Uint8Array(this.analyser.frequencyBinCount);

    const tick = () => {
      if (!this.analyser || !this.levelBuffer || this.state !== 'recording') {
        return;
      }

      this.analyser.getByteTimeDomainData(this.levelBuffer);
      let sumSquares = 0;
      for (let i = 0; i < this.levelBuffer.length; i += 1) {
        const normalized = (this.levelBuffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / this.levelBuffer.length);
      onLevelUpdate(Math.min(1, rms * 2));

      this.levelAnimationId = window.requestAnimationFrame(tick);
    };

    this.levelAnimationId = window.requestAnimationFrame(tick);
  }

  private stopLevelMonitoring(): void {
    if (this.levelAnimationId !== null) {
      window.cancelAnimationFrame(this.levelAnimationId);
      this.levelAnimationId = null;
    }

    this.analyser = null;
    this.levelBuffer = null;

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
