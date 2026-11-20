//! hcodex tests for `client_common.rs`, kept out of upstream's
//! `client_common_tests.rs` so a sync does not conflict there.
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use pretty_assertions::assert_eq;

/// hcodex: agent messages become plain user text for proxies.
#[test]
fn hcodex_agent_messages_render_as_plain_user_messages() {
    use codex_protocol::models::AgentMessageInputContent;
    let mut items = vec![
        ResponseItem::AgentMessage {
            id: None,
            author: "/root".to_string(),
            recipient: "/root/worker".to_string(),
            content: vec![
                AgentMessageInputContent::InputText {
                    text: "Message Type: NEW_TASK\nPayload:\n".to_string(),
                },
                AgentMessageInputContent::EncryptedContent {
                    encrypted_content: "Reply with pong.".to_string(),
                },
            ],
            internal_chat_message_metadata_passthrough: None,
        },
        ResponseItem::Message {
            encrypted_content: None,
            status: None,
            id: None,
            role: "assistant".to_string(),
            content: vec![ContentItem::OutputText {
                annotations: None,
                logprobs: None,
                text: "pong".to_string(),
            }],
            phase: None,
            internal_chat_message_metadata_passthrough: None,
        },
    ];
    let untouched = items[1].clone();

    super::render_agent_messages_as_plain_text(&mut items);

    assert_eq!(
        items[0],
        ResponseItem::Message {
            encrypted_content: None,
            status: None,
            id: None,
            role: "user".to_string(),
            content: vec![ContentItem::InputText {
                text: "Message Type: NEW_TASK\nPayload:\nReply with pong.".to_string(),
            }],
            phase: None,
            internal_chat_message_metadata_passthrough: None,
        }
    );
    assert_eq!(items[1], untouched);
}
