"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportError = exports.addBreadcrumb = exports.initErrorTracking = void 0;
const path = require("path");
const child_process = require("child_process");
const Sentry = require("@sentry/node");
const integrations_1 = require("@sentry/integrations");
const constants_1 = require("./constants");
let sentryInitialized = false;
function initErrorTracking() {
    const packageJson = require('../package.json');
    let { SENTRY_DSN } = process.env;
    if (!SENTRY_DSN && constants_1.IS_PROD_BUILD) {
        // If we're a built binary, use the standard DSN automatically
        SENTRY_DSN = 'https://5838a5520ad44602ae46793727e49ef5@sentry.io/1371158';
    }
    if (SENTRY_DSN) {
        Sentry.init({
            dsn: SENTRY_DSN,
            release: packageJson.version,
            integrations: [
                new integrations_1.RewriteFrames({
                    // We're one dir down: either /bundle, or /src
                    root: process.platform === 'win32'
                        // Root must always be POSIX format, so we transform it on Windows:
                        ? path.posix.join(__dirname
                            .replace(/^[A-Z]:/, '') // remove Windows-style prefix
                            .replace(/\\/g, '/'), // replace all `\\` instances with `/`
                        '..')
                        : path.join(__dirname, '..')
                })
            ],
            beforeBreadcrumb(breadcrumb, hint) {
                if (breadcrumb.category === 'http') {
                    // Almost all HTTP requests sent by the server are actually forwarded HTTP from
                    // the proxy, so could be very sensitive. We need to ensure errors don't leak data.
                    // Remove all but the host from the breadcrumb data. The host is fairly safe & often
                    // useful for context, but the path & query could easily contain sensitive secrets.
                    if (breadcrumb.data && breadcrumb.data.url) {
                        const url = breadcrumb.data.url;
                        const hostIndex = url.indexOf('://') + 3;
                        const pathIndex = url.indexOf('/', hostIndex);
                        if (pathIndex !== -1) {
                            breadcrumb.data.url = url.slice(0, pathIndex);
                        }
                    }
                    if (hint) {
                        // Make sure we don't collect the full HTTP data in hints either.
                        delete hint.request;
                        delete hint.response;
                    }
                }
                return breadcrumb;
            },
            beforeSend(event, hint) {
                if (event.exception && event.exception.values) {
                    event.exception.values.forEach((value) => {
                        if (!value.value)
                            return;
                        value.value = value.value
                            // Strip any usernames that end up appearing within error values.
                            // This helps to dedupe error reports, and it's good for privacy too
                            .replace(/\/home\/[^\/]+\//g, '/home/<username>/')
                            .replace(/\/Users\/[^\/]+\//g, '/Users/<username>/')
                            .replace(/(\w):\\Users\\[^\\]+\\/gi, '$1:\\Users\\<username>\\')
                            // Dedupe temp filenames in errors (from terminal script setup)
                            .replace(/([a-zA-Z]+)\d{12,}\.temp/g, '$1<number>.temp');
                    });
                }
                return event;
            }
        });
        Sentry.configureScope((scope) => {
            scope.setTag('platform', process.platform);
        });
        // Include breadcrumbs for subprocess spawning, to trace interceptor startup details:
        const rawSpawn = child_process.spawn;
        child_process.spawn = function (command, args, options) {
            const sanitizedOptions = Object.assign(Object.assign({}, options), { env: Object.entries((options && options.env) || {})
                    .map(([key, value]) => {
                    // Remove all actual env values from this reporting; only included our changed values.
                    const realValue = process.env[key];
                    if (value === realValue)
                        return undefined;
                    else if (realValue)
                        return [key, value.replace(realValue, '[...]')];
                    else
                        return [key, value];
                })
                    .filter((entry) => entry !== undefined) });
            addBreadcrumb('Spawning process', { data: { command, args, options: sanitizedOptions } });
            return rawSpawn.apply(this, arguments);
        };
        sentryInitialized = true;
    }
}
exports.initErrorTracking = initErrorTracking;
function addBreadcrumb(message, data) {
    Sentry.addBreadcrumb(Object.assign({ message }, data));
}
exports.addBreadcrumb = addBreadcrumb;
function reportError(error) {
    console.warn(error);
    if (!sentryInitialized)
        return;
    if (typeof error === 'string') {
        Sentry.captureMessage(error);
    }
    else {
        Sentry.captureException(error);
    }
    return Sentry.flush(500).then((sentSuccessfully) => {
        if (sentSuccessfully === false)
            console.log('Error reporting timed out');
    });
}
exports.reportError = reportError;
//# sourceMappingURL=error-tracking.js.map