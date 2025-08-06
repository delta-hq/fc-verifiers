#!/usr/bin/env python3
"""
Claude Opus 4 Agent for Terminal-Bench Evaluation

This agent integrates Claude Opus 4 (via OpenRouter API) with the Terminal-Bench 
evaluation framework to test AI agent performance on complex terminal tasks.

Usage:
    python claude_opus4_agent.py
"""

import json
import os
import requests
import time
from pathlib import Path
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from terminal_bench.agents.base_agent import AgentResult, BaseAgent
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.terminal.tmux_session import TmuxSession
from terminal_bench.utils.logger import logger
from terminal_bench.cli.tb.runs import create

load_dotenv()

class AgentResponse(BaseModel):
    observation: str = Field(description="What I see")
    reasoning: str = Field(description="Why I'm doing this") 
    commands: list[str] = Field(description="Commands to run")
    task_complete: bool = Field(default=False)

class ClaudeOpus4Agent(BaseAgent):
    """Claude Opus 4 agent for Terminal-Bench evaluation."""
    
    @staticmethod
    def name() -> str:
        return "claude-opus4"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.api_key = os.environ.get("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")
        self._logger = logger.getChild(__name__)
        self.total_input_tokens = 0
        self.total_output_tokens = 0
    
    def _call_claude(self, prompt):
        """Call Claude via OpenRouter API."""
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "anthropic/claude-opus-4",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 4096,
                "temperature": 0.0
            },
            timeout=120
        )
        
        if response.status_code == 200:
            result = response.json()
            usage = result.get("usage", {})
            self.total_input_tokens += usage.get("prompt_tokens", 0)
            self.total_output_tokens += usage.get("completion_tokens", 0)
            return result["choices"][0]["message"]["content"]
        else:
            raise Exception(f"API error: {response.status_code} - {response.text}")
    
    def perform_task(self, instruction: str, session: TmuxSession, logging_dir: Path | None = None) -> AgentResult:
        """Perform a terminal task using Claude Opus 4."""
        timestamped_markers = []
        
        for turn in range(50):  # Max 50 turns to avoid infinite loops
            try:
                terminal_output = session.capture_pane()
                
                prompt = f"""You are an AI agent in a terminal. Complete this task:

Task: {instruction}

Terminal:
```
{terminal_output}
```

Respond with JSON: {{"observation": "what I see", "reasoning": "why", "commands": ["cmd1"], "task_complete": false}}"""

                response_text = self._call_claude(prompt)
                self._logger.info(f"Claude response: {response_text}")
                
                try:
                    response = AgentResponse.model_validate_json(response_text)
                except Exception as parse_error:
                    self._logger.error(f"Failed to parse response: {parse_error}")
                    response = AgentResponse(
                        observation="Parse error", 
                        reasoning="Failed to parse JSON response", 
                        commands=[], 
                        task_complete=True
                    )
                
                # Execute commands
                for cmd in response.commands:
                    self._logger.info(f"Executing: {cmd}")
                    session.send_keys(cmd)
                    session.send_keys("Enter")
                    time.sleep(2)  # Allow command to execute
                
                timestamp = session.get_asciinema_timestamp()
                timestamped_markers.append((timestamp, f"Turn {turn}: {response.reasoning[:50]}"))
                
                if response.task_complete:
                    self._logger.info("Task marked as complete")
                    break
                    
            except Exception as e:
                self._logger.error(f"Error in turn {turn}: {e}")
                return AgentResult(
                    total_input_tokens=self.total_input_tokens,
                    total_output_tokens=self.total_output_tokens,
                    failure_mode=FailureMode.UNKNOWN_AGENT_ERROR,
                    timestamped_markers=timestamped_markers,
                )
        
        return AgentResult(
            total_input_tokens=self.total_input_tokens,
            total_output_tokens=self.total_output_tokens,
            failure_mode=FailureMode.NONE,
            timestamped_markers=timestamped_markers,
        )

def run_evaluation():
    """Run Claude Opus 4 evaluation on Terminal-Bench."""
    print("🚀 Running Claude Opus 4 on Terminal-Bench")
    
    # Set Docker for macOS
    os.environ['DOCKER_HOST'] = 'unix://' + os.path.expanduser('~/.docker/run/docker.sock')
    
    # Run evaluation using Terminal-Bench Python API
    results = create(
        dataset="terminal-bench-core==0.1.1",
        agent_import_path="agent_benchmarks.terminal_bench.agents.claude_opus4_agent:ClaudeOpus4Agent",
        cleanup=True,
        n_concurrent_trials=1,  # Avoid API rate limits
        n_tasks=10,  # Run subset for testing
    )
    
    print("📊 Evaluation Results:")
    print(f"Results type: {type(results)}")
    print(f"Results: {results}")
    
    return results

if __name__ == "__main__":
    run_evaluation() 