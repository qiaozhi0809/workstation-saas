"""app.ai 包的对外边界:其他模块只能导入它的公开名字,不跨模块拿下划线开头的私有函数(L18)。"""

import ast
import subprocess
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent / "app"


def _private_imports_from_app_ai() -> list[str]:
    found = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.module:
                continue
            if node.module != "app.ai" and not node.module.startswith("app.ai."):
                continue
            for alias in node.names:
                if alias.name.startswith("_"):
                    rel = path.relative_to(APP.parent)
                    found.append(f"{rel}:{node.lineno} {node.module}.{alias.name}")
    return found


def test_no_private_names_imported_from_app_ai():
    assert _private_imports_from_app_ai() == []


def test_subjects_module_has_no_function_level_imports():
    """L227 ①:``catalog_subjects`` 曾在函数体里导入 ``get_catalog`` 以绕开与
    school_settings.service 的循环;循环已靠叶子类型下沉到 exams.schemas 打断,
    函数内不再有 import。"""
    path = APP / "domain" / "exams" / "subjects.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    nested = [
        f"{path.relative_to(APP.parent)}:{node.lineno}"
        for func in ast.walk(tree)
        if isinstance(func, ast.FunctionDef | ast.AsyncFunctionDef)
        for node in ast.walk(func)
        if isinstance(node, ast.Import | ast.ImportFrom)
    ]
    assert nested == []


@pytest.mark.parametrize(
    "module", ["app.domain.exams.subjects", "app.domain.school_settings.service"]
)
def test_either_module_imports_first_without_cycle(module):
    """无论先导入哪一侧都不能 ImportError(新解释器,排除测试进程里已缓存的模块)。"""
    subprocess.run(
        [sys.executable, "-c", f"import {module}"], check=True, cwd=APP.parent, timeout=60
    )
