# ==============================================================================
# Stage 1: Build the static frontend UI with Node
# ==============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Cache package installation
COPY package*.json ./
RUN npm ci

# Copy source and build static bundle (outputs to /app/dist)
COPY . .
RUN npm run build

# ==============================================================================
# Stage 2: Python runtime for FastAPI pipeline and YOLO / ONNX models
# ==============================================================================
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install system dependencies required by OpenCV & Ultralytics
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU wheels first to avoid 3GB+ CUDA dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Copy and install python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create runtime directories for persistent cases and uploads
RUN mkdir -p /app/cases /app/train_data/JPEGImages /app/train_data/Annotations /app/server/_uploads

# Copy application source & model weights (tracked in Git)
COPY server/ server/
COPY scripts/ scripts/
COPY models/ models/
COPY public/ public/
COPY pipeline_config.json* ./

# Copy compiled frontend from Stage 1 into /app/dist
COPY --from=frontend-builder /app/dist /app/dist

# Expose port 8000 (local) and 7860 (Hugging Face Spaces)
EXPOSE 8000 7860

# Set environment defaults
ENV PYTHONUNBUFFERED=1 \
    PORT=8000

# Set up non-root user for cloud security (Hugging Face Spaces compatibility)
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start FastAPI pipeline server (dynamically binds to $PORT)
CMD ["sh", "-c", "uvicorn server.app:app --host 0.0.0.0 --port ${PORT}"]
