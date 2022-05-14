"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moveFile = exports.createTmp = exports.commandExists = exports.ensureDirectoryExists = exports.deleteFolder = exports.canAccess = exports.copyFile = exports.renameFile = exports.writeFile = exports.mkDir = exports.chmod = exports.checkAccess = exports.deleteFile = exports.readDir = exports.readFile = exports.statFile = void 0;
const util_1 = require("util");
const fs = require("fs");
const tmp = require("tmp");
const rimraf = require("rimraf");
const lookpath_1 = require("lookpath");
const error_1 = require("./error");
exports.statFile = (0, util_1.promisify)(fs.stat);
exports.readFile = (0, util_1.promisify)(fs.readFile);
exports.readDir = (0, util_1.promisify)(fs.readdir);
exports.deleteFile = (0, util_1.promisify)(fs.unlink);
exports.checkAccess = (0, util_1.promisify)(fs.access);
exports.chmod = (0, util_1.promisify)(fs.chmod);
exports.mkDir = (0, util_1.promisify)(fs.mkdir);
exports.writeFile = (0, util_1.promisify)(fs.writeFile);
exports.renameFile = (0, util_1.promisify)(fs.rename);
exports.copyFile = (0, util_1.promisify)(fs.copyFile);
const canAccess = (path) => (0, exports.checkAccess)(path).then(() => true).catch(() => false);
exports.canAccess = canAccess;
exports.deleteFolder = (0, util_1.promisify)(rimraf);
const ensureDirectoryExists = (path) => (0, exports.checkAccess)(path).catch(() => (0, exports.mkDir)(path, { recursive: true }));
exports.ensureDirectoryExists = ensureDirectoryExists;
const commandExists = (path) => (0, lookpath_1.lookpath)(path).then((result) => result !== undefined);
exports.commandExists = commandExists;
const createTmp = (options = {}) => new Promise((resolve, reject) => {
    tmp.file(options, (err, path, fd, cleanupCallback) => {
        if (err)
            return reject(err);
        resolve({ path, fd, cleanupCallback });
    });
});
exports.createTmp = createTmp;
const moveFile = async (oldPath, newPath) => {
    try {
        await (0, exports.renameFile)(oldPath, newPath);
    }
    catch (e) {
        if ((0, error_1.isErrorLike)(e) && e.code === 'EXDEV') {
            // Cross-device - can't rename files across partions etc.
            // In that case, we fallback to copy then delete:
            await (0, exports.copyFile)(oldPath, newPath);
            await (0, exports.deleteFile)(oldPath);
        }
    }
};
exports.moveFile = moveFile;
//# sourceMappingURL=fs.js.map