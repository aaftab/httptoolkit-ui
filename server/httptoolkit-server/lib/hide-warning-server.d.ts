import { HtkConfig } from './config';
export declare class HideWarningServer {
    private config;
    constructor(config: HtkConfig);
    private server;
    completedPromise: Promise<void>;
    start(targetUrl: string): Promise<void>;
    get host(): string;
    get hideWarningUrl(): string;
    stop(): Promise<void>;
}
