"""Start Wayfinder on a deterministic, loopback-only project port."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_SEED_DIR = ROOT / ".local"
MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
DOCUMENT_ENV_VAR = "WAYFINDER_DOCUMENT"
RUNTIME_SEED_ENABLED_ENV_VAR = "WAYFINDER_RUNTIME_SEED_ENABLED"
RUNTIME_SEED_ID_ENV_VAR = "WAYFINDER_RUNTIME_SEED_ID"
RUNTIME_SEED_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
LEASE_OWNER_KEY = "ownerPid"
LEASE_IDENTITY_KEY = "ownerIdentity"
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
sys.path.insert(0, str(ROOT))

from portlib import PortError, resolve_port  # noqa: E402


class RuntimeSeedError(Exception):
    pass


def is_windows() -> bool:
    """Keep platform checks mockable without mutating Python's global os.name."""
    return os.name == "nt"


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    )]


class _JobBasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", ctypes.c_uint32),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", ctypes.c_uint32),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", ctypes.c_uint32),
        ("SchedulingClass", ctypes.c_uint32),
    ]


class _JobExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _JobBasicLimitInformation),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


def artifact_path(seed_id: str, *, candidate: bool = False) -> Path:
    if not RUNTIME_SEED_ID_PATTERN.fullmatch(seed_id):
        raise RuntimeSeedError("could not identify the local runtime seed artifact")
    suffix = ".candidate" if candidate else ""
    return RUNTIME_SEED_DIR / f"wayfinder-runtime-seed-{seed_id}{suffix}.json"


def lease_path(seed_id: str, *, candidate: bool = False) -> Path:
    if not RUNTIME_SEED_ID_PATTERN.fullmatch(seed_id):
        raise RuntimeSeedError("could not identify the local runtime seed artifact")
    suffix = ".lease.candidate.json" if candidate else ".lease.json"
    return RUNTIME_SEED_DIR / f"wayfinder-runtime-seed-{seed_id}{suffix}"


def process_is_live(pid: int) -> bool:
    """Check liveness without signalling another process; deny/unknown is live."""
    if pid <= 0:
        return True
    if is_windows():
        process_query_limited_information = 0x1000
        still_active = 259
        error_invalid_parameter = 87
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.GetExitCodeProcess.argtypes = (ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32))
        kernel32.GetExitCodeProcess.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        kernel32.CloseHandle.restype = ctypes.c_int
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            # Windows reports ERROR_INVALID_PARAMETER for a PID that does not
            # exist. Access-denied and other unknown failures remain fail-safe.
            return ctypes.get_last_error() != error_invalid_parameter
        try:
            exit_code = ctypes.c_uint32()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return True
            return exit_code.value == still_active
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return True
    return True


def process_creation_identity(pid: int) -> str | None:
    """Windows creation time prevents a reused PID preserving a stale seed."""
    if not is_windows():
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.GetProcessTimes.argtypes = (ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
    kernel32.GetProcessTimes.restype = ctypes.c_int
    kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
    kernel32.CloseHandle.restype = ctypes.c_int
    handle = kernel32.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    try:
        created = ctypes.c_ulonglong()
        exited = ctypes.c_ulonglong()
        kernel = ctypes.c_ulonglong()
        user = ctypes.c_ulonglong()
        if not kernel32.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        return str(created.value)
    finally:
        kernel32.CloseHandle(handle)


def establish_windows_job_containment() -> int | None:
    """Join this launcher to a kill-on-close job before seed files are created."""
    if not is_windows():
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p)
    kernel32.CreateJobObjectW.restype = ctypes.c_void_p
    kernel32.SetInformationJobObject.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32)
    kernel32.SetInformationJobObject.restype = ctypes.c_int
    kernel32.AssignProcessToJobObject.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
    kernel32.AssignProcessToJobObject.restype = ctypes.c_int
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
    kernel32.CloseHandle.restype = ctypes.c_int
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise RuntimeSeedError("could not establish Windows child containment")
    try:
        limits = _JobExtendedLimitInformation()
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel32.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise RuntimeSeedError("could not establish Windows child containment")
        if not kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess()):
            raise RuntimeSeedError("could not establish Windows child containment")
    except BaseException:
        kernel32.CloseHandle(job)
        raise
    # Keep this handle open. At launcher exit it closes and kills npm/Node descendants.
    return int(job)


