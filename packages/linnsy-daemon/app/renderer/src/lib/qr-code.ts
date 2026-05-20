import QRCode from 'qrcode-terminal/vendor/QRCode/index.js';
import QRErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js';

const QUIET_ZONE_MODULES = 4;

export function createQrSvgDataUri(content: string): string {
  const qrCode = new QRCode(-1, QRErrorCorrectLevel.M);
  qrCode.addData(content);
  qrCode.make();

  const moduleCount = qrCode.getModuleCount();
  const viewBoxSize = moduleCount + QUIET_ZONE_MODULES * 2;
  const darkModules: string[] = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (qrCode.isDark(row, column)) {
        const x = column + QUIET_ZONE_MODULES;
        const y = row + QUIET_ZONE_MODULES;
        darkModules.push(`M${x.toString()} ${y.toString()}h1v1h-1z`);
      }
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize.toString()} ${viewBoxSize.toString()}" shape-rendering="crispEdges">`,
    `<rect width="${viewBoxSize.toString()}" height="${viewBoxSize.toString()}" fill="#fff"/>`,
    `<path fill="#111" d="${darkModules.join(' ')}"/>`,
    '</svg>'
  ].join('');

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
