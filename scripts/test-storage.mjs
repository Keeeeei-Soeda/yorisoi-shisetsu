/**
 * localStorage モック（Node 環境用）
 */
function setupLocalStorageMock() {
  const store = new Map();

  globalThis.localStorage = {
    store,
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
  };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const sampleSoap = {
  subjective: '- [本人] テスト訴え',
  objective: '- 処方: テスト薬5mg 1日1回',
  assessment: '- テスト評価',
  plan: '- Ep: テスト指導',
};

async function main() {
  setupLocalStorageMock();

  const {
    createQuickSoapRecord,
    saveQuickSoap,
    getQuickSoap,
    listQuickSoaps,
    updateQuickSoap,
    deleteQuickSoap,
  } = await import('../lib/quickSoapStorage.ts');

  console.log('=== テスト1: createQuickSoapRecord ===');
  const record = createQuickSoapRecord({
    facilityId: 'f1',
    rosterPatientId: 'roster-p1',
    date: '2026-06-11',
    bulletInput: '- テスト入力メモ',
    soap: sampleSoap,
  });
  assert(record.id.startsWith('qs-'), 'id に qs- プレフィックスが付く');
  assert(record.createdAt.length > 0, 'createdAt が自動付与される');
  assert(record.updatedAt.length > 0, 'updatedAt が自動付与される');
  assert(record.createdAt === record.updatedAt, '新規作成時 createdAt === updatedAt');

  console.log('\n=== テスト2: saveQuickSoap ===');
  saveQuickSoap(record);
  assert(getQuickSoap(record.id) !== null, 'saveQuickSoap で保存できる');

  console.log('\n=== テスト3: getQuickSoap ===');
  const fetched = getQuickSoap(record.id);
  assert(fetched?.bulletInput === '- テスト入力メモ', 'getQuickSoap で取得できる');
  assert(getQuickSoap('non-existent-id') === null, '存在しない id で null');

  console.log('\n=== テスト4: listQuickSoaps（フィルタなし）===');
  const record2 = createQuickSoapRecord({
    facilityId: 'f2',
    rosterPatientId: null,
    patientNameOverride: '山田 太郎',
    date: '2026-06-10',
    bulletInput: '- 別件メモ',
    soap: sampleSoap,
  });
  saveQuickSoap(record2);
  const all = listQuickSoaps();
  assert(all.length === 2, 'フィルタなしで全件返る');

  console.log('\n=== テスト5: listQuickSoaps（facilityId フィルタ）===');
  const f1Only = listQuickSoaps({ facilityId: 'f1' });
  assert(f1Only.length === 1 && f1Only[0].facilityId === 'f1', 'facilityId フィルタが機能する');

  console.log('\n=== テスト6: listQuickSoaps（日付範囲フィルタ）===');
  const dateRange = listQuickSoaps({ dateFrom: '2026-06-11', dateTo: '2026-06-11' });
  assert(dateRange.length === 1 && dateRange[0].date === '2026-06-11', '日付範囲フィルタが機能する');

  console.log('\n=== テスト7: updateQuickSoap ===');
  const createdAtBefore = record.createdAt;
  const updatedAtBefore = record.updatedAt;
  await new Promise((r) => setTimeout(r, 10));
  const updated = updateQuickSoap(record.id, { bulletInput: '- 更新後メモ' });
  assert(updated !== null, 'updateQuickSoap で更新できる');
  assert(updated.bulletInput === '- 更新後メモ', 'partial が反映される');
  assert(updated.createdAt === createdAtBefore, 'createdAt は変わらない');
  assert(updated.updatedAt >= updatedAtBefore, 'updatedAt が更新される');
  const ignored = updateQuickSoap(record.id, {
    id: 'hacked-id',
    createdAt: '1970-01-01T00:00:00.000Z',
  });
  assert(ignored?.id === record.id, 'id は partial で上書きされない');
  assert(ignored?.createdAt === createdAtBefore, 'createdAt は partial で上書きされない');
  assert(updateQuickSoap('missing-id', { bulletInput: 'x' }) === null, '存在しない id で null');

  console.log('\n=== テスト8: deleteQuickSoap ===');
  deleteQuickSoap(record2.id);
  assert(getQuickSoap(record2.id) === null, 'deleteQuickSoap で削除できる');
  assert(listQuickSoaps().length === 1, '削除後の件数が正しい');

  console.log('\n=== 全テスト完了（8/8） ===');
}

main().catch((err) => {
  console.error('テスト失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
