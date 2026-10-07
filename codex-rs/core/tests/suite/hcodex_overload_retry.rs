//! hcodex: transient overload and quota-check responses from proxy providers
//! are retried with a longer backoff. OpenAI keeps upstream terminal semantics.

use anyhow::Result;
use codex_protocol::protocol::EventMsg;
use codex_protocol::turn_input::TurnInputRequest;
use codex_protocol::user_input::UserInput;
use core_test_support::responses;
use core_test_support::skip_if_no_network;
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use pretty_assertions::assert_eq;

#[tokio::test(flavor = "current_thread")]
async fn sse_overload_from_non_openai_provider_is_retried() -> Result<()> {
    skip_if_no_network!(Ok(()));

    let server = responses::start_mock_server().await;
    let response_mock = responses::mount_sse_sequence(
        &server,
        vec![
            responses::sse_failed("resp-1", "server_is_overloaded", "model busy"),
            responses::sse(vec![
                responses::ev_assistant_message("msg-1", "pong"),
                responses::ev_completed("resp-2"),
            ]),
        ],
    )
    .await;
    let test = test_codex()
        .with_config(|config| {
            // Local proxies / gateways: not the OpenAI provider.
            config.model_provider.requires_openai_auth = false;
            config.model_provider.stream_max_retries = Some(3);
        })
        .build_with_auto_env(&server)
        .await?;

    test.codex
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "retry the streamed overload".to_string(),
            text_elements: Vec::new(),
        }]))
        .await?;

    let mut error_events = 0;
    let mut stream_error_messages = Vec::new();
    let mut agent_messages = Vec::new();
    let completed = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            match wait_for_event(&test.codex, |_| true).await {
                EventMsg::Error(_) => error_events += 1,
                EventMsg::StreamError(event) => stream_error_messages.push(event.message),
                EventMsg::AgentMessage(event) => agent_messages.push(event.message),
                EventMsg::TurnComplete(event) => break event,
                _ => {}
            }
        }
    })
    .await
    .expect("overload retry should finish the turn within 30 seconds");

    assert_eq!(
        error_events, 0,
        "the overload must not surface as a terminal error"
    );
    assert!(
        completed.error.is_none(),
        "turn should complete cleanly after the retry: {:?}",
        completed.error
    );
    assert!(
        stream_error_messages
            .iter()
            .any(|message| message.starts_with("Model at capacity, retrying... 1/3")),
        "expected a capacity retry notice, got {stream_error_messages:?}"
    );
    assert_eq!(agent_messages, vec!["pong".to_string()]);
    assert_eq!(
        response_mock.requests().len(),
        2,
        "one overloaded attempt plus one successful retry"
    );

    Ok(())
}

/// hcodex: an HTTP 429 with `Retry-After` from a non-OpenAI provider is retried
/// at the HTTP layer instead of failing with "exceeded retry limit".
#[tokio::test(flavor = "current_thread")]
async fn http_429_from_non_openai_provider_is_retried_after_retry_after() -> Result<()> {
    skip_if_no_network!(Ok(()));
    use wiremock::Mock;
    use wiremock::ResponseTemplate;
    use wiremock::matchers::method;
    use wiremock::matchers::path;

    let server = responses::start_mock_server().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("Retry-After", "1")
                .set_body_json(serde_json::json!({
                    "error": { "type": "rate_limit_error", "message": "slow down" }
                })),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let response_mock = responses::mount_sse_once(
        &server,
        responses::sse(vec![
            responses::ev_assistant_message("msg-1", "pong"),
            responses::ev_completed("resp-2"),
        ]),
    )
    .await;
    let test = test_codex()
        .with_config(|config| {
            config.model_provider.requires_openai_auth = false;
            config.model_provider.request_max_retries = Some(3);
        })
        .build_with_auto_env(&server)
        .await?;

    let started = std::time::Instant::now();
    test.codex
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "retry the rate limit".to_string(),
            text_elements: Vec::new(),
        }]))
        .await?;

    let mut error_events = 0;
    let mut agent_messages = Vec::new();
    let completed = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            match wait_for_event(&test.codex, |_| true).await {
                EventMsg::Error(_) => error_events += 1,
                EventMsg::AgentMessage(event) => agent_messages.push(event.message),
                EventMsg::TurnComplete(event) => break event,
                _ => {}
            }
        }
    })
    .await
    .expect("429 retry should finish the turn within 30 seconds");

    assert_eq!(error_events, 0, "429 must not surface as a terminal error");
    assert!(
        completed.error.is_none(),
        "turn failed: {:?}",
        completed.error
    );
    assert_eq!(agent_messages, vec!["pong".to_string()]);
    assert_eq!(
        response_mock.requests().len(),
        1,
        "the retry reached the SSE mock"
    );
    assert!(
        started.elapsed() >= std::time::Duration::from_secs(1),
        "should have waited for Retry-After: 1"
    );

    Ok(())
}

