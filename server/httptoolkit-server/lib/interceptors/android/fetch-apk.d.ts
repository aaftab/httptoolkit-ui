/// <reference types="node" />
import * as stream from 'stream';
import { HtkConfig } from '../../config';
export declare function clearAllApks(config: HtkConfig): Promise<void[]>;
export declare function streamLatestApk(config: HtkConfig): Promise<stream.Readable>;
