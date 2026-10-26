-- Care dates are calendar dates (YYYY-MM-DD). Older clients stored ISO datetimes such as
-- 2026-03-09T10:15:00.000Z; keep their first 10 characters. Re-running changes nothing.
UPDATE plants SET last_watered_date = left(last_watered_date, 10) WHERE last_watered_date LIKE '%T%';
UPDATE plants SET last_fertilized_date = left(last_fertilized_date, 10) WHERE last_fertilized_date LIKE '%T%';
UPDATE plants SET last_repotted_date = left(last_repotted_date, 10) WHERE last_repotted_date LIKE '%T%';
UPDATE plants SET last_pruned_date = left(last_pruned_date, 10) WHERE last_pruned_date LIKE '%T%';
