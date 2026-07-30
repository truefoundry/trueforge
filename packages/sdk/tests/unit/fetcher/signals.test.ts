import { anySignal, getTimeoutSignal } from "../../../src/core/fetcher/signals";

describe("Test getTimeoutSignal", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should return an object with signal and abortId", () => {
        const { signal, abortId } = getTimeoutSignal(1000);

        expect(signal).toBeDefined();
        expect(abortId).toBeDefined();
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
    });

    it("should create a signal that aborts after the specified timeout", () => {
        const timeoutMs = 5000;
        const { signal } = getTimeoutSignal(timeoutMs);

        expect(signal.aborted).toBe(false);

        vi.advanceTimersByTime(timeoutMs - 1);
        expect(signal.aborted).toBe(false);

        vi.advanceTimersByTime(1);
        expect(signal.aborted).toBe(true);
    });
});

describe("Test anySignal", () => {
    it("should return an AbortSignal", () => {
        const signal = anySignal(new AbortController().signal);
        expect(signal).toBeInstanceOf(AbortSignal);
    });

    it("should abort when any of the input signals is aborted", () => {
        const controller1 = new AbortController();
        const controller2 = new AbortController();
        const signal = anySignal(controller1.signal, controller2.signal);

        expect(signal.aborted).toBe(false);
        controller1.abort();
        expect(signal.aborted).toBe(true);
    });

    it("should handle an array of signals", () => {
        const controller1 = new AbortController();
        const controller2 = new AbortController();
        const signal = anySignal([controller1.signal, controller2.signal]);

        expect(signal.aborted).toBe(false);
        controller2.abort();
        expect(signal.aborted).toBe(true);
    });

    it("should abort immediately if one of the input signals is already aborted", () => {
        const controller1 = new AbortController();
        const controller2 = new AbortController();
        controller1.abort();

        const signal = anySignal(controller1.signal, controller2.signal);
        expect(signal.aborted).toBe(true);
    });

    it("should detect a signal that aborts between the initial aborted check and the event listener registration", () => {
        const ctrlA = new AbortController();
        const ctrlB = new AbortController();

        const originalAddEventListener = ctrlA.signal.addEventListener.bind(ctrlA.signal);
        const originalRemoveEventListener = ctrlA.signal.removeEventListener.bind(ctrlA.signal);

        let abortedAccessCount = 0;
        const proxy = new Proxy(ctrlA.signal, {
            get(target, prop, receiver) {
                if (prop === "aborted") {
                    abortedAccessCount++;
                    if (abortedAccessCount === 1) return false;
                    return Reflect.get(target, prop, receiver);
                }
                if (prop === "addEventListener") {
                    return (...args: Parameters<typeof originalAddEventListener>) => {
                        if (abortedAccessCount >= 1 && args[0] === "abort") {
                            ctrlA.abort("too-late");
                        }
                        return originalAddEventListener(...args);
                    };
                }
                if (prop === "removeEventListener") {
                    return originalRemoveEventListener;
                }
                return Reflect.get(target, prop, receiver);
            },
        });

        const combined = anySignal(proxy, ctrlB.signal);

        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe("too-late");
    });

    it("should forward the abort reason from a source signal", () => {
        const controller = new AbortController();
        const combined = anySignal(controller.signal);

        controller.abort("test-reason");
        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe("test-reason");
    });
});
