# -*- coding: utf-8 -*-
"""QQ 邮箱 SMTP 发信：注册 / 找回密码验证码邮件。

配置走 .env：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM。
env 在请求期读取（llm 模块导入时已 load_dotenv，但此处保持惰性读取不依赖导入顺序）。
"""
import os
import smtplib
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr

_SCENES = {
    "register": ("Lykie 注册验证码", "你正在注册 Lykie 账号"),
    "forgot": ("Lykie 找回密码验证码", "你正在重置 Lykie 账号密码"),
}


def smtp_ready():
    return bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASS"))


def send_code(email, code, scene="register"):
    """发送 6 位验证码。SMTP 未配置或发信失败都会抛异常，由调用方转成中文提示。"""
    subject, action = _SCENES.get(scene, _SCENES["register"])
    host = os.environ.get("SMTP_HOST", "smtp.qq.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    sender = os.environ.get("SMTP_FROM", "") or user

    body = "你的验证码是 %s，10 分钟内有效。%s，请勿转发给他人。" % (code, action)
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr(("Lykie", sender))
    msg["To"] = email

    server = smtplib.SMTP_SSL(host, port, timeout=10)
    try:
        server.login(user, password)
        server.sendmail(sender, [email], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass
