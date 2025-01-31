"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTerminalEnvVars = exports.OVERRIDE_JAVA_AGENT = exports.OVERRIDE_BIN_PATH = exports.OVERRIDES_DIR = void 0;
const path = require("path");
const constants_1 = require("../../constants");
const docker_proxy_1 = require("../docker/docker-proxy");
const BIN_OVERRIDE_DIR = 'path';
const RUBY_OVERRIDE_DIR = 'gems';
const PYTHON_OVERRIDE_DIR = 'pythonpath';
const NODE_PREPEND_SCRIPT = ['js', 'prepend-node.js'];
const JAVA_AGENT_JAR = 'java-agent.jar';
exports.OVERRIDES_DIR = path.join(constants_1.APP_ROOT, 'overrides');
// Used in terminal scripts that help to enforce our PATH override elsewhere:
exports.OVERRIDE_BIN_PATH = path.join(exports.OVERRIDES_DIR, BIN_OVERRIDE_DIR);
// Use in attach-jvm to attach externally to a running JVM process:
exports.OVERRIDE_JAVA_AGENT = path.join(exports.OVERRIDES_DIR, JAVA_AGENT_JAR);
function getTerminalEnvVars(proxyPort, httpsConfig, currentEnv, targetEnvConfig = {}) {
    const { overridePath, targetPlatform, httpToolkitIp } = Object.assign({ httpToolkitIp: '127.0.0.1', overridePath: exports.OVERRIDES_DIR, targetPlatform: process.platform }, targetEnvConfig);
    const pathVarSeparator = targetPlatform === 'win32' ? ';' : ':';
    const joinPath = targetPlatform === 'win32' ? path.win32.join : path.posix.join;
    const proxyUrl = `http://${httpToolkitIp}:${proxyPort}`;
    const dockerHost = `${targetPlatform === 'win32'
        ? 'npipe'
        : 'unix'}://${(0, docker_proxy_1.getDockerPipePath)(proxyPort, targetPlatform)}`;
    const rubyGemsPath = joinPath(overridePath, RUBY_OVERRIDE_DIR);
    const pythonPath = joinPath(overridePath, PYTHON_OVERRIDE_DIR);
    const nodePrependScript = joinPath(overridePath, ...NODE_PREPEND_SCRIPT);
    const nodePrependOption = `--require ${
    // Avoid quoting except when necessary, because node 8 doesn't support quotes here
    nodePrependScript.includes(' ')
        ? `"${nodePrependScript}"`
        : nodePrependScript}`;
    const javaAgentOption = `-javaagent:"${joinPath(overridePath, JAVA_AGENT_JAR)}"=${httpToolkitIp}|${proxyPort}|${httpsConfig.certPath}`;
    const binPath = joinPath(overridePath, BIN_OVERRIDE_DIR);
    return {
        'http_proxy': proxyUrl,
        'HTTP_PROXY': proxyUrl,
        'https_proxy': proxyUrl,
        'HTTPS_PROXY': proxyUrl,
        // Used by global-agent to configure node.js HTTP(S) defaults
        'GLOBAL_AGENT_HTTP_PROXY': proxyUrl,
        // Used by some CGI engines to avoid 'httpoxy' vulnerability
        'CGI_HTTP_PROXY': proxyUrl,
        // Used by npm, for versions that don't support HTTP_PROXY etc
        'npm_config_proxy': proxyUrl,
        'npm_config_https_proxy': proxyUrl,
        // Stop npm warning about having a different 'node' in $PATH
        'npm_config_scripts_prepend_node_path': 'false',
        // Proxy used by the Go CLI
        'GOPROXY': proxyUrl,
        // Trust cert when using OpenSSL with default settings
        'SSL_CERT_FILE': httpsConfig.certPath,
        // Trust cert when using Node 7.3.0+
        'NODE_EXTRA_CA_CERTS': httpsConfig.certPath,
        // Trust cert when using Requests (Python)
        'REQUESTS_CA_BUNDLE': httpsConfig.certPath,
        // Trust cert when using Perl LWP
        'PERL_LWP_SSL_CA_FILE': httpsConfig.certPath,
        // Trust cert for HTTPS requests from Git
        'GIT_SSL_CAINFO': httpsConfig.certPath,
        // Trust cert in Rust's Cargo:
        'CARGO_HTTP_CAINFO': httpsConfig.certPath,
        // Trust cert in CURL (only required when not using OpenSSL):
        'CURL_CA_BUNDLE': httpsConfig.certPath,
        // Flag used by subprocesses to check they're running in an intercepted env
        'HTTP_TOOLKIT_ACTIVE': 'true',
        // Prepend our bin overrides into $PATH
        'PATH': `${binPath}${pathVarSeparator}${currentEnv == 'runtime-inherit' ? '$PATH' : currentEnv.PATH}`,
        // Prepend our Ruby gem overrides into $LOAD_PATH
        'RUBYLIB': currentEnv === 'runtime-inherit'
            ? `${rubyGemsPath}:$RUBYLIB`
            : !!currentEnv.RUBYLIB
                ? `${rubyGemsPath}:${currentEnv.RUBYLIB}`
                : rubyGemsPath,
        // Prepend our Python package overrides into $PYTHONPATH
        'PYTHONPATH': currentEnv === 'runtime-inherit'
            ? `${pythonPath}:$PYTHONPATH`
            : currentEnv.PYTHONPATH
                ? `${pythonPath}:${currentEnv.PYTHONPATH}`
                : pythonPath,
        // We use $NODE_OPTIONS to prepend our script into node. Notably this drops existing
        // env values, when using our env, because _our_ NODE_OPTIONS aren't meant for
        // subprocesses. Otherwise e.g. --max-http-header-size breaks old Node/Electron.
        'NODE_OPTIONS': currentEnv === 'runtime-inherit'
            ? `$NODE_OPTIONS ${nodePrependOption}`
            : nodePrependOption,
        // Attach our Java agent to all launched Java processes:
        'JAVA_TOOL_OPTIONS': currentEnv === 'runtime-inherit'
            ? `$JAVA_TOOL_OPTIONS ${javaAgentOption}`
            : currentEnv.JAVA_TOOL_OPTIONS
                ? `${currentEnv.JAVA_TOOL_OPTIONS} ${javaAgentOption}`
                : javaAgentOption,
        // Run all Docker operations through our Docker-hooking proxy:
        'DOCKER_HOST': dockerHost,
        // For now, we don't support intercepting BuildKit builds - disable them:
        'DOCKER_BUILDKIT': '0'
    };
}
exports.getTerminalEnvVars = getTerminalEnvVars;
//# sourceMappingURL=terminal-env-overrides.js.map