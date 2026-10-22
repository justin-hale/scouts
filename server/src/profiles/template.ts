/**
 * Path templates map between concrete relative paths and named variables.
 *
 *   {name}     one path segment (no "/")
 *   {name:8}   exactly 8 characters, no "/" (lets two variables share a segment)
 *   {name**}   one or more segments, may contain "/"
 *
 * Literal text matches case-insensitively, since emulators and filesystems
 * disagree on case ("Nintendo 3DS" vs "nintendo 3ds"); captured values keep
 * the case found on disk.
 */
export type Vars = Record<string, string>;

interface Compiled {
  regex: RegExp;
  names: string[];
}

const TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)(\*\*|:\d+)?\}/g;
const cache = new Map<string, Compiled>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(template: string): Compiled {
  const hit = cache.get(template);
  if (hit) return hit;
  const names: string[] = [];
  let pattern = '';
  let last = 0;
  for (const m of template.matchAll(TOKEN)) {
    pattern += escapeRegex(template.slice(last, m.index));
    const [, name, mod] = m;
    if (names.includes(name!)) throw new Error(`Template "${template}" repeats {${name}}`);
    names.push(name!);
    if (mod === '**') pattern += '(.+)';
    else if (mod?.startsWith(':')) pattern += `([^/]{${mod.slice(1)}})`;
    else pattern += '([^/]+)';
    last = m.index! + m[0].length;
  }
  pattern += escapeRegex(template.slice(last));
  const compiled = { regex: new RegExp(`^${pattern}$`, 'i'), names };
  cache.set(template, compiled);
  return compiled;
}

export function templateVars(template: string): string[] {
  return compile(template).names;
}

export function matchTemplate(template: string, value: string): Vars | null {
  const { regex, names } = compile(template);
  const m = regex.exec(normalizePath(value));
  if (!m) return null;
  const vars: Vars = {};
  names.forEach((n, i) => (vars[n] = m[i + 1]!));
  return vars;
}

/** Render a template. Returns null if a variable is missing or would escape its slot. */
export function renderTemplate(template: string, vars: Vars): string | null {
  let failed = false;
  const out = template.replace(TOKEN, (_all, name: string, mod: string | undefined) => {
    const v = vars[name];
    if (v === undefined || v === '') return ((failed = true), '');
    if (mod !== '**' && v.includes('/')) return ((failed = true), '');
    if (mod?.startsWith(':') && v.length !== Number(mod.slice(1))) return ((failed = true), '');
    return v;
  });
  if (failed) return null;
  return isSafeRelative(out) ? out : null;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

/** True for a relative path with no "..", "." or empty segments. */
export function isSafeRelative(p: string): boolean {
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
