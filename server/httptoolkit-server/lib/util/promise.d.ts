export declare function delay(durationMs: number): Promise<void>;
export declare function waitUntil<T extends unknown>(delayMs: number, tries: number, test: () => Promise<T>): Promise<Exclude<T, false>>;
export interface Deferred<T> {
    resolve: (arg: T) => void;
    reject: (e?: Error) => void;
    promise: Promise<T>;
}
export declare function getDeferred<T = void>(): Deferred<T>;
