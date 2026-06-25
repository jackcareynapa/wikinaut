# Wikinaut backend — Flask + gunicorn API answering shortest-path queries over the Wikipedia
# link graph.
#
# The ~5GB SQLite graph is intentionally NOT baked into the image; it lives on a persistent volume
# mounted at /data (see fly.toml and docs/deployment.md). Running gunicorn with `--chdir /data`
# makes server.py's relative './sdow.sqlite' / './searches.sqlite' resolve onto that volume, while
# `--pythonpath /app` keeps the `sdow` package importable. We bind the bare Flask `app` (not
# `load_app("prod")`) so the container does not try to initialize Google Cloud logging, which would
# require GCP credentials.
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code and SQL schemas (the schemas are used to seed searches.sqlite on the volume).
COPY sdow/ ./sdow/
COPY sql/ ./sql/

EXPOSE 8080

# Serve the API. gunicorn runs from /data so server.py's relative './sdow.sqlite' /
# './searches.sqlite' resolve onto the mounted volume; --pythonpath /app keeps the `sdow`
# package importable. (To load/repair the volume, temporarily override with
# `fly machine update <id> -C "sleep infinity"`, then restore with `fly deploy`.)
CMD ["gunicorn", \
     "--chdir", "/data", \
     "--pythonpath", "/app", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "2", \
     "--timeout", "120", \
     "sdow.server:app"]