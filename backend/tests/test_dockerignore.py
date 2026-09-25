"""无需 Docker 或第三方依赖的构建上下文回归检查。

Run from the repository root: python3 backend/tests/test_dockerignore.py
Also collected by the normal backend pytest suite.
"""

from __future__ import annotations

import posixpath
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class DockerIgnore:
    """检查本仓库使用的 Dockerignore 语法子集。

    Unlike gitignore, plain patterns are relative to the context root. Support
    comments, whitespace/path cleaning, negation (last match wins), literal
    paths, segment-local * / ? and a leading **/ (zero or more directories).
    Matching a directory also matches its descendants. Reject other syntax
    rather than silently approximating Docker's Go filepath matching rules.
    See https://docs.docker.com/build/building/context/#dockerignore-files
    """

    def __init__(self, contents: str) -> None:
        self.rules: list[tuple[bool, re.Pattern[str]]] = []
        for line in contents.lstrip("\ufeff").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            pattern = line.strip()
            exclude = not pattern.startswith("!")
            if not exclude:
                pattern = pattern[1:].strip()
            if not pattern:
                raise ValueError("Empty negation in .dockerignore")
            pattern = posixpath.normpath(pattern).strip("/")
            if pattern == ".":
                continue
            recursive = pattern.startswith("**/")
            if recursive:
                pattern = pattern[3:]
            if "**" in pattern or any(char in pattern for char in "[]\\"):
                raise ValueError(f"Unsupported .dockerignore pattern: {line!r}")
            expression = re.escape(pattern).replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
            if recursive:
                expression = "(?:[^/]+/)*" + expression
            self.rules.append((exclude, re.compile(expression)))

    def excludes(self, path: str) -> bool:
        """按规则顺序匹配路径及其父目录。"""
        parts = path.strip("/").split("/")
        candidates = ["/".join(parts[:end]) for end in range(1, len(parts) + 1)]
        excluded = False
        for exclude, pattern in self.rules:
            if any(pattern.fullmatch(candidate) for candidate in candidates):
                excluded = exclude
        return excluded


