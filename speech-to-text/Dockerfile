FROM python:3.10-slim

# Install ffmpeg which is required for Whisper
RUN apt-get update && apt-get install -y ffmpeg

# Set the working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
# Fix for the pkg_resources error in newer setuptools versions:
# Pin setuptools to <70 and use --no-build-isolation
RUN pip install --no-cache-dir --upgrade pip "setuptools<70.0.0" wheel
RUN pip install --no-cache-dir --no-build-isolation -r requirements.txt

# Copy all project files into the container
COPY . .

# Run the FastAPI server on port 10000 (standard for Render)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]
