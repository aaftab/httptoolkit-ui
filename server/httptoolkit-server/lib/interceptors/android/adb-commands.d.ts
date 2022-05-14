/// <reference types="node" />
import * as stream from 'stream';
import * as adb from '@devicefarmer/adbkit';
export declare const ANDROID_TEMP = "/data/local/tmp";
export declare const SYSTEM_CA_PATH = "/system/etc/security/cacerts";
export declare function createAdbClient(): adb.AdbClient;
export declare const getConnectedDevices: (adbClient: adb.AdbClient) => Promise<string[]>;
export declare function stringAsStream(input: string): stream.Readable;
export declare function pushFile(adbClient: adb.AdbClient, deviceId: string, contents: string | stream.Readable, path: string, mode?: number): Promise<unknown>;
export declare function getRootCommand(adbClient: adb.AdbClient, deviceId: string): Promise<string[] | undefined>;
export declare function hasCertInstalled(adbClient: adb.AdbClient, deviceId: string, certHash: string, certFingerprint: string): Promise<boolean>;
export declare function injectSystemCertificate(adbClient: adb.AdbClient, deviceId: string, rootCmd: string[], certificatePath: string): Promise<void>;
export declare function bringToFront(adbClient: adb.AdbClient, deviceId: string, activityName: string): Promise<void>;
