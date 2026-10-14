import os
import tempfile

# Tests run against a throwaway database and data folder, never the real one.
_tmp = tempfile.mkdtemp(prefix="kold-test-")
os.environ["KOLD_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db".replace("\\", "/")
os.environ["KOLD_DATA_DIR"] = _tmp
os.environ["KOLD_OLLAMA_URL"] = "http://127.0.0.1:9"  # unreachable: deterministic template fallbacks
