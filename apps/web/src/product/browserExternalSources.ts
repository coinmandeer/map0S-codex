import type { ExternalSourceRights } from "@mapos/layer-sdk";

function source<const T extends ExternalSourceRights>(value: T): T {
  return value;
}

export const OPENSTREETMAP_RIGHTS = source({
  id: "openstreetmap",
  label: "OpenStreetMap",
  hosts: ["www.openstreetmap.org", "*.tile.openstreetmap.org"],
  uses: ["embed", "outbound-link", "tile"],
  attribution: "© OpenStreetMap contributors",
  terms: "ODbL-1.0 and OpenStreetMap tile usage policy",
  evidenceUrl: "https://www.openstreetmap.org/copyright"
});

export const WIKIPEDIA_RIGHTS = source({
  id: "wikipedia",
  label: "Wikipedia",
  hosts: ["*.wikipedia.org"],
  uses: ["api", "outbound-link"],
  attribution: "Wikipedia contributors",
  terms: "CC-BY-SA-4.0 and Wikimedia Terms of Use",
  evidenceUrl: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use"
});

export const WIKIDATA_RIGHTS = source({
  id: "wikidata",
  label: "Wikidata",
  hosts: ["www.wikidata.org"],
  uses: ["api", "outbound-link"],
  attribution: "Wikidata contributors",
  terms: "CC0-1.0 and Wikimedia Terms of Use",
  evidenceUrl: "https://www.wikidata.org/wiki/Wikidata:Licensing"
});

export const OPEN_METEO_RIGHTS = source({
  id: "open-meteo",
  label: "Open-Meteo",
  hosts: ["open-meteo.com", "*.open-meteo.com"],
  uses: ["api", "outbound-link"],
  attribution: "Open-Meteo",
  terms: "CC-BY-4.0 and Open-Meteo Terms",
  evidenceUrl: "https://open-meteo.com/en/terms"
});

export const MACROSTRAT_RIGHTS = source({
  id: "macrostrat",
  label: "Macrostrat",
  hosts: ["macrostrat.org", "*.macrostrat.org"],
  uses: ["api", "tile", "outbound-link"],
  attribution: "Macrostrat",
  terms: "CC-BY-4.0",
  evidenceUrl: "https://macrostrat.org/"
});

export const MAPILLARY_RIGHTS = source({
  id: "mapillary",
  label: "Mapillary",
  hosts: ["www.mapillary.com"],
  uses: ["api", "embed", "media", "outbound-link"],
  attribution: "Mapillary",
  terms: "Mapillary Terms of Use and per-image licence",
  evidenceUrl: "https://www.mapillary.com/terms"
});

export const PANORAMAX_RIGHTS = source({
  id: "panoramax",
  label: "Panoramax",
  hosts: ["api.panoramax.xyz", "panoramax.xyz", "*.panoramax.fr", "panoramax.fr"],
  uses: ["api", "media", "outbound-link"],
  attribution: "Panoramax (CC BY-SA / licence per instance)",
  terms: "Panoramax instance licence, stated per picture",
  evidenceUrl: "https://panoramax.fr/"
});

const NASA_EONET_RIGHTS = source({
  id: "nasa-eonet",
  label: "NASA EONET",
  hosts: ["eonet.gsfc.nasa.gov"],
  uses: ["api", "outbound-link"],
  attribution: "NASA EONET and its underlying event sources",
  terms: "NASA EONET terms; underlying event sources retain their own licences",
  evidenceUrl: "https://eonet.gsfc.nasa.gov/"
});

const OPEN_DATA_HUB_RIGHTS = source({
  id: "open-data-hub",
  label: "Open Data Hub",
  hosts: ["docs.opendatahub.com"],
  uses: ["api", "outbound-link"],
  attribution: "Open Data Hub",
  terms: "Open Data Hub instance licence, stated per record",
  evidenceUrl: "https://docs.opendatahub.com/licensing/"
});

const DIGITRAFFIC_RIGHTS = source({
  id: "digitraffic",
  label: "Fintraffic / digitraffic.fi",
  hosts: ["www.digitraffic.fi"],
  uses: ["api", "outbound-link"],
  attribution: "Fintraffic / digitraffic.fi",
  terms: "CC-BY-4.0",
  evidenceUrl: "https://www.digitraffic.fi/en/terms-of-service/"
});

