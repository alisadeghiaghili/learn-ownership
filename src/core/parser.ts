/**
 * Parser for the Rust teaching subset.
 *
 * Supported shapes:
 *   let x = <expr>;
 *   x = <expr>;
 *   drop(x);
 *   use(x); print(x); read(x);
 *   x.push(<expr>);
 *   { ... }
 *   // comments
 */

import type { TypeExpr, ValueType } from './types';

export type Expr =
  | { kind: 'int'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'string_from'; value: string }
  | { kind: 'vec'; items: number[] }
  | { kind: 'clone'; name: string }
  | { kind: 'ref'; name: string; mutable: boolean };

export type Stmt =
  | { kind: 'let'; name: string; expr: Expr }
  | { kind: 'assign'; name: string; expr: Expr }
  | { kind: 'drop'; name: string }
  | { kind: 'use'; name: string; flavor: 'use' | 'print' | 'read' }
  | { kind: 'push'; name: string; value: number }
  | { kind: 'block'; body: Stmt[] };

export class ParseError extends Error {
  readonly span: string;

  constructor(message: string, span: string) {
    super(message);
    this.name = 'ParseError';
    this.span = span;
  }
}

interface Token {
  type: 'ident' | 'int' | 'str' | 'punct';
  value: string;
  start: number;
  end: number;
}

