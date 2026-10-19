// Preloaded into the demo server (`node --import`): every outgoing fetch fails,
// so no request ever reaches Twitch even if credentials were real.
globalThis.fetch = () =>
  Promise.reject(new TypeError('network disabled for screenshot run'));
