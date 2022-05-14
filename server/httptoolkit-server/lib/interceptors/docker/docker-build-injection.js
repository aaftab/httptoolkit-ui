"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBuildOutputPipeline = exports.injectIntoDockerfile = exports.injectIntoBuildStream = exports.DOCKER_BUILD_LABEL = void 0;
const _ = require("lodash");
const path = require("path");
const EventStream = require("event-stream");
const getRawBody = require("raw-body");
const maybeGunzip = require("gunzip-maybe");
const tarStream = require("tar-stream");
const tarFs = require("tar-fs");
const docker_file_parser_1 = require("docker-file-parser");
const terminal_env_overrides_1 = require("../terminal/terminal-env-overrides");
const promise_1 = require("../../util/promise");
const docker_commands_1 = require("./docker-commands");
const HTTP_TOOLKIT_INJECTED_PATH = '/http-toolkit-injections';
const HTTP_TOOLKIT_INJECTED_OVERRIDES_PATH = path.posix.join(HTTP_TOOLKIT_INJECTED_PATH, 'overrides');
const HTTP_TOOLKIT_INJECTED_CA_PATH = path.posix.join(HTTP_TOOLKIT_INJECTED_PATH, 'ca.pem');
const HTTP_TOOLKIT_CONTEXT_PATH = '/.http-toolkit-injections';
const HTTP_TOOLKIT_CONTEXT_OVERRIDES_PATH = path.posix.join(HTTP_TOOLKIT_CONTEXT_PATH, 'overrides');
const HTTP_TOOLKIT_CONTEXT_CA_PATH = path.posix.join(HTTP_TOOLKIT_CONTEXT_PATH, 'ca.pem');
exports.DOCKER_BUILD_LABEL = 'tech.httptoolkit.docker.build-proxy';
/**
 * Take a build context stream, and transform it to inject into the build itself via
 * the Dockerfile. Supports gzipped & raw tarballs.
 */
function injectIntoBuildStream(dockerfileName, buildStream, config) {
    const extractionStream = tarStream.extract();
    const repackStream = tarStream.pack();
    let commandsAddedToDockerfile = (0, promise_1.getDeferred)();
    const dockerfileConfig = Object.assign(Object.assign({}, config), { envVars: (0, terminal_env_overrides_1.getTerminalEnvVars)(config.proxyPort, { certPath: HTTP_TOOLKIT_INJECTED_CA_PATH }, 'runtime-inherit', // Dockerfile commands can reference vars directly
        {
            httpToolkitIp: docker_commands_1.DOCKER_HOST_HOSTNAME,
            overridePath: HTTP_TOOLKIT_INJECTED_OVERRIDES_PATH,
            targetPlatform: 'linux'
        }) });
    extractionStream.on('entry', async (headers, entryStream, next) => {
        if (headers.name === dockerfileName) {
            const originalDockerfile = (await getRawBody(entryStream)).toString('utf-8');
            const dockerfileTransformation = injectIntoDockerfile(originalDockerfile, dockerfileConfig);
            commandsAddedToDockerfile.resolve(dockerfileTransformation.commandsAdded);
            repackStream.entry(_.omit(headers, 'size'), dockerfileTransformation.dockerfile, next);
        }
        else {
            // Copy the file into the repacked tarball untouched:
            entryStream.pipe(repackStream.entry(headers, next));
        }
    });
    extractionStream.on('finish', async () => {
        repackStream.entry({ name: HTTP_TOOLKIT_CONTEXT_CA_PATH }, config.certContent);
        await packOverrideFiles(repackStream);
        repackStream.finalize();
    });
    buildStream.pipe(maybeGunzip()).pipe(extractionStream);
    return {
        injectedStream: repackStream,
        totalCommandsAddedPromise: Promise.race([
            commandsAddedToDockerfile.promise,
            // If we never find a Dockerfile, continue anyway, in that case Docker will probably
            // error immediately in a moment, so this value won't matter too much:
            new Promise((resolve) => extractionStream.on('finish', resolve)).then(() => 0)
        ])
    };
}
exports.injectIntoBuildStream = injectIntoBuildStream;
function packOverrideFiles(existingPackStream) {
    return new Promise((resolve) => {
        tarFs.pack(terminal_env_overrides_1.OVERRIDES_DIR, {
            pack: existingPackStream,
            map: (fileHeader) => {
                fileHeader.name = path.posix.join(HTTP_TOOLKIT_CONTEXT_OVERRIDES_PATH, fileHeader.name);
                // Owned by root by default
                fileHeader.uid = 0;
                fileHeader.gid = 0;
                // But ensure everything is globally readable & runnable
                fileHeader.mode = parseInt('555', 8);
                return fileHeader;
            },
            finalize: false,
            finish: resolve
        });
    });
}
function injectIntoDockerfile(dockerfileContents, config) {
    const dockerCommands = (0, docker_file_parser_1.parse)(dockerfileContents, {
        includeComments: true
    });
    // After every FROM (start of each build stage) we inject ARG & COPY to reconfigure the stage:
    const fromCommandIndexes = dockerCommands
        .map((command, index) => command.name === 'FROM'
        ? index
        : -1)
        .filter((index) => index !== -1);
    const injectionCommands = [
        {
            // The started/end labels are used to spot when the interception process begins &
            // ends, so we can cleanly remap the output.
            name: 'LABEL',
            args: [`${exports.DOCKER_BUILD_LABEL}=started-${config.proxyPort}`]
        },
        {
            name: 'COPY',
            args: [HTTP_TOOLKIT_CONTEXT_PATH, HTTP_TOOLKIT_INJECTED_PATH]
        },
        ...(!_.isEmpty(config.envVars)
            ? [{
                    name: 'ENV',
                    args: config.envVars
                }] : []),
        {
            name: 'LABEL',
            args: [`${exports.DOCKER_BUILD_LABEL}=${config.proxyPort}`]
        }
        // COPY must not be the last command, or (in subsequent multi-stage builds) we will hit
        // this Docker bug: https://github.com/moby/moby/issues/37965
    ];
    fromCommandIndexes.reverse().forEach((fromIndex) => {
        dockerCommands.splice(fromIndex + 1, 0, ...injectionCommands);
    });
    const commandsAdded = fromCommandIndexes.length * injectionCommands.length;
    return {
        dockerfile: generateDockerfileFromCommands(dockerCommands),
        commandsAdded
    };
}
exports.injectIntoDockerfile = injectIntoDockerfile;
// Commands -> Dockerfile logic based on Balena's equivalent (Apache-2 licensed) code here:
// https://github.com/balena-io-modules/docker-qemu-transpose/blob/734d8397dfe33ae3af85cdd4fb27c64a6ca77a25/src/index.ts#L107-L144
function generateDockerfileFromCommands(commands) {
    return commands.map(command => {
        if (command.raw) {
            return command.raw;
        }
        else if (command.name === 'COMMENT') {
            return command.args;
        }
        else {
            return `${command.name} ${argsToString(command.args, command.name)}`;
        }
    }).join('\n');
}
const SPACE_SEPARATED_ARRAY_COMMANDS = ['ARG', 'EXPOSE', 'LABEL'];
function argsToString(args, commandName) {
    if (_.isArray(args)) {
        let ret = '';
        // Handle command meta-arguments (like --from=stage)
        if (args[0] != null && args[0].startsWith('--')) {
            ret += args[0] + ' ';
            args = args.slice(1);
        }
        if (SPACE_SEPARATED_ARRAY_COMMANDS.includes(commandName)) {
            return ret + args.join(' ');
        }
        return ret + '["' + args.join('","') + '"]';
    }
    else if (_.isObject(args)) {
        return _.map(args, (value, key) => {
            const escapedValue = JSON.stringify(value);
            return `${key}=${escapedValue}`;
        }).join(' ');
    }
    else {
        return args;
    }
}
;
// Output parsing & transformation logic inspired from Balena's equivalent (Apache-2 licensed) code here:
// https://github.com/balena-io-modules/docker-qemu-transpose/blob/734d8397dfe33ae3af85cdd4fb27c64a6ca77a25/src/index.ts#L232-L285
const END_OF_STEP_REGEX = /^ ---\u003e [a-z0-9]+\n$/;
/**
 * Takes a response stream of a Docker build (i.e. build output) and transforms it to simplify all the
 * HTTP Toolkit interception noise down to a single clear line, and normalize the step count text
 * to match.
 */
