import type { App } from 'electron';

export interface AutostartController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export function createAutostartController(app: App): AutostartController {
  return {
    isEnabled(): boolean {
      return app.getLoginItemSettings().openAtLogin;
    },

    setEnabled(enabled): void {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true
      });
    }
  };
}
