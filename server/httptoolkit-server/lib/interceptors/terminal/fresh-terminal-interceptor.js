"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FreshTerminalInterceptor = void 0;
const _ = require("lodash");
const child_process_1 = require("child_process");
const GSettings = require("node-gsettings-wrapper");
const osx_find_executable_1 = require("@httptoolkit/osx-find-executable");
const error_tracking_1 = require("../../error-tracking");
const error_1 = require("../../util/error");
const fs_1 = require("../../util/fs");
const process_management_1 = require("../../util/process-management");
const terminal_env_overrides_1 = require("./terminal-env-overrides");
const terminal_scripts_1 = require("./terminal-scripts");
const DEFAULT_GIT_BASH_PATH = 'C:/Program Files/git/git-bash.exe';
const getTerminalCommand = _.memoize(async () => {
    let result;
    if (process.platform === 'win32')
        result = getWindowsTerminalCommand();
    else if (process.platform === 'darwin')
        result = getOSXTerminalCommand();
    else if (process.platform === 'linux')
        result = getLinuxTerminalCommand();
    else
        result = Promise.resolve(null);
    result.then((terminal) => {
        if (terminal)
            (0, error_tracking_1.addBreadcrumb)('Found terminal', { data: { terminal } });
        else
            (0, error_tracking_1.reportError)('No terminal could be detected');
    });
    return result;
});
const getWindowsTerminalCommand = async () => {
    if (await (0, fs_1.canAccess)(DEFAULT_GIT_BASH_PATH)) {
        return { command: DEFAULT_GIT_BASH_PATH };
    }
    else if (await (0, fs_1.commandExists)('git-bash')) {
        return { command: 'git-bash' };
    }
    return { command: 'start', args: ['cmd'], options: { shell: true }, skipStartupScripts: true };
};
const getOSXTerminalCommand = async () => {
    const terminalExecutables = (await Promise.all([
        'co.zeit.hyper',
        'com.googlecode.iterm2',
        'com.googlecode.iterm',
        'com.apple.Terminal'
    ].map((bundleId) => (0, osx_find_executable_1.findExecutableById)(bundleId).catch(() => null)))).filter((executablePath) => !!executablePath);
    const bestAvailableTerminal = terminalExecutables[0];
    if (bestAvailableTerminal)
        return { command: bestAvailableTerminal };
    else
        return null;
};
const getLinuxTerminalCommand = async () => {
    // Symlink/wrapper that should indicate the system default
    if (await (0, fs_1.commandExists)('x-terminal-emulator'))
        return getXTerminalCommand();
    // Check gnome app settings, if available
    if (GSettings.isAvailable()) {
        const gSettingsTerminalKey = GSettings.Key.findById('org.gnome.desktop.default-applications.terminal', 'exec');
        const defaultTerminal = gSettingsTerminalKey && gSettingsTerminalKey.getValue();
        if (defaultTerminal && await (0, fs_1.commandExists)(defaultTerminal)) {
            if (defaultTerminal.includes('gnome-terminal'))
                return getGnomeTerminalCommand(defaultTerminal);
            if (defaultTerminal.includes('konsole'))
                return getKonsoleTerminalCommand(defaultTerminal);
            if (defaultTerminal.includes('xfce4-terminal'))
                return getXfceTerminalCommand(defaultTerminal);
            if (defaultTerminal.includes('x-terminal-emulator'))
                return getXTerminalCommand(defaultTerminal);
            if (defaultTerminal.includes('terminator'))
                return { command: 'terminator', args: ['-u'] };
            return { command: defaultTerminal };
        }
    }
    // If a specific term like this is installed, it's probably the preferred one
    if (await (0, fs_1.commandExists)('konsole'))
        return getKonsoleTerminalCommand();
    if (await (0, fs_1.commandExists)('xfce4-terminal'))
        return getXfceTerminalCommand();
    if (await (0, fs_1.commandExists)('kitty'))
        return { command: 'kitty' };
    if (await (0, fs_1.commandExists)('urxvt'))
        return { command: 'urxvt' };
    if (await (0, fs_1.commandExists)('rxvt'))
        return { command: 'rxvt' };
    if (await (0, fs_1.commandExists)('termit'))
        return { command: 'termit' };
    if (await (0, fs_1.commandExists)('terminator'))
        return { command: 'terminator', args: ['-u'] };
    if (await (0, fs_1.commandExists)('alacritty'))
        return { command: 'alacritty' };
    if (await (0, fs_1.commandExists)('uxterm'))
        return { command: 'uxterm' };
    if (await (0, fs_1.commandExists)('xterm'))
        return { command: 'xterm' };
    return null;
};
const getXTerminalCommand = async (command = 'x-terminal-emulator') => {
    var _a;
    // x-terminal-emulator is a wrapper/symlink to the terminal of choice.
    // Unfortunately, we need to pass specific args that aren't supported by all terminals (to ensure
    // terminals run in the foreground), and the Debian XTE wrapper at least doesn't pass through
    // any of the args we want to use. To fix this, we parse --help to try and detect the underlying
    // terminal, and run it directly with the args we need.
    try {
        // Run the command with -h to get some output we can use to infer the terminal itself.
        // --version would be nice, but the debian wrapper ignores it. --help isn't supported by xterm.
        const { stdout } = await (0, process_management_1.spawnToResult)(command, ['-h']);
        const helpOutput = stdout.toLowerCase().replace(/[^\w\d]+/g, ' ');
        if (helpOutput.includes('gnome terminal') && await (0, fs_1.commandExists)('gnome-terminal')) {
            return getGnomeTerminalCommand();
        }
        else if (helpOutput.includes('xfce4 terminal') && await (0, fs_1.commandExists)('xfce4-terminal')) {
            return getXfceTerminalCommand();
        }
        else if (helpOutput.includes('konsole') && await (0, fs_1.commandExists)('konsole')) {
            return getKonsoleTerminalCommand();
        }
    }
    catch (e) {
        if ((0, error_1.isErrorLike)(e) && ((_a = e.message) === null || _a === void 0 ? void 0 : _a.includes('rxvt'))) {
            // Bizarrely, rxvt -h prints help but always returns a non-zero exit code.
            // Doesn't need any special arguments anyway though, so just ignore it
        }
        else {
            (0, error_tracking_1.reportError)(e);
        }
    }
    // If there's an error, or we just don't recognize the console, give up & run it directly
    return { command };
};
const getKonsoleTerminalCommand = async (command = 'konsole') => {
    let extraArgs = [];
    const { stdout } = await (0, process_management_1.spawnToResult)(command, ['--help']);
    // Forces Konsole to run in the foreground, with no separate process
    // Seems to be well supported for a long time, but check just in case
    if (stdout.includes('--nofork')) {
        extraArgs = ['--nofork'];
    }
    return { command, args: extraArgs };
};
const getGnomeTerminalCommand = async (command = 'gnome-terminal') => {
    let extraArgs = [];
    const { stdout } = await (0, process_management_1.spawnToResult)(command, ['--help-all']);
    // Officially supported option, but only supported in v3.28+
    if (stdout.includes('--wait')) {
        extraArgs = ['--wait'];
    }
    else {
        // Debugging option - works back to v3.7 (2012), but not officially supported
        // Documented at https://wiki.gnome.org/Apps/Terminal/Debugging
        const randomId = Math.round((Math.random() * 100000));
        extraArgs = ['--app-id', `com.httptoolkit.${randomId}`];
    }
    // We're assuming here that nobody is developing in a pre-2012 un-updated gnome-terminal.
    // If they are then gnome-terminal is not going to recognize --app-id, and will fail to
    // start. Hard to avoid, rare case, so c'est la vie.
    return { command, args: extraArgs };
};
const getXfceTerminalCommand = async (command = 'xfce4-terminal') => {
    let extraArgs = [];
    const { stdout } = await (0, process_management_1.spawnToResult)(command, ['--help']);
    // Disables the XFCE terminal server for this terminal, so it runs in the foreground.
    // Seems to be well supported for a long time, but check just in case
    if (stdout.includes('--disable-server')) {
        extraArgs = ['--disable-server'];
    }
    return { command, args: extraArgs };
};
const terminals = {};
class FreshTerminalInterceptor {
    constructor(config) {
        this.config = config;
        this.id = 'fresh-terminal';
        this.version = '1.0.0';
    }
    async isActivable() {
        return !!(await getTerminalCommand());
    }
    isActive(proxyPort) {
        return !!(terminals[proxyPort] && terminals[proxyPort].length);
    }
    async activate(proxyPort) {
        const terminalSpawnArgs = await getTerminalCommand();
        if (!terminalSpawnArgs)
            throw new Error('Could not find a suitable terminal');
        const { command, args, options, skipStartupScripts } = terminalSpawnArgs;
        // Our PATH override below may not work, e.g. because OSX's path_helper always prepends
        // the real paths over the top, and git-bash ignore env var paths overrides. To fix this,
        // we (very carefully!) rewrite shell startup scripts, to reset the PATH in our shell.
        // This gets reset on exit, and is behind a flag so it won't affect other shells anyway.
        if (!skipStartupScripts)
            await (0, terminal_scripts_1.editShellStartupScripts)();
        const currentEnv = (process.platform === 'win32')
            // Windows env var behaviour is very odd. Windows env vars are case-insensitive, and node
            // simulates this for process.env accesses, but when used in an object they become
            // case-*sensitive* object keys, and it's easy to end up with duplicates.
            // To fix this, on Windows we enforce here that all env var input keys are uppercase.
            ? _.mapKeys(process.env, (_value, key) => key.toUpperCase())
            : process.env;
        const childProc = (0, child_process_1.spawn)(command, (args || []), _.assign(options || {}, {
            env: Object.assign(Object.assign({}, currentEnv), (0, terminal_env_overrides_1.getTerminalEnvVars)(proxyPort, this.config.https, currentEnv, {})),
            cwd: currentEnv.HOME || currentEnv.USERPROFILE
        }));
        terminals[proxyPort] = (terminals[proxyPort] || []).concat(childProc);
        const onTerminalClosed = () => {
            terminals[proxyPort] = _.reject(terminals[proxyPort], childProc);
            // Delay slightly as some terminals (gnome-terminal) exit immediately,
            // and start the terminal elsewhere, so it may not have started yet.
            setTimeout(() => {
                if (_.every(terminals, ts => _.isEmpty(ts)))
                    (0, terminal_scripts_1.resetShellStartupScripts)();
            }, 500);
        };
        childProc.once('close', onTerminalClosed);
        childProc.once('error', (e) => {
            (0, error_tracking_1.reportError)(e);
            onTerminalClosed();
        });
        // Watch for spawn errors immediately after startup to judge whether the
        // terminal launch was actually successful:
        return new Promise((resolve, reject) => {
            setTimeout(resolve, 500); // If it doesn't crash within 500ms, it's probably good
            childProc.once('error', reject); // If it does crash, it's definitely not.
        });
    }
    async deactivate(proxyPort) {
        if (!this.isActive(proxyPort))
            return;
        await Promise.all((terminals[proxyPort] || []).map((proc) => {
            return new Promise((resolve) => {
                proc.once('close', resolve);
                proc.kill();
            });
        }));
    }
    async deactivateAll() {
        await Promise.all(Object.keys(terminals).map((proxyPort) => this.deactivate(proxyPort)));
        await (0, terminal_scripts_1.resetShellStartupScripts)();
    }
}
exports.FreshTerminalInterceptor = FreshTerminalInterceptor;
//# sourceMappingURL=fresh-terminal-interceptor.js.map