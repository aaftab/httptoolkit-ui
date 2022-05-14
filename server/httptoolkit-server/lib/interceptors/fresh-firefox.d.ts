import { HtkConfig } from '../config';
import { BrowserInstance } from '../browsers';
import { MessageServer } from '../message-server';
import { CertCheckServer } from '../cert-check-server';
import { Interceptor } from '.';
export declare const NSS_DIR: string;
export declare class FreshFirefox implements Interceptor {
    private config;
    id: string;
    version: string;
    constructor(config: HtkConfig);
    private readonly firefoxProfilePath;
    isActive(proxyPort: number | string): boolean;
    isActivable(): Promise<boolean>;
    startFirefox(initialServer: MessageServer | CertCheckServer, proxyPort?: number, existingPrefs?: {}): Promise<BrowserInstance>;
    setupFirefoxProfile(): Promise<void>;
    activate(proxyPort: number): Promise<void>;
    deactivate(proxyPort: number | string): Promise<void>;
    deactivateAll(): Promise<void>;
}
