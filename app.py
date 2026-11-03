from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import shutil
import subprocess
import tempfile
from datetime import timedelta
from pathlib import Path

from flask import (
    Flask, jsonify, make_response, redirect,
    render_template, request, send_from_directory, session, url_for,
)
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = Path(__file__).resolve().parent
MAX_EXPORT_BYTES = 1_500 * 1024 * 1024  # 1.5 GB; browser exports are streamed to disk.

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_EXPORT_BYTES,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    TEMPLATES_AUTO_RELOAD=False,
)


def credentials() -> tuple[str, str]:
    """Read the only application credentials from the two Render variables."""
    name = os.environ.get("ADMIN_NAME", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "")
    return name, password


def configured() -> bool:
    name, password = credentials()
    return bool(name and password)


def ensure_secret_key() -> None:
    # No third secret variable is required. Rotating ADMIN_PASSWORD also rotates
    # the signing key and invalidates existing sessions.
    name, password = credentials()
    if name and password:
        material = f"{name}\u0000{password}".encode("utf-8")
        app.secret_key = hashlib.pbkdf2_hmac("sha256", material, b"PEA-STUDIO-SESSION-v1", 350_000, dklen=32)
    else:
        app.secret_key = secrets.token_bytes(32)


ensure_secret_key()


def is_authenticated() -> bool:
    return bool(session.get("pea_authenticated")) and configured()


def csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def csrf_ok() -> bool:
    supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    return bool(supplied and expected and hmac.compare_digest(supplied, expected))


def login_required_json():
    if not is_authenticated():
        return jsonify(ok=False, error="Your studio session has expired. Sign in again."), 401
    return None


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; "
        "style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
    if request.path in {"/", "/login", "/studio"} or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/healthz")
def healthz():
    return jsonify(ok=True, ffmpeg=bool(shutil.which("ffmpeg")))


@app.get("/login")
def login_page():
    if not configured():
        return render_template("setup_error.html"), 503
    if is_authenticated():
        return redirect(url_for("home"))
    return render_template("login.html", csrf=csrf_token())


@app.post("/login")
def login():
    if not configured():
        return jsonify(ok=False, error="Set ADMIN_NAME and ADMIN_PASSWORD in your hosting environment."), 503
    if not csrf_ok():
        return jsonify(ok=False, error="The sign-in page expired. Refresh and try again."), 400
    expected_name, expected_password = credentials()
    entered_name = request.form.get("admin_name", "").strip()
    entered_password = request.form.get("admin_password", "")
    valid = (
        hmac.compare_digest(entered_name.encode("utf-8"), expected_name.encode("utf-8"))
        and hmac.compare_digest(entered_password.encode("utf-8"), expected_password.encode("utf-8"))
    )
    if not valid:
        return jsonify(ok=False, error="Those credentials do not match this private studio."), 401
    session.clear()
    session.permanent = True
    session["pea_authenticated"] = True
    session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify(ok=True, next=url_for("home"))


@app.post("/logout")
def logout():
    if not csrf_ok():
        return jsonify(ok=False, error="Security check failed. Refresh the page and try again."), 400
    session.clear()
    return jsonify(ok=True, next=url_for("login_page"))


@app.get("/")
def home():
    if not configured():
        return render_template("setup_error.html"), 503
    if not is_authenticated():
        return redirect(url_for("login_page"))
    return render_template("studio.html", csrf=csrf_token())


@app.get("/studio")
def studio_alias():
    return home()


@app.get("/api/session")
def api_session():
    if not is_authenticated():
        return jsonify(ok=False, authenticated=False), 401
    return jsonify(ok=True, authenticated=True, csrf=csrf_token(), admin_name=credentials()[0])


@app.get("/api/status")
def api_status():
    rejected = login_required_json()
    if rejected:
        return rejected
    return jsonify(ok=True, ffmpeg=bool(shutil.which("ffmpeg")), max_upload_bytes=MAX_EXPORT_BYTES)


@app.post("/api/export/mp4")
def export_mp4():
    rejected = login_required_json()
    if rejected:
        return rejected
    if not csrf_ok():
        return jsonify(ok=False, error="Security check failed. Reload the studio and try again."), 400
    upload = request.files.get("video")
    if upload is None or not upload.filename:
        return jsonify(ok=False, error="No finished video was received."), 400
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return jsonify(ok=False, error="FFmpeg is not installed on this server. Use the Dockerfile deployment or install FFmpeg locally."), 503

    work_dir = Path(tempfile.mkdtemp(prefix="pea-export-"))
    source = work_dir / "source.webm"
    output = work_dir / "pea-advert.mp4"
    try:
        upload.save(source)
        if source.stat().st_size == 0:
            shutil.rmtree(work_dir, ignore_errors=True)
            return jsonify(ok=False, error="The uploaded video was empty."), 400
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source),
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", "-shortest", str(output),
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=1800, check=False)
        except subprocess.TimeoutExpired:
            shutil.rmtree(work_dir, ignore_errors=True)
            return jsonify(ok=False, error="This export exceeded the server's 30-minute safety limit. Try a shorter or lower-resolution version."), 504
        if result.returncode != 0 or not output.exists() or output.stat().st_size == 0:
            detail = (result.stderr or "FFmpeg could not encode this video.").strip()[-1200:]
            shutil.rmtree(work_dir, ignore_errors=True)
            return jsonify(ok=False, error=f"MP4 conversion failed: {detail}"), 422
        response = send_file(
            output, mimetype="video/mp4", as_attachment=True,
            download_name="pea-advert.mp4", max_age=0,
        )
        response.headers["Cache-Control"] = "no-store"
        response.call_on_close(lambda: shutil.rmtree(work_dir, ignore_errors=True))
        return response
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(BASE_DIR / "static", "manifest.webmanifest", mimetype="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    response = make_response(send_from_directory(BASE_DIR / "static", "sw.js", mimetype="application/javascript"))
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.errorhandler(413)
def too_large(_error):
    if request.path.startswith("/api/"):
        return jsonify(ok=False, error="This export is too large for the current server limit (1.5 GB). Try 720p or a shorter video."), 413
    return "Request too large", 413


if __name__ == "__main__":
    # Local development only. For deployment use the Procfile / Dockerfile.
    app.config["SESSION_COOKIE_SECURE"] = False
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
