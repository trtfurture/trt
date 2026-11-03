import os
import shutil
import sys

from app import app

if __name__ == "__main__":
    if not os.environ.get("ADMIN_NAME") or not os.environ.get("ADMIN_PASSWORD"):
        print("Set ADMIN_NAME and ADMIN_PASSWORD before starting PEA Studio.")
        sys.exit(2)
    if not shutil.which("ffmpeg"):
        print("NOTICE: FFmpeg was not found. Editing still works; MP4 export will need FFmpeg.")
    app.config["SESSION_COOKIE_SECURE"] = False  # localhost only
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
