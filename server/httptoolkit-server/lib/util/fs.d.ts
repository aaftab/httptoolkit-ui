/// <reference types="node" />
import * as fs from 'fs';
import * as tmp from 'tmp';
import * as rimraf from 'rimraf';
export declare const statFile: typeof fs.stat.__promisify__;
export declare const readFile: typeof fs.readFile.__promisify__;
export declare const readDir: typeof fs.readdir.__promisify__;
export declare const deleteFile: typeof fs.unlink.__promisify__;
export declare const checkAccess: typeof fs.access.__promisify__;
export declare const chmod: typeof fs.chmod.__promisify__;
export declare const mkDir: typeof fs.mkdir.__promisify__;
export declare const writeFile: typeof fs.writeFile.__promisify__;
export declare const renameFile: typeof fs.rename.__promisify__;
export declare const copyFile: typeof fs.copyFile.__promisify__;
export declare const canAccess: (path: string) => Promise<boolean>;
export declare const deleteFolder: typeof rimraf.__promisify__;
export declare const ensureDirectoryExists: (path: string) => Promise<string | void | undefined>;
export declare const commandExists: (path: string) => Promise<boolean>;
export declare const createTmp: (options?: tmp.Options) => Promise<{
    path: string;
    fd: number;
    cleanupCallback: () => void;
}>;
export declare const moveFile: (oldPath: string, newPath: string) => Promise<void>;