const BOOKING_RIGHTS = source({
  id: "booking",
  label: "Booking.com",
  hosts: ["www.booking.com"],
  uses: ["outbound-link"],
  attribution: "Booking.com",
  terms: "Booking.com terms of service; the link opens a search, not a booking",
  evidenceUrl: "https://www.booking.com/content/terms.html"
});

const CELESTRAK_RIGHTS = source({
  id: "celestrak",
  label: "CelesTrak",
  hosts: ["celestrak.org"],
  uses: ["api", "outbound-link"],
  attribution: "CelesTrak GP data",
  terms: "CelesTrak GP data is public; positions are computed with SGP4 in the browser",
  evidenceUrl: "https://celestrak.org/NORAD/documentation/gp-data-formats.php"
});

const OVERTURE_RIGHTS = source({
  id: "overture",
  label: "Overture Maps",
  hosts: ["docs.overturemaps.org", "overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com"],
  uses: ["tile", "outbound-link"],
  attribution: "Overture Maps Foundation",
  terms:
    "Overture Maps data is released under ODbL and CDLA-Permissive; per-source attribution applies",
  evidenceUrl: "https://docs.overturemaps.org/attribution/"
});

export const WINDY_RIGHTS = source({
  id: "windy",
  label: "Windy.com",
  hosts: ["embed.windy.com", "api.windy.com"],
  uses: ["embed", "outbound-link"],
  attribution: "Windy.com",
  terms: "Windy API and embed terms",
  evidenceUrl: "https://api.windy.com/"
});

export const FOURSQUARE_RIGHTS = source({
  id: "foursquare",
  label: "Foursquare",
  hosts: ["foursquare.com", "*.foursquare.com"],
  uses: ["api", "outbound-link"],
  attribution: "Foursquare",
  terms: "Foursquare Developer Terms",
  evidenceUrl: "https://foursquare.com/legal/terms"
});

export const GOOGLE_MAPS_RIGHTS = source({
  id: "google-maps",
  label: "Google Maps",
  hosts: [
    "www.google.com",
    "maps.google.com",
    "developers.google.com",
    "maps.googleapis.com",
    "maps.gstatic.com"
  ],
  uses: ["outbound-link", "tile", "api", "media"],
  attribution: "Google Maps",
  terms: "Google Maps terms",
  evidenceUrl: "https://maps.google.com/help/terms_maps/"
});

export const GEOCACHING_RIGHTS = source({
  id: "geocaching",
  label: "Geocaching",
  hosts: ["www.geocaching.com"],
  uses: ["outbound-link"],
  attribution: "Geocaching",
  terms: "Geocaching Terms of Use",
  evidenceUrl: "https://www.geocaching.com/about/termsofuse.aspx"
});

export const KOMOOT_RIGHTS = source({
  id: "komoot",
  label: "Komoot",
  hosts: ["www.komoot.com"],
  uses: ["outbound-link"],
  attribution: "Komoot",
  terms: "Komoot Terms of Service",
  evidenceUrl: "https://www.komoot.com/terms"
});

const CARTO_RIGHTS = source({
  id: "carto",
  label: "CARTO",
  hosts: ["carto.com", "*.carto.com", "basemaps.cartocdn.com", "*.basemaps.cartocdn.com"],
  uses: ["tile", "outbound-link"],
  attribution: "CARTO and OpenStreetMap contributors",
  terms: "CARTO Maps API Terms and ODbL-1.0",
  evidenceUrl: "https://carto.com/attributions"
});

const MAPY_RIGHTS = source({
  id: "mapy",
  label: "Mapy.com",
  hosts: ["mapy.com", "*.mapy.com"],
  uses: ["tile", "media", "outbound-link"],
  attribution: "Mapy.com",
  terms: "Mapy.com API Terms",
  evidenceUrl: "https://developer.mapy.com/terms-and-conditions/"
});

const RAINVIEWER_RIGHTS = source({
  id: "rainviewer",
  label: "RainViewer",
  hosts: ["www.rainviewer.com", "*.rainviewer.com"],
  uses: ["api", "tile", "outbound-link"],
  attribution: "RainViewer",
  terms: "RainViewer API Terms",
  evidenceUrl: "https://www.rainviewer.com/api.html"
});

const PARK4NIGHT_RIGHTS = source({
  id: "park4night",
  label: "Park4Night",
  hosts: ["park4night.com", "*.park4night.com"],
  uses: ["api", "outbound-link"],
  attribution: "Park4Night",
  terms: "Park4Night CGU (no redistribution; reuse requires prior written authorization)",
  evidenceUrl: "https://plus.park4night.com/en/cgu"
});

