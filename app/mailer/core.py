import smtplib
from email.message import EmailMessage
from app.utils.config import settings
from app.logger import logger

# send_mass_emails() used to live here -- a bulk-send helper with zero delay
# between messages in one SMTP session, bypassing every rate limit this app
# enforces elsewhere (EMAIL_SEND_DELAY_MIN/MAX_SEC, the Redis daily-quota
# reservation in sender.py). It had no caller anywhere in app/ -- the only
# reference was an unwired root-level experiment script -- so it was removed
# rather than fixed. sender.send_campaign()/send_single() are the only real
# send paths and already go through the app's rate limiting correctly.


def send_email(to_address: str, subject: str, body: str) -> tuple[bool, str]:
    msg = EmailMessage()
    msg.set_content(body)
    msg['Subject'] = subject
    msg['From'] = settings.GMAIL_USER
    msg['To'] = to_address

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
            server.starttls()
            server.login(settings.GMAIL_USER, settings.GMAIL_APP_PASSWORD)
            server.send_message(msg)
        return True, "sent"
    except smtplib.SMTPAuthenticationError as e:
        # Wrong/revoked app password -- every subsequent send will fail the
        # same way until this is fixed, so this is worth its own log level
        # distinct from a one-off transient failure.
        logger.error(f"mailer: SMTP authentication failed (check GMAIL_APP_PASSWORD): {e}")
        return False, f"auth failed: {e}"
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as e:
        # Rejected address, not an infrastructure problem -- expected to
        # happen occasionally and shouldn't be logged as an error.
        return False, f"recipient rejected: {e}"
    except smtplib.SMTPResponseException as e:
        # Covers Gmail-side throttling/quota responses (e.g. 421/450/550
        # rate-limit codes) distinctly from a plain connection failure, so
        # this is identifiable in logs if Gmail starts throttling the account.
        logger.warning(f"mailer: SMTP server rejected the message (code {e.smtp_code}): {e.smtp_error}")
        return False, f"smtp error {e.smtp_code}: {e.smtp_error}"
    except (smtplib.SMTPException, OSError) as e:
        # Connection/timeout/protocol-level failures -- transient, safe to retry.
        logger.warning(f"mailer: send failed (transient): {e}")
        return False, str(e)
