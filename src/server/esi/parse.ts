// Minimal structural validators for ESI payloads. Each throws EsiParseError naming the bad path.

export class EsiParseError extends Error {
  override name = "EsiParseError";
}

export type Parser<T> = (value: unknown, path: string) => T;

export const integer: Parser<number> = (value, path) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new EsiParseError(`${path}: expected integer`);
  return value;
};

export const finite: Parser<number> = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new EsiParseError(`${path}: expected number`);
  return value;
};

export const string: Parser<string> = (value, path) => {
  if (typeof value !== "string") throw new EsiParseError(`${path}: expected string`);
  return value;
};

export function optional<T>(parse: Parser<T>): Parser<T | null> {
  return (value, path) => (value === undefined || value === null ? null : parse(value, path));
}

export function arrayOf<T>(parse: Parser<T>): Parser<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new EsiParseError(`${path}: expected array`);
    return value.map((item: unknown, i) => parse(item, `${path}[${String(i)}]`));
  };
}

type Shape = Record<string, Parser<unknown>>;
type Parsed<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> };

export function object<S extends Shape>(shape: S): Parser<Parsed<S>> {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EsiParseError(`${path}: expected object`);
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, parse] of Object.entries(shape)) out[key] = parse(record[key], `${path}.${key}`);
    return out as Parsed<S>;
  };
}

export function branded<B extends number>(parse: Parser<number> = integer): Parser<B> {
  return (value, path) => parse(value, path) as B;
}
