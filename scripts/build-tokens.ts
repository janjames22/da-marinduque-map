// Turns design/tokens.json into src/app/tokens.css, so the app's colors, type and spacing come
// from the signed-off design. Run npm run build:tokens after the tokens change. A unit test fails
// when the CSS is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const TOKENS_PATH = join(ROOT, 'design', 'tokens.json');
export const CSS_PATH = join(ROOT, 'src', 'app', 'tokens.css');

interface Token {
  $type: string;
  $value: unknown;
}
interface Group {
  [key: string]: Group | Token | string;
}
interface Shadow {
  color: string;
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
}

const isToken = (node: unknown): node is Token => typeof node === 'object' && node !== null && '$value' in node;

// semantic.bg.page becomes --bg-page. Every other group keeps its name: color.green.900 is --color-green-900.
export function varName(path: string[]): string {
  return `--${(path[0] === 'semantic' ? path.slice(1) : path).join('-')}`;
}

function cssValue(token: Token, path: string[]): string {
  const value = token.$value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const alias = /^\{(.+)\}$/.exec(value);
    return alias ? `var(${varName(alias[1].split('.'))})` : value;
  }
  if (token.$type === 'shadow') {
    const { offsetX, offsetY, blur, spread, color } = value as Shadow;
    return `${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
  }
  throw new Error(`${path.join('.')}: a ${token.$type} token can't be turned into CSS`);
}

export function tokensToCss(tokens: Group): string {
  const lines: string[] = [];
  const walk = (node: Group, path: string[]) => {
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      const childPath = [...path, key];
      if (isToken(child)) lines.push(`  ${varName(childPath)}: ${cssValue(child, childPath)};`);
      else if (typeof child === 'object') walk(child, childPath);
    }
  };
  walk(tokens, []);
  return `/* Made by npm run build:tokens from design/tokens.json. Don't edit it by hand. */\n:root {\n${lines.join('\n')}\n}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(CSS_PATH, tokensToCss(JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as Group));
  console.log(`Wrote ${CSS_PATH}`);
}
