import { Facility, Round } from '../types';
import { MOCK_PATIENTS } from './mockData';

const pickRecord = (patientId: string) => {
  const patient = MOCK_PATIENTS.find((p) => p.id === patientId);
  if (!patient || !patient.records[0]) {
    throw new Error(`Record not found for ${patientId}`);
  }
  const { clinicalData, transcript } = patient.records[0];
  return { clinicalData, transcript };
};

export const FACILITIES: Facility[] = [
  {
    id: 'f1',
    name: 'さくら苑',
    type: 'facility',
    address: '東京都江東区 1-2-3',
    roster: [
      { id: 'roster-p1', name: '田中 健', kana: 'タナカ ケン', room: '205', note: '糖尿病性足潰瘍' },
      { id: 'roster-p2', name: '佐藤 博', kana: 'サトウ ヒロシ', room: '110', note: '就労支援中' },
      { id: 'roster-p5', name: '渡辺 和子', kana: 'ワタナベ カズコ', room: '201', note: '大腿骨骨折リハ中' },
    ],
  },
  {
    id: 'f2',
    name: '個人宅（港区・在宅医療）',
    type: 'home',
    address: '東京都港区',
    roster: [
      { id: 'roster-p6', name: '小林 勇', kana: 'コバヤシ イサム', note: 'キャッスルマン病' },
      { id: 'roster-p7', name: '加藤 美咲', kana: 'カトウ ミサキ', note: '術後創管理' },
      { id: 'roster-p9', name: '中村 健吾', kana: 'ナカムラ ケンゴ', note: '食物アレルギー' },
    ],
  },
  {
    id: 'f3',
    name: 'ひまわり苑',
    type: 'facility',
    address: '神奈川県横浜市青葉区 4-5-6',
    roster: [
      { id: 'roster-f3-p1', name: '伊藤 芳子', kana: 'イトウ ヨシコ', room: '102', note: '認知症中等度' },
      { id: 'roster-f3-p2', name: '高橋 清', kana: 'タカハシ キヨシ', room: '208', note: '心不全フォロー' },
      { id: 'roster-f3-p3', name: '松本 節子', kana: 'マツモト セツコ', room: '301', note: '褥瘡予防' },
    ],
  },
  {
    id: 'f4',
    name: 'もみじ荘',
    type: 'facility',
    address: '埼玉県さいたま市浦和区 2-1-8',
    roster: [
      { id: 'roster-f4-p1', name: '木村 正', kana: 'キムラ タダシ', room: '12', note: 'BPSD対応' },
      { id: 'roster-f4-p2', name: '林 照子', kana: 'ハヤシ テルコ', room: '15', note: '嚥下機能低下' },
      { id: 'roster-f4-p3', name: '清水 一男', kana: 'シミズ カズオ', room: '18', note: 'Parkinson フォロー' },
    ],
  },
  {
    id: 'f5',
    name: '青空ケアハウス',
    type: 'facility',
    address: '千葉県船橋市本町 7-3-2',
    roster: [
      { id: 'roster-f5-p1', name: '斎藤 みどり', kana: 'サイトウ ミドリ', room: '203', note: '要介護4' },
      { id: 'roster-f5-p2', name: '吉田 勝', kana: 'ヨシダ マサル', room: '105', note: 'COPD・在宅酸素' },
      { id: 'roster-f5-p3', name: '池田 幸', kana: 'イケダ サチ', room: '310', note: '多剤併用見直し' },
    ],
  },
  {
    id: 'f6',
    name: '港南ライフサポート',
    type: 'home',
    address: '東京都港区港南 1-9-1',
    roster: [
      { id: 'roster-f6-p1', name: '石川 隆', kana: 'イシカワ タカシ', note: '在宅中心静脈栄養' },
      { id: 'roster-f6-p2', name: '前田 由美', kana: 'マエダ ユミ', note: '小児在宅' },
      { id: 'roster-f6-p3', name: '岡田 修', kana: 'オカダ オサム', note: 'がん疼痛管理' },
    ],
  },
];

export const ROUNDS: Round[] = [
  {
    id: 'round-2025-11-12-am',
    date: '2025-11-12',
    timeframe: '午前',
    facilityId: 'f1',
    segments: [
      {
        id: 'seg-1',
        order: 1,
        predictedName: 'タナカさん（足潰瘍）？',
        ...pickRecord('p1'),
        suggestedPatientId: 'roster-p1',
      },
      {
        id: 'seg-2',
        order: 2,
        predictedName: 'サトウさん？',
        ...pickRecord('p2'),
        suggestedPatientId: 'roster-p2',
      },
      {
        id: 'seg-3',
        order: 3,
        predictedName: 'ワタナベさん？',
        ...pickRecord('p5'),
        suggestedPatientId: 'roster-p5',
      },
    ],
  },
  {
    id: 'round-2025-11-12-pm',
    date: '2025-11-12',
    timeframe: '午後',
    facilityId: 'f1',
    segments: [
      {
        id: 'seg-4',
        order: 1,
        predictedName: 'スズキさん？',
        ...pickRecord('p3'),
        suggestedPatientId: 'roster-p3',
      },
      {
        id: 'seg-5',
        order: 2,
        predictedName: 'ヤマモトさん（むくみ相談）？',
        ...pickRecord('p8'),
        suggestedPatientId: 'roster-p8',
      },
    ],
  },
  {
    id: 'round-2025-11-10-am',
    date: '2025-11-10',
    timeframe: '午前',
    facilityId: 'f2',
    segments: [
      {
        id: 'seg-6',
        order: 1,
        predictedName: 'コバヤシさん？',
        ...pickRecord('p6'),
        suggestedPatientId: 'roster-p6',
      },
      {
        id: 'seg-7',
        order: 2,
        predictedName: 'カトウさん？',
        ...pickRecord('p7'),
        suggestedPatientId: 'roster-p7',
      },
      {
        id: 'seg-8',
        order: 3,
        predictedName: 'ナカムラさん（小児）？',
        ...pickRecord('p9'),
        suggestedPatientId: 'roster-p9',
      },
    ],
  },
];
