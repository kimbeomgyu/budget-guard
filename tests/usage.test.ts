import { describe, it, expect } from 'vitest';
import { normalizeUsage } from '../src/usage';

describe('normalizeUsage()', () => {
  it('우리 형태 {input,output}를 그대로 받는다', () => {
    expect(normalizeUsage({ input: 10, output: 20 })).toEqual({ input: 10, output: 20 });
  });

  it('OpenAI 형태(prompt_tokens/completion_tokens)를 정규화한다', () => {
    expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 20 })).toEqual({ input: 10, output: 20 });
  });

  it('Anthropic 형태(input_tokens/output_tokens)를 정규화한다', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({ input: 10, output: 20 });
  });

  it('usage가 없으면 에러', () => {
    expect(() => normalizeUsage(undefined)).toThrow();
  });

  it('모르는 형태면 에러', () => {
    expect(() => normalizeUsage({ foo: 1 })).toThrow();
  });
});
