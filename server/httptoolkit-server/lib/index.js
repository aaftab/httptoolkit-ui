"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHTK = void 0;
const path = require("path");
const fs = require("fs");
const envPaths = require("env-paths");
const mockttp_1 = require("mockttp");
const async_mutex_1 = require("async-mutex");
const update_1 = require("@oclif/plugin-update/lib/commands/update");
const api_server_1 = require("./api-server");
const browsers_1 = require("./browsers");
const error_tracking_1 = require("./error-tracking");
const constants_1 = require("./constants");
const promise_1 = require("./util/promise");
const error_1 = require("./util/error");
const fs_1 = require("./util/fs");
const shutdown_1 = require("./shutdown");
const certificates_1 = require("./certificates");
const docker_interception_services_1 = require("./interceptors/docker/docker-interception-services");
const APP_NAME = "HTTP Toolkit";
async function generateHTTPSConfig(configPath) {
    const keyPath = path.join(configPath, 'ca.key');
    const certPath = path.join(configPath, 'ca.pem');
    const [certContent] = await Promise.all([
        (0, fs_1.readFile)(certPath, 'utf8').then((certContent) => {
            checkCertExpiry(certContent);
            return certContent;
        }),
        (0, fs_1.checkAccess)(keyPath, fs.constants.R_OK),
    ]).catch(async () => {
        // Cert doesn't exist, or is too close/past expiry. Generate a new one:
        const newCertPair = await (0, mockttp_1.generateCACertificate)({
            commonName: APP_NAME + ' CA'
        });
        return Promise.all([
            (0, fs_1.writeFile)(certPath, newCertPair.cert).then(() => newCertPair.cert),
            (0, fs_1.writeFile)(keyPath, newCertPair.key)
        ]);
    });
    return {
        keyPath,
        certPath,
        certContent,
        keyLength: 2048 // Reasonably secure keys please
    };
}
function checkCertExpiry(certContents) {
    const remainingLifetime = (0, certificates_1.getTimeToCertExpiry)((0, certificates_1.parseCert)(certContents));
    if (remainingLifetime < 1000 * 60 * 60 * 48) { // Next two days
        console.warn('Certificate expires soon - it must be regenerated');
        throw new Error('Certificate regeneration required');
    }
}
function manageBackgroundServices(standalone, httpsConfig) {
    standalone.on('mock-server-started', async (server) => {
        (0, docker_interception_services_1.startDockerInterceptionServices)(server.port, httpsConfig, ruleParameters)
            .catch((error) => {
            console.log("Could not start Docker components:", error);
        });
    });
    standalone.on('mock-server-stopping', (server) => {
        (0, docker_interception_services_1.stopDockerInterceptionServices)(server.port, ruleParameters)
            .catch((error) => {
            console.log("Could not stop Docker components:", error);
        });
    });
}
// A map of rule parameters, which may be referenced by the UI, to pass configuration
// set here directly within the Node process to Mockttp (e.g. to set callbacks etc that
// can't be transferred through the API or which need access to server internals).
// This is a constant but mutable dictionary, which will be modified as the appropriate
// parameters change. Mockttp reads from the dictionary each time rules are configured.
const ruleParameters = {};
async function runHTK(options = {}) {
    const startTime = Date.now();
    (0, shutdown_1.registerShutdownHandler)();
    const configPath = options.configPath || envPaths('httptoolkit', { suffix: '' }).config;
    await (0, fs_1.ensureDirectoryExists)(configPath);
    await (0, browsers_1.checkBrowserConfig)(configPath);
    const configCheckTime = Date.now();
    console.log('Config checked in', configCheckTime - startTime, 'ms');
    const httpsConfig = await generateHTTPSConfig(configPath);
    const certSetupTime = Date.now();
    console.log('Certificates setup in', certSetupTime - configCheckTime, 'ms');
    // Start a Mockttp standalone server
    const standalone = (0, mockttp_1.getStandalone)({
        serverDefaults: {
            cors: false,
            recordTraffic: false,
            https: httpsConfig // Use our HTTPS config for HTTPS MITMs.
        },
        corsOptions: {
            strict: true,
            origin: constants_1.ALLOWED_ORIGINS,
            maxAge: 86400 // Cache CORS responses for as long as possible
        },
        webSocketKeepAlive: 20000,
        ruleParameters // Rule parameter dictionary
    });
    manageBackgroundServices(standalone, httpsConfig);
    await standalone.start({
        port: 45456,
        host: '127.0.0.1'
    });
    const standaloneSetupTime = Date.now();
    console.log('Standalone server started in', standaloneSetupTime - certSetupTime, 'ms');
    // Start the HTK server API
    const apiServer = new api_server_1.HttpToolkitServerApi({
        configPath,
        authToken: options.authToken,
        https: httpsConfig
    }, standalone);
    const updateMutex = new async_mutex_1.Mutex();
    apiServer.on('update-requested', () => {
        updateMutex.runExclusive(() => update_1.default.run(['stable'])
            .catch((error) => {
            // Received successful update that wants to restart the server
            if ((0, error_1.isErrorLike)(error) && error.code === 'EEXIT') {
                // Block future update checks for one hour.
                // If we don't, we'll redownload the same update again every check.
                // We don't want to block it completely though, in case this server
                // stays open for a very long time.
                return (0, promise_1.delay)(1000 * 60 * 60);
            }
            console.log(error);
            (0, error_tracking_1.reportError)('Failed to check for updates');
        }));
    });
    await apiServer.start();
    console.log('Server started in', Date.now() - standaloneSetupTime, 'ms');
    console.log('Total startup took', Date.now() - startTime, 'ms');
}
exports.runHTK = runHTK;
//# sourceMappingURL=index.js.map