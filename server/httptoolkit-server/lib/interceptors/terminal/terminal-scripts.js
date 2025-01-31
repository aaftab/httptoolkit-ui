"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetShellStartupScripts = exports.editShellStartupScripts = exports.getShellScript = void 0;
const _ = require("lodash");
const fs = require("fs");
const util = require("util");
const os = require("os");
const path = require("path");
const fs_1 = require("../../util/fs");
const error_tracking_1 = require("../../error-tracking");
const terminal_env_overrides_1 = require("./terminal-env-overrides");
// Generate POSIX paths for git-bash on Windows (or use the normal path everywhere else)
const POSIX_OVERRIDE_BIN_PATH = process.platform === 'win32'
    ? terminal_env_overrides_1.OVERRIDE_BIN_PATH.replace(/\\/g, '/').replace(/^(\w+):/, (_all, driveLetter) => `/${driveLetter.toLowerCase()}`)
    : terminal_env_overrides_1.OVERRIDE_BIN_PATH;
const SHELL = (process.env.SHELL || '').split('/').slice(-1)[0];
const appendOrCreateFile = util.promisify(fs.appendFile);
const appendToFirstExisting = async (paths, forceWrite, contents) => {
    for (let path of paths) {
        // Small race here, but end result is ok either way
        if (await (0, fs_1.canAccess)(path)) {
            return appendOrCreateFile(path, contents);
        }
    }
    if (forceWrite) {
        // If force write is set, write the last file anyway
        return appendOrCreateFile(paths.slice(-1)[0], contents);
    }
};
const START_CONFIG_SECTION = '# --httptoolkit--';
const END_CONFIG_SECTION = '# --httptoolkit-end--';
// The shell config required to ensure every spawned shell always has the right
// configuration, even if it has its env vars reset somehow. This also includes
// fixes for winpty with git-bash. By default, winpty will intercept known
// commands to manage them, so our PATH overrides never get run. We avoid that
// with trivial aliases, and then run winpty ourselves inside the overrides.
// Works in bash, zsh, dash, ksh, sh (not fish)
const SH_SHELL_PATH_CONFIG = `
${START_CONFIG_SECTION}
# This section will be reset each time a HTTP Toolkit terminal is opened
if [ -n "$HTTP_TOOLKIT_ACTIVE" ]; then
    # When HTTP Toolkit is active, we inject various overrides into PATH
    export PATH="${POSIX_OVERRIDE_BIN_PATH}:$PATH"

    if command -v winpty >/dev/null 2>&1; then
        # Work around for winpty's hijacking of certain commands
        alias php=php
        alias node=node
    fi
fi
${END_CONFIG_SECTION}`;
const FISH_SHELL_PATH_CONFIG = `
${START_CONFIG_SECTION}
# This section will be reset each time a HTTP Toolkit terminal is opened
if [ -n "$HTTP_TOOLKIT_ACTIVE" ]
    # When HTTP Toolkit is active, we inject various overrides into PATH
    set -x PATH "${POSIX_OVERRIDE_BIN_PATH}" $PATH;

    if command -v winpty >/dev/null 2>&1
        # Work around for winpty's hijacking of certain commands
        alias php=php
        alias node=node
    end
end
${END_CONFIG_SECTION}`;
// A source-able shell script. Should work for everything except fish, sadly.
const getShellScript = (callbackUrl, env) => `${_.map(env, (value, key) => `    export ${key}="${value.replace(/"/g, '\\"')}"`).join('\n')}

    if command -v winpty >/dev/null 2>&1; then
        # Work around for winpty's hijacking of certain commands
        alias php=php
        alias node=node
    fi

    if command -v curl >/dev/null 2>&1; then
        # Let the HTTP Toolkit app know this ran succesfully
        (curl --noproxy '*' -X POST "${callbackUrl}" >/dev/null 2>&1 &) &> /dev/null
    fi

    echo 'HTTP Toolkit interception enabled'
