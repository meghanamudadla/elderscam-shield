# Scam Shield backend image.
# Build:  docker build -t scam-shield-backend ./backend
# The GROQ_API_KEY secret is injected at runtime via the environment, never baked in.

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# No --reload in production; bind 0.0.0.0 so the container is reachable.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]