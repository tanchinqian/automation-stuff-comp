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

# Copy application source & model weights
COPY server/ server/
COPY scripts/ scripts/
COPY models/ models/
COPY cases/ cases/
COPY train_data/ train_data/
COPY pipeline_config.json* ./

# Copy compiled frontend from Stage 1 into /app/dist
COPY --from=frontend-builder /app/dist /app/dist

# Expose port 8000
EXPOSE 8000

# Set environment defaults
ENV PYTHONUNBUFFERED=1 \
    PORT=8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start FastAPI pipeline server (serves both API and UI)
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
