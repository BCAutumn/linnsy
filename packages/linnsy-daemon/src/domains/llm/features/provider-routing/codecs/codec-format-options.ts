import {
  createFenceRegistry,
  type FenceRegistry
} from '@linnlabs/linnkit/context-manager';

export interface CodecFormatOptions {
  fenceRegistry: FenceRegistry;
}

export function resolveCodecFormatOptions(options?: CodecFormatOptions): CodecFormatOptions {
  return options ?? {
    fenceRegistry: createFenceRegistry([])
  };
}
