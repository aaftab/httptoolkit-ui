import { Interceptor } from '..';
import { HtkConfig } from '../../config';
export declare class FreshTerminalInterceptor implements Interceptor {
    private config;
    id: string;
    version: string;
    constructor(config: HtkConfig);
    isActivable(): Promise<boolean>;
    isActive(proxyPort: number | string): boolean;
    activate(proxyPort: number): Promise<void>;
    deactivate(proxyPort: number | string): Promise<void>;
    deactivateAll(): Promise<void>;
}
