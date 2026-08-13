import { expect, test } from 'bun:test';

import { consumeGoogleMeetStart, storeGoogleMeetStart } from '../../src/lib/google-meet-reminder';

class MapStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('consumes a Google Meet start session exactly once', () => {
  const storage = new MapStorage();
  storeGoogleMeetStart(storage, '550e8400-e29b-41d4-a716-446655440000');
  expect(consumeGoogleMeetStart(storage)).toBe('550e8400-e29b-41d4-a716-446655440000');
  expect(consumeGoogleMeetStart(storage)).toBeNull();
});