#[tokio::test(flavor = "current_thread")]
async fn sse_rate_limit_from_non_openai_provider_is_retried() -> Result<()> {
    skip_if_no_network!(Ok(()));

    let server = responses::start_mock_server().await;
    let response_mock = responses::mount_sse_sequence(
        &server,
        vec![
            responses::sse_failed("resp-1", "rate_limit_exceeded", "quota probe failed"),
            responses::sse(vec![
                responses::ev_assistant_message("msg-1", "pong"),
                responses::ev_completed("resp-2"),
            ]),
        ],
    )
    .await;
    let test = test_codex()
        .with_config(|config| {
            config.model_provider.requires_openai_auth = false;
            config.model_provider.stream_max_retries = Some(1);
        })
        .build_with_auto_env(&server)
        .await?;

    test.codex
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "retry the streamed rate limit".to_string(),
            text_elements: Vec::new(),
        }]))
        .await?;

    let mut stream_error_messages = Vec::new();
    let mut agent_messages = Vec::new();
    let completed = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            match wait_for_event(&test.codex, |_| true).await {
                EventMsg::StreamError(event) => stream_error_messages.push(event.message),
                EventMsg::AgentMessage(event) => agent_messages.push(event.message),
                EventMsg::TurnComplete(event) => break event,
                _ => {}
            }
        }
    })
    .await
    .expect("rate-limit retry should finish within 30 seconds");

    assert!(
        completed.error.is_none(),
        "turn failed: {:?}",
        completed.error
    );
    assert!(
        stream_error_messages
            .iter()
            .any(|message| message.starts_with("Provider rate limit, retrying... 1/1")),
        "expected a provider rate-limit notice, got {stream_error_messages:?}"
    );
    assert_eq!(agent_messages, vec!["pong".to_string()]);
    assert_eq!(response_mock.requests().len(), 2);

    Ok(())
}

#[tokio::test(flavor = "current_thread")]
async fn http_usage_limit_uses_only_request_retry_budget() -> Result<()> {
    skip_if_no_network!(Ok(()));

    let server = responses::start_mock_server().await;
    let response_mock = responses::mount_response_sequence(
        &server,
        (0..2)
            .map(|_| {
                wiremock::ResponseTemplate::new(429)
                    .insert_header("Retry-After", "0")
                    .set_body_json(serde_json::json!({
                        "error": {"type": "usage_limit_reached", "message": "quota probe"}
                    }))
            })
            .collect(),
    )
    .await;
    let test = test_codex()
        .with_config(|config| {
            config.model_provider.requires_openai_auth = false;
            config.model_provider.request_max_retries = Some(1);
            config.model_provider.stream_max_retries = Some(3);
        })
        .build_with_auto_env(&server)
        .await?;

    test.codex
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "retry the quota probe".to_string(),
            text_elements: Vec::new(),
        }]))
        .await?;

    let mut agent_messages = Vec::new();
    let completed = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            match wait_for_event(&test.codex, |_| true).await {
                EventMsg::AgentMessage(event) => agent_messages.push(event.message),
                EventMsg::TurnComplete(event) => break event,
                _ => {}
            }
        }
    })
    .await
    .expect("usage-limit request retries should finish within 30 seconds");

    assert!(
        completed.error.is_some(),
        "the final HTTP usage-limit error should be terminal: {:?}",
        completed.error
    );
    assert!(agent_messages.is_empty());
    assert_eq!(
        response_mock.requests().len(),
        2,
        "one initial request plus one request-layer retry"
    );

    Ok(())
}
