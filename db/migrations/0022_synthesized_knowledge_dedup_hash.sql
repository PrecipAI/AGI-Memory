-- 0022: 修复 kp_synthesized_knowledge btree index size exceeded
--
-- 问题：0008 migration 创建的 UNIQUE (tenant_id, scope, knowledge_type, normalized_content)
-- 把整段 normalized_content 塞进 btree 索引。normalized_content 是 text 类型，
-- 当 L4 合成知识的规范化内容较长时，索引行超过 btree 2704 字节限制，
-- 导致 INSERT 失败：index row size 2712 exceeds btree version 4 maximum 2704.
--
-- 修复：删掉包含 normalized_content 全文的 UNIQUE 约束，
-- 改成基于 md5(normalized_content) 的表达式 UNIQUE 索引。
-- MD5 hash 固定 32 字符，索引行永远在 btree 限制内，去重语义不变。
--
-- 参考提示：Consider a function index of an MD5 hash of the value, or use full text indexing.

BEGIN;

-- 1. 删除原 UNIQUE 约束（会一并删除对应的 btree 索引）
ALTER TABLE kp_synthesized_knowledge
    DROP CONSTRAINT IF EXISTS kp_synthesized_knowledge_tenant_id_scope_knowledge_type_nor_key;

-- 2. 创建基于 MD5 hash 的表达式 UNIQUE 索引
-- 去重语义保留：同 tenant+scope+type 下，md5 相同视为重复
-- 索引行固定大小（tenant_id + scope + knowledge_type + 32 字符 md5），永不超限
CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_dedup_hash
    ON kp_synthesized_knowledge (tenant_id, scope, knowledge_type, md5(normalized_content));

COMMIT;
