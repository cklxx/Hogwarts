// Runes: a tiny S-expression language. Spells are programs; the world is the only I/O.

export type Node =
  | { t: 'num'; v: number; line: number; col: number }
  | { t: 'str'; v: string; line: number; col: number }
  | { t: 'sym'; v: string; line: number; col: number }
  | { t: 'kw'; v: string; line: number; col: number }
  | { t: 'list'; items: Node[]; line: number; col: number };

export class RuneError extends Error {
  constructor(message: string, public line = 0, public col = 0) {
    super(line ? `${message} (line ${line}, col ${col})` : message);
  }
}

const MAX_SOURCE = 4000;
const MAX_DEPTH = 24;

export function parse(source: string): Node[] {
  if (source.length > MAX_SOURCE) throw new RuneError(`spell source too long (${source.length} > ${MAX_SOURCE} chars)`);
  let i = 0;
  let line = 1;
  let col = 1;
  const peek = () => source[i];
  const next = () => {
    const c = source[i++];
    if (c === '\n') { line++; col = 1; } else col++;
    return c;
  };
  const skip = () => {
    while (i < source.length) {
      const c = peek();
      if (c === ';') { while (i < source.length && peek() !== '\n') next(); }
      else if (/\s/.test(c)) next();
      else break;
    }
  };
  const readForm = (depth: number): Node => {
    skip();
    if (i >= source.length) throw new RuneError('unexpected end of spell', line, col);
    if (depth > MAX_DEPTH) throw new RuneError(`nesting deeper than ${MAX_DEPTH}`, line, col);
    const l = line, c0 = col;
    const c = peek();
    if (c === '(' || c === '[') {
      const close = c === '(' ? ')' : ']';
      next();
      const items: Node[] = [];
      for (;;) {
        skip();
        if (i >= source.length) throw new RuneError(`unclosed '${c}'`, l, c0);
        if (peek() === close) { next(); break; }
        if (peek() === ')' || peek() === ']') throw new RuneError(`mismatched '${peek()}'`, line, col);
        items.push(readForm(depth + 1));
      }
      return { t: 'list', items, line: l, col: c0 };
    }
    if (c === ')' || c === ']') throw new RuneError(`unexpected '${c}'`, l, c0);
    if (c === '"') {
      next();
      let s = '';
      while (i < source.length && peek() !== '"') {
        let ch = next();
        if (ch === '\\' && i < source.length) {
          ch = next();
          if (ch === 'n') ch = '\n';
        }
        s += ch;
      }
      if (i >= source.length) throw new RuneError('unclosed string', l, c0);
      next();
      return { t: 'str', v: s, line: l, col: c0 };
    }
    let tok = '';
    while (i < source.length && !/[\s()\[\];"]/.test(peek())) tok += next();
    if (/^-?(\d+\.?\d*|\.\d+)$/.test(tok)) return { t: 'num', v: Number(tok), line: l, col: c0 };
    if (tok.startsWith(':') && tok.length > 1) return { t: 'kw', v: tok.slice(1), line: l, col: c0 };
    if (tok === 'true' || tok === 'false' || tok === 'nil') return { t: 'sym', v: tok, line: l, col: c0 };
    return { t: 'sym', v: tok, line: l, col: c0 };
  };
  const out: Node[] = [];
  for (;;) {
    skip();
    if (i >= source.length) break;
    out.push(readForm(0));
  }
  if (!out.length) throw new RuneError('empty spell');
  return out;
}

export function show(n: Node): string {
  switch (n.t) {
    case 'num': return String(n.v);
    case 'str': return JSON.stringify(n.v);
    case 'sym': return n.v;
    case 'kw': return ':' + n.v;
    case 'list': return '(' + n.items.map(show).join(' ') + ')';
  }
}