const OPENFREEMAP_RIGHTS = source({
  id: "openfreemap",
  label: "OpenFreeMap",
  hosts: ["openfreemap.org", "*.openfreemap.org"],
  uses: ["tile", "outbound-link"],
  attribution: "OpenFreeMap and OpenStreetMap contributors",
  terms: "OpenMapTiles and ODbL-1.0",
  evidenceUrl: "https://openfreemap.org/"
});

const EOX_RIGHTS = source({
  id: "eox",
  label: "EOX",
  hosts: ["maps.eox.at", "*.maps.eox.at", "s2maps.eu"],
  uses: ["tile", "outbound-link"],
  attribution: "EOX Sentinel-2 cloudless / Terrain Light",
  terms: "CC-BY-4.0 (Sentinel-2 cloudless) and CC-BY-SA-4.0 (Terrain Light)",
  evidenceUrl: "https://maps.eox.at/"
});

const ESRI_RIGHTS = source({
  id: "esri",
  label: "Esri World Imagery",
  hosts: ["server.arcgisonline.com", "www.esri.com"],
  uses: ["tile", "outbound-link"],
  attribution: "Esri, Maxar and Earthstar Geographics",
  terms: "Esri Master Agreement",
  evidenceUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement"
});

const NASA_GIBS_RIGHTS = source({
  id: "nasa-gibs",
  label: "NASA GIBS / EOSDIS",
  hosts: ["gibs.earthdata.nasa.gov", "earthdata.nasa.gov"],
  uses: ["tile", "outbound-link"],
  attribution: "NASA GIBS / EOSDIS",
  terms: "United States public domain",
  evidenceUrl: "https://earthdata.nasa.gov/"
});

const HERE_RIGHTS = source({
  id: "here",
  label: "HERE",
  hosts: ["legal.here.com"],
  uses: ["outbound-link", "tile"],
  attribution: "HERE",
  terms: "HERE Service Terms",
  evidenceUrl: "https://legal.here.com/terms"
});

const MAPTILER_RIGHTS = source({
  id: "maptiler",
  label: "MapTiler",
  hosts: ["www.maptiler.com", "api.maptiler.com"],
  uses: ["outbound-link", "tile"],
  attribution: "MapTiler",
  terms: "MapTiler Cloud Terms",
  evidenceUrl: "https://www.maptiler.com/copyright/"
});

const THUNDERFOREST_RIGHTS = source({
  id: "thunderforest",
  label: "Thunderforest",
  hosts: ["www.thunderforest.com"],
  uses: ["outbound-link", "tile"],
  attribution: "Thunderforest",
  terms: "Thunderforest API Terms",
  evidenceUrl: "https://www.thunderforest.com/"
});

const STADIA_MAPS_RIGHTS = source({
  id: "stadia-maps",
  label: "Stadia Maps",
  hosts: ["stadiamaps.com", "*.stadiamaps.com"],
  uses: ["outbound-link", "tile"],
  attribution: "Stadia Maps",
  terms: "Stadia Maps terms and provider-specific data licences",
  evidenceUrl: "https://stadiamaps.com/attribution/"
});

const TOMTOM_RIGHTS = source({
  id: "tomtom",
  label: "TomTom",
  hosts: ["www.tomtom.com"],
  uses: ["outbound-link", "tile"],
  attribution: "TomTom",
  terms: "TomTom Maps API Terms",
  evidenceUrl: "https://www.tomtom.com/"
});

const GEOAPIFY_RIGHTS = source({
  id: "geoapify",
  label: "Geoapify",
  hosts: ["www.geoapify.com"],
  uses: ["outbound-link", "tile"],
  attribution: "Geoapify",
  terms: "Geoapify Platform Terms",
  evidenceUrl: "https://www.geoapify.com/"
});

const CYCLOSM_RIGHTS = source({
  id: "cyclosm",
  label: "CyclOSM",
  hosts: ["www.cyclosm.org", "*.tile-cyclosm.openstreetmap.fr"],
  uses: ["tile", "outbound-link"],
  attribution: "CyclOSM and OpenStreetMap contributors",
  terms: "CC-BY-SA-2.0 and ODbL-1.0",
  evidenceUrl: "https://www.cyclosm.org/"
});

