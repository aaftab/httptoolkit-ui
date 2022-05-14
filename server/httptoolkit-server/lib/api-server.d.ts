/// <reference types="node" />
import * as events from 'events';
import { MockttpStandalone } from 'mockttp';
import { HtkConfig } from './config';
export declare class HttpToolkitServerApi extends events.EventEmitter {
    private server;
    constructor(config: HtkConfig, mockttpStandalone: MockttpStandalone);
    start(): Promise<void>;
}
