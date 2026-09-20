/*
 * Which settings are visible, and where an error about one of them appears.
 *
 * Two jobs that turn out to be the same job. A grid type only uses some of the
 * settings — a pattern has no columns, a baseline grid has no gutters — so the
 * panel hides the rest rather than greying out a wall of controls. And when the
 * engine rejects a setting, the message belongs beside the field that caused
 * it, which means knowing which fields are on screen at all.
 *
 * The grid engine reports problems as structured errors naming the settings at
 * fault. This module decides where each one is shown: beside a single field,
 * beside a pair when the message is about both (left and right margins
 * together, for instance), or on the status line when it belongs to no field
 * in particular.
 *
 * The rule throughout is that an error should appear where the fix is.
 */
(function (root) {
    "use strict";

    const { ERROR_FIELD_GROUPS, PATTERN_SIZE_LABELS, BOX_TYPES } = root.constants;

    /*
     * Reaching a field, moving focus out of one that is about to be hidden, and
     * speaking to the status line all belong to the controller, which owns the
     * DOM. Handed over once at startup so this module stays about *where* an
     * error is shown rather than about how the panel is wired.
     */
    let field = () => null;
    let rescueFocus = () => {};
    let say = () => {};
    let els = {};
    let panelMode = () => "grid";

    function configureFields(hooks) {
        field = hooks.field || field;
        rescueFocus = hooks.rescueFocus || rescueFocus;
        say = hooks.say || say;
        els = hooks.els || els;
        // A function, not a value: the mode changes while the panel is open.
        panelMode = hooks.panelMode || panelMode;
    }



    function showErrors(errors) {
        document.querySelectorAll("[data-error-for]").forEach((node) => {
            if (node.id !== "err-range") {
                node.textContent = "";
            }
        });
        els.panel.querySelectorAll("[aria-invalid]").forEach((node) => {
            if (node !== els.targetRange) {
                node.removeAttribute("aria-invalid");
            }
        });

        const general = [];
        const inline = [];
        errors.forEach((error) => {
            const names = ERROR_FIELD_GROUPS[error.field] || [error.field];
            let shown = false;
            document.querySelectorAll("[data-error-for]").forEach((node) => {
                const scope = node.closest("[data-mode]");
                if (node.id === "err-range" || node.hidden || node.closest("[hidden]") ||
                    (scope && scope.dataset.mode.split(" ").indexOf(panelMode()) === -1)) {
                    return;
                }
                const targets = node.dataset.errorFor.split(" ");
                if (targets.indexOf(error.field) !== -1 && node.textContent.indexOf(error.message) === -1) {
                    node.textContent = node.textContent ? node.textContent + " " + error.message : error.message;
                    shown = true;
                }
            });
            names.forEach((name) => {
                const input = field(name);
                if (input && input.setAttribute) {
                    input.setAttribute("aria-invalid", "true");
                }
            });
            if (!shown) {
                general.push(error.message);
            } else {
                inline.push(error.message);
            }
        });
        /*
         * Inline errors sit next to their field and are never announced. The
         * status line (a live region) carries the first message; the rest go to
         * a second live region so a screen reader hears all of them once.
         */
        els.fieldErrors.textContent = general.length ? inline.join(" ") : inline.slice(1).join(" ");
        return general;
    }

    const VISIBILITY_SELECTOR = "[data-for], [data-for-output], [data-hide-for-output], [data-for-spiral], [data-for-pattern], [data-hide-for-pattern], [data-when], [data-when-equals], [data-baseline-fields]";

    // Shows each conditional element only when every condition on it holds.
    function syncVisibility(settings) {
        const isPattern = settings.type === "pattern";
        const listed = (value, item) => value.split(" ").indexOf(item) !== -1;
        document.querySelectorAll(VISIBILITY_SELECTOR).forEach((node) => {
            const d = node.dataset;
            let visible = true;
            if (d.for !== undefined) {
                visible = visible && listed(d.for, settings.type);
            }
            if (d.forOutput !== undefined) {
                visible = visible && d.forOutput === settings.output;
            }
            if (d.hideForOutput !== undefined) {
                visible = visible && d.hideForOutput !== settings.output;
            }
            if (d.forSpiral !== undefined) {
                visible = visible && settings.compSpiral === true;
            }
            if (d.forPattern !== undefined) {
                visible = visible && isPattern && listed(d.forPattern, settings.pattern);
            }
            if (d.hideForPattern !== undefined) {
                visible = visible && !(isPattern && listed(d.hideForPattern, settings.pattern));
            }
            if (d.when !== undefined) {
                visible = visible && settings[d.when] === true;
            }
            if (d.whenEquals !== undefined) {
                const [key, expected] = d.whenEquals.split("=");
                visible = visible && String(settings[key]) === expected;
            }
            if (d.baselineFields !== undefined) {
                visible = visible && (settings.type === "baseline" || ((settings.type === "columns" || settings.type === "modular") && settings.addBaseline === true));
            }
            if (!visible && !node.hidden) {
                rescueFocus(node);
            }
            node.hidden = !visible;
        });
        els.patternSizeLabel.textContent = PATTERN_SIZE_LABELS[settings.pattern] || "Size";
    }

    // Moves the output off a choice the current grid can't use, and says so.
    function ensureOutputAllowed() {
        const type = field("type").value;
        const output = field("output").value;
        if (output === "boxes" && !BOX_TYPES[type]) {
            field("output").value = "lines";
            say("Switched output to lines. Boxes work with column and modular grids.");
        } else if (output === "guides" && type === "pattern" && field("pattern").value === "dots") {
            field("output").value = "lines";
            say("Switched output to lines. Dot grids draw filled dots, which can't be guides.");
        }
    }

    Object.assign(root, { configureFields, showErrors, syncVisibility, ensureOutputAllowed });
}(window.MullionUI = window.MullionUI || {}));
