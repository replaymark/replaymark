import { describe, expect, it } from 'vitest';
import { boxArt } from './boxart.ts';

describe('boxArt', () => {
  it('fills the width and height template', () => {
    expect(
      boxArt(
        'https://static-cdn.jtvnw.net/ttv-boxart/33214-{width}x{height}.jpg',
        52,
        72,
      ),
    ).toBe('https://static-cdn.jtvnw.net/ttv-boxart/33214-52x72.jpg');
  });

  it('leaves urls without a template untouched', () => {
    expect(boxArt('https://x/y.jpg', 1, 2)).toBe('https://x/y.jpg');
  });
});
