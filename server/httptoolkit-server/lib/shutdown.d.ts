declare type ShutdownHandler = () => Promise<unknown>;
export declare function registerShutdownHandler(): void;
export declare function addShutdownHandler(handler: ShutdownHandler): void;
export declare function shutdown(cause: string): Promise<void>;
export {};
