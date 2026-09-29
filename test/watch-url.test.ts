/** 观战 links in the address bar (client/watch.ts): the fragment, never a query string a server would log. */
import { describe, expect, it } from 'vitest';
import { spectateFromUrl, spectateQuery } from '../client/watch.js';

describe('watch links', () => {
  it('read #watch=<code> and #follow=<handle>, and nothing else', () => {
    expect(spectateFromUrl('http://10.0.0.5:7777/#watch=AbC_12-xyz')).toEqual({ watch: 'AbC_12-xyz' });
    expect(spectateFromUrl('http://10.0.0.5:7777/#follow=p12')).toEqual({ follow: 'p12' });
    expect(spectateFromUrl('http://10.0.0.5:7777/#k=secretkey')).toBeNull();
    expect(spectateFromUrl('http://10.0.0.5:7777/?watch=abcd1234')).toBeNull();
    expect(spectateFromUrl('http://x/#watch=<script>')).toBeNull();
  });
  it('name the realm of a realm-prefixed code so a front door can route it', () => {
    expect(spectateQuery({ watch: '2-AbCdEf' })).toBe('watch=2-AbCdEf&realm=2');
    expect(spectateQuery({ watch: 'AbCdEf' })).toBe('watch=AbCdEf');
    expect(spectateQuery({ follow: 'p3' })).toBe('follow=p3');
  });
});
