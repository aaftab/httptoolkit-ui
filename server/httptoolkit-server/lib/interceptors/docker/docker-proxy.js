"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopDockerProxy = exports.ensureDockerProxyRunning = exports.getDockerPipePath = void 0;
const _ = require("lodash");
const os = require("os");
const path = require("path");
const stream = require("stream");
const http = require("http");
const Dockerode = require("dockerode");
const getRawBody = require("raw-body");
const node_abort_controller_1 = require("node-abort-controller");
const fs_1 = require("../../util/fs");
const http_1 = require("../../util/http");
const destroyable_server_1 = require("../../destroyable-server");
const error_tracking_1 = require("../../error-tracking");
const shutdown_1 = require("../../shutdown");
const docker_commands_1 = require("./docker-commands");
const docker_build_injection_1 = require("./docker-build-injection");
const docker_interception_services_1 = require("./docker-interception-services");
const docker_compose_1 = require("./docker-compose");
const getDockerPipePath = (proxyPort, targetPlatform = process.platform) => {
    if (targetPlatform === 'win32') {
        return `//./pipe/httptoolkit-${proxyPort}-docker`;
    }
    else {
        return path.join(os.tmpdir(), `httptoolkit-${proxyPort}-docker.sock`);
    }
};
exports.getDockerPipePath = getDockerPipePath;
if (process.platform !== 'win32') {
    // At shutdown on Linux/Mac we cleanup all our leftover Docker sockets:
    (0, shutdown_1.addShutdownHandler)(async () => Promise.all((await (0, fs_1.readDir)(os.tmpdir()))
        .filter((filename) => filename.match(/^httptoolkit-\d+-docker.sock$/))
        .map((filename) => (0, fs_1.deleteFile)(path.join(os.tmpdir(), filename)))));
}
const API_VERSION_MATCH = /^\/v?([\.\d]+)\//;
const CREATE_CONTAINER_MATCHER = /^\/[^\/]+\/containers\/create/;
const START_CONTAINER_MATCHER = /^\/[^\/]+\/containers\/([^\/]+)\/start/;
const BUILD_IMAGE_MATCHER = /^\/[^\/]+\/build$/;
const ATTACH_CONTAINER_MATCHER = /^\/[^\/]+\/containers\/([^\/]+)\/attach/;
const CONTAINER_LIST_MATCHER = /^\/[^\/]+\/containers\/json/;
const CONTAINER_INSPECT_MATCHER = /^\/[^\/]+\/containers\/[^\/]+\/json/;
const DOCKER_PROXY_MAP = {};
async function ensureDockerProxyRunning(proxyPort, httpsConfig) {
    if (!DOCKER_PROXY_MAP[proxyPort]) {
        DOCKER_PROXY_MAP[proxyPort] = createDockerProxy(proxyPort, httpsConfig);
    }
    await DOCKER_PROXY_MAP[proxyPort];
}
exports.ensureDockerProxyRunning = ensureDockerProxyRunning;
;
async function stopDockerProxy(proxyPort) {
    const proxy = await DOCKER_PROXY_MAP[proxyPort];
    if (!proxy)
        return;
    delete DOCKER_PROXY_MAP[proxyPort];
    await proxy.destroy();
}
exports.stopDockerProxy = stopDockerProxy;
async function createDockerProxy(proxyPort, httpsConfig) {
    const docker = new Dockerode();
    // Hacky logic to reuse docker-modem's internal env + OS parsing logic to
    // work out where the local Docker host is:
    const modem = docker.modem;
    const dockerHostOptions = 'socketPath' in modem
        ? { socketPath: modem.socketPath }
        : { host: modem.host, port: modem.port };
    const agent = new http.Agent({ keepAlive: true });
    const sendToDocker = (req, bodyStream = req) => {
        const headers = (0, http_1.rawHeadersToHeaders)(req.rawHeaders);
        const dockerReq = http.request(Object.assign(Object.assign({}, dockerHostOptions), { agent: agent, method: req.method, headers: _.omitBy(headers, (_v, k) => k.toLowerCase() === 'content-length'), path: req.url }));
        bodyStream.pipe(dockerReq);
        return dockerReq;
    };
    // Forward all requests & responses to & from the real docker server:
    const server = http.createServer(async (req, res) => {
        var _a, _b;
        if (!await (0, docker_interception_services_1.isDockerAvailable)()) {
            res.writeHead(504, "Docker not available").end("HTTP Toolkit could not connect to Docker");
            return;
        }
        let requestBodyStream = req;
        const reqUrl = new URL(req.url, 'http://localhost');
        const reqPath = reqUrl.pathname;
        const dockerApiVersion = (_a = API_VERSION_MATCH.exec(reqPath)) === null || _a === void 0 ? void 0 : _a[1];
        (0, docker_interception_services_1.ensureDockerServicesRunning)(proxyPort);
        // Intercept container creation (e.g. docker run):
        if (reqPath.match(CREATE_CONTAINER_MATCHER)) {
            const body = await getRawBody(req);
            const config = JSON.parse(body.toString('utf8'));
            const imageConfig = await docker.getImage(config.Image).inspect()
                // We ignore errors - if the image doesn't exist, generally that means that the
                // create will fail, and will be re-run after the image is pulled in a minute.
                .catch(() => undefined);
            const proxyHost = (0, docker_commands_1.getDockerHostIp)(process.platform, { apiVersion: dockerApiVersion });
            const transformedConfig = (0, docker_commands_1.transformContainerCreationConfig)(config, imageConfig, {
                certPath: httpsConfig.certPath,
                proxyPort,
                proxyHost
            });
            requestBodyStream = stream.Readable.from(JSON.stringify(transformedConfig));
        }
        // Intercept container creation (e.g. docker start):
        const startContainerMatch = START_CONTAINER_MATCHER.exec(reqPath);
        if (startContainerMatch) {
            const containerId = startContainerMatch[1];
            const containerData = await docker.getContainer(containerId).inspect().catch(() => undefined);
            if (containerData && !(0, docker_commands_1.isInterceptedContainer)(containerData, proxyPort)) {
                res.writeHead(400).end("HTTP Toolkit cannot intercept startup of preexisting non-intercepted containers. " +
                    "The container must be recreated here first - try `docker run <image>` instead.");
            }
        }
        let extraDockerCommandCount;
        if (reqPath.match(BUILD_IMAGE_MATCHER)) {
            if (reqUrl.searchParams.get('remote')) {
                res.writeHead(400);
                (0, error_tracking_1.reportError)("Build interception failed due to unsupported 'remote' param");
                if (reqUrl.searchParams.get('remote') === 'client-session') {
                    res.end("HTTP Toolkit does not yet support BuildKit-powered builds");
                }
                else {
                    res.end("HTTP Toolkit does not support intercepting remote build sources");
                }
                return;
            }
            const dockerfileName = (_b = reqUrl.searchParams.get('dockerfile')) !== null && _b !== void 0 ? _b : 'Dockerfile';
            const streamInjection = await (0, docker_build_injection_1.injectIntoBuildStream)(dockerfileName, req, {
                certContent: httpsConfig.certContent,
                proxyPort
            });
            requestBodyStream = streamInjection.injectedStream;
            extraDockerCommandCount = streamInjection.totalCommandsAddedPromise;
            // Make sure that host.docker.internal resolves on Linux too:
            if (process.platform === 'linux') {
                reqUrl.searchParams.append('extrahosts', `${docker_commands_1.DOCKER_HOST_HOSTNAME}:${(0, docker_commands_1.getDockerHostIp)(process.platform, { apiVersion: dockerApiVersion })}`);
                req.url = reqUrl.toString();
            }
        }
        const dockerReq = sendToDocker(req, requestBodyStream);
        dockerReq.on('error', (e) => {
            console.error('Docker proxy error', e);
            res.destroy();
        });
        dockerReq.on('response', async (dockerRes) => {
            var _a, _b;
            res.on('error', (e) => {
                console.error('Docker proxy conn error', e);
                dockerRes.destroy();
            });
            // In any container data responses that might be used by docker-compose, we need to remap some of the
            // content to ensure that intercepted containers are always used:
            const isContainerInspect = reqPath.match(CONTAINER_INSPECT_MATCHER);
            const isComposeContainerQuery = reqPath.match(CONTAINER_LIST_MATCHER) &&
                ((_a = reqUrl.searchParams.get('filters')) === null || _a === void 0 ? void 0 : _a.includes("com.docker.compose"));
            const shouldRemapContainerData = isContainerInspect || isComposeContainerQuery;
            if (shouldRemapContainerData) {
                // We're going to mess with the body, so we need to ensure that the content
                // length isn't going to conflict along the way:
                delete dockerRes.headers['content-length'];
            }
            res.writeHead(dockerRes.statusCode, dockerRes.statusMessage, dockerRes.headers);
            res.flushHeaders(); // Required, or blocking responses (/wait) don't work!
            if (reqPath.match(BUILD_IMAGE_MATCHER) && dockerRes.statusCode === 200) {
                // We transform the build output to replace the docker build interception steps with a cleaner
                // & simpler HTTP Toolkit interception message:
                dockerRes.pipe((0, docker_build_injection_1.getBuildOutputPipeline)(await extraDockerCommandCount)).pipe(res);
            }
            else if (shouldRemapContainerData) {
                // We need to remap container data, to hook all docker-compose behaviour:
                const data = await new Promise((resolve, reject) => {
                    const dataChunks = [];
                    dockerRes.on('data', (d) => dataChunks.push(d));
                    dockerRes.on('end', () => resolve(Buffer.concat(dataChunks)));
                    dockerRes.on('error', reject);
                });
                try {
                    if (isComposeContainerQuery) {
                        const containerQueryResponse = JSON.parse(data.toString('utf8'));
                        const modifiedResponse = containerQueryResponse.map((container) => (Object.assign(Object.assign({}, container), { Labels: (0, docker_compose_1.transformComposeResponseLabels)(proxyPort, container.Labels) })));
                        res.end(JSON.stringify(modifiedResponse));
                    }
                    else {
                        const containerInspectResponse = JSON.parse(data.toString('utf8'));
                        const modifiedResponse = Object.assign(Object.assign({}, containerInspectResponse), { Config: Object.assign(Object.assign({}, containerInspectResponse.Config), { Labels: (0, docker_compose_1.transformComposeResponseLabels)(proxyPort, (_b = containerInspectResponse.Config) === null || _b === void 0 ? void 0 : _b.Labels) }) });
                        res.end(JSON.stringify(modifiedResponse));
                    }
                }
                catch (e) {
                    console.error("Failed to parse container data response", e);
                    // Write the raw body back to the response - effectively just do nothing.
                    res.end(data);
                }
            }
            else {
                dockerRes.pipe(res);
            }
        });
    });
    // Forward all requests & hijacked streams to & from the real docker server:
    server.on('upgrade', async (req, socket, head) => {
        var _a;
        if (!await (0, docker_interception_services_1.isDockerAvailable)()) {
            socket.end("HTTP/1.1 504 Docker not available\r\n\r\n" +
                "HTTP Toolkit could not connect to Docker\r\n");
            return;
        }
        const dockerReq = sendToDocker(req);
        dockerReq.on('error', (e) => {
            console.error('Docker proxy error', e);
            socket.destroy();
        });
        socket.on('error', (e) => {
            console.error('Docker proxy conn error', e);
            dockerReq.destroy();
        });
        const attachMatch = ATTACH_CONTAINER_MATCHER.exec(req.url);
        // Python Docker compose (every version since 2016 at least) uses its own user agent, and
        // has problems with unexpected closure of attach requests
        const isPythonDockerCompose = ((_a = req.headers['user-agent']) !== null && _a !== void 0 ? _a : '').startsWith('docker-compose/');
        if (attachMatch && process.platform === 'win32' && !isPythonDockerCompose) {
            // On Windows for some reason attach doesn't exit by itself when containers do. To handle
            // that, we watch for exit ourselves, kill the attach shortly afterwards, in case it isn't dead
            // already.
            // This only affects Windows, and it's disabled for Python docker-compose, which doesn't handle
            // clean closure well (throwing pipe errors) but which does know how to clean up attach connections
            // all by itself (it tracks container events to close from the client side).
            const abortController = new node_abort_controller_1.AbortController();
            docker.getContainer(attachMatch[1]).wait({
                condition: 'next-exit',
                abortSignal: abortController.signal
            }).then(() => {
                setTimeout(() => {
                    socket.end();
                }, 500); // Slightly delay, in case there's more output/clean close on the way
            }).catch((err) => {
                if (abortController.signal.aborted)
                    return; // If we aborted, we don't care about errors
                console.log("Error waiting for container exit on attach", err);
            });
            socket.on('close', () => {
                // Make sure the wait is shut down if the attach is disconnected for any reason:
                abortController.abort();
            });
        }
        dockerReq.on('upgrade', (dockerRes, dockerSocket, dockerHead) => {
            socket.write(`HTTP/1.1 ${dockerRes.statusCode} ${dockerRes.statusMessage}\r\n` +
                Object.keys(dockerRes.headers).map((key) => `${key}: ${dockerRes.headers[key]}\r\n`).join("") +
                "\r\n");
            // We only write upgrade head data if it's non-empty. For some bizarre reason on
            // Windows, writing empty data to a named pipe here kills the connection entirely.
            if (dockerHead.length)
                socket.write(dockerHead);
            if (head.length)
                dockerSocket.write(head);
            dockerSocket.on('error', (e) => {
                console.error('Docker proxy error', e);
                socket.destroy();
            });
            socket.pipe(dockerSocket);
            dockerSocket.pipe(socket);
        });
    });
    const proxyListenPath = (0, exports.getDockerPipePath)(proxyPort);
    if (process.platform !== 'win32') {
        // Outside windows, sockets live on the filesystem, and persist. If a server
        // failed to clean up properly, they may still be present, which will
        // break server startup, so we clean up first:
        await (0, fs_1.deleteFile)(proxyListenPath).catch(() => { });
    }
    if (process.platform === 'win32') {
        // We're using local pipes - we can safely keep connections open forever, and doing so is
        // necessary on Windows, because docker-compose there does not expected connections in its
        // pool to ever be closed by the server, and crashes if they are. Can't use actual Infinity
        // since Node rejects it, but 1 hour should be far more than any client's own timeout.
        server.keepAliveTimeout = 1000 * 60 * 60;
    }
    await new Promise((resolve, reject) => {
        server.listen(proxyListenPath, resolve);
        server.on('error', reject);
    });
    if (process.platform !== 'win32') {
        // This socket lets you directly access Docker with the permissions of the current
        // process, which is pretty powerful - access should be limited to this user only.
        await (0, fs_1.chmod)(proxyListenPath, 0o700);
    }
    return (0, destroyable_server_1.destroyable)(server);
}
;
//# sourceMappingURL=docker-proxy.js.map