function getBuildOutputPipeline(extraDockerCommandCount) {
    let outputToHide = 'none';
    let totalStepCount = -1;
    let step = 0;
    return EventStream.pipeline(EventStream.split(), EventStream.mapSync((rawLine) => {
        var _a, _b;
        if (!(rawLine === null || rawLine === void 0 ? void 0 : rawLine.toString()))
            return rawLine;
        const data = JSON.parse(rawLine.toString());
        if (isStepLine(data.stream) && totalStepCount === -1) {
            // Pull the total step count from the first step line we find, and the reduce it to
            // hide the extra steps that we've added:
            totalStepCount = getTotalSteps(data.stream) - extraDockerCommandCount;
        }
        // We use labels as start/end markers for our injected sections.
        if ((_a = data.stream) === null || _a === void 0 ? void 0 : _a.includes(`LABEL ${exports.DOCKER_BUILD_LABEL}=started`)) {
            // When we see a start label, print a single message, and then hide all the work
            // that's actually required to intercept everything.
            outputToHide = 'all';
            return JSON.stringify({
                stream: " *** Enabling HTTP Toolkit interception ***\n"
            });
        }
        else if (outputToHide === 'all') {
            if ((_b = data.stream) === null || _b === void 0 ? void 0 : _b.includes(`LABEL ${exports.DOCKER_BUILD_LABEL}=`)) {
                // When we see the final label, start looking for an end-of-step line
                outputToHide = 'until-next';
            }
            return "";
        }
        else if (outputToHide === 'until-next' && data.stream) {
            // Keep skipping, until we get until-next state + an end-of-step line
            if (!data.stream.match(END_OF_STEP_REGEX)) {
                return "";
            }
            outputToHide = 'none';
            // Don't drop the last line - fall through and output as normal:
        }
        // If we're actually printing a line, update it to fix the step count:
        if (isStepLine(data.stream)) {
            step += 1;
            data.stream = replaceSteps(data.stream, step, totalStepCount);
        }
        return JSON.stringify(data);
    }));
}
exports.getBuildOutputPipeline = getBuildOutputPipeline;
// Regex to match against 'Step 1/5:', 'Step 1/5 :', and all lower case versions etc.
const stepLineRegex = /^step\s\d+\/(\d+)\s?:/i;
const isStepLine = (str) => !!(str === null || str === void 0 ? void 0 : str.match(stepLineRegex));
const getTotalSteps = (stepLine) => {
    const stepLineMatch = stepLineRegex.exec(stepLine);
    if (!stepLineMatch)
        throw new Error('Unexpected non-Step X line in Docker output');
    return parseInt(stepLineMatch[1], 10);
};
const replaceSteps = (stepLine, stepCount, totalSteps) => {
    return stepLine.replace(stepLineRegex, `Step ${stepCount}/${totalSteps} :`);
};
//# sourceMappingURL=docker-build-injection.js.map