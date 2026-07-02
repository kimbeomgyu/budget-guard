import type { Usage } from './types.js';
import { normalizeUsage } from './usage.js';

/** 스트리밍 청크에서 usage를 누적하는 리더. 청크마다 observe(), 스트림 종료 후 result(). */
export interface StreamUsageReader {
  observe(chunk: unknown): void;
  /** 누적된 최종 Usage. 못 찾으면 null(정산 스킵). */
  result(): Usage | null;
}

/** provider 힌트에 맞는 스트림 usage 리더를 고른다. 미지정/openai는 OpenAI 리더. */
export function streamUsageReader(
  provider: 'openai' | 'anthropic' | 'gemini' | undefined,
): StreamUsageReader {
  switch (provider) {
    case 'anthropic':
      return anthropicStreamReader();
    case 'gemini':
      return geminiStreamReader();
    default:
      return openaiStreamReader();
  }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/**
 * OpenAI: usage는 스트림의 최종 청크에만 실린다
 * (stream_options.include_usage 를 켰을 때). 표준 usage 모양이라 normalizeUsage로 처리.
 */
function openaiStreamReader(): StreamUsageReader {
  let raw: unknown = null;
  return {
    observe(chunk) {
      const u = (chunk as { usage?: unknown } | null)?.usage;
      if (u != null) raw = u;
    },
    result() {
      return raw == null ? null : normalizeUsage(raw);
    },
  };
}

/**
 * Gemini: 스트림 청크의 `usageMetadata`(promptTokenCount 등). 마지막 청크가 누적 총합을
 * 담으므로 마지막 non-null을 사용. Gemini 모양이라 normalizeUsage로 처리.
 */
function geminiStreamReader(): StreamUsageReader {
  let raw: unknown = null;
  return {
    observe(chunk) {
      const u = (chunk as { usageMetadata?: unknown } | null)?.usageMetadata;
      if (u != null) raw = u;
    },
    result() {
      return raw == null ? null : normalizeUsage(raw);
    },
  };
}

/**
 * Anthropic: usage가 이벤트에 나눠 실린다.
 * - message_start.message.usage → input + 캐시(cache_read)
 * - message_delta.usage.output_tokens → 누적 output (더하지 말고 '교체')
 */
function anthropicStreamReader(): StreamUsageReader {
  let seen = false;
  let input = 0;
  let output = 0;
  let cachedInput: number | undefined;
  return {
    observe(chunk) {
      const c = chunk as {
        type?: string;
        message?: { usage?: Record<string, unknown> };
        usage?: Record<string, unknown>;
      } | null;
      if (!c) return;
      if (c.type === 'message_start' && c.message?.usage) {
        seen = true;
        const u = c.message.usage;
        input = num(u.input_tokens);
        const cacheRead = num(u.cache_read_input_tokens);
        if (cacheRead > 0) cachedInput = cacheRead;
        if (u.output_tokens != null) output = num(u.output_tokens);
      } else if (c.type === 'message_delta' && c.usage?.output_tokens != null) {
        seen = true;
        output = num(c.usage.output_tokens); // 누적값 → 교체
      }
    },
    result() {
      if (!seen) return null;
      const usage: Usage = { input, output };
      if (cachedInput != null) usage.cachedInput = cachedInput;
      return usage;
    },
  };
}
