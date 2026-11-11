//! Read-only sound-effect discovery for agent sessions.

use crate::auth::{KeyringStore, StoreError, TokenStore};
use crate::styles_sync::Fetched;
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

type SearchResult = Result<Value, (u16, Value)>;
type CredentialResult<T> = Result<T, &'static str>;

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    client_id: String,
    client_secret: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

struct Token {
    value: String,
    refresh_at: Instant,
}

pub struct Openverse {
    client: reqwest::Result<Client>,
    base: String,
    account: String,
    store: Arc<dyn TokenStore>,
    token: Mutex<Option<Token>>,
}

impl Openverse {
    pub fn new(profile: &str) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("tayang-studio/", env!("CARGO_PKG_VERSION")))
                .build(),
            base: "https://api.openverse.org/v1/".into(),
            account: format!("openverse:{profile}"),
            store: Arc::new(KeyringStore),
            token: Mutex::new(None),
        }
    }

    async fn keychain<T: Send + 'static>(
        &self,
        op: impl FnOnce(&dyn TokenStore, &str) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        let store = self.store.clone();
        let account = self.account.clone();
        tokio::task::spawn_blocking(move || op(store.as_ref(), &account))
            .await
            .map_err(|_| StoreError::Failed("Openverse keychain task ended".into()))?
    }

    pub async fn credentials_saved(&self) -> CredentialResult<bool> {
        let _token = self.token.lock().await;
        self.keychain(|store, account| store.get(account).map(|value| value.is_some()))
            .await
            .map_err(|_| "keychain")
    }

    pub async fn update_credentials(
        &self,
        credentials: Option<Credentials>,
    ) -> CredentialResult<()> {
        let mut token = self.token.lock().await;
        if let Some(mut credentials) = credentials {
            credentials.client_id = credentials.client_id.trim().to_owned();
            credentials.client_secret = credentials.client_secret.trim().to_owned();
            if [&credentials.client_id, &credentials.client_secret]
                .iter()
                .any(|value| {
                    value.is_empty()
                        || value.len() > 512
                        || value.chars().any(char::is_whitespace)
                        || value.chars().any(char::is_control)
                })
            {
                return Err("invalid-credentials");
            }
            let next = self.exchange(&credentials).await?;
            let value = serde_json::to_string(&credentials).map_err(|_| "invalid-credentials")?;
            self.keychain(move |store, account| store.set(account, &value))
                .await
                .map_err(|_| "keychain")?;
            *token = Some(next);
        } else {
            self.keychain(|store, account| store.delete(account))
                .await
                .map_err(|_| "keychain")?;
            *token = None;
        }
        Ok(())
    }

    async fn exchange(&self, credentials: &Credentials) -> CredentialResult<Token> {
        let response = self
            .client
            .as_ref()
            .map_err(|_| "unavailable")?
            .post(format!("{}auth_tokens/token/", self.base))
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", credentials.client_id.as_str()),
                ("client_secret", credentials.client_secret.as_str()),
            ])
            .send()
            .await
            .map_err(|_| "unavailable")?;
        match response.status().as_u16() {
            200 => {}
            400 | 401 => return Err("invalid-credentials"),
            429 => return Err("rate-limited"),
            _ => return Err("unavailable"),
        }
        let response = Fetched::read(response, 16 * 1024)
            .await
            .map_err(|_| "unavailable")?;
        let response: TokenResponse =
            serde_json::from_slice(&response.body).map_err(|_| "unavailable")?;
        if response.expires_in == 0
            || response.access_token.is_empty()
            || !response.access_token.bytes().all(|c| c.is_ascii_graphic())
        {
            return Err("unavailable");
        }
        let refresh_at = Instant::now()
            .checked_add(Duration::from_secs(response.expires_in.saturating_sub(30)))
            .ok_or("unavailable")?;
        Ok(Token {
            value: response.access_token,
            refresh_at,
        })
    }

    async fn access_token(&self) -> CredentialResult<Option<String>> {
        let mut token = self.token.lock().await;
        if let Some(token) = token
            .as_ref()
            .filter(|token| token.refresh_at > Instant::now())
        {
            return Ok(Some(token.value.clone()));
        }
        let value = match self.keychain(|store, account| store.get(account)).await {
            Ok(Some(value)) => value,
            Ok(None) | Err(StoreError::Unavailable(_)) => return Ok(None),
            Err(_) => return Err("keychain"),
        };
        let credentials = serde_json::from_str(&value).map_err(|_| "invalid-credentials")?;
        let next = self.exchange(&credentials).await?;
        let value = next.value.clone();
        *token = Some(next);
        Ok(Some(value))
    }

    pub async fn search(
        &self,
        enabled: bool,
        query: &str,
        allow_public_credit: bool,
    ) -> SearchResult {
        if !enabled {
            return Err(error(
                403,
                "disabled",
                "Openverse sound effects are off in Settings → Video defaults",
            ));
        }
        let unavailable = || provider_error("unavailable");
        let mut url =
            Url::parse(&format!("{}audio/", self.base)).expect("valid Openverse endpoint");
        // shortcut: Freesound previews only, expand once another source has verified download and license metadata.
        url.query_pairs_mut()
            .append_pair("q", query)
            .append_pair("source", "freesound")
            .append_pair(
                "license",
                if allow_public_credit { "cc0,by" } else { "cc0" },
            )
            .append_pair("length", "short")
            .append_pair("page_size", "8");
        let mut request = self.client.as_ref().map_err(|_| unavailable())?.get(url);
        let access_token = self.access_token().await.map_err(provider_error)?;
        if let Some(token) = &access_token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|_| unavailable())?;
        match response.status().as_u16() {
            200 => {}
            429 => return Err(provider_error("rate-limited")),
            401 if access_token.is_some() => {
                let mut cached = self.token.lock().await;
                if cached.as_ref().map(|token| &token.value) == access_token.as_ref() {
                    *cached = None;
                }
                return Err(provider_error("invalid-credentials"));
            }
            _ => return Err(unavailable()),
        }
        let res = Fetched::read(response, 256 * 1024)
            .await
            .map_err(|_| unavailable())?;
        let body: Value = serde_json::from_slice(&res.body).map_err(|_| unavailable())?;
        let results = body
            .get("results")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        Ok(json!({
            "results": results.iter().take(8).filter_map(|record| sound(record, allow_public_credit)).collect::<Vec<_>>()
        }))
    }
}