def create_seed_lease(seed_id: str, owner_pid: int) -> None:
    RUNTIME_SEED_DIR.mkdir(parents=True, exist_ok=True)
    identity = process_creation_identity(owner_pid)
    if is_windows() and identity is None:
        raise RuntimeSeedError("could not identify the Windows runtime seed owner")
    try:
        with lease_path(seed_id).open("x", encoding="utf-8") as lease:
            json.dump({LEASE_OWNER_KEY: owner_pid, LEASE_IDENTITY_KEY: identity}, lease)
    except OSError as exc:
        raise RuntimeSeedError("could not reserve the local runtime seed") from exc


def cleanup_runtime_seed(seed_id: str) -> None:
    """Remove this launch's opaque artifacts only; launches never share state."""
    for candidate in (
        artifact_path(seed_id, candidate=True),
        artifact_path(seed_id),
        lease_path(seed_id, candidate=True),
        lease_path(seed_id),
    ):
        try:
            candidate.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise RuntimeSeedError("could not clear the previous runtime seed") from exc


def recover_stale_runtime_seeds() -> None:
    """Reclaim only exact artifacts whose well-formed lease owner is dead."""
    try:
        leases = list(RUNTIME_SEED_DIR.glob("wayfinder-runtime-seed-*.lease.json"))
    except FileNotFoundError:
        return
    except OSError as exc:
        raise RuntimeSeedError("could not inspect local runtime seed leases") from exc
    for lease in leases:
        match = re.fullmatch(r"wayfinder-runtime-seed-([A-Za-z0-9_-]{16,128})\.lease\.json", lease.name)
        if not match:
            continue
        try:
            payload = json.loads(lease.read_text(encoding="utf-8"))
            owner_pid = payload.get(LEASE_OWNER_KEY) if isinstance(payload, dict) else None
            owner_identity = payload.get(LEASE_IDENTITY_KEY) if isinstance(payload, dict) else None
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            # A malformed or unreadable lease is deliberately preserved.
            continue
        if not isinstance(owner_pid, int) or isinstance(owner_pid, bool):
            continue
        if process_is_live(owner_pid):
            if not is_windows():
                continue
            current_identity = process_creation_identity(owner_pid)
            # Access-denied or another transient lookup failure is unknown,
            # not proof that this live PID is a different process instance.
            if current_identity is None:
                continue
            if not isinstance(owner_identity, str) or current_identity != owner_identity:
                cleanup_runtime_seed(match.group(1))
            continue
        cleanup_runtime_seed(match.group(1))


def copy_bounded_document(source_path: Path, candidate_path: Path) -> None:
    RUNTIME_SEED_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with source_path.open("rb") as source, candidate_path.open("xb") as candidate:
            # Verify the exact opened handle, not the path before opening it.
            # This prevents a path swap between validation and the bounded copy.
            details = os.fstat(source.fileno())
            if not stat.S_ISREG(details.st_mode):
                raise RuntimeSeedError("the supplied path is not a regular file")
            if details.st_size > MAX_DOCUMENT_BYTES:
                raise RuntimeSeedError("the supplied document is larger than the 2 MiB limit")
            remaining = MAX_DOCUMENT_BYTES + 1
            while remaining:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                candidate.write(chunk)
                remaining -= len(chunk)
    except OSError as exc:
        raise RuntimeSeedError("the supplied document could not be copied safely") from exc

    if candidate_path.stat().st_size > MAX_DOCUMENT_BYTES:
        raise RuntimeSeedError("the supplied document is larger than the 2 MiB limit")


