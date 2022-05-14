"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FreshOpera = exports.FreshBrave = exports.FreshEdgeCanary = exports.FreshEdgeDev = exports.FreshEdgeBeta = exports.FreshEdge = exports.FreshChromiumDev = exports.FreshChromium = exports.FreshChromeCanary = exports.FreshChromeDev = exports.FreshChromeBeta = exports.ExistingChrome = exports.FreshChrome = void 0;
const _ = require("lodash");
const mockttp_1 = require("mockttp");
const browsers_1 = require("../browsers");
const promise_1 = require("../util/promise");
const fs_1 = require("../util/fs");
const process_management_1 = require("../util/process-management");
const hide_warning_server_1 = require("../hide-warning-server");
const error_tracking_1 = require("../error-tracking");
const getBrowserDetails = async (config, variant) => {
    const browsers = await (0, browsers_1.getAvailableBrowsers)(config.configPath);
    // Get the details for the first of these browsers that is installed.
    return _.find(browsers, b => b.name === variant);
};
const getChromiumLaunchOptions = async (browser, config, proxyPort, hideWarningServer) => {
    const certificatePem = await (0, fs_1.readFile)(config.https.certPath, 'utf8');
    const spkiFingerprint = (0, mockttp_1.generateSPKIFingerprint)(certificatePem);
    return {
        browser,
        proxy: `https://127.0.0.1:${proxyPort}`,
        noProxy: [
            // Force even localhost requests to go through the proxy
            // See https://bugs.chromium.org/p/chromium/issues/detail?id=899126#c17
            '<-loopback>',
            // Don't intercept our warning hiding requests. Note that this must be
            // the 2nd rule here, or <-loopback> would override it.
            hideWarningServer.host
        ],
        options: [
            // Trust our CA certificate's fingerprint:
            `--ignore-certificate-errors-spki-list=${spkiFingerprint}`,
            // Avoid annoying extra network noise:
            '--disable-background-networking'
        ]
    };
};
class FreshChromiumBasedInterceptor {
    constructor(config, variantName) {
        this.config = config;
        this.variantName = variantName;
        this.activeBrowsers = {};
    }
    isActive(proxyPort) {
        const browser = this.activeBrowsers[proxyPort];
        return !!browser && !!browser.pid;
    }
    async isActivable() {
        const browserDetails = await getBrowserDetails(this.config, this.variantName);
        return !!browserDetails;
    }
    async activate(proxyPort) {
        if (this.isActive(proxyPort))
            return;
        const hideWarningServer = new hide_warning_server_1.HideWarningServer(this.config);
        await hideWarningServer.start('https://amiusing.httptoolkit.tech');
        const browserDetails = await getBrowserDetails(this.config, this.variantName);
        const browser = await (0, browsers_1.launchBrowser)(hideWarningServer.hideWarningUrl, await getChromiumLaunchOptions(browserDetails ? browserDetails.name : this.variantName, this.config, proxyPort, hideWarningServer), this.config.configPath);
        if (browser.process.stdout)
            browser.process.stdout.pipe(process.stdout);
        if (browser.process.stderr)
            browser.process.stderr.pipe(process.stderr);
        await hideWarningServer.completedPromise;
        await hideWarningServer.stop();
        this.activeBrowsers[proxyPort] = browser;
        browser.process.once('close', async () => {
            delete this.activeBrowsers[proxyPort];
            // Opera has a launch proc that exits immediately in Windows, so we can't clear the profile there.
            if (process.platform === 'win32' && this.variantName === 'opera')
                return;
            await (0, promise_1.delay)(1000); // No hurry, make sure the browser & related processes have all cleaned up
            if (Object.keys(this.activeBrowsers).length === 0 && browserDetails && _.isString(browserDetails.profile)) {
                // If we were the last browser, and we have a profile path, and it's in our config
                // (just in case something's gone wrong) -> delete the profile to reset everything.
                const profilePath = browserDetails.profile;
                if (!profilePath.startsWith(this.config.configPath)) {
                    (0, error_tracking_1.reportError)(`Unexpected ${this.variantName} profile location, not deleting: ${profilePath}`);
                }
                else {
                    const profileFolder = browserDetails.profile;
                    (0, fs_1.deleteFolder)(profileFolder)
                        .catch(async () => {
                        // After 1 error, wait a little and retry
                        await (0, promise_1.delay)(1000);
                        await (0, fs_1.deleteFolder)(profileFolder);
                    }).catch(console.warn); // If it still fails, just give up, not a big deal
                }
            }
        });
        // Delay the approx amount of time it normally takes the browser to really open, just to be sure
        await (0, promise_1.delay)(500);
    }
    async deactivate(proxyPort) {
        if (this.isActive(proxyPort)) {
            const browser = this.activeBrowsers[proxyPort];
            const exitPromise = new Promise((resolve) => browser.process.once('close', resolve));
            browser.stop();
            await exitPromise;
        }
    }
    async deactivateAll() {
        await Promise.all(Object.keys(this.activeBrowsers).map((proxyPort) => this.deactivate(proxyPort)));
    }
}
;
class ExistingChromiumBasedInterceptor {
    constructor(config, variantName) {
        this.config = config;
        this.variantName = variantName;
    }
    async browserDetails() {
        return getBrowserDetails(this.config, this.variantName);
    }
    isActive(proxyPort) {
        const activeBrowser = this.activeBrowser;
        return !!activeBrowser &&
            activeBrowser.proxyPort === proxyPort &&
            !!activeBrowser.browser.pid;
    }
    async isActivable() {
        if (this.activeBrowser)
            return false;
        return !!await this.browserDetails();
    }
    async findExistingPid() {
        const processes = await (0, process_management_1.listRunningProcesses)();
        const browserDetails = await this.browserDetails();
        if (!browserDetails) {
            throw new Error("Can't intercept existing browser without browser details");
        }
        const browserProcesses = processes.filter((proc) => {
            if (process.platform === 'darwin') {
                if (!proc.command.startsWith(browserDetails.command))
                    return false;
                const appBundlePath = proc.command.substring(browserDetails.command.length);
                // Only *.app/Contents/MacOS/* is the main app process:
                return appBundlePath.match(/^\/Contents\/MacOS\//);
            }
            else {
                return proc.bin && (
                // Find a binary that exactly matches the specific command:
                proc.bin === browserDetails.command ||
                    // Or whose binary who's matches the path for this specific variant:
                    proc.bin.includes(`${browserDetails.name}/${browserDetails.type}`));
            }
        });
        const defaultRootProcess = browserProcesses.find(({ args }) => args !== undefined &&
            // Find the main process, skipping any renderer/util processes
            !args.includes('--type=') &&
            // Also skip any non-default profile processes (e.g. our own fresh Chromes)
            !args.includes('--user-data-dir'));
        return defaultRootProcess && defaultRootProcess.pid;
    }
    async activate(proxyPort, options = { closeConfirmed: false }) {
        if (!this.isActivable())
            return;
        const hideWarningServer = new hide_warning_server_1.HideWarningServer(this.config);
        await hideWarningServer.start('https://amiusing.httptoolkit.tech');
        const existingPid = await this.findExistingPid();
        if (existingPid) {
            if (!options.closeConfirmed) {
                // Fail, with metadata requesting the UI to confirm that Chrome should be killed
                throw Object.assign(new Error(`Not killing ${this.variantName}: not confirmed`), { metadata: { closeConfirmRequired: true }, reportable: false });
            }
            if (process.platform === 'win32') {
                (0, process_management_1.windowsClose)(existingPid);
                try {
                    await (0, process_management_1.waitForExit)(existingPid);
                }
                catch (e) {
                    // Try again, but less gently this time:
                    process.kill(existingPid);
                    await (0, process_management_1.waitForExit)(existingPid);
                }
            }
            else {
                process.kill(existingPid);
                await (0, process_management_1.waitForExit)(existingPid);
            }
        }
        const browserDetails = await getBrowserDetails(this.config, this.variantName);
        const launchOptions = await getChromiumLaunchOptions(browserDetails ? browserDetails.name : this.variantName, this.config, proxyPort, hideWarningServer);
        // Remove almost all default arguments. Each of these changes behaviour in maybe unexpected
        // ways, notably including --disable-restore which actively causes problems.
        launchOptions.skipDefaults = true;
        launchOptions.options.push('--no-default-browser-check', '--no-first-run', '--disable-popup-blocking', // Required for hide-warning -> amiusing hop
        // If we killed something, use --restore-last-session to ensure it comes back:
        ...(existingPid ? ['--restore-last-session'] : []), 
        // Passing the URL here instead of passing it to launchBrowser ensures that it isn't
        // opened in a separate window when launching on Mac
        hideWarningServer.hideWarningUrl);
        const browser = await (0, browsers_1.launchBrowser)("", Object.assign(Object.assign({}, launchOptions), { skipDefaults: true, profile: null // Enforce that we use the default profile
         }), this.config.configPath);
        if (browser.process.stdout)
            browser.process.stdout.pipe(process.stdout);
        if (browser.process.stderr)
            browser.process.stderr.pipe(process.stderr);
        await hideWarningServer.completedPromise;
        await hideWarningServer.stop();
        this.activeBrowser = { browser, proxyPort };
        browser.process.once('close', async () => {
            delete this.activeBrowser;
        });
        // Delay the approx amount of time it normally takes the browser to really open, just to be sure
        await (0, promise_1.delay)(500);
    }
    async deactivate(proxyPort) {
        if (this.isActive(proxyPort)) {
            const { browser } = this.activeBrowser;
            if (process.platform === 'win32') {
                // Try to cleanly close if we can, rather than killing Chrome directly:
                try {
                    await (0, process_management_1.windowsClose)(browser.pid)
                        .then(() => (0, process_management_1.waitForExit)(browser.pid));
                    return;
                }
                catch (e) { } // If this fails/times out, kill like we do elsewhere:
            }
            const exitPromise = new Promise((resolve) => browser.process.once('close', resolve));
            browser.stop();
            await exitPromise;
        }
    }
    async deactivateAll() {
        if (this.activeBrowser) {
            await this.deactivate(this.activeBrowser.proxyPort);
        }
    }
}
;
class FreshChrome extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chrome');
        this.id = 'fresh-chrome';
        this.version = '1.0.0';
    }
}
exports.FreshChrome = FreshChrome;
;
class ExistingChrome extends ExistingChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chrome');
        this.id = 'existing-chrome';
        this.version = '1.0.0';
    }
}
exports.ExistingChrome = ExistingChrome;
;
class FreshChromeBeta extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chrome-beta');
        this.id = 'fresh-chrome-beta';
        this.version = '1.0.0';
    }
}
exports.FreshChromeBeta = FreshChromeBeta;
;
class FreshChromeDev extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chrome-dev');
        this.id = 'fresh-chrome-dev';
        this.version = '1.0.0';
    }
}
exports.FreshChromeDev = FreshChromeDev;
;
class FreshChromeCanary extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chrome-canary');
        this.id = 'fresh-chrome-canary';
        this.version = '1.0.0';
    }
}
exports.FreshChromeCanary = FreshChromeCanary;
;
class FreshChromium extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chromium');
        this.id = 'fresh-chromium';
        this.version = '1.0.0';
    }
}
exports.FreshChromium = FreshChromium;
;
class FreshChromiumDev extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'chromium-dev');
        this.id = 'fresh-chromium-dev';
        this.version = '1.0.0';
    }
}
exports.FreshChromiumDev = FreshChromiumDev;
;
class FreshEdge extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'msedge');
        this.id = 'fresh-edge';
        this.version = '1.0.0';
    }
}
exports.FreshEdge = FreshEdge;
;
class FreshEdgeBeta extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'msedge-beta');
        this.id = 'fresh-edge-beta';
        this.version = '1.0.0';
    }
}
exports.FreshEdgeBeta = FreshEdgeBeta;
;
class FreshEdgeDev extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'msedge-dev');
        this.id = 'fresh-edge-dev';
        this.version = '1.0.0';
    }
}
exports.FreshEdgeDev = FreshEdgeDev;
;
class FreshEdgeCanary extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'msedge-canary');
        this.id = 'fresh-edge-canary';
        this.version = '1.0.0';
    }
}
exports.FreshEdgeCanary = FreshEdgeCanary;
;
class FreshBrave extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'brave');
        this.id = 'fresh-brave';
        this.version = '1.0.0';
    }
}
exports.FreshBrave = FreshBrave;
;
class FreshOpera extends FreshChromiumBasedInterceptor {
    constructor(config) {
        super(config, 'opera');
        this.id = 'fresh-opera';
        this.version = '1.0.3';
    }
}
exports.FreshOpera = FreshOpera;
;
//# sourceMappingURL=chromium-based-interceptors.js.map