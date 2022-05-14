import * as Sentry from '@sentry/node';
export declare function initErrorTracking(): void;
export declare function addBreadcrumb(message: string, data: Sentry.Breadcrumb): void;
export declare function reportError(error: Error | string | unknown): undefined | Promise<void>;
