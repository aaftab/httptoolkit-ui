"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAllInterceptedDockerData = exports.stopDockerInterceptionServices = exports.ensureDockerServicesRunning = exports.startDockerInterceptionServices = exports.isDockerAvailable = void 0;
const Docker = require("dockerode");
const error_tracking_1 = require("../../error-tracking");
const shutdown_1 = require("../../shutdown");
const docker_build_injection_1 = require("./docker-build-injection");
const docker_commands_1 = require("./docker-commands");
const dns_server_1 = require("../../dns-server");
const docker_networking_1 = require("./docker-networking");
const docker_proxy_1 = require("./docker-proxy");
const docker_tunnel_proxy_1 = require("./docker-tunnel-proxy");
const isDockerAvailable = () => (async () => new Docker().ping())() // Catch sync & async setup errors
    .then(() => true)
    .catch(() => false);
exports.isDockerAvailable = isDockerAvailable;
const IPv4_IPv6_PREFIX = "::ffff:";
// On shutdown, clean up every container & image that we created, disappearing
// into the mist as if we were never here...
// (Those images/containers are unusable without us, so leaving them breaks things).
(0, shutdown_1.addShutdownHandler)(async () => {
    if (!await (0, exports.isDockerAvailable)())
        return;
    await deleteAllInterceptedDockerData('all');
});
async function startDockerInterceptionServices(proxyPort, httpsConfig, ruleParameters) {
    // Prepare (pull) the tunnel image, but we don't actually start the tunnel itself until some
    // Docker interception happens while HTTP Toolkit is running - e.g. proxy use, container attach,
    // or an intercepted container connecting to a network.
    (0, docker_tunnel_proxy_1.prepareDockerTunnel)();
    const networkMonitor = (0, docker_networking_1.monitorDockerNetworkAliases)(proxyPort);
    ruleParameters[`docker-tunnel-proxy-${proxyPort}`] = async ({ hostname }) => {
        var _a;
        hostname = hostname.startsWith(IPv4_IPv6_PREFIX)
            ? hostname.slice(IPv4_IPv6_PREFIX.length)
            : hostname;
        if ((_a = (await networkMonitor)) === null || _a === void 0 ? void 0 : _a.dockerRoutedAliases.has(hostname)) {
            return {
                proxyUrl: `socks5://127.0.0.1:${await (0, docker_tunnel_proxy_1.getDockerTunnelPort)(proxyPort)}`
            };
        }
    };
    await Promise.all([
        // Proxy all terminal Docker API requests, to rewrite & add injection:
        (0, docker_proxy_1.ensureDockerProxyRunning)(proxyPort, httpsConfig),
        // Ensure the DNS server is running to handle unresolvable container addresses:
        (0, dns_server_1.getDnsServer)(proxyPort),
        // Monitor the intercepted containers, to resolve their names in our DNS:
        networkMonitor
    ]);
}
exports.startDockerInterceptionServices = startDockerInterceptionServices;
async function ensureDockerServicesRunning(proxyPort) {
    await Promise.all([
        (0, docker_networking_1.monitorDockerNetworkAliases)(proxyPort),
        (0, docker_tunnel_proxy_1.ensureDockerTunnelRunning)(proxyPort),
        (0, dns_server_1.getDnsServer)(proxyPort)
    ]).catch(error_tracking_1.reportError);
}
exports.ensureDockerServicesRunning = ensureDockerServicesRunning;
async function stopDockerInterceptionServices(proxyPort, ruleParameters) {
    (0, docker_proxy_1.stopDockerProxy)(proxyPort);
    (0, docker_networking_1.stopMonitoringDockerNetworkAliases)(proxyPort);
    await deleteAllInterceptedDockerData(proxyPort);
    delete ruleParameters[`docker-tunnel-proxy-${proxyPort}`];
}
exports.stopDockerInterceptionServices = stopDockerInterceptionServices;
// Batch deactivations - if we're already shutting down, don't shut down again until
// the previous shutdown completes.
const pendingDeactivations = {};
// When a Docker container or the whole server shuts down, we do our best to delete
// every remaining intercepted image or container. None of these will be usable
// without us anyway, as they all depend on HTTP Toolkit for connectivity.
async function deleteAllInterceptedDockerData(proxyPort) {
    if (pendingDeactivations[proxyPort])
        return pendingDeactivations[proxyPort];
    if (!await (0, exports.isDockerAvailable)())
        return;
    return pendingDeactivations[proxyPort] = Promise.all([
        (0, docker_tunnel_proxy_1.stopDockerTunnel)(proxyPort),
        (async () => {
            const docker = new Docker();
            const containers = await docker.listContainers({
                all: true,
                filters: JSON.stringify({
                    label: [
                        proxyPort === 'all'
                            ? docker_commands_1.DOCKER_CONTAINER_LABEL
                            : `${docker_commands_1.DOCKER_CONTAINER_LABEL}=${proxyPort}`
                    ]
                })
            });
            await Promise.all(containers.map(async (containerData) => {
                const container = docker.getContainer(containerData.Id);
                // Best efforts clean stop & remove:
                await container.stop({ t: 1 }).catch(() => { });
                await container.remove({ force: true }).catch(() => { });
            }));
            // We clean up images after containers, in case some containers depended
            // on some images that we intercepted.
            const images = await docker.listImages({
                all: true,
                filters: JSON.stringify({
                    label: [
                        proxyPort === 'all'
                            ? docker_build_injection_1.DOCKER_BUILD_LABEL
                            : `${docker_build_injection_1.DOCKER_BUILD_LABEL}=${proxyPort}`
                    ]
                })
            });
            await Promise.all(images.map(async (imageData) => {
                await docker.getImage(imageData.Id).remove().catch(() => { });
            }));
            // Unmark this deactivation as pending
            delete pendingDeactivations[proxyPort];
        })()
    ]);
}
exports.deleteAllInterceptedDockerData = deleteAllInterceptedDockerData;
//# sourceMappingURL=docker-interception-services.js.map