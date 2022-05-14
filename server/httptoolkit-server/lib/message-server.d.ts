import { HtkConfig } from './config';
export declare class MessageServer {
    private config;
    private message;
    constructor(config: HtkConfig, message: string);
    private server;
    private messageSeen;
    start(): Promise<void>;
    get host(): string;
    get url(): string;
    waitForSuccess(): Promise<void>;
    stop(): Promise<void>;
}
