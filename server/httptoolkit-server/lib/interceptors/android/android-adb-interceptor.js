"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidAdbInterceptor = void 0;
const _ = require("lodash");
const os = require("os");
const mockttp_1 = require("mockttp");
const error_tracking_1 = require("../../error-tracking");
const promise_1 = require("../../util/promise");
const adb_commands_1 = require("./adb-commands");
const fetch_apk_1 = require("./fetch-apk");
const certificates_1 = require("../../certificates");
function urlSafeBase64(content) {
    return Buffer.from(content, 'utf8').toString('base64')
        .replace('+', '-')
        .replace('/', '_');
}
class AndroidAdbInterceptor {
    constructor(config) {
        this.config = config;
        this.id = 'android-adb';
        this.version = '1.0.0';
        this.deviceProxyMapping = {};
        this.adbClient = (0, adb_commands_1.createAdbClient)();
        this.activableTimeout = 3000; // Increase timeout for device detection slightly
    }
    async isActivable() {
        return (await (0, adb_commands_1.getConnectedDevices)(this.adbClient)).length > 0;
    }
    isActive() {
        return false;
    }
    async getMetadata() {
        return {
            deviceIds: await (0, adb_commands_1.getConnectedDevices)(this.adbClient)
        };
    }
    async activate(proxyPort, options) {
        await this.injectSystemCertIfPossible(options.deviceId, this.config.https.certContent);
        if (!(await this.adbClient.isInstalled(options.deviceId, 'tech.httptoolkit.android.v1'))) {
            console.log("App not installed, installing...");
            try {
                await this.adbClient.install(options.deviceId, await (0, fetch_apk_1.streamLatestApk)(this.config));
            }
            catch (e) {
                console.log("Resetting & retrying APK install, after initial failure:", e);
                // This can fail due to connection issues (with the device or while downloading
                // the APK) due to a corrupted APK. Reset the APKs and try again, just in case.
                await (0, fetch_apk_1.clearAllApks)(this.config);
                await this.adbClient.install(options.deviceId, await (0, fetch_apk_1.streamLatestApk)(this.config));
            }
            console.log("App installed successfully");
            await (0, promise_1.delay)(200); // Add a little delay, to ensure intent URL is registered before we use it
        }
        // Now that the app is installed, bring it to the front (avoids issues with starting a
        // service for the VPN when in the foreground).
        await (0, adb_commands_1.bringToFront)(this.adbClient, options.deviceId, 'tech.httptoolkit.android.v1/tech.httptoolkit.android.MainActivity').catch(error_tracking_1.reportError); // Not that important, so we continue if this fails somehow
        // Build a trigger URL to activate the proxy on the device:
        const setupParams = {
            addresses: [
                '10.0.2.2',
                '10.0.3.2', // Genymotion localhost ip
            ].concat(
            // Every other external network ip
            _.flatMap(os.networkInterfaces(), (addresses) => (addresses || [])
                .filter(a => !a.internal)
                .map(a => a.address))),
            port: proxyPort,
            localTunnelPort: proxyPort,
            certFingerprint: (0, mockttp_1.generateSPKIFingerprint)(this.config.https.certContent)
        };
        const intentData = urlSafeBase64(JSON.stringify(setupParams));
        await this.adbClient.reverse(options.deviceId, 'tcp:' + proxyPort, 'tcp:' + proxyPort).catch(() => { });
        // Use ADB to launch the app with the proxy details
        await this.adbClient.startActivity(options.deviceId, {
            wait: true,
            action: 'tech.httptoolkit.android.ACTIVATE',
            data: `https://android.httptoolkit.tech/connect/?data=${intentData}`
        });
        this.deviceProxyMapping[proxyPort] = this.deviceProxyMapping[proxyPort] || [];
        if (!this.deviceProxyMapping[proxyPort].includes(options.deviceId)) {
            this.deviceProxyMapping[proxyPort].push(options.deviceId);
            let tunnelConnectFailures = 0;
            // The reverse tunnel can break when connecting/disconnecting from the VPN. This is a problem! It can
            // also break in other cases, e.g. when ADB is restarted for some reason. To handle this, we constantly
            // reinforce the tunnel while HTTP Toolkit is running & the device is connected.
            const tunnelCheckInterval = setInterval(async () => {
                if (this.deviceProxyMapping[proxyPort].includes(options.deviceId)) {
                    try {
                        await this.adbClient.reverse(options.deviceId, 'tcp:' + proxyPort, 'tcp:' + proxyPort);
                        tunnelConnectFailures = 0;
                    }
                    catch (e) {
                        tunnelConnectFailures += 1;
                        console.log(`${options.deviceId} ADB tunnel failed`, e);
                        if (tunnelConnectFailures >= 5) {
                            // After 10 seconds disconnected, give up
                            console.log(`${options.deviceId} disconnected, dropping the ADB tunnel`);
                            this.deviceProxyMapping[proxyPort] = this.deviceProxyMapping[proxyPort]
                                .filter(id => id !== options.deviceId);
                            clearInterval(tunnelCheckInterval);
                        }
                    }
                }
                else {
                    // Deactivation at shutdown will clear the proxy data, and so clear this interval
                    // will automatically shut down.
                    clearInterval(tunnelCheckInterval);
                }
            }, 2000);
            tunnelCheckInterval.unref(); // Don't let this block shutdown
        }
    }
    async deactivate(port) {
        const deviceIds = this.deviceProxyMapping[port] || [];
        return Promise.all(deviceIds.map(deviceId => this.adbClient.startActivity(deviceId, {
            wait: true,
            action: 'tech.httptoolkit.android.DEACTIVATE'
        })));
    }
    async deactivateAll() {
        return Promise.all(Object.keys(this.deviceProxyMapping)
            .map(port => this.deactivate(port)));
    }
    async injectSystemCertIfPossible(deviceId, certContent) {
        const rootCmd = await (0, adb_commands_1.getRootCommand)(this.adbClient, deviceId);
        if (!rootCmd) {
            console.log('Root not available, skipping cert injection');
            return;
        }
        const cert = (0, certificates_1.parseCert)(certContent);
        try {
            const subjectHash = (0, certificates_1.getCertificateSubjectHash)(cert);
            const fingerprint = (0, certificates_1.getCertificateFingerprint)(cert);
            if (await (0, adb_commands_1.hasCertInstalled)(this.adbClient, deviceId, subjectHash, fingerprint)) {
                console.log("Cert already installed, nothing to do");
                return;
            }
            const certPath = `${adb_commands_1.ANDROID_TEMP}/${subjectHash}.0`;
            console.log(`Adding cert file as ${certPath}`);
            await (0, adb_commands_1.pushFile)(this.adbClient, deviceId, (0, adb_commands_1.stringAsStream)(certContent.replace('\r\n', '\n')), certPath, 0o444);
            await (0, adb_commands_1.injectSystemCertificate)(this.adbClient, deviceId, rootCmd, certPath);
            console.log(`Cert injected`);
        }
        catch (e) {
            (0, error_tracking_1.reportError)(e);
        }
    }
}
exports.AndroidAdbInterceptor = AndroidAdbInterceptor;
//# sourceMappingURL=android-adb-interceptor.js.map