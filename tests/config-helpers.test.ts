import { describe, it, expect } from 'vitest';
import { setNestedValue } from '../src/agent/tools/builtin/config-helpers.js';

describe('setNestedValue', () => {
    it('sets a top-level value', () => {
        const obj = { a: 1 };
        const { oldValue } = setNestedValue(obj, 'a', 2);
        expect(obj.a).toBe(2);
        expect(oldValue).toBe(1);
    });

    it('sets a nested value', () => {
        const obj = { a: { b: { c: 1 } } };
        setNestedValue(obj, 'a.b.c', 42);
        expect(obj.a.b.c).toBe(42);
    });

    it('creates intermediate objects', () => {
        const obj: any = {};
        setNestedValue(obj, 'a.b.c', 'hello');
        expect(obj.a.b.c).toBe('hello');
    });

    it('blocks __proto__ pollution', () => {
        const obj = {};
        expect(() => setNestedValue(obj, '__proto__.polluted', true)).toThrow('Forbidden');
    });

    it('blocks constructor pollution', () => {
        const obj = {};
        expect(() => setNestedValue(obj, 'constructor.prototype.polluted', true)).toThrow('Forbidden');
    });

    it('blocks prototype pollution', () => {
        const obj = {};
        expect(() => setNestedValue(obj, 'a.prototype.polluted', true)).toThrow('Forbidden');
    });
});
