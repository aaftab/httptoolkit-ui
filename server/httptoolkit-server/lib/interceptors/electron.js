"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronInterceptor = void 0;
const _ = require("lodash");
const child_process_1 = require("child_process");
const path = require("path");
const portfinder_1 = require("portfinder");
const mockttp_1 = require("mockttp");
const ChromeRemoteInterface = require("chrome-remote-interface");
const promise_1 = require("../util/promise");
const error_1 = require("../util/error");
const fs_1 = require("../util/fs");
const process_management_1 = require("../util/process-management");
const terminal_env_overrides_1 = require("./terminal/terminal-env-overrides");
const error_tracking_1 = require("../error-tracking");
const osx_find_executable_1 = require("@httptoolkit/osx-find-executable");
const isAppBundle = (path) => {
    return process.platform === "darwin" &&
        path.endsWith(".app");
};
class ElectronInterceptor {
    constructor(config) {
        this.config = config;
        this.id = 'electron';
        this.version = '1.0.1';
        this.debugClients = {};
        this.certData = (0, fs_1.readFile)(this.config.https.certPath, 'utf8');
    }
    async isActivable() {
        return true;
    }
    isActive(proxyPort) {
        return !!this.debugClients[proxyPort] &&
            !!this.debugClients[proxyPort].length;
    }
    async activate(proxyPort, options) {
        const debugPort = await (0, portfinder_1.getPortPromise)({ port: proxyPort });
        const { pathToApplication } = options;
        const cmd = isAppBundle(pathToApplication)
            ? await (0, osx_find_executable_1.findExecutableInApp)(pathToApplication)
            : pathToApplication;
        const appProcess = (0, child_process_1.spawn)(cmd, [`--inspect-brk=${debugPort}`], {
            stdio: 'inherit',
            env: Object.assign(Object.assign(Object.assign({}, process.env), (0, terminal_env_overrides_1.getTerminalEnvVars)(proxyPort, this.config.https, process.env)), { 
                // We have to disable NODE_OPTIONS injection. If set, the Electron
                // app never fires paused(). I suspect because --require changes the
                // startup process somehow. Regardless, we don't need it (we're injecting
                // manually anyway) so we just skip it here.
                NODE_OPTIONS: '' })
        });
        let debugClient;
        let retries = 10;
        appProcess.on('error', async (e) => {
            (0, error_tracking_1.reportError)(e);
            if (debugClient) {
                // Try to close the debug connection if open, but very carefully
                try {
                    await debugClient.close();
                }
                catch (e) { }
            }
            // If we're still in the process of debugging the app, give up.
            retries = -1;
        });
        while (!debugClient && retries >= 0) {
            try {
                debugClient = await ChromeRemoteInterface({ port: debugPort });
            }
            catch (error) {
                if (((0, error_1.isErrorLike)(error) && error.code !== 'ECONNREFUSED') || retries === 0) {
                    throw error;
                }
                retries = retries - 1;
                await (0, promise_1.delay)(500);
            }
        }
        if (!debugClient)
            throw new Error('Could not initialize CDP client');
        this.debugClients[proxyPort] = this.debugClients[proxyPort] || [];
        this.debugClients[proxyPort].push(debugClient);
        debugClient.once('disconnect', () => {
            _.remove(this.debugClients[proxyPort], c => c === debugClient);
        });
        // These allow us to use the APIs below
        await debugClient.Runtime.enable();
        await debugClient.Debugger.enable();
        // This starts watching for the initial pause event, which gives us the
        // inside-electron call frame to inject into (i.e. with require() available)
        const callFramePromise = new Promise((resolve) => {
            debugClient.Debugger.paused((stack) => {
                resolve(stack.callFrames[0].callFrameId);
            });
        });
        // This confirms we're ready, and triggers pause():
        await debugClient.Runtime.runIfWaitingForDebugger();
        const callFrameId = await callFramePromise;
        console.log("Injecting interception settings into Electron app...");
        // Inside the Electron process, load our electron-intercepting JS.
        const injectionResult = await debugClient.Debugger.evaluateOnCallFrame({
            expression: `require(${
            // Need to stringify to handle chars that need escaping (e.g. windows backslashes)
            JSON.stringify(path.join(terminal_env_overrides_1.OVERRIDES_DIR, 'js', 'prepend-electron.js'))})({
                newlineEncodedCertData: "${(await this.certData).replace(/\r\n|\r|\n/g, '\\n')}",
                spkiFingerprint: "${(0, mockttp_1.generateSPKIFingerprint)(await this.certData)}"
            })`,
            callFrameId
        });
        if (injectionResult.exceptionDetails) {
            const exception = injectionResult.exceptionDetails;
            console.log(exception);
            (0, error_tracking_1.addBreadcrumb)("Evaluate error", {
                message: exception && exception.description,
                data: injectionResult.exceptionDetails
            });
            throw new Error("Failed to inject into Electron app");
        }
        console.log("App intercepted, resuming...");
        await debugClient.Debugger.resume();
        console.log("App resumed, Electron interception complete");
    }
    async deactivate(proxyPort) {
        if (!this.isActive(proxyPort))
            return;
        await Promise.all(this.debugClients[proxyPort].map(async (debugClient) => {
            let shutdown = false;
            const disconnectPromise = new Promise((resolve) => debugClient.once('disconnect', resolve)).then(() => {
                shutdown = true;
            });
            const pidResult = (await debugClient.Runtime.evaluate({
                expression: 'process.pid'
            }).catch(() => ({ result: undefined }))).result;
            const pid = pidResult && pidResult.type === 'number'
                ? pidResult.value
                : undefined;
            // If we can extract the pid, use it to cleanly close the app:
            if (_.isNumber(pid)) {
                if (process.platform === 'win32') {
                    await (0, process_management_1.windowsClose)(pid);
                }
                else {
                    process.kill(pid, "SIGTERM");
                }
                // Wait up to 1s for a clean shutdown & disconnect
                await Promise.race([disconnectPromise, (0, promise_1.delay)(1000)]);
            }
            if (!shutdown) {
                // Didn't shutdown yet? Inject a hard exit.
                await Promise.race([
                    debugClient.Runtime.evaluate({
                        expression: 'process.exit(0)'
                    }).catch(() => { }),
                    disconnectPromise // If we disconnect, evaluate can time out
                ]);
            }
            ;
        }));
    }
    async deactivateAll() {
        await Promise.all(Object.keys(this.debugClients).map(port => this.deactivate(port)));
    }
}
exports.ElectronInterceptor = ElectronInterceptor;
//# sourceMappingURL=electron.js.map