const WAYMARKED_TRAILS_RIGHTS = source({
  id: "waymarked-trails",
  label: "Waymarked Trails",
  hosts: ["waymarkedtrails.org", "*.waymarkedtrails.org"],
  uses: ["tile", "outbound-link"],
  attribution: "Waymarked Trails and OpenStreetMap contributors",
  terms: "CC-BY-SA-3.0 and ODbL-1.0",
  evidenceUrl: "https://waymarkedtrails.org/"
});

const OPENRAILWAYMAP_RIGHTS = source({
  id: "openrailwaymap",
  label: "OpenRailwayMap",
  hosts: ["www.openrailwaymap.org", "*.tiles.openrailwaymap.org"],
  uses: ["tile", "outbound-link"],
  attribution: "OpenRailwayMap and OpenStreetMap contributors",
  terms: "CC-BY-SA-2.0 and ODbL-1.0",
  evidenceUrl: "https://www.openrailwaymap.org/"
});

const OPENSEAMAP_RIGHTS = source({
  id: "openseamap",
  label: "OpenSeaMap",
  hosts: ["www.openseamap.org", "*.openseamap.org"],
  uses: ["tile", "outbound-link"],
  attribution: "OpenSeaMap and OpenStreetMap contributors",
  terms: "ODbL-1.0",
  evidenceUrl: "https://www.openseamap.org/"
});

const OPENTOPOMAP_RIGHTS = source({
  id: "opentopomap",
  label: "OpenTopoMap",
  hosts: ["opentopomap.org", "*.opentopomap.org"],
  uses: ["tile", "outbound-link"],
  attribution: "OpenTopoMap and OpenStreetMap contributors",
  terms: "CC-BY-SA-3.0 and ODbL-1.0",
  evidenceUrl: "https://opentopomap.org/"
});

const OPENSNOWMAP_RIGHTS = source({
  id: "opensnowmap",
  label: "OpenSnowMap",
  hosts: ["www.opensnowmap.org", "*.opensnowmap.org"],
  uses: ["tile", "outbound-link"],
  attribution: "OpenSnowMap and OpenStreetMap contributors",
  terms: "CC-BY-SA-2.0 and ODbL-1.0",
  evidenceUrl: "https://www.opensnowmap.org/"
});

const USGS_RIGHTS = source({
  id: "usgs",
  label: "USGS",
  hosts: ["earthquake.usgs.gov"],
  uses: ["api", "outbound-link"],
  attribution: "USGS",
  terms: "United States public domain",
  evidenceUrl: "https://earthquake.usgs.gov/"
});

const INATURALIST_RIGHTS = source({
  id: "inaturalist",
  label: "iNaturalist",
  hosts: ["www.inaturalist.org"],
  uses: ["api", "media", "outbound-link"],
  attribution: "iNaturalist and observation authors",
  terms: "Per-observation licence (catalog default CC-BY-NC)",
  evidenceUrl: "https://www.inaturalist.org/"
});

const GBIF_RIGHTS = source({
  id: "gbif",
  label: "GBIF",
  hosts: ["www.gbif.org", "api.gbif.org"],
  uses: ["api", "tile", "outbound-link"],
  attribution: "GBIF",
  terms: "CC-BY-4.0",
  evidenceUrl: "https://www.gbif.org/"
});

const SENSOR_COMMUNITY_RIGHTS = source({
  id: "sensor-community",
  label: "Sensor.Community",
  hosts: ["sensor.community", "*.sensor.community"],
  uses: ["api", "outbound-link"],
  attribution: "Sensor.Community",
  terms: "ODbL-1.0",
  evidenceUrl: "https://sensor.community/"
});

const WIKIMEDIA_COMMONS_RIGHTS = source({
  id: "wikimedia-commons",
  label: "Wikimedia Commons",
  hosts: ["commons.wikimedia.org"],
  uses: ["api", "media", "outbound-link"],
  attribution: "Wikimedia Commons and asset authors",
  terms: "Per-asset Creative Commons or public-domain declaration",
  evidenceUrl: "https://commons.wikimedia.org/"
});

const REFUGE_RESTROOMS_RIGHTS = source({
  id: "refuge-restrooms",
  label: "Refuge Restrooms",
  hosts: ["www.refugerestrooms.org"],
  uses: ["api", "outbound-link"],
  attribution: "Refuge Restrooms",
  terms: "Refuge Restrooms open-data terms",
  evidenceUrl: "https://www.refugerestrooms.org/"
});

