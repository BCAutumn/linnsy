import type { LoggerPort } from '../../../shared/ports.js';
import type { InboundHandler } from '../../../domains/channel/definitions/types.js';
import type { ChannelAdapterRegistryPort } from '../../../domains/channel/features/registry/channel-adapter-registry.js';
import type { RunSpawnerPort } from '../../../domains/agent-run/features/run-spawner/types.js';
import type { SystemPromptAssemblerPort } from '../../../domains/agent-run/features/system-prompt/types.js';
import type { CronSchedulerPort } from '../../../domains/cron/features/scheduler/definitions/types.js';
import type { TerminalBindingServicePort } from '../../../domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';

export interface StartDaemonChannelsOptions {
  channelRegistry: ChannelAdapterRegistryPort;
  cronScheduler?: CronSchedulerPort;
  inboundHandler: InboundHandler;
  logger: LoggerPort;
  terminalBindingService: TerminalBindingServicePort;
}

export async function startDaemonChannels(options: StartDaemonChannelsOptions): Promise<void> {
  await options.terminalBindingService.ensureDefaultBinding();
  for (const adapter of options.channelRegistry.adapters()) {
    await adapter.start(options.inboundHandler);
  }
  await options.cronScheduler?.start();
  options.logger.info('linnsy daemon started', {
    channels: Array.from(options.channelRegistry.platforms()).map(String)
  });
}

export interface StopDaemonChannelsOptions {
  channelRegistry: ChannelAdapterRegistryPort;
  cronScheduler?: CronSchedulerPort;
  logger: LoggerPort;
  spawner: RunSpawnerPort;
  systemPromptAssembler: SystemPromptAssemblerPort;
}

export async function stopDaemonChannels(options: StopDaemonChannelsOptions): Promise<void> {
  await options.cronScheduler?.stop();
  for (const adapter of options.channelRegistry.adapters()) {
    await adapter.stop();
  }
  await options.spawner.drain();
  options.systemPromptAssembler.clear();
  options.logger.info('linnsy daemon stopped');
}
