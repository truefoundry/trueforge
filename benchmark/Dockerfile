# Runs the core arms (TrueForge + CMA) and the judge/aggregate pipeline.
# The deepagents arm has conflicting deps — run it in a separate venv/image
# (see README). Config comes from a mounted .env and mcp_config.json.
FROM python:3.11-slim

WORKDIR /bench
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Full pipeline: set up agents, run the matrix, grade, aggregate.
# Override HARNESSES in the env to run a subset.
CMD ["bash", "-lc", "python setup.py && python bench_matrix.py run-all && python judge.py && python aggregate.py"]
