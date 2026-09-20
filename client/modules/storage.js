/*
 * Where the panel keeps your settings and presets, and why there are two copies.
 *
 * The panel's own store is the browser localStorage that CEP gives every
 * extension. It is fast and simple, and it has one dangerous property: CEP
 * names the store after the extension id AND the host application's version,
 * so `ILST_30.8.1_com.keerthi.guidecomposer`. Update Illustrator and the panel
 * is handed a brand-new empty store. Nothing is deleted; the presets are
 * simply somewhere the panel will never look again — and Illustrator updates
 * every few weeks.
 *
 * So presets (not settings, which cost seconds to redo) are mirrored to a file
 * in the user's data folder, which no Illustrator update touches, and restored
 * when the panel opens to find its store empty. See docs/UPDATING.md.
 *
 * Everything here is best-effort. A store can fail (private mode, a full or
 * blocked disk) and a backup that throws is worse than no backup, so failures
 * are reported to the caller rather than raised.
 */
(function (root) {
    "use strict";

    const { STORAGE_PRESETS, STORAGE_UI, PRESET_FILE_FORMAT, PRESET_FILE_VERSION, PANEL_VERSION, MAX_IMPORT_PRESETS } = root.constants;

    /*
     * The two things this module needs from the controller and cannot sensibly
     * own: how to speak to the user, and how to normalise a stored settings
     * object. Handed over once at startup rather than reached for as globals,
     * so the dependency is visible in one place and the module can be reasoned
     * about on its own.
     */
    let say = () => {};
    let plural = (count, one, many) => count + " " + (count === 1 ? one : many);
    let settingsFromStored = (raw) => raw;

    function configureStorage(hooks) {
        say = hooks.say || say;
        plural = hooks.plural || plural;
        settingsFromStored = hooks.settingsFromStored || settingsFromStored;
    }

    function loadPresets() {
        const list = storage.get(STORAGE_PRESETS);
        if (!Array.isArray(list)) {
            return [];
        }
        return list.filter((p) => p && typeof p.name === "string" && p.name && p.settings && typeof p.settings === "object");
    }



    const storage = {
        get(key) {
            try {
                const raw = window.localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },
        set(key, value) {
            try {
                window.localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        },
        updateUi(changes) {
            const ui = this.get(STORAGE_UI) || {};
            Object.assign(ui, changes);
            return this.set(STORAGE_UI, ui);
        }
    };

    /*
     * Every write can fail (private mode, a full or blocked store). Silently
     * losing presets or settings is worse than saying so, but a failing store
     * fails on every keystroke, so the panel reports it once per streak.
     */
    let storageFailed = false;

    // `quiet` is for the writes that happen on every keystroke: they report the
    // first failure of a streak, not one message per stroke.
    function storageWrite(key, value, what, quiet) {
        if (storage.set(key, value)) {
            storageFailed = false;
            return true;
        }
        if (!quiet || !storageFailed) {
            say("Couldn't save " + what + ". Panel storage is unavailable, so it will be lost when the panel closes.", "error");
        }
        storageFailed = true;
        return false;
    }

    /*
     * A copy of the presets kept outside the panel's own storage.
     *
     * CEP names each extension's storage area after the extension id AND the
     * host application's version: `ILST_30.8.1_<id>`. Updating Illustrator —
     * which happens every few weeks — produces a new, empty one, and presets a
     * user spent months building are simply not there any more. Nothing warns
     * them, and nothing in the panel could detect it from storage alone.
     * Adobe's own bundled extension leaves one such folder behind per
     * Illustrator version, which is how this was found.
     *
     * So presets are mirrored to a file under the user's data folder, which no
     * Illustrator update touches, and restored when the panel starts up to find
     * its storage empty. Best-effort throughout: this is a safety net, and a
     * safety net that throws is worse than no safety net.
     */
    const VAULT_FOLDER = "GuideComposer";
    const VAULT_FILE = "presets-backup.json";

    function vaultPaths() {
        try {
            if (typeof CSInterface !== "function" || !(window.cep && window.cep.fs)) {
                return null;
            }
            const base = new CSInterface().getSystemPath(SystemPath.USER_DATA);
            if (!base) {
                return null;
            }
            const separator = base.indexOf("\\") !== -1 ? "\\" : "/";
            const dir = base + separator + VAULT_FOLDER;
            return { dir: dir, file: dir + separator + VAULT_FILE };
        } catch (e) {
            return null;
        }
    }

    function vaultSave(presets) {
        const paths = vaultPaths();
        if (!paths) {
            return false;
        }
        try {
            const fs = window.cep.fs;
            // makedir reports an error when the folder is already there, which
            // is the normal case; the write that follows is the real test.
            if (fs.makedir) {
                fs.makedir(paths.dir);
            }
            return !fs.writeFile(paths.file, JSON.stringify({
                format: PRESET_FILE_FORMAT,
                version: PRESET_FILE_VERSION,
                savedBy: PANEL_VERSION,
                presets: presets.map((preset) => ({ name: preset.name, settings: preset.settings }))
            })).err;
        } catch (e) {
            return false;
        }
    }

    function vaultLoad() {
        const paths = vaultPaths();
        if (!paths) {
            return [];
        }
        try {
            const read = window.cep.fs.readFile(paths.file);
            if (read.err || typeof read.data !== "string") {
                return [];
            }
            const data = JSON.parse(read.data);
            if (!data || data.format !== PRESET_FILE_FORMAT || !Array.isArray(data.presets)) {
                return [];
            }
            return data.presets
                .filter((preset) => preset && typeof preset.name === "string" && preset.name &&
                    preset.settings && typeof preset.settings === "object")
                .slice(0, MAX_IMPORT_PRESETS);
        } catch (e) {
            return [];
        }
    }

    // Every preset write goes through here, so the backup can never fall behind
    // the storage it exists to outlive.
    function writePresets(presets, what) {
        if (!storageWrite(STORAGE_PRESETS, presets, what)) {
            return false;
        }
        vaultSave(presets);
        return true;
    }

    /*
     * Runs once at startup. Storage that is empty while a backup exists was
     * almost certainly orphaned by an Illustrator update, not emptied by the
     * user: deleting the last preset rewrites the backup as empty too.
     */
    function restorePresetsIfOrphaned() {
        if (loadPresets().length) {
            return 0;
        }
        const saved = vaultLoad();
        if (!saved.length) {
            return 0;
        }
        const presets = saved.map((preset) => ({
            name: preset.name,
            settings: settingsFromStored(preset.settings),
            savedAt: new Date().toISOString()
        }));
        presets.sort((a, b) => a.name.localeCompare(b.name));
        return storageWrite(STORAGE_PRESETS, presets, "the restored presets", true) ? presets.length : 0;
    }

    function storageWriteUi(changes) {
        const ok = storage.updateUi(changes);
        if (!ok && !storageFailed) {
            storageFailed = true;
            say("Couldn't save how the panel is set up. Panel storage is unavailable.", "error");
        } else if (ok) {
            storageFailed = false;
        }
        return ok;
    }

    Object.assign(root, {
        configureStorage, storage, storageWrite, storageWriteUi,
        loadPresets, vaultSave, vaultLoad, writePresets, restorePresetsIfOrphaned
    });
}(window.MullionUI = window.MullionUI || {}));
