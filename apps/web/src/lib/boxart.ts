/** Fills Twitch's `{width}x{height}` box-art template. */
export function boxArt(url: string, width: number, height: number): string {
  return url
    .replace('{width}', String(width))
    .replace('{height}', String(height));
}
