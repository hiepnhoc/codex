//! hcodex tests for `responses_retry.rs`, kept out of upstream's
//! `responses_retry_tests.rs` so a sync does not conflict there.
use super::MAX_PROVIDER_RETRY_AFTER;
use super::cap_provider_retry_after;
use codex_http_client::RetryAfter;
use std::time::Duration;

/// hcodex: a proxy's multi-hour `Retry-After` must not park the turn.
#[tokio::test]
async fn provider_retry_after_is_capped_for_third_party_providers() {
    tokio::time::pause();
    let advice = RetryAfter::from_delay(Duration::from_secs(12_353)).expect("retry deadline");

    let capped = cap_provider_retry_after(Some(advice), /*requires_openai_auth*/ false)
        .expect("advice is kept");
    assert!(capped.remaining_delay() <= MAX_PROVIDER_RETRY_AFTER);
    assert!(capped.remaining_delay() > MAX_PROVIDER_RETRY_AFTER - Duration::from_millis(5));

    let kept = cap_provider_retry_after(Some(advice), /*requires_openai_auth*/ true)
        .expect("advice is kept");
    assert_eq!(kept.deadline(), advice.deadline());

    let short = RetryAfter::from_delay(Duration::from_secs(10)).expect("retry deadline");
    let unchanged = cap_provider_retry_after(Some(short), /*requires_openai_auth*/ false)
        .expect("advice is kept");
    assert_eq!(unchanged.deadline(), short.deadline());

    assert!(cap_provider_retry_after(None, /*requires_openai_auth*/ false).is_none());
}
