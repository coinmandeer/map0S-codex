import { SourceProbeError, type AdapterIo } from "@mapos/adapter-sdk";

/**
 * Offline stand-ins for the services the source wizard probes.
 *
 * The wizard's whole value is that it works against a service nobody wrote code for, so testing
 * it against a mock of our own would test nothing. What these fixtures preserve is the part that
 * can be tested offline: that a pasted URL is detected, parsed, turned into a manifest and
 * stored, with the adapters doing the reading rather than a fixture pretending to be one. The
 * bytes below are what those services really answer, trimmed.
 */
const WMS_HOSTS = /(?:^|\.)example\.wms$/i;
const ARCGIS_HOSTS = /(?:^|\.)example\.arcgis$/i;

const WMS_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service>
    <Name>WMS</Name>
    <Title>Zkušební mapová služba</Title>
    <Abstract>Testovací WMS pro průvodce Přidat zdroj z URL</Abstract>
    <AccessConstraints>none</AccessConstraints>
  </Service>
  <Capability>
    <Request>
      <GetMap>
        <Format>image/png</Format>
        <Format>image/jpeg</Format>
        <DCPType><HTTP><Get>
          <OnlineResource xlink:href="https://example.wms/service"/>
        </Get></HTTP></DCPType>
      </GetMap>
    </Request>
    <Layer>
      <Title>Zkušební skupina</Title>
      <CRS>EPSG:3857</CRS>
      <CRS>EPSG:4326</CRS>
      <Attribution>
        <Title>Zkušební poskytovatel</Title>
        <OnlineResource xlink:href="https://example.wms/about"/>
      </Attribution>
      <Layer queryable="1">
        <Name>zaplavy</Name>
        <Dimension name="time" units="ISO8601" default="2026-09-01">2026-09-01,2026-09-02</Dimension>
        <Title>Zaplavovaná území</Title>
        <Abstract>Rozsah stoleté vody</Abstract>
        <EX_GeographicBoundingBox>
          <westBoundLongitude>12.0</westBoundLongitude>
          <southBoundLatitude>48.5</southBoundLatitude>
          <eastBoundLongitude>18.9</eastBoundLongitude>
          <northBoundLatitude>51.1</northBoundLatitude>
        </EX_GeographicBoundingBox>
        <Style><LegendURL>
          <OnlineResource xlink:href="https://example.wms/legend.png"/>
        </LegendURL></Style>
      </Layer>
      <Layer>
        <Name>vodni-toky</Name>
        <Dimension name="time" units="ISO8601" default="2026-09-01">2026-08-01/2026-09-02/P1D</Dimension>
        <Title>Vodní toky</Title>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const WMTS_CAPABILITIES = `<Capabilities version="1.0.0"><ServiceIdentification><Title>Test WMTS</Title></ServiceIdentification><Contents>
${["snow", "clouds"].map((id) => `<Layer><Identifier>${id}</Identifier><Title>${id}</Title><Style isDefault="true"><Identifier>default</Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>web</TileMatrixSet></TileMatrixSetLink><ResourceURL resourceType="tile" format="image/png" template="https://example.wmts/tiles/${id}/{TileMatrix}/{TileRow}/{TileCol}.png"/></Layer>`).join("")}
<TileMatrixSet><Identifier>web</Identifier><SupportedCRS>EPSG:3857</SupportedCRS>
${Array.from({ length: 15 }, (_, z) => `<TileMatrix><Identifier>${z}</Identifier><ScaleDenominator>${559082264.0287178 / 2 ** z}</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>${2 ** z}</MatrixWidth><MatrixHeight>${2 ** z}</MatrixHeight></TileMatrix>`).join("")}
</TileMatrixSet></Contents></Capabilities>`;

const ARCGIS_MAPSERVER = {
  currentVersion: 10.91,
  mapName: "Zkušební ArcGIS",
  serviceDescription: "Testovací MapServer",
  copyrightText: "© Zkušební poskytovatel",
  capabilities: "Map,Query",
  singleFusedMapCache: false,
  supportedImageFormatTypes: "PNG32,JPG",
  spatialReference: { wkid: 102100, latestWkid: 3857 },
  layers: [
    { id: 0, name: "Katastr" },
    { id: 1, name: "Parcely" }
  ]
};

/** Offline, an unknown host is an unreachable one, and the error the wizard shows for that is
 *  the error a real unreachable host produces. */
export const fixtureAdapterIo: AdapterIo = {
  async text(url) {
    const target = new URL(url);
    if (target.hostname === "example.wmts") return WMTS_CAPABILITIES;
    if (WMS_HOSTS.test(target.hostname)) return WMS_CAPABILITIES;
    throw new SourceProbeError("Zdroj je v offline režimu nedostupný.", url);
  },
  async json(url) {
    const target = new URL(url);
    if (ARCGIS_HOSTS.test(target.hostname) && /FeatureServer\/0\/query$/.test(target.pathname))
      return {
        objectIdFieldName: "OBJECTID",
        displayFieldName: "name",
        features: [
          {
            attributes: { OBJECTID: 1, name: "ArcGIS místo" },
            geometry: { x: 13.3775, y: 49.7475 }
          },
          {
            attributes: { OBJECTID: 2, name: "ArcGIS trasa" },
            geometry: {
              paths: [
                [
                  [13.36, 49.74],
                  [13.39, 49.75]
                ]
              ]
            }
          }
        ]
      };
    if (ARCGIS_HOSTS.test(target.hostname) && /FeatureServer$/.test(target.pathname))
      return {
        mapName: "Test FeatureServer",
        layers: [{ id: 0, name: "Místa a trasy", geometryType: "esriGeometryPoint" }]
      };
    if (ARCGIS_HOSTS.test(target.hostname)) return ARCGIS_MAPSERVER;
    throw new SourceProbeError("Zdroj je v offline režimu nedostupný.", url);
  }
  // No `head`: nothing offline serves a PMTiles archive, and claiming otherwise would make the
  // adapter parse a fabricated header.
};
