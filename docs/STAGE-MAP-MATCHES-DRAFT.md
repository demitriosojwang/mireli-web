# Mombasa stage map matches — review draft

**Status: draft for owner review only. Do not import these locations into the
production route directory or activate a route from this file.** The fare PDF
establishes stage names and prices, but not exact pickup points, route order,
or door-to-door surcharge values. Many public map results identify a whole
neighbourhood, a nearby business, or a station with a similar name rather than
the actual passenger stage.

## Decisions still needed before route publication

For every row, confirm the physical passenger waiting point and the correct
side of the road, then approve the route order and per-stop door-to-door
surcharge. The fare-sheet order below is preserved for comparison; it is not
claimed to be the driving order. “Candidate coordinates” are only map pins for
review, never safe defaults for production navigation or dispatch.

| Fare-sheet area and point | Fare (KSh/seat) | Draft map match / coordinates | Confidence and review note |
| --- | ---: | --- | --- |
| North · Kiembeni Mwisho | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Kiembeni%20Mwisho%2C%20Mombasa%2C%20Kenya) · nearby address reference `2P72+J8V` | Low · plus code is for a business address in Kiembeni Mwisho, not a confirmed stage pin. |
| North · Kiembeni Police | 400 | [Kiembeni Police Station](https://www.waze.com/live-map/directions/ke/mombasa-county/mombasa/kiembeni-police-station?to=place.ChIJNbhBj-kNQBgRb_07ne27_HU) · `2P72+H3R` | Medium · station is identified, but confirm the actual matatu stage/pickup point. |
| North · Ananda Magaya | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Ananda%20Magaya%20Mombasa%20Kenya) | Low · fare sheet also has a handwritten spelling variant “Ananda Marga”; owner should confirm the sign/name. |
| North · San Sera | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=San%20Sera%20Mombasa%20Kenya) | Low · exact public map match not established. |
| North · Green Estate | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Green%20Estate%20Mombasa%20Kenya) | Low · several possible estate matches; exact estate and passenger stage needed. |
| North · Kona Kiembeni | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Kona%20Kiembeni%20Mombasa%20Kenya) | Low · junction/landmark not resolved. |
| North · Bamburi Mwisho | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Bamburi%20Mwisho%20stage%20Mombasa%20Kenya) | Medium-low · mapped as a bus stop near Kobil Kiembeni on Old Malindi Road; confirm exact waiting point. |
| North · Bamburi Naivas | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Naivas%20Bamburi%2C%20Mombasa%2C%20Kenya) · candidate POI `-4.00274, 39.70154` | Medium-low · public listing identifies Naivas Bamburi, but the pin needs verification against the correct entrance/stage. |
| North · Total Bamburi | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=TotalEnergies%20Bamburi%20Mombasa%20Kenya) | Medium-low · station/business appears on Malindi Road; several nearby stops may be meant. |
| North · Fisheries | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Fisheries%20stage%20Bamburi%20Mombasa%20Kenya) · neighbourhood centre `-3.99956, 39.70663` | Low · coordinate is the Fisheries neighbourhood, not a verified passenger stage. |
| North · Mwenbeni | 400 | [Mwembeni stage map search](https://www.google.com/maps/search/?api=1&query=Mwembeni%20stage%2C%20Mombasa%20Kenya) · candidate `-4.003597, 39.710908` | Medium · a public infrastructure report lists “Mwembeni stage” at this point; confirm whether this is the fare-sheet “Mwenbeni” and correct spelling. |
| North · GCC Junction | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=GCC%20Junction%20Mombasa%20Kenya) | Low · fare sheet alias “JCC Junction” also needs owner confirmation; no exact stage match established. |
| North · Nyali Centre | 400 | [Nyali Centre map search](https://www.google.com/maps/search/?api=1&query=Nyali%20Centre%2C%20Mombasa%2C%20Kenya) · candidate mall pin `-4.02201, 39.71968` | Medium · mall location is clear; confirm whether the passenger stage is at the mall entrance or the nearby matatu stop. |
| North · VOK | 400 | [VOK Stage map search](https://www.google.com/maps/search/?api=1&query=VOK%20Stage%2C%20Mombasa%2C%20Kenya) · nearby listing `-4.03059, 39.69140` | Medium-low · the listing is reported close to VOK Stage; use the actual stage pin after visual/driver review. |
| North · Bambolulu | 400 | [Bombolulu Stage map search](https://www.google.com/maps/search/?api=1&query=Bombolulu%20Stage%2C%20Mombasa%2C%20Kenya) · candidate `-4.025150, 39.699461` | Medium-high · a public Mombasa North Mainland infrastructure report gives coordinates for Bombolulu Stage. Confirm current safe boarding point. |
| North · Lights | 400 | [Lights Stage map search](https://www.google.com/maps/search/?api=1&query=Lights%20Stage%2C%20Mombasa%2C%20Kenya) · OSM point `-4.03860, 39.68062` | Medium · exact OpenStreetMap node labelled “Lights Stage”; confirm it is the fare-sheet stop and still operational. |
| North · Mtwapa | 400 | [Mtwapa map search](https://www.google.com/maps/search/?api=1&query=Mtwapa%2C%20Kenya) · town centre candidate `-3.9474, 39.7424` | Low · town-centre coordinate only; not a passenger stage. |
| North · Malindi | 700 | [Malindi map search](https://www.google.com/maps/search/?api=1&query=Malindi%2C%20Kenya) · city centre `-3.2185, 40.1113` | Low · UNGEGN/Suggested Survey of Kenya coordinate is a city reference, not the fare-sheet stage. Confirm exact terminus. |
| North · Changamwe | 200 | [Changamwe map search](https://www.google.com/maps/search/?api=1&query=Changamwe%20stage%2C%20Mombasa%2C%20Kenya) · ward reference `-4.019, 39.620` | Low · administrative-area centre only; choose the actual stage. |
| North · Mikindani | 250 | [Mikindani map search](https://www.google.com/maps/search/?api=1&query=Mikindani%20stage%2C%20Mombasa%2C%20Kenya) · nearby clinic reference `-4.00356, 39.62987` | Low · the coordinate is a clinic near Sunset Stage, not a confirmed Mireli stop. |
| North · Miritini | 250 | [Miritini map search](https://www.google.com/maps/search/?api=1&query=Miritini%20stage%2C%20Mombasa%2C%20Kenya) · suburb centre `-4.00355, 39.57834` | Low · Miritini is a large suburb; distinguish the bus stage from Mombasa Terminus and other nearby stops. |
| North · Town (CBD) / Mwembe Tayari | 300 | [Mwembe Tayari stage map search](https://www.google.com/maps/search/?api=1&query=Mwembe%20Tayari%20bus%20stage%2C%20Mombasa%2C%20Kenya) | Low · exact CBD boarding point and whether both names refer to one stop need confirmation. |
| South · Likoni Ferry Container | 400 | [Likoni Ferry map search](https://www.google.com/maps/search/?api=1&query=Likoni%20Ferry%20Container%20stage%2C%20Mombasa%2C%20Kenya) · ferry terminal reference `-4.07753, 39.66596` | Medium-low · terminal is mapped; “Container” may be a distinct nearby stage. Confirm the correct side and gate. |
| South · Kona Mpya (Fayaz) | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Kona%20Mpya%20Fayaz%20Likoni%20Mombasa%20Kenya) | Low · Kona Mpya is found in Likoni, but the fare-sheet “Fayaz” qualifier has no verified pin. |
| South · Shika Adabu (Checkpoint) | 400 | [Map search](https://www.google.com/maps/search/?api=1&query=Shika%20Adabu%20Checkpoint%2C%20Likoni%2C%20Kenya) · ward centre `-4.108, 39.646` | Low · this is a ward-level reference, not the checkpoint. Do not confuse it with a different Shika Adabu in Tana River. |
| South · Diani Naivas | 500 | [Naivas Diani/Ukunda map search](https://www.google.com/maps/search/?api=1&query=Naivas%20Diani%20Ukunda%20Kenya) · candidate store pin `-4.28143, 39.56645` | Medium · Naivas Diani/Ukunda is identifiable; confirm the correct stop and passenger pickup side. |

## Route-order and operating assumptions to review

- The PDF does not give travel order. Proposed North and South service paths
  must be reviewed against the actual driver pickup/drop-off sequence and
  traffic direction; the table is deliberately not numbered as a route.
- The published map pin must represent where the customer actually waits, not
  the centre of a neighbourhood, mall, ward, or town.
- Set a numeric door-to-door surcharge for each stage. Do not infer it from
  distance or let a missing value silently become zero. Mireli passes the full
  door surcharge to the driver.
- Confirm spelling variants before customer-facing labels and aliases are
  finalized: `Ananda Magaya`/`Ananda Marga`, `Mwenbeni`/`Mwembeni`,
  `GCC Junction`/`JCC Junction`, `Bamburi Naivas`/`Naivas Bamburi`, and
  `Town (CBD)`/`Mwembe Tayari`.
- Confirm the Mombasa Terminus origin pin and whether the route includes an
  order-0 terminus row before importing stops.

## Sources used for candidate matches

- [Mombasa Terminus (OpenStreetMap-derived map record)](https://mapcarta.com/N9815479964)
- [Kiembeni Police Station (Waze)](https://www.waze.com/live-map/directions/ke/mombasa-county/mombasa/kiembeni-police-station?to=place.ChIJNbhBj-kNQBgRb_07ne27_HU)
- [Fisheries neighbourhood (OpenStreetMap-derived map record)](https://mapcarta.com/N11468576704)
- [Mombasa North Mainland infrastructure report listing Bombolulu and Mwembeni stage coordinates](https://documents1.worldbank.org/curated/en/884751606370716162/pdf/Environmental-and-Social-Impact-Assessment-Report-for-the-Water-Distribution-Short-Term-Works-for-Mombasa-North-Mainland.pdf)
- [Lights Stage OpenStreetMap node](https://www.openstreetmap.org/node/3278126129)
- [Mtwapa (OpenStreetMap-derived map record)](https://mapcarta.com/Mtwapa)
- [Malindi coordinates from UNGEGN, source attributed to Survey of Kenya](https://ungegn.un.org/dashboard/cities/details?id=3374)
- [Changamwe and Likoni administrative map coordinates](https://openadmindata.org/ke/subcounties/changamwe-ke001001/)
- [Diani Naivas candidate location](https://kenya.worldplaces.me/review/213221767-naivas-diani.html)
- [Bamburi Naivas candidate location](https://kenya.worldplaces.me/review/183098513-naivas-bamburi.html)
- [Nyali Centre candidate coordinates](https://kenya.worldplaces.me/shopping-malls-in-mombasa/43466790-nyali-centre.html)

Some candidate links are third-party or community-maintained. Treat the
coordinates as map-review clues, not verified location data. OpenStreetMap data
is available under the Open Database License; include appropriate attribution
if OSM-derived data is later imported into Mireli.
