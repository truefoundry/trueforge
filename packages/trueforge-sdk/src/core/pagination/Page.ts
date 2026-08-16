import type { HttpResponsePromise, RawResponse } from "../fetcher/index.js";

/**
 * A page of results from a paginated API.
 *
 * @template T The type of the items in the page.
 * @template R The type of the API response.
 */
export class Page<T, R = unknown> implements AsyncIterable<T> {
    public data: T[];
    public rawResponse: RawResponse;
    public response: R;

    private _hasNextPage: (response: R) => boolean;
    private getItems: (response: R) => T[];
    private loadNextPage: (response: R) => HttpResponsePromise<R>;

    constructor({
        response,
        rawResponse,
        hasNextPage,
        getItems,
        loadPage,
    }: {
        response: R;
        rawResponse: RawResponse;
        hasNextPage: (response: R) => boolean;
        getItems: (response: R) => T[];
        loadPage: (response: R) => HttpResponsePromise<R>;
    }) {
        this.response = response;
        this.rawResponse = rawResponse;
        this.data = getItems(response);
        this._hasNextPage = hasNextPage;
        this.getItems = getItems;
        this.loadNextPage = loadPage;
    }

    /**
     * Retrieves the next page
     * @returns this
     */
    public async getNextPage(): Promise<this> {
        const { data, rawResponse } = await this.loadNextPage(this.response).withRawResponse();
        this.response = data;
        this.rawResponse = rawResponse;
        this.data = this.getItems(this.response);
        return this;
    }

    /**
     * @returns whether there is a next page to load
     */
    public hasNextPage(): boolean {
        return this._hasNextPage(this.response);
    }

    private async *iterMessages(): AsyncGenerator<T, void> {
        for (const item of this.data) {
            yield item;
        }

        while (this.hasNextPage()) {
            await this.getNextPage();
            for (const item of this.data) {
                yield item;
            }
        }
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
        for await (const message of this.iterMessages()) {
            yield message;
        }
    }
}
