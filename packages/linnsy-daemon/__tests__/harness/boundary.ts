import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanBoundaryViolations } from '../../scripts/guard-boundary.js';

export async function assertNoBoundaryViolation(projectRoot = resolvePackageRoot()): Promise<void> {
  const violations = await scanBoundaryViolations(projectRoot);
  if (violations.length === 0) {
    return;
  }

  const message = violations
    .map((violation) => `${violation.file}:${String(violation.line)} ${violation.rule} ${violation.message}`)
    .join('\n');

  throw new Error(message);
}

function resolvePackageRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '../..');
}
