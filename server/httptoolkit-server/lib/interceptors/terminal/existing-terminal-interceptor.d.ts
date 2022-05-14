import { Interceptor } from '..';
import { HtkConfig } from '../../config';
export declare class ExistingTerminalInterceptor implements Interceptor {
    private config;
    private servers;
    id: string;
    version: string;
    constructor(config: HtkConfig);
    isActivable(): Promise<boolean>;
    isActive(proxyPort: number): boolean;
    activate(proxyPort: number): Promise<{
        port: number;
    }>;
    deactivate(proxyPort: number): Promise<void>;
    deactivateAll(): Promise<void>;
}
