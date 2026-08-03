ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT 'blue';

UPDATE projects
SET color = CASE lower(substr(id, 1, 1))
    WHEN '0' THEN 'blue'
    WHEN '1' THEN 'violet'
    WHEN '2' THEN 'emerald'
    WHEN '3' THEN 'amber'
    WHEN '4' THEN 'rose'
    WHEN '5' THEN 'cyan'
    WHEN '6' THEN 'orange'
    WHEN '7' THEN 'slate'
    WHEN '8' THEN 'blue'
    WHEN '9' THEN 'violet'
    WHEN 'a' THEN 'emerald'
    WHEN 'b' THEN 'amber'
    WHEN 'c' THEN 'rose'
    WHEN 'd' THEN 'cyan'
    WHEN 'e' THEN 'orange'
    ELSE 'slate'
END;
