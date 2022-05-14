"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isErrorLike = void 0;
// Useful to easily cast and then examine errors that are otherwise 'unknown':
function isErrorLike(error) {
    return typeof error === 'object' && (error instanceof Error ||
        error.message ||
        error.code ||
        error.stack);
}
exports.isErrorLike = isErrorLike;
//# sourceMappingURL=error.js.map