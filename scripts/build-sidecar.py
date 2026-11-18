#!/usr/bin/env python3
"""Build the lv24-seo PyInstaller onedir sidecar for the desktop.

This is a high-level, runnable build helper. It uses ``uv`` to create an isolated
environment with the pinned engine and PyInstaller, then produces::

    <out>/lv24-seo/
      lv24-seo[.exe]
      _internal/
        lv24_seo/store/schema.sql
        lv24_seo_skills/...

The Tauri bundle maps ``<out>/lv24-seo/`` to the app's ``engine/lv24-seo/`` resource
directory. PyInstaller does not cross-compile: run this on the target OS/arch.
No build is performed by the contract/CI scaffold itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIN_PATH = ROOT / "scripts" / "cli-checksums.json"
DEFAULT_NAME = "lv24-seo"


def _read_pin() -> dict[str, Any]:
    if not PIN_PATH.is_file():
        raise SystemExit(f"missing pin file: {PIN_PATH}")
    try:
        data = json.loads(PIN_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid pin file {PIN_PATH}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"pin file must contain an object: {PIN_PATH}")
    return data


def _host_target() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows" and machine in {"amd64", "x86_64"}:
        return "x86_64-pc-windows-msvc"
    if system == "Linux" and machine in {"amd64", "x86_64"}:
        return "x86_64-unknown-linux-gnu"
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        return "aarch64-apple-darwin"
    if system == "Darwin" and machine in {"x86_64", "amd64"}:
        return "x86_64-apple-darwin"
    raise SystemExit(f"unsupported host for PyInstaller: {system} {machine}")


def _exe_name(name: str) -> str:
    return f"{name}.exe" if platform.system() == "Windows" else name


def _run(
    command: list[str],
    *,
    env: dict[str, str],
    cwd: Path = ROOT,
    capture: bool = False,
    dry_run: bool = False,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str] | None:
    print("+ " + " ".join(command), flush=True)
    if dry_run:
        return None
    try:
        return subprocess.run(
            command,
            cwd=str(cwd),
            env=env,
            check=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=capture,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise SystemExit(f"command not found: {command[0]} ({exc})") from exc
    except subprocess.CalledProcessError as exc:
        if capture and exc.stdout:
            print(exc.stdout, file=sys.stderr)
        if capture and exc.stderr:
            print(exc.stderr, file=sys.stderr)
        raise SystemExit(f"command failed with exit {exc.returncode}: {' '.join(command)}") from exc


def _probe_skills(
    uv: str,
    python: str,
    engine_spec: str,
    with_specs: list[str],
    env: dict[str, str],
    dry_run: bool,
) -> Path:
    if dry_run:
        return Path("<skills-path>")
    code = (
        "from importlib.metadata import distribution\n"
        "d = distribution('lv24-seo')\n"
        "print(d.locate_file('lv24_seo_skills'))\n"
    )
    command = [uv, "run", "--refresh-package", "lv24-seo", "--python", python, "--with", engine_spec]
    for spec in with_specs:
        command.extend(["--with", spec])
    command.extend(["python", "-c", code])
    result = _run(
        command,
        env=env,
        capture=True,
        timeout=300,
    )
    assert result is not None
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        raise SystemExit("could not locate the packaged lv24_seo_skills directory")
    path = Path(lines[-1])
    if not path.is_dir():
        raise SystemExit(f"packaged skills directory not found: {path}")
    return path


def _smoke(exe: Path, expected_version: str, env: dict[str, str], dry_run: bool) -> None:
    if dry_run:
        print(f"+ {exe} version --json  # smoke")
        return
    result = _run([str(exe), "version", "--json"], env=env, capture=True, timeout=120)
    assert result is not None
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        raise SystemExit("sidecar version smoke test produced no output")
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise SystemExit(f"sidecar version smoke test is not JSON: {exc}") from exc
    version = payload.get("data", {}).get("version") if isinstance(payload, dict) else None
    if payload.get("ok") is not True or version != expected_version:
        raise SystemExit(
            f"sidecar version smoke test failed: expected {expected_version!r}, got {version!r}"
        )
    print(f"sidecar smoke test passed: lv24-seo {version}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine-version", default=None, help="pinned lv24-seo version")
    parser.add_argument("--target", default=None, help="Rust target triple (host-only build)")
    parser.add_argument("--out", default="src-tauri/engine", help="output parent directory")
    parser.add_argument("--python", default=None, help="Python version for uv (default: pin)")
    parser.add_argument("--pyinstaller", default=None, help="PyInstaller version (default: pin)")
    parser.add_argument("--uv", default="uv", help="uv executable")
    parser.add_argument("--name", default=DEFAULT_NAME, help="sidecar executable name")
    parser.add_argument("--no-clean", action="store_true", help="keep PyInstaller cache")
    parser.add_argument("--skip-smoke", action="store_true", help="skip version smoke test")
    parser.add_argument("--keep-work", action="store_true", help="keep the PyInstaller work directory")
    parser.add_argument("--dry-run", action="store_true", help="print commands without building")
    args = parser.parse_args(argv)

    pin = _read_pin()
    pinned_version = str(pin.get("version") or "")
    if not pinned_version:
        raise SystemExit(f"missing version in {PIN_PATH}")
    engine_version = args.engine_version or pinned_version
    if engine_version != pinned_version:
        raise SystemExit(
            f"engine {engine_version} is not the pinned {pinned_version}; "
            "update scripts/cli-checksums.json deliberately instead of overriding it here"
        )

    python = args.python or str(pin.get("python") or "3.12")
    pyinstaller = args.pyinstaller or str(pin.get("pyinstaller") or "")
    if not pyinstaller:
        raise SystemExit(f"missing pyinstaller pin in {PIN_PATH}")
    if args.python and args.python != pin.get("python"):
        raise SystemExit("--python differs from the pin; update the pin instead")
    if args.pyinstaller and args.pyinstaller != pin.get("pyinstaller"):
        raise SystemExit("--pyinstaller differs from the pin; update the pin instead")

    target = args.target or _host_target()
    targets = pin.get("targets")
    if not isinstance(targets, dict) or target not in targets:
        raise SystemExit(
            f"target {target!r} is not in the pin; known: {', '.join(sorted(targets or {}))}"
        )
    host = _host_target()
    if target != host:
        raise SystemExit(
            f"PyInstaller does not cross-compile: host is {host}, requested {target}. "
            "Run this script on the matching runner."
        )

    uv = shutil.which(args.uv)
    if not uv:
        raise SystemExit(
            f"uv not found ({args.uv}). Install it from https://docs.astral.sh/uv/ and retry."
        )

    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out = out.resolve()
    app_dir = out / args.name
    if app_dir.parent != out:
        raise SystemExit("refusing to write outside the output directory")
    if app_dir.exists() and not args.dry_run:
        shutil.rmtree(app_dir)
    out.mkdir(parents=True, exist_ok=True)

    env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
        "UV_NO_PROGRESS": "1",
        "LV24_SEO_ALLOW_FILE_SECRETS": "0",
    }
    engine_spec = f"lv24-seo[secrets]=={engine_version}"
    pyinstaller_spec = f"pyinstaller=={pyinstaller}"
    with_specs: list[str] = []
    for name in ("pydantic", "typer"):
        value = pin.get(name)
        if isinstance(value, str) and value:
            with_specs.append(f"{name}=={value}")

    work_root = Path(tempfile.mkdtemp(prefix="lv24-seo-sidecar-"))
    try:
        entry = work_root / "sidecar_entry.py"
        entry.write_text(
            "from lv24_seo.cli.main import app\n\nif __name__ == '__main__':\n    app()\n",
            encoding="utf-8",
        )
        workpath = work_root / "pyinstaller"
        specpath = work_root / "spec"
        workpath.mkdir()
        specpath.mkdir()

        skills = _probe_skills(uv, python, engine_spec, with_specs, env, args.dry_run)
        add_data_separator = os.pathsep
        command = [
            uv,
            "run",
            "--refresh-package",
            "lv24-seo",
            "--python",
            python,
            "--with",
            engine_spec,
            *[part for spec in with_specs for part in ("--with", spec)],
            "--with",
            pyinstaller_spec,
            "python",
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--onedir",
            "--console",
            "--noupx",
            "--name",
            args.name,
            "--distpath",
            str(out),
            "--workpath",
            str(workpath),
            "--specpath",
            str(specpath),
            "--log-level",
            "INFO",
            "--collect-submodules",
            "keyring.backends",
            "--collect-submodules",
            "lv24_seo.crawl.rules",
            "--hidden-import",
            "mcp.server.fastmcp",
            "--hidden-import",
            "mcp.server.mcpserver",
            "--collect-data",
            "lv24_seo",
            "--add-data",
            f"{skills}{add_data_separator}lv24_seo_skills",
            str(entry),
        ]
        if not args.no_clean:
            command.insert(command.index("--noconfirm") + 1, "--clean")

        _run(command, env=env, timeout=1800, dry_run=args.dry_run)

        exe = app_dir / _exe_name(args.name)
        if not args.dry_run:
            if not exe.is_file():
                raise SystemExit(f"PyInstaller did not produce {exe}")
            schema = app_dir / "_internal" / "lv24_seo" / "store" / "schema.sql"
            if not schema.is_file():
                schema = app_dir / "lv24_seo" / "store" / "schema.sql"
            if not schema.is_file():
                raise SystemExit(
                    "schema.sql was not collected; check --collect-data lv24_seo and the engine wheel"
                )
            skills_out = app_dir / "_internal" / "lv24_seo_skills"
            if not skills_out.is_dir():
                skills_out = app_dir / "lv24_seo_skills"
            if not skills_out.is_dir():
                raise SystemExit("packaged skills were not collected; check --add-data")

        if not args.skip_smoke:
            _smoke(exe, engine_version, env, args.dry_run)

        if not args.dry_run:
            info = {
                "schemaVersion": 1,
                "engine": "lv24-seo",
                "version": engine_version,
                "target": target,
                "python": python,
                "pyinstaller": pyinstaller,
                "builtAt": datetime.now(timezone.utc).isoformat(),
                "executable": str(exe.relative_to(out)).replace("\\", "/"),
                "sha256": _sha256(exe),
                "size": exe.stat().st_size,
            }
            (out / "build-info.json").write_text(
                json.dumps(info, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            print(f"built {exe}")
            print(f"wrote {out / 'build-info.json'}")
            print(
                "next: node scripts/verify-sidecar.mjs "
                f"--root {out} --target {target} --engine-version {engine_version}"
            )
        else:
            print("dry run: no sidecar was built")
    finally:
        if args.keep_work:
            print(f"work directory kept: {work_root}")
        else:
            shutil.rmtree(work_root, ignore_errors=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
