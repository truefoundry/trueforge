import { fromJson } from "../json.js";
import { RUNTIME } from "../runtime/index.js";

export declare namespace Stream {
    interface Args {
        /**
         * The HTTP response stream to read from.
         */

        stream: ReadableStream;

        /**
         * The event shape to use for parsing the stream data.
         */
        eventShape: JsonEvent | SseEvent;
        /**
         * An abort signal to stop the stream.
         */
        signal?: AbortSignal;
        /**
         * Whether transparent mid-stream reconnection is enabled on resumable
         * SSE endpoints. Defaults to true. Has no effect on non-resumable endpoints.
         */
        reconnectionEnabled?: boolean;
        /**
         * Maximum number of consecutive failed reconnect attempts on resumable SSE
         * endpoints before giving up. The counter resets to zero each time a
         * reconnected stream successfully yields at least one event (i.e. makes
         * progress). Has no effect on non-resumable endpoints.
         */
        maxReconnectionAttempts?: number;
        /**
         * A function that re-issues the HTTP request with the Last-Event-ID header
         * and returns the new response body stream. Required for reconnection to work.
         */

        reconnect?: (lastEventId: string) => Promise<ReadableStream>;
    }

    interface JsonEvent {
        type: "json";
        messageTerminator: string;
    }

    interface SseEvent {
        type: "sse";
        streamTerminator?: string;
        eventDiscriminator?: string;
        resumable?: boolean;
    }
}

export interface ServerSentEvent<T> {
    data: T;
    id?: string;
    retry?: number;
    event?: string;
}

const DATA_PREFIX = "data:";
const EVENT_PREFIX = "event:";
const ID_PREFIX = "id:";
const RETRY_PREFIX = "retry:";

