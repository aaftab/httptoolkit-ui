"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchBrowser = exports.getAvailableBrowsers = exports.checkBrowserConfig = void 0;
const path = require("path");
const util_1 = require("util");
const getBrowserLauncherCb = require("@httptoolkit/browser-launcher");
const browser_launcher_1 = require("@httptoolkit/browser-launcher");
const error_tracking_1 = require("./error-tracking");
const promise_1 = require("./util/promise");
const error_1 = require("./util/error");
const fs_1 = require("./util/fs");
const getBrowserLauncher = (0, util_1.promisify)(getBrowserLauncherCb);
const updateBrowserCache = (0, util_1.promisify)(browser_launcher_1.update);
const browserConfigPath = (configPath) => path.join(configPath, 'browsers.json');
async function checkBrowserConfig(configPath) {
    // It's not clear why, but sometimes the browser config can become corrupted, so it's not valid JSON
    // If that happens browser-launcher can hit issues. To avoid that entirely, we check it here on startup.
    const browserConfig = browserConfigPath(configPath);
    try {
        const rawConfig = await (0, fs_1.readFile)(browserConfig, 'utf8');
        JSON.parse(rawConfig);
    }
    catch (error) {
        if ((0, error_1.isErrorLike)(error) && error.code === 'ENOENT')
            return;
        console.warn(`Failed to read browser config cache from ${browserConfig}, clearing.`, error);
        return (0, fs_1.deleteFile)(browserConfig).catch((err) => {
            // There may be possible races around here - as long as the file's gone, we're happy
            if ((0, error_1.isErrorLike)(err) && err.code === 'ENOENT')
                return;
            console.error('Failed to clear broken config file:', err);
            (0, error_tracking_1.reportError)(err);
        });
    }
}
exports.checkBrowserConfig = checkBrowserConfig;
let launcher;
function getLauncher(configPath) {
    if (!launcher) {
        const browserConfig = browserConfigPath(configPath);
        launcher = getBrowserLauncher(browserConfig);
        launcher.then(async () => {
            // Async after first creating the launcher, we trigger a background cache update.
            // This can be *synchronously* expensive (spawns 10s of procs, 10+ms sync per
            // spawn on unix-based OSs) so defer briefly.
            await (0, promise_1.delay)(2000);
            try {
                await updateBrowserCache(browserConfig);
                console.log('Browser cache updated');
                // Need to reload the launcher after updating the cache:
                launcher = getBrowserLauncher(browserConfig);
            }
            catch (e) {
                (0, error_tracking_1.reportError)(e);
            }
        });
        // Reset & retry if this fails somehow:
        launcher.catch((e) => {
            (0, error_tracking_1.reportError)(e);
            launcher = undefined;
        });
    }
    return launcher;
}
const getAvailableBrowsers = async (configPath) => {
    return (await getLauncher(configPath)).browsers;
};
exports.getAvailableBrowsers = getAvailableBrowsers;
const launchBrowser = async (url, options, configPath) => {
    const launcher = await getLauncher(configPath);
    const browserInstance = await (0, util_1.promisify)(launcher)(url, options);
    browserInstance.process.on('error', (e) => {
        // If nothing else is listening for this error, this acts as default
        // fallback error handling: log & report & don't crash.
        if (browserInstance.process.listenerCount('error') === 1) {
            console.log('Browser launch error');
            (0, error_tracking_1.reportError)(e);
        }
    });
    return browserInstance;
};
exports.launchBrowser = launchBrowser;
//# sourceMappingURL=browsers.js.map