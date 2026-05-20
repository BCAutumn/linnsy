import { describe, expect, test } from 'vitest';

import { createLinnsyProgram, type CliCommand, type DoctorRunner } from '../index.js';

describe('createLinnsyProgram', () => {
  test('exposes a doctor command that prints check status', async () => {
    const stdout: string[] = [];
    const doctor: DoctorRunner = () => Promise.resolve({
      ok: true,
      checks: [
        { name: 'config', ok: true, message: 'Config loaded' },
        { name: 'sqlite', ok: true, message: 'SQLite schema ready' }
      ]
    });
    const program = createLinnsyProgram({
      doctor,
      stdout: (message) => stdout.push(message)
    });

    await program.parseAsync(['node', 'linnsy', 'doctor']);

    expect(stdout).toEqual([
      'ok config: Config loaded',
      'ok sqlite: SQLite schema ready'
    ]);
  });

  test('registers extension commands without changing program construction', async () => {
    const stdout: string[] = [];
    const commands: CliCommand[] = [
      {
        name: 'version-json',
        description: 'Print version JSON',
        register(command) {
          command.action(() => {
            stdout.push('{"version":"0.0.0"}');
          });
        }
      }
    ];
    const program = createLinnsyProgram({
      commands,
      stdout: (message) => stdout.push(message)
    });

    await program.parseAsync(['node', 'linnsy', 'version-json']);

    expect(stdout).toEqual(['{"version":"0.0.0"}']);
  });

  test('registers the production chat command', () => {
    const program = createLinnsyProgram();

    expect(program.commands.map((command) => command.name())).toContain('chat');
  });

  test('registers the audit chat command', () => {
    const program = createLinnsyProgram();

    expect(program.commands.map((command) => command.name())).toContain('chat:audit');
  });

  test('registers the wechat gateway command', () => {
    const program = createLinnsyProgram();

    expect(program.commands.map((command) => command.name())).toContain('wechat-gateway');
  });
});
