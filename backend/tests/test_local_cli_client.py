import pathlib
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

from app.gpt.gpt_factory import GPTFactory
from app.gpt.local_cli_client import LocalCLIClient
from app.models.model_config import ModelConfig


class TestLocalCLIClient(unittest.TestCase):
    def test_runs_command_with_stdin_and_model_placeholder(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            script = pathlib.Path(temp_dir) / "echo_prompt.py"
            script.write_text(
                textwrap.dedent(
                    """
                    import sys
                    print(f"{sys.argv[1]}|{sys.stdin.read()}")
                    """
                ),
                encoding="utf-8",
            )
            command = f'"{sys.executable}" "{script}" "{{model}}"'
            client = LocalCLIClient(command)

            with patch.dict("os.environ", {"LOCAL_CLI_ENABLED": "true"}):
                response = client.chat.completions.create(
                    model="demo-model",
                    messages=[{"role": "user", "content": "hello"}],
                )

            self.assertEqual(response.choices[0].message.content, "demo-model|USER:\nhello")

    def test_factory_routes_cli_provider(self):
        config = ModelConfig(
            name="Local CLI",
            provider="cli",
            api_key="",
            base_url="tool --model {model}",
            model_name="demo-model",
        )

        gpt = GPTFactory.from_config(config)

        self.assertIsInstance(gpt.client, LocalCLIClient)

    def test_detects_and_builds_known_cli_without_command_template(self):
        with patch("app.gpt.local_cli_client.shutil.which") as which:
            which.side_effect = lambda name: f"/tools/{name}" if name == "codex" else None

            self.assertEqual(
                LocalCLIClient.detect_available(),
                [{"id": "codex", "name": "Codex CLI"}],
            )
            self.assertEqual(
                LocalCLIClient("codex")._build_args("demo-model"),
                [
                    "/tools/codex",
                    "exec",
                    "--ephemeral",
                    "--sandbox",
                    "read-only",
                    "--model",
                    "demo-model",
                    "-",
                ],
            )

    def test_execution_is_disabled_by_default(self):
        client = LocalCLIClient("missing-command")

        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "LOCAL_CLI_ENABLED=true"):
                client.chat.completions.create(
                    model="demo-model",
                    messages=[{"role": "user", "content": "hello"}],
                )

    def test_images_are_not_written_to_cli_stdin(self):
        prompt = LocalCLIClient._messages_to_prompt([
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,secret"}},
                ],
            }
        ])

        self.assertIn("当前仅支持文本", prompt)
        self.assertNotIn("base64,secret", prompt)


if __name__ == "__main__":
    unittest.main()