def validate_runtime_seed(candidate_path: Path) -> None:
    node = "node.exe" if is_windows() else "node"
    result = subprocess.run(
        [node, "scripts/validate-data.mjs", str(candidate_path)],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeSeedError("the supplied document is not a valid v4 Wayfinder document")
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeSeedError("the document validator did not return a usable result") from exc
    if (
        report.get("ok") is not True
        or report.get("schemaVersion") != 4
        or not isinstance(report.get("migrated"), bool)
    ):
        raise RuntimeSeedError("the supplied document is not a valid v4 Wayfinder document")
    if report["migrated"]:
        raise RuntimeSeedError("the supplied document must already use Wayfinder v4")


def prepare_runtime_seed(document_path: str | None) -> str | None:
    if not document_path:
        return None
    source_path = Path(document_path)
    seed_id = secrets.token_urlsafe(18)
    target_path = artifact_path(seed_id)
    candidate_path = artifact_path(seed_id, candidate=True)
    try:
        create_seed_lease(seed_id, os.getpid())
        copy_bounded_document(source_path, candidate_path)
        validate_runtime_seed(candidate_path)
        os.replace(candidate_path, target_path)
    except BaseException as exc:
        try:
            cleanup_runtime_seed(seed_id)
        except RuntimeSeedError:
            pass
        if isinstance(exc, RuntimeSeedError):
            raise
        if not isinstance(exc, OSError):
            raise
        raise RuntimeSeedError("could not prepare the local runtime seed") from exc
    return seed_id


def select_document_path(cli_document: str | None, environment: dict[str, str]) -> str | None:
    return cli_document if cli_document is not None else environment.get(DOCUMENT_ENV_VAR) or None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int)
    parser.add_argument("--document", metavar="PATH")
    args = parser.parse_args(argv)

    document_path = select_document_path(args.document, os.environ)
    runtime_seed_id: str | None = None
    job_handle: int | None = None
    if document_path and not is_windows():
        print(
            "Wayfinder runtime starter documents are available only on Windows. Use browser import instead.",
            file=sys.stderr,
        )
        return 2
    try:
        # Runtime starters and their PID leases are Windows-only. A Linux/WSL
        # process sharing this checkout must never interpret Windows PIDs in a
        # different process namespace and delete a live Windows launch's files.
        if is_windows():
            try:
                recover_stale_runtime_seeds()
            except RuntimeSeedError:
                print("Warning: Wayfinder could not inspect stale local runtime seeds; continuing without cleanup.", file=sys.stderr)
        if document_path:
            job_handle = establish_windows_job_containment()
        runtime_seed_id = prepare_runtime_seed(document_path)
    except RuntimeSeedError as exc:
        print(f"Wayfinder runtime seed rejected: {exc}.", file=sys.stderr)
        return 2

    try:
        try:
            port = resolve_port(
                "relocation-options-dashboard",
                explicit=args.port,
                env_var="WAYFINDER_PORT",
                default=8780,
                start=ROOT,
            )
        except PortError as exc:
            print(exc, file=sys.stderr)
            return 2

        npm = "npm.cmd" if is_windows() else "npm"
        env = os.environ.copy()
        if runtime_seed_id:
            env[RUNTIME_SEED_ENABLED_ENV_VAR] = "1"
            env[RUNTIME_SEED_ID_ENV_VAR] = runtime_seed_id
        else:
            env.pop(RUNTIME_SEED_ENABLED_ENV_VAR, None)
            env.pop(RUNTIME_SEED_ID_ENV_VAR, None)
        env.setdefault("WRANGLER_LOG_PATH", ".wrangler/wrangler.log")
        command = [npm, "run", "dev", "--", "--port", str(port)]
        print(f"Wayfinder: http://127.0.0.1:{port}")
        if runtime_seed_id:
            print(
                "Warning: this local instance sends its starter document to every browser that can reach it.",
                file=sys.stderr,
            )
        child = None
        try:
            child = subprocess.Popen(command, cwd=ROOT, env=env)
            return child.wait()
        except BaseException:
            if child is not None and runtime_seed_id:
                try:
                    child.terminate()
                except OSError:
                    pass
                try:
                    child.wait()
                except OSError:
                    pass
            raise
    finally:
        if runtime_seed_id:
            try:
                cleanup_runtime_seed(runtime_seed_id)
            except RuntimeSeedError:
                print("Wayfinder could not clear the local runtime seed after it stopped.", file=sys.stderr)
        # The launcher itself belongs to this Windows job. Deliberately retain
        # its handle until process exit, which closes the job and reaps children.
        _ = job_handle


if __name__ == "__main__":
    raise SystemExit(main())