const OPEN_CHARGE_MAP_RIGHTS = source({
  id: "open-charge-map",
  label: "Open Charge Map",
  hosts: ["openchargemap.org", "*.openchargemap.org"],
  uses: ["api", "outbound-link"],
  attribution: "Open Charge Map",
  terms: "ODbL-1.0",
  evidenceUrl: "https://openchargemap.org/"
});

const NASA_FIRMS_RIGHTS = source({
  id: "nasa-firms",
  label: "NASA FIRMS",
  hosts: ["firms.modaps.eosdis.nasa.gov"],
  uses: ["api", "outbound-link"],
  attribution: "NASA FIRMS",
  terms: "United States public domain",
  evidenceUrl: "https://firms.modaps.eosdis.nasa.gov/"
});

const OPENAQ_RIGHTS = source({
  id: "openaq",
  label: "OpenAQ",
  hosts: ["openaq.org", "*.openaq.org"],
  uses: ["api", "outbound-link"],
  attribution: "OpenAQ",
  terms: "CC-BY-4.0",
  evidenceUrl: "https://openaq.org/"
});

const EBIRD_RIGHTS = source({
  id: "ebird",
  label: "eBird / Cornell Lab",
  hosts: ["ebird.org", "*.ebird.org"],
  uses: ["api", "outbound-link"],
  attribution: "eBird / Cornell Lab",
  terms: "eBird API Terms",
  evidenceUrl: "https://ebird.org/"
});

const TICKETMASTER_RIGHTS = source({
  id: "ticketmaster",
  label: "Ticketmaster",
  hosts: ["developer.ticketmaster.com"],
  uses: ["api", "outbound-link"],
  attribution: "Ticketmaster",
  terms: "Ticketmaster Developer Agreement",
  evidenceUrl: "https://developer.ticketmaster.com/"
});

const MOBILITYDATA_GITHUB_RIGHTS = source({
  id: "mobilitydata-gbfs",
  label: "MobilityData GBFS",
  hosts: ["github.com"],
  uses: ["api", "outbound-link"],
  attribution: "MobilityData and feed operators",
  terms: "GBFS feed-specific operator terms",
  evidenceUrl: "https://github.com/MobilityData/gbfs"
});

