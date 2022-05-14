"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restartAndInjectContainer = exports.transformContainerCreationConfig = exports.isInterceptedContainer = exports.isImageAvailable = exports.getDockerHostIp = exports.DOCKER_HOST_HOSTNAME = exports.DOCKER_CONTAINER_LABEL = void 0;
const _ = require("lodash");
const path = require("path");
const semver = require("semver");
const terminal_env_overrides_1 = require("../terminal/terminal-env-overrides");
const docker_compose_1 = require("./docker-compose");
// Used to label intercepted docker containers with the port of the proxy
// that's currently intercepting them.
exports.DOCKER_CONTAINER_LABEL = "tech.httptoolkit.docker.proxy";
/**
 * The path inside the container where injected files will be stored, and so the paths that
 * env vars injected into the container need to reference.
 */
const HTTP_TOOLKIT_INJECTED_PATH = '/http-toolkit-injections';
const HTTP_TOOLKIT_INJECTED_OVERRIDES_PATH = path.posix.join(HTTP_TOOLKIT_INJECTED_PATH, 'overrides');
const HTTP_TOOLKIT_INJECTED_CA_PATH = path.posix.join(HTTP_TOOLKIT_INJECTED_PATH, 'ca.pem');
/**
 * The hostname that resolves to the host OS (i.e. generally: where HTTP Toolkit is running)
 * from inside containers.
 *
 * In Docker for Windows & Mac, host.docker.internal is supported automatically:
 * https://docs.docker.com/docker-for-windows/networking/#use-cases-and-workarounds
 * https://docs.docker.com/docker-for-mac/networking/#use-cases-and-workarounds
 *
 * On Linux this is _not_ supported, so we add it ourselves with (--add-host).
 */
exports.DOCKER_HOST_HOSTNAME = "host.docker.internal";
/**
 * To make the above hostname work on Linux, where it's not supported by default, we need to map it to the
 * host ip. This method works out the host IP to use to do so.
 */
const getDockerHostIp = (platform, dockerVersion, containerMetadata) => {
    const semverVersion = semver.coerce('apiVersion' in dockerVersion
        ? dockerVersion.apiVersion
        : dockerVersion.engineVersion);
    if (platform !== 'linux') {
        // On non-linux platforms this method isn't necessary - host.docker.internal is always supported
        // so we can just use that.
        return exports.DOCKER_HOST_HOSTNAME;
    }
    else if (semver.satisfies(semverVersion !== null && semverVersion !== void 0 ? semverVersion : '0.0.0', 'apiVersion' in dockerVersion ? '>=1.41' : '>=20.10')) {
        // This is supported in Docker Engine 20.10, so always supported at least in API 1.41+
        // Special name defined in new Docker versions, that refers to the host gateway
        return 'host-gateway';
    }
    else if (containerMetadata) {
        // Old/Unknown Linux with known container: query the metadata, and if _that_ fails, use the default gateway IP.
        return containerMetadata.NetworkSettings.Gateway || "172.17.0.1";
    }
    else {
        // Old/Unknown Linux without a container (e.g. during a build). Always use the default gateway IP:
        return "172.17.0.1";
    }
};
exports.getDockerHostIp = getDockerHostIp;
function isImageAvailable(docker, name) {
    return docker.getImage(name).inspect()
        .then(() => true)
        .catch(() => false);
}
exports.isImageAvailable = isImageAvailable;
function isInterceptedContainer(container, port) {
    return container.Config.Labels[exports.DOCKER_CONTAINER_LABEL] === port.toString();
}
exports.isInterceptedContainer = isInterceptedContainer;
const envArrayToObject = (envArray) => _.fromPairs((envArray !== null && envArray !== void 0 ? envArray : []).map((e) => {
    const equalsIndex = e.indexOf('=');
    if (equalsIndex === -1)
        throw new Error('Env var without =');
    return [e.slice(0, equalsIndex), e.slice(equalsIndex + 1)];
}));
const envObjectToArray = (envObject) => Object.keys(envObject).map(k => `${k}=${envObject[k]}`);
/**
 * Takes the config for a container, and returns the config to create the
 * same container, but fully intercepted.
 *
 * To hook the creation of any container, we need to get the full config of
 * the container (to make sure we get *all* env vars, for example) and then
 * combine that with the inter
 */
