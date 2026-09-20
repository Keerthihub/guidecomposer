/*
 * Matches the panel to the host application's interface brightness.
 *
 * Illustrator reports its own theme colours, and CEP hands them to the panel.
 * Rather than ship four hand-written colour schemes, the panel derives its
 * palette from the background colour the host reports, so it sits correctly in
 * all four of Illustrator's brightness settings — and in whatever Adobe adds
 * next.
 */
(function (root) {
    "use strict";


    function clampChannel(value) {
        return Math.max(0, Math.min(255, Math.round(value)));
    }

    function rgb(r, g, b) {
        return "rgb(" + clampChannel(r) + ", " + clampChannel(g) + ", " + clampChannel(b) + ")";
    }

    function applyTheme(skin) {
        if (!skin || !skin.panelBackgroundColor || !skin.panelBackgroundColor.color) {
            return;
        }
        const c = skin.panelBackgroundColor.color;
        const shift = (d) => rgb(c.red + d, c.green + d, c.blue + d);
        const luminance = (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255;
        const dark = luminance < 0.5;

        const tokens = dark
            ? {
                "--bg": shift(0),
                "--bg-sunken": shift(-12),
                "--fg": "#ececec",
                "--muted": luminance < 0.25 ? "#a9a9a9" : "#cfcfcf",
                "--rule": "rgba(255, 255, 255, 0.1)",
                "--field": shift(-20),
                "--field-border": shift(22),
                "--field-border-hover": shift(42),
                "--hover": "rgba(255, 255, 255, 0.07)",
                "--pressed": "rgba(255, 255, 255, 0.15)",
                "--accent": luminance < 0.25 ? "#378ef0" : "#5ea2f2",
                "--accent-fg": "#ffffff",
                "--focus": "#6cb2ff",
                "--danger": luminance < 0.25 ? "#ff8a80" : "#ffb3ab",
                "--paper-edge": "rgba(0, 0, 0, 0.45)",
                "--guide": "#22c3e6"
            }
            : {
                "--bg": shift(0),
                "--bg-sunken": shift(-10),
                "--fg": "#1b1b1b",
                "--muted": luminance > 0.85 ? "#5a5a5a" : "#353535",
                "--rule": "rgba(0, 0, 0, 0.12)",
                "--field": luminance > 0.85 ? "#ffffff" : shift(30),
                "--field-border": shift(-48),
                "--field-border-hover": shift(-72),
                "--hover": "rgba(0, 0, 0, 0.05)",
                "--pressed": "rgba(0, 0, 0, 0.12)",
                "--accent": luminance > 0.85 ? "#1473e6" : "#0d5bb8",
                "--accent-fg": "#ffffff",
                "--focus": "#0d66d0",
                "--danger": luminance > 0.85 ? "#c9252d" : "#9e1119",
                "--paper-edge": "rgba(0, 0, 0, 0.3)",
                "--guide": "#0b9ec4"
            };

        const rootStyle = document.documentElement.style;
        Object.keys(tokens).forEach((name) => rootStyle.setProperty(name, tokens[name]));
        if (skin.baseFontFamily) {
            rootStyle.setProperty("--font", '"' + String(skin.baseFontFamily).replace(/"/g, "") + '", system-ui, sans-serif');
        }
        if (skin.baseFontSize) {
            rootStyle.setProperty("--font-size", Math.max(10, Math.min(13, Number(skin.baseFontSize) || 11)) + "px");
        }
        document.documentElement.dataset.theme = dark ? "dark" : "light";
    }

    Object.assign(root, { applyTheme });
}(window.MullionUI = window.MullionUI || {}));
