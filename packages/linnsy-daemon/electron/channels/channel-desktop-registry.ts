import { isChannelDesktopAction } from '../../src/domains/desktop-integration/definitions/desktop-channel-contract.js';

import type {
  ChannelDesktopAction,
  ChannelDesktopController,
  ChannelDesktopStatus,
  ChannelDesktopStatusListener
} from './types.js';

export class ChannelDesktopRegistry {
  private readonly controllers = new Map<string, ChannelDesktopController>();
  private readonly controllerUnsubscribers = new Map<string, () => void>();
  private readonly listeners = new Set<ChannelDesktopStatusListener>();

  register(controller: ChannelDesktopController): void {
    if (this.controllers.has(controller.channelId)) {
      throw new Error(`desktop channel controller already registered: ${controller.channelId}`);
    }
    this.controllers.set(controller.channelId, controller);
    this.controllerUnsubscribers.set(controller.channelId, controller.subscribe((status) => {
      for (const listener of this.listeners) {
        listener(status);
      }
    }));
  }

  get(channelId: string): ChannelDesktopController {
    const controller = this.controllers.get(channelId);
    if (controller === undefined) {
      throw new Error(`unknown desktop channel: ${channelId}`);
    }
    return controller;
  }

  async list(): Promise<ChannelDesktopStatus[]> {
    return Promise.all([...this.controllers.values()].map((controller) => controller.getStatus()));
  }

  async invoke(channelId: string, action: unknown): Promise<ChannelDesktopStatus> {
    if (!isChannelDesktopAction(action)) {
      throw new Error('invalid desktop channel action');
    }
    return this.invokeValidated(channelId, action);
  }

  subscribeAll(listener: ChannelDesktopStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async disposeAll(): Promise<void> {
    for (const unsubscribe of this.controllerUnsubscribers.values()) {
      unsubscribe();
    }
    this.controllerUnsubscribers.clear();
    this.listeners.clear();
    await Promise.all([...this.controllers.values()].map((controller) => controller.dispose()));
  }

  private invokeValidated(channelId: string, action: ChannelDesktopAction): Promise<ChannelDesktopStatus> {
    const controller = this.get(channelId);
    switch (action.type) {
      case 'start':
        return controller.start();
      case 'stop':
        return controller.stop();
      case 'reconnect-network':
        return controller.reconnectNetwork();
      case 'delete-account':
        return controller.deleteAccount();
      case 'request-qr-code':
        return controller.requestQrCode();
      case 'set-auto-connect':
        return controller.setAutoConnect(action.enabled);
    }
  }
}
