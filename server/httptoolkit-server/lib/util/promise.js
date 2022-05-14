"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeferred = exports.waitUntil = exports.delay = void 0;
function delay(durationMs) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
}
exports.delay = delay;
async function waitUntil(delayMs, tries, test) {
    let result = tries > 0 && await test();
    while (tries > 0 && !result) {
        tries = tries - 1;
        await delay(delayMs);
        result = await test();
    }
    if (!result)
        throw new Error(`Wait loop failed`);
    else
        return result;
}
exports.waitUntil = waitUntil;
function getDeferred() {
    let resolve = undefined;
    let reject = undefined;
    let promise = new Promise((resolveCb, rejectCb) => {
        resolve = resolveCb;
        reject = rejectCb;
    });
    // TS thinks we're using these before they're assigned, which is why
    // we need the undefined types, and the any here.
    return { resolve, reject, promise };
}
exports.getDeferred = getDeferred;
//# sourceMappingURL=promise.js.map