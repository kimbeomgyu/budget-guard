import { describe, expect, it, vi } from 'vitest';
import { estimator, NEW_TOKENIZER_MULTIPLIER, tokenizerMultiplier } from '../src/estimator';
import { BudgetExceededError, guard } from '../src/guard';
import { MemoryStore } from '../src/store';

const TEXT = 'a'.repeat(4000); // chars/4 → 1000 토큰

describe('estimator()', () => {
  it('prompt/messages/system에서 텍스트를 모아 chars/4로 추정한다', () => {
    const est = estimator();
    const u = est({ model: 'gpt-4o', messages: [{ role: 'user', content: TEXT }] });
    expect(u.input).toBe(1000);
    expect(u.output).toBe(0);
  });

  it('멀티파트 content와 system도 집계한다', () => {
    const est = estimator();
    const u = est({
      model: 'gpt-4o',
      system: 'ab',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'cd' }] }],
      prompt: 'ef',
    });
    expect(u.input).toBe(Math.ceil(8 / 4)); // 'ef\nab\ncd' = 8자 (prompt, system, messages 순 join)
  });

  it('출력 추정은 선언된 상한을 쓴다 (max_tokens | maxOutputTokens | max_completion_tokens)', () => {
    const est = estimator();
    expect(est({ model: 'gpt-4o', prompt: 'x', max_tokens: 500 }).output).toBe(500);
    expect(est({ model: 'gpt-4o', prompt: 'x', maxOutputTokens: 300 }).output).toBe(300);
    expect(est({ model: 'gpt-4o', prompt: 'x', max_completion_tokens: 200 }).output).toBe(200);
  });

  it('신형 토크나이저 세대(Sonnet 5/Fable 등)는 같은 텍스트가 ≥25% 크게 추정된다', () => {
    const est = estimator();
    const oldGen = est({ model: 'gpt-4o', prompt: TEXT }).input;
    const newGen = est({ model: 'claude-sonnet-5', prompt: TEXT }).input;
    expect(newGen / oldGen).toBeGreaterThanOrEqual(1.25);
    expect(newGen).toBe(Math.ceil(1000 * NEW_TOKENIZER_MULTIPLIER));
  });

  it('세대 판별: 신형 목록/구형 계열/미지 계열', () => {
    expect(tokenizerMultiplier('claude-fable-5')).toBe(NEW_TOKENIZER_MULTIPLIER);
    expect(tokenizerMultiplier('claude-opus-4-8')).toBe(NEW_TOKENIZER_MULTIPLIER);
    expect(tokenizerMultiplier('claude-haiku-4-5')).toBe(1); // 구세대
    expect(tokenizerMultiplier('gpt-4.1')).toBe(1);
    expect(tokenizerMultiplier('gemini-2.5-pro')).toBe(1);
  });

  it('미지 모델 계열은 보수적 1.3× + 경고', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tokenizerMultiplier('totally-new-llm')).toBe(NEW_TOKENIZER_MULTIPLIER);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('countTokens 주입 시 휴리스틱 대신 그걸 쓴다', () => {
    const est = estimator({ countTokens: () => 42 });
    expect(est({ model: 'gpt-4o', prompt: TEXT }).input).toBe(42);
  });

  it('guard.estimateUsage에 꽂으면 캡 넘길 호출을 사전 차단한다', async () => {
    const store = new MemoryStore();
    let called = 0;
    const ai = guard(
      {
        create: async () => {
          called++;
          return { usage: { input: 1, output: 1 } };
        },
      },
      { project: 'pre', dailyCapUSD: 0.001, store, estimateUsage: estimator() },
    );
    // gpt-4o 입력 1000토큰 ≈ $0.0025 > 캡 $0.001 → 호출 전 차단
    await expect(
      ai.create({ model: 'gpt-4o', messages: [{ role: 'user', content: TEXT }] }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(called).toBe(0);
  });
});
