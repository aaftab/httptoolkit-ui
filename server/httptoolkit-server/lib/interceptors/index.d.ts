import * as _ from 'lodash';
import { HtkConfig } from '../config';
export interface Interceptor {
    id: string;
    version: string;
    getMetadata?(type: 'summary' | 'detailed'): Promise<any>;
    isActivable(): Promise<boolean>;
    activableTimeout?: number;
    isActive(proxyPort: number): Promise<boolean> | boolean;
    activate(proxyPort: number, options?: any): Promise<void | {}>;
    deactivate(proxyPort: number, options?: any): Promise<void | {}>;
    deactivateAll(): Promise<void | {}>;
}
export interface ActivationError extends Error {
    metadata?: any;
    reportable?: boolean;
}
export declare function buildInterceptors(config: HtkConfig): _.Dictionary<Interceptor>;
