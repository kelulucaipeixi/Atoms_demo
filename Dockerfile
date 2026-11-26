FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY server.py workspace_store.py discovery_store.py auth_store.py ./
COPY dist/ ./dist/
CMD ["python", "-u", "server.py"]
