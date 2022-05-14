import { Interceptor } from '..';
import { HtkConfig } from '../../config';
export declare class AndroidAdbInterceptor implements Interceptor {
    private config;
    readonly id = "android-adb";
    readonly version = "1.0.0";
    private readonly deviceProxyMapping;
    private adbClient;
    constructor(config: HtkConfig);
    isActivable(): Promise<boolean>;
    activableTimeout: number;
    isActive(): boolean;
    getMetadata(): Promise<{
        deviceIds: string[];
    }>;
    activate(proxyPort: number, options: {
        deviceId: string;
    }): Promise<void | {}>;
    deactivate(port: number | string): Promise<void | {}>;
    deactivateAll(): Promise<void | {}>;
    private injectSystemCertIfPossible;
}