class DockerIgnoreTests(unittest.TestCase):
    """覆盖 Docker 语义、敏感文件及必要构建输入。"""

    def test_matching_semantics(self) -> None:
        """防止误用 Git 语义或让单星号跨目录匹配。"""
        cases = [
            ("# comment\n\n.\n /cache/ \n", "cache/item", True),
            ("cache", "nested/cache/item", False),
            ("*.log", "nested/app.log", False),
            ("*/cache", "one/cache/item", True),
            ("*/cache", "one/two/cache/item", False),
            ("**/cache", "cache", True),
            ("**/cache", "one/two/cache/item", True),
            ("**/cache", "one/cacheable/item", False),
            ("**/file?.log", "nested/file1.log", True),
            ("**/file?.log", "nested/file12.log", False),
            ("**/.env*\n!**/.env.example", ".env", True),
            ("**/.env*\n!**/.env.example", ".env.example", False),
            ("**/.env*\n!**/.env.example", "one/two/.env.example", False),
            ("**/.env*\n!**/.env.example", "one/two/.env.example.local", True),
            ("!**/.env.example\n**/.env*", "one/.env.example", True),
            ("**/.env*\n!**/.env.example\n**/.git", ".git/.env.example", True),
            ("foo/../cache/", "cache/item", True),
        ]
        for contents, path, expected in cases:
            with self.subTest(contents=contents, path=path):
                self.assertEqual(DockerIgnore(contents).excludes(path), expected)

    def test_unsupported_syntax_fails_loudly(self) -> None:
        """新增不支持的模式时必须扩展检查器。"""
        for pattern in ("!", "**/file[0-9]", "foo/**/bar", r"escaped\*"):
            with self.subTest(pattern=pattern), self.assertRaises(ValueError):
                DockerIgnore(pattern)

    def test_secrets_and_host_artifacts_are_excluded(self) -> None:
        """在根目录及多级子目录验证真实风险路径，无需创建秘密文件。"""
        ignore = DockerIgnore((ROOT / ".dockerignore").read_text())
        artifacts = (
            ".git", ".git/config", ".git/.env.example",
            ".env", ".env.local", ".env.production", ".env.production.local",
            ".envrc", ".env.example.bak", ".env.example.local",
            ".venv/bin/python", "venv/lib/site.py", "env/bin/python", "ENV/bin/python",
            "__pypackages__/lib/site.py", "node_modules/react/index.js",
            "node_modules/pkg/.env.example", "dist/assets/app.js", "dist-ssr/server.js",
            "build/lib/app.py",
            "package.egg-info/PKG-INFO", "package.egg", "tsconfig.tsbuildinfo",
            "__pycache__/main.pyc", "module.pyc", "module.pyo", "module.pyd",
            ".cache/tool/item", ".pytest_cache/v/cache/nodeids", ".mypy_cache/meta.json",
            ".ruff_cache/item", ".hypothesis/examples/item", ".tox/py/bin/python",
            ".nox/tests/bin/python", ".npm/_cacache/item", ".vite/deps/react.js",
            ".parcel-cache/item", ".turbo/item", ".coverage", ".coverage.worker",
            "coverage/index.html", "coverage.xml", "htmlcov/index.html", "lcov.info",
            "test-results/result.json", "playwright-report/index.html",
            "logs/requests.json", ".logs/backend.out", "app.log", "app.log.1",
            "app.log.gz", "backend.pid", ".DS_Store", "._main.py", "Thumbs.db",
            "Desktop.ini", ".idea/workspace.xml", ".vscode/settings.json",
            ".superset/state.json", ".herdr/state.json", "main.py.swp", "main.py.swo",
            "main.py~",
        )
        databases = tuple(
            f"local{extension}{sidecar}"
            for extension in (".db", ".sqlite", ".sqlite3")
            for sidecar in ("", "-wal", "-shm", "-journal")
        )
        for prefix in ("", "backend/", "frontend/", "backend/nested/deeper/"):
            for artifact in artifacts + databases:
                path = prefix + artifact
                with self.subTest(path=path):
                    self.assertTrue(ignore.excludes(path), f"Leaked into build context: {path}")
            with self.subTest(example=prefix):
                self.assertFalse(ignore.excludes(prefix + ".env.example"))

    def test_required_build_inputs_are_included(self) -> None:
        """保留 Dockerfile COPY、前端资源以及部署依赖的配置文件。"""
        ignore = DockerIgnore((ROOT / ".dockerignore").read_text())
        required = (
            "Dockerfile", ".dockerignore", "docker-compose.yml", "deploy.sh",
            "deploy/nginx.conf", "backend/pyproject.toml", "backend/uv.lock",
            "backend/.env.example", "backend/app/main.py", "backend/app/config.py",
            "backend/app/db/database.py", "backend/app/db/schemas.py",
            "frontend/package.json", "frontend/package-lock.json", "frontend/index.html",
            "frontend/vite.config.ts", "frontend/tsconfig.json", "frontend/tsconfig.app.json",
            "frontend/tsconfig.node.json", "frontend/src/main.tsx", "frontend/src/App.tsx",
            "frontend/src/index.css", "frontend/public/favicon.svg",
            "frontend/src/assets/characters/char-1.webp", "frontend/src/assets/game-bg.jpg",
        )
        for path in required:
            with self.subTest(path=path):
                self.assertTrue((ROOT / path).is_file(), f"Missing build input: {path}")
                self.assertFalse(ignore.excludes(path), f"Excluded build input: {path}")
        # Synthetic near-misses catch accidentally broad wildcard exclusions.
        for path in ("backend/app/build_info.py", "frontend/src/environment.ts",
                     "backend/migrations/schema.sql", "frontend/public/database.svg"):
            with self.subTest(path=path):
                self.assertFalse(ignore.excludes(path))


if __name__ == "__main__":
    unittest.main()
