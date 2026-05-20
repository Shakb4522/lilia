FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .

# Simply upgrade pip and install the lightweight requirements
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Copy all project files into the container
COPY . .

# Run the FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]