const DEFAULT_MAX_RECONNECTION_ATTEMPTS = 5;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class Stream<T> implements AsyncIterable<T> {
    private stream: ReadableStream;

    private parse: (val: unknown) => Promise<T>;
    /**
     * The prefix to use for each message. For example,
     * for SSE, the prefix is "data: ".
     */
    private prefix: string | undefined;
    private messageTerminator: string;
    private streamTerminator: string | undefined;
    private eventDiscriminator: string | undefined;
    private resumable: boolean;
    private reconnectionEnabled: boolean;
    private maxReconnectionAttempts: number;

    private reconnect: ((lastEventId: string) => Promise<ReadableStream>) | undefined;

    private controller: AbortController = new AbortController();
    private decoder: TextDecoder | undefined;
    private externalSignal: AbortSignal | undefined;
    private onExternalAbort: (() => void) | undefined;

    constructor({
        stream,
        parse,
        eventShape,
        signal,
        reconnectionEnabled,
        maxReconnectionAttempts,
        reconnect,
    }: Stream.Args & { parse: (val: unknown) => Promise<T> }) {
        this.stream = stream;
        this.parse = parse;
        if (eventShape.type === "sse") {
            this.prefix = DATA_PREFIX;
            this.messageTerminator = "\n";
            this.streamTerminator = eventShape.streamTerminator;
            this.eventDiscriminator = eventShape.eventDiscriminator;
            this.resumable = eventShape.resumable ?? false;
        } else {
            this.messageTerminator = eventShape.messageTerminator;
            this.resumable = false;
        }
        this.reconnectionEnabled = reconnectionEnabled ?? true;
        this.maxReconnectionAttempts = maxReconnectionAttempts ?? DEFAULT_MAX_RECONNECTION_ATTEMPTS;
        this.reconnect = reconnect;
        if (signal != null) {
            this.externalSignal = signal;
            this.onExternalAbort = () => this.controller.abort();
            signal.addEventListener("abort", this.onExternalAbort, { once: true });
        }

        // Initialize shared TextDecoder
        if (typeof TextDecoder !== "undefined") {
            this.decoder = new TextDecoder("utf-8");
        }
    }

    private async *iterMessages(): AsyncGenerator<ServerSentEvent<T>, void> {
        if (this.eventDiscriminator != null) {
            yield* this.iterSseEvents();
        } else {
            yield* this.iterDataMessages();
        }
    }

    private async *iterDataMessages(): AsyncGenerator<ServerSentEvent<T>, void> {
        let reconnectAttempts = 0;
        let currentStream = this.stream;
        let lastId: string | undefined;
        // The id of the most recently *dispatched* event. Per the WHATWG
        // EventSource spec, the "last event ID" is only committed when an event
        // is dispatched, not when the `id:` line is parsed. Reconnecting with a
        // parsed-but-undispatched id would skip an event that was never yielded
        // (e.g. if the connection drops after `id:` but before the event's
        // terminating blank line), so reconnection uses lastDispatchedId.
        let lastDispatchedId: string | undefined;
        let lastRetry: number | undefined;

        while (true) {
            const stream = readableStreamAsyncIterable<any>(currentStream);
            let buf = "";
            let dataValue: string | undefined;

            for await (const chunk of stream) {
                buf += this.decodeChunk(chunk);

                let terminatorIndex: number;
                while ((terminatorIndex = buf.indexOf(this.messageTerminator)) >= 0) {
                    const line = buf.slice(0, terminatorIndex);
                    buf = buf.slice(terminatorIndex + this.messageTerminator.length);

                    if (!line.trim()) {
                        if (this.prefix != null && dataValue != null) {
                            if (this.streamTerminator != null && dataValue.includes(this.streamTerminator)) {
                                return;
                            }
                            const data = await this.parse(fromJson(dataValue));
                            yield { data, id: lastId, retry: lastRetry, event: undefined };
                            lastDispatchedId = lastId;
                            reconnectAttempts = 0;
                            dataValue = undefined;
                        }
                        continue;
                    }

                    if (line.startsWith(ID_PREFIX)) {
                        const idValue = line.slice(ID_PREFIX.length).trim();
                        if (!idValue.includes("\0")) {
                            lastId = idValue;
                        }
                        continue;
                    }
                    if (line.startsWith(RETRY_PREFIX)) {
                        const retryValue = line.slice(RETRY_PREFIX.length).trim();
                        const parsed = parseInt(retryValue, 10);
                        if (!Number.isNaN(parsed) && String(parsed) === retryValue) {
                            lastRetry = parsed;
                        }
                        continue;
                    }

                    if (this.prefix != null) {
                        const prefixIndex = line.indexOf(this.prefix);
                        if (prefixIndex === -1) {
                            continue;
                        }
                        const val = line.slice(prefixIndex + this.prefix.length).trim();
                        dataValue = dataValue != null ? `${dataValue}\n${val}` : val;
                    } else {
                        if (this.streamTerminator != null && line.includes(this.streamTerminator)) {
                            return;
                        }
                        const data = await this.parse(fromJson(line));
                        yield { data, id: lastId, retry: lastRetry, event: undefined };
                        lastDispatchedId = lastId;
                        reconnectAttempts = 0;
                    }
                }
            }

            if (this.prefix != null && dataValue != null) {
                if (this.streamTerminator != null && dataValue.includes(this.streamTerminator)) {
                    return;
                }
                const data = await this.parse(fromJson(dataValue));
                yield { data, id: lastId, retry: lastRetry, event: undefined };
                lastDispatchedId = lastId;
                reconnectAttempts = 0;
            }

            if (!this.shouldReconnect(lastDispatchedId, reconnectAttempts)) {
                return;
            }

            reconnectAttempts++;
            await this.delayReconnect(lastRetry);
            if (this.controller.signal.aborted) {
                return;
            }
            // Re-check after async delay; needed for TypeScript narrowing.
            const reconnectFn = this.reconnect;
            if (reconnectFn == null || lastDispatchedId == null) {
                return;
            }
            try {
                const reconnected = await reconnectFn(lastDispatchedId);
                if (reconnected == null) {
                    currentStream = this.createEmptyStream();
                    continue;
                }
                currentStream = reconnected;
            } catch {
                // Failed reconnect (e.g. HTTP error); assign an empty stream
                // so the next iteration is a safe no-op before shouldReconnect.
                currentStream = this.createEmptyStream();
            }
        }
    }

    private async *iterSseEvents(): AsyncGenerator<ServerSentEvent<T>, void> {
        let reconnectAttempts = 0;
        let currentStream = this.stream;
        let lastId: string | undefined;
        // See iterDataMessages: reconnection uses the last *dispatched* id (per
        // the EventSource spec), not the last *parsed* id, to avoid skipping an
        // event that was never yielded when a drop lands mid-event.
        let lastDispatchedId: string | undefined;
        let lastRetry: number | undefined;

        while (true) {
            const stream = readableStreamAsyncIterable<any>(currentStream);
            let buf = "";
            let eventType: string | undefined;
            let dataValue: string | undefined;

            for await (const chunk of stream) {
                buf += this.decodeChunk(chunk);

                let terminatorIndex: number;
                while ((terminatorIndex = buf.indexOf("\n")) >= 0) {
                    const line = buf.slice(0, terminatorIndex).replace(/\r$/, "");
                    buf = buf.slice(terminatorIndex + 1);

                    if (!line.trim()) {
                        if (dataValue != null) {
                            const data = await this.dispatchSseEvent(dataValue, eventType);
                            if (data == null) {
                                return;
                            }
                            yield { data, id: lastId, retry: lastRetry, event: eventType };
                            lastDispatchedId = lastId;
                            reconnectAttempts = 0;
                        }
                        eventType = undefined;
                        dataValue = undefined;
                        continue;
                    }

                    if (line.startsWith(EVENT_PREFIX)) {
                        eventType = line.slice(EVENT_PREFIX.length).trim();
                    } else if (line.startsWith(DATA_PREFIX)) {
                        const val = line.slice(DATA_PREFIX.length).trim();
                        dataValue = dataValue != null ? `${dataValue}\n${val}` : val;
                    } else if (line.startsWith(ID_PREFIX)) {
                        const idValue = line.slice(ID_PREFIX.length).trim();
                        if (!idValue.includes("\0")) {
                            lastId = idValue;
                        }
                    } else if (line.startsWith(RETRY_PREFIX)) {
                        const retryValue = line.slice(RETRY_PREFIX.length).trim();
                        const parsed = parseInt(retryValue, 10);
                        if (!Number.isNaN(parsed) && String(parsed) === retryValue) {
                            lastRetry = parsed;
                        }
                    }
                }
            }

            if (dataValue != null) {
                const data = await this.dispatchSseEvent(dataValue, eventType);
                if (data != null) {
                    yield { data, id: lastId, retry: lastRetry, event: eventType };
                    lastDispatchedId = lastId;
                    reconnectAttempts = 0;
                }
            }

            if (!this.shouldReconnect(lastDispatchedId, reconnectAttempts)) {
                return;
            }

            reconnectAttempts++;
            await this.delayReconnect(lastRetry);
            if (this.controller.signal.aborted) {
                return;
            }
            // Re-check after async delay; needed for TypeScript narrowing.
            const reconnectFn = this.reconnect;
            if (reconnectFn == null || lastDispatchedId == null) {
                return;
            }
            try {
                const reconnected = await reconnectFn(lastDispatchedId);
                if (reconnected == null) {
                    currentStream = this.createEmptyStream();
                    continue;
                }
                currentStream = reconnected;
            } catch {
                // Failed reconnect (e.g. HTTP error); assign an empty stream
                // so the next iteration is a safe no-op before shouldReconnect.
                currentStream = this.createEmptyStream();
            }
        }
    }

    /**
     * Parses and returns a single SSE event, or returns null if the event is a stream terminator.
     */
    private async dispatchSseEvent(dataValue: string, eventType: string | undefined): Promise<T | null> {
        if (this.streamTerminator != null && dataValue.includes(this.streamTerminator)) {
            return null;
        }
        return this.parse(this.injectDiscriminator(fromJson(dataValue), eventType));
    }

    /**
     * Determines whether a reconnection attempt should be made.
     */
    private shouldReconnect(lastId: string | undefined, reconnectAttempts: number): boolean {
        if (!this.resumable) {
            return false;
        }
        if (this.streamTerminator == null) {
            // Without a terminator the client cannot distinguish a completed
            // stream from a dropped connection, so reconnection is disabled.
            return false;
        }
        // NOTE: When a terminator IS configured but the server never sends it
        // (e.g. it drops the connection after emitting events every time),
        // maxReconnectionAttempts is a per-consecutive-failure cap — each
        // yielded event resets the counter. This matches EventSource semantics
        // but means such a server can cause unbounded reconnections. Callers
        // concerned about this should impose a wall-clock budget externally.
        if (!this.reconnectionEnabled) {
            return false;
        }
        if (this.reconnect == null) {
            return false;
        }
        if (lastId == null || lastId === "") {
            return false;
        }
        if (reconnectAttempts >= this.maxReconnectionAttempts) {
            return false;
        }
        if (this.controller.signal.aborted) {
            return false;
        }
        return true;
    }

    /**
     * Delays before reconnecting, using a server-sent retry directive if provided
     * (clamped to MAX_RECONNECT_DELAY_MS), otherwise falling back to
     * DEFAULT_RECONNECT_DELAY_MS. The delay is abortable: if the stream's abort
     * signal fires during the wait, the promise resolves immediately.
     */
    private async delayReconnect(lastRetry: number | undefined): Promise<void> {
        const base = lastRetry != null && lastRetry > 0 ? lastRetry : DEFAULT_RECONNECT_DELAY_MS;
        const delay = Math.min(base, MAX_RECONNECT_DELAY_MS);
        const signal = this.controller.signal;
        if (signal.aborted) {
            return;
        }
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, delay);
            const onAbort = (): void => {
                clearTimeout(timer);
                resolve();
            };
            signal.addEventListener("abort", onAbort, { once: true });
        });
    }

    private createEmptyStream(): ReadableStream {
        return new ReadableStream({
            start(controller) {
                controller.close();
            },
        });
    }

    private removeAbortListener(): void {
        if (this.externalSignal != null && this.onExternalAbort != null) {
            this.externalSignal.removeEventListener("abort", this.onExternalAbort);
            this.onExternalAbort = undefined;
        }
    }

    public withMetadata(): AsyncIterable<ServerSentEvent<T>> {
        const self = this;
        return {
            async *[Symbol.asyncIterator]() {
                try {
                    yield* self.iterMessages();
                } finally {
                    self.removeAbortListener();
                }
            },
        };
    }

    private injectDiscriminator(parsed: unknown, eventType: string | undefined): unknown {
        if (this.eventDiscriminator == null || eventType == null) {
            return parsed;
        }
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return parsed;
        }
        const obj = parsed as Record<string, unknown>;
        if (this.eventDiscriminator in obj) {
            return parsed;
        }
        return { [this.eventDiscriminator]: eventType, ...obj };
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
        try {
            for await (const event of this.iterMessages()) {
                yield event.data;
            }
        } finally {
            this.removeAbortListener();
        }
    }

    private decodeChunk(chunk: any): string {
        let decoded = "";
        // If TextDecoder is available, use the streaming decoder instance
        if (this.decoder != null) {
            decoded += this.decoder.decode(chunk, { stream: true });
        }
        // Buffer is present in Node.js environment
        else if (RUNTIME.type === "node" && typeof chunk !== "undefined") {
            decoded += Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        }
        return decoded;
    }
}

/**
 * Browser polyfill for ReadableStream
 */
// biome-ignore lint/suspicious/noExplicitAny: allow explicit any
export function readableStreamAsyncIterable<T>(stream: any): AsyncIterableIterator<T> {
    if (stream[Symbol.asyncIterator]) {
        return stream;
    }

    const reader = stream.getReader();
    return {
        async next() {
            try {
                const result = await reader.read();
                if (result?.done) {
                    reader.releaseLock();
                } // release lock when stream becomes closed
                return result;
            } catch (e) {
                reader.releaseLock(); // release lock when stream becomes errored
                throw e;
            }
        },
        async return() {
            const cancelPromise = reader.cancel();
            reader.releaseLock();
            await cancelPromise;
            return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}
