-- Baseline Madaraka Express timetable transcribed from the Kenya Railways
-- 2026 passenger schedule (https://krc.co.ke/wp-content/uploads/2026/01/Madaraka-Express-Passenger-Service-Train-Schedule.pdf).
-- Keep existing operator timetable entries intact; add only missing train,
-- direction, and origin-time combinations. All three services run daily.
WITH baseline("id", "name", "direction", "originCode", "destCode", "originTime", "destTime", "destDayOffset", "serviceDays", "active") AS (
  VALUES
    ('krc-2026-mba-nbo-intercounty', 'Inter-County', 'MBA_TO_NBO', 'MTM', 'NTM', '08:00', '14:10', 0, ARRAY[0,1,2,3,4,5,6]::INTEGER[], TRUE),
    ('krc-2026-mba-nbo-express', 'Express', 'MBA_TO_NBO', 'MTM', 'NTM', '15:00', '20:18', 0, ARRAY[0,1,2,3,4,5,6]::INTEGER[], TRUE),
    ('krc-2026-mba-nbo-night', 'Night Train', 'MBA_TO_NBO', 'MTM', 'NTM', '22:00', '03:55', 1, ARRAY[0,1,2,3,4,5,6]::INTEGER[], TRUE),
    ('krc-2026-nbo-mba-intercounty', 'Inter-County', 'NBO_TO_MBA', 'NTM', 'MTM', '08:00', '14:00', 0, ARRAY[0,1,2,3,4,5,6]::INTEGER[], TRUE),
    ('krc-2026-nbo-mba-express', 'Express', 'NBO_TO_MBA', 'NTM', 'MTM', '15:00', '20:30', 0, ARRAY[0,1,2,3,4,5,6]::INTEGER[], TRUE),
    ('krc-2026-nbo-mba-night', 'Night Train', 'NBO_TO_MBA', 'NTM', 'MTM', '22:00', '03:55', 1, ARRAY[0,1,2,3,4,5,6]::INTEGER[], TRUE)
)
INSERT INTO "Train" (
  "id", "name", "direction", "originCode", "destCode", "originTime",
  "destTime", "destDayOffset", "serviceDays", "active"
)
SELECT
  baseline."id", baseline."name", baseline."direction", baseline."originCode",
  baseline."destCode", baseline."originTime", baseline."destTime",
  baseline."destDayOffset", baseline."serviceDays", baseline."active"
FROM baseline
WHERE NOT EXISTS (
  SELECT 1
  FROM "Train" current
  WHERE current."direction" = baseline."direction"
    AND lower(current."name") = lower(baseline."name")
    AND current."originTime" = baseline."originTime"
)
ON CONFLICT ("id") DO NOTHING;