function transformContainerCreationConfig(containerConfig, baseImageConfig, { proxyPort, proxyHost, certPath }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    // Get the container-relevant config from the image config first.
    // The image has both .Config and .ContainerConfig. The former
    // is preferred, seems that .ContainerConfig is backward compat.
    const imageContainerConfig = (_a = baseImageConfig === null || baseImageConfig === void 0 ? void 0 : baseImageConfig.Config) !== null && _a !== void 0 ? _a : baseImageConfig === null || baseImageConfig === void 0 ? void 0 : baseImageConfig.ContainerConfig;
    // Combine the image config with the container creation options. Most
    // fields are overriden by container config, a couple are merged:
    const currentConfig = Object.assign(Object.assign(Object.assign({}, imageContainerConfig), containerConfig), { Env: [
            ...((_b = imageContainerConfig === null || imageContainerConfig === void 0 ? void 0 : imageContainerConfig.Env) !== null && _b !== void 0 ? _b : []),
            ...((_c = containerConfig.Env) !== null && _c !== void 0 ? _c : [])
        ], Labels: Object.assign(Object.assign({}, ((_d = imageContainerConfig === null || imageContainerConfig === void 0 ? void 0 : imageContainerConfig.Labels) !== null && _d !== void 0 ? _d : {})), ((_e = containerConfig.Labels) !== null && _e !== void 0 ? _e : {})) });
    const hostConfig = Object.assign(Object.assign(Object.assign({}, currentConfig.HostConfig), { 
        // To intercept without modifying the container, we bind mount our overrides and certificate
        // files into place on top of the existing content:
        Binds: [
            ...((_g = (_f = currentConfig.HostConfig) === null || _f === void 0 ? void 0 : _f.Binds) !== null && _g !== void 0 ? _g : []).filter((existingMount) => 
            // Drop any existing mounts for these folders - this allows re-intercepting containers, e.g.
            // to switch from one proxy port to another.
            !existingMount.startsWith(`${certPath}:`) &&
                !existingMount.startsWith(`${terminal_env_overrides_1.OVERRIDES_DIR}:`)),
            // Bind-mount the CA certificate file individually too:
            `${certPath}:${HTTP_TOOLKIT_INJECTED_CA_PATH}:ro`,
            // Bind-mount the overrides directory into the container:
            `${terminal_env_overrides_1.OVERRIDES_DIR}:${HTTP_TOOLKIT_INJECTED_OVERRIDES_PATH}:ro`
            // ^ Both 'ro' - untrusted containers must not be able to mess with these!
        ] }), (process.platform === 'linux'
        // On Linux only, we need to add an explicit host to make host.docker.internal work:
        ? {
            ExtraHosts: [
                `${exports.DOCKER_HOST_HOSTNAME}:${proxyHost}`,
                // Seems that first host wins conflicts, so we go before existing values
                ...((_j = (_h = currentConfig.HostConfig) === null || _h === void 0 ? void 0 : _h.ExtraHosts) !== null && _j !== void 0 ? _j : [])
            ]
        }
        : {}));
    // Extend that config, injecting our custom overrides:
    return Object.assign(Object.assign({}, currentConfig), { HostConfig: hostConfig, Env: [
            ...((_k = currentConfig.Env) !== null && _k !== void 0 ? _k : []),
            ...envObjectToArray((0, terminal_env_overrides_1.getTerminalEnvVars)(proxyPort, { certPath: HTTP_TOOLKIT_INJECTED_CA_PATH }, envArrayToObject(currentConfig.Env), {
                httpToolkitIp: exports.DOCKER_HOST_HOSTNAME,
                overridePath: HTTP_TOOLKIT_INJECTED_OVERRIDES_PATH,
                targetPlatform: 'linux'
            }))
        ], Labels: Object.assign(Object.assign({}, (0, docker_compose_1.transformComposeCreationLabels)(proxyPort, currentConfig.Labels)), { 
            // Label the resulting container as intercepted by this specific proxy:
            [exports.DOCKER_CONTAINER_LABEL]: String(proxyPort) }) });
}
exports.transformContainerCreationConfig = transformContainerCreationConfig;
function deriveContainerCreationConfigFromInspection(containerDetails) {
    return Object.assign(Object.assign({}, containerDetails.Config), { HostConfig: containerDetails.HostConfig, name: containerDetails.Name, 
        // You can't reconnect all networks at creation for >1 network.
        // To simplify things, we just connect all networks after creation.
        NetworkingConfig: {} });
}
async function connectNetworks(docker, containerId, networks) {
    await Promise.all(Object.keys(networks).map(networkName => docker.getNetwork(networkName).connect({
        Container: containerId,
        EndpointConfig: networks[networkName]
    })));
}
async function restartAndInjectContainer(docker, containerId, { proxyPort, certContent, certPath }) {
    // We intercept containers by stopping them, cloning them, injecting our settings,
    // and then starting up the clone.
    // We could add files to hit PATH and just restart the process, but we can't change
    // env vars or entrypoints (legally... doable with manual edits...) and restarting a
    // proc might be unexpected/unsafe, whilst fresh container should be the 'normal' route.
    const container = docker.getContainer(containerId);
    const containerDetails = await container.inspect();
    await container.stop({ t: 1 });
    await container.remove().catch((e) => {
        if ([409, 404, 304].includes(e.statusCode)) {
            // Generally this means the container was running with --rm, so
            // it's been/being removed automatically already - that's fine!
            return;
        }
        else {
            throw e;
        }
    });
    const proxyHost = (0, exports.getDockerHostIp)(process.platform, { engineVersion: (await docker.version()).Version }, containerDetails);
    // First we clone the continer, injecting our custom settings:
    const newContainer = await docker.createContainer(transformContainerCreationConfig(
    // Get options required to directly recreate this container
    deriveContainerCreationConfigFromInspection(containerDetails), 
    // We don't need image config - inspect result has *everything*
    undefined, {
        certPath,
        proxyPort,
        proxyHost
    }));
    // Reconnect to all the previous container's networks:
    connectNetworks(docker, newContainer.id, containerDetails.NetworkSettings.Networks);
    // Start everything up!
    await newContainer.start();
}
exports.restartAndInjectContainer = restartAndInjectContainer;
//# sourceMappingURL=docker-commands.js.map