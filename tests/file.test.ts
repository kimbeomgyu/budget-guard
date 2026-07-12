import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileStore } from '../src/file';
import { BudgetExceededError, guard } from '../src/guard';

const tmpPath = () => join(mkdtempSync(join(tmpdir(), 'bg-file-')), 'spend.json');

describe('fileStore', () => {
  it('add/get/entries/addIfUnder 기본 동작', () => {
    const s = fileStore(tmpPath());
    expect(s.add('a|f|2026-07-12', 0.5)).toBe(0.5);
    expect(s.add('a|f|2026-07-12', 0.25)).toBe(0.75);
    expect(s.get('a|f|2026-07-12')).toBe(0.75);
    expect(s.get('missing')).toBe(0);
    expect(s.entries('a|')).toEqual([['a|f|2026-07-12', 0.75]]);
    expect(s.addIfUnder?.('a|f|2026-07-12', 1, 1)).toBe(-1);
    expect(s.addIfUnder?.('a|f|2026-07-12', 0.25, 1)).toBe(1);
  });

  it('실행 간 지속: 새 store 인스턴스(=새 프로세스)가 이전 누적을 본다', async () => {
    const path = tmpPath();
    // 1차 실행: $0.0125 지출
    const run1 = guard(
      { create: async () => ({ usage: { input: 1000, output: 1000 } }) },
      { project: 'cron', dailyCapUSD: 0.02, store: fileStore(path) },
    );
    await run1.create({ model: 'gpt-4o' });
    // 2차 실행(새 인스턴스): 누적 $0.0125 보임 → 이번 호출로 캡(0.02) 초과 상태가 됨
    const run2 = guard(
      { create: async () => ({ usage: { input: 1000, output: 1000 } }) },
      { project: 'cron', dailyCapUSD: 0.02, store: fileStore(path) },
    );
    await run2.create({ model: 'gpt-4o' }); // 0.025 누적
    // 3차 실행: 이미 캡 초과 → 차단 (MemoryStore였다면 매 실행 0부터라 영원히 통과)
    const run3 = guard(
      { create: async () => ({ usage: { input: 1000, output: 1000 } }) },
      { project: 'cron', dailyCapUSD: 0.02, store: fileStore(path) },
    );
    await expect(run3.create({ model: 'gpt-4o' })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('중첩 디렉토리를 만들어준다', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bg-file-')), 'deep', 'er', 'spend.json');
    const s = fileStore(path);
    s.add('k', 1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ k: 1 });
  });

  it('손상된 파일은 조용히 리셋하지 않고 throw한다', () => {
    const path = tmpPath();
    writeFileSync(path, 'not json{', 'utf8');
    expect(() => fileStore(path).get('k')).toThrow(/corrupted/);
    writeFileSync(path, '[1,2]', 'utf8');
    expect(() => fileStore(path).get('k')).toThrow(/spend object/);
  });

  it('쓰기는 tmp+rename — 본 파일은 항상 완전한 JSON', () => {
    const path = tmpPath();
    const s = fileStore(path);
    for (let i = 0; i < 50; i++) s.add('k', 0.01);
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
    expect(s.get('k')).toBeCloseTo(0.5, 10);
  });
});
