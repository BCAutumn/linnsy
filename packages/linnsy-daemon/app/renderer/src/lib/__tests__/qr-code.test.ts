import { createQrSvgDataUri } from '../qr-code.js';

describe('createQrSvgDataUri', () => {
  it('renders a QR payload as an inline SVG image', () => {
    const dataUri = createQrSvgDataUri('https://example.com/wechat-login-token');

    expect(dataUri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(dataUri)).toContain('<path fill="#111"');
    expect(decodeURIComponent(dataUri)).not.toContain('https://example.com/wechat-login-token');
  });
});
