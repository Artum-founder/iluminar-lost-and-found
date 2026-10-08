-- Claims can skip the phone number (reach = 'facebook'), carry a detail only the owner
-- would know (proof, crew only), and the crew can mark the real owner of a disputed item.
ALTER TABLE claims ADD COLUMN proof TEXT NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN reach TEXT NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN picked INTEGER NOT NULL DEFAULT 0;

-- Peder's test claim on B1-05 before launch.
DELETE FROM claims WHERE id IN ('ef88e979-fade-41e8-a3fb-e74115bcac97');
