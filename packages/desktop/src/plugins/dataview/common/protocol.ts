/** `MetadataApi.request` type answered by the Dataview handler in the index worker. */
export const QUERY_REQUEST = 'dataview.query'

/** Payload of `dataview.query`; the reply is a `QueryResponse` (see engine.ts). */
export interface DataviewQueryRequest {
  /** Content of the ```dataview block. */
  query: string
  /** Absolute path of the note holding the query (for `this` and relative links), or null. */
  originPath: string | null
}
