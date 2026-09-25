import { messageForClient, statusForClient } from "../utils/clientError.js";
import { resolveAreaSelection } from "../geo/areaSelection.js";
/** Guide content for the Discover panel. No database, so both servers register it. */

import type { FastifyInstance } from "fastify";
import type { Bbox } from "@mapos/layer-sdk";
import { getGuide } from "../services/guide/index.js";

export function registerGuideRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      bbox?: string;
      lang?: string;
      name?: string;
      wikidata?: string;
      areaId?: string;
      boundaryRevision?: string;
    };
  }>("/discover/guide", async (request, reply) => {
    let selected;
    try {
      selected = await resolveAreaSelection(request.query);
    } catch (error) {
      return reply
        .code(statusForClient(error))
        .send({ message: messageForClient(error, "Oblast není dostupná") });
    }
    const parts = selected?.bbox ?? (request.query.bbox ?? "").split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return reply.code(400).send({ message: "bbox required" });
    }

    const guide = await getGuide({
      bbox: parts as Bbox,
      requireCoordinatesInBbox: Boolean(selected),
      // Two-letter subtag only: Wikivoyage editions are `cs`, not `cs-CZ`.
      lang: (request.query.lang ?? "cs").slice(0, 2).toLowerCase(),
      name: selected?.name ?? request.query.name,
      wikidataId: selected ? undefined : request.query.wikidata
    });

    if (!guide) return reply.code(404).send({ message: "Pro tuhle oblast průvodce není" });
    return reply.header("cache-control", "public, max-age=21600").send(guide);
  });
}
