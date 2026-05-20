import { join } from 'node:path';

import { loadLinnsyConfig } from '../../../src/config/loader.js';
import {
  inspectWechatGatewayPidfile,
  type WechatGatewayPidfileInspection
} from '../../../src/domains/channel/features/wechat/gateway/pidfile-inspector.js';
import { createWechatGatewayPidfileStore } from '../../../src/domains/channel/features/wechat/gateway/pidfile-store.js';

export interface InspectDesktopWechatGatewayPidfileOptions {
  logger?: Pick<Console, 'info' | 'warn'>;
}

// Electron 启动期的"上次孤儿"探查。inspect 内部已经把 stale 文件清掉，
// 所以 absent / stale 都只是日志通知，不影响后续 controller.start() 的 probe 流程；
// live 时主动告诉用户"端口上有上次没干净退出的 wechat-gateway"，方便他自行 lsof / kill。
// 不在这里 SIGTERM 是为了不打断 dev 时手动 `npm run wechat-gateway` 调试场景——
// 与 docs/02 §4.10n 桌面通道控制层"adopt 行为只在 start 路径合法"对账。
export async function inspectDesktopWechatGatewayPidfile(
  options: InspectDesktopWechatGatewayPidfileOptions = {}
): Promise<WechatGatewayPidfileInspection | null> {
  const logger = options.logger ?? console;

  let stateDir: string;
  try {
    const config = await loadLinnsyConfig();
    stateDir = join(config.home, 'wechat-gateway');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[linnsy electron] cannot resolve wechat gateway pidfile path: ${message}`);
    return null;
  }

  const store = createWechatGatewayPidfileStore({ stateDir });
  const inspection = await inspectWechatGatewayPidfile({ store });

  switch (inspection.kind) {
    case 'absent':
      return inspection;
    case 'stale':
      logger.info(
        `[linnsy electron] cleared stale wechat gateway pidfile (PID ${inspection.pidfile.pid.toString()}, reason ${inspection.reason})`
      );
      return inspection;
    case 'live':
      logger.warn(
        `[linnsy electron] detected an existing wechat-gateway process (PID ${inspection.pidfile.pid.toString()}, bind ${inspection.pidfile.bind}). Current launch will probe and adopt; if the address is held by an outdated build, stop that process first.`
      );
      return inspection;
  }
}
