CREATE TABLE IF NOT EXISTS incident_legal (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  incident_id INTEGER NOT NULL REFERENCES incidents(id),
  assessment_key TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS incident_legal_event_key_unique ON incident_legal(incident_id, assessment_key);

-- Replace the original placeholder after the police source disclosed individual roles.
DELETE FROM incident_participants
WHERE participant_key = 'suspects'
  AND incident_id IN (SELECT id FROM incidents WHERE slug = 'akacfa-homicide')
  AND json_extract(details, '$.note') = 'Оба задержаны и допрошены. Индивидуальные данные и сведения о лидере в материалах не указаны.';

-- Distinguish police detention and a request for pretrial custody.
UPDATE incident_updates SET detail='BRFK сообщила, что двоих мужчин задержали, допросили как подозреваемых и ходатайствовали об их заключении под стражу.' WHERE detail='BRFK сообщила, что двоих мужчин допросили как подозреваемых и взяли под стражу.';
