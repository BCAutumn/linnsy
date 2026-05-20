import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';

import { scanBoundaryViolations } from '../../scripts/guard-boundary.js';

describe('boundary guard', () => {
  test('reports forbidden imports, any annotations, and forbidden LLM SDK dependencies', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'linnsy-boundary-'));

    try {
      await writeFile(
        join(projectRoot, 'package.json'),
        JSON.stringify({
          dependencies: {
            '@ai-sdk/openai': '^1.0.0',
            openai: '^5.19.1'
          }
        })
      );

      await writeFile(
        join(projectRoot, 'bad.ts'),
        [
          "import '../../src/app-hosts/linnya/example';",
          "import '/Users/tiansi/code/linnya/src/infra/adapters/llm/adapter-factory';",
          "import '@linnlabs/linnkit/runtime-kernel/internal/foo';",
          'const value: any = {};',
          'const cast = value as any;',
          'const generic = new Set<any>();',
          'const nested = new Map<string, any>();'
        ].join('\n')
      );

      const violations = await scanBoundaryViolations(projectRoot);

      expect(violations.map((violation) => violation.rule)).toEqual([
        'no-linnya-internal-import',
        'no-linnya-llm-adapter-import',
        'no-linnkit-internal-import',
        'no-any-annotation',
        'no-any-annotation',
        'no-any-annotation',
        'no-any-annotation',
        'no-third-party-llm-sdk'
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('reports unsafe casts in renderer daemon REST boundary', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'linnsy-boundary-'));

    try {
      const daemonLibDir = join(projectRoot, 'app/renderer/src/lib');
      await mkdir(daemonLibDir, { recursive: true });
      await writeFile(
        join(daemonLibDir, 'daemon-client.ts'),
        [
          'async function requestJson<T>(response: Response): Promise<T> {',
          '  const body = await response.json() as unknown;',
          '  return body as T;',
          '}'
        ].join('\n')
      );

      const violations = await scanBoundaryViolations(projectRoot);

      expect(violations.map((violation) => violation.rule)).toEqual([
        'no-daemon-api-unsafe-cast',
        'no-daemon-api-unsafe-cast'
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('reports renderer payload redeclarations', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'linnsy-boundary-'));

    try {
      const payloadReaderDir = join(projectRoot, 'app/renderer/src/features/chat/projection/helpers');
      await mkdir(payloadReaderDir, { recursive: true });
      await writeFile(
        join(payloadReaderDir, 'payload-readers.ts'),
        [
          'interface ToolCallStartPayload {',
          '  toolCallId: string;',
          '}',
          'type SystemEventPayload = { detail: string };'
        ].join('\n')
      );

      const violations = await scanBoundaryViolations(projectRoot);

      expect(violations.map((violation) => violation.rule)).toEqual([
        'no-renderer-payload-redeclare',
        'no-renderer-payload-redeclare'
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('reports root and domain persistence imports from runtime orchestration', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'linnsy-boundary-'));

    try {
      const storeDir = join(projectRoot, 'src/persistence/stores/conversation');
      await mkdir(storeDir, { recursive: true });
      await writeFile(
        join(storeDir, 'sqlite-conversation-store.ts'),
        "import type { TaskRecord } from '../../../runtime/task-tracker/types.js';"
      );
      const domainStoreDir = join(projectRoot, 'src/domains/task/persistence');
      await mkdir(domainStoreDir, { recursive: true });
      await writeFile(
        join(domainStoreDir, 'sqlite-task-store.ts'),
        "import type { TaskRecord } from '../../../runtime/task-tracker/types.js';"
      );

      const violations = await scanBoundaryViolations(projectRoot);

      expect(violations.map((violation) => violation.rule)).toEqual([
        'no-persistence-runtime-import',
        'no-persistence-runtime-import'
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