/** Complete advisory inventory for literal external hosts shipped in browser source. */
export const BROWSER_EXTERNAL_SOURCE_RIGHTS: readonly ExternalSourceRights[] = [
  source({
    id: "golemio",
    label: "Golemio",
    hosts: ["api.golemio.cz"],
    uses: ["outbound-link"],
    attribution: "Golemio / Operátor ICT a poskytovatel datasetu",
    terms: "Golemio Open Data; dataset-specific attribution and terms",
    evidenceUrl: "https://api.golemio.cz/docs/openapi/"
  }),
  source({
    id: "spaceapi",
    label: "SpaceAPI",
    hosts: ["spaceapi.io"],
    uses: ["outbound-link"],
    attribution: "SpaceAPI and space operators",
    terms: "Public operator-provided SpaceAPI data; individual space access conditions",
    evidenceUrl: "https://spaceapi.io/docs/"
  }),
  source({
    id: "btcmap",
    label: "BTC Map",
    hosts: ["btcmap.org"],
    uses: ["outbound-link"],
    attribution: "BTC Map / OpenStreetMap contributors",
    terms: "ODbL-1.0 for OpenStreetMap data; BTC Map API usage documentation",
    evidenceUrl: "https://github.com/teambtcmap/btcmap-api/blob/master/docs/rest/v4/places.md"
  }),
  source({
    id: "europeana",
    label: "Europeana",
    hosts: ["www.europeana.eu"],
    uses: ["outbound-link"],
    attribution: "Europeana and collection providers",
    terms: "CC0 metadata; digital object rights supplied separately; Europeana API access policy",
    evidenceUrl: "https://www.europeana.eu/en/rights/terms-of-use"
  }),
  source({
    id: "nasa-power",
    label: "NASA POWER",
    hosts: ["power.larc.nasa.gov"],
    uses: ["outbound-link"],
    attribution: "NASA POWER · CERES / MERRA-2",
    terms: "NASA open data; acknowledgment requested",
    evidenceUrl: "https://power.larc.nasa.gov/docs/faqs/"
  }),
  source({
    id: "gdacs",
    label: "GDACS",
    hosts: ["www.gdacs.org"],
    uses: ["outbound-link"],
    attribution: "GDACS · European Commission / UN",
    terms: "GDACS Terms of Use / European Commission copyright policy",
    evidenceUrl: "https://www.gdacs.org/About/termofuse.aspx"
  }),
  source({
    id: "noaa-swpc",
    label: "NOAA SWPC",
    hosts: ["www.spaceweather.gov", "www.swpc.noaa.gov"],
    uses: ["outbound-link"],
    attribution: "NOAA SWPC · OVATION",
    terms: "United States public domain",
    evidenceUrl: "https://www.weather.gov/disclaimer"
  }),
  source({
    id: "jrc-surface-water",
    label: "EC JRC Global Surface Water",
    hosts: ["storage.googleapis.com", "global-surface-water.appspot.com"],
    uses: ["tile", "outbound-link"],
    attribution: "Source: EC JRC/Google · Pekel et al. (2016)",
    terms: "Copernicus open data, acknowledgment required",
    evidenceUrl: "https://global-surface-water.appspot.com/download"
  }),
  source({
    id: "doi-resolver",
    label: "DOI source references",
    hosts: ["doi.org"],
    uses: ["outbound-link"],
    attribution: "Original dataset and publication authors",
    terms: "Outbound citations; the linked dataset's own licence applies",
    evidenceUrl:
      "https://www.doi.org/the-identifier/resources/factsheets/doi-system-and-the-internet/"
  }),
  source({
    id: "soilgrids",
    label: "ISRIC SoilGrids 2.0",
    hosts: ["maps.isric.org", "docs.isric.org"],
    uses: ["tile", "media", "outbound-link"],
    attribution: "ISRIC · Poggio et al. (2021)",
    terms: "CC BY 4.0",
    evidenceUrl: "https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html"
  }),
  source({
    id: "gebco",
    label: "GEBCO 2026",
    hosts: ["wms.gebco.net", "www.gebco.net"],
    uses: ["tile", "media", "outbound-link"],
    attribution: "GEBCO Bathymetric Compilation Group 2026 · NERC EDS BODC NOC",
    terms: "Public domain, attribution required; not for marine navigation",
    evidenceUrl: "https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid"
  }),
  source({
    id: "esa-worldcover",
    label: "ESA WorldCover / Terrascope",
    hosts: ["wmts.terrascope.be", "esa-worldcover.org"],
    uses: ["tile", "outbound-link"],
    attribution:
      "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
    terms: "Creative Commons Attribution 4.0 International",
    evidenceUrl: "https://esa-worldcover.org/en/data-access"
  }),
  source({
    id: "cuzk-public",
    label: "ČÚZK / Zeměměřický úřad / DMVS",
    hosts: ["cuzk.gov.cz", "*.cuzk.gov.cz"],
    uses: ["tile", "media", "outbound-link"],
    attribution: "© ČÚZK; DMVS: příslušné krajské DTM",
    terms:
      "Podmínky poskytování síťových služeb ČÚZK; veřejné prohlížení DMVS; podmínky ZÚ pro ortofoto",
    evidenceUrl:
      "https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb.aspx"
  }),
  source({
    id: "dpp-cr",
    label: "Digitální povodňový plán ČR",
    hosts: ["webmap.dppcr.cz"],
    uses: ["tile", "media", "outbound-link"],
    attribution: "© MŽP / Hydrosoft Veleslavín",
    terms: "Veřejná prohlížecí WMS dPP ČR; informativní zobrazení s atribucí",
    evidenceUrl: "https://webmap.dppcr.cz/dpp_cr/wms.dll?MAP=4870&TMPL=AJAX_MAIN"
  }),
  source({
    id: "copernicus-drought",
    label: "Copernicus CEMS drought",
    hosts: ["drought.emergency.copernicus.eu"],
    uses: ["tile", "outbound-link"],
    attribution: "European Union, Copernicus Emergency Management Service",
    terms: "Copernicus CEMS terms and conditions",
    evidenceUrl: "https://drought.emergency.copernicus.eu/terms%26conditions/"
  }),
  source({
    id: "emodnet-bathymetry",
    label: "EMODnet Bathymetry",
    hosts: ["ows.emodnet-bathymetry.eu", "emodnet.ec.europa.eu"],
    uses: ["tile", "outbound-link"],
    attribution: "EMODnet Bathymetry consortium",
    terms: "EMODnet Bathymetry DTM terms of use",
    evidenceUrl: "https://emodnet.ec.europa.eu/en/bathymetry"
  }),
  source({
    id: "osm-france",
    label: "OpenStreetMap France",
    hosts: ["www.openstreetmap.fr", "*.tile.openstreetmap.fr"],
    uses: ["tile", "outbound-link"],
    attribution: "OpenStreetMap France; © OpenStreetMap contributors",
    terms: "OSM France usage policy; map and data licences are distinct",
    evidenceUrl: "https://www.openstreetmap.fr/usage/"
  }),
  source({
    id: "hot",
    label: "Humanitarian OpenStreetMap Team",
    hosts: ["www.hotosm.org"],
    uses: ["outbound-link"],
    attribution: "Humanitarian OpenStreetMap Team",
    terms: "Attribution link; tile hosting is provided separately by OpenStreetMap France",
    evidenceUrl: "https://www.hotosm.org/"
  }),
  source({
    id: "opnvkarte",
    label: "ÖPNVKarte / MeMoMaps",
    hosts: ["tileserver.memomaps.de", "memomaps.de", "www.xn--pnvkarte-m4a.de"],
    uses: ["tile", "outbound-link"],
    attribution: "Map © MeMoMaps; data © OpenStreetMap contributors",
    terms: "CC-BY-SA map, ODbL data; high-traffic services require own tile hosting",
    evidenceUrl: "https://www.xn--pnvkarte-m4a.de/"
  }),
  source({
    id: "geoboundaries",
    label: "geoBoundaries",
    hosts: ["www.geoboundaries.org"],
    uses: ["outbound-link"],
    attribution: "geoBoundaries and original boundary contributors",
    terms: "gbOpen CC-BY-4.0; preserve individual boundary licence metadata",
    evidenceUrl: "https://www.geoboundaries.org/api.html"
  }),
  source({
    id: "natural-earth",
    label: "Natural Earth",
    hosts: ["www.naturalearthdata.com"],
    uses: ["outbound-link"],
    attribution: "Natural Earth",
    terms: "Public domain map data",
    evidenceUrl: "https://www.naturalearthdata.com/about/terms-of-use/"
  }),
  source({
    id: "opencaching",
    label: "Opencaching",
    hosts: ["www.opencaching.de"],
    uses: ["outbound-link"],
    attribution: "Opencaching contributors",
    terms: "Attribution link; API and listing rights remain source-specific",
    evidenceUrl: "https://www.opencaching.de/"
  }),
  source({
    id: "heritage",
    label: "Wikimedia Heritage",
    hosts: ["heritage.toolforge.org"],
    uses: ["outbound-link"],
    attribution: "Wikimedia Heritage contributors",
    terms: "Attribution link; individual monument and media source terms apply",
    evidenceUrl: "https://heritage.toolforge.org/"
  }),
  source({
    id: "turf",
    label: "Turf",
    hosts: ["turfgame.com"],
    uses: ["outbound-link"],
    attribution: "Turf",
    terms: "Attribution link; Turf API and content terms require separate review",
    evidenceUrl: "https://turfgame.com/"
  }),
  source({
    id: "openinframap",
    label: "OpenInfraMap",
    hosts: ["openinframap.org"],
    uses: ["outbound-link"],
    attribution: "OpenInfraMap; OpenStreetMap contributors",
    terms: "Attribution link; underlying OpenStreetMap data under ODbL",
    evidenceUrl: "https://openinframap.org/"
  }),
  source({
    id: "eea",
    label: "European Environment Agency",
    hosts: ["www.eea.europa.eu", "bio.discomap.eea.europa.eu"],
    uses: ["api", "outbound-link"],
    attribution: "European Environment Agency and dataset contributors",
    terms: "Dataset-specific reuse conditions; preserve published Natura 2000 attribution",
    evidenceUrl: "https://www.eea.europa.eu/"
  }),
  source({
    id: "eurostat",
    label: "Eurostat",
    hosts: ["ec.europa.eu"],
    uses: ["outbound-link"],
    attribution: "Eurostat / European Commission",
    terms: "Attribution link; dataset-specific European Commission reuse conditions",
    evidenceUrl: "https://ec.europa.eu/eurostat/"
  }),
  source({
    id: "tilezen-terrain",
    label: "Tilezen Terrain Tiles",
    hosts: ["s3.amazonaws.com", "registry.opendata.aws"],
    uses: ["tile", "outbound-link"],
    attribution: "Tilezen / Mapzen and contributing elevation datasets",
    terms:
      "Only elevation-tiles-prod bucket is used; per-dataset attribution from Tilezen joerd applies, not a licence for arbitrary S3 data",
    evidenceUrl: "https://registry.opendata.aws/terrain-tiles/"
  }),
  source({
    id: "adsblol",
    label: "ADSB.lol",
    hosts: ["adsb.lol"],
    uses: ["outbound-link"],
    attribution: "ADSB.lol",
    terms: "ODbL 1.0",
    evidenceUrl: "https://www.adsb.lol/docs/open-data/api/"
  }),
  source({
    id: "aisstream",
    label: "AISstream",
    hosts: ["aisstream.io"],
    uses: ["outbound-link"],
    attribution: "AISstream",
    terms: "Server-side stream; wider-use licence must be confirmed with the operator",
    evidenceUrl: "https://aisstream.io/documentation"
  }),
  source({
    id: "meshcore",
    label: "MeshCore analyzer",
    hosts: ["analyzer.meshcore.cz"],
    uses: ["outbound-link"],
    attribution: "MeshCore community",
    terms: "Community data; reuse rights not independently verified",
    evidenceUrl: "https://analyzer.meshcore.cz"
  }),
  OPENSTREETMAP_RIGHTS,
  WIKIPEDIA_RIGHTS,
  WIKIDATA_RIGHTS,
  OPEN_METEO_RIGHTS,
  MACROSTRAT_RIGHTS,
  MAPILLARY_RIGHTS,
  PANORAMAX_RIGHTS,
  NASA_EONET_RIGHTS,
  OPEN_DATA_HUB_RIGHTS,
  DIGITRAFFIC_RIGHTS,
  BOOKING_RIGHTS,
  CELESTRAK_RIGHTS,
  OVERTURE_RIGHTS,
  WINDY_RIGHTS,
  FOURSQUARE_RIGHTS,
  GOOGLE_MAPS_RIGHTS,
  GEOCACHING_RIGHTS,
  KOMOOT_RIGHTS,
  CARTO_RIGHTS,
  MAPY_RIGHTS,
  RAINVIEWER_RIGHTS,
  PARK4NIGHT_RIGHTS,
  OPENFREEMAP_RIGHTS,
  EOX_RIGHTS,
  ESRI_RIGHTS,
  NASA_GIBS_RIGHTS,
  HERE_RIGHTS,
  MAPTILER_RIGHTS,
  THUNDERFOREST_RIGHTS,
  STADIA_MAPS_RIGHTS,
  TOMTOM_RIGHTS,
  GEOAPIFY_RIGHTS,
  CYCLOSM_RIGHTS,
  WAYMARKED_TRAILS_RIGHTS,
  OPENRAILWAYMAP_RIGHTS,
  OPENSEAMAP_RIGHTS,
  OPENTOPOMAP_RIGHTS,
  OPENSNOWMAP_RIGHTS,
  USGS_RIGHTS,
  INATURALIST_RIGHTS,
  GBIF_RIGHTS,
  SENSOR_COMMUNITY_RIGHTS,
  WIKIMEDIA_COMMONS_RIGHTS,
  REFUGE_RESTROOMS_RIGHTS,
  OPEN_CHARGE_MAP_RIGHTS,
  NASA_FIRMS_RIGHTS,
  OPENAQ_RIGHTS,
  EBIRD_RIGHTS,
  TICKETMASTER_RIGHTS,
  MOBILITYDATA_GITHUB_RIGHTS
];

/** Reserved documentation/parser fixtures which can never make a network request. */
export const NON_NETWORK_BROWSER_HOST_LITERALS = [
  "mapos.example",
  "relative.mapos.invalid",
  // The SVG/XML namespace passed to `document.createElementNS`. It is an identifier, never a
  // host anything is fetched from, so it is not an external source.
  "www.w3.org"
] as const;

function normalizedHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\{s\}\./, "*.");
}

function matchesHostPattern(host: string, pattern: string): boolean {
  const normalized = normalizedHost(host);
  const candidate = normalizedHost(pattern);
  if (normalized === candidate) return true;
  if (!candidate.startsWith("*.") || normalized.startsWith("*.")) return false;
  return normalized.endsWith(candidate.slice(1));
}

export function externalSourceForBrowserHost(host: string): ExternalSourceRights | undefined {
  return BROWSER_EXTERNAL_SOURCE_RIGHTS.find((entry) =>
    entry.hosts.some((pattern) => matchesHostPattern(host, pattern))
  );
}
