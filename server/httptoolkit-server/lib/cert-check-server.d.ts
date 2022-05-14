import { HtkConfig } from './config';
export declare class CertCheckServer {
    private config;
    constructor(config: HtkConfig);
    private server;
    private certCheckedSuccessfully;
    start(targetUrl: string): Promise<void>;
    get host(): string;
    get url(): string;
    waitForSuccess(): Promise<void>;
    stop(): Promise<void>;
}
