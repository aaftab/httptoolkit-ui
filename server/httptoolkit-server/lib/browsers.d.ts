import * as getBrowserLauncherCb from '@httptoolkit/browser-launcher';
import { LaunchOptions, BrowserInstance, Browser } from '@httptoolkit/browser-launcher';
export { BrowserInstance, Browser };
export declare function checkBrowserConfig(configPath: string): Promise<void>;
export declare const getAvailableBrowsers: (configPath: string) => Promise<getBrowserLauncherCb.Browser[]>;
export { LaunchOptions };
export declare const launchBrowser: (url: string, options: LaunchOptions, configPath: string) => Promise<getBrowserLauncherCb.BrowserInstance>;
