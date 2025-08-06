#!/usr/bin/env python3
"""
Claude Opus 4 Agent for Terminal-Bench Evaluation

This agent integrates Claude Opus 4 (via OpenRouter API) with the Terminal-Bench 
evaluation framework to test AI agent performance on complex terminal tasks.

Usage:
    python claude_opus4_agent.py
"""

import os
import logging
import requests
import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from terminal_bench import Harness

from terminal_bench.agents.base_agent import AgentResult, BaseAgent
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.terminal.tmux_session import TmuxSession
from terminal_bench.utils.logger import logger

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
        """Call Claude via OpenRouter API with retry logic."""
        max_retries = 3
        for attempt in range(max_retries):
            try:
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
                elif response.status_code == 502 and attempt < max_retries - 1:
                    self._logger.warning(f"502 error on attempt {attempt + 1}, retrying in 5 seconds...")
                    time.sleep(5)
                    continue
                else:
                    raise Exception(f"API error: {response.status_code} - {response.text}")
            except requests.exceptions.Timeout as e:
                if attempt < max_retries - 1:
                    self._logger.warning(f"Timeout on attempt {attempt + 1}, retrying...")
                    time.sleep(2)
                    continue
                else:
                    raise Exception(f"API timeout after {max_retries} attempts: {e}")
            except Exception as e:
                if attempt < max_retries - 1:
                    self._logger.warning(f"Error on attempt {attempt + 1}: {e}, retrying...")
                    time.sleep(2)
                    continue
                else:
                    raise e
        
        raise Exception(f"Failed after {max_retries} attempts")
    
    def perform_task(self, instruction: str, session: TmuxSession, logging_dir: Path | None = None) -> AgentResult:
        """Perform a terminal task using Claude Opus 4."""
        timestamped_markers = []
        
        for turn in range(50):  # Max 50 turns to avoid infinite loops
            try:
                terminal_output = session.capture_pane()
                
                prompt = f"""You are an AI agent working in a terminal environment. Your goal is to complete the given task through careful observation and command execution.

Task: {instruction}

Current Terminal State:
```
{terminal_output}
```

Analyze the terminal state and decide on your next actions. Respond using this EXACT format:

<observation>
Describe what you see in the terminal and your current understanding of the situation.
</observation>

<reasoning>
Explain your thinking process and why you're choosing these specific commands.
</reasoning>

<action>
{{"commands": ["command1", "command2"], "task_complete": false}}
</action>

CRITICAL RULES:
1. The <action> section must contain ONLY valid JSON - no explanatory text
2. Use "commands": [] for the list of shell commands to execute
3. Set "task_complete": true only when the task is fully accomplished
4. If no commands needed, use "commands": []
5. Maximum 3 commands per turn

Example response:
<observation>I can see a terminal prompt. I need to start working on the task.</observation>
<reasoning>First I should understand the current directory and available files.</reasoning>
<action>{{"commands": ["pwd", "ls -la"], "task_complete": false}}</action>"""

                response_text = self._call_claude(prompt)
                self._logger.info(f"Claude response: {response_text}")
                
                # Parse XML-structured response
                try:
                    import re
                    import json
                    
                    # Extract observation, reasoning, and action sections
                    observation_match = re.search(r'<observation>(.*?)</observation>', response_text, re.DOTALL)
                    reasoning_match = re.search(r'<reasoning>(.*?)</reasoning>', response_text, re.DOTALL)
                    action_match = re.search(r'<action>(.*?)</action>', response_text, re.DOTALL)
                    
                    if not all([observation_match, reasoning_match, action_match]):
                        raise ValueError("Missing required XML sections in response")
                    
                    observation = observation_match.group(1).strip()
                    reasoning = reasoning_match.group(1).strip()
                    action_json_str = action_match.group(1).strip()
                    
                    # Parse the action JSON
                    action_data = json.loads(action_json_str)
                    
                    # Create response object
                    response = AgentResponse(
                        observation=observation,
                        reasoning=reasoning,
                        commands=action_data.get("commands", []),
                        task_complete=action_data.get("task_complete", False)
                    )
                    
                except Exception as parse_error:
                    # Fallback: try to extract JSON directly (backwards compatibility)
                    try:
                        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                        if json_match:
                            json_str = json_match.group(0)
                            json_data = json.loads(json_str)
                            response = AgentResponse(
                                observation=json_data.get("observation", "Parse error fallback"),
                                reasoning=json_data.get("reasoning", "Using fallback parsing"),
                                commands=json_data.get("commands", []),
                                task_complete=json_data.get("task_complete", False)
                            )
                        else:
                            raise ValueError("No valid JSON found in response")
                    except Exception as fallback_error:
                        self._logger.error(f"Failed to parse response: {parse_error}")
                        self._logger.error(f"Fallback also failed: {fallback_error}")
                        self._logger.error(f"Raw response: {response_text}")
                        
                        # Create a safe fallback response to continue execution
                        response = AgentResponse(
                            observation="Failed to parse Claude's response", 
                            reasoning="JSON/XML parsing error - will try to continue", 
                            commands=[], 
                            task_complete=False
                        )
                        # Only give up after several failed turns
                        if turn > 5:
                            response.task_complete = True
                
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
    
    # Validate API key
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("❌ Error: OPENROUTER_API_KEY environment variable not found")
        return None
    else:
        print(f"✅ API key found: {api_key[:10]}...")
    
    # Set Docker for macOS
    os.environ['DOCKER_HOST'] = 'unix://' + os.path.expanduser('~/.docker/run/docker.sock')
    print(f"🐳 Docker host: {os.environ['DOCKER_HOST']}")
    
    # Validate Docker connectivity
    try:
        import subprocess
        result = subprocess.run(['docker', 'version'], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print("✅ Docker is accessible")
        else:
            print(f"⚠️  Docker warning: {result.stderr}")
    except Exception as e:
        print(f"⚠️  Could not validate Docker: {e}")
    
    # Get the absolute path to this file
    current_file = Path(__file__).resolve()
    current_dir = current_file.parent
    root_dir = current_dir.parent.parent
    
    print(f"📁 Current file: {current_file}")
    print(f"📁 Root directory: {root_dir}")
    
    # Add the root directory to Python path
    import sys
    sys.path.insert(0, str(root_dir))
    
    # Use the absolute path for the import
    agent_import_path = f"{current_file.stem}:ClaudeOpus4Agent"
    print(f"🤖 Agent import path: {agent_import_path}")
    
    # Run evaluation using Terminal-Bench Python API
    try:
        # Create output directory for results
        timestamp = datetime.now().strftime("%Y-%m-%d__%H-%M-%S")
        output_path = Path(f"runs/{timestamp}")  # Fixed: relative to current directory
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Create and run harness
        harness = Harness(
            output_path=output_path,
            run_id=timestamp,
            agent_import_path=agent_import_path,
            dataset_name="terminal-bench-core",  
            dataset_version="head",  # Use latest pre-release version
            cleanup=True,
            n_concurrent_trials=1,  # Avoid API rate limits
            task_ids=["chess-best-move"],  # Only run this specific task
        )
        
        # Run the evaluation
        results = harness.run()
        
        print("📊 Evaluation Results:")
        print(f"Results type: {type(results)}")
        print(f"Results: {results}")
        
        return results
    except Exception as e:
        print(f"❌ Error during evaluation: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    run_evaluation() 