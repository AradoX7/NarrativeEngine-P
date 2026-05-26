import { describe, it, expect } from 'vitest';
import { extractJsonRobust } from '../jsonExtract';

describe('extractJsonRobust', () => {
    describe('object root', () => {
        it('parses a clean JSON object', () => {
            const raw = '{"groups":[{"name":"a","factIds":["1"]}]}';
            const { value, parseOk } = extractJsonRobust(raw, { groups: [] });
            expect(parseOk).toBe(true);
            expect(value.groups).toHaveLength(1);
            expect(value.groups[0].name).toBe('a');
        });

        it('strips think blocks before parsing', () => {
            const raw = '<think>reasoning here</think>{"groups":[]}';
            const { value, parseOk } = extractJsonRobust(raw, { groups: [] });
            expect(parseOk).toBe(true);
            expect(value.groups).toHaveLength(0);
        });

        it('strips markdown fences', () => {
            const raw = '```json\n{"groups":[{"name":"x","factIds":["1","2"]}]}\n```';
            const { value, parseOk } = extractJsonRobust(raw, { groups: [] });
            expect(parseOk).toBe(true);
            expect(value.groups[0].name).toBe('x');
        });

        it('recovers from truncated object at depth 1', () => {
            const raw = '{"groups":[{"name":"a","factIds":["1"]},{"name":"b","factIds":["2"';
            const { value, parseOk } = extractJsonRobust(raw, { groups: [] });
            expect(parseOk).toBe(true);
            expect(value.groups).toHaveLength(1);
            expect(value.groups[0].name).toBe('a');
        });

        it('handles escaped strings inside JSON', () => {
            const raw = '{"groups":[{"name":"he said \\"hello\\"","factIds":["1"]}]}';
            const { value, parseOk } = extractJsonRobust(raw, { groups: [] });
            expect(parseOk).toBe(true);
            expect(value.groups[0].name).toBe('he said "hello"');
        });

        it('returns fallback when no JSON found', () => {
            const raw = 'no json here at all';
            const { value, parseOk } = extractJsonRobust(raw, { groups: [] });
            expect(parseOk).toBe(false);
            expect(value.groups).toHaveLength(0);
        });

        it('handles nested objects', () => {
            const raw = '{"a":{"b":2},"c":3}';
            const { value, parseOk } = extractJsonRobust<Record<string, unknown>>(raw, {});
            expect(parseOk).toBe(true);
            expect((value as any).a.b).toBe(2);
        });
    });

    describe('array root', () => {
        it('parses a clean JSON array', () => {
            const raw = '[1, 2, 3]';
            const { value, parseOk } = extractJsonRobust<number[]>(raw, []);
            expect(parseOk).toBe(true);
            expect(value).toEqual([1, 2, 3]);
        });

        it('parses a JSON array of strings', () => {
            const raw = '["014","012","001"]';
            const { value, parseOk } = extractJsonRobust<string[]>(raw, []);
            expect(parseOk).toBe(true);
            expect(value).toEqual(['014', '012', '001']);
        });

        it('recovers from truncated array at depth 1', () => {
            const raw = '["a","b","c';
            const { value, parseOk } = extractJsonRobust<string[]>(raw, []);
            expect(parseOk).toBe(true);
            expect(value).toEqual(['a', 'b']);
        });

        it('handles think blocks + markdown with array', () => {
            const raw = '<think>thinking</think>```json\n[1,2,3]\n```';
            const { value, parseOk } = extractJsonRobust<number[]>(raw, []);
            expect(parseOk).toBe(true);
            expect(value).toEqual([1, 2, 3]);
        });

        it('extracts first root-level JSON when both { and [ present', () => {
            const raw = 'prefix [1,2] and {"a":3}';
            const { value, parseOk } = extractJsonRobust<unknown>(raw, null);
            expect(parseOk).toBe(true);
            expect(Array.isArray(value)).toBe(true);
            expect(value).toEqual([1, 2]);
        });

        it('returns fallback when no array found', () => {
            const raw = 'just text no brackets';
            const { value, parseOk } = extractJsonRobust<string[]>(raw, []);
            expect(parseOk).toBe(false);
            expect(value).toEqual([]);
        });
    });
});