import importlib.util
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock


DEV_PATH = Path(__file__).resolve().parent.parent / "scripts" / "dev.py"
SPEC = importlib.util.spec_from_file_location("wayfinder_dev", DEV_PATH)
assert SPEC and SPEC.loader
dev = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = dev
SPEC.loader.exec_module(dev)


class TestRuntimeSeedLauncher(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.seed_dir = root / "seed-artifacts"
        self.paths = mock.patch.multiple(
            dev,
            RUNTIME_SEED_DIR=self.seed_dir,
        )
        self.paths.start()
        self.addCleanup(self.paths.stop)
        self.containment = mock.patch.object(dev, "establish_windows_job_containment", return_value=None)
        self.containment.start()
        self.addCleanup(self.containment.stop)
        self.example = Path(__file__).resolve().parent.parent / "examples" / "wayfinder.example.json"

    @staticmethod
    def child(return_code=0, pid=4242):
        return mock.Mock(pid=pid, wait=mock.Mock(return_value=return_code))

    def test_exact_validated_copy_is_promoted_to_the_ignored_runtime_artifact(self):
        seed_id = dev.prepare_runtime_seed(str(self.example))
        self.assertIsInstance(seed_id, str)
        self.assertEqual(dev.artifact_path(seed_id).read_bytes(), self.example.read_bytes())
        self.assertFalse(dev.artifact_path(seed_id, candidate=True).exists())

    def test_runtime_seed_directory_uses_per_user_local_app_data_not_the_checkout(self):
        expected = Path(self.tmp.name) / "Wayfinder" / "runtime-seeds"
        self.assertEqual(
            dev.default_runtime_seed_dir({"LOCALAPPDATA": self.tmp.name}),
            expected,
        )
        self.assertFalse(expected.is_relative_to(dev.ROOT))
        self.assertIsNone(dev.default_runtime_seed_dir({"LOCALAPPDATA": "relative"}))
        self.assertIsNone(dev.default_runtime_seed_dir({}))

    def test_unseeded_launch_does_not_delete_an_active_seed_artifact(self):
        self.seed_dir.mkdir()
        stale_id = "a" * 24
        dev.artifact_path(stale_id).write_text("stale", encoding="utf-8")
        dev.lease_path(stale_id).write_text(
            json.dumps({dev.LEASE_OWNER_KEY: dev.os.getpid(), dev.LEASE_IDENTITY_KEY: "live"}),
            encoding="utf-8",
        )

        with mock.patch.object(dev, "process_creation_identity", return_value="live"), mock.patch.object(dev.subprocess, "Popen", return_value=self.child()):
            self.assertEqual(dev.main(["--port", "8780"]), 0)
        self.assertTrue(dev.artifact_path(stale_id).exists())
        self.assertTrue(dev.lease_path(stale_id).exists())

    def test_concurrent_seed_artifacts_have_exact_owner_cleanup(self):
        first_id = dev.prepare_runtime_seed(str(self.example))
        second_id = dev.prepare_runtime_seed(str(self.example))
        self.assertNotEqual(first_id, second_id)

        dev.cleanup_runtime_seed(first_id)
        self.assertFalse(dev.artifact_path(first_id).exists())
        self.assertTrue(dev.artifact_path(second_id).exists())

    def test_recovery_preserves_a_live_concurrent_owner(self):
        self.seed_dir.mkdir()
        seed_id = "c" * 24
        dev.artifact_path(seed_id).write_text("live", encoding="utf-8")
        dev.lease_path(seed_id).write_text(json.dumps({dev.LEASE_OWNER_KEY: 123, dev.LEASE_IDENTITY_KEY: "live"}), encoding="utf-8")

        with mock.patch.object(dev, "process_is_live", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="live"):
            dev.recover_stale_runtime_seeds()
        self.assertTrue(dev.artifact_path(seed_id).exists())
        self.assertTrue(dev.lease_path(seed_id).exists())

    def test_recovery_removes_only_a_dead_owner_exact_artifacts(self):
        self.seed_dir.mkdir()
        seed_id = "d" * 24
        dev.artifact_path(seed_id).write_text("dead", encoding="utf-8")
        dev.artifact_path(seed_id, candidate=True).write_text("dead candidate", encoding="utf-8")
        dev.lease_path(seed_id).write_text(json.dumps({dev.LEASE_OWNER_KEY: 456, dev.LEASE_IDENTITY_KEY: None}), encoding="utf-8")

        with mock.patch.object(dev, "process_is_live", return_value=False):
            dev.recover_stale_runtime_seeds()
        self.assertFalse(dev.artifact_path(seed_id).exists())
        self.assertFalse(dev.artifact_path(seed_id, candidate=True).exists())
        self.assertFalse(dev.lease_path(seed_id).exists())

    def test_recovery_preserves_an_invalid_lease_fail_safe(self):
        self.seed_dir.mkdir()
        seed_id = "e" * 24
        dev.artifact_path(seed_id).write_text("unknown", encoding="utf-8")
        dev.lease_path(seed_id).write_text("not json", encoding="utf-8")

        dev.recover_stale_runtime_seeds()
        self.assertTrue(dev.artifact_path(seed_id).exists())
        self.assertTrue(dev.lease_path(seed_id).exists())

    def test_windows_pid_reuse_reclaims_the_stale_artifact(self):
        self.seed_dir.mkdir()
        seed_id = "f" * 24
        dev.artifact_path(seed_id).write_text("stale", encoding="utf-8")
        dev.lease_path(seed_id).write_text(
            json.dumps({dev.LEASE_OWNER_KEY: 789, dev.LEASE_IDENTITY_KEY: "old"}),
            encoding="utf-8",
        )
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_is_live", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="new"):
            dev.recover_stale_runtime_seeds()
        self.assertFalse(dev.artifact_path(seed_id).exists())
        self.assertFalse(dev.lease_path(seed_id).exists())

    def test_windows_unknown_creation_identity_preserves_a_live_owner_fail_safe(self):
        self.seed_dir.mkdir()
        seed_id = "g" * 24
        dev.artifact_path(seed_id).write_text("live or protected", encoding="utf-8")
        dev.lease_path(seed_id).write_text(
            json.dumps({dev.LEASE_OWNER_KEY: 790, dev.LEASE_IDENTITY_KEY: "known-at-creation"}),
            encoding="utf-8",
        )
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_is_live", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value=None):
            dev.recover_stale_runtime_seeds()
        self.assertTrue(dev.artifact_path(seed_id).exists())
        self.assertTrue(dev.lease_path(seed_id).exists())

    def test_seeded_start_fails_before_artifact_creation_without_containment(self):
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "establish_windows_job_containment", side_effect=dev.RuntimeSeedError("containment unavailable")):
            self.assertEqual(dev.main(["--document", str(self.example), "--port", "8780"]), 2)
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*")), [])

    def test_seeded_start_fails_closed_without_a_runtime_seed_directory(self):
        with mock.patch.object(dev, "RUNTIME_SEED_DIR", None), mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev.subprocess, "Popen") as launch:
            self.assertEqual(dev.main(["--document", str(self.example), "--port", "8780"]), 2)
        launch.assert_not_called()

    def test_non_windows_seed_fails_closed_before_artifact_creation(self):
        with mock.patch.object(dev, "is_windows", return_value=False), mock.patch.object(dev, "prepare_runtime_seed") as prepare, mock.patch("sys.stderr") as stderr:
            self.assertEqual(dev.main(["--document", str(self.example), "--port", "8780"]), 2)
        prepare.assert_not_called()
        message = "".join(str(call.args[0]) for call in stderr.write.call_args_list)
        self.assertIn("only on Windows", message)
        self.assertNotIn(str(self.example), message)
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*")), [])

    def test_non_windows_unseeded_launch_never_interprets_windows_pid_leases(self):
        with mock.patch.object(dev, "is_windows", return_value=False), mock.patch.object(dev, "recover_stale_runtime_seeds") as recover, mock.patch.object(dev.subprocess, "Popen", return_value=self.child()):
            self.assertEqual(dev.main(["--port", "8780"]), 0)
        recover.assert_not_called()

    def test_stale_recovery_error_warns_without_blocking_an_ordinary_launch(self):
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "recover_stale_runtime_seeds", side_effect=dev.RuntimeSeedError("unavailable")), mock.patch.object(dev.subprocess, "Popen", return_value=self.child()) as launch, mock.patch("sys.stderr") as stderr:
            self.assertEqual(dev.main(["--port", "8780"]), 0)
        launch.assert_called_once()
        message = "".join(str(call.args[0]) for call in stderr.write.call_args_list)
        self.assertIn("continuing without cleanup", message)

    @unittest.skipUnless(dev.is_windows(), "Windows liveness regression")
    def test_windows_liveness_reports_a_nonexistent_pid_as_dead_without_signalling(self):
        self.assertFalse(dev.process_is_live(2_147_483_647))

    def test_invalid_seed_is_not_promoted_or_reused(self):
        bad = Path(self.tmp.name) / "bad.json"
        bad.write_text("not JSON", encoding="utf-8")
        stale_id = "b" * 24
        self.seed_dir.mkdir()
        dev.artifact_path(stale_id).write_text("stale", encoding="utf-8")

        with self.assertRaises(dev.RuntimeSeedError):
            dev.prepare_runtime_seed(str(bad))
        self.assertTrue(dev.artifact_path(stale_id).exists())

    def test_keyboard_interrupt_during_validation_cleans_this_launch_candidate(self):
        with mock.patch.object(dev, "validate_runtime_seed", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                dev.prepare_runtime_seed(str(self.example))
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_keyboard_interrupt_during_copy_cleans_this_launch_candidate(self):
        def interrupted_copy(_source, candidate):
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text("partial", encoding="utf-8")
            raise KeyboardInterrupt

        with mock.patch.object(dev, "copy_bounded_document", side_effect=interrupted_copy):
            with self.assertRaises(KeyboardInterrupt):
                dev.prepare_runtime_seed(str(self.example))
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_keyboard_interrupt_during_promotion_cleans_this_launch_candidate(self):
        with mock.patch.object(dev.os, "replace", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                dev.prepare_runtime_seed(str(self.example))
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_cli_document_wins_over_the_document_environment_variable(self):
        self.assertEqual(
            dev.select_document_path("cli.json", {dev.DOCUMENT_ENV_VAR: "environment.json"}),
            "cli.json",
        )
        self.assertEqual(
            dev.select_document_path(None, {dev.DOCUMENT_ENV_VAR: "environment.json"}),
            "environment.json",
        )
        self.assertIsNone(dev.select_document_path(None, {}))

    def test_invalid_document_stops_before_the_dev_server_is_called(self):
        bad = Path(self.tmp.name) / "bad.json"
        bad.write_text(json.dumps({"scenarios": []}), encoding="utf-8")
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="test-owner"), mock.patch.object(
            dev,
            "validate_runtime_seed",
            side_effect=dev.RuntimeSeedError("invalid test document"),
        ), mock.patch.object(dev.subprocess, "Popen") as launch:
            self.assertEqual(dev.main(["--document", str(bad), "--port", "8780"]), 2)
        launch.assert_not_called()

    def test_launcher_error_never_reports_any_document_path(self):
        bad = Path(self.tmp.name) / "bad.json"
        bad.write_text("not JSON", encoding="utf-8")
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="test-owner"), mock.patch.object(dev, "validate_runtime_seed", side_effect=dev.RuntimeSeedError("invalid test document")), mock.patch("sys.stderr") as stderr:
            self.assertEqual(dev.main(["--document", str(bad), "--port", "8780"]), 2)
        message = "".join(str(call.args[0]) for call in stderr.write.call_args_list)
        self.assertNotIn(bad.name, message)
        self.assertNotIn(str(bad.parent), message)

    def test_failed_port_resolution_cleans_the_exact_seed_artifact(self):
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="test-owner"), mock.patch.object(dev, "validate_runtime_seed"), mock.patch.object(dev, "resolve_port", side_effect=dev.PortError("port rejected")):
            self.assertEqual(dev.main(["--document", str(self.example), "--port", "8780"]), 2)
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_keyboard_interrupt_during_port_resolution_cleans_this_seed(self):
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="test-owner"), mock.patch.object(dev, "validate_runtime_seed"), mock.patch.object(dev, "resolve_port", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                dev.main(["--document", str(self.example), "--port", "8780"])
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_interrupted_child_wait_terminates_waits_and_cleans_this_seed(self):
        child = self.child(pid=5151)
        child.wait.side_effect = KeyboardInterrupt
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="test-owner"), mock.patch.object(dev, "validate_runtime_seed"), mock.patch.object(dev.subprocess, "Popen", return_value=child):
            with self.assertRaises(KeyboardInterrupt):
                dev.main(["--document", str(self.example), "--port", "8780"])
        child.terminate.assert_called_once()
        self.assertEqual(child.wait.call_count, 2)
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_seeded_launch_warns_and_cleans_up_after_the_child_exits(self):
        with mock.patch.object(dev, "is_windows", return_value=True), mock.patch.object(dev, "process_creation_identity", return_value="test-owner"), mock.patch.object(dev, "validate_runtime_seed"), mock.patch.object(dev.subprocess, "Popen", return_value=self.child()) as launch, mock.patch("sys.stderr") as stderr:
            self.assertEqual(dev.main(["--document", str(self.example), "--port", "8780"]), 0)
        launch.assert_called_once()
        child_env = launch.call_args.kwargs["env"]
        self.assertEqual(child_env[dev.RUNTIME_SEED_DIR_ENV_VAR], str(self.seed_dir))
        self.assertRegex(child_env[dev.RUNTIME_SEED_ID_ENV_VAR], r"^[A-Za-z0-9_-]{16,128}$")
        message = "".join(str(call.args[0]) for call in stderr.write.call_args_list)
        self.assertIn("sends its starter document to every browser", message)
        self.assertEqual(list(self.seed_dir.glob("wayfinder-runtime-seed-*.json")), [])

    def test_unseeded_launch_clears_inherited_runtime_seed_controls(self):
        inherited = {
            dev.RUNTIME_SEED_ENABLED_ENV_VAR: "1",
            dev.RUNTIME_SEED_ID_ENV_VAR: "a" * 24,
            dev.RUNTIME_SEED_DIR_ENV_VAR: str(self.seed_dir),
        }
        with mock.patch.dict(dev.os.environ, inherited), mock.patch.object(dev.subprocess, "Popen", return_value=self.child()) as launch:
            self.assertEqual(dev.main(["--port", "8780"]), 0)
        child_env = launch.call_args.kwargs["env"]
        for name in inherited:
            self.assertNotIn(name, child_env)


if __name__ == "__main__":
    unittest.main()
