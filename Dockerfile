FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY cloud_tg.py render_p2p_agent.py ./
ENV PYTHONUNBUFFERED=1
CMD ["python3", "render_p2p_agent.py"]
