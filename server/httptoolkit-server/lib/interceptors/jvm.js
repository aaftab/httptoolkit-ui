"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JvmInterceptor = void 0;
const _ = require("lodash");
const path = require("path");
const process_management_1 = require("../util/process-management");
const terminal_env_overrides_1 = require("./terminal/terminal-env-overrides");
const error_tracking_1 = require("../error-tracking");
const promise_1 = require("../util/promise");
const fs_1 = require("../util/fs");
// Check that Java is present, and that it's compatible with agent attachment:
const javaBinPromise = (async () => {
    // Check what Java binaries might exist:
    const javaBinPaths = [
        // $JAVA_HOME/bin/java is the way to explicitly configure this
        !!process.env.JAVA_HOME &&
            path.join(process.env.JAVA_HOME, 'bin', 'java'),
        // Magic Mac helper for exactly this, used if available
        await getMacJavaHome(),
        // Fallback to $PATH, but not on Mac, where by default this is a "Install Java" dialog warning
        (await (0, fs_1.commandExists)('java')) && process.platform !== "darwin" &&
            'java'
        // In future, we could improve this by also finding & using the JVM from Android Studio. See
        // Flutter's implementation of logic required to do this:
        // https://github.com/flutter/flutter/blob/master/packages/flutter_tools/lib/src/android/android_studio.dart
    ].filter(p => !!p);
    // Run a self test in parallel with each of them:
    const javaTestResults = await Promise.all(javaBinPaths.map(async (possibleJavaBin) => ({
        javaBin: possibleJavaBin,
        output: await testJavaBin(possibleJavaBin)
            .catch((e) => ({ exitCode: -1, stdout: '', stderr: e.toString() }))
    })));
    // Use the first Java in the list that succeeds:
    const bestJava = javaTestResults.filter(({ output }) => output.exitCode === 0)[0];
    if (javaTestResults.length && !bestJava) {
        // If some Java is present, but none are working, we report the failures. Hoping that this will hunt
        // down some specific incompatibilities that we can better work around/detect.
        javaTestResults.forEach((testResult) => {
            console.log(`Running ${testResult.javaBin}:`);
            console.log(testResult.output.stdout);
            console.log(testResult.output.stderr);
        });
        throw new Error(`JVM attach not available, exited with ${javaTestResults[0].output.exitCode}`);
    }
    else if (bestJava) {
        return bestJava.javaBin;
    }
    else {
        // No Java available anywhere - we just give up
        return false;
    }
})().catch((e) => {
    (0, error_tracking_1.reportError)(e);
    return false;
});
// Try to use use Mac's java_home helper (available since 10.5 apparently)
async function getMacJavaHome() {
    if (!await (0, fs_1.canAccess)('/usr/libexec/java_home'))
        return;
    const result = await (0, process_management_1.spawnToResult)('/usr/libexec/java_home', ['-v', '1.9+']);
    if (result.exitCode != 0)
        return;
    else
        return path.join(result.stdout.trim(), 'bin', 'java');
}
// Test a single binary, with a timeout:
function testJavaBin(possibleJavaBin) {
    return Promise.race([
        (0, process_management_1.spawnToResult)(possibleJavaBin, [
            '-Djdk.attach.allowAttachSelf=true',
            '-jar', terminal_env_overrides_1.OVERRIDE_JAVA_AGENT,
            'self-test'
        ]),
        // Time out permanently after 30 seconds - this only runs once max anyway
        (0, promise_1.delay)(30000).then(() => {
            throw new Error(`Java bin test for ${possibleJavaBin} timed out`);
        })
    ]);
}
class JvmInterceptor {
    constructor(config) {
        this.config = config;
        this.id = 'attach-jvm';
        this.version = '1.0.1';
        this.interceptedProcesses = {};
        this.activableTimeout = 2000; // Increase the timeout slightly for this
    }
    async isActivable() {
        return !!await javaBinPromise;
    }
    isActive(proxyPort) {
        return _.some(this.interceptedProcesses, (port) => port === proxyPort);
    }
    async getMetadata(type) {
        // We only poll the targets available when explicitly requested,
        // since it's a bit expensive.
        if (type === 'summary')
            return {};
        if (!this.targetsPromise) {
            // We cache the targets lookup whilst it's active, so that concurrent calls
            // all just run one lookup and return the same result.
            this.targetsPromise = this.getTargets()
                .finally(() => { this.targetsPromise = undefined; });
        }
        const targets = await this.targetsPromise;
        return {
            jvmTargets: _.keyBy(targets, 'pid')
        };
    }
    async getTargets() {
        const javaBin = await javaBinPromise;
        if (!javaBin)
            throw new Error("Attach activated but no Java available");
        const listTargetsOutput = await (0, process_management_1.spawnToResult)(javaBin, [
            '-jar', terminal_env_overrides_1.OVERRIDE_JAVA_AGENT,
            'list-targets'
        ]);
        if (listTargetsOutput.exitCode !== 0) {
            (0, error_tracking_1.reportError)(`JVM target lookup failed with status ${listTargetsOutput.exitCode}`);
            return [];
        }
        return listTargetsOutput.stdout
            .split('\n')
            .filter(line => line.includes(':'))
            .map((line) => {
            const nameIndex = line.indexOf(':') + 1;
            const pid = line.substring(0, nameIndex - 1);
            return {
                pid,
                name: line.substring(nameIndex),
                interceptedByProxy: this.interceptedProcesses[pid]
            };
        })
            .filter((target) => 
        // Exclude our own attacher and/or list-target queries from this list
        !target.name.includes(terminal_env_overrides_1.OVERRIDE_JAVA_AGENT));
    }
    async activate(proxyPort, options) {
        const interceptionResult = await (0, process_management_1.spawnToResult)('java', [
            '-jar', terminal_env_overrides_1.OVERRIDE_JAVA_AGENT,
            options.targetPid,
            '127.0.0.1',
            proxyPort.toString(),
            this.config.https.certPath
        ], {});
        if (interceptionResult.exitCode !== 0) {
            console.log(interceptionResult.stdout);
            console.log(interceptionResult.stderr);
            throw new Error(`Failed to attach to JVM, exit code ${interceptionResult.exitCode}`);
        }
        else {
            this.interceptedProcesses[options.targetPid] = proxyPort;
            // Poll the status of this pid every 250ms - remove it once it disappears.
            (0, process_management_1.waitForExit)(parseInt(options.targetPid, 10), Infinity)
                .then(() => {
                delete this.interceptedProcesses[options.targetPid];
            });
        }
    }
    // Nothing we can do to deactivate, unfortunately. In theory the agent could do this, unwriting all
    // it's changes, but it's *super* complicated to do for limited benefit.
    async deactivate(proxyPort) { }
    async deactivateAll() { }
}
exports.JvmInterceptor = JvmInterceptor;
//# sourceMappingURL=jvm.js.map