const PUNCT = new Set([
  '=',
  ';',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '&',
  '*',
  '!',
  ':',
  '::',
  '.',
]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (!ch) break;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '"') {
      const start = i;
      i += 1;
      let value = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else if (next === '"') value += '"';
          else if (next === '\\') value += '\\';
          else value += next ?? '';
          i += 2;
          continue;
        }
        value += src[i];
        i += 1;
      }
      if (i >= src.length) throw new ParseError('unterminated string', src.slice(start));
      i += 1;
      tokens.push({ type: 'str', value, start, end: i });
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < src.length && src[i]! >= '0' && src[i]! <= '9') i += 1;
      tokens.push({ type: 'int', value: src.slice(start, i), start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i += 1;
      tokens.push({ type: 'ident', value: src.slice(start, i), start, end: i });
      continue;
    }
    if (ch === ':' && src[i + 1] === ':') {
      tokens.push({ type: 'punct', value: '::', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (PUNCT.has(ch)) {
      tokens.push({ type: 'punct', value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    throw new ParseError(`unexpected character '${ch}'`, ch);
  }
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.eof()) {
      stmts.push(this.parseStmt());
    }
    return stmts;
  }

  private eof(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ParseError('unexpected end of input', '');
    this.pos += 1;
    return t;
  }

  private expect(value: string): Token {
    const t = this.next();
    if (t.value !== value) {
      throw new ParseError(`expected '${value}', found '${t.value}'`, t.value);
    }
    return t;
  }

  private eat(value: string): boolean {
    const t = this.peek();
    if (t && t.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private parseStmt(): Stmt {
    const t = this.peek();
    if (!t) throw new ParseError('unexpected end of input', '');
    if (t.value === '{') {
      this.next();
      const body: Stmt[] = [];
      while (!this.eof() && this.peek()?.value !== '}') {
        body.push(this.parseStmt());
      }
      this.expect('}');
      return { kind: 'block', body };
    }
    if (t.type === 'ident' && t.value === 'let') {
      this.next();
      // optional `mut` (teaching subset: bindings are assignable either way)
      const maybeMut = this.peek();
      if (maybeMut && maybeMut.type === 'ident' && maybeMut.value === 'mut') {
        this.next();
      }
      const nameTok = this.next();
      if (nameTok.type !== 'ident') {
        throw new ParseError('expected binding name after let', nameTok.value);
      }
      this.expect('=');
      const expr = this.parseExpr();
      this.eat(';');
      return { kind: 'let', name: nameTok.value, expr };
    }
    if (t.type === 'ident' && (t.value === 'drop' || t.value === 'use' || t.value === 'print' || t.value === 'read')) {
      const flavorTok = this.next();
      const flavor = flavorTok.value === 'drop' ? 'drop' : (flavorTok.value as 'use' | 'print' | 'read');
      this.expect('(');
      const nameTok = this.next();
      if (nameTok.type !== 'ident') throw new ParseError('expected identifier', nameTok.value);
      this.expect(')');
      this.eat(';');
      if (flavor === 'drop') return { kind: 'drop', name: nameTok.value };
      return { kind: 'use', name: nameTok.value, flavor };
    }
    if (t.type === 'ident') {
      // assign or method call
      const nameTok = this.next();
      if (this.eat('.')) {
        const method = this.next();
        if (method.value !== 'push') {
          throw new ParseError(`unknown method '${method.value}'`, method.value);
        }
        this.expect('(');
        const numTok = this.next();
        if (numTok.type !== 'int') throw new ParseError('push expects an integer', numTok.value);
        this.expect(')');
        this.eat(';');
        return { kind: 'push', name: nameTok.value, value: Number(numTok.value) };
      }
      this.expect('=');
      const expr = this.parseExpr();
      this.eat(';');
      return { kind: 'assign', name: nameTok.value, expr };
    }
    throw new ParseError(`unexpected token '${t.value}'`, t.value);
  }

  private parseExpr(): Expr {
    const t = this.next();
    if (t.type === 'int') return { kind: 'int', value: Number(t.value) };
    if (t.type === 'str') return { kind: 'str', value: t.value };
    if (t.type === 'ident') {
      if (t.value === 'true') return { kind: 'bool', value: true };
      if (t.value === 'false') return { kind: 'bool', value: false };
      if (t.value === 'String') {
        this.expect('::');
        const from = this.next();
        if (from.value !== 'from') throw new ParseError("expected String::from", from.value);
        this.expect('(');
        const s = this.next();
        if (s.type !== 'str') throw new ParseError('String::from expects a string', s.value);
        this.expect(')');
        return { kind: 'string_from', value: s.value };
      }
      if (t.value === 'vec') {
        if (!this.eat('!')) throw new ParseError("expected vec!", t.value);
        this.expect('[');
        const items: number[] = [];
        if (!this.eat(']')) {
          for (;;) {
            const n = this.next();
            if (n.type !== 'int') throw new ParseError('vec! expects integers', n.value);
            items.push(Number(n.value));
            if (this.eat(']')) break;
            this.expect(',');
          }
        }
        return { kind: 'vec', items };
      }
      // ident or ident.clone()
      const name = t.value;
      if (this.eat('.')) {
        const m = this.next();
        if (m.value !== 'clone') throw new ParseError(`unknown method '${m.value}'`, m.value);
        this.expect('(');
        this.expect(')');
        return { kind: 'clone', name };
      }
      return { kind: 'ident', name };
    }
    if (t.type === 'punct' && t.value === '&') {
      let mutable = false;
      if (this.eat('!')) {
        // &! is invalid; but &mut has mut as ident
      }
      // allow &mut x
      const maybeMut = this.peek();
      if (maybeMut && maybeMut.type === 'ident' && maybeMut.value === 'mut') {
        this.next();
        mutable = true;
      }
      const nameTok = this.next();
      if (nameTok.type !== 'ident') throw new ParseError('expected identifier after &', nameTok.value);
      return { kind: 'ref', name: nameTok.value, mutable };
    }
    throw new ParseError(`unexpected expression token '${t.value}'`, t.value);
  }
}

/** Parse a source snippet into statements. */
export function parse(src: string): Stmt[] {
  const tokens = tokenize(src);
  return new Parser(tokens).parseProgram();
}

/** Parse a single type like `String`, `&str` is not supported; use `&String`. */
export function parseType(src: string): TypeExpr {
  const s = src.trim();
  if (s.startsWith('&')) {
    const rest = s.slice(1).trim();
    const mutable = rest.startsWith('mut ');
    const innerName = (mutable ? rest.slice(4) : rest).trim();
    if (!isValueType(innerName)) throw new ParseError(`unknown type '${innerName}'`, innerName);
    return { kind: 'ref', mutable, inner: innerName };
  }
  if (!isValueType(s)) throw new ParseError(`unknown type '${s}'`, s);
  return { kind: 'named', name: s };
}

export function isValueType(s: string): s is ValueType {
  return s === 'i32' || s === 'bool' || s === 'String' || s === 'Vec<i32>';
}

/** Infer the value type of an expression (without executing). */
export function inferExprType(expr: Expr): { type: ValueType; isRef: boolean; mutableRef: boolean } {
  switch (expr.kind) {
    case 'int':
      return { type: 'i32', isRef: false, mutableRef: false };
    case 'bool':
      return { type: 'bool', isRef: false, mutableRef: false };
    case 'str':
    case 'string_from':
      return { type: 'String', isRef: false, mutableRef: false };
    case 'vec':
      return { type: 'Vec<i32>', isRef: false, mutableRef: false };
    case 'ident':
      return { type: 'i32', isRef: false, mutableRef: false }; // refined at runtime
    case 'clone':
      return { type: 'i32', isRef: false, mutableRef: false };
    case 'ref':
      return { type: 'i32', isRef: true, mutableRef: expr.mutable };
    default:
      return { type: 'i32', isRef: false, mutableRef: false };
  }
}
