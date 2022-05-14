import { Interceptor } from '.';
import { HtkConfig } from '../config';
declare type JvmTarget = {
    pid: string;
    name: string;
    interceptedByProxy: number | undefined;
};
export declare class JvmInterceptor implements Interceptor {
    private config;
    readonly id = "attach-jvm";
    readonly version = "1.0.1";
    private interceptedProcesses;
    constructor(config: HtkConfig);
    isActivable(): Promise<boolean>;
    activableTimeout: number;
    isActive(proxyPort: number | string): boolean;
    getMetadata(type: 'summary' | 'detailed'): Promise<{
        jvmTargets?: {
            [pid: string]: JvmTarget;
        };
    }>;
    private targetsPromise;
    private getTargets;
    activate(proxyPort: number, options: {
        targetPid: string;
    }): Promise<void>;
    deactivate(proxyPort: number | string): Promise<void>;
    deactivateAll(): Promise<void>;
}
export {};
