import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  NUMERIC_CODE_LENGTH,
  NUMERIC_CODE_PATTERN,
  assignUniqueNumericCode,
  generateNumericCode,
  normalizeNumericCodeInput,
  normalizeUserCodeInput,
} from './numeric-code';

describe('generateNumericCode', () => {
  it('always returns a 6-character, zero-padded digit string', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateNumericCode();
      expect(code).toHaveLength(NUMERIC_CODE_LENGTH);
      expect(code).toMatch(NUMERIC_CODE_PATTERN);
    }
  });

  it('can produce a leading-zero code (never trims/parses to number)', () => {
    // Statistically near-certain within a modest number of draws (1 in 10
    // chance per draw of a leading zero) - deterministic enough not to be
    // flaky, and directly proves no numeric coercion drops the padding.
    const codes = Array.from({ length: 500 }, () => generateNumericCode());
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });
});

describe('normalizeNumericCodeInput', () => {
  it('accepts a raw 6-digit code unchanged', () => {
    expect(normalizeNumericCodeInput('042981')).toBe('042981');
    expect(normalizeNumericCodeInput('000000')).toBe('000000');
  });

  it('accepts the display format with a dash and strips it', () => {
    expect(normalizeNumericCodeInput('042-981')).toBe('042981');
  });

  it('rejects malformed input without throwing', () => {
    expect(normalizeNumericCodeInput('')).toBeNull();
    expect(normalizeNumericCodeInput('12345')).toBeNull();
    expect(normalizeNumericCodeInput('1234567')).toBeNull();
    expect(normalizeNumericCodeInput('12a456')).toBeNull();
    expect(normalizeNumericCodeInput('abcdef')).toBeNull();
    expect(normalizeNumericCodeInput('123-45')).toBeNull();
    expect(normalizeNumericCodeInput('1-23456')).toBeNull();
    expect(normalizeNumericCodeInput("123456' OR '1'='1")).toBeNull();
  });
});

function buildMockEm(behavior: {
  flushResults: (() => Promise<void>)[];
}): EntityManager {
  let call = 0;
  const flush = jest.fn().mockImplementation(() => {
    const result = behavior.flushResults[call] ?? behavior.flushResults.at(-1);
    call += 1;
    return result();
  });
  const trx = { persist: jest.fn(), flush, persistAndFlush: flush };
  const transactional = jest
    .fn()
    .mockImplementation((cb: (trx: unknown) => unknown) => cb(trx));
  return { transactional } as unknown as EntityManager;
}

describe('assignUniqueNumericCode', () => {
  it('succeeds on the first attempt when there is no collision', async () => {
    const em = buildMockEm({ flushResults: [() => Promise.resolve()] });
    const attempt = jest
      .fn()
      .mockImplementation(async (trx: { flush: () => Promise<void> }) => {
        await trx.flush();
      });

    await assignUniqueNumericCode(em, attempt, 'some_unique_index');

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries with a new code after a collision on the named constraint', async () => {
    const collision = new UniqueConstraintViolationException(
      new Error(
        'duplicate key value violates unique constraint "target_unique_index"',
      ),
    );
    let call = 0;
    const em = buildMockEm({
      flushResults: [
        () => Promise.reject(collision),
        () => Promise.reject(collision),
        () => Promise.resolve(),
      ],
    });
    const codesSeen: string[] = [];
    const attempt = async (
      trx: { flush: () => Promise<void> },
      code: string,
    ) => {
      codesSeen.push(code);
      call += 1;
      await trx.flush();
    };

    await assignUniqueNumericCode(em, attempt, 'target_unique_index');

    expect(call).toBe(3);
    expect(new Set(codesSeen).size).toBe(3);
  });

  it('propagates a non-collision error immediately, without retrying', async () => {
    const otherError = new Error('connection lost');
    const em = buildMockEm({
      flushResults: [() => Promise.reject(otherError)],
    });
    const attempt = jest
      .fn()
      .mockImplementation(async (trx: { flush: () => Promise<void> }) => {
        await trx.flush();
      });

    await expect(
      assignUniqueNumericCode(em, attempt, 'target_unique_index'),
    ).rejects.toBe(otherError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('throws a controlled error after exhausting all attempts on repeated collisions', async () => {
    const collision = new UniqueConstraintViolationException(
      new Error(
        'duplicate key value violates unique constraint "target_unique_index"',
      ),
    );
    const em = buildMockEm({ flushResults: [() => Promise.reject(collision)] });
    const attempt = async (trx: { flush: () => Promise<void> }) => {
      await trx.flush();
    };

    await expect(
      assignUniqueNumericCode(em, attempt, 'target_unique_index'),
    ).rejects.toThrow(/unable to generate a unique numeric code/i);
  });
});

describe('normalizeUserCodeInput', () => {
  it.each([
    ['123456', '123456'],
    ['123-456', '123456'],
    ['U123-456', '123456'],
    ['u123456', '123456'],
  ])('accepts %p as the user code %p', (input, expected) => {
    expect(normalizeUserCodeInput(input)).toBe(expected);
  });

  it.each(['U12-3456', 'UU123456', 'Tomasz', 'U', ''])(
    'rejects %p',
    (input) => {
      expect(normalizeUserCodeInput(input)).toBeNull();
    },
  );
});
