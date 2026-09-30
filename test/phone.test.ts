/**
 * 手机壳 (client/phone.ts): the one message line. One line at a time, the more urgent first (and cutting in), the
 * same words once, stale news dropped, each line on screen ON_S..ON_MAX_S.
 */
import { describe, expect, it } from 'vitest';
import { MessageQueue, ON_MAX_S, ON_S, PRIO, STALE_S } from '../client/phone.js';

describe('the phone message line', () => {
  it('shows one line at a time, each for ON_S (longer text longer, never past ON_MAX_S)', () => {
    const q = new MessageQueue();
    q.push('a', PRIO.news, 0); q.push('b', PRIO.news, 0);
    expect(q.step(0)?.text).toBe('a');
    expect(q.step(ON_S - 0.01)?.text).toBe('a');
    expect(q.step(ON_S + 0.1)?.text).toBe('b');
    q.push('x'.repeat(200), PRIO.news, 10);
    q.step(10);
    expect(q.step(10 + ON_MAX_S - 0.01)).not.toBeNull();
    expect(q.step(10 + ON_MAX_S + 0.01)).toBeNull();
  });

  it('the urgent first, and it cuts in; the one it displaced comes back after', () => {
    const q = new MessageQueue();
    q.push('news', PRIO.news, 0);
    expect(q.step(0)?.text).toBe('news');
    q.push('you were hit', PRIO.hurt, 1);
    expect(q.step(1)?.text).toBe('you were hit');
    expect(q.step(1 + ON_MAX_S + 0.1)?.text).toBe('news');
  });

  it('the same words twice show once; stale news is dropped; everything is in the history', () => {
    const q = new MessageQueue();
    q.push('same', PRIO.note, 0); q.push('same', PRIO.note, 0.5);
    q.push('old', PRIO.news, 0);
    q.step(0);
    expect(q.step(STALE_S + 1)).toBeNull(); // 'old' waited too long
    q.log('public line', 20);
    expect(q.history.map((h) => h.text)).toEqual(['same', 'same', 'old', 'public line']);
  });

  it('a tap can hold a line up, or put it away', () => {
    const q = new MessageQueue();
    q.push('hold me', PRIO.goal, 0);
    q.step(0); q.hold(0, 8);
    expect(q.step(7)?.text).toBe('hold me');
    q.dismiss();
    expect(q.step(7.1)).toBeNull();
  });
});
