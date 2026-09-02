# Planning routing request mapping

`PlanDocumentV2` stores provider-neutral choices. The client sends the complete document to
`POST /v2/routing/plan` together with `provider: "osm" | "mapy"`. Each adjacent segment request
contains exactly two endpoints plus:

```json
{
  "profile": "foot | bike | car | moto | camper | truck",
  "preference": "fast | short | nohwy | adventure",
  "avoid": [],
  "vehicle": "the PlanDocument vehicle constraints"
}
```

`resolvePlanRoutingRequestV2` is the executable mapping used by both PlanningPanel and the
production adjacent-route adapter. PlanningPanel shows the resolved provider profile and any
fallback before a request is made; the adapter repeats the same warning on the resulting segment.
A fallback response is never relabelled as if the provider had implemented the requested policy.

## Vehicle mapping

| Canonical profile | Mapy.com request profile | OSM/OSRM request profile | Capability note                                                                                    |
| ----------------- | ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `foot`            | `foot_fast`              | `foot`                   | native                                                                                             |
| `bike`            | `bike_road`              | `bike`                   | native                                                                                             |
| `car`             | `car_fast_traffic`       | `car`                    | native                                                                                             |
| `moto`            | car profile              | `car`                    | explicit fallback; motorcycle constraints are not guaranteed                                       |
| `camper`          | car profile              | `car`                    | explicit fallback; dimensions/weight stay in PlanDocument but are not guaranteed by these adapters |
| `truck`           | car profile              | `car`                    | explicit fallback; dimensions/weight stay in PlanDocument but are not guaranteed by these adapters |

## Route-preference mapping

| Canonical preference | Mapy.com                                        | OSM/OSRM                 | Fallback behavior                                                                                                                             |
| -------------------- | ----------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`               | `foot_fast`, `bike_road`, or `car_fast_traffic` | `foot`, `bike`, or `car` | native                                                                                                                                        |
| `short`              | `car_short` for motorised profiles              | no native support        | foot/bike and OSM use the fast profile with a visible warning                                                                                 |
| `nohwy`              | no native motorway-avoidance guarantee          | no native support        | fast profile; Mapy additionally receives `avoidToll=true`, while UI and segment warning state that motorways are not guaranteed to be avoided |
| `adventure`          | `foot_hiking` or `bike_mountain`                | no native support        | motorised and OSM requests use the fast profile with a visible warning                                                                        |

If a configured Mapy.com request fails and the route service falls back to OSM/OSRM, the segment
also records the runtime provider fallback. The deterministic memory provider used by offline tests
does not make a public request and is not evidence of a production provider capability.
