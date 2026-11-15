import json
import os
import shlex
import shutil
import subprocess
from types import SimpleNamespace


class LocalCLIClient:
    """Minimal OpenAI-like client backed by a local command.

    The prompt is sent through stdin and the command is always executed without
    a shell. ``{model}`` in the command is replaced with the selected model.
    """

    PRESETS = {
        "codex": {
            "name": "Codex CLI",
            "args": ["exec", "--ephemeral", "--sandbox", "read-only", "--model", "{model}", "-"],
        },
        "claude": {
            "name": "Claude Code",
            "args": [
                "--print",
                "--no-session-persistence",
                "--permission-mode",
                "plan",
                "--tools",
                "",
                "--model",
                "{model}",
            ],
        },
        "gemini": {
            "name": "Gemini CLI",
            "args": ["--model", "{model}", "--approval-mode", "plan", "--prompt", ""],
        },
    }

    def __init__(self, command: str, model: str = ""):
        self.command = command
        self.model = model
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self.models = SimpleNamespace(list=self._list_models)

    def _list_models(self):
        return [SimpleNamespace(id=self.model, object="model", owned_by="local-cli")] if self.model else []

    @classmethod
    def detect_available(cls) -> list[dict[str, str]]:
        return [
            {"id": cli_id, "name": preset["name"]}
            for cli_id, preset in cls.PRESETS.items()
            if shutil.which(cli_id)
        ]

    @staticmethod
    def _strip_windows_quotes(value: str) -> str:
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            return value[1:-1]
        return value

    def _build_args(self, model: str) -> list[str]:
        if not self.command.strip():
            raise ValueError("本地 CLI 命令不能为空")
        if self.command in self.PRESETS:
            executable = shutil.which(self.command)
            if not executable:
                raise RuntimeError(f"未检测到 {self.PRESETS[self.command]['name']}")
            args = [executable, *self.PRESETS[self.command]["args"]]
            return [arg.replace("{model}", model) for arg in args]
        try:
            args = shlex.split(self.command, posix=os.name != "nt")
        except ValueError as exc:
            raise ValueError(f"本地 CLI 命令格式错误: {exc}") from exc
        if os.name == "nt":
            args = [self._strip_windows_quotes(arg) for arg in args]
        return [arg.replace("{model}", model) for arg in args]

    @staticmethod
    def _content_to_text(content) -> str:
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return json.dumps(content, ensure_ascii=False)

        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            elif isinstance(block, dict) and block.get("type") == "image_url":
                parts.append("[图片输入已省略：本地 CLI 供应商当前仅支持文本]")
            else:
                parts.append(json.dumps(block, ensure_ascii=False))
        return "\n".join(parts)

    @classmethod
    def _messages_to_prompt(cls, messages: list) -> str:
        return "\n\n".join(
            f"{str(message.get('role', 'user')).upper()}:\n{cls._content_to_text(message.get('content', ''))}"
            for message in messages
        )

    def _create(self, *, model: str = "", messages: list, **_kwargs):
        if os.getenv("LOCAL_CLI_ENABLED", "false").lower() not in {"1", "true", "yes", "on"}:
            raise RuntimeError("本地 CLI 功能未启用，请设置 LOCAL_CLI_ENABLED=true 并重启后端")

        selected_model = model or self.model
        args = self._build_args(selected_model)
        timeout = max(1.0, float(os.getenv("LOCAL_CLI_TIMEOUT_SECONDS", "600")))
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

        try:
            result = subprocess.run(
                args,
                input=self._messages_to_prompt(messages),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                shell=False,
                creationflags=creation_flags,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"找不到本地 CLI: {args[0]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"本地 CLI 执行超时（{timeout:g} 秒）") from exc

        output = result.stdout.strip()
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()[-2000:] or "无错误输出"
            raise RuntimeError(f"本地 CLI 执行失败（退出码 {result.returncode}）: {detail}")
        if not output:
            raise RuntimeError("本地 CLI 未返回任何内容")

        message = SimpleNamespace(content=output, tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])
