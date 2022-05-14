"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamLatestApk = exports.clearAllApks = void 0;
const fs = require("fs");
const path = require("path");
const stream = require("stream");
const semver = require("semver");
const node_fetch_1 = require("node-fetch");
const fs_1 = require("../../util/fs");
const error_tracking_1 = require("../../error-tracking");
async function getLatestRelease() {
    try {
        const response = await (0, node_fetch_1.default)("https://api.github.com/repos/httptoolkit/httptoolkit-android/releases/latest");
        const release = await response.json();
        const apkAsset = release.assets.filter((a) => a.name === "httptoolkit.apk")[0];
        const releaseName = release.name || release.tag_name;
        // Ignore non-semver releases
        if (!semver.valid(releaseName))
            return;
        return {
            version: releaseName,
            url: apkAsset.browser_download_url
        };
    }
    catch (e) {
        console.log("Could not check latest Android app release", e);
    }
}
async function getAllLocalApks(config) {
    const apks = (await (0, fs_1.readDir)(config.configPath))
        .map(filename => filename.match(/^httptoolkit-(.*).apk$/))
        .filter((match) => !!match)
        .map((match) => ({
        path: path.join(config.configPath, match[0]),
        version: semver.valid(match[1]) || '0.0.0'
    }));
    apks.sort((apk1, apk2) => {
        return -1 * semver.compare(apk1.version, apk2.version);
    });
    return apks;
}
async function getLatestLocalApk(config) {
    try {
        const apks = await getAllLocalApks(config);
        const latestLocalApk = apks[0];
        if (!latestLocalApk)
            return;
        else
            return latestLocalApk;
    }
    catch (e) {
        console.log("Could not check for local Android app APK", e);
        (0, error_tracking_1.reportError)(e);
    }
}
async function updateLocalApk(version, apkStream, config) {
    console.log(`Updating local APK to version ${version}`);
    const { path: tmpApk, fd: tmpApkFd, cleanupCallback } = await (0, fs_1.createTmp)({ keep: true });
    const tmpApkStream = fs.createWriteStream(tmpApk, { fd: tmpApkFd });
    apkStream.pipe(tmpApkStream);
    await new Promise((resolve, reject) => {
        apkStream.on('error', (e) => {
            reject(e);
            tmpApkStream.close();
            cleanupCallback();
        });
        tmpApkStream.on('error', (e) => {
            reject(e);
            cleanupCallback();
        });
        tmpApkStream.on('finish', () => resolve());
    });
    console.log(`Local APK written to ${tmpApk}`);
    await (0, fs_1.moveFile)(tmpApk, path.join(config.configPath, `httptoolkit-${version}.apk`));
    console.log(`Local APK moved to ${path.join(config.configPath, `httptoolkit-${version}.apk`)}`);
    await cleanupOldApks(config);
}
async function clearAllApks(config) {
    const apks = await getAllLocalApks(config);
    console.log(`Deleting all APKs: ${apks.map(apk => apk.path).join(', ')}`);
    return Promise.all(apks.map(apk => (0, fs_1.deleteFile)(apk.path)));
}
exports.clearAllApks = clearAllApks;
// Delete all but the most recent APK version in the config directory.
async function cleanupOldApks(config) {
    const apks = await getAllLocalApks(config);
    console.log(`Deleting old APKs: ${apks.slice(1).map(apk => apk.path).join(', ')}`);
    return Promise.all(apks.slice(1).map(apk => (0, fs_1.deleteFile)(apk.path)));
}
async function streamLatestApk(config) {
    const [latestApkRelease, localApk] = await Promise.all([
        await getLatestRelease(),
        await getLatestLocalApk(config)
    ]);
    if (!localApk) {
        if (!latestApkRelease) {
            throw new Error("Couldn't find an Android APK locally or remotely");
        }
        else {
            console.log('Streaming remote APK directly');
            const apkStream = (await (0, node_fetch_1.default)(latestApkRelease.url)).body;
            // We buffer output into two passthrough streams, so both file & install
            // stream usage can be set up async independently. Buffers are 10MB, to
            // avoid issues buffering the whole APK even in super weird cases.
            const apkFileStream = new stream.PassThrough({ highWaterMark: 10485760 });
            apkStream.pipe(apkFileStream);
            const apkOutputStream = new stream.PassThrough({ highWaterMark: 10485760 });
            apkStream.pipe(apkOutputStream);
            updateLocalApk(latestApkRelease.version, apkFileStream, config).catch(error_tracking_1.reportError);
            return apkOutputStream;
        }
    }
    if (!latestApkRelease || semver.gte(localApk.version, latestApkRelease.version, true)) {
        console.log('Streaming local APK');
        // If we have an APK locally and it's up to date, or we can't tell, just use it
        return fs.createReadStream(localApk.path);
    }
    // We have a local APK & a remote APK, and the remote is newer.
    // Try to update it async, and use the local APK in the meantime.
    (0, node_fetch_1.default)(latestApkRelease.url).then((apkResponse) => {
        const apkStream = apkResponse.body;
        return updateLocalApk(latestApkRelease.version, apkStream, config);
    }).catch(error_tracking_1.reportError);
    console.log('Streaming local APK, and updating it async');
    return fs.createReadStream(localApk.path);
}
exports.streamLatestApk = streamLatestApk;
//# sourceMappingURL=fetch-apk.js.map