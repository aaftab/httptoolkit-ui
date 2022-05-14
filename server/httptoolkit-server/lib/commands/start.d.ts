import { Command, flags } from '@oclif/command';
declare class HttpToolkitServer extends Command {
    static description: string;
    static flags: {
        version: import("@oclif/parser/lib/flags").IBooleanFlag<void>;
        help: import("@oclif/parser/lib/flags").IBooleanFlag<void>;
        config: flags.IOptionFlag<string | undefined>;
        token: flags.IOptionFlag<string | undefined>;
    };
    run(): Promise<void>;
    cleanupOldServers(): Promise<void>;
}
export = HttpToolkitServer;
