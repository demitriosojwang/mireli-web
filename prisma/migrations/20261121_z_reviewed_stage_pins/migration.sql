-- Match the published row, label and seeded coordinate so a later field
-- correction or a different environment never gets overwritten.
-- Bamburi Mwisho is OSM bus-stop node 7844424885.
UPDATE "RouteStage" SET lat = -4.00234, lng = 39.69904
WHERE id = 'cmwiyyu69000flicyvtpvj60l' AND name = 'Bamburi Mwisho'
  AND lat = -3.9939 AND lng = 39.7231;

-- Coast Water Works Mombasa North Mainland ESIA Table 8.1, converted from DMS.
UPDATE "RouteStage" SET lat = -4.003597, lng = 39.710908
WHERE id = 'cmwiyyu6h000nlicyiyursips' AND name = 'Mwambeni'
  AND lat = -4.02061 AND lng = 39.72006;
UPDATE "RouteStage" SET lat = -4.025150, lng = 39.699461
WHERE id = 'cmwiyyu6o000vlicyug8qxtnx' AND name = 'Bambolulu'
  AND lat = -4.0221 AND lng = 39.70214;
