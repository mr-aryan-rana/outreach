import smtplib
from email.message import EmailMessage
from app.utils.config import settings


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
    except Exception as e:
        return False, str(e)

def send_mass_emails(to_addresses: list[str], subject: str, body: str) -> tuple[bool, str]:
    if not to_addresses:
        return False, "No addresses provided"
        
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
            server.starttls()
            server.login(settings.GMAIL_USER, settings.GMAIL_APP_PASSWORD)
            
            for address in to_addresses:
                msg = EmailMessage()
                msg.set_content(body)
                msg['Subject'] = subject
                msg['From'] = settings.GMAIL_USER
                msg['To'] = address
                try:
                    server.send_message(msg)
                except Exception as inner_e:
                    print(f"Failed to send to {address}: {inner_e}")
                    
        return True, "Bulk send complete"
    except Exception as e:
        return False, str(e)