fn provider_error(code: &str) -> (u16, Value) {
    match code {
        "invalid-credentials" => error(
            401,
            code,
            "Openverse rejected authentication; check the credentials in Settings",
        ),
        "keychain" => error(
            502,
            code,
            "Tayang could not read Openverse credentials from the system keychain",
        ),
        "rate-limited" => error(
            429,
            code,
            "Openverse's rate limit was reached; use local sound effects for this turn",
        ),
        _ => error(
            502,
            "unavailable",
            "Openverse is unavailable; continue with local sound design",
        ),
    }
}

fn error(status: u16, code: &str, message: &str) -> (u16, Value) {
    (status, json!({ "error": code, "message": message }))
}

fn https_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none())
    .then_some(url)
}

fn sound(record: &Value, allow_public_credit: bool) -> Option<Value> {
    let text = |field: &str| {
        record
            .get(field)?
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let license = text("license")?;
    let prefix = match license {
        "cc0" => "/publicdomain/zero/",
        "by" if allow_public_credit => "/licenses/by/",
        _ => return None,
    };
    let license_url = https_url(text("license_url")?)?;
    if license_url.host_str()? != "creativecommons.org" || !license_url.path().starts_with(prefix) {
        return None;
    }
    let source = https_url(text("foreign_landing_url")?)?;
    if !matches!(source.host_str()?, "freesound.org" | "www.freesound.org") {
        return None;
    }
    let audio = https_url(text("url")?)?;
    if audio.host_str()? != "cdn.freesound.org"
        || !audio.path().starts_with("/previews/")
        || !audio.path().ends_with(".mp3")
    {
        return None;
    }
    let creator = text("creator");
    let attribution = text("attribution");
    if license == "by" && (creator.is_none() || attribution.is_none()) {
        return None;
    }
    Some(json!({
        "title": text("title")?,
        "creator": creator,
        "license": license,
        "licenseUrl": license_url.as_str(),
        "sourceUrl": source.as_str(),
        "audioUrl": audio.as_str(),
        "durationMs": record.get("duration").and_then(Value::as_u64),
        "attribution": attribution,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{tests::fake, MemoryStore};

    #[tokio::test]
    async fn credentials_authenticate_search_and_are_reloaded_and_removed() {
        let endpoint = "/api/auth_tokens/token/";
        let server = fake(move |request, nth| {
            if request.path == endpoint {
                if request.body == "grant_type=client_credentials&client_id=test-id&client_secret=valid%2Bsecret" {
                    (200, json!({ "access_token": format!("token-{nth}"), "expires_in": 3600 }).to_string())
                } else {
                    (401, json!({ "error": "invalid_client" }).to_string())
                }
            } else {
                (200, json!({ "results": [] }).to_string())
            }
        }).await;
        let mut openverse = Openverse::new("test");
        openverse.base = format!("{}/", server.base);
        openverse.store = Arc::new(MemoryStore::default());
        assert!(!openverse.credentials_saved().await.unwrap());
        openverse.search(true, "footsteps", false).await.unwrap();
        let credentials = |secret: &str| {
            Some(Credentials {
                client_id: "test-id".into(),
                client_secret: secret.into(),
            })
        };
        openverse
            .update_credentials(credentials("valid+secret"))
            .await
            .unwrap();
        assert!(openverse.credentials_saved().await.unwrap());
        openverse.search(true, "footsteps", false).await.unwrap();
        assert_eq!(server.hits(endpoint).len(), 1);
        assert_eq!(
            openverse.update_credentials(credentials("wrong")).await,
            Err("invalid-credentials")
        );
        // A restart/expired token reloads the saved pair, including after a failed replacement.
        *openverse.token.lock().await = None;
        openverse.search(true, "footsteps", false).await.unwrap();
        assert_eq!(server.hits(endpoint).len(), 3);
        openverse.update_credentials(None).await.unwrap();
        assert!(!openverse.credentials_saved().await.unwrap());
        openverse.search(true, "footsteps", false).await.unwrap();
        let hits = server.hits.lock().unwrap();
        let headers: Vec<_> = hits
            .iter()
            .filter(|hit| hit.path.starts_with("/api/audio/"))
            .map(|hit| hit.auth.as_deref())
            .collect();
        assert_eq!(
            headers,
            [None, Some("Bearer token-0"), Some("Bearer token-2"), None]
        );
    }

    #[test]
    fn only_allowed_licenses_and_direct_freesound_previews_are_returned() {
        let mut record = json!({
            "title": "Footsteps",
            "creator": "A. Recorder",
            "license": "by",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "foreign_landing_url": "https://freesound.org/people/recorder/sounds/123",
            "url": "https://cdn.freesound.org/previews/0/123-hq.mp3",
            "duration": 2900,
            "attribution": "Footsteps by A. Recorder",
        });
        assert!(sound(&record, false).is_none());
        let result = sound(&record, true).unwrap();
        assert_eq!(result["durationMs"], 2900);
        assert_eq!(result["creator"], "A. Recorder");
        assert_eq!(result["sourceUrl"], record["foreign_landing_url"]);
        for (key, value) in [
            ("license", json!("by-nc")),
            (
                "license_url",
                json!("https://creativecommons.org/licenses/by-nc/4.0/"),
            ),
            (
                "foreign_landing_url",
                json!("https://freesound.org.example/sounds/123"),
            ),
            ("url", json!("https://127.0.0.1/previews/123.mp3")),
            ("attribution", Value::Null),
        ] {
            let original = record[key].clone();
            record[key] = value;
            assert!(sound(&record, true).is_none(), "{key}");
            record[key] = original;
        }
        record["license"] = json!("cc0");
        record["license_url"] = json!("https://creativecommons.org/publicdomain/zero/1.0/");
        record["creator"] = Value::Null;
        assert_eq!(sound(&record, false).unwrap()["license"], "cc0");
    }

    #[tokio::test]
    async fn off_never_searches() {
        let (status, body) = Openverse::new("test")
            .search(false, "footsteps", false)
            .await
            .unwrap_err();
        assert_eq!(status, 403);
        assert_eq!(body["error"], "disabled");
    }
}
