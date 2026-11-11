import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSS_PATH, TOKENS_PATH, tokensToCss, varName } from '../scripts/build-tokens';

describe('design tokens', () => {
  it("keeps the app's CSS in step with design/tokens.json", () => {
    const expected = tokensToCss(JSON.parse(readFileSync(TOKENS_PATH, 'utf8')));
    // Git may check the file out with Windows line endings.
    expect(readFileSync(CSS_PATH, 'utf8').replace(/\r\n/g, '\n'), 'Run npm run build:tokens').toBe(expected);
  });

  it('names variables after their place in the file, without the semantic group', () => {
    expect(varName(['color', 'green', '900'])).toBe('--color-green-900');
    expect(varName(['semantic', 'bg', 'page'])).toBe('--bg-page');
  });

  it('turns aliases into variables, and shadows into CSS', () => {
    const css = tokensToCss({
      color: { green: { '900': { $type: 'color', $value: '#0f3f22' } } },
      semantic: { bg: { hero: { $type: 'color', $value: '{color.green.900}' } } },
      shadow: { card: { $type: 'shadow', $value: { color: '#0000000f', offsetX: '0px', offsetY: '1px', blur: '3px', spread: '0px' } } },
      font: { weight: { bold: { $type: 'fontWeight', $value: 700 } } },
    });
    expect(css).toContain('  --color-green-900: #0f3f22;');
    expect(css).toContain('  --bg-hero: var(--color-green-900);');
    expect(css).toContain('  --shadow-card: 0px 1px 3px 0px #0000000f;');
    expect(css).toContain('  --font-weight-bold: 700;');
  });

  it('refuses a token it has no CSS for', () => {
    expect(() => tokensToCss({ odd: { $type: 'cubicBezier', $value: [0, 0, 1, 1] } })).toThrow(/odd/);
  });
});
