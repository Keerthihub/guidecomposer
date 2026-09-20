/*
 * Serialises calls to the host application.
 *
 * ExtendScript runs one script at a time, so the panel must never have two
 * calls in flight. This queue holds them in a line and sends the next only
 * when the last has answered.
 *
 * Two behaviours are worth knowing about:
 *
 *  - **Coalescing.** A call marked `coalesce` replaces a pending call of the
 *    same method, so holding down + on a number produces one preview at the
 *    end rather than thirty in a row. Replaced calls resolve with SUPERSEDED,
 *    which callers treat as "a newer answer is coming", not as an error.
 *  - **Stalling.** A call that has not answered within the timeout is
 *    abandoned so the panel stays usable, but the host is still running it.
 *    Anything that would change the document waits until it finally answers,
 *    rather than doing the same work twice.
 */
(function (root) {
    "use strict";

    const { HOST_TIMEOUT_MS, MUTATING_METHODS, SUPERSEDED } = root.constants;


    /*
     * Runs host calls one at a time. Calls marked coalesce replace a pending
     * call of the same method, so a burst of preview requests collapses to the
     * latest settings. Replaced and dropped calls resolve with SUPERSEDED.
     */
    /*
     * `appName` is passed in rather than read from a global: the queue writes
     * messages naming the host application ("Illustrator didn't respond..."),
     * and which application that is, is the controller's business to know.
     */
    function createQueue(bridge, onBusyChange, onStalledChange, appName) {
        const jobs = [];
        let active = null;
        let timeoutMs = HOST_TIMEOUT_MS;
        // A call the panel gave up on, while the host is still running it.
        let stalled = null; // { method }
        const background = { preview: true, status: true, clearPreview: true, setGridLayer: true, textMetrics: true, selectionGeometry: true };

        function isBusy() {
            return Boolean(stalled || (active && !background[active.method]) || jobs.some((j) => !background[j.method]));
        }

        function pump() {
            onBusyChange(isBusy());
            if (active || jobs.length === 0) {
                return;
            }
            const job = jobs.shift();
            active = job;
            onBusyChange(isBusy());
            let timer = null;
            const timeout = new Promise((resolve) => {
                timer = window.setTimeout(() => resolve({
                    ok: false,
                    timedOut: true,
                    error: {
                        code: "TIMEOUT",
                        message: appName() + " didn't respond to " + job.method + ". If a dialog is open there, close it. " +
                            "The panel waits for that request to finish before changing the document again.",
                        fields: []
                    }
                }), timeoutMs);
            });
            const call = bridge.call(job.method, job.payload)
                .catch((err) => ({ ok: false, error: { code: "PANEL_ERROR", message: String((err && err.message) || err), fields: [] } }));
            Promise.race([call, timeout]).then((result) => {
                window.clearTimeout(timer);
                active = null;
                if (result.timedOut) {
                    /*
                     * The host is still executing this call. Re-enabling the
                     * buttons here would let a second Generate run while the
                     * first is still drawing, which with "Add to existing
                     * grids" silently doubles the grid. Hold every mutating
                     * call until the host answers.
                     */
                    stalled = { method: job.method };
                    onStalledChange(stalled);
                    call.then(() => {
                        stalled = null;
                        onStalledChange(null);
                        pump();
                    });
                }
                job.resolve(result);
                pump();
            });
        }

        return {
            enqueue(method, payload, options) {
                return new Promise((resolve) => {
                    if (stalled && MUTATING_METHODS[method]) {
                        resolve({
                            ok: false,
                            error: {
                                code: "HOST_BUSY",
                                message: appName() + " is still working on the last request. The panel waits for it to finish so the grid isn't drawn twice.",
                                fields: []
                            }
                        });
                        return;
                    }
                    if (options && options.coalesce) {
                        const pending = jobs.find((j) => j.method === method);
                        if (pending) {
                            const replaced = pending.resolve;
                            pending.payload = payload;
                            pending.resolve = resolve;
                            replaced(SUPERSEDED);
                            return;
                        }
                    }
                    jobs.push({ method, payload, resolve });
                    pump();
                });
            },
            drop(method) {
                for (let i = jobs.length - 1; i >= 0; i--) {
                    if (jobs[i].method === method) {
                        jobs[i].resolve(SUPERSEDED);
                        jobs.splice(i, 1);
                    }
                }
                onBusyChange(isBusy());
            },
            stalled() {
                return stalled;
            },
            // Development hook, so the timed-out path can be exercised in a browser.
            setTimeout(ms) {
                timeoutMs = Number(ms) || HOST_TIMEOUT_MS;
            }
        };
    }

    Object.assign(root, { createQueue });
}(window.MullionUI = window.MullionUI || {}));