`;
exports.getShellScript = getShellScript;
// Find the relevant user shell config file, add the above line to it, so that
// shells launched with HTTP_TOOLKIT_ACTIVE set use the interception PATH.
const editShellStartupScripts = async () => {
    await (0, exports.resetShellStartupScripts)();
    // The key risk here is that one of these scripts (or some other process) will be
    // overriding PATH itself, so we need to append some PATH reset logic. The main
    // offenders are: nvm config's in .bashrc/.bash_profile, OSX's path_helper and
    // git-bash ignoring the inherited $PATH.
    // .profile is used by Dash, Bash sometimes, and by Sh:
    appendOrCreateFile(path.join(os.homedir(), '.profile'), SH_SHELL_PATH_CONFIG)
        .catch(error_tracking_1.reportError);
    // Bash login shells use some other files by preference, if they exist.
    // Note that on OSX, all shells are login - elsewhere they only are at actual login time.
    appendToFirstExisting([
        path.join(os.homedir(), '.bash_profile'),
        path.join(os.homedir(), '.bash_login')
    ], false, // Do nothing if they don't exist - it falls back to .profile
    SH_SHELL_PATH_CONFIG).catch(error_tracking_1.reportError);
    // Bash non-login shells use .bashrc, if it exists:
    appendToFirstExisting([
        path.join(os.homedir(), '.bashrc')
    ], SHELL === 'bash', // If you use bash, we _always_ want to set this
    SH_SHELL_PATH_CONFIG).catch(error_tracking_1.reportError);
    // Zsh has its own files (both are actually used)
    appendToFirstExisting([
        path.join(os.homedir(), '.zshenv'),
        path.join(os.homedir(), '.zshrc')
    ], SHELL === 'zsh', // If you use zsh, we _always_ write a config file
    SH_SHELL_PATH_CONFIG).catch(error_tracking_1.reportError);
    // Fish always uses the same config file
    appendToFirstExisting([
        path.join(os.homedir(), '.config', 'fish', 'config.fish'),
    ], SHELL === 'fish' || await (0, fs_1.canAccess)(path.join(os.homedir(), '.config', 'fish')), FISH_SHELL_PATH_CONFIG).catch(error_tracking_1.reportError);
};
exports.editShellStartupScripts = editShellStartupScripts;
const removeConfigSectionsFromFile = async (path) => {
    let fileLines;
    try {
        fileLines = (await (0, fs_1.readFile)(path, 'utf8')).split('\n');
    }
    catch (e) {
        // Silently skip any files we can't read
        return;
    }
    // Remove everything between each pair of start/end section markers
    let sectionStart = _.findIndex(fileLines, (l) => l.startsWith(START_CONFIG_SECTION));
    while (sectionStart !== -1) {
        let sectionEnd = _.findIndex(fileLines, (l) => l.startsWith(END_CONFIG_SECTION));
        if (sectionEnd === -1 || sectionEnd <= sectionStart)
            return; // Odd config file state - don't edit it
        fileLines.splice(sectionStart, (sectionEnd - sectionStart) + 1);
        sectionStart = _.findIndex(fileLines, (l) => l.startsWith(START_CONFIG_SECTION));
    }
    // Write & rename to ensure this is atomic, and avoid races here
    // as much as we reasonably can.
    const tempFile = path + Date.now() + '.temp';
    await (0, fs_1.writeFile)(tempFile, fileLines.join('\n'));
    return (0, fs_1.renameFile)(tempFile, path);
};
// Cleanup: strip our extra config line from all config files
// Good to do for tidiness, not strictly necessary (the config does nothing
// unless HTTP_TOOLKIT_ACTIVE is set anyway).
const resetShellStartupScripts = () => {
    // For each possible config file, remove our magic line, if present
    return Promise.all([
        path.join(os.homedir(), '.profile'),
        path.join(os.homedir(), '.bash_profile'),
        path.join(os.homedir(), '.bash_login'),
        path.join(os.homedir(), '.bashrc'),
        path.join(os.homedir(), '.zshenv'),
        path.join(os.homedir(), '.zshrc'),
        path.join(os.homedir(), '.config', 'fish', 'config.fish'),
    ].map((configFile) => removeConfigSectionsFromFile(configFile).catch(error_tracking_1.reportError)));
};
exports.resetShellStartupScripts = resetShellStartupScripts;
//# sourceMappingURL=terminal-scripts.js.map