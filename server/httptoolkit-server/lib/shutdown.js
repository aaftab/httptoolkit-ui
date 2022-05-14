"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shutdown = exports.addShutdownHandler = exports.registerShutdownHandler = void 0;
const error_tracking_1 = require("./error-tracking");
const promise_1 = require("./util/promise");
const shutdownHandlers = [];
function registerShutdownHandler() {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
exports.registerShutdownHandler = registerShutdownHandler;
function addShutdownHandler(handler) {
    shutdownHandlers.push(handler);
}
exports.addShutdownHandler = addShutdownHandler;
async function shutdown(cause) {
    console.log(`Shutting down after ${cause}...`);
    const shutdownPromises = Promise.all(shutdownHandlers.map(async (handler) => {
        try {
            await handler();
        }
        catch (e) {
            (0, error_tracking_1.reportError)(e);
        }
    }));
    await Promise.race([
        shutdownPromises,
        (0, promise_1.delay)(2000) // After 2 seconds, we just close anyway, we're done.
    ]);
    process.exit(0);
}
exports.shutdown = shutdown;
//# sourceMappingURL=shutdown.js.map