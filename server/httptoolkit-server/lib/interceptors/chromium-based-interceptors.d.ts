import { HtkConfig } from '../config';
import { Browser } from '../browsers';
import { Interceptor } from '.';
declare abstract class FreshChromiumBasedInterceptor implements Interceptor {
    private config;
    private variantName;
    readonly abstract id: string;
    readonly abstract version: string;
    private readonly activeBrowsers;
    constructor(config: HtkConfig, variantName: string);
    isActive(proxyPort: number | string): boolean;
    isActivable(): Promise<boolean>;
    activate(proxyPort: number): Promise<void>;
    deactivate(proxyPort: number | string): Promise<void>;
    deactivateAll(): Promise<void>;
}
declare abstract class ExistingChromiumBasedInterceptor implements Interceptor {
    private config;
    private variantName;
    readonly abstract id: string;
    readonly abstract version: string;
    private activeBrowser;
    constructor(config: HtkConfig, variantName: string);
    browserDetails(): Promise<Browser | undefined>;
    isActive(proxyPort: number | string): boolean;
    isActivable(): Promise<boolean>;
    findExistingPid(): Promise<number | undefined>;
    activate(proxyPort: number, options?: {
        closeConfirmed: boolean;
    }): Promise<void>;
    deactivate(proxyPort: number | string): Promise<void>;
    deactivateAll(): Promise<void>;
}
export declare class FreshChrome extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class ExistingChrome extends ExistingChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshChromeBeta extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshChromeDev extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshChromeCanary extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshChromium extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshChromiumDev extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshEdge extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshEdgeBeta extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshEdgeDev extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshEdgeCanary extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshBrave extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export declare class FreshOpera extends FreshChromiumBasedInterceptor {
    id: string;
    version: string;
    constructor(config: HtkConfig);
}
export {};
