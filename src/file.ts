/**
 * budget-guard/file — 파일 기반 SpendStore.
 *
 * 용도: 크론 잡·CLI 스크립트처럼 "짧게 실행되고 끝나는" 프로세스. 기본 MemoryStore는
 * 프로세스가 죽으면 리셋되므로 이런 워크로드에선 캡이 사실상 무력했다 — 이 저장소가
 * 실행 사이의 누적을 파일로 지속시켜 그 구멍을 막는다.
 *
 * 위치: node:fs를 쓰므로 메인 엔트리가 아니라 서브패스로 분리 (엣지/브라우저 번들 보호).
 * 계층: MemoryStore = 프로세스 / fileStore = 머신 / redisStore = 플릿.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SpendStore } from './store.js';

/**
 * JSON 파일 하나에 지출을 지속하는 SpendStore.
 *
 * - 쓰기는 임시 파일 + rename이라 중간에 죽어도 파일이 깨지지 않는다.
 * - 모든 연산이 동기 → 한 프로세스 안에서는 원자적 (addIfUnder 포함).
 * - 손상된 파일은 조용히 0으로 리셋하지 않고 throw한다 (예산 도구가 조용히 캡을
 *   풀면 안 되므로). 정말 리셋하려면 파일을 지우면 된다.
 *
 * ponytail: 동시 실행되는 여러 프로세스 간 원자성은 없다(read-modify-write 레이스).
 * 순차 실행(크론·스크립트)이 대상 — 동시 워커 플릿은 redisStore를 쓸 것.
 *
 * @example
 *   import { fileStore } from 'budget-guard/file';
 *   const ai = guard(client, { project: 'cron', dailyCapUSD: 5, store: fileStore('~/.cache/spend.json') });
 */
export function fileStore(path: string): SpendStore {
  mkdirSync(dirname(path), { recursive: true });

  const load = (): Record<string, number> => {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return {};
      throw e;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `budget-guard fileStore: "${path}" is corrupted — refusing to silently reset spend. Delete the file to start over.`,
      );
    }
    if (data == null || typeof data !== 'object' || Array.isArray(data))
      throw new Error(
        `budget-guard fileStore: "${path}" does not contain a spend object. Delete the file to start over.`,
      );
    return data as Record<string, number>;
  };

  const save = (data: Record<string, number>): void => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, path); // 원자적 교체 — 부분 쓰기로 파일이 깨질 일 없음
  };

  return {
    add(key, amountUSD) {
      const data = load();
      const n = (data[key] ?? 0) + amountUSD;
      data[key] = n;
      save(data);
      return n;
    },
    get(key) {
      return load()[key] ?? 0;
    },
    entries(prefix) {
      return Object.entries(load()).filter(([k]) => k.startsWith(prefix));
    },
    addIfUnder(key, amountUSD, capUSD) {
      const data = load();
      const cur = data[key] ?? 0;
      if (cur + amountUSD > capUSD) return -1;
      data[key] = cur + amountUSD;
      save(data);
      return data[key];
    },
  };
}
