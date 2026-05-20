#!/usr/bin/env node

import { Command } from 'commander';

import { createChatCommand } from './chat.js';
import { runDoctor } from './doctor.js';
import type { CliCommand, DoctorRunner } from './types.js';
import { createWechatGatewayCommand } from './wechat-gateway.js';

export type { CliCommand, DoctorRunner } from './types.js';

export interface CreateLinnsyProgramOptions {
  doctor?: DoctorRunner;
  commands?: CliCommand[];
  stdout?: (message: string) => void;
}

export function createLinnsyProgram(options: CreateLinnsyProgramOptions = {}): Command {
  const doctor = options.doctor ?? runDoctor;
  const stdout = options.stdout ?? console.log;
  const program = new Command();

  program.name('linnsy').description('Linnsy daemon CLI').version('0.0.0');

  for (const cliCommand of [
    createDoctorCommand(doctor, stdout),
    createChatCommand({ audit: false }),
    createChatCommand({ audit: true }),
    createWechatGatewayCommand(),
    ...(options.commands ?? [])
  ]) {
    const command = program.command(cliCommand.name).description(cliCommand.description);
    cliCommand.register(command);
  }

  return program;
}

function createDoctorCommand(doctor: DoctorRunner, stdout: (message: string) => void): CliCommand {
  return {
    name: 'doctor',
    description: 'Check local linnsy daemon configuration and runtime prerequisites',
    register(command) {
      command.action(async () => {
        process.exitCode = await runDoctorCommand(doctor, stdout);
      });
    }
  };
}

async function runDoctorCommand(doctor: DoctorRunner, stdout: (message: string) => void): Promise<number> {
  const result = await doctor();
  for (const check of result.checks) {
    const status = check.ok ? 'ok' : 'fail';
    stdout(`${status} ${check.name}: ${check.message}`);
  }

  return result.ok ? 0 : 1;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && (invokedPath.endsWith('/cli/index.ts') || invokedPath.endsWith('/cli.cjs'))) {
  createLinnsyProgram().parseAsync().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';
    console.error(message);
    process.exitCode = 1;
  });
}
