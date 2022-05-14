import { Interceptor } from '.';
import { HtkConfig } from '../config';
export declare class ElectronInterceptor implements Interceptor {
    private config;
    readonly id = "electron";
    readonly version = "1.0.1";
    private debugClients;
    constructor(config: HtkConfig);
    private certData;
    isActivable(): Promise<boolean>;
    isActive(proxyPort: number | string): boolean;
    activate(proxyPort: number, options: {
        pathToApplication: string;
    }): Promise<void | {}>;
    deactivate(proxyPort: number | string): Promise<void>;
    deactivateAll(): Promise<void>;
}
