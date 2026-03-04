-- Migration 154: Conversation memory + pending confirmations for Kai agent
--
-- Enables multi-turn conversations across Web, Telegram, and WhatsApp
-- channels, and tracks pending write-tool confirmations.

-- 1. Conversation threads
CREATE TABLE IF NOT EXISTS ai_conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES companies(id),
    user_id         uuid REFERENCES users(id),           -- NULL for unmapped external users
    channel         text NOT NULL DEFAULT 'web',          -- 'web', 'telegram', 'whatsapp'
    channel_user_id text,                                 -- e.g. Telegram chat_id or WhatsApp phone
    started_at      timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NOT NULL DEFAULT now(),
    metadata_json   jsonb DEFAULT '{}'::jsonb             -- arbitrary per-conversation state
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_company
    ON ai_conversations (company_id, user_id, channel);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_channel_user
    ON ai_conversations (company_id, channel, channel_user_id)
    WHERE channel_user_id IS NOT NULL;

-- 2. Conversation messages (compact history for context window)
CREATE TABLE IF NOT EXISTS ai_conversation_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role            text NOT NULL,                        -- 'user', 'assistant', 'tool'
    content         text,                                 -- message text (NULL for pure tool calls)
    tool_calls_json jsonb,                                -- assistant tool_calls array
    tool_call_id    text,                                 -- for role=tool, the call ID
    tool_name       text,                                 -- for role=tool, which tool was called
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_messages_conv
    ON ai_conversation_messages (conversation_id, created_at);

-- 3. Pending confirmations for write tools
CREATE TABLE IF NOT EXISTS ai_pending_confirmations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    company_id      uuid NOT NULL REFERENCES companies(id),
    user_id         uuid REFERENCES users(id),
    tool_name       text NOT NULL,                        -- e.g. 'create_purchase_order'
    arguments_json  jsonb NOT NULL,                       -- the tool arguments to execute
    summary         text NOT NULL,                        -- human-readable confirmation prompt
    status          text NOT NULL DEFAULT 'pending',      -- 'pending', 'confirmed', 'rejected', 'expired'
    created_at      timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz,
    expires_at      timestamptz DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_conf_conv
    ON ai_pending_confirmations (conversation_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_pending_conf_expiry
    ON ai_pending_confirmations (status, expires_at)
    WHERE status = 'pending';

-- 4. Telegram user ↔ system user mapping
CREATE TABLE IF NOT EXISTS ai_channel_user_links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES companies(id),
    channel         text NOT NULL,                        -- 'telegram', 'whatsapp'
    channel_user_id text NOT NULL,                        -- Telegram chat_id, WhatsApp phone
    user_id         uuid NOT NULL REFERENCES users(id),
    linked_at       timestamptz NOT NULL DEFAULT now(),
    is_active       boolean NOT NULL DEFAULT true,
    UNIQUE (company_id, channel, channel_user_id)
);

-- Enable RLS on all new tables
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pending_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_channel_user_links ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern as other company-scoped tables)
DO $$
BEGIN
    -- ai_conversations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_conversations' AND policyname = 'ai_conversations_company_isolation') THEN
        EXECUTE format(
            'CREATE POLICY ai_conversations_company_isolation ON ai_conversations FOR ALL USING (company_id = app_current_company_id())'
        );
    END IF;

    -- ai_conversation_messages — access via conversation's company
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_conversation_messages' AND policyname = 'ai_conv_messages_company_isolation') THEN
        EXECUTE format(
            'CREATE POLICY ai_conv_messages_company_isolation ON ai_conversation_messages FOR ALL USING (
                conversation_id IN (SELECT id FROM ai_conversations WHERE company_id = app_current_company_id())
            )'
        );
    END IF;

    -- ai_pending_confirmations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_pending_confirmations' AND policyname = 'ai_pending_conf_company_isolation') THEN
        EXECUTE format(
            'CREATE POLICY ai_pending_conf_company_isolation ON ai_pending_confirmations FOR ALL USING (company_id = app_current_company_id())'
        );
    END IF;

    -- ai_channel_user_links
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_channel_user_links' AND policyname = 'ai_channel_links_company_isolation') THEN
        EXECUTE format(
            'CREATE POLICY ai_channel_links_company_isolation ON ai_channel_user_links FOR ALL USING (company_id = app_current_company_id())'
        );
    END IF;
END $$;

-- Grant to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations TO ahapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversation_messages TO ahapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_pending_confirmations TO ahapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_channel_user_links TO ahapp;
