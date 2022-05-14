"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bringToFront = exports.injectSystemCertificate = exports.hasCertInstalled = exports.getRootCommand = exports.pushFile = exports.stringAsStream = exports.getConnectedDevices = exports.createAdbClient = exports.SYSTEM_CA_PATH = exports.ANDROID_TEMP = void 0;
const stream = require("stream");
const path = require("path");
const adb = require("@devicefarmer/adbkit");
const error_tracking_1 = require("../../error-tracking");
const error_1 = require("../../util/error");
const promise_1 = require("../../util/promise");
const certificates_1 = require("../../certificates");
exports.ANDROID_TEMP = '/data/local/tmp';
exports.SYSTEM_CA_PATH = '/system/etc/security/cacerts';
function createAdbClient() {
    const client = adb.createClient({
        port: process.env['ANDROID_ADB_SERVER_PORT']
            ? parseInt(process.env['ANDROID_ADB_SERVER_PORT'], 10)
            : 5037,
        // The path used to start adb, if it isn't already running:
        bin: process.env['ANDROID_HOME']
            ? path.join(process.env['ANDROID_HOME'], 'platform-tools', 'adb')
            : 'adb'
    });
    // We listen for errors and report them. This only happens if adbkit completely
    // fails to handle or listen to a connection error. We'd rather report that than crash.
    client.on('error', error_tracking_1.reportError);
    return client;
}
exports.createAdbClient = createAdbClient;
// Batch async calls, so that all calls whilst one call is ongoing return the same result.
// Always uses the arguments from the first call, so this isn't safe for some cases!
const batchCalls = (fn) => {
    let ongoingCall = undefined;
    return (...args) => {
        if (!ongoingCall) {
            ongoingCall = fn(...args)
                .then((result) => {
                ongoingCall = undefined;
                return result;
            })
                .catch((error) => {
                ongoingCall = undefined;
                throw error;
            });
        }
        return ongoingCall;
    };
};
exports.getConnectedDevices = batchCalls(async (adbClient) => {
    try {
        const devices = await adbClient.listDevices();
        return devices
            .filter(d => d.type !== 'offline' &&
            d.type !== 'unauthorized' &&
            !d.type.startsWith("no permissions")).map(d => d.id);
    }
    catch (e) {
        if ((0, error_1.isErrorLike)(e) && (e.code === 'ENOENT' || // No ADB available
            e.code === 'EACCES' || // ADB available, but we aren't allowed to run it
            e.code === 'EPERM' || // Permissions error launching ADB
            e.code === 'ECONNREFUSED' || // Tried to start ADB, but still couldn't connect
            e.code === 'ENOTDIR' || // ADB path contains something that's not a directory
            e.signal === 'SIGKILL' || // In some envs 'adb start-server' is always killed (why?)
            (e.cmd && e.code) // ADB available, but "adb start-server" failed
        )) {
            if (e.code !== 'ENOENT') {
                console.log(`ADB unavailable, ${e.cmd
                    ? `${e.cmd} exited with ${e.code}`
                    : `due to ${e.code}`}`);
            }
            return [];
        }
        else {
            (0, error_tracking_1.reportError)(e);
            throw e;
        }
    }
});
function stringAsStream(input) {
    const contentStream = new stream.Readable();
    contentStream._read = () => { };
    contentStream.push(input);
    contentStream.push(null);
    return contentStream;
}
exports.stringAsStream = stringAsStream;
async function run(adbClient, deviceId, command, options = {
    timeout: 10000
}) {
    return Promise.race([
        adbClient.shell(deviceId, command)
            .then(adb.util.readAll)
            .then(buffer => buffer.toString('utf8')),
        ...(options.timeout
            ? [
                (0, promise_1.delay)(options.timeout)
                    .then(() => { throw new Error(`Timeout for ADB command ${command}`); })
            ]
            : [])
    ]);
}
async function pushFile(adbClient, deviceId, contents, path, mode) {
    const transfer = await adbClient.push(deviceId, contents, path, mode);
    return new Promise((resolve, reject) => {
        transfer.on('end', resolve);
        transfer.on('error', reject);
    });
}
exports.pushFile = pushFile;
const runAsRootCommands = [
    ['su', 'root'],
    ['su', '-c'] // Normal root
];
async function getRootCommand(adbClient, deviceId) {
    // Run whoami with each of the possible root commands
    const rootCheckResults = await Promise.all(runAsRootCommands.map((cmd) => run(adbClient, deviceId, cmd.concat('whoami'), { timeout: 1000 }).catch(console.log)
        .then((whoami) => ({ cmd, whoami }))));
    // Filter to just commands that successfully printed 'root'
    const validRootCommands = rootCheckResults
        .filter((result) => (result.whoami || '').trim() === 'root')
        .map((result) => result.cmd);
    if (validRootCommands.length >= 1)
        return validRootCommands[0];
    // If no explicit root commands are available, try to restart adb in root
    // mode instead. If this works, *all* commands will run as root.
    // We prefer explicit "su" calls if possible, to limit access & side effects.
    await adbClient.root(deviceId).catch((e) => {
        if (e.message && e.message.includes("adbd is already running as root"))
            return;
        else
            console.log(e);
    });
    // Sometimes switching to root can disconnect ADB devices, so double-check
    // they're still here, and wait a few seconds for them to come back if not.
    await (0, promise_1.delay)(500); // Wait, since they may not disconnect immediately
    const whoami = await (0, promise_1.waitUntil)(250, 10, () => {
        return run(adbClient, deviceId, ['whoami']).catch(() => false);
    }).catch(console.log);
    return (whoami || '').trim() === 'root'
        ? [] // all commands now run as root, so no prefix required.
        : undefined; // Still not root, no luck.
}
exports.getRootCommand = getRootCommand;
async function hasCertInstalled(adbClient, deviceId, certHash, certFingerprint) {
    try {
        const certPath = `/system/etc/security/cacerts/${certHash}.0`;
        const certStream = await adbClient.pull(deviceId, certPath);
        // Wait until it's clear that the read is successful
        const data = await new Promise((resolve, reject) => {
            const data = [];
            certStream.on('data', (d) => data.push(d));
            certStream.on('end', () => resolve(Buffer.concat(data)));
            certStream.on('error', reject);
        });
        // The device already has an HTTP Toolkit cert. But is it the right one?
        const existingCert = (0, certificates_1.parseCert)(data.toString('utf8'));
        const existingFingerprint = (0, certificates_1.getCertificateFingerprint)(existingCert);
        return certFingerprint === existingFingerprint;
    }
    catch (e) {
        // Couldn't read the cert, or some other error - either way, we probably
        // don't have a working system cert installed.
        return false;
    }
}
exports.hasCertInstalled = hasCertInstalled;
async function injectSystemCertificate(adbClient, deviceId, rootCmd, certificatePath) {
    const injectionScriptPath = `${exports.ANDROID_TEMP}/htk-inject-system-cert.sh`;
    // We have a challenge here. How do we add a new cert to /system/etc/security/cacerts,
    // when that's generally read-only & often hard to remount (emulators require startup
    // args to allow RW system files). Solution: mount a virtual temporary FS on top of it.
    await pushFile(adbClient, deviceId, stringAsStream(`
            set -e # Fail on error

            # Create a separate temp directory, to hold the current certificates
            # Without this, when we add the mount we can't read the current certs anymore.
            mkdir -m 700 /data/local/tmp/htk-ca-copy

            # Copy out the existing certificates
            cp /system/etc/security/cacerts/* /data/local/tmp/htk-ca-copy/

            # Create the in-memory mount on top of the system certs folder
            mount -t tmpfs tmpfs /system/etc/security/cacerts

            # Copy the existing certs back into the tmpfs mount, so we keep trusting them
            mv /data/local/tmp/htk-ca-copy/* /system/etc/security/cacerts/

            # Copy our new cert in, so we trust that too
            mv ${certificatePath} /system/etc/security/cacerts/

            # Update the perms & selinux context labels, so everything is as readable as before
            chown root:root /system/etc/security/cacerts/*
            chmod 644 /system/etc/security/cacerts/*
            chcon u:object_r:system_file:s0 /system/etc/security/cacerts/*

            # Delete the temp cert directory & this script itself
            rm -r /data/local/tmp/htk-ca-copy
            rm ${injectionScriptPath}

            echo "System cert successfully injected"
        `), injectionScriptPath, 
    // Due to an Android bug - user mode is always duplicated to group & others. We set as read-only
    // to avoid making this writable by others before we run it as root in a moment.
    // More details: https://github.com/openstf/adbkit/issues/126
    0o444);
    // Actually run the script that we just pushed above, as root
    const scriptOutput = await run(adbClient, deviceId, rootCmd.concat('sh', injectionScriptPath));
    console.log(scriptOutput);
}
exports.injectSystemCertificate = injectSystemCertificate;
async function bringToFront(adbClient, deviceId, activityName // Of the form: com.package/com.package.YourActivity
) {
    // Wake the device up, so it's at least obviously locked if locked.
    // It's not possible to unlock the device over ADB. Does nothing if already awake.
    await adbClient.shell(deviceId, [
        "input", "keyevent", "KEYCODE_WAKEUP"
    ]);
    await (0, promise_1.delay)(10);
    // Bring the activity to the front, so we can interact with it (this will
    // silently fail if the device is locked, but we're ok with that).
    await adbClient.shell(deviceId, [
        "am", "start", "--activity-single-top", activityName
    ]);
}
exports.bringToFront = bringToFront;
//# sourceMappingURL=adb-commands.js.map