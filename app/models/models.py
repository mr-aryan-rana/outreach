from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database.core import Base

class Creator(Base):
    __tablename__ = "creators"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    platform = Column(String, index=True)
    profile_url = Column(String, unique=True, index=True)
    phone = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    emails = relationship("Email", back_populates="creator")

class Email(Base):
    __tablename__ = "emails"
    id = Column(Integer, primary_key=True, index=True)
    address = Column(String, unique=True, index=True)
    creator_id = Column(Integer, ForeignKey("creators.id"))
    is_valid = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    creator = relationship("Creator", back_populates="emails")
    validations = relationship("Validation", back_populates="email_rel")
    email_logs = relationship("EmailLog", back_populates="email_rel")

class Validation(Base):
    __tablename__ = "validations"
    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"))
    smtp_check = Column(Boolean, default=False)
    syntax_check = Column(Boolean, default=False)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    email_rel = relationship("Email", back_populates="validations")

class Campaign(Base):
    __tablename__ = "campaigns"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    subject_template = Column(String)
    body_template = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    email_logs = relationship("EmailLog", back_populates="campaign")

class EmailLog(Base):
    __tablename__ = "email_logs"
    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"))
    campaign_id = Column(Integer, ForeignKey("campaigns.id"))
    status = Column(String) # e.g. "sent", "failed", "pending"
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    email_rel = relationship("Email", back_populates="email_logs")
    campaign = relationship("Campaign", back_populates="email_logs")
