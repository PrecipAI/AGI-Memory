BEGIN;

ALTER TABLE memory_access_log
    DROP CONSTRAINT IF EXISTS memory_access_log_memory_id_fkey;

ALTER TABLE memory_access_log
    ADD CONSTRAINT memory_access_log_memory_id_fkey
    FOREIGN KEY (memory_id)
    REFERENCES memory(id)
    ON DELETE SET NULL;

COMMIT;
