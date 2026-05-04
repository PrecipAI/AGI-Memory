BEGIN;

ALTER TABLE kp_document
    ADD COLUMN IF NOT EXISTS markdown_content text,
    ADD COLUMN IF NOT EXISTS markdown_content_hash text,
    ADD COLUMN IF NOT EXISTS markdown_content_ref text,
    ADD COLUMN IF NOT EXISTS markdown_converted_at timestamptz,
    ADD COLUMN IF NOT EXISTS markdown_converter text;

CREATE INDEX IF NOT EXISTS idx_kp_document_markdown_hash
    ON kp_document (tenant_id, scope, markdown_content_hash);

COMMIT;
