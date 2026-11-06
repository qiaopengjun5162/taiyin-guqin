//! 寄信通道：找回口令的重置链接从这里发出去。
//!
//! 为什么需要它：口令只存 Argon2 散列，忘了就是真忘了——服务端也无法"找回"
//! 原口令，只能**重置**。重置链接得送到本人手里，邮件是账号体系的标准通道。
//!
//! 三种后端，用枚举而不是 trait 对象：就三种实现，枚举省掉 dyn 与
//! async-trait 的样板，测试也好换。
//!
//! - [`Mailer::Smtp`]：真发信。生产要配 `SMTP_HOST` 等环境变量（见 [`Mailer::from_env`]）。
//! - [`Mailer::Log`]：**不发信**，只把内容写进日志。没配 SMTP 时的诚实降级——
//!   开发 / 自测够用；生产不配 SMTP 就等于找回没通。令牌会进日志，
//!   能看日志的人本来也能进库，不算新开的洞，但要知道这回事。
//! - [`Mailer::Capture`]：攒在内存里给测试断言。

use std::sync::{Arc, Mutex};

use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};

/// 一封信的最小要素。刻意只有纯文本：HTML 模板对找回口令是纯负担。
#[derive(Debug, Clone)]
pub struct OutgoingMail {
    pub to: String,
    pub subject: String,
    pub body: String,
}

/// 发信后端（随 `ServerConfig` 走，测试用 [`Mailer::capture`] 顶替）。
#[derive(Clone, Default)]
pub enum Mailer {
    /// 不发信，内容进日志。没配 SMTP 时的降级。
    #[default]
    Log,
    /// 真发信：SMTP（465 隐式 TLS，其余端口 STARTTLS）。
    Smtp(SmtpMailer),
    /// 测试捕获：信攒在内存里，用例用 [`CaptureHandle`] 来取。
    Capture(Arc<Mutex<Vec<OutgoingMail>>>),
}

/// 与 [`Mailer::Capture`] 共享缓冲的取信句柄。
#[derive(Clone)]
pub struct CaptureHandle(Arc<Mutex<Vec<OutgoingMail>>>);

impl CaptureHandle {
    /// 取走目前攒下的所有信（并清空）。
    pub fn take(&self) -> Vec<OutgoingMail> {
        std::mem::take(&mut *self.0.lock().expect("capture buffer poisoned"))
    }
}

/// SMTP 传输。套一层 `Arc`：传输本身未必 `Clone`，而 `Mailer` 要 `Clone`
/// （`ServerConfig` 是 `Clone` 的）。
#[derive(Clone)]
pub struct SmtpMailer {
    transport: Arc<AsyncSmtpTransport<Tokio1Executor>>,
    from: Mailbox,
}

// `AsyncSmtpTransport` 不实现 Debug，手写一个不泄凭据的。
impl std::fmt::Debug for Mailer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Mailer::Log => f.write_str("Mailer::Log"),
            Mailer::Smtp(_) => f.write_str("Mailer::Smtp"),
            Mailer::Capture(_) => f.write_str("Mailer::Capture"),
        }
    }
}

impl Mailer {
    /// 从环境变量构造：
    ///
    /// - `SMTP_HOST`：发信服务器（如 `smtp.163.com`）。**不配就降级为 `Log`**。
    /// - `SMTP_PORT`：端口，默认 587（STARTTLS）；465 走隐式 TLS。
    /// - `SMTP_USERNAME` / `SMTP_PASSWORD`：登录凭据（多数邮箱配的是「授权码」）。
    /// - `MAIL_FROM`：发件人，如 `太音古琴 <noreply@example.com>`。
    pub fn from_env() -> Self {
        let Ok(host) = std::env::var("SMTP_HOST") else {
            tracing::warn!(
                "未配置 SMTP_HOST，找回口令邮件只会进日志、不会真发出——生产环境必须配 SMTP"
            );
            return Mailer::Log;
        };
        let username = std::env::var("SMTP_USERNAME").unwrap_or_default();
        let password = std::env::var("SMTP_PASSWORD").unwrap_or_default();
        let from =
            std::env::var("MAIL_FROM").unwrap_or_else(|_| "taiyin <noreply@localhost>".into());
        let port: u16 = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(587);

        let from: Mailbox = match from.parse() {
            Ok(f) => f,
            Err(e) => {
                tracing::error!(error = %e, "MAIL_FROM 不合法，降级为日志模式");
                return Mailer::Log;
            }
        };

        let creds = Credentials::new(username, password);
        // 465 = 隐式 TLS（连上就加密）；其余端口（587 等）走 STARTTLS 升级。
        let builder = if port == 465 {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
        };
        let transport = match builder {
            Ok(b) => b.credentials(creds).port(port).build(),
            Err(e) => {
                tracing::error!(error = %e, host, "SMTP 传输构造失败，降级为日志模式");
                return Mailer::Log;
            }
        };
        Mailer::Smtp(SmtpMailer {
            transport: Arc::new(transport),
            from,
        })
    }

    /// 测试用：攒信的后端 + 取信句柄。
    pub fn capture() -> (Self, CaptureHandle) {
        let buf = Arc::new(Mutex::new(Vec::new()));
        (Mailer::Capture(buf.clone()), CaptureHandle(buf))
    }

    /// 是否「走网络」的后端。
    ///
    /// `Log` 与 `Capture` 都是本地即时后端（写日志 / 写内存），
    /// 调用方可以同步等它们完成；只有 `Smtp` 会真的花掉一次网络往返。
    pub fn is_remote(&self) -> bool {
        matches!(self, Mailer::Smtp(_))
    }

    /// 发一封信。失败只报错给调用方记日志，**不改变找回接口的对外响应**——
    /// 发信失败若让接口报 500，等于告诉旁人「这个邮箱注册过」。
    pub async fn send(&self, mail: OutgoingMail) -> anyhow::Result<()> {
        match self {
            Mailer::Log => {
                tracing::info!(
                    to = %mail.to,
                    subject = %mail.subject,
                    body = %mail.body,
                    "（日志模式）信未真发出，内容如下"
                );
                Ok(())
            }
            Mailer::Capture(buf) => {
                buf.lock().expect("capture buffer poisoned").push(mail);
                Ok(())
            }
            Mailer::Smtp(smtp) => {
                let email = Message::builder()
                    .from(smtp.from.clone())
                    .to(mail
                        .to
                        .parse::<Mailbox>()
                        .map_err(|e| anyhow::anyhow!("收件人地址不合法 {}: {e}", mail.to))?)
                    .subject(mail.subject)
                    .body(mail.body)?;
                smtp.transport.send(email).await?;
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_log_not_smtp() {
        // 默认后端必须是「不发信」——测试/开发环境没配 SMTP，
        // 默认真发信的话，跑一遍测试就可能往真实邮箱发信。
        assert!(matches!(Mailer::default(), Mailer::Log));
    }

    #[tokio::test]
    async fn capture_accumulates_and_take_clears() {
        let (mailer, handle) = Mailer::capture();
        mailer
            .send(OutgoingMail {
                to: "a@example.com".into(),
                subject: "第一封".into(),
                body: "1".into(),
            })
            .await
            .unwrap();
        mailer
            .send(OutgoingMail {
                to: "b@example.com".into(),
                subject: "第二封".into(),
                body: "2".into(),
            })
            .await
            .unwrap();

        let mails = handle.take();
        assert_eq!(mails.len(), 2);
        assert_eq!(mails[0].subject, "第一封");
        assert!(handle.take().is_empty(), "take 之后应清空");
    }
}
