export declare function spawnToResult(command: string, args?: string[], options?: {}, inheritOutput?: boolean): Promise<{
    exitCode?: number;
    stdout: string;
    stderr: string;
}>;
declare type Proc = {
    pid: number;
    command: string;
    bin: string | undefined;
    args: string | undefined;
};
/**
 * Attempts to get a list of pid + command + binary + args for every process running
 * on the machine owned by the current user (not *all* processes!).
 *
 * This is best efforts, due to the lack of guarantees on 'ps'. Notably args may be
 * undefined, if we're unable to work out which part of the command is the command
 * and which is args.
 */
export declare function listRunningProcesses(): Promise<Array<Proc>>;
export declare function waitForExit(pid: number, timeout?: number): Promise<void>;
export declare function windowsClose(pid: number): Promise<void>;
export declare function windowsKill(processMatcher: string): Promise<void>;
export {};
