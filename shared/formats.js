/*
 * Standard artboard sizes for the panel's resize menu.
 * Sizes are portrait (or the format's usual orientation); the panel can swap them.
 * Loaded by the panel; no dependencies.
 */
(function (root, factory) {
    var formats = factory();
    if (typeof module === "object" && module && module.exports) {
        module.exports = formats;
    } else {
        root.MullionFormats = formats;
    }
}(this, function () {
    var POINTS_PER_UNIT = { pt: 1, px: 1, mm: 72 / 25.4, "in": 72 };

    var FORMATS = [
        { group: "Print", id: "a0", name: "A0", width: 841, height: 1189, units: "mm" },
        { group: "Print", id: "a1", name: "A1", width: 594, height: 841, units: "mm" },
        { group: "Print", id: "a2", name: "A2", width: 420, height: 594, units: "mm" },
        { group: "Print", id: "a3", name: "A3", width: 297, height: 420, units: "mm" },
        { group: "Print", id: "a4", name: "A4", width: 210, height: 297, units: "mm" },
        { group: "Print", id: "a5", name: "A5", width: 148, height: 210, units: "mm" },
        { group: "Print", id: "a6", name: "A6", width: 105, height: 148, units: "mm" },
        { group: "Print", id: "b5", name: "B5", width: 176, height: 250, units: "mm" },
        { group: "Print", id: "letter", name: "US Letter", width: 8.5, height: 11, units: "in" },
        { group: "Print", id: "legal", name: "US Legal", width: 8.5, height: 14, units: "in" },
        { group: "Print", id: "tabloid", name: "Tabloid", width: 11, height: 17, units: "in" },
        { group: "Print", id: "half-letter", name: "Half Letter", width: 5.5, height: 8.5, units: "in" },
        { group: "Print", id: "poster-18x24", name: "Poster 18 × 24", width: 18, height: 24, units: "in" },
        { group: "Print", id: "poster-24x36", name: "Poster 24 × 36", width: 24, height: 36, units: "in" },
        { group: "Print", id: "postcard", name: "Postcard", width: 6, height: 4, units: "in" },
        { group: "Print", id: "card-us", name: "Business card (US)", width: 3.5, height: 2, units: "in" },
        { group: "Print", id: "card-eu", name: "Business card (EU)", width: 85, height: 55, units: "mm" },
        { group: "Screen", id: "desktop", name: "Desktop", width: 1920, height: 1080, units: "px" },
        { group: "Screen", id: "web", name: "Web page", width: 1440, height: 1024, units: "px" },
        { group: "Screen", id: "laptop", name: "Laptop", width: 1280, height: 800, units: "px" },
        { group: "Screen", id: "tablet", name: "Tablet", width: 834, height: 1194, units: "px" },
        { group: "Screen", id: "phone", name: "Phone", width: 390, height: 844, units: "px" },
        { group: "Social", id: "square-post", name: "Square post", width: 1080, height: 1080, units: "px" },
        { group: "Social", id: "portrait-post", name: "Portrait post 4:5", width: 1080, height: 1350, units: "px" },
        { group: "Social", id: "story", name: "Story 9:16", width: 1080, height: 1920, units: "px" },
        { group: "Social", id: "link-preview", name: "Link preview", width: 1200, height: 628, units: "px" },
        { group: "Social", id: "video-thumbnail", name: "Video thumbnail", width: 1280, height: 720, units: "px" },
        { group: "Social", id: "profile-banner", name: "Profile banner", width: 1584, height: 396, units: "px" },
        { group: "Social", id: "header", name: "Wide header 3:1", width: 1500, height: 500, units: "px" }
    ];

    function find(id) {
        for (var i = 0; i < FORMATS.length; i++) {
            if (FORMATS[i].id === id) {
                return FORMATS[i];
            }
        }
        return null;
    }

    function toPoints(format) {
        return { width: format.width * POINTS_PER_UNIT[format.units], height: format.height * POINTS_PER_UNIT[format.units] };
    }

    function label(format, swapped) {
        var w = swapped ? format.height : format.width;
        var h = swapped ? format.width : format.height;
        return format.name + " (" + w + " × " + h + " " + format.units + ")";
    }

    return { GROUPS: ["Print", "Screen", "Social"], FORMATS: FORMATS, find: find, toPoints: toPoints, label: label };
}));
