/**
 * Response types the API gzips: `@fastify/compress`'s default list plus vector tiles. MVT is
 * protobuf that gzips to about a third, and neither the plugin's list nor the edge proxy's
 * treats it as compressible. Event streams stay uncompressed so each frame is flushed as it is
 * written.
 */
export const COMPRESSIBLE_TYPES =
  /^text\/(?!event-stream)|(?:\+|\/)json(?:;|$)|(?:\+|\/)text(?:;|$)|(?:\+|\/)xml(?:;|$)|octet-stream(?:;|$)|\/vnd\.mapbox-vector-tile(?:;|$)|\/x-protobuf(?:;|$)/u;
