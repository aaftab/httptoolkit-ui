export declare const getShellScript: (callbackUrl: string, env: {
    [name: string]: string;
}) => string;
export declare const editShellStartupScripts: () => Promise<void>;
export declare const resetShellStartupScripts: () => Promise<(void | undefined)[]>;
